import { useState, useCallback, useRef, useEffect } from 'react';
import type { Show, AppSettings } from '../types';
import { loadSettings } from '../utils/storage';
import { exportShowToPDF } from '../utils/pdfExport';
import { BasicInfoSection } from './sections/BasicInfoSection';
import { PerformersSection } from './sections/PerformersSection';
import { ArtistsSection } from './sections/ArtistsSection';
import { ScheduleSection } from './sections/ScheduleSection';
import { HostsSection } from './sections/HostsSection';
import { DJMusicSection } from './sections/DJMusicSection';
import { StaffSection } from './sections/StaffSection';
import { ExpensesSection } from './sections/ExpensesSection';
import './ShowDetail.css';

interface ShowDetailProps {
  show: Show;
  onBack: () => void;
  onUpdate: (show: Show) => void;
}

type SectionKey = 'basicInfo' | 'performers' | 'artists' | 'schedule' | 'hosts' | 'djMusic' | 'staff' | 'expenses';

const SECTIONS: { key: SectionKey; label: string; countKey?: keyof Show }[] = [
  { key: 'basicInfo', label: '1. Basic Show Info' },
  { key: 'performers', label: '2. Performers', countKey: 'performers' },
  { key: 'artists', label: '3. Artists', countKey: 'artists' },
  { key: 'schedule', label: '4. Schedule & Timing', countKey: 'schedule' },
  { key: 'hosts', label: '5. Hosts', countKey: 'hosts' },
  { key: 'djMusic', label: '6. DJ Music List', countKey: 'djSongs' },
  { key: 'staff', label: '7. Staff & Crew', countKey: 'staff' },
  { key: 'expenses', label: '8. Itemized Expenses', countKey: 'expenses' },
];

export function ShowDetail({ show, onBack, onUpdate }: ShowDetailProps) {
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    basicInfo: true,
    performers: false,
    artists: false,
    schedule: false,
    hosts: false,
    djMusic: false,
    staff: false,
    expenses: false,
  });
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(show.name);
  const [editingDate, setEditingDate] = useState(false);
  const [dateValue, setDateValue] = useState(show.date);

  useEffect(() => {
    setNameValue(show.name);
    setDateValue(show.date);
  }, [show.name, show.date]);

  const updateShow = useCallback(
    (updates: Partial<Show>) => {
      onUpdate({ ...show, ...updates });
    },
    [show, onUpdate]
  );

  function toggleSection(key: SectionKey) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function saveName() {
    if (nameValue.trim()) {
      updateShow({ name: nameValue.trim() });
    }
    setEditingName(false);
  }

  function saveDate() {
    updateShow({ date: dateValue });
    setEditingDate(false);
  }

  function getCount(key?: keyof Show): number | undefined {
    if (!key) return undefined;
    const val = show[key];
    return Array.isArray(val) ? val.length : undefined;
  }

  function handleExportPDF() {
    exportShowToPDF(show, settings);
  }

  function renderSection(key: SectionKey) {
    switch (key) {
      case 'basicInfo':
        return <BasicInfoSection show={show} onChange={updateShow} />;
      case 'performers':
        return <PerformersSection performers={show.performers} onChange={(performers) => updateShow({ performers })} />;
      case 'artists':
        return <ArtistsSection artists={show.artists ?? []} onChange={(artists) => updateShow({ artists })} />;
      case 'schedule':
        return <ScheduleSection schedule={show.schedule} onChange={(schedule) => updateShow({ schedule })} />;
      case 'hosts':
        return <HostsSection hosts={show.hosts} onChange={(hosts) => updateShow({ hosts })} />;
      case 'djMusic':
        return <DJMusicSection songs={show.djSongs} show={show} onChange={(djSongs) => updateShow({ djSongs })} />;
      case 'staff':
        return <StaffSection staff={show.staff} onChange={(staff) => updateShow({ staff })} />;
      case 'expenses':
        return <ExpensesSection expenses={show.expenses} onChange={(expenses) => updateShow({ expenses })} />;
    }
  }

  return (
    <div className="show-detail">
      <button className="show-detail__back btn btn--ghost" onClick={onBack}>
        ← Back
      </button>

      <div className="show-detail__header">
        {editingName ? (
          <div className="show-detail__edit-name">
            <input
              className="show-detail__name-input"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              autoFocus
            />
          </div>
        ) : (
          <h2
            className="show-detail__title"
            onClick={() => setEditingName(true)}
            title="Click to edit"
          >
            {show.name}
          </h2>
        )}
      </div>

      <div className="show-detail__meta">
        {editingDate ? (
          <input
            className="show-detail__date-input"
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            onBlur={saveDate}
            autoFocus
          />
        ) : (
          <span onClick={() => setEditingDate(true)} style={{ cursor: 'pointer' }}>
            📅 {show.date || 'Set date'}
          </span>
        )}
        {show.venueName && <span>📍 {show.venueName}</span>}
        {show.time && <span>🕐 {show.time}</span>}
      </div>

      {/* Sections */}
      {SECTIONS.map(({ key, label, countKey }) => {
        const count = getCount(countKey);
        return (
          <div key={key} className="show-detail__section">
            <button
              className={`show-detail__section-header ${expanded[key] ? 'show-detail__section-header--expanded' : ''}`}
              onClick={() => toggleSection(key)}
            >
              <span className="show-detail__section-title">
                {label}
                {count !== undefined && count > 0 && (
                  <span className="show-detail__section-badge">{count}</span>
                )}
              </span>
              <span className="show-detail__section-arrow">{expanded[key] ? '▲' : '▼'}</span>
            </button>
            {expanded[key] && renderSection(key)}
          </div>
        );
      })}

      {/* Export PDF */}
      <button className="btn btn--primary show-detail__export" onClick={handleExportPDF}>
        📄 Export to PDF
      </button>
    </div>
  );
}
