import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Show } from '../utils/types';

interface ShowCardProps {
  show: Show;
  onPress: () => void;
  onDelete: () => void;
}

export default function ShowCard({ show, onPress, onDelete }: ShowCardProps) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.topRow}>
        <Text style={styles.showName} numberOfLines={2}>
          {show.name}
        </Text>
        <TouchableOpacity
          onPress={onDelete}
          style={styles.deleteBtn}
          hitSlop={{ top: 10, right: 10, bottom: 10, left: 10 }}
        >
          <Text style={styles.deleteBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {show.date ? <Text style={styles.date}>{show.date}</Text> : null}

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
        {show.expenses.length > 0 && (
          <Text style={styles.previewText}>
            💰 {show.expenses.length} expense{show.expenses.length !== 1 ? 's' : ''}
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
    minHeight: 120,
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
    marginBottom: 6,
  },
  showName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1F2937',
    flex: 1,
    marginRight: 8,
  },
  deleteBtn: {
    padding: 2,
  },
  deleteBtnText: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  date: {
    fontSize: 12,
    color: '#6B46C1',
    fontWeight: '600',
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
