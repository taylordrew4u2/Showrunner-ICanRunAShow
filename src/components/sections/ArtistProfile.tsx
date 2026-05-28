import { useState } from 'react';
import type { Artist } from '../../types';
import { compressImage, embedSizeError, readFileAsDataURL } from '../../utils/media';
import './PerformerProfile.css';

interface ArtistProfileProps {
  artist: Artist;
  onBack: () => void;
  onChange: (updated: Artist) => void;
  onDelete: (id: string) => void;
}

export function ArtistProfile({ artist, onBack, onChange, onDelete }: ArtistProfileProps) {
  const [name, setName] = useState(artist.name);
  const [artistType, setArtistType] = useState(artist.artistType || '');
  const [socialMedia, setSocialMedia] = useState(artist.socialMedia || '');
  const [credits, setCredits] = useState(artist.credits || '');
  const [dirty, setDirty] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [photoDrag, setPhotoDrag] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);
  const [videoDrag, setVideoDrag] = useState(false);

  const locked = artist.lockedIn;

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

  function guardRead(file: File, kind: string, onLoad: (result: string, file: File) => void) {
    const isPhoto = /image|photo/i.test(kind) || file.type.startsWith('image/');
    if (!isPhoto) {
      const err = embedSizeError(file, kind);
      if (err) { setMediaError(err); return; }
    }
    setMediaError(null);
    const reader = isPhoto ? compressImage(file) : readFileAsDataURL(file);
    reader
      .then((result) => onLoad(result, file))
      .catch(() => setMediaError('Could not read that file. Please try again.'));
  }

  function pickFile(accept: string, kind: string, onLoad: (result: string, file: File) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.onchange = () => {
      const file = input.files?.[0];
      if (input.parentNode) input.parentNode.removeChild(input);
      if (!file) return;
      guardRead(file, kind, onLoad);
    };
    document.body.appendChild(input);
    input.click();
  }

  function handleDrop(
    e: React.DragEvent,
    mimePrefix: string,
    kind: string,
    onLoad: (result: string, file: File) => void,
    setDrag: (v: boolean) => void,
  ) {
    e.preventDefault();
    setDrag(false);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith(mimePrefix)) return;
    guardRead(file, kind, onLoad);
  }

  return (
    <div className="perf-profile">
      <div className="perf-profile__topbar">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← Back</button>
        {locked && <span className="pill pill--red pill--dot">Locked In</span>}
      </div>

      <h2 className="perf-profile__heading">Artist Profile</h2>

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
                disabled={locked}
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Artist Type</label>
              <input
                className="perf-profile__input"
                value={artistType}
                onChange={e => { setArtistType(e.target.value); mark(); }}
                placeholder="Painter, Musician, Photographer…"
                disabled={locked}
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Social Media</label>
              <input
                className="perf-profile__input"
                value={socialMedia}
                onChange={e => { setSocialMedia(e.target.value); mark(); }}
                placeholder="@username"
                disabled={locked}
              />
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label">Credits / Notes</label>
              <input
                className="perf-profile__input"
                value={credits}
                onChange={e => { setCredits(e.target.value); mark(); }}
                placeholder="Bio, credits, intro notes…"
                disabled={locked}
              />
            </div>
          </div>

          <div className="perf-profile__actions">
            {!locked && (
              <button className="btn btn--primary" onClick={handleSave} disabled={!dirty}>
                Save Changes
              </button>
            )}
            <button
              className={`btn ${locked ? 'btn--secondary' : 'btn--ghost'}`}
              onClick={() => onChange({ ...artist, lockedIn: !locked })}
            >
              {locked ? 'Unlock' : 'Lock In'}
            </button>
            {!locked && (
              <button
                className="btn btn--danger btn--sm"
                onClick={() => {
                  if (window.confirm(`Delete "${artist.name}"? This cannot be undone.`)) {
                    onDelete(artist.id);
                    onBack();
                  }
                }}
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* Photo panel */}
        <div className="perf-profile__photo-panel">
          <div
            className={`perf-profile__photo-drop${photoDrag ? ' perf-profile__photo-drop--active' : ''}${locked ? ' perf-profile__photo-drop--locked' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDragEnter={() => !locked && setPhotoDrag(true)}
            onDragLeave={() => setPhotoDrag(false)}
            onDrop={e => !locked && handleDrop(e, 'image/', 'photo', result => onChange({ ...artist, photo: result }), setPhotoDrag)}
            onClick={() => !locked && pickFile('image/*', 'photo', result => onChange({ ...artist, photo: result }))}
          >
            <div className="perf-profile__avatar-wrap">
              {artist.photo ? (
                <img src={artist.photo} alt={artist.name} className="perf-profile__avatar" />
              ) : (
                <div className="perf-profile__avatar-placeholder">
                  {artist.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {!locked && (
              <p className="perf-profile__photo-hint">
                {photoDrag ? 'Drop photo' : artist.photo ? 'Click or drag to update' : 'Click or drag to upload'}
              </p>
            )}
          </div>
          <p className="perf-profile__photo-name">{artist.name}</p>
          {artist.photo && !locked && (
            <button
              className="perf-profile__photo-remove"
              onClick={e => { e.stopPropagation(); onChange({ ...artist, photo: undefined }); }}
            >
              Remove photo
            </button>
          )}
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
                <audio controls preload="none" className="perf-profile__audio">
                  <source src={artist.walkOnMusic} />
                </audio>
                {!locked && (
                  <div className="perf-profile__media-actions">
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => pickFile('audio/*', 'audio file', (result, file) =>
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
                )}
              </>
            ) : !locked ? (
              <div
                className={`perf-profile__dropzone${audioDrag ? ' perf-profile__dropzone--active' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDragEnter={() => setAudioDrag(true)}
                onDragLeave={() => setAudioDrag(false)}
                onDrop={e => handleDrop(e, 'audio/', 'audio file', (result, file) =>
                  onChange({ ...artist, walkOnMusic: result, walkOnMusicName: file.name }), setAudioDrag)}
                onClick={() => pickFile('audio/*', 'audio file', (result, file) =>
                  onChange({ ...artist, walkOnMusic: result, walkOnMusicName: file.name }))}
              >
                <span className="perf-profile__dropzone-label">
                  {audioDrag ? 'Drop audio file' : 'Drag & drop or click to upload'}
                </span>
                <span className="perf-profile__dropzone-sub">MP3, WAV, AAC, M4A</span>
              </div>
            ) : (
              <p className="perf-profile__media-empty">No audio uploaded.</p>
            )}
          </div>

          {/* Video */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">Video</p>
            {!locked && (
              <input
                className="perf-profile__input perf-profile__video-link"
                value={artist.videoLink || ''}
                onChange={e => onChange({ ...artist, videoLink: e.target.value.trim() || undefined })}
                placeholder="Paste video link (YouTube, Vimeo, Drive…)"
              />
            )}
            {artist.videoLink && (
              <a href={artist.videoLink} target="_blank" rel="noopener noreferrer" className="perf-profile__music-link">
                Open video link
              </a>
            )}
            {artist.video ? (
              <>
                <video src={artist.video} controls preload="none" className="perf-profile__video" />
                {!locked && (
                  <div className="perf-profile__media-actions">
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => pickFile('video/*', 'video', result => onChange({ ...artist, video: result }))}
                    >
                      Replace
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onChange({ ...artist, video: undefined })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </>
            ) : !locked ? (
              <div
                className={`perf-profile__dropzone${videoDrag ? ' perf-profile__dropzone--active' : ''}`}
                onDragOver={e => e.preventDefault()}
                onDragEnter={() => setVideoDrag(true)}
                onDragLeave={() => setVideoDrag(false)}
                onDrop={e => handleDrop(e, 'video/', 'video', result => onChange({ ...artist, video: result }), setVideoDrag)}
                onClick={() => pickFile('video/*', 'video', result => onChange({ ...artist, video: result }))}
              >
                <span className="perf-profile__dropzone-label">
                  {videoDrag ? 'Drop video file' : 'Drag & drop or click to upload a short clip'}
                </span>
                <span className="perf-profile__dropzone-sub">Small clips only — use a link for full videos</span>
              </div>
            ) : (
              <p className="perf-profile__media-empty">No video uploaded.</p>
            )}
          </div>

          {/* File */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">File</p>
            {artist.file ? (
              <>
                {artist.file.startsWith('data:image') ? (
                  <img src={artist.file} alt={artist.fileName || 'File'} className="perf-profile__video" />
                ) : (
                  <p className="perf-profile__song-info">{artist.fileName || 'Attached file'}</p>
                )}
                {!locked && (
                  <div className="perf-profile__media-actions">
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => pickFile('*/*', 'file', (result, file) =>
                        onChange({ ...artist, file: result, fileName: file.name }))}
                    >
                      Replace
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onChange({ ...artist, file: undefined, fileName: undefined })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </>
            ) : !locked ? (
              <div
                className="perf-profile__dropzone"
                onClick={() => pickFile('*/*', 'file', (result, file) =>
                  onChange({ ...artist, file: result, fileName: file.name }))}
              >
                <span className="perf-profile__dropzone-label">Click to upload a file</span>
                <span className="perf-profile__dropzone-sub">Any file type</span>
              </div>
            ) : (
              <p className="perf-profile__media-empty">No file uploaded.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
