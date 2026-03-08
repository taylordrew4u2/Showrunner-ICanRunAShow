import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
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
    marginHorizontal: 16,
    marginVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    minHeight: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  showName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000000',
    flex: 1,
    marginRight: 12,
    lineHeight: 22,
    letterSpacing: -0.4,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 18,
    color: '#007AFF',
    padding: 4,
  },
  deleteBtnText: {
    fontSize: 18,
    color: '#FF3B30',
    padding: 4,
    fontWeight: '400',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 8,
  },
  statusBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
    letterSpacing: -0.08,
  },
  date: {
    fontSize: 15,
    color: '#6B7280',
    marginBottom: 8,
    fontWeight: '400',
  },
  completionBar: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    marginTop: 10,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: '#007AFF',
    borderRadius: 2,
  },
  completionText: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
    fontWeight: '500',
  },
  preview: {
    marginTop: 10,
    gap: 4,
  },
  previewText: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
});
