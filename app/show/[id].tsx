import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { loadShow, saveShow, loadSettings } from '../../utils/storage';
import { Show, AppSettings, DEFAULT_SETTINGS } from '../../utils/types';
import { exportShowToPDF } from '../../utils/pdfExport';
import SectionHeader from '../../components/SectionHeader';
import BasicInfoSection from '../../components/sections/BasicInfoSection';
import PerformersSection from '../../components/sections/PerformersSection';
import ArtistsSection from '../../components/sections/ArtistsSection';
import ScheduleSection from '../../components/sections/ScheduleSection';
import HostsSection from '../../components/sections/HostsSection';
import DJMusicSection from '../../components/sections/DJMusicSection';
import StaffSection from '../../components/sections/StaffSection';
import ExpensesSection from '../../components/sections/ExpensesSection';

type SectionKey =
  | 'basicInfo'
  | 'performers'
  | 'artists'
  | 'schedule'
  | 'hosts'
  | 'djMusic'
  | 'staff'
  | 'expenses';

const ALL_SECTIONS: SectionKey[] = [
  'basicInfo',
  'performers',
  'artists',
  'schedule',
  'hosts',
  'djMusic',
  'staff',
  'expenses',
];

const SECTION_LABELS: Record<SectionKey, string> = {
  basicInfo: '1. Basic Show Info',
  performers: '2. Performers',
  artists: '3. Artists',
  schedule: '4. Schedule & Timing',
  hosts: '5. Hosts',
  djMusic: '6. DJ Music List',
  staff: '7. Staff & Crew',
  expenses: '8. Itemized Expenses',
};

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [show, setShow] = useState<Show | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    basicInfo: true,
    performers: false,
    artists: false,
    schedule: false,
    hosts: false,
    djMusic: false,
    staff: false,
    expenses: false,
  });

  // Debounced auto-save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([loadShow(id), loadSettings()]).then(([s, cfg]) => {
      if (s) setShow(s);
      setSettings(cfg);
      setLoading(false);
    });
  }, [id]);

  const updateShow = useCallback((updates: Partial<Show>) => {
    setShow((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      // Debounced save
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveShow(next).catch(console.error);
      }, 600);
      return next;
    });
  }, []);

  const forceSave = async () => {
    if (!show) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    try {
      await saveShow(show);
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (key: SectionKey) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExportPDF = async () => {
    if (!show) return;
    await forceSave();
    setExporting(true);
    try {
      await exportShowToPDF(show, settings);
    } catch (e) {
      Alert.alert('Export Failed', String(e));
    } finally {
      setExporting(false);
    }
  };

  const sectionCount = (key: SectionKey): number | undefined => {
    if (!show) return undefined;
    switch (key) {
      case 'performers': return show.performers.length;
      case 'artists': return show.artists.length;
      case 'schedule': return show.schedule.length;
      case 'hosts': return show.hosts.length;
      case 'djMusic': return show.djSongs.length;
      case 'staff': return show.staff.length;
      case 'expenses': return show.expenses.length;
      default: return undefined;
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6B46C1" />
      </View>
    );
  }

  if (!show) {
    return (
      <View style={styles.centered}>
        <Text style={styles.notFoundText}>Show not found.</Text>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backLink}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: show.name || 'Show Details',
          headerRight: () => (
            <TouchableOpacity onPress={forceSave} style={styles.saveHeaderBtn} disabled={saving}>
              <Text style={styles.saveHeaderBtnText}>{saving ? '...' : 'Save'}</Text>
            </TouchableOpacity>
          ),
        }}
      />

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Show Name Editor */}
        <View style={styles.nameCard}>
          <Text style={styles.nameLabel}>SHOW NAME</Text>
          <TextInput
            style={[styles.nameInput, { fontSize: 20 }]}
            value={show.name}
            onChangeText={(v) => updateShow({ name: v })}
            placeholder="Show name"
            placeholderTextColor="#9CA3AF"
          />
        </View>

        {/* Show Flyer */}
        {show.flyer && (
          <View style={styles.flyerCard}>
            <Image source={{ uri: show.flyer }} style={styles.flyerImage} />
          </View>
        )}

        {/* Sections */}
        {ALL_SECTIONS.map((key) => (
          <View key={key} style={styles.sectionWrapper}>
            <SectionHeader
              title={SECTION_LABELS[key]}
              expanded={expanded[key]}
              onToggle={() => toggleSection(key)}
              count={sectionCount(key)}
            />
            {expanded[key] && renderSection(key, show, updateShow)}
          </View>
        ))}

        {/* Export to PDF */}
        <TouchableOpacity
          style={[styles.exportBtn, exporting && styles.exportBtnDisabled]}
          onPress={handleExportPDF}
          disabled={exporting}
        >
          <Text style={styles.exportBtnText}>
            {exporting ? '⏳ Generating PDF...' : '📄 Export to PDF'}
          </Text>
        </TouchableOpacity>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </>
  );
}

