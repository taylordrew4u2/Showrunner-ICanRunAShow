import { useId, useState } from 'react';
import type { PotentialComic } from '../../types';
import { audioUploadSizeError } from '../../utils/media';
import { uploadMedia } from '../../utils/mediaStore';
import { useMediaUrl } from '../../utils/useMediaUrl';
import { socialLink } from '../../utils/social';
import './PerformerProfile.css';
import { useConfirm } from '../useConfirm';

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
  const [name, setName] = useState(comic.name);
  const [notes, setNotes] = useState(comic.notes || '');
  const [socialMedia, setSocialMedia] = useState(comic.socialMedia || '');
  const [email, setEmail] = useState(comic.email || '');
  const [credits, setCredits] = useState(comic.credits || '');
  const [songName, setSongName] = useState(comic.walkOnMusicName || '');
  const [songArtist, setSongArtist] = useState(comic.walkOnMusicArtist || '');
  const [timestamp, setTimestamp] = useState(comic.walkOnMusicTimestamp || '');
  const [musicLink, setMusicLink] = useState(comic.walkOnMusicLink || '');
  const [dirty, setDirty] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  // Resolves `media:` store references to a playable URL (passthrough otherwise).
  const walkOnUrl = useMediaUrl(comic.walkOnMusic);

  function mark() { setDirty(true); }

  function handleSave() {
    onChange({
      ...comic,
      name: name.trim() || comic.name,
      notes: notes.trim() || undefined,
      socialMedia: socialMedia.trim() || undefined,
      email: email.trim() || undefined,
      credits: credits.trim() || undefined,
      walkOnMusicName: songName.trim() || undefined,
      walkOnMusicArtist: songArtist.trim() || undefined,
      walkOnMusicTimestamp: timestamp.trim() || undefined,
      walkOnMusicLink: musicLink.trim() || undefined,
    });
    setDirty(false);
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
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      guardRead(file, onLoad);
    };
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

      <h2 className="perf-profile__heading">Rolodex Entry</h2>

      <div className="perf-profile__card">
        <div className="perf-profile__form">
          <p className="perf-profile__section-label">Info</p>
          <div className="perf-profile__fields">
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label" htmlFor={`${fieldId}-name`}>Name</label>
              <input id={`${fieldId}-name`}
                className="perf-profile__input"
                value={name}
                onChange={e => { setName(e.target.value); mark(); }}
                placeholder="Performer name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-instagram-social`}>Instagram / Social</label>
              <input id={`${fieldId}-instagram-social`}
                className="perf-profile__input"
                value={socialMedia}
                onChange={e => { setSocialMedia(e.target.value); mark(); }}
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
                onChange={e => { setEmail(e.target.value); mark(); }}
                placeholder="name@email.com"
              />
              {email.trim() && (
                <a href={`mailto:${email.trim()}`} className="perf-profile__inline-link">
                  Send email ↗
                </a>
              )}
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-credits`}>Credits</label>
              <input id={`${fieldId}-credits`}
                className="perf-profile__input"
                value={credits}
                onChange={e => { setCredits(e.target.value); mark(); }}
                placeholder="Stage credits, intro notes..."
              />
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label" htmlFor={`${fieldId}-notes`}>Notes</label>
              <input id={`${fieldId}-notes`}
                className="perf-profile__input"
                value={notes}
                onChange={e => { setNotes(e.target.value); mark(); }}
                placeholder="Contact info, style notes, availability..."
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-walk-on-song`}>Walk-On Song</label>
              <input id={`${fieldId}-walk-on-song`}
                className="perf-profile__input"
                value={songName}
                onChange={e => { setSongName(e.target.value); mark(); }}
                placeholder="Song title"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-artist`}>Artist</label>
              <input id={`${fieldId}-artist`}
                className="perf-profile__input"
                value={songArtist}
                onChange={e => { setSongArtist(e.target.value); mark(); }}
                placeholder="Artist name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-start-timestamp`}>Start Timestamp</label>
              <input id={`${fieldId}-start-timestamp`}
                className="perf-profile__input"
                value={timestamp}
                onChange={e => { setTimestamp(e.target.value); mark(); }}
                placeholder="e.g. 1:30"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label" htmlFor={`${fieldId}-youtube-spotify-link`}>YouTube / Spotify Link</label>
              <input id={`${fieldId}-youtube-spotify-link`}
                className="perf-profile__input"
                value={musicLink}
                onChange={e => { setMusicLink(e.target.value); mark(); }}
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

        {/* Avatar */}
        <div className="perf-profile__photo-panel">
          <div className="perf-profile__avatar-wrap">
            <div className="perf-profile__avatar-placeholder">
              {comic.name.charAt(0).toUpperCase()}
            </div>
          </div>
          <p className="perf-profile__photo-name">{comic.name}</p>
        </div>
      </div>

      {/* Walk-on music */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Walk-On Music File</p>
        <div className="perf-profile__media-tile perf-profile__media-tile--bare">
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
              {walkOnUrl ? (
                <audio controls preload="none" className="perf-profile__audio">
                  <source src={walkOnUrl} />
                </audio>
              ) : (
                <p className="perf-profile__media-empty">Loading audio…</p>
              )}
              <div className="perf-profile__media-actions">
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => pickFile('audio/*', (result, file) => {
                    onChange({ ...comic, walkOnMusic: result, walkOnMusicName: file.name });
                    setSongName(file.name);
                  })}
                >
                  Replace
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onChange({ ...comic, walkOnMusic: undefined, walkOnMusicName: undefined })}
                >
                  Remove
                </button>
              </div>
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
              onDrop={e => handleDrop(e, 'audio/', (result, file) => {
                onChange({ ...comic, walkOnMusic: result, walkOnMusicName: file.name });
                setSongName(file.name);
              }, setAudioDrag)}
              onClick={() => pickFile('audio/*', (result, file) => {
                onChange({ ...comic, walkOnMusic: result, walkOnMusicName: file.name });
                setSongName(file.name);
              })}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile('audio/*', (result, file) => { onChange({ ...comic, walkOnMusic: result, walkOnMusicName: file.name }); setSongName(file.name); }); } }}
            >
              <span className="perf-profile__dropzone-icon"></span>
              <span className="perf-profile__dropzone-label">
                {audioDrag ? 'Drop audio file' : 'Drag & drop or click to upload'}
              </span>
              <span className="perf-profile__dropzone-sub">MP3, WAV, AAC, M4A</span>
            </div>
          )}
          {mediaError && <p className="perf-profile__media-error">{mediaError}</p>}
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
