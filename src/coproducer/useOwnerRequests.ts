/**
 * The owner's inbox of co-producer requests: how many are waiting, what each
 * asks for, and approving or rejecting them.
 *
 * Lists come from outlines only (small, and enough for a headline built from
 * the owner's own data). Each card then loads its own payload, validates it
 * with the same strict schema the server ran, and, for an edit, plans it
 * against the owner's current data (applyRequest.ts). One unreadable request
 * never stops the others: each is read in its own try/catch.
 *
 * Approving an edit plans again on the latest state, in the same tick as the
 * commit, and refuses when the result differs from what the card showed;
 * the owner then sees the new plan and taps again. A share makes or looks up
 * its link in the owner's app and files it before the decision is recorded,
 * so a link never exists that the owner cannot see or withdraw. When the
 * commit lands but recording the decision fails, the card offers only
 * "Finish approving".
 *
 * The work lives in a plain controller the hook drives, so it can be tested
 * without a page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Show } from '../types';
import type { ApiError } from '../utils/api';
import { decryptWithKeys, encryptWithKey } from '../utils/encryption';
import { isLinkStorageFull, LINK_STORAGE_FULL_MESSAGE } from '../utils/linkStorage';
import type { SessionCredentials } from '../utils/session-vault';
import { planEdit, type AppliedPlan, type PlanResult } from './applyRequest';
import { headline, type DiffContext } from './diff';
import { executeShare, shareBlocker, type ShareContext, type ShareEffect } from './executeShare';
import { reviewOrigin } from './origins';
import { buildOutline } from './outline';
import * as ownerClient from './ownerClient';
import { buildPseudonymIndex, type OwnerState } from './redaction';
import { validatePayload } from './schema';
import type {
  ApprovalResult,
  EditPayload,
  HandoutRefs,
  OwnerRequestRow,
  RequestKind,
  RequestOutline,
  RequestPayload,
} from './types';
import { DOWNLOAD_TYPES, SHARE_TYPES } from './types';

export interface CommitReport { keptLinks: string[] }

/** What App hands the inbox. */
export interface OwnerDataApi {
  session: SessionCredentials;
  /** latestShowsRef.current / latestSettingsRef.current: the owner's state including unsaved edits. */
  shows(): Show[];
  settings(): AppSettings;
  loaded(): boolean;
  producerLocked: boolean;
  /** A save conflict is waiting on the owner. */
  syncBlocked(): boolean;
  /** Apply a plan made on shows()/settings() in this same tick. */
  commit(plan: AppliedPlan): Promise<CommitReport>;
  /** File what a share approval made (a link row, a viewer link) on the latest state. */
  commitShare(effect: ShareEffect): void;
  /** Withdraw links an earlier approval handed out. */
  withdrawHandout(links: HandoutRefs['links']): Promise<{ withdrawn: number; skipped: string[] }>;
  /** Open a show (the card's "Open show" link). */
  openShow(id: string): void;
}

export interface InboxItem {
  row: OwnerRequestRow;
  /** Decrypted co-producer name, or 'A co-producer' if the link has gone. */
  who: string;
  /** Null: the outline could not be read; only Reject is offered. */
  outline: RequestOutline | null;
  /** headline(outline, { state: owner }): never words the co-producer wrote. */
  headline: string;
  detail: 'idle' | 'loading' | 'ready' | 'unreadable';
  payload?: RequestPayload;
  /** Edits, once ready. */
  plan?: PlanResult;
  /** The fingerprint of the plan on screen; Approve compares against it. */
  shown?: string;
  /** Shares: the result and handout made, kept for "Finish approving". */
  made?: { result: ApprovalResult; handout?: HandoutRefs };
  /** Commit ran but decide has not landed: only "Finish approving" is offered. */
  applied?: boolean;
  /** Something the owner should read on the card before going on ("This changed while you were looking…"). */
  notice?: string;
  error?: string;
}

export interface InboxSnapshot {
  /** From inboxCount, for the More badge and the notice. */
  open: number;
  links: number;
  items: InboxItem[];
  recent: InboxItem[];
  loading: boolean;
  error: string | null;
  /** A decision, plan or detail load is in flight: every Approve and Reject is disabled. */
  busy: boolean;
  /** What the last decision did, for a polite live region. */
  announcement: string;
}