function renderSection(
  key: SectionKey,
  show: Show,
  updateShow: (updates: Partial<Show>) => void
): React.ReactNode {
  switch (key) {
    case 'basicInfo':
      return <BasicInfoSection show={show} onChange={updateShow} />;
    case 'performers':
      return (
        <PerformersSection
          performers={show.performers}
          onChange={(performers) => updateShow({ performers })}
        />
      );
    case 'artists':
      return (
        <ArtistsSection
          artists={show.artists}
          onChange={(artists) => updateShow({ artists })}
        />
      );
    case 'schedule':
      return (
        <ScheduleSection
          schedule={show.schedule}
          onChange={(schedule) => updateShow({ schedule })}
        />
      );
    case 'hosts':
      return (
        <HostsSection
          hosts={show.hosts}
          onChange={(hosts) => updateShow({ hosts })}
        />
      );
    case 'djMusic':
      return (
        <DJMusicSection
          songs={show.djSongs}
          show={show}
          onChange={(djSongs) => updateShow({ djSongs })}
        />
      );
    case 'staff':
      return (
        <StaffSection
          staff={show.staff}
          onChange={(staff) => updateShow({ staff })}
        />
      );
    case 'expenses':
      return (
        <ExpensesSection
          expenses={show.expenses}
          onChange={(expenses) => updateShow({ expenses })}
        />
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
  },
  content: {
    padding: Platform.OS === 'ios' ? 16 : 16,
    paddingBottom: 30,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  notFoundText: {
    fontSize: Platform.OS === 'ios' ? 17 : 18,
    color: '#000000',
    marginBottom: 12,
    fontWeight: Platform.OS === 'ios' ? '600' : 'normal',
  },
  backLink: {
    color: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    fontWeight: '600',
  },
  saveHeaderBtn: {
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 16,
    paddingVertical: Platform.OS === 'ios' ? 8 : 8,
    backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(255,255,255,0.25)',
    borderRadius: Platform.OS === 'ios' ? 8 : 8,
    marginRight: 8,
    minHeight: Platform.OS === 'ios' ? 32 : 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  saveHeaderBtnText: {
    color: Platform.OS === 'ios' ? '#007AFF' : '#fff',
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    fontSize: Platform.OS === 'ios' ? 17 : 15,
    lineHeight: 20,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  nameCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Platform.OS === 'ios' ? 12 : 16,
    padding: Platform.OS === 'ios' ? 16 : 18,
    marginBottom: 14,
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    }),
  },
  nameLabel: {
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    color: Platform.OS === 'ios' ? '#000000' : '#9CA3AF',
    letterSpacing: Platform.OS === 'ios' ? -0.08 : 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  nameInput: {
    color: '#000000',
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    padding: 0,
    fontSize: Platform.OS === 'ios' ? 28 : 22,
    lineHeight: Platform.OS === 'ios' ? 34 : 28,
    letterSpacing: Platform.OS === 'ios' ? 0.4 : 0,
  },
  flyerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Platform.OS === 'ios' ? 12 : 16,
    padding: 12,
    marginBottom: 14,
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 4,
      elevation: 2,
    }),
  },
  flyerImage: {
    width: '100%',
    height: 320,
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    resizeMode: 'contain',
  },
  sectionWrapper: {
    marginBottom: 12,
  },
  exportBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#1F2937',
    paddingVertical: 16,
    borderRadius: Platform.OS === 'ios' ? 12 : 14,
    alignItems: 'center',
    marginTop: 16,
    minHeight: Platform.OS === 'ios' ? 50 : 56,
    justifyContent: 'center',
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
    } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
    }),
  },
  exportBtnDisabled: {
    opacity: 0.6,
  },
  exportBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    lineHeight: 22,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  bottomSpacer: {
    height: 40,
  },
});
