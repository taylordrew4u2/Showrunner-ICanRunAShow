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
  const [duplicateShowId, setDuplicateShowId] = useState<string | null>(null);
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
  filterSection: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  searchInput: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1F2937',
    marginBottom: 10,
  },
  statusFilterScroll: {
    marginBottom: 4,
  },
  filterChip: {
    backgroundColor: '#F3F4F6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterChipActive: {
    backgroundColor: '#6B46C1',
    borderColor: '#6B46C1',
  },
  filterChipText: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '600',
  },
  filterChipTextActive: {
    color: '#fff',
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
  modalScrollContent: {
    flexGrow: 1,
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
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  statusOption: {
    flex: 1,
    minWidth: '48%',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
  },
  statusOptionSelected: {
    backgroundColor: '#EDE9FE',
    borderColor: '#6B46C1',
  },
  statusOptionText: {
    fontSize: 13,
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
