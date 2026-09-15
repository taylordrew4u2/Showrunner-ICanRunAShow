import { useId, useState } from 'react';
import type { Performer, PotentialComic } from '../../types';
import { HeadshotPanel } from '../HeadshotPanel';
import { audioUploadSizeError } from '../../utils/media';
import { uploadMedia } from '../../utils/mediaStore';
import { Icon } from '../Icon';
import { TrimControls } from '../TrimControls';
import { useMediaUrl } from '../../utils/useMediaUrl';
import { socialLink } from '../../utils/social';
import { performerToComic } from '../../utils/rolodex';
import './PerformerProfile.css';
import { useConfirm } from '../useConfirm';
import { useComicProfileDraft } from './useComicProfileDraft';

interface PerformerProfileProps {
  performer: Performer;
  onBack: () => void;
  backLabel?: string;
  onChange: (updated: Performer) => void;
  onDelete: (id: string) => void;
  onSaveToRolodex?: (comic: PotentialComic) => void;
  /**
   * Whether this person is already filed in the Rolodex.
   *
   * Passed in rather than worked out here, because the profile knows nothing
   * about settings. When they are, the save control is gone entirely: a button
   * offering to do something already done is a button that makes a producer
   * wonder whether the first press worked.
   */
  inRolodex?: boolean;
  /**
   * Contracts for this person, rendered by the caller — the profile itself has
   * no idea about settings or the session, and does not need one.
   */
  contracts?: React.ReactNode;
}

