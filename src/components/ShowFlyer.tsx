import { useEffect, useRef, useState } from 'react';
import { downscaleImage, FLYER_MAX_DIM } from '../utils/imageResize';
import { dataUrlToFile, imageUploadSizeError } from '../utils/media';
import { uploadMedia } from '../utils/mediaStore';
import { useMediaUrl } from '../utils/useMediaUrl';
import { useConfirm } from './useConfirm';

/**
 * The show's flyer, kept next to the lineup it advertises.
 *
 * Producers make flyers in whatever design tool they like; what they were
 * missing was one place per show to keep the finished file, so it can be
 * pulled up at the door or sent to a venue without digging through a camera
 * roll. Replacing one does not delete the old file here — the media cleanup
 * removes it once nothing else points at it, and a duplicated show may.
 */
export function ShowFlyer({ showName, flyer, onChange }: {
  showName: string;
  flyer?: string;
  onChange: (flyer: string | undefined) => void;
}) {
  const url = useMediaUrl(flyer);
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
      change.current(await uploadMedia(await downscaleImage(file, FLYER_MAX_DIM)));
    } catch {
      setError('Could not upload that flyer. Try a JPEG or PNG and check your connection.');
    } finally {
      uploading.current = false;
      setBusy(false);
    }
  }

  async function download() {
    if (!url) return;
    setError(null);
    try {
      // Decoded locally: the production CSP does not allow fetching data: URLs.
      let blob: Blob | null = dataUrlToFile(url, 'flyer');
      if (!blob) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Download failed');
        blob = await response.blob();
      }
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const extension = ({ 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[blob.type] || 'jpg';
      link.href = href;
      link.download = `${showName.replace(/[^a-z0-9 _-]/gi, '').trim() || 'show'}-flyer.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      setError('Could not download the flyer. Check your connection and try again.');
    }
  }

  return <section className="show-flyer" aria-label="Flyer" aria-busy={busy}>
    <h2 className="show-flyer__title">Flyer</h2>
    {url && <button type="button" className="show-flyer__preview" onClick={() => preview.current?.showModal()} aria-label={`View the flyer for ${showName}`}>
      <img src={url} alt={`Flyer for ${showName}`} />
    </button>}
    {flyer && !url && <p role="status" className="show-flyer__hint">Loading flyer… If it does not appear, reopen the show to retry.</p>}
    <input ref={input} type="file" accept="image/*" hidden aria-label="Choose flyer file" onChange={e => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) void upload(file);
    }} />
    <button type="button" disabled={busy}
      className={`show-flyer__drop${drag ? ' show-flyer__drop--active' : ''}`}
      onClick={() => input.current?.click()}
      onDragOver={e => e.preventDefault()} onDragEnter={() => setDrag(true)} onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); const file = e.dataTransfer.files[0]; if (file) void upload(file); }}>
      <strong>{busy ? 'Uploading flyer…' : flyer ? 'Replace flyer' : 'Upload flyer'}</strong>
      <span className="show-flyer__hint">Drag & drop an image, or click to choose</span>
    </button>
    {error && <p role="alert" className="show-flyer__error">{error}</p>}
    {flyer && <div className="show-flyer__actions">
      {url && <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download()}>Download</button>}
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={async () => {
        if (await confirm({ message: `Remove the flyer from ${showName}?`, confirmLabel: 'Remove flyer' })) change.current(undefined);
      }}>Remove</button>
    </div>}
    <dialog ref={preview} className="headshot__dialog" aria-label={`Flyer for ${showName}`}>
      <button type="button" className="btn btn--secondary btn--sm" autoFocus onClick={() => preview.current?.close()}>Close preview</button>
      {url && <img src={url} alt={`Full flyer for ${showName}`} />}
      <button type="button" className="btn btn--secondary btn--sm" onClick={() => void download()}>Download flyer</button>
    </dialog>
    {confirmDialog}
  </section>;
}
