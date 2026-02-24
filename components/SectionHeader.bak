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
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 10,
    marginBottom: 2,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.3)',
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  arrow: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
  },
});
