import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
} from 'react-native';
import { ScheduleItem } from '../../utils/types';
import { generateId } from '../../utils/storage';

interface Props {
  schedule: ScheduleItem[];
  onChange: (schedule: ScheduleItem[]) => void;
}

const EMPTY = { time: '', description: '' };

export default function ScheduleSection({ schedule, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ScheduleItem | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setModalVisible(true);
  };

  const openEdit = (item: ScheduleItem) => {
    setEditing(item);
    setDraft({ time: item.time, description: item.description });
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.description.trim()) {
      Alert.alert('Description required', 'Please enter a description for this schedule item.');
      return;
    }
    if (editing) {
      onChange(schedule.map((s) => (s.id === editing.id ? { ...editing, ...draft } : s)));
    } else {
      onChange([...schedule, { id: generateId(), ...draft }]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Item', 'Remove this schedule item?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(schedule.filter((s) => s.id !== id)) },
    ]);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const arr = [...schedule];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    onChange(arr);
  };

  const moveDown = (index: number) => {
    if (index === schedule.length - 1) return;
    const arr = [...schedule];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    onChange(arr);
  };

  return (
    <View style={styles.container}>
      {schedule.length === 0 ? (
        <Text style={styles.empty}>No schedule items yet.</Text>
      ) : (
        schedule.map((item, i) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.orderBtns}>
              <TouchableOpacity onPress={() => moveUp(i)} disabled={i === 0}>
                <Text style={[styles.orderBtnText, i === 0 && styles.disabled]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveDown(i)} disabled={i === schedule.length - 1}>
                <Text style={[styles.orderBtnText, i === schedule.length - 1 && styles.disabled]}>▼</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.info}>
              {item.time ? <Text style={styles.time}>{item.time}</Text> : null}
              <Text style={styles.desc}>{item.description}</Text>
            </View>
            <TouchableOpacity onPress={() => openEdit(item)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(item.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Schedule Item</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Schedule Item' : 'Add Schedule Item'}</Text>

            <Text style={styles.fieldLabel}>Time</Text>
            <TextInput
              style={styles.input}
              value={draft.time}
              onChangeText={(v) => setDraft((d) => ({ ...d, time: v }))}
              placeholder="e.g. 7:00 PM"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Description *</Text>
            <TextInput
              style={styles.input}
              value={draft.description}
              onChangeText={(v) => setDraft((d) => ({ ...d, description: v }))}
              placeholder="e.g. Doors Open"
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
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  empty: { color: '#9CA3AF', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  orderBtns: { marginRight: 8, alignItems: 'center', gap: 2 },
  orderBtnText: { fontSize: 11, color: '#6B46C1', paddingVertical: 2 },
  disabled: { color: '#D1D5DB' },
  info: { flex: 1 },
  time: { fontSize: 12, fontWeight: '700', color: '#6B46C1', marginBottom: 1 },
  desc: { fontSize: 14, color: '#1F2937' },
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
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1F2937', backgroundColor: '#F9FAFB' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#6B46C1', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
