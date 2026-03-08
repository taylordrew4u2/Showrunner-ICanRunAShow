import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { loadSettings, saveSettings, generateId } from '../utils/storage';
import { AppSettings, DEFAULT_SETTINGS, Producer } from '../utils/types';

export default function SettingsScreen() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [newProducerName, setNewProducerName] = useState('');
  const [newProducerRole, setNewProducerRole] = useState('');
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

  const addProducer = () => {
    if (!newProducerName.trim() || !newProducerRole.trim()) {
      Alert.alert('Required', 'Please enter both name and role');
      return;
    }
    const producer: Producer = {
      id: generateId(),
      name: newProducerName.trim(),
      role: newProducerRole.trim(),
    };
    setSettings((s) => ({ ...s, producers: [...s.producers, producer] }));
    setNewProducerName('');
    setNewProducerRole('');
  };

  const removeProducer = (id: string) => {
    Alert.alert('Remove Producer', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => setSettings((s) => ({ ...s, producers: s.producers.filter((p) => p.id !== id) })),
      },
    ]);
  };

  const remaining = settings.brandBudget - settings.totalSpent;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Brand Information</Text>

        <Text style={styles.label}>Brand Name</Text>
        <TextInput
          style={styles.input}
          value={settings.brandName}
          onChangeText={(v) => setSettings((s) => ({ ...s, brandName: v }))}
          placeholder="e.g. Show Producer"
          placeholderTextColor="#9CA3AF"
        />

        <Text style={styles.label}>Brand Budget</Text>
        <TextInput
          style={styles.input}
          value={String(settings.brandBudget)}
          onChangeText={(v) => setSettings((s) => ({ ...s, brandBudget: Number(v) || 0 }))}
          placeholder="0.00"
          keyboardType="numeric"
          placeholderTextColor="#9CA3AF"
        />
        <Text style={styles.hint}>
          Total spent: ${settings.totalSpent.toFixed(2)} • Remaining: ${remaining.toFixed(2)}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Producers</Text>
        
        {settings.producers.map((producer) => (
          <View key={producer.id} style={styles.producerItem}>
            <View style={styles.producerInfo}>
              <Text style={styles.producerName}>{producer.name}</Text>
              <Text style={styles.producerRole}>{producer.role}</Text>
            </View>
            <TouchableOpacity onPress={() => removeProducer(producer.id)} style={styles.removeBtn}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        <TextInput
          style={styles.input}
          value={newProducerName}
          onChangeText={setNewProducerName}
          placeholder="Producer name"
          placeholderTextColor="#9CA3AF"
        />
        <TextInput
          style={styles.input}
          value={newProducerRole}
          onChangeText={setNewProducerRole}
          placeholder="Role (e.g., Executive Producer)"
          placeholderTextColor="#9CA3AF"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addProducer}>
          <Text style={styles.addBtnText}>Add Producer</Text>
        </TouchableOpacity>
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
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
  },
  content: {
    padding: Platform.OS === 'ios' ? 16 : 18,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: Platform.OS === 'ios' ? 12 : 16,
    padding: Platform.OS === 'ios' ? 16 : 18,
    marginBottom: 16,
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
  sectionTitle: {
    fontSize: Platform.OS === 'ios' ? 20 : 17,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    color: Platform.OS === 'ios' ? '#000000' : '#6B46C1',
    marginBottom: 16,
    lineHeight: 22,
    letterSpacing: Platform.OS === 'ios' ? 0.4 : 0,
  },
  hint: {
    fontSize: Platform.OS === 'ios' ? 13 : 13,
    color: '#6B7280',
    marginBottom: 12,
    lineHeight: 18,
  },
  label: {
    fontSize: Platform.OS === 'ios' ? 13 : 13,
    fontWeight: Platform.OS === 'ios' ? '600' : '600',
    color: Platform.OS === 'ios' ? '#000000' : '#374151',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: Platform.OS === 'ios' ? -0.08 : 0.4,
  },
  input: {
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
    borderRadius: Platform.OS === 'ios' ? 10 : 12,
    paddingHorizontal: Platform.OS === 'ios' ? 12 : 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 13,
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    color: '#000000',
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    lineHeight: 20,
  },
  rulesInput: {
    height: 180,
    textAlignVertical: 'top',
    paddingTop: Platform.OS === 'ios' ? 12 : 13,
  },
  producerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Platform.OS === 'ios' ? 12 : 12,
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
    borderRadius: Platform.OS === 'ios' ? 10 : 8,
    marginBottom: 8,
  },
  producerInfo: {
    flex: 1,
  },
  producerName: {
    fontSize: Platform.OS === 'ios' ? 17 : 15,
    fontWeight: Platform.OS === 'ios' ? '600' : '600',
    color: '#000000',
    marginBottom: 2,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  producerRole: {
    fontSize: Platform.OS === 'ios' ? 15 : 13,
    color: '#6B7280',
  },
  removeBtn: {
    padding: 8,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeBtnText: {
    fontSize: 18,
    color: Platform.OS === 'ios' ? '#FF3B30' : '#DC2626',
    fontWeight: Platform.OS === 'ios' ? '400' : '600',
  },
  addBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#34C759' : '#0EA5E9',
    paddingVertical: Platform.OS === 'ios' ? 12 : 12,
    borderRadius: Platform.OS === 'ios' ? 10 : 8,
    alignItems: 'center',
    marginTop: 8,
    minHeight: Platform.OS === 'ios' ? 44 : 48,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: Platform.OS === 'ios' ? 17 : 15,
    fontWeight: Platform.OS === 'ios' ? '600' : '600',
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  saveBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    paddingVertical: 16,
    borderRadius: Platform.OS === 'ios' ? 12 : 14,
    alignItems: 'center',
    marginTop: 8,
    minHeight: Platform.OS === 'ios' ? 50 : 56,
    justifyContent: 'center',
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.15,
      shadowRadius: 8,
    } : {
      shadowColor: '#6B46C1',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
      elevation: 4,
    }),
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    lineHeight: 22,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
});