export interface OwnerRequests extends InboxSnapshot {
  /** Ask for the count again now: a link was made or withdrawn, which changes what the badge and the More page offer. */
  refreshCount(): Promise<void>;
  load(): Promise<void>;
  loadDetail(id: string): Promise<void>;
  approve(item: InboxItem, options?: { anyway?: boolean }): Promise<void>;
  finish(item: InboxItem): Promise<void>;
  reject(item: InboxItem): Promise<void>;
  rejectAllFrom(linkId: string): Promise<void>;
}

export const INBOX_TEXT = {
  unreadable: "This request couldn't be read.",
  changed: 'This changed while you were looking. Check it again, then approve.',
  syncBlocked: "Your last change hasn't saved yet. Approve once the pill says Saved.",
  loadFailed: "Couldn't load requests. Check your connection and try again.",
  decideFailed: "Couldn't record that. Check your connection and try again.",
  shareFailed: "Couldn't make the link. Check your connection and try again.",
  approvedEdit: "Approved. It's in your account now.",
  approvedShare: (who: string) => `Approved. ${who} can share it now.`,
  approvedDownload: (who: string) => `Approved. ${who} can download it now.`,
  rejected: (who: string) => `Rejected. ${who} will see it wasn't approved.`,
  finish: (who: string) => `Your approval is in your account. Finish approving to let ${who} know.`,
  withdrawnMeanwhile: (who: string) =>
    `${who} withdrew this request, but your approval had already been applied. Earlier versions in Settings can undo it for your shows and settings; any links it withdrew stay withdrawn.`,
  keptLinks: (names: string[]) =>
    `Couldn't withdraw ${names.join(', ')}'s link. It's back in Contracts; try withdrawing it there.`,
} as const;

/** The owner routes the inbox uses; ownerClient's, unless a test passes its own. */
export type InboxClient = Pick<
  typeof ownerClient,
  'inboxCount' | 'listInbox' | 'getInboxRequest' | 'listCoproducerLinks' | 'adoptMedia' | 'decide' | 'decideMany'
>;

const EMPTY: InboxSnapshot = { open: 0, links: 0, items: [], recent: [], loading: false, error: null, busy: false, announcement: '' };

/** How many details load by themselves when the inbox opens; the rest on "Show details". */
const DETAILS_UP_FRONT = 10;

const KINDS = new Set<RequestKind>(['edit', 'share', 'download']);
const ACTION_TYPES = new Set<string>([...SHARE_TYPES, ...DOWNLOAD_TYPES]);
const OPS = new Set(['create', 'update', 'delete']);

/** A decrypted outline, if it is one; anything else is null. */
export function readOutline(value: unknown): RequestOutline | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const outline = value as Record<string, unknown>;
  if (!KINDS.has(outline.kind as RequestKind)) return null;
  if (outline.kind === 'edit') {
    const shows = outline.shows ?? [];
    const fields = outline.settingsFields ?? [];
    if (!Array.isArray(shows) || !Array.isArray(fields)) return null;
    for (const show of shows) {
      if (!show || typeof show !== 'object' || typeof show.id !== 'string' || !OPS.has(show.op)) return null;
      if (show.createName !== undefined && typeof show.createName !== 'string') return null;
    }
    if (fields.some((field) => typeof field !== 'string')) return null;
    return { kind: 'edit', shows, settingsFields: fields } as RequestOutline;
  }
  const action = outline.action as Record<string, unknown> | undefined;
  if (!action || typeof action !== 'object' || !ACTION_TYPES.has(action.type as string) || typeof action.key !== 'string') return null;
  for (const key of ['showId', 'contractId', 'contactId', 'agreementId'] as const) {
    if (action[key] !== undefined && typeof action[key] !== 'string') return null;
  }
  if (action.requestIds !== undefined && (!Array.isArray(action.requestIds) || action.requestIds.some((id) => typeof id !== 'string'))) return null;
  return outline as unknown as RequestOutline;
}

/** The share context for the owner's latest state. */
export function shareContextOf(data: OwnerDataApi): ShareContext {
  return { session: data.session, state: stateOf(data), origin: location.origin, producerLocked: data.producerLocked };
}

function stateOf(data: OwnerDataApi): OwnerState {
  return { shows: data.shows(), settings: data.settings() };
}

function diffContextOf(state: OwnerState): DiffContext {
  return { state, rolodexPlural: state.settings.rolodexTermPlural, musicLibrary: state.settings.musicLibrary };
}

