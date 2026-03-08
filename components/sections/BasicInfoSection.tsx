import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Image, Alert, Platform } from 'react-native';
import { Show, ShowStatus } from '../../utils/types';
import { pickImage } from '../../utils/filePicker';

interface Props {
  show: Show;
  onChange: (updates: Partial<Show>) => void;
}

export default function BasicInfoSection({ show, onChange }: Props) {
  const statuses: ShowStatus[] = ['upcoming', 'in-progress', 'completed', 'cancelled'];
  
  const handleFlyerUpload = async () => {
    const uri = await pickImage();
    if (uri) {
      onChange({ flyer: uri });
    }
  };

  const removeFlyerUpload = () => {
    Alert.alert('Remove Flyer', 'Remove the show flyer?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange({ flyer: undefined }) },
    ]);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Show Flyer</Text>
      {show.flyer ? (
        <View style={styles.flyerPreview}>
          <Image source={{ uri: show.flyer }} style={styles.flyerImage} />
          <View style={styles.flyerActions}>
            <TouchableOpacity style={styles.changeBtn} onPress={handleFlyerUpload}>
              <Text style={styles.changeBtnText}>Change Flyer</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.removeBtn} onPress={removeFlyerUpload}>
              <Text style={styles.removeBtnText}>Remove</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={styles.uploadBtn} onPress={handleFlyerUpload}>
          <Text style={styles.uploadBtnText}>Upload Show Flyer</Text>
        </TouchableOpacity>
      )}

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
    backgroundColor: '#FFFFFF',
    padding: Platform.OS === 'ios' ? 16 : 18,
    borderRadius: Platform.OS === 'ios' ? 12 : 14,
    marginBottom: 10,
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
    } : {}),
  },
  label: {
    fontSize: Platform.OS === 'ios' ? 13 : 13,
    fontWeight: '600',
    color: Platform.OS === 'ios' ? '#000000' : '#374151',
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: Platform.OS === 'ios' ? -0.08 : 0.5,
  },
  uploadBtn: {
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F3F4F6',
    borderRadius: Platform.OS === 'ios' ? 10 : 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#E5E7EB',
    borderStyle: Platform.OS === 'ios' ? 'solid' : 'dashed',
    minHeight: Platform.OS === 'ios' ? 50 : 52,
    justifyContent: 'center',
  },
  uploadBtnText: {
    color: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    fontWeight: '600',
    fontSize: Platform.OS === 'ios' ? 17 : 15,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  flyerPreview: {
    backgroundColor: Platform.OS === 'ios' ? '#F9F9F9' : '#F9FAFB',
    borderRadius: Platform.OS === 'ios' ? 10 : 10,
    padding: 12,
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
  },
  flyerImage: {
    width: '100%',
    height: 300,
    borderRadius: 8,
    resizeMode: 'contain',
  },
  flyerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  changeBtn: {
    flex: 1,
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#EDE9FE',
    borderRadius: Platform.OS === 'ios' ? 10 : 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#6B46C1',
    minHeight: 44,
    justifyContent: 'center',
  },
  changeBtnText: {
    color: Platform.OS === 'ios' ? '#FFFFFF' : '#6B46C1',
    fontWeight: '600',
    fontSize: Platform.OS === 'ios' ? 17 : 14,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  removeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#EF4444',
    backgroundColor: Platform.OS === 'ios' ? '#FFEFF0' : '#FEE2E2',
    minHeight: 44,
    justifyContent: 'center',
  },
  removeBtnText: {
    color: Platform.OS === 'ios' ? '#FF3B30' : '#EF4444',
    fontWeight: '600',
    fontSize: Platform.OS === 'ios' ? 17 : 14,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  input: {
    borderWidth: Platform.OS === 'ios' ? 0 : 1,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
    borderRadius: Platform.OS === 'ios' ? 10 : 10,
    paddingHorizontal: Platform.OS === 'ios' ? 12 : 14,
    paddingVertical: Platform.OS === 'ios' ? 12 : 13,
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    color: '#000000',
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    minHeight: Platform.OS === 'ios' ? 44 : 48,
  },
  multiline: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: Platform.OS === 'ios' ? 12 : 13,
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
    paddingVertical: Platform.OS === 'ios' ? 12 : 12,
    paddingHorizontal: 10,
    borderRadius: Platform.OS === 'ios' ? 10 : 10,
    borderWidth: Platform.OS === 'ios' ? 0 : 1.5,
    borderColor: Platform.OS === 'ios' ? 'transparent' : '#D1D5DB',
    backgroundColor: Platform.OS === 'ios' ? '#F2F2F7' : '#F9FAFB',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: Platform.OS === 'ios' ? 44 : 48,
  },
  statusBtnActive: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#EDE9FE',
    borderColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
  },
  statusBtnText: {
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    fontWeight: '600',
    color: Platform.OS === 'ios' ? '#000000' : '#6B7280',
    textTransform: 'capitalize',
  },
  statusBtnTextActive: {
    color: Platform.OS === 'ios' ? '#FFFFFF' : '#6B46C1',
  },
});
