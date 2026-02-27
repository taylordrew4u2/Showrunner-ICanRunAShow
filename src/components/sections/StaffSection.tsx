import { useState } from 'react';
import type { StaffMember } from '../../types';
import { STAFF_ROLES } from '../../types';
import { generateId } from '../../utils/id';

interface StaffSectionProps {
  staff: StaffMember[];
  onChange: (staff: StaffMember[]) => void;
}

export function StaffSection({ staff, onChange }: StaffSectionProps) {
  const [role, setRole] = useState(STAFF_ROLES[0]);
  const [customRole, setCustomRole] = useState('');
  const [personName, setPersonName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('');
  const [editPerson, setEditPerson] = useState('');

  function addStaff() {
    const finalRole = role === 'Other' ? customRole.trim() : role;
    if (!finalRole || !personName.trim()) return;
    const member: StaffMember = { id: generateId(), role: finalRole, personName: personName.trim() };
    onChange([...staff, member]);
    setPersonName('');
    setCustomRole('');
  }

  function deleteStaff(id: string) {
    const member = staff.find((s) => s.id === id);
    if (window.confirm(`Delete "${member?.personName}" (${member?.role})? This cannot be undone.`)) {
      onChange(staff.filter((s) => s.id !== id));
    }
  }

  function startEdit(s: StaffMember) {
    setEditId(s.id);
    setEditRole(s.role);
    setEditPerson(s.personName);
  }

  function saveEdit() {
    if (!editRole.trim() || !editPerson.trim() || !editId) return;
    onChange(staff.map((s) =>
      s.id === editId ? { ...s, role: editRole.trim(), personName: editPerson.trim() } : s
    ));
    setEditId(null);
  }

  return (
    <div className="section-body">
      <div className="section-add-grid">
        <select
          className="section-field__select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {role === 'Other' && (
          <input
            className="section-field__input"
            value={customRole}
            onChange={(e) => setCustomRole(e.target.value)}
            placeholder="Custom role"
          />
        )}
        <input
          className="section-field__input"
          value={personName}
          onChange={(e) => setPersonName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addStaff())}
          placeholder="Person name"
        />
        <button className="btn btn--primary btn--sm" onClick={addStaff}>Add</button>
      </div>

      {staff.length === 0 && <p className="section-empty">No staff yet.</p>}

      <ul className="section-list">
        {staff.map((s) => (
          <li key={s.id} className="section-list-item">
            <div className="section-list-item__body">
              {editId === s.id ? (
                <div className="section-edit-row">
                  <input className="section-field__input" value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="Role" />
                  <input className="section-field__input" value={editPerson} onChange={(e) => setEditPerson(e.target.value)} placeholder="Person" autoFocus />
                  <button className="btn btn--primary btn--sm" onClick={saveEdit}>Save</button>
                  <button className="btn btn--ghost btn--sm" onClick={() => setEditId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <span className="section-list-item__badge">{s.role}</span>
                  <span className="section-list-item__name">{s.personName}</span>
                </>
              )}
            </div>
            {editId !== s.id && (
              <div className="section-list-item__actions">
                <button className="btn btn--ghost btn--sm" onClick={() => startEdit(s)}>✏️</button>
                <button className="btn btn--ghost btn--sm section-list-item__delete" onClick={() => deleteStaff(s.id)}>✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
