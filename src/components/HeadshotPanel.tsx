import { useEffect, useRef, useState } from 'react';
import { downscaleImage, FLYER_MAX_DIM } from '../utils/imageResize';
import { dataUrlToFile, imageUploadSizeError } from '../utils/media';
import { uploadMedia } from '../utils/mediaStore';
import { useMediaUrl } from '../utils/useMediaUrl';
import { useConfirm } from './useConfirm';

/** Shared by show performers and the saved comic profile. */
export function HeadshotPanel({ name, photo, onChange }: {
  name: string;
  photo?: string;
  onChange: (photo: string | undefined) => void;
}) {
  const url = useMediaUrl(photo);
  const input = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLDialogElement>(null);
  const change = useRef(onChange);
  useEffect(() => { change.current = onChange; }, [onChange]);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  async function upload(file: File) {
    if (uploading.current) return;
    const problem = imageUploadSizeError(file);
    if (problem || !file.type.startsWith('image/')) {
      setError(problem || 'Choose an image file, such as a JPEG or PNG.');
      return;
    }
    uploading.current = true;
    setBusy(true);
    setError(null);
    try {
      const ref = await uploadMedia(await downscaleImage(file, FLYER_MAX_DIM));
      change.current(ref);
      // Other shows may still reference the previous photo. Media cleanup
      // handles unreferenced files; replacing one profile must not delete it.
    } catch {
      setError('Could not upload that photo. Try a JPEG or PNG and check your connection.');
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  async function download() {
    if (!url) return;
    setError(null);
    try {
      // Media resolves to a data URL; decoding locally also works under the
      // production CSP, which does not allow fetching data: URLs.
      let blob: Blob | null = dataUrlToFile(url, 'headshot');
      if (!blob) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Download failed');
        blob = await response.blob();
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type] || 'jpg';
      link.href = href;
      link.download = `${name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'comic'}-headshot.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      setError('Could not download the headshot. Check your connection and try again.');
    }
  }

  return <section className="perf-profile__photo-panel" aria-label="Headshot" aria-busy={busy}>
    <p className="perf-profile__section-label">Headshot</p>
    {url ? <button className="headshot__preview-button" onClick={() => preview.current?.showModal()} aria-label={`View ${name}'s headshot`}>
      <img className="headshot__image" src={url} alt={`${name}'s headshot`} />
    </button> : <div className="perf-profile__avatar-wrap"><div className="perf-profile__avatar-placeholder">{name.charAt(0).toUpperCase()}</div></div>}
    {photo && !url && <p role="status" className="perf-profile__photo-hint">Loading headshot… If it does not appear, reopen the profile to retry.</p>}
    <input ref={input} type="file" accept="image/*" hidden aria-label="Choose headshot file" onChange={e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) void upload(file);
    }} />
    <button type="button" disabled={busy}
      className={`perf-profile__photo-drop${drag ? ' perf-profile__photo-drop--active' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={e => e.preventDefault()} onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void upload(file); }}>
      <strong>{busy ? 'Uploading headshot…' : photo ? 'Replace headshot' : 'Upload headshot'}</strong>
      <span className="perf-profile__photo-hint">Drag & drop a photo here, or click to choose</span>
    </button>
    <p className="perf-profile__photo-hint">Saved automatically. Images resized to fit 1400 px.</p>
    {error && <p role="alert" className="perf-profile__media-error">{error}</p>}
    {url && <div className="headshot__actions">
      <button className="btn btn--secondary btn--sm" onClick={() => preview.current?.showModal()}>View headshot</button>
      <button className="btn btn--secondary btn--sm" onClick={() => void download()}>Download headshot</button>
    </div>}
    {photo && <button className="perf-profile__photo-remove" disabled={busy} onClick={async () => {
      if (await confirm({ message: `Remove ${name}'s photo from this profile?`, confirmLabel: 'Remove photo' })) change.current(undefined);
    }}>Remove photo</button>}
    <dialog ref={preview} className="headshot__dialog" aria-label={`${name}'s headshot`}>
      <button className="btn btn--secondary btn--sm" autoFocus onClick={() => preview.current?.close()}>Close preview</button>
      {url && <img src={url} alt={`${name}'s full headshot`} />}
      <button className="btn btn--secondary btn--sm" onClick={() => void download()}>Download headshot</button>
    </dialog>
    {confirmDialog}
  </section>;
}
