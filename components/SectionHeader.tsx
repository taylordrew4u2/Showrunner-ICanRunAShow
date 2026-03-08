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
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 12,
    marginBottom: 8,
    minHeight: 56,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    borderWidth: 0,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  badge: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    paddingHorizontal: 9,
    paddingVertical: 4,
    minWidth: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  arrow: {
    color: '#007AFF',
    fontSize: 16,
    padding: 6,
    fontWeight: '600',
  },
});
