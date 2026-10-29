import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ACCENT, ACCENT_DARK, UI } from '../constants/theme';

export function NoteChip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  return <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityState={{ selected }}
    onPress={onPress} style={[noteStyles.chip, selected && noteStyles.chipSelected]}>
    <Text style={[noteStyles.chipText, selected && noteStyles.chipTextSelected]}>{label}</Text>
  </TouchableOpacity>;
}

export const noteStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: UI.canvas },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: '#E4E7EC' },
  title: { flex: 1, minWidth: 0, fontSize: 20, color: '#172033', fontWeight: '700' },
  iconButton: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerAction: { minHeight: 44, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 14, color: ACCENT_DARK, fontWeight: '600' },
  content: { width: '100%', maxWidth: UI.column, alignSelf: 'center', padding: 16, paddingBottom: 36, gap: 12 },
  label: { fontSize: 13, color: '#475467', fontWeight: '600', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#DDE2E8', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 12, color: '#263040', fontSize: 16, minHeight: 48 },
  bodyInput: { minHeight: 150, textAlignVertical: 'top', lineHeight: 24 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 12, backgroundColor: UI.subtle },
  chipSelected: { backgroundColor: '#FFF0E4' },
  chipText: { color: '#586373', fontSize: 13 },
  chipTextSelected: { color: ACCENT_DARK, fontWeight: '700' },
  secondary: { fontSize: 13, color: '#697586', lineHeight: 20 },
  source: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4E7EC', borderRadius: 12, padding: 13, gap: 7 },
  sourceText: { ...UI.reading, color: '#344054' },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, gap: 12 },
  toggleText: { fontSize: 14, color: '#344054', flex: 1 },
  primary: { minHeight: 48, backgroundColor: ACCENT, borderRadius: 12, justifyContent: 'center', alignItems: 'center', padding: 12 },
  primaryText: { color: UI.onAccent, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  danger: { fontSize: 14, color: '#B42318' },
  error: { fontSize: 14, color: '#B42318', lineHeight: 21 },
  empty: { paddingVertical: 32, alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#344054' },
});
