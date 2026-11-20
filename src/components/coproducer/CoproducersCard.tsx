import { useState } from 'react';
import { createPortal } from 'react-dom';
import { canShareLinks, copyText, shareLink } from '../../coproducer/gates';
import { resolveHandouts, readHandoutRefs, type HandoutRef } from '../../coproducer/handouts';
import { coproduceConfigured } from '../../coproducer/origins';
import {
  createCoproducerLink,
  decryptUntrusted,
  dismissHandout,
  listCoproducerLinks,
  listHandouts,
  withdrawAllCoproducerLinks,
  withdrawCoproducerLink,
} from '../../coproducer/ownerClient';
import type { CoproducerLinkInfo } from '../../coproducer/types';
import { COPRODUCER_LIMITS } from '../../coproducer/types';
import type { OwnerDataApi } from '../../coproducer/useOwnerRequests';
import { ServerNotConfiguredError, type ApiError } from '../../utils/api';
import { decryptWithKeys } from '../../utils/encryption';
import { timeAgo } from '../../utils/relativeTime';
import type { SessionCredentials } from '../../utils/session-vault';
import { Modal } from '../Modal';
import './owner.css';

/**
 * Settings → Co-producers: give another producer a link to see everything,
 * with every change, link share, download, copy and print waiting for the
 * owner's approval; see who has a link and what they were given; withdraw it.
 *
 * Built like the AI assistants card beside it: the link list is loaded only
 * when asked for, so an offline Settings visit neither fails nor calls out.
 */

export const COPRODUCERS_TEXT = {
  hint: 'Give another producer a link to see everything in your account. Their changes, and any links they want to share, only happen if you approve them. Their downloads, copying and printing wait for you too, but anything they can see can still be saved by someone determined.',
  notConfigured: "Co-producer links aren't available on this version of the site.",
  consent:
    "Making a link sends the keys that unlock your account's data to our server, which uses them only while it serves this link. Whoever has the link can see all your shows, Rolodex, contracts, files and settings, but not your password, billing, AI connections or the secret parts of links you've sent. Our server makes sure their changes, and any links they ask to share, only go in if you approve them. The app also holds back their downloads, copying and printing until you approve, but anything on their screen can still be screenshotted or saved by someone determined. Withdrawing the link stops future access but can't take back what they've already seen, and links you approve for them keep working until you withdraw those links too.",
  makeFailed: "Couldn't make the link. Check your connection and try again.",
  tooMany: 'You already have 20 co-producer links. Withdraw one first.',
  withdrawFailed: "Couldn't withdraw that link. It still works. Try again.",
  listFailed: "Couldn't load your co-producer links. Check your connection and try again.",
} as const;

