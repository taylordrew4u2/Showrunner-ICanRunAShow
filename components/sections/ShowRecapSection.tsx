import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
} from 'react-native';
import { ShowRecap, Expense } from '../../utils/types';

interface ShowRecapSectionProps {
  recap: ShowRecap | undefined;
  expenses: Expense[];
  onChange: (recap: ShowRecap) => void;
}

export default function ShowRecapSection({ recap, expenses, onChange }: ShowRecapSectionProps) {
  const [attendance, setAttendance] = useState(recap?.attendance?.toString() ?? '');
  const [merchSales, setMerchSales] = useState(recap?.merchSales?.toString() ?? '');
  const [performerNotes, setPerformerNotes] = useState(recap?.performerNotes ?? '');
  const [improvementNotes, setImprovementNotes] = useState(recap?.improvementNotes ?? '');

  const totalExpenses = expenses.reduce((sum, e) => sum + e.cost, 0);
  const revenue = Number(merchSales) || 0;
  const profitLoss = revenue - totalExpenses;

  // Sync local state when recap prop changes from outside
  const recapKey = JSON.stringify(recap);
  useEffect(() => {
    setAttendance(recap?.attendance?.toString() ?? '');
    setMerchSales(recap?.merchSales?.toString() ?? '');
    setPerformerNotes(recap?.performerNotes ?? '');
    setImprovementNotes(recap?.improvementNotes ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recapKey]);

  function commit(overrides: Partial<{
    attendance: string;
    merchSales: string;
    performerNotes: string;
    improvementNotes: string;
  }>) {
    const a = overrides.attendance ?? attendance;
    const m = overrides.merchSales ?? merchSales;
    const pn = overrides.performerNotes ?? performerNotes;
    const imp = overrides.improvementNotes ?? improvementNotes;
    const rev = Number(m) || 0;
    const updated: ShowRecap = {
      attendance: Number(a) || undefined,
      merchSales: Number(m) || undefined,
      performerNotes: pn.trim() || undefined,
      improvementNotes: imp.trim() || undefined,
      profitLoss: rev - totalExpenses,
    };
    onChange(updated);
  }

  const plPositive = profitLoss >= 0;

  return (
    <View style={styles.container}>
      <Text style={styles.intro}>
        Track attendance, sales, performer feedback, and lessons learned.
      </Text>

      {/* Attendance */}
      <View style={styles.field}>
        <Text style={styles.label}>ATTENDANCE</Text>
        <TextInput
          style={styles.input}
          value={attendance}
          onChangeText={(v: string) => {
            setAttendance(v);
            commit({ attendance: v });
          }}
          placeholder="Number of attendees"
          placeholderTextColor="#9CA3AF"
          keyboardType="number-pad"
        />
      </View>

      {/* Merch Sales */}
      <View style={styles.field}>
        <Text style={styles.label}>MERCHANDISE SALES ($)</Text>
        <TextInput
          style={styles.input}
          value={merchSales}
          onChangeText={(v: string) => {
            setMerchSales(v);
            commit({ merchSales: v });
          }}
          placeholder="0.00"
          placeholderTextColor="#9CA3AF"
          keyboardType="decimal-pad"
        />
      </View>

      {/* Financial Summary */}
      <View style={styles.finCard}>
        <Text style={styles.finTitle}>Financial Summary</Text>
        <View style={styles.finRow}>
          <Text style={styles.finLabel}>Total Revenue (Merch):</Text>
          <Text style={styles.finValue}>${revenue.toFixed(2)}</Text>
        </View>
        <View style={styles.finRow}>
          <Text style={styles.finLabel}>Total Expenses:</Text>
          <Text style={[styles.finValue, styles.finValueNeg]}>-${totalExpenses.toFixed(2)}</Text>
        </View>
        <View style={[styles.finRow, styles.finRowTotal]}>
          <Text style={[styles.finLabel, styles.finLabelStrong]}>Profit / Loss:</Text>
          <Text style={[styles.finValue, styles.finValueStrong, plPositive ? styles.finValuePos : styles.finValueNeg]}>
            {plPositive ? '+' : ''}${profitLoss.toFixed(2)}
          </Text>
        </View>
      </View>

      {/* Performer Notes */}
      <View style={styles.field}>
        <Text style={styles.label}>PERFORMER NOTES</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={performerNotes}
          onChangeText={(v: string) => {
            setPerformerNotes(v);
            commit({ performerNotes: v });
          }}
          placeholder="Notes about performer quality, audience response, technical issues…"
          placeholderTextColor="#9CA3AF"
          multiline
          textAlignVertical="top"
        />
      </View>

      {/* Improvement Notes */}
      <View style={styles.field}>
        <Text style={styles.label}>IMPROVEMENT NOTES</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={improvementNotes}
          onChangeText={(v: string) => {
            setImprovementNotes(v);
            commit({ improvementNotes: v });
          }}
          placeholder="What should we do better next time? Lessons learned…"
          placeholderTextColor="#9CA3AF"
          multiline
          textAlignVertical="top"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
  },
  intro: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  field: {
    gap: 6,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.8,
  },
  input: {
    backgroundColor: '#FAFAFA',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1F2937',
  },
  textarea: {
    minHeight: 96,
    paddingTop: 12,
  },
  finCard: {
    backgroundColor: '#F9FAFB',
    borderWidth: 1.5,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  finTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 2,
  },
  finRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  finRowTotal: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  finLabel: {
    fontSize: 13,
    color: '#6B7280',
    fontWeight: '500',
  },
  finLabelStrong: {
    fontWeight: '700',
    color: '#374151',
  },
  finValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
  },
  finValueStrong: {
    fontSize: 16,
    fontWeight: '800',
  },
  finValuePos: {
    color: '#16A34A',
  },
  finValueNeg: {
    color: '#DC2626',
  },
});
