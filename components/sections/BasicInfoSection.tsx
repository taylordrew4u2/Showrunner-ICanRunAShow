import React from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { Show } from '../../utils/types';

interface Props {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export default function BasicInfoSection({ show, onChange }: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Show Date</Text>
      <TextInput
        style={styles.input}
        value={show.date}
        onChangeText={(v) => onChange({ date: v })}
        placeholder="e.g. January 15, 2025"
        placeholderTextColor="#9CA3AF"
      />

      <Text style={styles.label}>Show Time</Text>
      <TextInput
        style={styles.input}
        value={show.time}
        onChangeText={(v) => onChange({ time: v })}
        placeholder="e.g. 7:00 PM"
        placeholderTextColor="#9CA3AF"
      />

      <Text style={styles.label}>Venue Name</Text>
      <TextInput
        style={styles.input}
        value={show.venueName}
        onChangeText={(v) => onChange({ venueName: v })}
        placeholder="e.g. The Paramount Theater"
        placeholderTextColor="#9CA3AF"
      />

      <Text style={styles.label}>Location / Address</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={show.location}
        onChangeText={(v) => onChange({ location: v })}
        placeholder="Full address or directions"
        placeholderTextColor="#9CA3AF"
        multiline
        numberOfLines={3}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 5,
    marginTop: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
  },
  multiline: {
    height: 80,
    textAlignVertical: 'top',
  },
});
