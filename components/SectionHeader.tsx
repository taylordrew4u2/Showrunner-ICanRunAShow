import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
    <TouchableOpacity style={styles.header} onPress={onToggle} activeOpacity={0.8}>
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
    backgroundColor: '#6B46C1',
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 12,
    marginBottom: 8,
    minHeight: 52,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  arrow: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    padding: 6,
  },
});
