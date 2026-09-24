import { useState } from 'react';
import type { AppSettings, SignedAgreement } from '../types';
import { uploadMedia, resolveMediaUrl } from '../utils/mediaStore';
import { dataUrlToFile } from '../utils/media';
import { generateId } from '../utils/id';
import { contractNameFromFile } from '../utils/contracts';

interface Props {
  settings: AppSettings;
  onUpdateSettings: (settings: AppSettings) => void;
}

function AgreementDownload({ agreement }: { agreement: SignedAgreement }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function download() {
    setBusy(true);
    setError(false);
    try {
      const data = await resolveMediaUrl(agreement.fileRef);
      if (!data) throw new Error('File unavailable');
      const downloaded = dataUrlToFile(data, agreement.fileName);
      if (!downloaded) throw new Error('Invalid file');
      const url = URL.createObjectURL(downloaded);
      const link = document.createElement('a');
      link.href = url;
      link.download = agreement.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return <div>
    <button type="button" className="btn btn--secondary btn--sm" disabled={busy} onClick={() => void download()}>
      {busy ? 'Loading…' : 'Download'}
    </button>
    {error && <p role="alert">Could not load the file. Check your connection and try again.</p>}
  </div>;
}

export function SignedAgreements({ settings, onUpdateSettings }: Props) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [category, setCategory] = useState<SignedAgreement['category']>('venue');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const agreements = settings.signedAgreements ?? [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !name.trim() || busy) return;
    setError('');
    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
      setError('Choose a non-empty PDF no larger than 20 MB.');
      return;
    }
    setBusy(true);
    try {
      // Check the bytes, including PDFs from file pickers with an empty MIME type.
      const header = await file.slice(0, 5).text();
      if (header !== '%PDF-') {
        setError('Choose a PDF of your signed agreement.');
        return;
      }
      const pdf = new File([file], file.name, { type: 'application/pdf' });
      const fileRef = await uploadMedia(pdf);
      const agreement: SignedAgreement = {
        id: generateId(), name: name.trim(), counterparty: counterparty.trim(), category,
        fileRef, fileName: file.name, sizeBytes: file.size, uploadedAt: new Date().toISOString(),
      };
      onUpdateSettings({ ...settings, signedAgreements: [agreement, ...agreements] });
      setAdding(false);
      setName('');
      setCounterparty('');
      setFile(null);
    } catch {
      setError('Upload did not finish. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const form = <form className="signed-agreements__form" onSubmit={save}>
      <fieldset disabled={busy}>
        <label>Agreement name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
        <label>Venue or producer name (optional)<input maxLength={200} value={counterparty} onChange={e => setCounterparty(e.target.value)} /></label>
        <label>Signed PDF<input type="file" required accept="application/pdf,.pdf" onChange={e => {
          const picked = e.target.files?.[0] ?? null;
          setFile(picked);
          setError('');
          if (picked && !name.trim()) setName(contractNameFromFile(picked.name));
        }} /></label>
        <div className="signed-agreements__actions">
          <button className="btn btn--primary" type="submit">{busy ? 'Uploading…' : 'Save signed agreement'}</button>
          <button className="btn btn--ghost" type="button" onClick={() => { setAdding(false); setFile(null); setError(''); }}>Cancel</button>
        </div>
      </fieldset>
      {error && <p className="contracts__error" role="alert">{error}</p>}
    </form>;

  return <section className="signed-agreements" aria-labelledby="signed-agreements-title">
    <h2 id="signed-agreements-title" className="contracts__section-label">Signed agreements</h2>
    <p>Upload copies of agreements already signed. PDF, up to 20 MB.</p>
    {(['venue', 'producer'] as const).map(group => {
      const visible = agreements.filter(a => a.category === group);
      const title = group === 'venue' ? 'Venue contracts' : 'Producer contracts';
      return <section key={group} className="signed-agreements__group" aria-label={title}>
        <div className="signed-agreements__heading">
          <h3>{title}</h3>
          <button type="button" className="btn btn--primary btn--sm" disabled={busy}
            onClick={() => { setCategory(group); setAdding(true); setFile(null); setName(''); setCounterparty(''); setError(''); }}>
            Upload signed {group} contract
          </button>
        </div>
        {adding && category === group && <div key={group}>{form}</div>}
        {visible.length === 0 ? <p className="contracts__empty">No signed {group} contracts yet.</p> :
          <ul className="contracts__list signed-agreements__list">{visible.map(a => <li className="contracts__item" key={a.id}>
            <div className="contracts__item-main">
              <span className="contracts__item-name">{a.name}</span>
              {a.counterparty && <span className="contracts__item-meta">{a.counterparty}</span>}
              <span className="contracts__item-meta">{a.fileName} · {(a.sizeBytes / 1024).toFixed(1)} KB · Uploaded {new Date(a.uploadedAt).toLocaleDateString()}</span>
            </div>
            <AgreementDownload agreement={a} />
          </li>)}</ul>}
      </section>;
    })}
  </section>;
}
