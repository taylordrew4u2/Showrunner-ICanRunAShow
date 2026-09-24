import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppSettings,
  Contract,
  ContractField,
  PotentialComic,
  Show,
  SignatureRequest,
} from '../types';
import {
  alreadyPending,
  contractNameFromFile,
  newContractField,
  refreshSignatures,
  requestsForContract,
  revokeSignature,
  sendForSignature,
  shortHash,
  signatureSummary,
  signingUrl,
  suggestedFields,
  isInstagramField,
  withInstagramField,
} from '../utils/contracts';
import { generateId } from '../utils/id';
import { dataUrlToFile } from '../utils/media';
import { uploadMedia, deleteMedia, isMediaRef } from '../utils/mediaStore';
import { rolodexKey, resolvePerformerComic } from '../utils/rolodex';
import { showContextForSigner } from '../utils/contractShow';
import {
  applyProfileChanges,
  describeChanges,
  fillRolodexFromSignatures,
  profileChanges,
  profileFromAnswers,
  signatureVisitPatch,
  type ProfileChange,
} from '../utils/signatureImport';
import { fileSignedHeadshots } from '../utils/signedHeadshots';
import { useMediaUrl } from '../utils/useMediaUrl';
import type { SessionCredentials } from '../utils/session-vault';
import { getRolodexTerm } from '../utils/terminology';
import { PageHeader } from './PageHeader';
import { useConfirm } from './useConfirm';
import './Contracts.css';

/**
 * The face they sent, whether it is still the data URL on the record or has
 * already been filed into the store. It used to vanish from the offer the
 * moment it was filed, leaving a sentence about a photo and no photo.
 */
function SentHeadshot({ src, alt }: { src: string; alt: string }) {
  const url = useMediaUrl(src);
  return url ? <img src={url} alt={alt} /> : null;
}

interface ContractsProps {
  settings: AppSettings;
  session: SessionCredentials;
  /**
   * The producer's shows, so a contract sent from here still knows which night
   * it is for. See showContextForSigner.
   */
  shows?: Show[];
  onBack: () => void;
  /** What the back control returns to. */
  backLabel?: string;
  onUpdateSettings: (settings: AppSettings) => void;
}

// A contract is a document, not a media library. Refused before the upload
// rather than after, so nobody waits through a long encrypt for a rejection.
const MAX_BYTES = 20 * 1024 * 1024;

