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
    if (window.confirm(`Delete "${file?.name}"? This cannot be undone.`)) {
      onChange(files.filter((f) => f.id !== id));
    }
  }

  function downloadFile(file: ShowFile) {
    const link = document.createElement('a');
    link.href = file.fileData;
    link.download = file.name;
    link.click();
  }


  return (
    <div className="section-body">
      <div className="section-add-row">
        <input
          className="section-field__input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          aria-label="File notes"
        />
        <button className="btn btn--primary btn--sm" onClick={handleFileUpload}>
          Upload Files
        </button>
      </div>

      {files.length === 0 && <p className="section-empty">No files uploaded yet.</p>}

      <div className="media-grid">
        {files.map((file) => (
          <div key={file.id} className={`media-grid__tile ${file.fileType.startsWith('audio') ? 'media-grid__tile--wide' : ''}`}>
            {file.fileType.startsWith('image') ? (
              <img src={file.fileData} alt={file.name} className="media-grid__preview" />
            ) : file.fileType.startsWith('video') ? (
              <video src={file.fileData} controls preload="none" className="media-grid__preview media-grid__preview--video" />
            ) : file.fileType.startsWith('audio') ? (
              <div className="media-grid__audio">
                <audio controls preload="none"><source src={file.fileData} type={file.fileType} /></audio>
              </div>
            ) : (
              <button className="media-grid__file-icon" onClick={() => downloadFile(file)} aria-label={`Download ${file.name}`}>File</button>
            )}
            <span className="media-grid__label" title={file.name}>
              {file.name}
              {file.notes ? ` · ${file.notes}` : ''}
            </span>
            <button className="media-grid__remove" onClick={() => deleteFile(file.id)} title="Delete file">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
