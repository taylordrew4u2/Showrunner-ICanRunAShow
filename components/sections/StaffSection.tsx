import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { StaffMember, STAFF_ROLES } from '../../utils/types';
import { generateId } from '../../utils/storage';

interface Props {
  staff: StaffMember[];
  onChange: (staff: StaffMember[]) => void;
}

const EMPTY = { role: STAFF_ROLES[0], personName: '' };

export default function StaffSection({ staff, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [customRole, setCustomRole] = useState('');

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setCustomRole('');
    setModalVisible(true);
  };

  const openEdit = (s: StaffMember) => {
    setEditing(s);
    const isPreset = STAFF_ROLES.includes(s.role);
    setDraft({ role: isPreset ? s.role : 'Other', personName: s.personName });
    setCustomRole(isPreset ? '' : s.role);
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.personName.trim()) {
      Alert.alert('Name required', 'Please enter the person\'s name.');
      return;
    }
    const finalRole = draft.role === 'Other' && customRole.trim() ? customRole.trim() : draft.role;
    if (editing) {
      onChange(staff.map((s) => (s.id === editing.id ? { ...editing, role: finalRole, personName: draft.personName } : s)));
    } else {
      onChange([...staff, { id: generateId(), role: finalRole, personName: draft.personName }]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Staff', 'Remove this staff member?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(staff.filter((s) => s.id !== id)) },
    ]);
  };

  return (
    <View style={styles.container}>
      {staff.length === 0 ? (
        <Text style={styles.empty}>No staff or crew added yet.</Text>
      ) : (
        staff.map((s) => (
          <View key={s.id} style={styles.row}>
            <View style={styles.roleTag}>
              <Text style={styles.roleTagText}>{s.role}</Text>
            </View>
            <Text style={styles.personName}>{s.personName}</Text>
            <TouchableOpacity onPress={() => openEdit(s)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(s.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Staff / Crew</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Staff Member' : 'Add Staff Member'}</Text>

            <Text style={styles.fieldLabel}>Role</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.rolesScroll}>
              <View style={styles.rolesRow}>
                {STAFF_ROLES.map((role) => (
                  <TouchableOpacity
                    key={role}
                    style={[styles.roleChip, draft.role === role && styles.roleChipActive]}
                    onPress={() => setDraft((d) => ({ ...d, role }))}
                  >
                    <Text style={[styles.roleChipText, draft.role === role && styles.roleChipTextActive]}>
                      {role}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {draft.role === 'Other' && (
              <>
                <Text style={styles.fieldLabel}>Custom Role</Text>
                <TextInput
                  style={styles.input}
                  value={customRole}
                  onChangeText={setCustomRole}
                  placeholder="e.g. Costume Designer"
                  placeholderTextColor="#9CA3AF"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Person Name *</Text>
            <TextInput
              style={styles.input}
              value={draft.personName}
              onChangeText={(v) => setDraft((d) => ({ ...d, personName: v }))}
              placeholder="Full name"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  empty: { color: '#9CA3AF', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  roleTag: { backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 },
  roleTagText: { color: '#6B46C1', fontSize: 11, fontWeight: '700' },
  personName: { flex: 1, fontSize: 14, color: '#1F2937' },
  editBtn: { backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  editBtnText: { color: '#6B46C1', fontSize: 12, fontWeight: '600' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { color: '#EF4444', fontSize: 14 },
  addBtn: { marginTop: 10, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  addBtnText: { color: '#6B46C1', fontWeight: '600', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 5, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  rolesScroll: { marginBottom: 4 },
  rolesRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  roleChip: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#F9FAFB' },
  roleChipActive: { backgroundColor: '#6B46C1', borderColor: '#6B46C1' },
  roleChipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  roleChipTextActive: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1F2937', backgroundColor: '#F9FAFB' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#6B46C1', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