// The share sheet is the natural way to hand someone a link on a phone, and
// absent on most desktop browsers. Checked once rather than at each call site.
const CAN_SHARE = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Contracts({ settings, session, shows, onBack, backLabel = 'Shows', onUpdateSettings }: ContractsProps) {
  const { confirm, confirmDialog } = useConfirm();
  const fileInput = useRef<HTMLInputElement>(null);

  const contracts = settings.contracts ?? [];
  const requests = useMemo(() => settings.signatureRequests ?? [], [settings.signatureRequests]);
  const rolodexTerm = getRolodexTerm(settings);

  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** Whose signing link is spelled out on the row, for pasting by hand. */
  const [shownLink, setShownLink] = useState<string | null>(null);
  /** The whole outstanding list, spelled out, after a copy-all. */
  const [allLinks, setAllLinks] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [manualName, setManualName] = useState('');
  const [editingFields, setEditingFields] = useState(false);
  // Details the producer has waved off, keyed `${token}:${field}`. Held in
  // state rather than filed, because declining is about this one import.
  const [declined, setDeclined] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<string | null>(null);

  const open = contracts.find((c) => c.id === openId) ?? null;
  const summary = signatureSummary(requests);
  /**
   * Everyone who still owes a signature, newest first, across every contract.
   *
   * Across every contract on purpose: "who have I not heard back from" is one
   * question a producer asks about a night, and answering it used to mean
   * opening each agreement in turn and reading down its list.
   */
  const outstanding = requests
    .filter((r) => !r.signed)
    .slice()
    .sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));

  /**
   * Look for signatures that landed while we were away.
   *
   * Nobody tells the app when a contract is signed — the signer's browser
   * writes to a row keyed by their token and walks off. So the one moment we
   * can reasonably check is when the producer opens this page, which is also
   * the moment they came here to ask the question.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const updated = await refreshSignatures(requests);
      if (cancelled) return;
      const next = updated ?? requests;
      const filed = await fileSignedHeadshots(next, settings.potentialComics ?? [], uploadMedia);
      if (cancelled) return;

      // Then the answers. Gaps only — a field the producer has already filled
      // in is never overwritten by a form, so a conflict is still theirs to
      // settle in the offer below.
      const filledComics = fillRolodexFromSignatures(
        filed?.signatureRequests ?? next,
        filed?.potentialComics ?? settings.potentialComics ?? [],
        rolodexKey,
        generateId,
      );

      const patch = signatureVisitPatch(updated, filed, filledComics);
      if (patch) onUpdateSettings({ ...settings, ...patch });
    })();
    return () => { cancelled = true; };
    // Deliberately on mount only: re-running on every settings write would
    // loop, since finding a signature writes settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError('Contracts need to be PDFs. Export or print your document to PDF first.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(`That file is ${fmtSize(file.size)}. The limit is 20 MB.`);
      return;
    }
    setError(null);
    setBusy('upload');
    try {
      const fileRef = await uploadMedia(file);
      const contract: Contract = {
        id: generateId(),
        name: contractNameFromFile(file.name),
        fileRef,
        fileName: file.name,
        sizeBytes: file.size,
        uploadedAt: new Date().toISOString(),
        // A sensible starting list — most agreements want at least a stage
        // name and a credit line, and unwanted rows are one tap to remove.
        fields: suggestedFields(),
      };
      onUpdateSettings({ ...settings, contracts: [contract, ...contracts] });
    } catch {
      setError('That upload did not finish. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function handleSend(name: string, email?: string, contactId?: string) {
    if (!open) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (alreadyPending(requests, open.id, trimmed, contactId)) {
      const go = await confirm({
        message: `${trimmed} already has an unsigned link for this contract. Sending again makes a second link, and whichever one they open first is the one that counts.`,
        confirmLabel: 'Send anyway',
        danger: false,
      });
      if (!go) return;
    }
    setError(null);
    setBusy(trimmed);
    try {
      const request = await sendForSignature(
        open,
        { name: trimmed, email, contactId },
        settings.brandName,
        session,
        showContextForSigner(shows, trimmed),
      );
      onUpdateSettings({ ...settings, signatureRequests: [request, ...requests] });
      setManualName('');
      setPicking(false);
      // Straight to the link — the producer's next move is always to send it.
      await copyLink(request);
    } catch {
      setError('That did not send. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  async function copyLink(request: SignatureRequest) {
    const url = signingUrl(window.location.origin, request.token, request.key);
    // Shown on the row from here on, whatever the share sheet or the clipboard
    // then does. A link the producer cannot see is a link they cannot check,
    // and the whole failure this guards against was invisible from in here:
    // the link left correctly and the performer still landed somewhere else.
    setShownLink(request.token);
    try {
      if (CAN_SHARE) {
        // Title and URL only. A `text` alongside them is not an addition —
        // share targets pick between the members they support, and the ones
        // that take only text send that sentence and drop the link, which
        // reads as a contract that was sent and never arrived.
        await navigator.share({ title: request.contractName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(request.token);
      setTimeout(() => setCopied((c) => (c === request.token ? null : c)), 2000);
    } catch {
      // A cancelled share sheet is not a failure, and a blocked clipboard is
      // recoverable — the link is on the row either way.
    }
  }

  /**
   * Every outstanding link at once, as `Name — address` lines.
   *
   * Chasing signatures is a pass through a list of people, not one person, and
   * the producer was left holding that list in their head. It also covers the
   * case where a link went out and did not arrive as a link: the address is
   * rebuilt from the token here and now, so copying always gives the current
   * one, and re-sending is a paste rather than a hunt.
   */
  async function copyAllLinks(list: SignatureRequest[]) {
    const text = list
      .map((r) => `${r.signerName} — ${signingUrl(window.location.origin, r.token, r.key)}`)
      .join('\n');
    // Shown as well as copied: a clipboard that silently failed is how a
    // producer ends up sending nothing and believing they sent everything.
    setAllLinks(text);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('all');
      setTimeout(() => setCopied((c) => (c === 'all' ? null : c)), 2000);
    } catch {
      /* the list is on screen either way */
    }
  }

  async function handleRevoke(request: SignatureRequest) {
    const go = await confirm({
      message: request.signed
        ? `Delete the signed record for ${request.signerName}? The signature and the copy they agreed to are both removed, and this cannot be undone.`
        : `Withdraw ${request.signerName}'s link? It stops working straight away.`,
      confirmLabel: request.signed ? 'Delete record' : 'Withdraw',
      danger: true,
    });
    if (!go) return;
    try {
      await revokeSignature(request, session);
    } catch {
      // The row may already be gone; drop it locally regardless so the list
      // does not keep showing a link the producer has decided is dead.
    }
    onUpdateSettings({
      ...settings,
      signatureRequests: requests.filter((r) => r.token !== request.token),
    });
  }

  async function handleDeleteContract(contract: Contract) {
    const sent = requestsForContract(requests, contract.id);
    const go = await confirm({
      message: sent.length
        ? `Delete "${contract.name}"? ${sent.length} ${sent.length === 1 ? 'link' : 'links'} sent for it stop working, including any signatures on file.`
        : `Delete "${contract.name}"?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!go) return;
    for (const request of sent) {
      try { await revokeSignature(request, session); } catch { /* already gone */ }
    }
    deleteMedia(contract.fileRef);
    onUpdateSettings({
      ...settings,
      contracts: contracts.filter((c) => c.id !== contract.id),
      signatureRequests: requests.filter((r) => r.contractId !== contract.id),
    });
    setOpenId(null);
  }

  /** Save an edited question list onto the open contract. */
  function updateFields(contract: Contract, fields: ContractField[]) {
    // The Instagram question is put back if an edit loses it, so what is saved
    // here matches what the signer will actually be asked.
    const kept = withInstagramField(fields);
    onUpdateSettings({
      ...settings,
      contracts: contracts.map((c) => (c.id === contract.id ? { ...c, fields: kept } : c)),
    });
  }

  /**
   * What a signed contract could add to the signer's Rolodex entry.
   *
   * The signer answered these questions themselves, which makes this the most
   * reliable version of their details the app will ever hold — and the only
   * moment it gets them without a form to send and chase. Matched by the
   * Rolodex entry the contract was sent to, falling back to the name, since a
   * contract typed out by hand still belongs to a person you know.
   */
  function pendingImport(request: SignatureRequest): {
    entry: PotentialComic | null;
    changes: ProfileChange[];
    /** A headshot they sent in that isn't on their profile yet. */
    headshot?: string;
  } {
    if (!request.signed) return { entry: null, changes: [] };
    const comics = settings.potentialComics ?? [];
    const entry = resolvePerformerComic({ id: '', comicId: request.contactId, name: request.signerName }, comics) ?? null;
    const all = profileChanges(entry ?? undefined, profileFromAnswers(request.signed.fields));
    // Always offered, never applied on its own: where the entry has no
    // picture the refresh has already filed it, and where it has one this is
    // the producer's choice to replace it. Hiding it whenever the entry had
    // any photo at all meant a headshot someone sent to replace an old one
    // was never seen.
    const headshot =
      request.signed.headshot && !declined.has(`${request.token}:photo`)
        ? request.signed.headshot
        : undefined;
    return {
      entry,
      changes: all.filter((c) => !declined.has(`${request.token}:${c.key}`)),
      headshot,
    };
  }

  /** File the accepted details, creating the entry when there isn't one yet. */
  async function saveToProfile(request: SignatureRequest) {
    const { entry, changes, headshot } = pendingImport(request);
    if (changes.length === 0 && !headshot) return;

    // The headshot arrives as a data URL on the signed record — the signer has
    // no media store of their own. Filing it means putting it into the
    // producer's, where every other photo in the app lives.
    let photoRef: string | undefined;
    let photoFailed = false;
    if (isMediaRef(headshot)) {
      // Already filed — this is the copy in the store, so reuse it rather than
      // uploading the same face a second time.
      photoRef = headshot;
    } else if (headshot) {
      try {
        const file = dataUrlToFile(headshot, `${request.signerName.trim() || 'headshot'}.jpg`);
        // A photo that will not decode is a failure too, not a no-op: saying
        // nothing would leave the producer believing the flyer has a face.
        if (!file) photoFailed = true;
        else photoRef = await uploadMedia(file);
      } catch {
        photoFailed = true;
      }
    }

    const withPhoto = (person: PotentialComic): PotentialComic =>
      photoRef ? { ...person, photo: photoRef } : person;

    const comics = settings.potentialComics ?? [];
    const nextComics = entry
      ? comics.map((c) => (c.id === entry.id ? withPhoto(applyProfileChanges(c, changes)) : c))
      : [
          ...comics,
          withPhoto(
            applyProfileChanges({ id: generateId(), name: request.signerName.trim() }, changes),
          ),
        ];
    onUpdateSettings({ ...settings, potentialComics: nextComics });

    // Said after the save, not before it: the old message asserted "the details
    // were saved" while the save had yet to happen. The details are safe either
    // way — only the photo is missing, and re-importing is how you retry it.
    setError(
      photoFailed
        ? `${request.signerName}'s details were saved, but their photo could not be stored.`
        : null,
    );
    setImported(request.token);
    setTimeout(() => setImported((t) => (t === request.token ? null : t)), 2500);
  }

  // People from the Rolodex who have not already signed this one.
  const candidates = useMemo(() => {
    if (!open) return [];
    const done = new Set(
      requestsForContract(requests, open.id).map((r) => rolodexKey(r.signerName)),
    );
    return (settings.potentialComics ?? [])
      .filter((c) => c.name.trim() && !done.has(rolodexKey(c.name)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [open, requests, settings.potentialComics]);

  /**
   * The details a signature brought in, offered rather than applied.
   *
   * Shown right under the answers, because that is where the producer is
   * already looking when a contract comes back, and because seeing "Phone:
   * empty → 555 0142" is the whole argument for pressing the button.
   */
  function ImportOffer({ request }: { request: SignatureRequest }) {
    const { entry, changes, headshot } = pendingImport(request);
    if (imported === request.token) {
      return <p className="contracts__import contracts__import--done">Saved to their profile</p>;
    }
    if (changes.length === 0 && !headshot) return null;
    return (
      <div className="contracts__import">
        <p className="contracts__import-head">
          {entry
            ? `Their ${rolodexTerm.singular.toLowerCase()} profile: ${
                changes.length === 0
                  ? entry.photo ? 'a new headshot' : 'a photo to add'
                  : describeChanges(changes)
              }`
            : `Not in your ${rolodexTerm.plural} yet — saving files them with what they sent`}
        </p>
        {/* The photo is the one thing you can judge at a glance, so it is
            shown rather than described. */}
        {headshot && (
          <div className="contracts__import-photo">
            <SentHeadshot src={headshot} alt={`Headshot sent by ${request.signerName}`} />
            <span>
              {entry?.photo
                ? 'They sent a new headshot — saving replaces the one on their profile'
                : 'They sent a headshot for the flyer'}
            </span>
            <button
              className="btn btn--ghost btn--sm contracts__import-skip"
              onClick={() => setDeclined((d) => new Set(d).add(`${request.token}:photo`))}
              aria-label="Leave their photo out"
            >
              Skip
            </button>
          </div>
        )}
        <ul className="contracts__import-list">
          {changes.map((c) => (
            <li key={c.key} className="contracts__import-item">
              <span className="contracts__import-label">{c.label}</span>
              {c.from && <span className="contracts__import-was">{c.from}</span>}
              <span className="contracts__import-new">{c.to}</span>
              <button
                className="btn btn--ghost btn--sm contracts__import-skip"
                onClick={() =>
                  setDeclined((d) => new Set(d).add(`${request.token}:${c.key}`))
                }
                aria-label={`Leave ${c.label} as it is`}
              >
                Skip
              </button>
            </li>
          ))}
        </ul>
        <button className="btn btn--secondary btn--sm" onClick={() => void saveToProfile(request)}>
          {entry ? 'Save to profile' : `Add to ${rolodexTerm.plural}`}
        </button>
      </div>
    );
  }

  // ── One contract, opened ───────────────────────────────────────────────────
  if (open) {
    const sent = requestsForContract(requests, open.id);
    const openSummary = signatureSummary(sent);
    const openFields = withInstagramField(open.fields);
    return (
      <div className="page contracts">
        <PageHeader
          title={open.name}
          subtitle={
            sent.length === 0
              ? 'Not sent to anyone yet'
              : `${openSummary.signed} of ${openSummary.total} signed`
          }
          onBack={() => { setOpenId(null); setPicking(false); setEditingFields(false); }}
          backLabel="Contracts"
        />

        {error && <p className="contracts__error" role="alert">{error}</p>}

        <div className="contracts__send">
          {!picking ? (
            <button className="btn btn--primary contracts__send-btn" onClick={() => setPicking(true)}>
              Send for signature
            </button>
          ) : (
            <div className="contracts__picker">
              <div className="contracts__picker-head">
                <h2>Who needs to sign it?</h2>
                <button className="btn btn--ghost btn--sm" onClick={() => setPicking(false)}>Done</button>
              </div>

              <div className="contracts__manual">
                <input
                  type="text"
                  value={manualName}
                  placeholder="Type a name"
                  onChange={(e) => setManualName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSend(manualName); }}
                />
                <button
                  className="btn btn--primary btn--sm"
                  disabled={!manualName.trim() || busy !== null}
                  onClick={() => handleSend(manualName)}
                >
                  Send
                </button>
              </div>

              {candidates.length > 0 && (
                <>
                  <p className="contracts__picker-label">From your {rolodexTerm.plural.toLowerCase()}</p>
                  <div className="contracts__candidates">
                    {candidates.map((c) => (
                      <button
                        key={c.id}
                        className="contracts__candidate"
                        disabled={busy !== null}
                        onClick={() => handleSend(c.name, c.email, c.id)}
                      >
                        <span className="contracts__candidate-name">{c.name}</span>
                        {busy === c.name.trim() ? (
                          <span className="contracts__candidate-hint">Sending…</span>
                        ) : (
                          <span className="contracts__candidate-hint">Send</span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <section className="contracts__fields">
          <div className="contracts__fields-head">
            <h2 className="contracts__section-label">What the signer fills in</h2>
            <button className="btn btn--ghost btn--sm" onClick={() => setEditingFields((v) => !v)}>
              {editingFields ? 'Done' : 'Edit'}
            </button>
          </div>
          <p className="contracts__fields-note">
            Everyone is asked for their name and their Instagram handle. Add anything else this
            agreement needs — a stage name, how they want to be credited, a payout address.
            Changes apply to links you send from now on.
          </p>

          {editingFields ? (
            <>
              <div className="contracts__field-rows">
                {(openFields).map((f, i) => (
                  <div key={f.id} className="contracts__field-row">
                    <input
                      type="text"
                      value={f.label}
                      placeholder="What to ask for"
                      onChange={(e) =>
                        updateFields(
                          open,
                          openFields.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                        )
                      }
                    />
                    {/* The Instagram row stays required: a signature with no
                        handle to tag means looking the performer up and
                        guessing. */}
                    <label className="contracts__field-toggle">
                      <input
                        type="checkbox"
                        checked={!!f.required}
                        disabled={isInstagramField(f)}
                        onChange={(e) =>
                          updateFields(
                            open,
                            openFields.map((x, j) =>
                              j === i ? { ...x, required: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      <span>Required</span>
                    </label>
                    <label className="contracts__field-toggle">
                      <input
                        type="checkbox"
                        checked={!!f.multiline}
                        onChange={(e) =>
                          updateFields(
                            open,
                            openFields.map((x, j) =>
                              j === i ? { ...x, multiline: e.target.checked } : x,
                            ),
                          )
                        }
                      />
                      <span>Long answer</span>
                    </label>
                    {isInstagramField(f) ? (
                      <span className="contracts__field-fixed">Always asked</span>
                    ) : (
                      <button
                        className="btn btn--ghost btn--sm"
                        aria-label={`Remove ${f.label || 'this question'}`}
                        onClick={() => updateFields(open, openFields.filter((_, j) => j !== i))}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => updateFields(open, [...openFields, newContractField()])}
              >
                Add a question
              </button>
            </>
          ) : (
            <ul className="contracts__field-list">
              {openFields.map((f) => (
                <li key={f.id}>
                  {f.label.trim() || 'Untitled question'}
                  {f.required && <span className="contracts__field-req"> · required</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {sent.length > 0 && (
          <section className="contracts__status">
            <h2 className="contracts__section-label">
              {openSummary.waiting > 0 ? `Waiting on ${openSummary.waiting}` : 'All signed'}
            </h2>
            <div className="contracts__rows">
              {sent.map((r) => (
                <div key={r.token} className="contracts__row">
                  <span
                    className={`contracts__mark${r.signed ? ' contracts__mark--signed' : ''}`}
                    aria-hidden="true"
                  />
                  <div className="contracts__row-who">
                    <span className="contracts__row-name">{r.signerName}</span>
                    <span className="contracts__row-meta">
                      {r.signed
                        ? `Signed ${fmtDate(r.signed.signedAt)} · ${shortHash(r.signed.documentHash)}`
                        : `Sent ${fmtDate(r.sentAt)}`}
                    </span>
                    {r.signed?.fields?.length ? (
                      <dl className="contracts__answers">
                        {r.signed.fields.map((f) => (
                          <div key={f.label} className="contracts__answer">
                            <dt>{f.label}</dt>
                            <dd>{f.value}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {r.signed ? <ImportOffer request={r} /> : null}
                    {!r.signed && shownLink === r.token && (
                      <p className="contracts__link">
                        <span className="contracts__link-note">
                          Send this exact link. Some apps turn a link into a preview card that
                          opens the site instead — if that happens, paste it as plain text.
                        </span>
                        <span className="contracts__link-url">
                          {signingUrl(window.location.origin, r.token, r.key)}
                        </span>
                        {/* Opening it only reads; a signature is still a name
                            typed and a box ticked, so checking a link cannot
                            spend it. Worth one tap before it goes to someone
                            you would rather not send a broken link to. */}
                        <a
                          className="contracts__link-check"
                          href={signingUrl(window.location.origin, r.token, r.key)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open it yourself to check it
                        </a>
                      </p>
                    )}
                  </div>
                  {!r.signed && (
                    <button className="btn btn--ghost btn--sm" onClick={() => copyLink(r)}>
                      {copied === r.token ? 'Copied' : CAN_SHARE ? 'Share' : 'Copy link'}
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => handleRevoke(r)}>
                    {r.signed ? 'Delete' : 'Withdraw'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        <button className="btn btn--ghost btn--sm contracts__delete" onClick={() => handleDeleteContract(open)}>
          Delete this contract
        </button>
        {confirmDialog}
      </div>
    );
  }

  // ── The library ────────────────────────────────────────────────────────────
  return (
    <div className="page contracts">
      <PageHeader
        title="Contracts"
        subtitle={
          summary.total === 0
            ? 'Agreements you send out to be signed'
            : `${summary.signed} signed · ${summary.waiting} waiting`
        }
        onBack={onBack}
        backLabel={backLabel}
        actions={
          <button
            className="btn btn--primary btn--sm"
            disabled={busy === 'upload'}
            onClick={() => fileInput.current?.click()}
          >
            {busy === 'upload' ? 'Adding…' : 'Add contract'}
          </button>
        }
      />
      <input
        ref={fileInput}
        type="file"
        accept="application/pdf,.pdf"
        className="contracts__file"
        onChange={handleUpload}
      />

      {error && <p className="contracts__error" role="alert">{error}</p>}

      {outstanding.length > 0 && (
        <section className="contracts__chase">
          <div className="contracts__chase-head">
            <h2 className="contracts__section-label">
              Waiting on {outstanding.length}
            </h2>
            <button
              className="btn btn--secondary btn--sm"
              onClick={() => copyAllLinks(outstanding)}
            >
              {copied === 'all' ? 'Copied' : `Copy all ${outstanding.length} links`}
            </button>
          </div>
          <div className="contracts__rows">
            {outstanding.map((r) => (
              <div key={r.token} className="contracts__row">
                <span className="contracts__mark" aria-hidden="true" />
                <div className="contracts__row-who">
                  <span className="contracts__row-name">{r.signerName}</span>
                  <span className="contracts__row-meta">
                    {r.contractName} · sent {fmtDate(r.sentAt)}
                  </span>
                </div>
                <button className="btn btn--ghost btn--sm" onClick={() => copyLink(r)}>
                  {copied === r.token ? 'Copied' : CAN_SHARE ? 'Send again' : 'Copy link'}
                </button>
              </div>
            ))}
          </div>
          {allLinks && (
            <p className="contracts__link">
              <span className="contracts__link-note">
                Copied. Paste these straight into your messages — send the whole address,
                including everything after the <code>#</code>.
              </span>
              <span className="contracts__link-url">{allLinks}</span>
            </p>
          )}
        </section>
      )}

      {contracts.length === 0 ? (
        <p className="contracts__empty">
          Add a PDF — a performer agreement, a photo release — then send it to anyone in
          your {rolodexTerm.plural.toLowerCase()} to sign. You will see here who has and who has not.
        </p>
      ) : (
        <div className="contracts__list">
          {contracts.map((c) => {
            const s = signatureSummary(requestsForContract(requests, c.id));
            return (
              <button key={c.id} className="contracts__item" onClick={() => setOpenId(c.id)}>
                <div className="contracts__item-main">
                  <span className="contracts__item-name">{c.name}</span>
                  <span className="contracts__item-meta">
                    {s.total === 0
                      ? `${fmtSize(c.sizeBytes)} · not sent yet`
                      : `${s.signed} of ${s.total} signed`}
                  </span>
                </div>
                {s.waiting > 0 && <span className="contracts__badge">{s.waiting}</span>}
                <svg className="contracts__chevron" viewBox="0 0 8 13" aria-hidden="true">
                  <path d="M1.5 1.5 6 6.5 1.5 11.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            );
          })}
        </div>
      )}
      {confirmDialog}
    </div>
  );
}
