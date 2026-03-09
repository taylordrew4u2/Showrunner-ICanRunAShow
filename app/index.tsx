import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  TextInput,
  ScrollView,
} from 'react-native';
import { useFocusEffect, useRouter, Stack } from 'expo-router';
import { loadShows, saveShow, deleteShow, loadSettings, generateId } from '../utils/storage';
import { Show, AppSettings, DEFAULT_SETTINGS, ShowStatus } from '../utils/types';
import ShowCard from '../components/ShowCard';

export default function HomeScreen() {
  const [shows, setShows] = useState<Show[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [newShowName, setNewShowName] = useState('');
  const [newShowDate, setNewShowDate] = useState('');
  const [newShowStatus, setNewShowStatus] = useState<ShowStatus>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ShowStatus | 'all'>('all');
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      loadShows().then(setShows);
      loadSettings().then((s) => {
        setSettings(s);
      });
    }, [])
  );

  const filteredShows = useMemo(() => {
    return shows.filter((show) => {
      const matchesSearch = show.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || show.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [shows, searchQuery, statusFilter]);

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
      status: newShowStatus,
      performers: [],
      artists: [],
      schedule: [],
      hosts: [],
      djSongs: [],
      staff: [],
      expenses: [],
      files: [], // Ensure files array is always initialized
      createdAt: now,
      updatedAt: now,
    };
    await saveShow(newShow);
    setNewShowName('');
    setNewShowDate('');
    setNewShowStatus('upcoming');
    setCreateModalVisible(false);
    router.push(`/show/${newShow.id}`);
  };

  const handleDuplicateShow = async (sourceId: string) => {
    const source = shows.find((s) => s.id === sourceId);
    if (!source) return;
    
    const now = new Date().toISOString();
    const newShow: Show = {
      ...source,
      id: generateId(),
      name: `${source.name} (Copy)`,
      status: 'upcoming',
      createdAt: now,
      updatedAt: now,
    };
    await saveShow(newShow);
    setShows((prev) => [newShow, ...prev]);
    Alert.alert('Success', `Show duplicated as "${newShow.name}"`);
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
            {settings.producers.length > 0 ? (
              <Text style={styles.producers}>Producers: {settings.producers.map((p) => `${p.name} (${p.role})`).join(', ')}</Text>
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

      {/* Search & Filter */}
      <View style={styles.filterSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search shows..."
          placeholderTextColor="#9CA3AF"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusFilterScroll}>
          {(['all', 'upcoming', 'in-progress', 'completed', 'cancelled'] as const).map((status) => (
            <TouchableOpacity
              key={status}
              style={[
                styles.filterChip,
                statusFilter === status && styles.filterChipActive,
              ]}
              onPress={() => setStatusFilter(status)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  statusFilter === status && styles.filterChipTextActive,
                ]}
              >
                {status === 'all' ? '✓ All' : status.replace('-', ' ')}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Shows Grid */}
      {filteredShows.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>🎭</Text>
          <Text style={styles.emptyTitle}>
            {searchQuery || statusFilter !== 'all' ? 'No Shows Found' : 'No Shows Yet'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your search or filters'
              : 'Tap "Create a Show" to get started'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredShows}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          scrollEnabled={false}
          renderItem={({ item }) => (
            <ShowCard
              show={item}
              onPress={() => router.push(`/show/${item.id}`)}
              onDelete={() => handleDeleteShow(item.id, item.name)}
              onDuplicate={() => handleDuplicateShow(item.id)}
            />
          )}
        />
      )}

      {/* Create Show Modal */}
      <Modal visible={createModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScrollContent}>
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

              <Text style={styles.modalLabel}>Status</Text>
              <View style={styles.statusGrid}>
                {(['upcoming', 'in-progress', 'completed', 'cancelled'] as ShowStatus[]).map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.statusOption,
                      newShowStatus === status && styles.statusOptionSelected,
                    ]}
                    onPress={() => setNewShowStatus(status)}
                  >
                    <Text
                      style={[
                        styles.statusOptionText,
                        newShowStatus === status && styles.statusOptionTextSelected,
                      ]}
                    >
                      {status.replace('-', ' ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={styles.cancelBtn}
                  onPress={() => {
                    setCreateModalVisible(false);
                    setNewShowName('');
                    setNewShowDate('');
                    setNewShowStatus('upcoming');
                  }}
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={handleCreateShow}>
                  <Text style={styles.confirmBtnText}>Create</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
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
    paddingHorizontal: 20,
    paddingVertical: 18,
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
    marginRight: 16,
  },
  brandName: {
    fontSize: 28,
    fontWeight: '800',
    color: '#6B46C1',
    letterSpacing: 0.5,
  },
  producers: {
    fontSize: 14,
    color: '#4B5563',
    marginTop: 6,
    fontWeight: '600',
  },
  rules: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: 'italic',
    lineHeight: 19,
  },
  settingsBtn: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 14,
    minHeight: 48,
    minWidth: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsBtnText: {
    fontSize: 24,
  },
  actions: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  createBtn: {
    backgroundColor: '#6B46C1',
    paddingVertical: 18,
    borderRadius: 16,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: '#6B46C1',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 6,
  },
  createBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  filterSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1F2937',
    marginBottom: 12,
    minHeight: 48,
  },
  statusFilterScroll: {
    marginBottom: 4,
  },
  filterChip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 10,
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    minHeight: 44,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: '#6B46C1',
    borderColor: '#6B46C1',
  },
  filterChipText: {
    color: '#6B7280',
    fontSize: 14,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  grid: {
    padding: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 48,
  },
  emptyIcon: {
    fontSize: 80,
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 12,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#9CA3AF',
    textAlign: 'center',
    lineHeight: 22,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: 34,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 28,
    paddingBottom: 50,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1F2937',
    marginBottom: 24,
  },
  modalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    minHeight: 48,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statusOption: {
    flex: 1,
    minWidth: '48%',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  statusOptionSelected: {
    backgroundColor: '#EDE9FE',
    borderColor: '#6B46C1',
  },
  statusOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  statusOptionTextSelected: {
    color: '#6B46C1',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 17,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: '#6B46C1',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 17,
  },
});
