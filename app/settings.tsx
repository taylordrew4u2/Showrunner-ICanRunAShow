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
    backgroundColor: '#F2F2F7',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 16,
    lineHeight: 22,
    letterSpacing: 0.4,
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
    color: '#000000',
    marginBottom: 8,
    marginTop: 12,
    textTransform: 'uppercase',
    letterSpacing: -0.08,
  },
  input: {
    borderWidth: 0,
    borderColor: 'transparent',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    color: '#000000',
    backgroundColor: '#F2F2F7',
    minHeight: 44,
    lineHeight: 20,
  },
  rulesInput: {
    height: 180,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  producerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    marginBottom: 8,
  },
  producerInfo: {
    flex: 1,
  },
  producerName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 2,
    letterSpacing: -0.4,
  },
  producerRole: {
    fontSize: 15,
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
    color: '#FF3B30',
    fontWeight: '400',
  },
  addBtn: {
    backgroundColor: '#34C759',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 44,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  saveBtn: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 50,
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  saveBtnText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: -0.4,
  },
});