function appOrigins(): string[] {
  const here = location.origin;
  return [here, reviewOrigin() || here];
}

function statusOf(err: unknown): number | undefined {
  return (err as ApiError | null)?.status;
}

export interface OwnerInbox {
  snapshot(): InboxSnapshot;
  refreshCount(): Promise<void>;
  load(): Promise<void>;
  loadDetail(id: string): Promise<void>;
  approve(item: InboxItem, options?: { anyway?: boolean }): Promise<void>;
  finish(item: InboxItem): Promise<void>;
  reject(item: InboxItem): Promise<void>;
  rejectAllFrom(linkId: string): Promise<void>;
  dispose(): void;
}

/**
 * The inbox for whoever `getData` says is signed in, reporting every change
 * to `onChange`. Does nothing while getData() is null.
 */
export function createOwnerInbox(
  getData: () => OwnerDataApi | null,
  onChange: (snapshot: InboxSnapshot) => void,
  client: InboxClient = ownerClient,
): OwnerInbox {
  let state: InboxSnapshot = EMPTY;
  let busy = 0;
  let disposed = false;
  const labels = new Map<string, string>();
  /** When each card was first planned: its plans use that time, so a re-plan reads the same. */
  const plannedAt = new Map<string, string>();

  const report = (patch: Partial<InboxSnapshot>) => {
    state = { ...state, ...patch, busy: busy > 0 };
    if (!disposed) onChange(state);
  };
  const working = async <T>(run: () => Promise<T>): Promise<T> => {
    busy += 1;
    report({});
    try {
      return await run();
    } finally {
      busy -= 1;
      report({});
    }
  };
  const find = (id: string) => state.items.find((item) => item.row.id === id) ?? null;
  const setItem = (id: string, patch: Partial<InboxItem>) => {
    report({ items: state.items.map((item) => (item.row.id === id ? { ...item, ...patch } : item)) });
  };
  const drop = (ids: Iterable<string>) => {
    const gone = new Set(ids);
    report({ items: state.items.filter((item) => !gone.has(item.row.id)) });
  };

  const ctxFor = (row: OwnerRequestRow, index: Awaited<ReturnType<typeof buildPseudonymIndex>>, owner: OwnerState) => {
    const now = plannedAt.get(row.id) ?? new Date().toISOString();
    plannedAt.set(row.id, now);
    return {
      index,
      mediaIds: row.mediaIds,
      now,
      trashId: (showId: string) => `coprod-${row.id}-${showId}`.slice(0, 128),
      newId: (seed: string) => `coprod-${row.id}-new-${seed}`.slice(0, 128),
      context: diffContextOf(owner),
    };
  };

  const itemFor = (row: OwnerRequestRow, data: OwnerDataApi, previous?: InboxItem): InboxItem => {
    const who = labels.get(row.linkId) ?? 'A co-producer';
    if (previous && previous.detail === 'ready') return { ...previous, row, who };
    let outline: RequestOutline | null = null;
    try {
      outline = readOutline(ownerClient.decryptUntrusted(row.outline, data.session));
    } catch {
      outline = null;
    }
    if (outline && outline.kind !== row.kind) outline = null;
    const detail: InboxItem['detail'] = !outline ? 'unreadable' : previous?.detail === 'loading' || previous?.detail === 'unreadable' ? previous.detail : 'idle';
    return {
      ...(previous ?? {}),
      row,
      who,
      outline,
      headline: outline ? headline(outline, diffContextOf(stateOf(data))) : '',
      detail,
      error: detail === 'unreadable' ? INBOX_TEXT.unreadable : previous?.error,
    };
  };

  /** Plan an edit on the owner's state as it is now. */
  const planFor = async (row: OwnerRequestRow, payload: EditPayload, data: OwnerDataApi): Promise<PlanResult> => {
    const owner = stateOf(data);
    const index = await buildPseudonymIndex(owner);
    return planEdit(payload, owner, ctxFor(row, index, owner));
  };

  const readDetail = async (id: string): Promise<void> => {
    const data = getData();
    const item = find(id);
    if (!data || !item) return;
    setItem(id, { detail: 'loading' });
    try {
      const detail = await client.getInboxRequest(data.session, id);
      const checked = validatePayload(ownerClient.decryptUntrusted(detail.payload, data.session), { appOrigins: appOrigins(), newPeopleCheckedByPlan: true });
      const payload = checked.payload;
      if (!payload || payload.kind !== item.row.kind) throw new Error('not a request');
      const outline = buildOutline(payload);
      const patch: Partial<InboxItem> = {
        payload,
        outline,
        headline: headline(outline, diffContextOf(stateOf(data))),
        detail: 'ready',
        error: undefined,
      };
      if (payload.kind === 'edit') {
        const plan = await planFor(item.row, payload, data);
        patch.plan = plan;
        patch.shown = plan.ok ? plan.fingerprint : undefined;
      }
      setItem(id, patch);
    } catch {
      setItem(id, { detail: 'unreadable', error: INBOX_TEXT.unreadable, payload: undefined, plan: undefined, shown: undefined });
    }
  };

  /** Plan every ready edit again on the latest state, one at a time. */
  const replanAll = async () => {
    for (const item of state.items) {
      const data = getData();
      if (!data) return;
      if (item.detail !== 'ready' || item.applied || item.payload?.kind !== 'edit') continue;
      try {
        const plan = await planFor(item.row, item.payload, data);
        setItem(item.row.id, { plan, shown: plan.ok ? plan.fingerprint : undefined });
      } catch {
        setItem(item.row.id, { detail: 'unreadable', error: INBOX_TEXT.unreadable });
      }
    }
  };

  /** Pending edits whose plans conflict are marked stale, all in one call. */
  const markStale = async () => {
    const data = getData();
    if (!data) return;
    const ids = state.items
      .filter((item) => item.row.status === 'pending' && item.row.kind === 'edit' && item.plan?.ok && item.plan.conflicts.length > 0)
      .map((item) => item.row.id)
      .slice(0, 200);
    if (ids.length === 0) return;
    try {
      const decided = new Set(await client.decideMany(data.session, { ids, decision: 'stale' }));
      report({ items: state.items.map((item) => (decided.has(item.row.id) ? { ...item, row: { ...item.row, status: 'stale' } } : item)) });
    } catch {
      /* The cards say what conflicts either way; the next load tries again. */
    }
  };

  const refreshCount = async () => {
    const data = getData();
    if (!data) return;
    try {
      const count = await client.inboxCount(data.session);
      report({ open: count.open, links: count.links });
    } catch {
      /* The badge keeps what it had. */
    }
  };

  const afterDecision = async (announcement: string) => {
    report({ announcement });
    await replanAll();
    await refreshCount();
  };

  const recordApproval = async (item: InboxItem, data: OwnerDataApi, made?: InboxItem['made']): Promise<boolean> => {
    const body = made
      ? {
          id: item.row.id,
          decision: 'approved' as const,
          result: encryptWithKey(made.result, data.session.key),
          ...(made.handout ? { handout: encryptWithKey(made.handout, data.session.key) } : {}),
        }
      : { id: item.row.id, decision: 'approved' as const };
    try {
      await client.decide(data.session, body);
      return true;
    } catch (err) {
      if (statusOf(err) === 409) {
        drop([item.row.id]);
        report({ announcement: INBOX_TEXT.withdrawnMeanwhile(item.who) });
        return false;
      }
      setItem(item.row.id, { applied: true, error: INBOX_TEXT.finish(item.who) });
      return false;
    }
  };

  const approveEdit = async (item: InboxItem, data: OwnerDataApi, anyway: boolean) => {
    if (data.syncBlocked()) {
      setItem(item.row.id, { error: INBOX_TEXT.syncBlocked });
      return;
    }
    const plan = item.plan;
    if (!plan?.ok || !item.payload) return;
    if (plan.conflicts.length > 0 && !anyway) return;
    if (item.row.mediaIds.length > 0) await client.adoptMedia(data.session, item.row.id);
    const index = await buildPseudonymIndex(stateOf(data));
    // From here to the commit nothing is awaited: the plan is made on the
    // state the commit writes over.
    const checked = validatePayload(item.payload, { appOrigins: appOrigins(), newPeopleCheckedByPlan: true });
    if (!checked.payload || checked.payload.kind !== 'edit') {
      setItem(item.row.id, { detail: 'unreadable', error: INBOX_TEXT.unreadable, plan: undefined, shown: undefined });
      return;
    }
    const owner = stateOf(data);
    const fresh = planEdit(checked.payload, owner, ctxFor(item.row, index, owner));
    if (!fresh.ok) {
      setItem(item.row.id, { plan: fresh, shown: undefined, notice: undefined });
      return;
    }
    if (fresh.fingerprint !== item.shown) {
      setItem(item.row.id, { plan: fresh, shown: fresh.fingerprint, notice: INBOX_TEXT.changed });
      return;
    }
    const committed = data.commit(fresh);
    setItem(item.row.id, { applied: true, plan: fresh, notice: undefined, error: undefined });
    const recorded = await recordApproval(item, data);
    const { keptLinks } = await committed;
    const kept = keptLinks.length ? ` ${INBOX_TEXT.keptLinks(keptLinks)}` : '';
    if (recorded) {
      drop([item.row.id]);
      await afterDecision(`${INBOX_TEXT.approvedEdit}${kept}`);
    } else if (kept) {
      report({ announcement: `${state.announcement} ${kept.trim()}`.trim() });
    }
  };

  const approveShare = async (item: InboxItem, data: OwnerDataApi) => {
    if (item.payload?.kind !== 'share') return;
    const action = item.payload.action;
    const ctx = shareContextOf(data);
    const blocked = shareBlocker(action, ctx);
    if (blocked) {
      setItem(item.row.id, { error: blocked });
      return;
    }
    let made: InboxItem['made'];
    try {
      const done = await executeShare(action, ctx);
      if (!done.ok) {
        setItem(item.row.id, { error: done.reason });
        return;
      }
      // Filed in the owner's own data before anything else, so a link never
      // exists that nobody can see or withdraw.
      if (done.effect) data.commitShare(done.effect);
      made = { result: done.result, handout: done.handout };
    } catch (err) {
      setItem(item.row.id, { error: isLinkStorageFull(err) ? LINK_STORAGE_FULL_MESSAGE : INBOX_TEXT.shareFailed });
      return;
    }
    setItem(item.row.id, { made, applied: true, error: undefined });
    if (await recordApproval(item, data, made)) {
      drop([item.row.id]);
      await afterDecision(INBOX_TEXT.approvedShare(item.who));
    }
  };

  const finish = async (item: InboxItem) => {
    const data = getData();
    const current = find(item.row.id);
    if (!data || !current?.applied) return;
    await working(async () => {
      if (await recordApproval(current, data, current.made)) {
        drop([current.row.id]);
        await afterDecision(
          current.row.kind === 'edit' ? INBOX_TEXT.approvedEdit : current.row.kind === 'share' ? INBOX_TEXT.approvedShare(current.who) : INBOX_TEXT.approvedDownload(current.who),
        );
      }
    });
  };

  return {
    snapshot: () => state,
    refreshCount,
    finish,
    async load() {
      const data = getData();
      if (!data) return;
      report({ loading: true, error: null });
      try {
        const open: OwnerRequestRow[] = [];
        let after: string | undefined;
        for (let page = 0; page < 50; page++) {
          const res = await client.listInbox(data.session, 'open', after);
          open.push(...res.requests);
          if (!res.next) break;
          after = res.next;
        }
        const recent = (await client.listInbox(data.session, 'recent')).requests;
        try {
          for (const link of await client.listCoproducerLinks(data.session)) {
            try {
              const label = decryptWithKeys<unknown>(link.labelCipher, [data.session.key, data.session.legacyKey]);
              if (typeof label === 'string' && label.trim()) labels.set(link.id, label.trim());
            } catch {
              /* Named 'A co-producer' instead. */
            }
          }
        } catch {
          /* Names stay as they were; the requests still list. */
        }
        const previous = new Map(state.items.map((item) => [item.row.id, item]));
        report({
          items: open.map((row) => itemFor(row, data, previous.get(row.id))),
          recent: recent.map((row) => itemFor(row, data)),
          open: open.length,
        });
      } catch {
        report({ loading: false, error: INBOX_TEXT.loadFailed });
        return;
      }
      report({ loading: false });
      await working(async () => {
        await replanAll();
        for (const item of state.items.slice(0, DETAILS_UP_FRONT)) {
          if (item.detail === 'idle') await readDetail(item.row.id);
        }
      });
      await markStale();
    },
    async loadDetail(id: string) {
      await working(() => readDetail(id));
    },
    async approve(item: InboxItem, options: { anyway?: boolean } = {}) {
      const data = getData();
      const current = find(item.row.id);
      if (!data || !current || busy > 0) return;
      if (current.applied) {
        await finish(current);
        return;
      }
      await working(async () => {
        try {
          if (current.row.kind === 'edit') await approveEdit(current, data, !!options.anyway);
          else if (current.row.kind === 'share') await approveShare(current, data);
          else if (current.payload?.kind === 'download' && (await recordApproval(current, data))) {
            drop([current.row.id]);
            await afterDecision(INBOX_TEXT.approvedDownload(current.who));
          }
        } catch {
          if (!find(item.row.id)?.applied) setItem(item.row.id, { error: INBOX_TEXT.decideFailed });
        }
      });
    },
    async reject(item: InboxItem) {
      const data = getData();
      const current = find(item.row.id);
      if (!data || !current || current.applied || busy > 0) return;
      await working(async () => {
        try {
          await client.decide(data.session, { id: current.row.id, decision: 'rejected' });
        } catch (err) {
          if (statusOf(err) !== 409) {
            setItem(current.row.id, { error: INBOX_TEXT.decideFailed });
            return;
          }
        }
        drop([current.row.id]);
        await afterDecision(INBOX_TEXT.rejected(current.who));
      });
    },
    async rejectAllFrom(linkId: string) {
      const data = getData();
      if (!data || busy > 0) return;
      const from = state.items.filter((item) => item.row.linkId === linkId && !item.applied);
      if (from.length === 0) return;
      const who = from[0].who;
      await working(async () => {
        const decided: string[] = [];
        try {
          for (let at = 0; at < from.length; at += 200) {
            const ids = from.slice(at, at + 200).map((item) => item.row.id);
            decided.push(...(await client.decideMany(data.session, { ids, decision: 'rejected' })));
          }
        } catch {
          report({ error: INBOX_TEXT.decideFailed });
        }
        drop(decided);
        if (decided.length) await afterDecision(INBOX_TEXT.rejected(who));
      });
    },
    dispose() {
      disposed = true;
    },
  };
}

