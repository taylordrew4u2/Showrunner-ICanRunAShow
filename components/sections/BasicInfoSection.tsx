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
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#000000',
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: -0.08,
  },
  uploadBtn: {
    backgroundColor: '#F2F2F7',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'transparent',
    borderStyle: 'solid',
    minHeight: 50,
    justifyContent: 'center',
  },
  uploadBtnText: {
    color: '#007AFF',
    fontWeight: '600',
    fontSize: 17,
    letterSpacing: -0.4,
  },
  flyerPreview: {
    backgroundColor: '#F9F9F9',
    borderRadius: 10,
    padding: 12,
    borderWidth: 0,
    borderColor: 'transparent',
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
    backgroundColor: '#007AFF',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
  },
  changeBtnText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 17,
    letterSpacing: -0.4,
  },
  removeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#FFEFF0',
    minHeight: 44,
    justifyContent: 'center',
  },
  removeBtnText: {
    color: '#FF3B30',
    fontWeight: '600',
    fontSize: 17,
    letterSpacing: -0.4,
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
  },
  multiline: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 12,
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
    borderWidth: 0,
    borderColor: 'transparent',
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  statusBtnActive: {
    backgroundColor: '#007AFF',
    borderColor: '#007AFF',
  },
  statusBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#000000',
    textTransform: 'capitalize',
  },
  statusBtnTextActive: {
    color: '#FFFFFF',
  },
});