/** Make link is offered once there is a name and the box is ticked. */
// eslint-disable-next-line react-refresh/only-export-components
export function canMakeLink(name: string, understood: boolean): boolean {
  const trimmed = name.trim();
  return understood && trimmed.length > 0 && trimmed.length <= COPRODUCER_LIMITS.maxLabelChars;
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface Handout { id: string; linkId: string; name: string; links: HandoutRef[]; ended: boolean }

interface LinkRow { info: CoproducerLinkInfo; name: string }

function labelOf(session: SessionCredentials, cipher: string): string {
  try {
    const label = decryptWithKeys<unknown>(cipher, [session.key, session.legacyKey]);
    return typeof label === 'string' && label.trim() ? label.trim() : 'A co-producer';
  } catch {
    return 'A co-producer';
  }
}

interface WithdrawAsk {
  title: string;
  message: string;
  /** The checkbox's words, when they were given links. */
  alsoLinks?: string;
  run: (alsoLinks: boolean) => Promise<void>;
}

/** The withdraw confirm, with the "also withdraw the links they were given" box when there are any. */
function WithdrawDialog({ ask, onClose }: { ask: WithdrawAsk; onClose: () => void }) {
  const [alsoLinks, setAlsoLinks] = useState(false);
  return createPortal(
    <Modal onClose={onClose} labelledBy="coproducer-withdraw-title">
      <h2 className="confirm-dialog__title" id="coproducer-withdraw-title">{ask.title}</h2>
      <p className="confirm-dialog__message">{ask.message}</p>
      {ask.alsoLinks && (
        <label className="coproducers__check">
          <input type="checkbox" checked={alsoLinks} onChange={(event) => setAlsoLinks(event.target.checked)} />
          <span>{ask.alsoLinks}</span>
        </label>
      )}
      <div className="confirm-dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn--danger" onClick={() => { onClose(); void ask.run(alsoLinks); }}>Withdraw</button>
      </div>
    </Modal>,
    document.body,
  );
}

export function CoproducersCard({ session, data, onOpenRequests, onLinksChanged }: {
  session: SessionCredentials;
  data?: OwnerDataApi | null;
  onOpenRequests?: () => void;
  /** A link was made or withdrawn: the Requests badge and the More page look again. */
  onLinksChanged?: () => void;
}) {
  const [name, setName] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ name: string; url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [handouts, setHandouts] = useState<Handout[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ask, setAsk] = useState<WithdrawAsk | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const configured = typeof location !== 'undefined' && coproduceConfigured() && !unavailable;

  const owner = data ? { shows: data.shows(), settings: data.settings() } : null;
  const describe = (refs: HandoutRef[]) => (owner ? resolveHandouts([{ refs: { links: refs } }], owner).map((h) => h.text) : []);

  async function refresh() {
    const rows = await listCoproducerLinks(session);
    setLinks(rows.map((info) => ({ info, name: labelOf(session, info.labelCipher) })));
    try {
      const listed = await listHandouts(session);
      const read: Handout[] = [];
      for (const row of listed) {
        try {
          const refs = readHandoutRefs(decryptUntrusted(row.refsCipher, session));
          if (refs) read.push({ id: row.id, linkId: row.linkId, name: labelOf(session, row.labelCipher), links: refs.links, ended: row.linkEndedAt !== null });
        } catch {
          /* A record that can't be read is left out, not shown as nothing. */
        }
      }
      setHandouts(read);
    } catch {
      setHandouts([]);
    }
  }

  async function makeLink() {
    if (!canMakeLink(name, understood)) return;
    setMaking(true); setError(''); setNotice(''); setCopied(false);
    try {
      const result = await createCoproducerLink(session, name);
      setMade({ name: name.trim(), url: result.url, expiresAt: result.link.expiresAt });
      setName('');
      setUnderstood(false);
      onLinksChanged?.();
      if (links !== null) await refresh().catch(() => {});
    } catch (err) {
      if (err instanceof ServerNotConfiguredError) setUnavailable(true);
      else setError((err as ApiError)?.code === 'too_many_links' ? COPRODUCERS_TEXT.tooMany : COPRODUCERS_TEXT.makeFailed);
    } finally {
      setMaking(false);
    }
  }

  async function withdrawGiven(given: Handout[]) {
    if (!data || given.length === 0) return;
    const result = await data.withdrawHandout(given.flatMap((h) => h.links));
    for (const handout of given) await dismissHandout(session, handout.id).catch(() => {});
    if (result.skipped.length) setNotice((current) => `${current} Not withdrawn: ${result.skipped.join('; ')}.`.trim());
  }

  function askWithdraw(link: LinkRow) {
    const given = handouts.filter((h) => h.linkId === link.info.id);
    const count = given.reduce((n, h) => n + h.links.length, 0);
    setAsk({
      title: `Withdraw ${link.name}'s link?`,
      message: "They lose access straight away, and anything of theirs still waiting for approval is removed. What they've already seen can't be taken back.",
      alsoLinks: count > 0 && data ? `Also withdraw the ${count} link${count === 1 ? '' : 's'} they were given` : undefined,
      run: async (alsoLinks) => {
        setBusy(true); setError(''); setNotice('');
        try {
          await withdrawCoproducerLink(session, link.info.id);
          setNotice(`Withdrawn. ${link.name} can't open your account any more.`);
          onLinksChanged?.();
          if (alsoLinks) await withdrawGiven(given);
          await refresh().catch(() => setLinks((current) => (current ?? []).filter((row) => row.info.id !== link.info.id)));
        } catch {
          setError(COPRODUCERS_TEXT.withdrawFailed);
        } finally {
          setBusy(false);
        }
      },
    });
  }

  function askWithdrawAll() {
    const given = handouts.filter((h) => !h.ended);
    setAsk({
      title: 'Withdraw every co-producer link?',
      message: "They all lose access straight away, and anything still waiting for approval is removed. What they've already seen can't be taken back.",
      alsoLinks: given.length > 0 && data ? 'Also withdraw every link they were given' : undefined,
      run: async (alsoLinks) => {
        setBusy(true); setError(''); setNotice('');
        try {
          await withdrawAllCoproducerLinks(session);
          setNotice('Withdrawn. No co-producer can open your account now.');
          onLinksChanged?.();
          if (alsoLinks) await withdrawGiven(given);
          await refresh().catch(() => setLinks([]));
        } catch {
          setError(COPRODUCERS_TEXT.withdrawFailed);
        } finally {
          setBusy(false);
        }
      },
    });
  }

  const ended = handouts.filter((h) => h.ended);
  const endedByName = new Map<string, Handout[]>();
  for (const handout of ended) endedByName.set(handout.name, [...(endedByName.get(handout.name) ?? []), handout]);

  return (
    <section className="settings__card coproducers" data-tour="settings-coproducers" aria-labelledby="coproducers-heading">
      <h2 id="coproducers-heading" className="settings__card-title">Co-producers</h2>
      <p className="settings__hint">{COPRODUCERS_TEXT.hint}</p>
      {!configured ? (
        <p className="settings__hint" role="status">{COPRODUCERS_TEXT.notConfigured}</p>
      ) : (
        <>
          <label className="section-field">
            <span className="section-field__label">Their name</span>
            <input
              className="section-field__input"
              value={name}
              maxLength={COPRODUCER_LIMITS.maxLabelChars}
              placeholder="e.g. Sam Rivera"
              autoComplete="off"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <p className="settings__hint coproducers__consent">{COPRODUCERS_TEXT.consent}</p>
          <label className="coproducers__check">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
            <span>I understand what this shares</span>
          </label>
          <button type="button" className="btn btn--primary btn--sm" disabled={making || !canMakeLink(name, understood)} onClick={() => void makeLink()}>
            {making ? 'Making link…' : 'Make link'}
          </button>
          {made && (
            <div className="coproducers__made">
              <label className="section-field">
                <span className="section-field__label">Link for {made.name}</span>
                <input className="section-field__input" readOnly value={made.url} onFocus={(event) => event.target.select()} />
              </label>
              <div className="coproducers__actions">
                <button type="button" className="btn btn--secondary btn--sm" onClick={async () => {
                  try { await copyText(made.url); setCopied(true); }
                  catch { setCopied(false); setError('Select the link above and copy it.'); }
                }}>{copied ? 'Copied' : 'Copy link'}</button>
                {canShareLinks() && (
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => {
                    void shareLink(`A link for ${made.name}`, made.url).catch(() => setError('Select the link above and copy it.'));
                  }}>Share</button>
                )}
              </div>
              <p className="settings__hint">
                Send it only to {made.name}. It's shown once, so if it's lost, make a new one. It works until {longDate(made.expiresAt)} unless you withdraw it.
              </p>
            </div>
          )}
        </>
      )}
      <div className="coproducers__actions">
        <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={async () => {
          setBusy(true); setError(''); setNotice('');
          try { await refresh(); }
          catch { setError(COPRODUCERS_TEXT.listFailed); }
          finally { setBusy(false); }
        }}>{busy ? 'Working…' : links === null ? 'Manage links' : 'Refresh links'}</button>
        {onOpenRequests && <button type="button" className="btn btn--secondary btn--sm" onClick={onOpenRequests}>See requests</button>}
      </div>
      {links !== null && (
        links.length === 0 ? <p className="settings__hint" role="status">{notice || 'No co-producer has a link.'}</p> : (
          <>
            <ul className="coproducers__links">{links.map((link) => {
              const given = handouts.filter((h) => h.linkId === link.info.id);
              const givenRefs = given.flatMap((h) => h.links);
              return (
                <li key={link.info.id} className="coproducers__link">
                  <div className="coproducers__link-info">
                    <span className="coproducers__link-name">{link.name}</span>
                    <span className="coproducers__link-dates">
                      Made {longDate(link.info.createdAt)} · First opened {link.info.firstUsedAt ? longDate(link.info.firstUsedAt) : 'not yet'} · Last used {link.info.lastUsedAt ? timeAgo(Date.parse(link.info.lastUsedAt)) : 'not yet'} · Works until {longDate(link.info.expiresAt)}
                    </span>
                    <span className="coproducers__link-dates">Using {formatBytes(link.info.storageBytes)} for files and requests</span>
                    {link.info.openRequests > 0 && (
                      onOpenRequests
                        ? <button type="button" className="coproducers__waiting" onClick={onOpenRequests}>{link.info.openRequests} waiting</button>
                        : <span className="coproducers__link-dates">{link.info.openRequests} waiting</span>
                    )}
                    {givenRefs.length > 0 && (
                      <details className="coproducers__given">
                        <summary>Links they were given: {givenRefs.length}</summary>
                        <ul>{describe(givenRefs).map((text, i) => <li key={i}>{text}</li>)}</ul>
                      </details>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn--secondary btn--sm"
                    disabled={busy}
                    aria-label={`Withdraw ${link.name}'s link, made ${longDate(link.info.createdAt)}`}
                    onClick={() => askWithdraw(link)}
                  >Withdraw</button>
                </li>
              );
            })}</ul>
            {notice && <p className="settings__hint" role="status">{notice}</p>}
            <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={askWithdrawAll}>Withdraw all</button>
          </>
        )
      )}
      {endedByName.size > 0 && (
        <div className="coproducers__ended">
          <h3 className="coproducers__ended-title">Links given to co-producers who no longer have access</h3>
          {[...endedByName.entries()].map(([who, rows]) => {
            const refs = rows.flatMap((h) => h.links);
            return (
              <div key={who} className="coproducers__ended-group">
                <span className="coproducers__link-name">{who}</span>
                <ul>{describe(refs).map((text, i) => <li key={i}>{text}</li>)}</ul>
                <div className="coproducers__actions">
                  {data && (
                    <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={async () => {
                      setBusy(true); setError(''); setNotice('');
                      try {
                        await withdrawGiven(rows);
                        setHandouts((current) => current.filter((h) => !rows.includes(h)));
                        setNotice((current) => current || 'Withdrawn.');
                      } catch { setError(COPRODUCERS_TEXT.withdrawFailed); }
                      finally { setBusy(false); }
                    }}>Withdraw these links</button>
                  )}
                  <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={async () => {
                    setBusy(true);
                    try {
                      for (const handout of rows) await dismissHandout(session, handout.id);
                      setHandouts((current) => current.filter((h) => !rows.includes(h)));
                    } catch { setError(COPRODUCERS_TEXT.listFailed); }
                    finally { setBusy(false); }
                  }}>Keep them</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="settings__sweep-error" role="alert">{error}</p>}
      {ask && <WithdrawDialog ask={ask} onClose={() => setAsk(null)} />}
    </section>
  );
}
