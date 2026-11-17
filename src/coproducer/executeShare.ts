/**
 * Approving a co-producer's share: the owner's app does what the co-producer
 * asked to do, on the owner's own data, and hands back only the result.
 *
 * Copying text and opening an email need nothing from the owner's app: the
 * card shows the whole text, every recipient, the subject and the body, and
 * approval lets the co-producer's app do it. A link is different. A
 * co-producer never holds a link's token or key (their view has them
 * redacted), so approving a link share makes the link here, or looks up the
 * one already sent, and the URL goes back to them in the approval's result.
 * Whoever holds that URL can sign, answer or follow the show until the owner
 * withdraws that link, even after the co-producer's own access ends, so
 * each such approval asks first, says so, and is recorded (a handout) so it
 * can be withdrawn later.
 *
 * Every name and item comes from the owner's own data, by id. The only words
 * of the co-producer's that reach anyone are a new signer's name and email,
 * which the owner sees marked as typed by them before approving.
 */
import type { ConfirmOptions } from '../components/useConfirm';
import type { AppSettings, ProfileRequest, Show, SignatureRequest } from '../types';
import { alreadyPending, sendForSignature, signingUrl } from '../utils/contracts';
import { showContextForSigner } from '../utils/contractShow';
import { generateId } from '../utils/id';
import { publishLiveView } from '../utils/liveView';
import { createProfileLink, profileUrl } from '../utils/profileLink';
import type { SessionCredentials } from '../utils/session-vault';
import { ensureViewerKey, viewerUrl } from '../utils/viewerAudio';
import { scheduledViewerPayload } from '../utils/viewerPayload';
import { visibleText } from './diff';
import type { OwnerState } from './redaction';
import type { ApprovalResult, HandoutRefs, ShareAction } from './types';

export interface ShareContext { session: SessionCredentials; state: OwnerState; origin: string; producerLocked: boolean }

export type ShareEffect =
  | { kind: 'add-signature-request'; request: SignatureRequest }
  | { kind: 'add-profile-request'; request: ProfileRequest }
  | { kind: 'viewer-link'; showId: string; viewToken: string; viewerKey: string };

export type ShareExecution =
  | { ok: true; result: ApprovalResult; effect?: ShareEffect; handout?: HandoutRefs }
  | { ok: false; reason: string };

function settingsOf(ctx: ShareContext): AppSettings {
  return ctx.state.settings;
}

function words(value: string | undefined | null): string {
  return visibleText((value ?? '').trim());
}

function contractById(ctx: ShareContext, id: string) {
  return (settingsOf(ctx).contracts ?? []).find((contract) => contract.id === id);
}

function comicById(ctx: ShareContext, id: string | undefined) {
  return id === undefined ? undefined : (settingsOf(ctx).potentialComics ?? []).find((comic) => comic.id === id);
}

function showById(ctx: ShareContext, id: string): Show | undefined {
  return ctx.state.shows.find((show) => show.id === id);
}

function signatureRequestsByIds(ctx: ShareContext, ids: string[]): SignatureRequest[] {
  const wanted = new Set(ids);
  return (settingsOf(ctx).signatureRequests ?? []).filter((request) => wanted.has(request.id));
}

function profileRequestById(ctx: ShareContext, id: string): ProfileRequest | undefined {
  return (settingsOf(ctx).profileRequests ?? []).find((request) => request.id === id);
}

/** A deleted contract's name, from the links it was sent with, when any are left. */
function goneContractName(ctx: ShareContext, id: string): string | null {
  const sent = (settingsOf(ctx).signatureRequests ?? []).find((request) => request.contractId === id);
  return sent ? words(sent.contractName) : null;
}

function goneShowName(ctx: ShareContext, id: string): string | null {
  const trashed = (settingsOf(ctx).trash ?? []).find((item) => item?.data?.id === id);
  return trashed ? words(trashed.data.name) : null;
}

