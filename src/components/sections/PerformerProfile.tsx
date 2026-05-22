import { useState } from 'react';
import type { Performer, PotentialComic } from '../../types';
import { generateId } from '../../utils/id';
import './PerformerProfile.css';

interface PerformerProfileProps {
  performer: Performer;
  onBack: () => void;
  onChange: (updated: Performer) => void;
  onDelete: (id: string) => void;
  onSaveToRolodex?: (comic: PotentialComic) => void;
}

export function PerformerProfile({ performer, onBack, onChange, onDelete, onSaveToRolodex }: PerformerProfileProps) {
  const [name, setName] = useState(performer.name);
  const [socialMedia, setSocialMedia] = useState(performer.socialMedia || '');
  const [credits, setCredits] = useState(performer.credits || '');
  const [songName, setSongName] = useState(performer.walkOnMusicName || '');
  const [timestamp, setTimestamp] = useState(performer.walkOnMusicTimestamp || '');
  const [dirty, setDirty] = useState(false);
  const [savedToRolodex, setSavedToRolodex] = useState(false);
  const [photoDrag, setPhotoDrag] = useState(false);
  const [audioDrag, setAudioDrag] = useState(false);
  const [videoDrag, setVideoDrag] = useState(false);

  const locked = performer.lockedIn;

  function mark() { setDirty(true); }

  function handleSave() {
    onChange({
      ...performer,
      name: name.trim() || performer.name,
      socialMedia: socialMedia.trim() || undefined,
      credits: credits.trim() || undefined,
      walkOnMusicName: songName.trim() || undefined,
      walkOnMusicTimestamp: timestamp.trim() || undefined,
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
        {locked && <span className="pill pill--red pill--dot">Locked In</span>}
      </div>

      <h2 className="perf-profile__heading">Performer Profile</h2>

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
                placeholder="Performer name"
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
              <label className="perf-profile__label">Credits / Intro Notes</label>
              <input
                className="perf-profile__input"
                value={credits}
                onChange={e => { setCredits(e.target.value); mark(); }}
                placeholder="Stage intro, credits, any notes..."
                disabled={locked}
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Walk-On Song</label>
              <input
                className="perf-profile__input"
                value={songName}
                onChange={e => { setSongName(e.target.value); mark(); }}
                placeholder="Song name"
                disabled={locked}
              />
            </div>
            <div className="perf-profile__field">
              <label className="perf-profile__label">Timestamp</label>
              <input
                className="perf-profile__input"
                value={timestamp}
                onChange={e => { setTimestamp(e.target.value); mark(); }}
                placeholder="e.g. 1:30"
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
              onClick={() => onChange({ ...performer, lockedIn: !locked })}
            >
              {locked ? '🔓 Unlock' : '🔒 Lock In'}
            </button>
            {onSaveToRolodex && (
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  const comic: PotentialComic = {
                    id: generateId(),
                    name: performer.name,
                    socialMedia: performer.socialMedia,
                    credits: performer.credits,
                    photo: performer.photo,
                    walkOnMusic: performer.walkOnMusic,
                    walkOnMusicName: performer.walkOnMusicName,
                    walkOnMusicTimestamp: performer.walkOnMusicTimestamp,
                    notes: performer.socialMedia,
                  };
                  onSaveToRolodex(comic);
                  setSavedToRolodex(true);
                  setTimeout(() => setSavedToRolodex(false), 2000);
                }}
              >
                {savedToRolodex ? '✓ Saved!' : '🎤 Save to Rolodex'}
              </button>
            )}
            {!locked && (
              <button
                className="btn btn--danger btn--sm"
                onClick={() => {
                  if (window.confirm(`Delete "${performer.name}"? This cannot be undone.`)) {
                    onDelete(performer.id);
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
            onDrop={e => !locked && handleDrop(e, 'image/', result => onChange({ ...performer, photo: result }), setPhotoDrag)}
            onClick={() => !locked && pickFile('image/*', result => onChange({ ...performer, photo: result }))}
          >
            <div className="perf-profile__avatar-wrap">
              {performer.photo ? (
                <img src={performer.photo} alt={performer.name} className="perf-profile__avatar" />
              ) : (
                <div className="perf-profile__avatar-placeholder">
                  {performer.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            {!locked && (
              <p className="perf-profile__photo-hint">
                {photoDrag ? 'Drop photo' : performer.photo ? 'Click or drag to update' : 'Click or drag to upload'}
              </p>
            )}
          </div>
          <p className="perf-profile__photo-name">{performer.name}</p>
          {performer.photo && !locked && (
            <button
              className="perf-profile__photo-remove"
              onClick={e => { e.stopPropagation(); onChange({ ...performer, photo: undefined }); }}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      {/* Media card */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Media</p>
        <div className="perf-profile__media-grid">

          {/* Walk-On Music */}
          <div className="perf-profile__media-tile">
            <p className="perf-profile__media-label">🎵 Walk-On Music</p>
            {performer.walkOnMusic ? (
              <>
                <audio controls preload="none" className="perf-profile__audio">
                  <source src={performer.walkOnMusic} />
                </audio>
                {!locked && (
                  <div className="perf-profile__media-actions">
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => pickFile('audio/*', (result, file) => {
                        onChange({ ...performer, walkOnMusic: result, walkOnMusicName: file.name });
                        setSongName(file.name);
                      })}
                    >
                      Replace
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onChange({ ...performer, walkOnMusic: undefined, walkOnMusicName: undefined })}
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
                onDrop={e => handleDrop(e, 'audio/', (result, file) => {
                  onChange({ ...performer, walkOnMusic: result, walkOnMusicName: file.name });
                  setSongName(file.name);
                }, setAudioDrag)}
                onClick={() => pickFile('audio/*', (result, file) => {
                  onChange({ ...performer, walkOnMusic: result, walkOnMusicName: file.name });
                  setSongName(file.name);
                })}
              >
                <span className="perf-profile__dropzone-icon">🎵</span>
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
            <p className="perf-profile__media-label">🎬 Video</p>
            {performer.video ? (
              <>
                <video src={performer.video} controls preload="none" className="perf-profile__video" />
                {!locked && (
                  <div className="perf-profile__media-actions">
                    <button
                      className="btn btn--secondary btn--sm"
                      onClick={() => pickFile('video/*', result => onChange({ ...performer, video: result }))}
                    >
                      Replace
                    </button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => onChange({ ...performer, video: undefined })}
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
                onDrop={e => handleDrop(e, 'video/', result => onChange({ ...performer, video: result }), setVideoDrag)}
                onClick={() => pickFile('video/*', result => onChange({ ...performer, video: result }))}
              >
                <span className="perf-profile__dropzone-icon">🎬</span>
                <span className="perf-profile__dropzone-label">
                  {videoDrag ? 'Drop video file' : 'Drag & drop or click to upload'}
                </span>
                <span className="perf-profile__dropzone-sub">MP4, MOV, WebM</span>
              </div>
            ) : (
              <p className="perf-profile__media-empty">No video uploaded.</p>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
