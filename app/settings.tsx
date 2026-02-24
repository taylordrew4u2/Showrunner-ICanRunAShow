import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { loadSettings, saveSettings } from '../utils/storage';
import { AppSettings, DEFAULT_SETTINGS } from '../utils/types';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadSettings().then(setSettings);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveSettings(settings);
      Alert.alert('Saved', 'Settings saved successfully.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Brand & Producers</Text>

        <Text style={styles.label}>Brand Name</Text>
        <TextInput
          style={styles.input}
          value={settings.brandName}
          onChangeText={(v) => setSettings((s) => ({ ...s, brandName: v }))}
          placeholder="e.g. Pins & Needles"
          placeholderTextColor="#9CA3AF"
        />

        <Text style={styles.label}>Producer Names</Text>
        <TextInput
          style={styles.input}
          value={settings.producerNames}
          onChangeText={(v) => setSettings((s) => ({ ...s, producerNames: v }))}
          placeholder="e.g. Jane Smith, John Doe"
          placeholderTextColor="#9CA3AF"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Rules / Notes</Text>
        <Text style={styles.hint}>
          Shown on the home screen and included in PDF exports.
        </Text>
        <TextInput
          style={[styles.input, styles.rulesInput]}
          value={settings.rules}
          onChangeText={(v) => setSettings((s) => ({ ...s, rules: v }))}
          placeholder="Enter rules, guidelines, or any important notes..."
          placeholderTextColor="#9CA3AF"
          multiline
          numberOfLines={8}
          textAlignVertical="top"
        />
      </View>

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
        <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Settings'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  content: {
    padding: 18,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#6B46C1',
    marginBottom: 16,
    lineHeight: 22,
  },
  hint: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 12,
    lineHeight: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    minHeight: 48,
    lineHeight: 20,
  },
  rulesInput: {
    height: 180,
    textAlignVertical: 'top',
    paddingTop: 13,
  },
  saveBtn: {
    backgroundColor: '#6B46C1',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 56,
    justifyContent: 'center',
    shadowColor: '#6B46C1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 22,
  },
});
