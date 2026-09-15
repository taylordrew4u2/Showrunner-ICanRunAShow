import { HeadshotPanel } from '../HeadshotPanel';
import { Icon } from '../Icon';
import { TrimControls } from '../TrimControls';
import { useId, useState } from 'react';
import type { PotentialComic } from '../../types';
import { audioUploadSizeError } from '../../utils/media';
import { uploadMedia } from '../../utils/mediaStore';
import { useMediaUrl } from '../../utils/useMediaUrl';
import { socialLink } from '../../utils/social';
import './PerformerProfile.css';
import { useConfirm } from '../useConfirm';
import { useComicProfileDraft } from './useComicProfileDraft';

interface RolodexProfileProps {
  comic: PotentialComic;
  onBack: () => void;
  onChange: (updated: PotentialComic) => void;
  onDelete: (id: string) => void;
}

export function RolodexProfile({ comic, onBack, onChange, onDelete }: RolodexProfileProps) {
  // Labels have to point at the field they name: written as a plain <label>
  // beside an input they are decoration — not announced as the field's name,
  // and not tappable to focus it.
  const fieldId = useId();
  const { confirm, confirmDialog } = useConfirm();
  const { draft, setField, dirty, save: handleSave, update } = useComicProfileDraft(comic, onChange);
  const { name, socialMedia, email, phone, notes, credits,
    walkOnMusicName: songName, walkOnMusicArtist: songArtist,
    walkOnMusicTimestamp: timestamp, walkOnMusicLink: musicLink } = draft;
  const [audioDrag, setAudioDrag] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Resolves `media:` store references to a playable URL (passthrough otherwise).
  const walkOnUrl = useMediaUrl(comic.walkOnMusic);

  function attachWalkOn(result: string, file: File) {
    update({
      walkOnMusic: result,
      walkOnMusicName: file.name,
      walkOnStartSec: undefined,
      walkOnEndSec: undefined,
    });
  }

  // Rolodex audio goes to the chunked media store — settings only carry a
  // small `media:` reference, so a big track can't brick the settings save.
  function guardRead(file: File, onLoad: (result: string, file: File) => void) {
    const err = audioUploadSizeError(file);
    if (err) {
      setMediaError(err);
      return;
    }
    setMediaError('Uploading audio…');
    uploadMedia(file)
      .then(ref => { setMediaError(null); onLoad(ref, file); })
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
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← Back</button>
      </div>

      <h2 className="perf-profile__heading">{comic.name}</h2>
      <p className="perf-profile__sync-hint">Changes update this comic in the Rolodex and every show.</p>

      <div className="perf-profile__card">
        <div className="perf-profile__form">
          <p className="perf-profile__section-label">Info</p>
          <div className="perf-profile__fields">
            <div className="perf-profile__field perf-profile__field--full">
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
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-credits`}>Credits for the stage introduction</label>
              <input id={`${fieldId}-credits`}
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
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="perf-profile__actions">
            <button className="btn btn--primary" onClick={handleSave} disabled={!dirty}>
              Save Changes
            </button>
            <button
              className="btn btn--danger btn--sm"
              onClick={async () => {
                if (await confirm(`Remove "${comic.name}" from the Rolodex? This cannot be undone.`)) {
                  onDelete(comic.id);
                  onBack();
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>

        <HeadshotPanel name={comic.name} photo={comic.photo}
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
            {(comic.walkOnMusicName || comic.walkOnMusicArtist) && (
              <p className="perf-profile__song-info">
                {[comic.walkOnMusicName, comic.walkOnMusicArtist].filter(Boolean).join(' — ')}
                {comic.walkOnMusicTimestamp && <span className="perf-profile__song-ts"> @ {comic.walkOnMusicTimestamp}</span>}
              </p>
            )}
            {comic.walkOnMusicLink && (
              <a
                href={comic.walkOnMusicLink}
                target="_blank"
                rel="noopener noreferrer"
                className="perf-profile__music-link"
              >
                {comic.walkOnMusicLink.includes('spotify') ? 'Open in Spotify' : 'Open in YouTube'}
              </a>
            )}
            {comic.walkOnMusic ? (
              <>
                {/* The file itself, on one line: what is attached and the one
                    control you reach for. The player and the cut sit under it,
                    where they belong to the track rather than compete with it. */}
                <div className="perf-profile__audio-file">
                  <span className="perf-profile__audio-file-icon"><Icon name="music" size={16} /></span>
                  <span className="perf-profile__audio-file-name">
                    {comic.walkOnMusicName || 'Walk-on audio'}
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
                  src={comic.walkOnMusic}
                  startSec={comic.walkOnStartSec}
                  endSec={comic.walkOnEndSec}
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
              value={comic.videoLink || ''}
              onChange={e => update({ videoLink: e.target.value.trim() || undefined })}
              placeholder="Paste video link (YouTube, Vimeo, Drive…)"
            />
            {comic.videoLink ? (
              <a href={comic.videoLink} target="_blank" rel="noopener noreferrer" className="perf-profile__music-link">
                Open video link
              </a>
            ) : (
              <p className="perf-profile__media-empty">Paste a hosted link — video uploads aren't stored.</p>
            )}
          </div>

        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
