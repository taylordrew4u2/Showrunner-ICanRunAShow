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
import { AppSettings, Show } from '../../utils/types';

interface Props {
  songs: DJSong[];
  show: Show;
  settings: AppSettings;
  onChange: (songs: DJSong[]) => void;
}

const EMPTY = { title: '', artist: '', notes: '' };

export default function DJMusicSection({ songs, show, settings, onChange }: Props) {
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
              <TouchableOpacity onPress={() => moveUp(i)} disabled={i === 0}>
                <Text style={[styles.orderBtnText, i === 0 && styles.disabled]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveDown(i)} disabled={i === songs.length - 1}>
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
  container: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  empty: { color: '#9CA3AF', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  orderBtns: { marginRight: 6, alignItems: 'center', gap: 2 },
  orderBtnText: { fontSize: 11, color: '#6B46C1', paddingVertical: 2 },
  disabled: { color: '#D1D5DB' },
  num: { fontSize: 12, fontWeight: '700', color: '#9CA3AF', width: 22, textAlign: 'right', marginRight: 8 },
  info: { flex: 1 },
  songTitle: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  songArtist: { fontSize: 12, color: '#6B7280' },
  meta: { fontSize: 11, color: '#9CA3AF', fontStyle: 'italic', marginTop: 1 },
  editBtn: { backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  editBtnText: { color: '#6B46C1', fontSize: 12, fontWeight: '600' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { color: '#EF4444', fontSize: 14 },
  addBtn: { marginTop: 10, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  addBtnText: { color: '#6B46C1', fontWeight: '600', fontSize: 14 },
  exportBtn: { marginTop: 10, backgroundColor: '#EDE9FE', borderRadius: 8, paddingVertical: 11, alignItems: 'center' },
  exportBtnText: { color: '#6B46C1', fontWeight: '700', fontSize: 14 },
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