/** Why Approve is unavailable right now, or null. Checked before the button is shown and again before anything is made. */
export function shareBlocker(action: ShareAction, ctx: ShareContext): string | null {
  switch (action.type) {
    case 'copy-text':
    case 'email':
      return null;
    case 'signing-link': {
      if (!contractById(ctx, action.contractId)) {
        const name = goneContractName(ctx, action.contractId);
        return name ? `The contract “${name}” has been deleted.` : 'That contract has been deleted.';
      }
      if (ctx.producerLocked) return 'Sending contracts is part of the Producer plan.';
      return null;
    }
    case 'existing-signing-link':
      return signatureRequestsByIds(ctx, action.requestIds).length === 0 ? 'Those links have been withdrawn.' : null;
    case 'profile-link':
      return comicById(ctx, action.contactId) ? null : 'That person is no longer in your Rolodex.';
    case 'existing-profile-link':
      return profileRequestById(ctx, action.requestId) ? null : 'That details link has been withdrawn.';
    case 'viewer-link': {
      const show = showById(ctx, action.showId);
      if (!show) {
        const name = goneShowName(ctx, action.showId);
        return name ? `“${name}” has been deleted.` : 'That show has been deleted.';
      }
      if (!show.viewToken && ctx.producerLocked) return 'Making a viewer link is part of the Producer plan.';
      return null;
    }
  }
}

const APPROVE_LINK: Pick<ConfirmOptions, 'confirmLabel' | 'danger'> = { confirmLabel: 'Approve', danger: false };

