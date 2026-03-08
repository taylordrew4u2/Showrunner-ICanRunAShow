import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Platform } from 'react-native';
import { Show } from '../utils/types';

interface ShowCardProps {
  show: Show;
  onPress: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
}

const statusColors: Record<string, { bg: string; text: string }> = {
  upcoming: { bg: '#DBEAFE', text: '#1E40AF' },
  'in-progress': { bg: '#FEF3C7', text: '#92400E' },
  completed: { bg: '#DCFCE7', text: '#166534' },
  cancelled: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function ShowCard({ show, onPress, onDelete, onDuplicate }: ShowCardProps) {
  const statusColor = statusColors[show.status] || statusColors.upcoming;
  
  // Calculate completion percentage
  const sections = [
    show.performers.length > 0,
    show.schedule.length > 0,
    show.hosts.length > 0,
    show.djSongs.length > 0,
    show.staff.length > 0,
  ];
  const completionPercent = Math.round((sections.filter(Boolean).length / sections.length) * 100);

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <Text style={styles.showName} numberOfLines={2}>
          {show.name}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            onPress={() => {
              Alert.alert('Duplicate Show', `Create a copy of "${show.name}"?`, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Duplicate',
                  onPress: onDuplicate,
                },
              ]);
            }}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
          >
            <Text style={styles.actionBtnText}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
          >
            <Text style={styles.deleteBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Status Badge */}
      <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
        <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
          {show.status.replace('-', ' ')}
        </Text>
      </View>

      {show.date ? <Text style={styles.date}>{show.date}</Text> : null}

      {/* Completion Bar */}
      <View style={styles.completionBar}>
        <View style={[styles.completionFill, { width: `${completionPercent}%` }]} />
      </View>
      <Text style={styles.completionText}>{completionPercent}% complete</Text>

      <View style={styles.preview}>
        {show.performers.length > 0 && (
          <Text style={styles.previewText}>
            👤 {show.performers.length} performer{show.performers.length !== 1 ? 's' : ''}
          </Text>
        )}
        {show.venueName ? (
          <Text style={styles.previewText} numberOfLines={1}>
            📍 {show.venueName}
          </Text>
        ) : null}
        {show.schedule.length > 0 && (
          <Text style={styles.previewText}>
            ⏱️ {show.schedule.length} time slot{show.schedule.length !== 1 ? 's' : ''}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginHorizontal: Platform.OS === 'ios' ? 16 : 8,
    marginVertical: Platform.OS === 'ios' ? 8 : 8,
    backgroundColor: '#FFFFFF',
    borderRadius: Platform.OS === 'ios' ? 12 : 16,
    padding: Platform.OS === 'ios' ? 16 : 16,
    minHeight: 180,
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    } : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.12,
      shadowRadius: 8,
      elevation: 4,
    }),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  showName: {
    fontSize: Platform.OS === 'ios' ? 17 : 16,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    color: '#000000',
    flex: 1,
    marginRight: 12,
    lineHeight: Platform.OS === 'ios' ? 22 : 22,
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0,
  },
  actions: {
    flexDirection: 'row',
    gap: Platform.OS === 'ios' ? 8 : 8,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 18,
    color: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    padding: Platform.OS === 'ios' ? 4 : 6,
  },
  deleteBtnText: {
    fontSize: 18,
    color: Platform.OS === 'ios' ? '#FF3B30' : '#EF4444',
    padding: Platform.OS === 'ios' ? 4 : 6,
    fontWeight: Platform.OS === 'ios' ? '400' : 'normal',
  },
  statusBadge: {
    paddingHorizontal: Platform.OS === 'ios' ? 8 : 12,
    paddingVertical: Platform.OS === 'ios' ? 4 : 6,
    borderRadius: Platform.OS === 'ios' ? 6 : 8,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  statusBadgeText: {
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    fontWeight: '600',
    textTransform: 'capitalize',
    letterSpacing: Platform.OS === 'ios' ? -0.08 : 0,
  },
  date: {
    fontSize: Platform.OS === 'ios' ? 15 : 14,
    color: '#6B7280',
    marginBottom: 8,
    fontWeight: Platform.OS === 'ios' ? '400' : 'normal',
  },
  completionBar: {
    height: Platform.OS === 'ios' ? 4 : 6,
    backgroundColor: '#E5E7EB',
    borderRadius: Platform.OS === 'ios' ? 2 : 3,
    marginTop: 10,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : '#6B46C1',
    borderRadius: Platform.OS === 'ios' ? 2 : 3,
  },
  completionText: {
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    color: '#6B7280',
    marginTop: 6,
    fontWeight: Platform.OS === 'ios' ? '500' : '600',
  },
  preview: {
    marginTop: 10,
    gap: Platform.OS === 'ios' ? 4 : 5,
  },
  previewText: {
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    color: '#6B7280',
    lineHeight: 18,
  },
});