export function PerformerProfile({ performer, onBack, backLabel = 'Performers', onChange, onDelete, onSaveToRolodex, inRolodex, contracts }: PerformerProfileProps) {
  // Labels have to point at the field they name: written as a plain <label>
  // beside an input they are decoration — not announced as the field's name,
  // and not tappable to focus it.
  const fieldId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const { draft, setField, dirty, save: handleSave, update } = useComicProfileDraft(performer, onChange);
  const { name, socialMedia, email, phone, notes, credits,
    walkOnMusicName: songName, walkOnMusicArtist: songArtist,
    walkOnMusicTimestamp: timestamp, walkOnMusicLink: musicLink } = draft;
  const [savedToRolodex, setSavedToRolodex] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioDrag, setAudioDrag] = useState(false);
  // Resolves `media:` store references to a playable URL (passthrough otherwise).
  const walkOnUrl = useMediaUrl(performer.walkOnMusic);

  /**
   * Attach an uploaded file as the walk-on.
   *
   * One place, because there are four ways in — Replace, and the empty
   * dropzone's drop, click and keyboard paths — and they had drifted before:
   * a new song kept the old song's in and out points, so the cut landed in the
   * middle of whatever came next.
   */
  function attachWalkOn(result: string, file: File) {
    update({
      walkOnMusic: result,
      walkOnMusicName: file.name,
      walkOnStartSec: undefined,
      walkOnEndSec: undefined,
    });
  }
  // Walk-on audio is the only upload — it goes to the chunked media store
  // (song-sized cap); the show payload only carries a small `media:` reference.
  function guardRead(file: File, onLoad: (result: string, file: File) => void) {
    const err = audioUploadSizeError(file);
    if (err) { setMediaError(err); return; }
    setMediaError('Uploading audio…');
    uploadMedia(file)
      .then((ref) => { setMediaError(null); onLoad(ref, file); })
      .catch(() => setMediaError('Could not upload that audio file. Check your connection and try again.'));
  }

  function pickFile(accept: string, onLoad: (result: string, file: File) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.onchange = () => {
      const file = input.files?.[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) return;
      guardRead(file, onLoad);
    };
    document.body.appendChild(input);
    input.click();
  }

  function handleDrop(
    e: React.DragEvent,
    mimePrefix: string,
    onLoad: (result: string, file: File) => void,
    setDrag: (v: boolean) => void,
  ) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith(mimePrefix)) return;
    guardRead(file, onLoad);
  }

  return (
    <div className="perf-profile">
      <div className="perf-profile__topbar">
        <button className="perf-profile__back" onClick={onBack}>
          <svg viewBox="0 0 20 20" fill="currentColor" width="16" height="16" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M12.707 4.293a1 1 0 010 1.414L8.414 10l4.293 4.293a1 1 0 01-1.414 1.414l-5-5a1 1 0 010-1.414l5-5a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span>{backLabel}</span>
        </button>
      </div>

      {/* The person, not the word "profile" — you got here by pressing their
          name, and the page you land on should say whose it is. */}
      <h3 className="perf-profile__heading">{performer.name.trim() || 'Performer Profile'}</h3>
      <p className="perf-profile__sync-hint">Changes update this comic in the Rolodex and every show.</p>

      {/* Main card: fields + photo */}
      <div className="perf-profile__card">
        <div className="perf-profile__form">
          <p className="perf-profile__section-label">Profile</p>
          <div className="perf-profile__fields">
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-name`}>Name</label>
              <input id={`${fieldId}-name`}
                className="perf-profile__input"
                value={name}
                onChange={e => setField('name', e.target.value)}
                placeholder="Performer name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-instagram-social`}>Instagram / Social</label>
              <input id={`${fieldId}-instagram-social`}
                className="perf-profile__input"
                value={socialMedia}
                onChange={e => setField('socialMedia', e.target.value)}
                placeholder="@username"
              />
              {socialLink(socialMedia) && (
                <a
                  href={socialLink(socialMedia)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="perf-profile__inline-link"
                >
                  Open profile ↗
                </a>
              )}
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-email`}>Email</label>
              <input id={`${fieldId}-email`}
                className="perf-profile__input"
                type="email"
                value={email}
                onChange={e => setField('email', e.target.value)}
                placeholder="name@email.com"
              />
              {email.trim() && (
                <a href={`mailto:${email.trim()}`} className="perf-profile__inline-link">
                  Send email ↗
                </a>
              )}
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-phone`}>Phone</label>
              <input id={`${fieldId}-phone`}
                className="perf-profile__input"
                type="tel"
                value={phone}
                onChange={e => setField('phone', e.target.value)}
                placeholder="Phone number"
              />
              {phone.trim() && <a href={`tel:${phone.trim()}`} className="perf-profile__inline-link">Call ↗</a>}
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label" htmlFor={`${fieldId}-credits-intro-notes`}>Credits for the stage introduction</label>
              <input id={`${fieldId}-credits-intro-notes`}
                className="perf-profile__input"
                value={credits}
                onChange={e => setField('credits', e.target.value)}
                placeholder="Credits the host should mention when bringing them onstage"
              />
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label" htmlFor={`${fieldId}-notes`}>Notes</label>
              <input id={`${fieldId}-notes`}
                className="perf-profile__input"
                value={notes}
                onChange={e => setField('notes', e.target.value)}
                placeholder="Contact info, style notes, availability..."
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-walk-on-song`}>Walk-On Song</label>
              <input id={`${fieldId}-walk-on-song`}
                className="perf-profile__input"
                value={songName}
                onChange={e => setField('walkOnMusicName', e.target.value)}
                placeholder="Song title"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-artist`}>Artist</label>
              <input id={`${fieldId}-artist`}
                className="perf-profile__input"
                value={songArtist}
                onChange={e => setField('walkOnMusicArtist', e.target.value)}
                placeholder="Artist name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-start-timestamp`}>Start Timestamp</label>
              <input id={`${fieldId}-start-timestamp`}
                className="perf-profile__input"
                value={timestamp}
                onChange={e => setField('walkOnMusicTimestamp', e.target.value)}
                placeholder="e.g. 1:30"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-youtube-spotify-link`}>YouTube / Spotify Link</label>
              <input id={`${fieldId}-youtube-spotify-link`}
                className="perf-profile__input"
                value={musicLink}
                onChange={e => setField('walkOnMusicLink', e.target.value)}
                placeholder="https://open.spotify.com/... or youtu.be/..."
              />
            </div>
          </div>

          <div className="perf-profile__actions">
            {/* Always here. Locking a performer used to hide this button
                outright, so the way to stop yourself editing a booking was
                also the way to lose an edit you had already typed. */}
            <button className="btn btn--primary" onClick={handleSave} disabled={!dirty}>
              Save Changes
            </button>
            {/* Gone once they are filed, on every screen that shows a profile:
                this is driven by the Rolodex itself rather than by a flag from
                the last press, so it stays gone after a reload and wherever
                else the same person is opened. */}
            {onSaveToRolodex && !inRolodex && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  // Same conversion the automatic filing uses, so the two can't
                  // drift into copying different fields across.
                  onSaveToRolodex(performerToComic(handleSave()));
                  setSavedToRolodex(true);
                  setTimeout(() => setSavedToRolodex(false), 2000);
                }}
              >
                {savedToRolodex ? 'Saved!' : 'Save to Rolodex'}
              </button>
            )}
            <button
              className="btn btn--danger btn--sm perf-profile__remove"
              onClick={async () => {
                if (await confirm({
                  message: `Remove ${performer.name} from this show? They stay in your Rolodex.`,
                  confirmLabel: 'Remove from show',
                })) {
                  onDelete(performer.id);
                  onBack();
                }
              }}
            >
              Remove from show
            </button>
          </div>
        </div>

        <HeadshotPanel name={performer.name} photo={performer.photo}
          onChange={photo => update({ photo })} />
      </div>

      {/* Media card */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Media</p>
        {mediaError && <p className="perf-profile__media-error">{mediaError}</p>}
        <div className="perf-profile__media-grid">

          {/* Walk-on audio */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">Walk-on audio</p>
            {(performer.walkOnMusicName || performer.walkOnMusicArtist) && (
              <p className="perf-profile__song-info">
                {[performer.walkOnMusicName, performer.walkOnMusicArtist].filter(Boolean).join(' — ')}
                {performer.walkOnMusicTimestamp && <span className="perf-profile__song-ts"> @ {performer.walkOnMusicTimestamp}</span>}
              </p>
            )}
            {performer.walkOnMusicLink && (
              <a
                href={performer.walkOnMusicLink}
                target="_blank"
                rel="noopener noreferrer"
                className="perf-profile__music-link"
              >
                {performer.walkOnMusicLink.includes('spotify') ? 'Open in Spotify' : 'Open in YouTube'}
              </a>
            )}
            {performer.walkOnMusic ? (
              <>
                {/* The file itself, on one line: what is attached and the one
                    control you reach for. The player and the cut sit under it,
                    where they belong to the track rather than compete with it. */}
                <div className="perf-profile__audio-file">
                  <span className="perf-profile__audio-file-icon"><Icon name="music" size={16} /></span>
                  <span className="perf-profile__audio-file-name">
                    {performer.walkOnMusicName || 'Walk-on audio'}
                  </span>
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => pickFile('audio/*', attachWalkOn)}
                  >
                    Replace
                  </button>
                </div>
                {walkOnUrl ? (
                  <audio controls preload="none" className="perf-profile__audio">
                    <source src={walkOnUrl} />
                  </audio>
                ) : (
                  <p className="perf-profile__media-empty">Loading audio…</p>
                )}
                <div className="perf-profile__media-actions">
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => update({
                      walkOnMusic: undefined,
                      walkOnMusicName: undefined,
                      // The cut belonged to that file. Leaving it behind would
                      // silently apply someone's chorus to the next upload.
                      walkOnStartSec: undefined,
                      walkOnEndSec: undefined,
                    })}
                  >
                    Remove
                  </button>
                </div>
                {/* A walk-on is the clearest case for trimming: it's the drop
                    the room knows, not the track's first eight bars. */}
                <TrimControls
                  src={performer.walkOnMusic}
                  startSec={performer.walkOnStartSec}
                  endSec={performer.walkOnEndSec}
                  onChange={(trim) =>
                    update({
                      walkOnStartSec: trim.startSec,
                      walkOnEndSec: trim.endSec,
                    })
                  }
                />
              </>
            ) : (
              <div
                className={`perf-profile__dropzone${audioDrag ? ' perf-profile__dropzone--active' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="Upload walk-on audio file"
                onDragOver={e => e.preventDefault()}
                onDragEnter={() => setAudioDrag(true)}
                onDragLeave={() => setAudioDrag(false)}
                onDrop={e => handleDrop(e, 'audio/', attachWalkOn, setAudioDrag)}
                onClick={() => pickFile('audio/*', attachWalkOn)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile('audio/*', attachWalkOn); } }}
              >
                <span className="perf-profile__dropzone-icon"></span>
                <span className="perf-profile__dropzone-label">
                  {audioDrag ? 'Drop audio file' : 'Drag & drop or click to upload'}
                </span>
                <span className="perf-profile__dropzone-sub">MP3, WAV, AAC, M4A</span>
              </div>
            )}
            <span className="perf-profile__media-hint">
              Fades in when you press their face in Run Show.
            </span>
          </div>

          {/* Video link */}
          <div className="perf-profile__media-tile">
            <label className="perf-profile__media-label" htmlFor={`${fieldId}-video-link`}>Video link</label>
            <input
              id={`${fieldId}-video-link`}
              className="perf-profile__input perf-profile__video-link"
              value={performer.videoLink || ''}
              onChange={e => update({ videoLink: e.target.value.trim() || undefined })}
              placeholder="Paste video link (YouTube, Vimeo, Drive…)"
            />
            {performer.videoLink ? (
              <a href={performer.videoLink} target="_blank" rel="noopener noreferrer" className="perf-profile__music-link">
                Open video link
              </a>
            ) : (
              <p className="perf-profile__media-empty">Paste a hosted link — video uploads aren't stored.</p>
            )}
          </div>

        </div>
      </div>
      {contracts}
      {confirmDialog}
    </div>
  );
}