function signerLine(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'them';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The confirm a link share needs before Approve, or null for copying text and
 * opening an email: what the link lets its holder do, and that it outlives
 * the co-producer's own access.
 */
export function shareWarning(action: ShareAction, who: string, ctx: ShareContext): ConfirmOptions | null {
  const them = words(who) || 'Your co-producer';
  switch (action.type) {
    case 'copy-text':
    case 'email':
      return null;
    case 'signing-link': {
      const contract = words(contractById(ctx, action.contractId)?.name) || 'this contract';
      const signer = words(action.signer.name) || 'the signer';
      return {
        ...APPROVE_LINK,
        title: 'Give them a signing link?',
        message: `Give ${them} a signing link for ${signer}? Whoever has it can sign “${contract}” as ${signer}, and what they send is filed in your account. It keeps working after you withdraw ${them}'s access, until you withdraw the link.`,
      };
    }
    case 'existing-signing-link': {
      const requests = signatureRequestsByIds(ctx, action.requestIds);
      if (requests.length === 1) {
        const [request] = requests;
        const signer = words(request.signerName) || 'the signer';
        return {
          ...APPROVE_LINK,
          title: 'Give them a signing link?',
          message: `Give ${them} ${signer}'s signing link for “${words(request.contractName)}”? Whoever has it can sign it as ${signer}, and what they send is filed in your account. It keeps working after you withdraw ${them}'s access, until you withdraw the link.`,
        };
      }
      const names = requests.map((request) => words(request.signerName) || 'a signer');
      return {
        ...APPROVE_LINK,
        title: 'Give them signing links?',
        message: `Give ${them} the signing links for ${signerLine(names)}? Whoever has one can sign as that person, and what they send is filed in your account. They keep working after you withdraw ${them}'s access, until you withdraw the links.`,
      };
    }
    case 'profile-link':
    case 'existing-profile-link': {
      const name = action.type === 'profile-link'
        ? words(comicById(ctx, action.contactId)?.name)
        : words(profileRequestById(ctx, action.requestId)?.personName);
      const person = name || 'them';
      return {
        ...APPROVE_LINK,
        title: 'Give them a details link?',
        message: `Give ${them} a details link for ${person}? Whoever has it can answer it as ${person}, and what they send is filed in your account. It keeps working after you withdraw ${them}'s access, until you withdraw the link.`,
      };
    }
    case 'viewer-link': {
      const show = words(showById(ctx, action.showId)?.name) || 'this show';
      return {
        ...APPROVE_LINK,
        title: 'Give them the viewer link?',
        message: `Give ${them} the viewer link for “${show}”? Anyone with it can follow the show's public running order until you withdraw it.`,
      };
    }
  }
}

/**
 * The extra confirm a new signing link needs when the signer already has an
 * unsigned one for the same contract, asked before shareWarning. Null
 * otherwise.
 */
export function shareDuplicateWarning(action: ShareAction, ctx: ShareContext): ConfirmOptions | null {
  if (action.type !== 'signing-link') return null;
  const contactId = comicById(ctx, action.signer.contactId)?.id;
  if (!alreadyPending(settingsOf(ctx).signatureRequests ?? [], action.contractId, action.signer.name, contactId)) return null;
  const signer = words(action.signer.name) || 'They';
  return {
    message: `${signer} already has an unsigned link for this contract. Sending again makes a second link, and whichever one they open first is the one that counts.`,
    confirmLabel: 'Send anyway',
    danger: false,
  };
}

function link(label: string, url: string) {
  return { label, url };
}

/**
 * Do what the share asks, on the owner's own data. A link the owner's app
 * makes comes back as an effect to file in the owner's settings or show
 * before anything else happens, so a link never exists that the owner can't
 * see or withdraw.
 */
export async function executeShare(action: ShareAction, ctx: ShareContext): Promise<ShareExecution> {
  const blocked = shareBlocker(action, ctx);
  if (blocked) return { ok: false, reason: blocked };
  const settings = settingsOf(ctx);
  switch (action.type) {
    case 'copy-text':
    case 'email':
      return { ok: true, result: {} };
    case 'signing-link': {
      const contract = contractById(ctx, action.contractId)!;
      const name = action.signer.name.trim();
      const email = action.signer.email?.trim() || undefined;
      // Filed against a Rolodex entry only when that entry is still here.
      const contactId = comicById(ctx, action.signer.contactId)?.id;
      const request = await sendForSignature(
        contract,
        { name, email, contactId },
        settings.brandName,
        ctx.session,
        showContextForSigner(ctx.state.shows, name),
      );
      return {
        ok: true,
        effect: { kind: 'add-signature-request', request },
        result: { links: [link(`“${contract.name}” for ${request.signerName}`, signingUrl(ctx.origin, request.token, request.key))] },
        handout: { links: [{ kind: 'signature', requestId: request.id }] },
      };
    }
    case 'existing-signing-link': {
      const requests = signatureRequestsByIds(ctx, action.requestIds);
      const links = requests.map((request) => link(`“${request.contractName}” for ${request.signerName}`, signingUrl(ctx.origin, request.token, request.key)));
      const result: ApprovalResult = { links };
      if (requests.length > 1) {
        result.text = requests.map((request) => `${request.signerName} — ${signingUrl(ctx.origin, request.token, request.key)}`).join('\n');
      }
      return {
        ok: true,
        result,
        handout: { links: requests.map((request) => ({ kind: 'signature' as const, requestId: request.id })) },
      };
    }
    case 'profile-link': {
      const comic = comicById(ctx, action.contactId)!;
      const request = await createProfileLink({ name: comic.name, contactId: comic.id }, settings.brandName, ctx.session);
      return {
        ok: true,
        effect: { kind: 'add-profile-request', request },
        result: { links: [link(`Details link for ${request.personName}`, profileUrl(ctx.origin, request.token, request.key))] },
        handout: { links: [{ kind: 'profile', requestId: request.id }] },
      };
    }
    case 'existing-profile-link': {
      const request = profileRequestById(ctx, action.requestId)!;
      return {
        ok: true,
        result: { links: [link(`Details link for ${request.personName}`, profileUrl(ctx.origin, request.token, request.key))] },
        handout: { links: [{ kind: 'profile', requestId: request.id }] },
      };
    }
    case 'viewer-link': {
      const show = showById(ctx, action.showId)!;
      const label = `Viewer link for “${show.name}”`;
      const handout: HandoutRefs = { links: [{ kind: 'viewer', showId: show.id }] };
      if (show.viewToken) {
        const key = ensureViewerKey(show.viewToken, show.viewerKey);
        return {
          ok: true,
          result: { links: [link(label, viewerUrl(ctx.origin, show.viewToken, key))] },
          // A link from before keys travelled with the show gets its key filed.
          ...(show.viewerKey ? {} : { effect: { kind: 'viewer-link' as const, showId: show.id, viewToken: show.viewToken, viewerKey: key } }),
          handout,
        };
      }
      // As the show page makes one: the link is kept only once its first
      // publish has landed, so nobody else can claim the token first.
      const token = generateId();
      await publishLiveView(token, scheduledViewerPayload(show, show.viewNote), ctx.session);
      const key = ensureViewerKey(token);
      return {
        ok: true,
        effect: { kind: 'viewer-link', showId: show.id, viewToken: token, viewerKey: key },
        result: { links: [link(label, viewerUrl(ctx.origin, token, key))] },
        handout,
      };
    }
  }
}
