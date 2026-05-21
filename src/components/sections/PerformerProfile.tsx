import { useState } from 'react';
import type { Performer } from '../../types';
import './PerformerProfile.css';

interface PerformerProfileProps {
  performer: Performer;
  onBack: () => void;
  onChange: (updated: Performer) => void;
  onDelete: (id: string) => void;
}

export function PerformerProfile({ performer, onBack, onChange, onDelete }: PerformerProfileProps) {
  const [name, setName] = useState(performer.name);
  const [socialMedia, setSocialMedia] = useState(performer.socialMedia || '');
  const [credits, setCredits] = useState(performer.credits || '');
  const [songName, setSongName] = useState(performer.walkOnMusicName || '');
  const [timestamp, setTimestamp] = useState(performer.walkOnMusicTimestamp || '');
  const [dirty, setDirty] = useState(false);

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

  function pickFile(accept: string, onLoad: (result: string, file: File) => void) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => onLoad(reader.result as string, file);
      reader.readAsDataURL(file);
    };
    input.click();
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
          <div className="perf-profile__avatar-wrap">
            {performer.photo ? (
              <img src={performer.photo} alt={performer.name} className="perf-profile__avatar" />
            ) : (
              <div className="perf-profile__avatar-placeholder">
                {performer.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <p className="perf-profile__photo-name">{performer.name}</p>
          <p className="perf-profile__photo-sub">Profile Photo</p>
          {!locked && (
            <button
              className="perf-profile__photo-link"
              onClick={() => pickFile('image/*', result => onChange({ ...performer, photo: result }))}
            >
              {performer.photo ? 'Update' : 'Upload'}
            </button>
          )}
          {performer.photo && !locked && (
            <button
              className="perf-profile__photo-remove"
              onClick={() => onChange({ ...performer, photo: undefined })}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {/* Media card */}
      <div className="perf-profile__card perf-profile__card--media">
        <p className="perf-profile__section-label">Media</p>
        <div className="perf-profile__media-grid">
          {performer.walkOnMusic && (
            <div className="perf-profile__media-tile">
              <p className="perf-profile__media-label">🎵 Walk-On Music</p>
              <audio controls preload="none" className="perf-profile__audio">
                <source src={performer.walkOnMusic} />
              </audio>
              {!locked && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onChange({ ...performer, walkOnMusic: undefined, walkOnMusicName: undefined })}
                >
                  Remove
                </button>
              )}
            </div>
          )}
          {performer.video && (
            <div className="perf-profile__media-tile">
              <p className="perf-profile__media-label">🎬 Video</p>
              <video src={performer.video} controls preload="none" className="perf-profile__video" />
              {!locked && (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onChange({ ...performer, video: undefined })}
                >
                  Remove
                </button>
              )}
            </div>
          )}
          {!locked && (
            <div className="perf-profile__upload-row">
              <button
                className="btn btn--secondary btn--sm"
                onClick={() =>
                  pickFile('audio/*', (result, file) => {
                    onChange({ ...performer, walkOnMusic: result, walkOnMusicName: file.name });
                    setSongName(file.name);
                  })
                }
              >
                🎵 {performer.walkOnMusic ? 'Replace Music' : 'Upload Walk-On Music'}
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => pickFile('video/*', result => onChange({ ...performer, video: result }))}
              >
                🎬 {performer.video ? 'Replace Video' : 'Upload Video'}
              </button>
            </div>
          )}
          {!performer.walkOnMusic && !performer.video && locked && (
            <p className="perf-profile__media-empty">No media uploaded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
