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
import { Host } from '../../utils/types';
import { generateId } from '../../utils/storage';
import { pickImage } from '../../utils/filePicker';

interface Props {
  hosts: Host[];
  onChange: (hosts: Host[]) => void;
}

const EMPTY: Omit<Host, 'id'> = { name: '', photo: undefined, notes: '', isHosting: false };

export default function HostsSection({ hosts, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Host | null>(null);
  const [draft, setDraft] = useState<Omit<Host, 'id'>>(EMPTY);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setModalVisible(true);
  };

  const openEdit = (h: Host) => {
    setEditing(h);
    setDraft({ name: h.name, photo: h.photo, notes: h.notes, isHosting: h.isHosting });
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.name.trim()) {
      Alert.alert('Name required', 'Please enter a host name.');
      return;
    }
    if (editing) {
      onChange(hosts.map((h) => (h.id === editing.id ? { ...editing, ...draft } : h)));
    } else {
      onChange([...hosts, { id: generateId(), ...draft }]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Host', 'Remove this host?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(hosts.filter((h) => h.id !== id)) },
    ]);
  };

  const toggleHosting = (id: string) => {
    onChange(hosts.map((h) => (h.id === id ? { ...h, isHosting: !h.isHosting } : h)));
  };

  return (
    <View style={styles.container}>
      {hosts.length === 0 ? (
        <Text style={styles.empty}>No hosts added yet.</Text>
      ) : (
        hosts.map((h) => (
          <View key={h.id} style={styles.row}>
            {h.photo ? (
              <Image source={{ uri: h.photo }} style={styles.thumb} />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]}>
                <Text style={styles.thumbEmoji}>🎤</Text>
              </View>
            )}
            <View style={styles.info}>
              <Text style={styles.name}>{h.name}</Text>
              {h.notes ? <Text style={styles.meta} numberOfLines={1}>{h.notes}</Text> : null}
            </View>
            <TouchableOpacity
              style={[styles.hostingBadge, h.isHosting && styles.hostingBadgeActive]}
              onPress={() => toggleHosting(h.id)}
            >
              <Text style={[styles.hostingBadgeText, h.isHosting && styles.hostingBadgeTextActive]}>
                {h.isHosting ? '✓ Hosting' : 'Hosting?'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => openEdit(h)} style={styles.editBtn}>
              <Text style={styles.editBtnText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => remove(h.id)} style={styles.deleteBtn}>
              <Text style={styles.deleteBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Host</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Host' : 'Add Host'}</Text>

            <Text style={styles.fieldLabel}>Name *</Text>
            <TextInput
              style={styles.input}
              value={draft.name}
              onChangeText={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="Host name"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Photo (optional)</Text>
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

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={draft.notes}
              onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
              placeholder="Any notes about this host..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <TouchableOpacity
              style={[styles.toggleBtn, draft.isHosting && styles.toggleBtnActive]}
              onPress={() => setDraft((d) => ({ ...d, isHosting: !d.isHosting }))}
            >
              <Text style={[styles.toggleBtnText, draft.isHosting && styles.toggleBtnTextActive]}>
                {draft.isHosting ? '✓ This host is hosting the show' : 'Mark as hosting the show'}
              </Text>
            </TouchableOpacity>

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
  thumb: { 
    width: 48, 
    height: 48, 
    borderRadius: 24, 
    marginRight: 12, 
    overflow: 'hidden' 
  },
  thumbPlaceholder: { 
    backgroundColor: '#F3F4F6', 
    alignItems: 'center', 
    justifyContent: 'center' 
  },
  thumbEmoji: { 
    fontSize: 24 
  },
  info: { 
    flex: 1 
  },
  name: { 
    fontSize: 15, 
    fontWeight: '600', 
    color: '#1F2937',
    lineHeight: 20,
  },
  meta: { 
    fontSize: 13, 
    color: '#6B7280', 
    marginTop: 3,
    lineHeight: 18,
  },
  hostingBadge: { 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#D1D5DB', 
    paddingHorizontal: 10, 
    paddingVertical: 6,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  hostingBadgeActive: { 
    backgroundColor: '#6B46C1', 
    borderColor: '#6B46C1' 
  },
  hostingBadgeText: { 
    fontSize: 11, 
    color: '#6B7280', 
    fontWeight: '600',
    lineHeight: 16,
  },
  hostingBadgeTextActive: { 
    color: '#fff' 
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
  multiline: { 
    height: 100, 
    textAlignVertical: 'top',
    paddingTop: 13,
  },
  fileBtn: { 
    borderWidth: 1, 
    borderColor: '#D1D5DB', 
    borderRadius: 10, 
    padding: 14, 
    backgroundColor: '#F9FAFB', 
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  fileBtnText: { 
    color: '#374151', 
    fontSize: 15,
    lineHeight: 20,
  },
  previewImage: { 
    width: 100, 
    height: 100, 
    borderRadius: 10 
  },
  clearLink: { 
    color: '#EF4444', 
    fontSize: 13, 
    marginTop: 6, 
    textAlign: 'right',
    fontWeight: '500',
  },
  toggleBtn: { 
    marginTop: 16, 
    borderWidth: 1, 
    borderColor: '#D1D5DB', 
    borderRadius: 10, 
    paddingVertical: 14, 
    paddingHorizontal: 14,
    alignItems: 'center', 
    backgroundColor: '#F9FAFB',
    minHeight: 48,
    justifyContent: 'center',
  },
  toggleBtnActive: { 
    backgroundColor: '#6B46C1', 
    borderColor: '#6B46C1' 
  },
  toggleBtnText: { 
    color: '#374151', 
    fontWeight: '600', 
    fontSize: 15,
    lineHeight: 20,
  },
  toggleBtnTextActive: { 
    color: '#fff' 
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
