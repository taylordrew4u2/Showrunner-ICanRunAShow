import { useState } from 'react';
import type { ShowFile } from '../../types';
import { generateId } from '../../utils/id';

interface FilesSectionProps {
  files: ShowFile[];
  onChange: (files: ShowFile[]) => void;
}

export function FilesSection({ files, onChange }: FilesSectionProps) {
  const [notes, setNotes] = useState('');

  function handleFileUpload() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '*/*';
    input.multiple = true;
    input.onchange = () => {
      const selectedFiles = input.files;
      if (!selectedFiles || selectedFiles.length === 0) return;

      const filePromises = Array.from(selectedFiles).map((file) => {
        return new Promise<ShowFile>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const newFile: ShowFile = {
              id: generateId(),
              name: file.name,
              fileData: reader.result as string,
              fileType: file.type || 'application/octet-stream',
              uploadedAt: new Date().toISOString(),
              notes: notes.trim() || undefined,
            };
            resolve(newFile);
          };
          reader.readAsDataURL(file);
        });
      });

      Promise.all(filePromises).then((newFiles) => {
        onChange([...files, ...newFiles]);
        setNotes('');
      });
    };
    input.click();
  }

  function deleteFile(id: string) {
    const file = files.find((f) => f.id === id);
    // Double confirmation to prevent accidental deletion
    if (window.confirm(`Delete "${file?.name}"? This cannot be undone.`) &&
        window.confirm(`Final confirmation: This will permanently delete "${file?.name}". Are you sure?`)) {
      onChange(files.filter((f) => f.id !== id));
    }
  }

  function downloadFile(file: ShowFile) {
    const link = document.createElement('a');
    link.href = file.fileData;
    link.download = file.name;
    link.click();
  }

  function updateNotes(id: string, newNotes: string) {
    onChange(files.map((f) => (f.id === id ? { ...f, notes: newNotes || undefined } : f)));
  }

  return (
    <div className="section-body">
      <div className="section-add-row">
        <input
          className="section-field__input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
        />
        <button className="btn btn--primary btn--sm" onClick={handleFileUpload}>
          📎 Upload Files
        </button>
      </div>

      {files.length === 0 && <p className="section-empty">No files uploaded yet.</p>}

      <ul className="section-list">
        {files.map((file) => (
          <li key={file.id} className="section-list-item">
            <div className="section-list-item__body">
              <span className="section-list-item__name">📄 {file.name}</span>
              <span className="section-list-item__tag">
                {new Date(file.uploadedAt).toLocaleDateString()}
              </span>
              {file.notes && <span className="section-list-item__tag">📝 {file.notes}</span>}
            </div>
            <div className="section-list-item__actions">
              <input
                className="section-field__input section-field__input--compact"
                value={file.notes || ''}
                onChange={(e) => updateNotes(file.id, e.target.value)}
                placeholder="Add notes"
                style={{ minWidth: 160 }}
              />
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => downloadFile(file)}
                title="Download file"
              >
                ⬇️
              </button>
              <button
                className="btn btn--ghost btn--sm section-list-item__delete"
                onClick={() => deleteFile(file.id)}
                title="Delete"
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
