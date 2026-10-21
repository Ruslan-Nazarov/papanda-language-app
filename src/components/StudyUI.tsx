import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { Sentence, SyntaxRole } from '../models/types';
import { getRoleColor, ROLE_TRANSLATIONS } from '../constants/sentencePresentation';
import { ACCENT } from '../constants/theme';

export function StudyButton({ title, onPress, disabled, selected }: { title: string; onPress: () => void; disabled?: boolean; selected?: boolean }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled, selected: !!selected }} disabled={disabled} onPress={onPress}
    style={[studyStyles.button, selected && { backgroundColor: ACCENT }, disabled && { opacity: 0.45 }]}>
    <Text style={[studyStyles.buttonText, selected && { color: '#FFF' }]}>{title}</Text>
  </TouchableOpacity>;
}
export function StudyTokens({ sentence, added = [], role }: { sentence: Sentence; added?: number[]; role?: SyntaxRole }) {
  return <View style={studyStyles.row}>{sentence.words.map((word, i) => <View key={i} style={[studyStyles.token, {
    borderBottomColor: getRoleColor(word.role), opacity: role && role !== word.role ? 0.35 : 1,
    backgroundColor: added.includes(i) ? '#FEF3C7' : '#FFF',
  }]}><Text style={studyStyles.word}>{word.text}</Text><Text style={studyStyles.small}>{ROLE_TRANSLATIONS[word.role]}{added.includes(i) ? ' · новое' : ''}</Text></View>)}</View>;
}
export const studyStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginVertical: 8, borderColor: '#E2E8F0', borderWidth: 1, gap: 10 },
  title: { fontSize: 20, fontWeight: '700', color: '#172033' },
  text: { fontSize: 15, lineHeight: 23, color: '#334155' },
  small: { fontSize: 12, color: '#64748B', lineHeight: 18 },
  button: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: '#EEF2F6', alignSelf: 'flex-start' },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 12, fontSize: 16, color: '#172033', backgroundColor: '#FFF', minHeight: 48 },
  token: { padding: 8, borderBottomWidth: 3, borderRadius: 6 },
  word: { fontSize: 21, color: '#172033' },
  warning: { color: '#9A3412', fontSize: 14, lineHeight: 21 },
});
