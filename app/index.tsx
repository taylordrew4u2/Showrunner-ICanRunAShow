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
  Platform,
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
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
  },
  header: {
    backgroundColor: '#fff',
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 20,
    paddingVertical: Platform.OS === 'ios' ? 12 : 18,
    ...(Platform.OS === 'ios' ? {
      borderBottomWidth: 0.5,
      borderBottomColor: 'rgba(0,0,0,0.1)',
    } : {
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    }),
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
    fontSize: Platform.OS === 'ios' ? 28 : 28,
    fontWeight: Platform.OS === 'ios' ? '700' : '800',
    color: '#6B46C1',
    letterSpacing: Platform.OS === 'ios' ? -0.5 : 0.5,
  },
  producers: {
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    color: '#4B5563',
    marginTop: 6,
    fontWeight: Platform.OS === 'ios' ? '500' : '600',
  },
  rules: {
    fontSize: Platform.OS === 'ios' ? 14 : 13,
    color: '#6B7280',
    marginTop: 6,
    fontStyle: Platform.OS === 'ios' ? 'normal' : 'italic',
    lineHeight: 19,
  },
  settingsBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    ...(Platform.OS === 'ios' ? {
      borderWidth: 0,
    } : {
      borderWidth: 1,
      borderColor: '#E5E7EB',
    }),
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    padding: Platform.OS === 'ios' ? 12 : 14,
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    minWidth: Platform.OS === 'ios' ? 44 : 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsBtnText: {
    fontSize: 24,
  },
  actions: {
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 20,
    paddingTop: Platform.OS === 'ios' ? 16 : 18,
    paddingBottom: Platform.OS === 'ios' ? 12 : 12,
  },
  createBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    paddingVertical: Platform.OS === 'ios' ? 16 : 18,
    borderRadius: Platform.OS === 'ios' ? 12 : 16,
    alignItems: 'center',
    minHeight: Platform.OS === 'ios' ? 50 : 56,
    justifyContent: 'center',
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
    } : {
      shadowColor: '#6B46C1',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: 0.25,
      shadowRadius: 12,
      elevation: 6,
    }),
  },
  createBtnText: {
    color: '#fff',
    fontSize: Platform.OS === 'ios' ? 17 : 18,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0.3,
  },
  filterSection: {
    backgroundColor: '#fff',
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 20,
    paddingVertical: Platform.OS === 'ios' ? 12 : 16,
    ...(Platform.OS === 'ios' ? {
      borderBottomWidth: 0.5,
      borderBottomColor: 'rgba(0,0,0,0.1)',
    } : {
      borderBottomWidth: 1,
      borderBottomColor: '#E5E7EB',
    }),
  },
  searchInput: {
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    paddingHorizontal: Platform.OS === 'ios' ? 12 : 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 14,
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    color: '#1F2937',
    marginBottom: 12,
    minHeight: Platform.OS === 'ios' ? 36 : 48,
  },
  statusFilterScroll: {
    marginBottom: 4,
  },
  filterChip: {
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
    borderRadius: Platform.OS === 'ios' ? 18 : 22,
    paddingHorizontal: Platform.OS === 'ios' ? 14 : 16,
    paddingVertical: Platform.OS === 'ios' ? 8 : 10,
    marginRight: 10,
    ...(Platform.OS === 'ios' ? {
      borderWidth: 0,
    } : {
      borderWidth: 1.5,
      borderColor: '#E5E7EB',
    }),
    minHeight: Platform.OS === 'ios' ? 32 : 44,
    justifyContent: 'center',
  },
  filterChipActive: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    ...(Platform.OS === 'ios' ? {} : { borderColor: '#6B46C1' }),
  },
  filterChipText: {
    color: '#6B7280',
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    fontWeight: Platform.OS === 'ios' ? '500' : '600',
  },
  filterChipTextActive: {
    color: '#fff',
    fontWeight: Platform.OS === 'ios' ? '600' : '600',
  },
  grid: {
    padding: Platform.OS === 'ios' ? 8 : 12,
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
    backgroundColor: Platform.OS === 'ios' ? 'rgba(0,0,0,0.4)' : 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalScrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingBottom: Platform.OS === 'ios' ? 0 : 34,
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: Platform.OS === 'ios' ? 20 : 28,
    borderTopRightRadius: Platform.OS === 'ios' ? 20 : 28,
    padding: Platform.OS === 'ios' ? 20 : 28,
    paddingBottom: Platform.OS === 'ios' ? 40 : 50,
  },
  modalTitle: {
    fontSize: Platform.OS === 'ios' ? 28 : 24,
    fontWeight: Platform.OS === 'ios' ? '700' : '800',
    color: '#000000',
    marginBottom: Platform.OS === 'ios' ? 20 : 24,
    letterSpacing: Platform.OS === 'ios' ? 0.4 : 0,
  },
  modalLabel: {
    fontSize: Platform.OS === 'ios' ? 13 : 13,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
    marginTop: 16,
    textTransform: Platform.OS === 'ios' ? 'uppercase' : 'uppercase',
    letterSpacing: Platform.OS === 'ios' ? -0.08 : 0.5,
  },
  modalInput: {
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    paddingHorizontal: Platform.OS === 'ios' ? 12 : 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 14,
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    color: '#000000',
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    minHeight: Platform.OS === 'ios' ? 44 : 48,
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
    paddingVertical: Platform.OS === 'ios' ? 12 : 14,
    paddingHorizontal: 12,
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    borderWidth: Platform.OS === 'ios' ? 0 : 1.5,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    alignItems: 'center',
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    justifyContent: 'center',
  },
  statusOptionSelected: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#EDE9FE',
    borderColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
  },
  statusOptionText: {
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    fontWeight: '600',
    color: Platform.OS === 'ios' ? '#000000' : '#6B7280',
    textTransform: 'capitalize',
  },
  statusOptionTextSelected: {
    color: Platform.OS === 'ios' ? '#FFFFFF' : '#6B46C1',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
    paddingVertical: 16,
    borderRadius: Platform.OS === 'ios' ? 12 : 12,
    alignItems: 'center',
    minHeight: Platform.OS === 'ios' ? 50 : 52,
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: Platform.OS === 'ios' ? '#007AFF' : '#374151',
    fontWeight: Platform.OS === 'ios' ? '600' : '600',
    fontSize: 17,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  confirmBtn: {
    flex: 1,
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    paddingVertical: 16,
    borderRadius: Platform.OS === 'ios' ? 12 : 12,
    alignItems: 'center',
    minHeight: Platform.OS === 'ios' ? 50 : 52,
    justifyContent: 'center',
  },
  confirmBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 17,
  },
});
