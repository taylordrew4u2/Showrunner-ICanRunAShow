import { useState } from 'react';
import type { PotentialComic } from '../../types';
import './PerformerProfile.css';

interface RolodexProfileProps {
  comic: PotentialComic;
  onBack: () => void;
  onChange: (updated: PotentialComic) => void;
  onDelete: (id: string) => void;
}

export function RolodexProfile({ comic, onBack, onChange, onDelete }: RolodexProfileProps) {
  const [name, setName] = useState(comic.name);
  const [notes, setNotes] = useState(comic.notes || '');
  const [socialMedia, setSocialMedia] = useState(comic.socialMedia || '');
  const [credits, setCredits] = useState(comic.credits || '');
  const [songName, setSongName] = useState(comic.walkOnMusicName || '');
  const [songArtist, setSongArtist] = useState(comic.walkOnMusicArtist || '');
  const [timestamp, setTimestamp] = useState(comic.walkOnMusicTimestamp || '');
  const [musicLink, setMusicLink] = useState(comic.walkOnMusicLink || '');
  const [dirty, setDirty] = useState(false);
  const [photoDrag, setPhotoDrag] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);

  function mark() { setDirty(true); }

  function handleSave() {
    onChange({
      ...comic,
      name: name.trim() || comic.name,
      notes: notes.trim() || undefined,
      socialMedia: socialMedia.trim() || undefined,
      credits: credits.trim() || undefined,
      walkOnMusicName: songName.trim() || undefined,
      walkOnMusicArtist: songArtist.trim() || undefined,
      walkOnMusicTimestamp: timestamp.trim() || undefined,
      walkOnMusicLink: musicLink.trim() || undefined,
    });
    setDirty(false);
  }

  function readFile(file: File, onLoad: (result: string, file: File) => void) {
    const reader = new FileReader();
    reader.onload = () => onLoad(reader.result as string, file);
    reader.readAsDataURL(file);
  }

  function pickFile(accept: string, onLoad: (result: string, file: File) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      readFile(file, onLoad);
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
    readFile(file, onLoad);
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
              <label className="perf-profile__label">Name</label>
              <input
                className="perf-profile__input"
                value={name}
                onChange={e => { setName(e.target.value); mark(); }}
                placeholder="Performer name"
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
            <div className="perf-profile__field">
              <label className="perf-profile__label">Credits</label>
              <input
                className="perf-profile__input"
                value={credits}
                onChange={e => { setCredits(e.target.value); mark(); }}
                placeholder="Stage credits, intro notes..."
              />
            </div>
            <div className="perf-profile__field perf-profile__field--full">
              <label className="perf-profile__label">Notes</label>
              <input
                className="perf-profile__input"
                value={notes}
                onChange={e => { setNotes(e.target.value); mark(); }}
                placeholder="Contact info, style notes, availability..."
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Walk-On Song</label>
              <input
                className="perf-profile__input"
                value={songName}
                onChange={e => { setSongName(e.target.value); mark(); }}
                placeholder="Song title"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Artist</label>
              <input
                className="perf-profile__input"
                value={songArtist}
                onChange={e => { setSongArtist(e.target.value); mark(); }}
                placeholder="Artist name"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Start Timestamp</label>
              <input
                className="perf-profile__input"
                value={timestamp}
                onChange={e => { setTimestamp(e.target.value); mark(); }}
                placeholder="e.g. 1:30"
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">YouTube / Spotify Link</label>
              <input
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
              onClick={() => {
                if (window.confirm(`Remove "${comic.name}" from the Rolodex? This cannot be undone.`)) {
                  onDelete(comic.id);
                  onBack();
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>

        {/* Photo panel */}
        <div className="perf-profile__photo-panel">
          <div
            className={`perf-profile__photo-drop${photoDrag ? ' perf-profile__photo-drop--active' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDragEnter={() => setPhotoDrag(true)}
            onDragLeave={() => setPhotoDrag(false)}
            onDrop={e => handleDrop(e, 'image/', result => { onChange({ ...comic, photo: result }); }, setPhotoDrag)}
            onClick={() => pickFile('image/*', result => onChange({ ...comic, photo: result }))}
          >
            <div className="perf-profile__avatar-wrap">
              {comic.photo ? (
                <img src={comic.photo} alt={comic.name} className="perf-profile__avatar" />
              ) : (
                <div className="perf-profile__avatar-placeholder">
                  {comic.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <p className="perf-profile__photo-hint">
              {photoDrag ? 'Drop photo' : comic.photo ? 'Click or drag to update' : 'Click or drag to upload'}
            </p>
          </div>
          <p className="perf-profile__photo-name">{comic.name}</p>
          {comic.photo && (
            <button
              className="perf-profile__photo-remove"
              onClick={e => { e.stopPropagation(); onChange({ ...comic, photo: undefined }); }}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      {/* Walk-on music */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Walk-On Music File</p>
        <div className="perf-profile__media-tile" style={{ border: 'none', padding: 0, background: 'none' }}>
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
              <audio controls preload="none" className="perf-profile__audio">
                <source src={comic.walkOnMusic} />
              </audio>
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
            >
              <span className="perf-profile__dropzone-icon"></span>
              <span className="perf-profile__dropzone-label">
                {audioDrag ? 'Drop audio file' : 'Drag & drop or click to upload'}
              </span>
              <span className="perf-profile__dropzone-sub">MP3, WAV, AAC, M4A</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
