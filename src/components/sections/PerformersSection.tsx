import { useState, useEffect, useMemo } from 'react';
import type { Performer, PotentialComic } from '../../types';
import { generateId } from '../../utils/id';
import { comicToPerformer, rolodexKey } from '../../utils/rolodex';
import { socialLink } from '../../utils/social';
import { LineupActions } from '../LineupActions';
import { lineupProgress } from '../../utils/lineupTarget';
import { describeGaps, lineupGaps } from '../../utils/performerReadiness';
import { PerformerProfile } from './PerformerProfile';
import { Icon } from '../Icon';
import type { SignerStatus } from '../../utils/contracts';

interface PerformersSectionProps {
  initialPerformerId?: string;
  performers: Performer[];
  potentialComics?: PotentialComic[];
  showName?: string;
  /** How many performers this show is booking for, if a target is set. */
  performerTarget?: number;
  onSaveToRolodex?: (comic: PotentialComic) => void;
  onChange: (performers: Performer[]) => void;
  onTargetChange: (target: number | undefined) => void;
  /** Contracts for the performer whose profile is open, when the app can send them. */
  renderContracts?: (performer: Performer) => React.ReactNode;
  /**
   * Where each performer stands on their paperwork, for the mark by their
   * name. Undefined when this show has no way to send contracts.
   */
  contractStatus?: (performer: Performer) => SignerStatus;
  /** Open the announcement composer. Absent when there is no show to announce. */
  onAnnounce?: () => void;
}

