import React, { useState, useEffect } from 'react';
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
              <TouchableOpacity 
                style={styles.orderBtn} 
                onPress={() => moveUp(i)} 
                disabled={i === 0}
              >
                <Text style={[styles.orderBtnText, i === 0 && styles.disabled]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.orderBtn}
                onPress={() => moveDown(i)} 
                disabled={i === schedule.length - 1}
              >
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
  container: { 
    backgroundColor: '#fff', 
    borderRadius: 14, 
    padding: 16, 
    marginBottom: 10 
  },
  empty: { 
    color: '#9CA3AF', 
    fontStyle: 'italic', 
    textAlign: 'center', 
    paddingVertical: 16,
    fontSize: 14,
    lineHeight: 20,
  },
  row: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    paddingVertical: 12, 
    borderBottomWidth: 1, 
    borderBottomColor: '#F3F4F6',
    minHeight: 52,
  },
  orderBtns: { 
    marginRight: 8, 
    alignItems: 'center', 
    gap: 4,
    minWidth: 44,
    justifyContent: 'center',
  },
  orderBtn: { 
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 6,
  },
  orderBtnText: { 
    fontSize: 13, 
    color: '#6B46C1',
    fontWeight: '600',
  },
  disabled: { 
    color: '#D1D5DB' 
  },
  info: { 
    flex: 1 
  },
  time: { 
    fontSize: 13, 
    fontWeight: '700', 
    color: '#6B46C1', 
    marginBottom: 2,
    lineHeight: 18,
  },
  desc: { 
    fontSize: 15, 
    color: '#1F2937',
    lineHeight: 20,
  },
  editBtn: { 
    backgroundColor: '#EDE9FE', 
    borderRadius: 8, 
    paddingHorizontal: 12, 
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
    marginRight: 8,
  },
  editBtnText: { 
    color: '#6B46C1', 
    fontSize: 14, 
    fontWeight: '600' 
  },
  deleteBtn: { 
    padding: 10,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: { 
    color: '#EF4444', 
    fontSize: 16,
    fontWeight: '600',
  },
  addBtn: { 
    marginTop: 12, 
    backgroundColor: '#F3F4F6', 
    borderRadius: 10, 
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: '#E5E7EB', 
    borderStyle: 'dashed',
    minHeight: 48,
    justifyContent: 'center',
  },
  addBtnText: { 
    color: '#6B46C1', 
    fontWeight: '600', 
    fontSize: 16,
    lineHeight: 20,
  },
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(0,0,0,0.55)', 
    justifyContent: 'flex-end' 
  },
  modal: { 
    backgroundColor: '#fff', 
    borderTopLeftRadius: 20, 
    borderTopRightRadius: 20, 
    padding: 24, 
    paddingBottom: 40 
  },
  modalTitle: { 
    fontSize: 20, 
    fontWeight: '700', 
    color: '#1F2937', 
    marginBottom: 20,
    lineHeight: 28,
  },
  fieldLabel: { 
    fontSize: 13, 
    fontWeight: '600', 
    color: '#374151', 
    marginBottom: 8, 
    marginTop: 14, 
    textTransform: 'uppercase', 
    letterSpacing: 0.4 
  },
  input: { 
    borderWidth: 1, 
    borderColor: '#D1D5DB', 
    borderRadius: 10, 
    paddingHorizontal: 14, 
    paddingVertical: 13, 
    fontSize: 16, 
    color: '#1F2937', 
    backgroundColor: '#F9FAFB',
    minHeight: 48,
    lineHeight: 20,
  },
  modalBtns: { 
    flexDirection: 'row', 
    gap: 12, 
    marginTop: 28 
  },
  cancelBtn: { 
    flex: 1, 
    backgroundColor: '#F3F4F6', 
    borderRadius: 10, 
    paddingVertical: 14, 
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  cancelBtnText: { 
    color: '#374151', 
    fontWeight: '600', 
    fontSize: 16,
    lineHeight: 20,
  },
  saveBtn: { 
    flex: 1, 
    backgroundColor: '#6B46C1', 
    borderRadius: 10, 
    paddingVertical: 14, 
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  saveBtnText: { 
    color: '#fff', 
    fontWeight: '700', 
    fontSize: 16,
    lineHeight: 20,
  },
});