/** How often the count is fetched while the page is on screen: each call costs the server a credential check. */
export const COUNT_POLL_MS = 5 * 60_000;
/** And when the account has no co-producer links at all. */
export const COUNT_POLL_IDLE_MS = 30 * 60_000;

/** The owner's inbox. Inert (nothing counted) while `data` is null: signed out, not loaded yet, or co-producer view. */
export function useOwnerRequests(data: OwnerDataApi | null): OwnerRequests {
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  });
  const sessionKey = data ? `${data.session.userId}:${data.session.authHash}` : '';
  const [snapshot, setSnapshot] = useState<{ key: string; data: InboxSnapshot }>({ key: '', data: EMPTY });
  const inboxRef = useRef<OwnerInbox | null>(null);

  useEffect(() => {
    if (!sessionKey) return;
    const inbox = createOwnerInbox(() => dataRef.current, (next) => setSnapshot({ key: sessionKey, data: next }));
    inboxRef.current = inbox;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void inbox.refreshCount();
        schedule();
      }, inbox.snapshot().links === 0 ? COUNT_POLL_IDLE_MS : COUNT_POLL_MS);
    };
    void inbox.refreshCount().then(schedule);
    const onFocus = () => void inbox.refreshCount();
    window.addEventListener('focus', onFocus);
    return () => {
      inbox.dispose();
      if (inboxRef.current === inbox) inboxRef.current = null;
      window.clearTimeout(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionKey]);

  const refreshCount = useCallback(() => inboxRef.current?.refreshCount() ?? Promise.resolve(), []);
  const load = useCallback(() => inboxRef.current?.load() ?? Promise.resolve(), []);
  const loadDetail = useCallback((id: string) => inboxRef.current?.loadDetail(id) ?? Promise.resolve(), []);
  const approve = useCallback((item: InboxItem, options?: { anyway?: boolean }) => inboxRef.current?.approve(item, options) ?? Promise.resolve(), []);
  const finish = useCallback((item: InboxItem) => inboxRef.current?.finish(item) ?? Promise.resolve(), []);
  const reject = useCallback((item: InboxItem) => inboxRef.current?.reject(item) ?? Promise.resolve(), []);
  const rejectAllFrom = useCallback((linkId: string) => inboxRef.current?.rejectAllFrom(linkId) ?? Promise.resolve(), []);

  const current = snapshot.key === sessionKey ? snapshot.data : EMPTY;
  return useMemo(
    () => ({ ...current, refreshCount, load, loadDetail, approve, finish, reject, rejectAllFrom }),
    [current, refreshCount, load, loadDetail, approve, finish, reject, rejectAllFrom],
  );
}