export function PerformersSection({
  initialPerformerId,
  performers,
  potentialComics = [],
  showName,
  performerTarget,
  onSaveToRolodex,
  onChange,
  onTargetChange,
  renderContracts,
  contractStatus,
  onAnnounce,
}: PerformersSectionProps) {
  const [name, setName] = useState('');
  const [instagram, setInstagram] = useState('');
  const [email, setEmail] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialPerformerId ?? null);
  const [showRolodex, setShowRolodex] = useState(false);
  /**
   * Whether the add-a-performer form is showing.
   *
   * It used to sit permanently above the lineup: a target field, three inputs
   * and two buttons — around 310px of form before the first name on the bill,
   * inside a section whose whole job is to show you the bill. Once there is
   * someone booked, the list leads and this folds away behind a button.
   *
   * Not initial state, because an empty lineup has nothing else to show: the
   * form stays open on its own until somebody is on it, and comes back if the
   * last performer is removed.
   */
  const [addingOpen, setAddingOpen] = useState(false);
  /**
   * Whether the handle and email fields are showing. Closed by default:
   * booking someone is a name, and both of these are on the profile editor a
   * tap away once they are on the bill.
   */
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Filing happens up in App, out of sight. Saying so once, right after it
  // happens, is the difference between a helpful default and the app quietly
  // editing a list you didn't ask it to touch.
  const [filed, setFiled] = useState<string | null>(null);

  const selectedPerformer = performers.find(p => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!filed) return;
    const timer = setTimeout(() => setFiled(null), 5000);
    return () => clearTimeout(timer);
  }, [filed]);

  function addPerformer() {
    if (!name.trim()) return;
    const p: Performer = {
      id: generateId(),
      name: name.trim(),
      socialMedia: instagram.trim() || undefined,
      email: email.trim() || undefined,
    };
    onChange([...performers, p]);
    // Stay open. Adding the first performer makes the list non-empty, which
    // would otherwise fold this form away mid-flow — you are usually booking
    // several people in a row, not one.
    setAddingOpen(true);
    // Read against the list as it stands *before* the save lands, which is
    // exactly what the filing upstream will compare against.
    const isNew = !potentialComics.some(c => rolodexKey(c.name) === rolodexKey(p.name));
    setFiled(isNew ? p.name : null);
    setName('');
    setInstagram('');
    setEmail('');
  }

  function addFromRolodex(comic: PotentialComic) {
    onChange([...performers, comicToPerformer(comic)]);
    setShowRolodex(false);
    setAddingOpen(true); // same reason as addPerformer: the flow isn't over
    setFiled(null); // they came from the Rolodex; nothing was filed
  }

  function updatePerformer(updated: Performer) {
    onChange(performers.map(p => p.id === updated.id ? updated : p));
    // keep selectedId so profile stays open with fresh data
  }

  function deletePerformer(id: string) {
    onChange(performers.filter(p => p.id !== id));
    setSelectedId(null);
  }

  // Reorder the lineup — the order shown here is the order the viewer link shows.
  function movePerformer(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= performers.length) return;
    const next = [...performers];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  // Shared with the show card on the grid so the two can't disagree about
  // whether a bill is full.
  const progress = lineupProgress(performers.length, performerTarget);

  // Who on the bill is missing something that will fail quietly later: no
  // address to send a contract to, no handle to tag in the announcement.
  // Asked of the whole lineup at once, because that is when it is fixable.
  const gaps = lineupGaps(performers);

  // Only where the producer uses contracts at all: an account with no
  // agreements uploaded has no way to sign anything, and telling them nobody
  // is booked would be a scold about a feature they have not opted into.
  const booking = contractStatus && performers.length > 0
    ? {
        signed: performers.filter((p) => contractStatus(p) === 'signed').length,
        total: performers.length,
      }
    : null;

  // Who is already filed, by the same name rule the rest of the app matches
  // people with — so "already in your Rolodex" means the same thing here as it
  // does when a contract comes back or someone is booked off the list.
  const filedInRolodex = useMemo(
    () => new Set((potentialComics ?? []).map((c) => rolodexKey(c.name))),
    [potentialComics],
  );

  const showAddForm = addingOpen || performers.length === 0;

  return (
    <div className="section-body">
      {/* No "No performers yet — add the first below." An empty lineup always
          opens with the add form showing (see showAddForm), so that line was
          120px of italics telling you that the empty field directly beneath it
          is empty. The field says it. */}

      <ul className="section-list">
        {performers.map((p, idx) => (
          <li key={p.id} className={`section-list-item ${selectedId === p.id ? 'section-list-item--active' : ''}`}>
            <div className="section-list-item__content">
              <div className="section-list-item__body">
                <span className="section-list-item__order">{idx + 1}</span>
                <span className="section-list-item__name">{p.name}</span>
                {/* Their paperwork, on the bill rather than two taps inside
                    their profile: on show week the question is asked of the
                    whole lineup at once, so it has to be answerable by looking
                    down it. */}
                {(() => {
                  const status = contractStatus?.(p);
                  if (!status) return null;
                  // Said in the producer's own terms: nobody is booked until
                  // they have signed. "Unsigned" was the paperwork's word for
                  // it and read like a detail to tidy up later; "Not booked"
                  // is what it actually means for the night.
                  const SIGNED_LABELS = {
                    signed: { label: 'Signed', icon: 'check', title: 'Signed — booked' },
                    waiting: {
                      label: 'Not booked',
                      icon: 'clock',
                      title: 'Contract sent, nothing back yet. Not booked until they sign.',
                    },
                    none: {
                      label: 'Not booked',
                      icon: 'alert',
                      title: 'No contract sent yet. Not booked until they sign one.',
                    },
                  } as const;
                  const { label, icon, title } = SIGNED_LABELS[status];
                  return (
                    <span className={`lineup-signed lineup-signed--${status}`} title={title}>
                      <Icon name={icon} size={13} aria-hidden />
                      <span className="lineup-signed__label">{label}</span>
                    </span>
                  );
                })()}
                {p.socialMedia && (
                  socialLink(p.socialMedia) ? (
                    <a
                      className="section-list-item__tag section-list-item__tag--link"
                      href={socialLink(p.socialMedia)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {p.socialMedia}
                    </a>
                  ) : (
                    <span className="section-list-item__tag">{p.socialMedia}</span>
                  )
                )}
                {p.email && (
                  <a
                    className="section-list-item__tag section-list-item__tag--link"
                    href={`mailto:${p.email}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {p.email}
                  </a>
                )}
                {(p.walkOnMusicName || p.walkOnMusicArtist) && (
                  <span className="section-list-item__tag">
                    {[p.walkOnMusicName, p.walkOnMusicArtist].filter(Boolean).join(' — ')}{p.walkOnMusicTimestamp ? ` @ ${p.walkOnMusicTimestamp}` : ''}
                  </span>
                )}
                {p.credits && <span className="section-list-item__tag">{p.credits}</span>}
              </div>
              <div className="section-list-item__buttons">
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => movePerformer(idx, -1)}
                  disabled={idx === 0}
                  aria-label={`Move ${p.name} up`}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => movePerformer(idx, 1)}
                  disabled={idx === performers.length - 1}
                  aria-label={`Move ${p.name} down`}
                  title="Move down"
                >
                  ↓
                </button>
                {/* A filled button on every row put the loudest control in the
                    section on the least urgent action, repeated once per comic.
                    The row already opens the profile; this is the affordance
                    that says so. */}
                <button
                  className="btn btn--ghost btn--sm section-list-item__open"
                  onClick={() => setSelectedId(p.id)}
                  aria-label={`Open ${p.name}'s profile`}
                >
                  <span className="section-list-item__open-label">Profile</span>
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* How much of the bill is real. A lineup of eight with two signatures
          is two people booked and six who might not turn up, and the count at
          the top of the section — which is simply how many names are on the
          list — cannot say that. */}
      {booking && (
        <p
          className={`lineup-booked ${booking.signed < booking.total ? 'lineup-booked--short' : ''}`}
          role="status"
        >
          <Icon name={booking.signed < booking.total ? 'alert' : 'check'} size={13} aria-hidden />
          {booking.signed} of {booking.total} booked
          {booking.signed < booking.total && (
            <span className="lineup-booked__note">
              {' — '}
              {booking.total - booking.signed} {booking.total - booking.signed === 1 ? 'has' : 'have'}
              {' not signed yet'}
            </span>
          )}
        </p>
      )}

      {/* Everything below the lineup, not above it. Adding people is what you
          do to this section; the bill is what the section is. */}
      {gaps.length > 0 && (
        <div className="lineup-gaps">
          <span className="lineup-gaps__head">
            <Icon name="alert" size={13} aria-hidden />
            {gaps.length} on this bill {gaps.length === 1 ? 'is' : 'are'} missing details
          </span>
          <ul className="lineup-gaps__list">
            {gaps.map(({ performer, readiness }) => (
              <li key={performer.id} className="lineup-gaps__item">
                <button
                  type="button"
                  className="lineup-gaps__name"
                  onClick={() => setSelectedId(performer.id)}
                >
                  {performer.name}
                </button>
                <span className="lineup-gaps__need">{describeGaps(readiness.gaps)}</span>
              </li>
            ))}
          </ul>
          <span className="lineup-gaps__hint">
            Share a contract link without an email. They fill in their details when they open it. Add a social handle to tag them.
          </span>
        </div>
      )}

      <LineupActions performers={performers} showName={showName} onAnnounce={onAnnounce} />

      {performers.length > 0 && (
        <div className="lineup-add">
          <button
            type="button"
            className="btn btn--secondary btn--sm lineup-add__toggle"
            onClick={() => setAddingOpen((v) => !v)}
            aria-expanded={addingOpen}
          >
            {addingOpen ? 'Done adding' : '+ Add performer'}
          </button>
        </div>
      )}

      {showAddForm && (
        <div className="lineup-add__form">
          {/* Name and Add, together on one line. The handle and the email used
              to sit between them as two more full-width fields, which on a
              phone made booking someone a five-control, 300px affair for a
              step that is usually just a name — and the profile editor takes
              both of them afterwards anyway, off a performer who is already on
              the bill. They wait behind "Contact details" now. */}
          <div className="lineup-add__name-row">
            <input
              className="section-field__input lineup-add__name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerformer())}
              placeholder="Performer name"
              aria-label="Performer name"
            />
            <button className="btn btn--primary btn--sm lineup-add__submit" onClick={addPerformer}>
              Add
            </button>
          </div>

          <div className="lineup-add__links">
            {/* Always here, even with nobody on file. Hiding it left a first-time
                producer with no sign the Rolodex has anything to do with building
                a lineup — the only Rolodex-looking thing on screen was the nav
                tab, which navigates away rather than picking anyone. */}
            <button
              type="button"
              className="lineup-add__link"
              onClick={() => setShowRolodex(v => !v)}
              aria-expanded={showRolodex}
            >
              From Rolodex
            </button>
            <button
              type="button"
              className="lineup-add__link"
              onClick={() => setDetailsOpen(v => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide contact details' : 'Contact details'}
            </button>
          </div>

          {detailsOpen && (
            <div className="section-add-row">
              <input
                className="section-field__input"
                value={instagram}
                onChange={(e) => setInstagram(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerformer())}
                placeholder="@instagram"
                aria-label="Instagram handle"
              />
              <input
                className="section-field__input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addPerformer())}
                placeholder="email (optional)"
                aria-label="Email address"
              />
            </div>
          )}

          {/* How many this show is booking for. Without it a lineup has no
              "full", so the count is just a number that keeps going up. It
              rides with the add controls because setting a target is part of
              booking — and the readiness bar on the show page keeps reporting
              against it whether or not this form is open. */}
          <div className="lineup-target">
            <label className="lineup-target__label" htmlFor="performer-target">
              Performers wanted
            </label>
            <input
              id="performer-target"
              className="section-field__input lineup-target__input"
              type="number"
              min={0}
              inputMode="numeric"
              value={performerTarget ?? ''}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (raw === '') return onTargetChange(undefined);
                const next = Math.max(0, Math.floor(Number(raw)));
                onTargetChange(Number.isFinite(next) && next > 0 ? next : undefined);
              }}
              placeholder="—"
            />
            {progress.targetSet && (
              <span
                className={`lineup-target__status${progress.full ? ' lineup-target__status--full' : ''}`}
                role="status"
              >
                {progress.label}
              </span>
            )}
          </div>

        </div>
      )}

      {filed && (
        <p className="section-filed" role="status">
          <span className="section-filed__mark" aria-hidden="true">✓</span>
          {/* The sentence is one flex item, deliberately. Left bare beside the
              tick, the bold name and the words after it became two anonymous
              flex items in their own columns, each wrapping on its own — so a
              long name printed over the middle of its own sentence. */}
          <span className="section-filed__text">
            <strong>{filed}</strong> was added to your Rolodex, so they're there next time you
            build a lineup.
          </span>
        </p>
      )}

      {showRolodex && (
        <div className="section-rolodex-picker">
          <p className="section-rolodex-picker__label">Pick from Rolodex</p>
          {potentialComics.length === 0 ? (
            <p className="section-rolodex-picker__empty">
              Nobody on file yet. Everyone you add to a show is filed here
              automatically, so this fills up as you book.
            </p>
          ) : (
            <>
          {potentialComics.map(comic => (
            <button
              key={comic.id}
              className="section-rolodex-picker__item"
              onClick={() => addFromRolodex(comic)}
            >
              <span className="section-rolodex-picker__name">{comic.name}</span>
              {comic.socialMedia && <span className="section-list-item__tag">{comic.socialMedia}</span>}
              {comic.walkOnMusicName && <span className="section-list-item__tag">{comic.walkOnMusicName}</span>}
            </button>
          ))}
            </>
          )}
        </div>
      )}



      {selectedPerformer && (
        <>
          <div className="perf-drawer__backdrop" onClick={() => setSelectedId(null)} />
          <div className="perf-drawer">
            <PerformerProfile
              performer={selectedPerformer}
              onBack={() => setSelectedId(null)}
              onChange={updatePerformer}
              onDelete={deletePerformer}
              onSaveToRolodex={onSaveToRolodex}
              inRolodex={filedInRolodex.has(rolodexKey(selectedPerformer.name))}
              contracts={renderContracts?.(selectedPerformer)}
            />
          </div>
        </>
      )}
    </div>
  );
}
