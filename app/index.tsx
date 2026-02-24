import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { loadShows, saveShow, deleteShow, loadSettings, generateId } from '../utils/storage';
import { Show, AppSettings, DEFAULT_SETTINGS } from '../utils/types';
import ShowCard from '../components/ShowCard';

export default function HomeScreen() {
  const [shows, setShows] = useState<Show[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newShowName, setNewShowName] = useState('');
  const [newShowDate, setNewShowDate] = useState('');
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      loadShows().then(setShows);
      loadSettings().then((s) => {
        setSettings(s);
      });
    }, [])
  );

  const handleCreateShow = async () => {
    if (!newShowName.trim()) {
      Alert.alert('Name Required', 'Please enter a show name.');
      return;
    }
    const now = new Date().toISOString();
    const newShow: Show = {
      id: generateId(),
      name: newShowName.trim(),
      date: newShowDate.trim(),
      time: '',
      location: '',
      venueName: '',
      performers: [],
      artists: [],
      schedule: [],
      hosts: [],
      djSongs: [],
      staff: [],
      expenses: [],
      createdAt: now,
      updatedAt: now,
    };
    await saveShow(newShow);
    setNewShowName('');
    setNewShowDate('');
    setCreateModalVisible(false);
    router.push(`/show/${newShow.id}`);
  };

  const handleDeleteShow = (id: string, name: string) => {
    Alert.alert('Delete Show', `Delete "${name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteShow(id);
          setShows((prev) => prev.filter((s) => s.id !== id));
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: settings.brandName || 'Pins & Needles' }} />

      {/* Brand Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <View style={styles.headerText}>
            <Text style={styles.brandName}>{settings.brandName}</Text>
            {settings.producerNames ? (
              <Text style={styles.producers}>Producers: {settings.producerNames}</Text>
            ) : null}
            {settings.rules ? (
              <Text style={styles.rules} numberOfLines={3}>
                {settings.rules}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity style={styles.settingsBtn} onPress={() => router.push('/settings')}>
            <Text style={styles.settingsBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Create Button */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.createBtn} onPress={() => setCreateModalVisible(true)}>
          <Text style={styles.createBtnText}>＋ Create a Show</Text>
        </TouchableOpacity>
      </View>

      {/* Shows Grid */}
      {shows.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎭</Text>
          <Text style={styles.emptyTitle}>No Shows Yet</Text>
          <Text style={styles.emptySubtitle}>Tap "Create a Show" to get started</Text>
        </View>
      ) : (
        <FlatList
          data={shows}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            <ShowCard
              show={item}
              onPress={() => router.push(`/show/${item.id}`)}
              onDelete={() => handleDeleteShow(item.id, item.name)}
            />
          )}
        />
      )}

      {/* Create Show Modal */}
      <Modal visible={createModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>New Show</Text>

            <Text style={styles.modalLabel}>Show Name *</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Spring Showcase 2025"
              placeholderTextColor="#9CA3AF"
              value={newShowName}
              onChangeText={setNewShowName}
              autoFocus
            />

            <Text style={styles.modalLabel}>Date (optional)</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. March 15, 2025"
              placeholderTextColor="#9CA3AF"
              value={newShowDate}
              onChangeText={setNewShowDate}
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  setCreateModalVisible(false);
                  setNewShowName('');
                  setNewShowDate('');
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateShow}>
                <Text style={styles.confirmBtnText}>Create</Text>
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
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    marginRight: 12,
  },
  brandName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#6B46C1',
    letterSpacing: 0.5,
  },
  producers: {
    fontSize: 13,
    color: '#4B5563',
    marginTop: 3,
  },
  rules: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 5,
    fontStyle: 'italic',
    lineHeight: 17,
  },
  settingsBtn: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    padding: 10,
  },
  settingsBtnText: {
    fontSize: 20,
  },
  actions: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  createBtn: {
    backgroundColor: '#6B46C1',
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#6B46C1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  grid: {
    padding: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 72,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 20,
  },
  modalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 5,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 16,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#6B46C1',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
});
