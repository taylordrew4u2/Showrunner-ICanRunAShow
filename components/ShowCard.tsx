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
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
          >
            <Text style={styles.actionBtnText}>📋</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onDelete}
            hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
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
    margin: 6,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    minHeight: 160,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  showName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
    marginRight: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtnText: {
    fontSize: 14,
    opacity: 0.6,
  },
  deleteBtnText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  date: {
    fontSize: 12,
    color: '#6B46C1',
    fontWeight: '600',
    marginBottom: 8,
  },
  completionBar: {
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    marginBottom: 4,
    overflow: 'hidden',
  },
  completionFill: {
    height: '100%',
    backgroundColor: '#6B46C1',
  },
  completionText: {
    fontSize: 10,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  preview: {
    gap: 3,
  },
  previewText: {
    fontSize: 11,
    color: '#6B7280',
  },
});
