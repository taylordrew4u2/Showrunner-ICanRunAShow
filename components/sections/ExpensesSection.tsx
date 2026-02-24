import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Alert,
  ScrollView,
} from 'react-native';
import { Expense, EXPENSE_CATEGORIES } from '../../utils/types';
import { generateId } from '../../utils/storage';

interface Props {
  expenses: Expense[];
  onChange: (expenses: Expense[]) => void;
}

const EMPTY = { category: EXPENSE_CATEGORIES[0], itemName: '', cost: '', date: '', notes: '' };

export default function ExpensesSection({ expenses, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [draft, setDraft] = useState(EMPTY);

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY);
    setModalVisible(true);
  };

  const openEdit = (e: Expense) => {
    setEditing(e);
    setDraft({
      category: e.category,
      itemName: e.itemName,
      cost: String(e.cost),
      date: e.date ?? '',
      notes: e.notes ?? '',
    });
    setModalVisible(true);
  };

  const save = () => {
    if (!draft.itemName.trim()) {
      Alert.alert('Item name required', 'Please enter an item name.');
      return;
    }
    const cost = parseFloat(draft.cost) || 0;
    if (editing) {
      onChange(
        expenses.map((e) =>
          e.id === editing.id
            ? { ...editing, category: draft.category, itemName: draft.itemName, cost, date: draft.date, notes: draft.notes }
            : e
        )
      );
    } else {
      onChange([
        ...expenses,
        {
          id: generateId(),
          category: draft.category,
          itemName: draft.itemName,
          cost,
          date: draft.date || undefined,
          notes: draft.notes || undefined,
        },
      ]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Expense', 'Remove this expense?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => onChange(expenses.filter((e) => e.id !== id)) },
    ]);
  };

  return (
    <View style={styles.container}>
      {expenses.length === 0 ? (
        <Text style={styles.empty}>No expenses added yet.</Text>
      ) : (
        <>
          {expenses.map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={styles.categoryTag}>
                <Text style={styles.categoryTagText}>{e.category}</Text>
              </View>
              <View style={styles.info}>
                <Text style={styles.itemName}>{e.itemName}</Text>
                {e.date ? <Text style={styles.meta}>{e.date}</Text> : null}
                {e.notes ? <Text style={styles.meta}>{e.notes}</Text> : null}
              </View>
              <Text style={styles.cost}>${(Number(e.cost) || 0).toFixed(2)}</Text>
              <TouchableOpacity onPress={() => openEdit(e)} style={styles.editBtn}>
                <Text style={styles.editBtnText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => remove(e.id)} style={styles.deleteBtn}>
                <Text style={styles.deleteBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>${totalExpenses.toFixed(2)}</Text>
          </View>
        </>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
        <Text style={styles.addBtnText}>+ Add Expense</Text>
      </TouchableOpacity>

      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.overlay}>
          <ScrollView contentContainerStyle={styles.modal}>
            <Text style={styles.modalTitle}>{editing ? 'Edit Expense' : 'Add Expense'}</Text>

            <Text style={styles.fieldLabel}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catsScroll}>
              <View style={styles.catsRow}>
                {EXPENSE_CATEGORIES.map((cat) => (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.catChip, draft.category === cat && styles.catChipActive]}
                    onPress={() => setDraft((d) => ({ ...d, category: cat }))}
                  >
                    <Text style={[styles.catChipText, draft.category === cat && styles.catChipTextActive]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={styles.fieldLabel}>Item Name *</Text>
            <TextInput
              style={styles.input}
              value={draft.itemName}
              onChangeText={(v) => setDraft((d) => ({ ...d, itemName: v }))}
              placeholder="e.g. Venue deposit"
              placeholderTextColor="#9CA3AF"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Cost ($)</Text>
            <TextInput
              style={styles.input}
              value={draft.cost}
              onChangeText={(v) => setDraft((d) => ({ ...d, cost: v }))}
              placeholder="0.00"
              placeholderTextColor="#9CA3AF"
              keyboardType="decimal-pad"
            />

            <Text style={styles.fieldLabel}>Date (optional)</Text>
            <TextInput
              style={styles.input}
              value={draft.date}
              onChangeText={(v) => setDraft((d) => ({ ...d, date: v }))}
              placeholder="e.g. Jan 5, 2025"
              placeholderTextColor="#9CA3AF"
            />

            <Text style={styles.fieldLabel}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.multiline]}
              value={draft.notes}
              onChangeText={(v) => setDraft((d) => ({ ...d, notes: v }))}
              placeholder="Any additional notes..."
              placeholderTextColor="#9CA3AF"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: '#fff', borderRadius: 10, padding: 12, marginBottom: 8 },
  empty: { color: '#9CA3AF', fontStyle: 'italic', textAlign: 'center', paddingVertical: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F3F4F6' },
  categoryTag: { backgroundColor: '#F0FDF4', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, marginRight: 8, borderWidth: 1, borderColor: '#BBF7D0' },
  categoryTagText: { color: '#059669', fontSize: 10, fontWeight: '700' },
  info: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: '600', color: '#1F2937' },
  meta: { fontSize: 11, color: '#6B7280', marginTop: 1 },
  cost: { fontSize: 14, fontWeight: '700', color: '#1F2937', marginRight: 8 },
  editBtn: { backgroundColor: '#EDE9FE', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  editBtnText: { color: '#6B46C1', fontSize: 12, fontWeight: '600' },
  deleteBtn: { padding: 6 },
  deleteBtnText: { color: '#EF4444', fontSize: 14 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 10, borderTopWidth: 2, borderTopColor: '#6B46C1', marginTop: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: '#1F2937' },
  totalAmount: { fontSize: 17, fontWeight: '800', color: '#6B46C1' },
  addBtn: { marginTop: 10, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 11, alignItems: 'center', borderWidth: 1, borderColor: '#E5E7EB', borderStyle: 'dashed' },
  addBtnText: { color: '#6B46C1', fontWeight: '600', fontSize: 14 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#1F2937', marginBottom: 16 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#374151', marginBottom: 5, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  catsScroll: { marginBottom: 4 },
  catsRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  catChip: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#F9FAFB' },
  catChipActive: { backgroundColor: '#059669', borderColor: '#059669' },
  catChipText: { fontSize: 13, color: '#374151', fontWeight: '500' },
  catChipTextActive: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: '#1F2937', backgroundColor: '#F9FAFB' },
  multiline: { height: 80, textAlignVertical: 'top' },
  modalBtns: { flexDirection: 'row', gap: 12, marginTop: 24 },
  cancelBtn: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  cancelBtnText: { color: '#374151', fontWeight: '600', fontSize: 15 },
  saveBtn: { flex: 1, backgroundColor: '#6B46C1', borderRadius: 8, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
