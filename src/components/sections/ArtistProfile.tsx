import { useState } from 'react';
import type { Artist } from '../../types';
import { audioUploadSizeError } from '../../utils/media';
import { uploadMedia } from '../../utils/mediaStore';
import { useMediaUrl } from '../../utils/useMediaUrl';
import './PerformerProfile.css';
import { useConfirm } from '../useConfirm';

interface ArtistProfileProps {
  artist: Artist;
  onBack: () => void;
  onChange: (updated: Artist) => void;
  onDelete: (id: string) => void;
}

export function ArtistProfile({ artist, onBack, onChange, onDelete }: ArtistProfileProps) {
  const { confirm, confirmDialog } = useConfirm();
  const [name, setName] = useState(artist.name);
  const [artistType, setArtistType] = useState(artist.artistType || '');
  const [socialMedia, setSocialMedia] = useState(artist.socialMedia || '');
  const [credits, setCredits] = useState(artist.credits || '');
  const [dirty, setDirty] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [audioDrag, setAudioDrag] = useState(false);
  // Resolves `media:` store references to a playable URL (passthrough otherwise).
  const walkOnUrl = useMediaUrl(artist.walkOnMusic);

  function mark() { setDirty(true); }

  function handleSave() {
    onChange({
      ...artist,
      name: name.trim() || artist.name,
      artistType: artistType.trim() || undefined,
      socialMedia: socialMedia.trim() || undefined,
      credits: credits.trim() || undefined,
    });
    setDirty(false);
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
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← Back</button>
      </div>

      <h3 className="perf-profile__heading">Artist Profile</h3>

      {/* Main card: fields + photo */}
      <div className="perf-profile__card">
        <div className="perf-profile__form">
          <p className="perf-profile__section-label">Profile</p>
          <div className="perf-profile__fields">
            <div className="perf-profile__field">
              <label className="perf-profile__label">Name</label>
              <input
                className="perf-profile__input"
                value={name}
                onChange={e => { setName(e.target.value); mark(); }}
                placeholder="Artist name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Artist Type</label>
              <input
                className="perf-profile__input"
                value={artistType}
                onChange={e => { setArtistType(e.target.value); mark(); }}
                placeholder="Painter, Musician, Photographer…"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Social Media</label>
              <input
                className="perf-profile__input"
                value={socialMedia}
                onChange={e => { setSocialMedia(e.target.value); mark(); }}
                placeholder="@username"
              />
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label">Credits / Notes</label>
              <input
                className="perf-profile__input"
                value={credits}
                onChange={e => { setCredits(e.target.value); mark(); }}
                placeholder="Bio, credits, intro notes…"
              />
            </div>
          </div>

          <div className="perf-profile__actions">
            {/* Always here. Locking an artist used to hide this button and
                disable every field, so the way to mark a booking settled was
                also the way to lose an edit you had already typed. */}
            <button className="btn btn--primary" onClick={handleSave} disabled={!dirty}>
              Save Changes
            </button>
            <button
              className="btn btn--danger btn--sm"
              onClick={async () => {
                if (await confirm(`Delete "${artist.name}"? This cannot be undone.`)) {
                  onDelete(artist.id);
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
              {artist.name.charAt(0).toUpperCase()}
            </div>
          </div>
          <p className="perf-profile__photo-name">{artist.name}</p>
        </div>
      </div>

      {/* Media card */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Media</p>
        {mediaError && <p className="perf-profile__media-error">{mediaError}</p>}
        <div className="perf-profile__media-grid">

          {/* Walk-On Music */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">Walk-On Music</p>
            {artist.walkOnMusicName && (
              <p className="perf-profile__song-info">{artist.walkOnMusicName}</p>
            )}
            {artist.walkOnMusic ? (
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
                    onClick={() => pickFile('audio/*', (result, file) =>
                      onChange({ ...artist, walkOnMusic: result, walkOnMusicName: file.name }))}
                  >
                    Replace
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={() => onChange({ ...artist, walkOnMusic: undefined, walkOnMusicName: undefined })}
                  >
                    Remove
                  </button>
                </div>
              </>
            ) : (
              <div
                className={`perf-profile__dropzone${audioDrag ? ' perf-profile__dropzone--active' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDragEnter={() => setAudioDrag(true)}
                onDragLeave={() => setAudioDrag(false)}
                onDrop={e => handleDrop(e, 'audio/', (result, file) =>
                  onChange({ ...artist, walkOnMusic: result, walkOnMusicName: file.name }), setAudioDrag)}
                onClick={() => pickFile('audio/*', (result, file) =>
                  onChange({ ...artist, walkOnMusic: result, walkOnMusicName: file.name }))}
              >
                <span className="perf-profile__dropzone-label">
                  {audioDrag ? 'Drop audio file' : 'Drag & drop or click to upload'}
                </span>
                <span className="perf-profile__dropzone-sub">MP3, WAV, AAC, M4A</span>
              </div>
            )}
          </div>

          {/* Video */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">Video</p>
            <input
              className="perf-profile__input perf-profile__video-link"
              value={artist.videoLink || ''}
              onChange={e => onChange({ ...artist, videoLink: e.target.value.trim() || undefined })}
              placeholder="Paste video link (YouTube, Vimeo, Drive…)"
            />
            {artist.videoLink && (
              <a href={artist.videoLink} target="_blank" rel="noopener noreferrer" className="perf-profile__music-link">
                Open video link
              </a>
            )}
            {!artist.videoLink && (
              <p className="perf-profile__media-empty">Paste a hosted link — video uploads aren't stored.</p>
            )}
          </div>

        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
