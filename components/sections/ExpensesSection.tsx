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
  Image,
} from 'react-native';
import { Expense, EXPENSE_CATEGORIES, AppSettings } from '../../utils/types';
import { generateId } from '../../utils/storage';
import { pickImage } from '../../utils/filePicker';

interface Props {
  expenses: Expense[];
  settings?: AppSettings;
  onChange: (expenses: Expense[]) => void;
}

type DraftExpense = {
  category: string;
  itemName: string;
  cost: string;
  date: string;
  notes: string;
  receiptPhoto?: string;
};

const EMPTY: DraftExpense = {
  category: EXPENSE_CATEGORIES[0],
  itemName: '',
  cost: '',
  date: '',
  notes: '',
  receiptPhoto: undefined,
};

export default function ExpensesSection({ expenses, settings, onChange }: Props) {
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [draft, setDraft] = useState<DraftExpense>(EMPTY);
  const [viewingReceipt, setViewingReceipt] = useState<string | null>(null);

  const totalExpenses = expenses.reduce((sum, e) => sum + (Number(e.cost) || 0), 0);
  const brandBudget = settings?.brandBudget ?? 0;
  const totalSpent = settings?.totalSpent ?? 0;
  const remaining = brandBudget - totalSpent;

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
      receiptPhoto: e.receiptPhoto,
    });
    setModalVisible(true);
  };

  const pickReceipt = async () => {
    const uri = await pickImage();
    if (uri) setDraft((d) => ({ ...d, receiptPhoto: uri }));
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
            ? {
                ...editing,
                category: draft.category,
                itemName: draft.itemName,
                cost,
                date: draft.date || undefined,
                notes: draft.notes || undefined,
                receiptPhoto: draft.receiptPhoto,
              }
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
          receiptPhoto: draft.receiptPhoto,
        },
      ]);
    }
    setModalVisible(false);
  };

  const remove = (id: string) => {
    Alert.alert('Remove Expense', 'Remove this expense?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onChange(expenses.filter((e) => e.id !== id)),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* Brand budget card */}
      {brandBudget > 0 && (
        <View style={styles.budgetCard}>
          <Text style={styles.budgetCardTitle}>Brand Budget Tracking</Text>
          <View style={styles.budgetCardGrid}>
            <View style={styles.budgetCardItem}>
              <Text style={styles.budgetCardLabel}>Total Budget</Text>
              <Text style={[styles.budgetCardValue, styles.budgetCardValuePrimary]}>
                ${brandBudget.toFixed(2)}
              </Text>
            </View>
            <View style={styles.budgetCardItem}>
              <Text style={styles.budgetCardLabel}>Total Spent</Text>
              <Text style={[styles.budgetCardValue, styles.budgetCardValueSpent]}>
                ${totalSpent.toFixed(2)}
              </Text>
            </View>
            <View style={styles.budgetCardItem}>
              <Text style={styles.budgetCardLabel}>Remaining</Text>
              <Text
                style={[
                  styles.budgetCardValue,
                  remaining >= 0 ? styles.budgetCardValuePositive : styles.budgetCardValueNegative,
                ]}
              >
                ${remaining.toFixed(2)}
              </Text>
            </View>
          </View>
        </View>
      )}

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
              {e.receiptPhoto ? (
                <TouchableOpacity
                  onPress={() => setViewingReceipt(e.receiptPhoto!)}
                  style={styles.receiptThumbBtn}
                >
                  <Image source={{ uri: e.receiptPhoto }} style={styles.receiptThumb} />
                </TouchableOpacity>
              ) : null}
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

      {/* Add / Edit modal */}
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
                    <Text
                      style={[
                        styles.catChipText,
                        draft.category === cat && styles.catChipTextActive,
                      ]}
                    >
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

            <Text style={styles.fieldLabel}>Receipt Photo (optional)</Text>
            <TouchableOpacity style={styles.fileBtn} onPress={pickReceipt}>
              {draft.receiptPhoto ? (
                <Image source={{ uri: draft.receiptPhoto }} style={styles.receiptPreview} />
              ) : (
                <Text style={styles.fileBtnText}>📷 Upload Receipt</Text>
              )}
            </TouchableOpacity>
            {draft.receiptPhoto ? (
              <TouchableOpacity
                onPress={() => setDraft((d) => ({ ...d, receiptPhoto: undefined }))}
              >
                <Text style={styles.clearLink}>Remove receipt photo</Text>
              </TouchableOpacity>
            ) : null}

            <View style={styles.modalBtns}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setModalVisible(false)}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={save}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Receipt viewer */}
      <Modal
        visible={!!viewingReceipt}
        transparent
        animationType="fade"
        onRequestClose={() => setViewingReceipt(null)}
      >
        <TouchableOpacity
          style={styles.receiptOverlay}
          activeOpacity={1}
          onPress={() => setViewingReceipt(null)}
        >
          <View style={styles.receiptViewerContainer}>
            {viewingReceipt ? (
              <Image
                source={{ uri: viewingReceipt }}
                style={styles.receiptViewerImage}
                resizeMode="contain"
              />
            ) : null}
            <Text style={styles.receiptViewerHint}>Tap anywhere to close</Text>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
  },
  budgetCard: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  budgetCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  budgetCardGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  budgetCardItem: {
    alignItems: 'center',
    flex: 1,
  },
  budgetCardLabel: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 4,
  },
  budgetCardValue: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },
  budgetCardValuePrimary: { color: '#6B46C1' },
  budgetCardValueSpent: { color: '#EF4444' },
  budgetCardValuePositive: { color: '#059669' },
  budgetCardValueNegative: { color: '#EF4444' },
  empty: {
    color: '#9CA3AF',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
    fontSize: 14,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    minHeight: 52,
  },
  categoryTag: {
    backgroundColor: '#F0FDF4',
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    minHeight: 34,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BBF7D0',
    marginRight: 10,
  },
  categoryTagText: {
    color: '#059669',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  info: {
    flex: 1,
  },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1F2937',
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    color: '#6B7280',
    marginTop: 2,
    lineHeight: 16,
  },
  cost: {
    fontSize: 15,
    fontWeight: '800',
    color: '#1F2937',
    marginRight: 8,
    lineHeight: 20,
    minWidth: 52,
  },
  receiptThumbBtn: {
    marginRight: 8,
  },
  receiptThumb: {
    width: 36,
    height: 36,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  editBtn: {
    backgroundColor: '#EDE9FE',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 44,
    justifyContent: 'center',
    marginRight: 8,
  },
  editBtnText: {
    color: '#6B46C1',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteBtn: {
    padding: 10,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteBtnText: {
    color: '#EF4444',
    fontSize: 16,
    fontWeight: '600',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 14,
    borderTopWidth: 2,
    borderTopColor: '#6B46C1',
    marginTop: 6,
    paddingHorizontal: 4,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1F2937',
    lineHeight: 20,
  },
  totalAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6B46C1',
    lineHeight: 24,
  },
  addBtn: {
    marginTop: 12,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderStyle: 'dashed',
    minHeight: 48,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#6B46C1',
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 20,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 20,
    lineHeight: 28,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  catsScroll: {
    marginBottom: 6,
  },
  catsRow: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 6,
    paddingRight: 16,
  },
  catChip: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#F9FAFB',
    minHeight: 40,
    justifyContent: 'center',
  },
  catChipActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  catChipText: {
    fontSize: 14,
    color: '#374151',
    fontWeight: '500',
    lineHeight: 18,
  },
  catChipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: '#1F2937',
    backgroundColor: '#F9FAFB',
    minHeight: 48,
    lineHeight: 20,
  },
  multiline: {
    height: 100,
    textAlignVertical: 'top',
    paddingTop: 13,
  },
  fileBtn: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 10,
    padding: 14,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  fileBtnText: {
    color: '#374151',
    fontSize: 15,
    lineHeight: 20,
  },
  receiptPreview: {
    width: 120,
    height: 120,
    borderRadius: 10,
  },
  clearLink: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 6,
    textAlign: 'right',
    fontWeight: '500',
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 28,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: '#374151',
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 20,
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#6B46C1',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
  },
  saveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    lineHeight: 20,
  },
  // Receipt viewer
  receiptOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  receiptViewerContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  receiptViewerImage: {
    width: '90%',
    height: '80%',
  },
  receiptViewerHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
});
