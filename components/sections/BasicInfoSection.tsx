import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { Show, ShowStatus } from '../../utils/types';

interface Props {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export default function BasicInfoSection({ show, onChange }: Props) {
  const statuses: ShowStatus[] = ['upcoming', 'in-progress', 'completed', 'cancelled'];
  
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

      <Text style={styles.label}>Status</Text>
      <View style={styles.statusGrid}>
        {statuses.map((status) => (
          <TouchableOpacity
            key={status}
            style={[
              styles.statusBtn,
              show.status === status && styles.statusBtnActive,
            ]}
            onPress={() => onChange({ status })}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.statusBtnText,
                show.status === status && styles.statusBtnTextActive,
              ]}
            >
              {status.replace('-', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    padding: 18,
    borderRadius: 14,
    marginBottom: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
  },
  multiline: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 13,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  statusBtn: {
    flex: 1,
    minWidth: '48%',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  statusBtnActive: {
    backgroundColor: '#EDE9FE',
    borderColor: '#6B46C1',
  },
  statusBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  statusBtnTextActive: {
    color: '#6B46C1',
  },
});
