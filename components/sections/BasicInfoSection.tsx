import React from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
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
  uploadBtn: {
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    minHeight: 52,
    justifyContent: 'center',
  },
  uploadBtnText: {
    color: '#6B46C1',
    fontWeight: '600',
    fontSize: 15,
  },
  flyerPreview: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#D1D5DB',
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
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#6B46C1',
    minHeight: 44,
    justifyContent: 'center',
  },
  changeBtnText: {
    color: '#6B46C1',
    fontWeight: '600',
    fontSize: 14,
  },
  removeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#EF4444',
    backgroundColor: '#FEE2E2',
    minHeight: 44,
    justifyContent: 'center',
  },
  removeBtnText: {
    color: '#EF4444',
    fontWeight: '600',
    fontSize: 14,
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
