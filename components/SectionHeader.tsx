import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';

interface SectionHeaderProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  count?: number;
}

export default function SectionHeader({
  title,
  expanded,
  onToggle,
  count,
}: SectionHeaderProps) {
  return (
    <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.7}>
      <View style={styles.left}>
        <Text style={styles.title}>{title}</Text>
        {count !== undefined && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{count}</Text>
          </View>
        )}
      </View>
      <Text style={styles.arrow}>{expanded ? '▲' : '▼'}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Platform.OS === 'ios' ? '#FFFFFF' : '#6B46C1',
    paddingHorizontal: Platform.OS === 'ios' ? 16 : 18,
    paddingVertical: Platform.OS === 'ios' ? 16 : 15,
    borderRadius: Platform.OS === 'ios' ? 12 : 12,
    marginBottom: 8,
    minHeight: Platform.OS === 'ios' ? 56 : 52,
    ...(Platform.OS === 'ios' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      borderWidth: 0,
    } : {}),
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: Platform.OS === 'ios' ? '#000000' : '#fff',
    fontSize: Platform.OS === 'ios' ? 17 : 15,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
    letterSpacing: Platform.OS === 'ios' ? -0.4 : 0.3,
  },
  badge: {
    backgroundColor: Platform.OS === 'ios' ? '#007AFF' : 'rgba(255,255,255,0.35)',
    borderRadius: Platform.OS === 'ios' ? 12 : 12,
    paddingHorizontal: 9,
    paddingVertical: Platform.OS === 'ios' ? 4 : 4,
    minWidth: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: Platform.OS === 'ios' ? 13 : 12,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
  },
  arrow: {
    color: Platform.OS === 'ios' ? '#007AFF' : 'rgba(255,255,255,0.85)',
    fontSize: Platform.OS === 'ios' ? 16 : 14,
    padding: 6,
    fontWeight: Platform.OS === 'ios' ? '600' : 'normal',
  },
});
