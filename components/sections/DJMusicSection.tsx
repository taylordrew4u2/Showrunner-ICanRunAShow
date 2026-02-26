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
import { DJSong } from '../../utils/types';
import { generateId } from '../../utils/storage';
import { exportDJListAsText } from '../../utils/pdfExport';
import { Show } from '../../utils/types';

interface Props {
  songs: DJSong[];
  show: Show;
  onChange: (songs: DJSong[]) => void;
}

const EMPTY = { title: '', artist: '', notes: '' };

export default function DJMusicSection({ songs, show, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<DJSong | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [exporting, setExporting] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setModalVisible(true);
  };

  const openEdit = (s: DJSong) => {
    setEditing(s);
    setDraft({ title: s.title, artist: s.artist, notes: s.notes ?? '' });
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.title.trim()) {
      Alert.alert('Title required', 'Please enter a song title.');
      return;
    }
    if (editing) {
      onChange(songs.map((s) => (s.id === editing.id ? { ...editing, ...draft } : s)));
    } else {
      onChange([...songs, { id: generateId(), ...draft }]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Song', 'Remove this song from the list?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(songs.filter((s) => s.id !== id)) },
    ]);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const arr = [...songs];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    onChange(arr);
  };

  const moveDown = (index: number) => {
    if (index === songs.length - 1) return;
    const arr = [...songs];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    onChange(arr);
  };

  const handleExport = async () => {
    if (songs.length === 0) {
      Alert.alert('No songs', 'Add songs to the DJ list before exporting.');
      return;
    }
    setExporting(true);
    try {
      await exportDJListAsText(show);
    } catch (e) {
      Alert.alert('Export failed', String(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={styles.container}>
      {songs.length === 0 ? (
        <Text style={styles.empty}>No songs in the DJ list yet.</Text>
      ) : (
        songs.map((s, i) => (
          <View key={s.id} style={styles.row}>
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
                disabled={i === songs.length - 1}
              >
                <Text style={[styles.orderBtnText, i === songs.length - 1 && styles.disabled]}>▼</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.num}>{i + 1}</Text>
            <View style={styles.info}>
              <Text style={styles.songTitle}>{s.title}</Text>
              <Text style={styles.songArtist}>{s.artist}</Text>
              {s.notes ? <Text style={styles.meta}>{s.notes}</Text> : null}
            </View>
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
        <Text style={styles.addBtnText}>+ Add Song</Text>
      </TouchableOpacity>

      {songs.length > 0 && (
        <TouchableOpacity style={styles.exportBtn} onPress={handleExport} disabled={exporting}>
          <Text style={styles.exportBtnText}>{exporting ? 'Exporting...' : '📤 Share DJ List as PDF'}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Song' : 'Add Song'}</Text>

            <Text style={styles.fieldLabel}>Song Title *</Text>
            <TextInput
              style={styles.input}
              value={draft.title}
              onChangeText={(v) => setDraft((d) => ({ ...d, title: v }))}
              placeholder="e.g. Dancing Queen"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Artist</Text>
            <TextInput
              style={styles.input}
              value={draft.artist}
              onChangeText={(v) => setDraft((d) => ({ ...d, artist: v }))}
              placeholder="e.g. ABBA"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Notes</Text>
            <TextInput
              style={styles.input}
              value={draft.notes}
              onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
              placeholder="e.g. Play at 9:30 PM"
              placeholderTextColor="#9CA3AF"
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
  num: { 
    fontSize: 13, 
    fontWeight: '700', 
    color: '#9CA3AF', 
    width: 24, 
    textAlign: 'right', 
    marginRight: 10,
    lineHeight: 18,
  },
  info: { 
    flex: 1 
  },
  songTitle: { 
    fontSize: 15, 
    fontWeight: '600', 
    color: '#1F2937',
    lineHeight: 20,
  },
  songArtist: { 
    fontSize: 13, 
    color: '#6B7280',
    lineHeight: 18,
    marginTop: 2,
  },
  meta: { 
    fontSize: 12, 
    color: '#9CA3AF', 
    fontStyle: 'italic', 
    marginTop: 2,
    lineHeight: 16,
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
  exportBtn: { 
    marginTop: 12, 
    backgroundColor: '#EDE9FE', 
    borderRadius: 10, 
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  exportBtnText: { 
    color: '#6B46C1', 
    fontWeight: '700', 
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
