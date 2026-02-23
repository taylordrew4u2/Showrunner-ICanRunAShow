import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { Artist } from '../../utils/types';
import { generateId } from '../../utils/storage';
import { pickImage, pickAudioFile, pickVideo, fileBaseName } from '../../utils/filePicker';

interface Props {
  artists: Artist[];
  onChange: (artists: Artist[]) => void;
}

const EMPTY: Omit<Artist, 'id'> = { name: '', walkOnMusic: undefined, photo: undefined, video: undefined };

export default function ArtistsSection({ artists, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Artist | null>(null);
  const [draft, setDraft] = useState<Omit<Artist, 'id'>>(EMPTY);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setModalVisible(true);
  };

  const openEdit = (a: Artist) => {
    setEditing(a);
    setDraft({ name: a.name, walkOnMusic: a.walkOnMusic, photo: a.photo, video: a.video });
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Please enter an artist name.');
      return;
    }
    if (editing) {
      onChange(artists.map((a) => (a.id === editing.id ? { ...editing, ...draft } : a)));
    } else {
      onChange([...artists, { id: generateId(), ...draft }]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Artist', 'Remove this artist?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(artists.filter((a) => a.id !== id)) },
    ]);
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const arr = [...artists];
    [arr[index - 1], arr[index]] = [arr[index], arr[index - 1]];
    onChange(arr);
  };

  const moveDown = (index: number) => {
    if (index === artists.length - 1) return;
    const arr = [...artists];
    [arr[index], arr[index + 1]] = [arr[index + 1], arr[index]];
    onChange(arr);
  };

  return (
    <View style={styles.container}>
      {artists.length === 0 ? (
        <Text style={styles.empty}>No artists added yet.</Text>
      ) : (
        artists.map((a, i) => (
          <View key={a.id} style={styles.row}>
            <View style={styles.orderBtns}>
              <TouchableOpacity onPress={() => moveUp(i)} style={styles.orderBtn} disabled={i === 0}>
                <Text style={[styles.orderBtnText, i === 0 && styles.disabled]}>▲</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => moveDown(i)} style={styles.orderBtn} disabled={i === artists.length - 1}>
                <Text style={[styles.orderBtnText, i === artists.length - 1 && styles.disabled]}>▼</Text>
              </TouchableOpacity>
            </View>
            {a.photo ? (
              <Image source={{ uri: a.photo }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={styles.thumbEmoji}>🎨</Text>
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name}>{a.name}</Text>
              {a.walkOnMusic ? (
                <Text style={styles.meta} numberOfLines={1}>🎵 {fileBaseName(a.walkOnMusic)}</Text>
              ) : null}
              {a.video ? <Text style={styles.meta}>🎬 Video attached</Text> : null}
            </View>
            <TouchableOpacity onPress={() => openEdit(a)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(a.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Artist</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Artist' : 'Add Artist'}</Text>

            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="Artist name"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Walk-On Music</Text>
            <TouchableOpacity
              style={styles.fileBtn}
              onPress={async () => {
                const res = await pickAudioFile();
                if (res) setDraft((d) => ({ ...d, walkOnMusic: res.uri }));
              }}
            >
              <Text style={styles.fileBtnText}>
                {draft.walkOnMusic ? `🎵 ${fileBaseName(draft.walkOnMusic)}` : '📁 Pick Audio File'}
              </Text>
            </TouchableOpacity>
            {draft.walkOnMusic ? (
              <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, walkOnMusic: undefined }))}>
                <Text style={styles.clearLink}>Clear audio</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.fieldLabel}>Photo</Text>
            <TouchableOpacity
              style={styles.fileBtn}
              onPress={async () => {
                const uri = await pickImage();
                if (uri) setDraft((d) => ({ ...d, photo: uri }));
              }}
            >
              {draft.photo ? (
                <Image source={{ uri: draft.photo }} style={styles.previewImage} />
              ) : (
                <Text style={styles.fileBtnText}>🖼️ Pick Photo</Text>
              )}
            </TouchableOpacity>
            {draft.photo ? (
              <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, photo: undefined }))}>
                <Text style={styles.clearLink}>Clear photo</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.fieldLabel}>Video (optional)</Text>
            <TouchableOpacity
              style={styles.fileBtn}
              onPress={async () => {
                const uri = await pickVideo();
                if (uri) setDraft((d) => ({ ...d, video: uri }));
              }}
            >
              <Text style={styles.fileBtnText}>
                {draft.video ? `🎬 ${fileBaseName(draft.video)}` : '🎬 Pick Video'}
              </Text>
            </TouchableOpacity>
            {draft.video ? (
              <TouchableOpacity onPress={() => setDraft((d) => ({ ...d, video: undefined }))}>
                <Text style={styles.clearLink}>Clear video</Text>
              </TouchableOpacity>
            ) : null}

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
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  orderBtns: { marginRight: 6 },
  orderBtn: { padding: 2 },
  orderBtnText: { fontSize: 11, color: '#6B46C1' },
  disabled: { color: '#D1D5DB' },
  thumb: { width: 44, height: 44, borderRadius: 22, marginRight: 10, overflow: 'hidden' },
  thumbPlaceholder: { backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  thumbEmoji: { fontSize: 22 },
  info: { flex: 1 },
  name: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  meta: { fontSize: 11, color: '#6B7280', marginTop: 2 },
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
  fileBtn: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, padding: 12, backgroundColor: '#F9FAFB', alignItems: 'center' },
  fileBtnText: { color: '#374151', fontSize: 14 },
  previewImage: { width: 80, height: 80, borderRadius: 8 },
  clearLink: { color: '#EF4444', fontSize: 12, marginTop: 4, textAlign: 'right' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#6B46C1', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
