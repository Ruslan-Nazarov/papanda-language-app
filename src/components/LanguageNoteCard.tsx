import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { LanguageNote } from '../models/notes';
import { NOTE_KINDS, NOTE_UNDERSTANDING } from '../utils/notes';
import { getLanguageLabel } from '../constants/languages';

export const NOTE_COLORS = { rule: '#FFF4CE', question: '#F0E9FC', observation: '#E7F1FC' };

export default function LanguageNoteCard({ note, onPress, draft = false }: {
  note: LanguageNote; onPress: () => void; draft?: boolean;
}) {
  return <TouchableOpacity testID={`note-card-${note.id}`} accessibilityRole="button"
    accessibilityLabel={`${draft ? 'Черновик: ' : ''}${note.title || 'Без названия'}. ${NOTE_KINDS[note.kind]}. ${NOTE_UNDERSTANDING[note.understanding]}`}
    onPress={onPress} activeOpacity={0.8} style={[styles.card, { backgroundColor: NOTE_COLORS[note.kind] }]}>
    <View style={styles.row}>
      <Text style={styles.meta}>{draft ? 'Черновик' : NOTE_KINDS[note.kind]} · {NOTE_UNDERSTANDING[note.understanding]}</Text>
      {note.pinned && <Ionicons name="pin" size={14} color="#6B634C" />}
    </View>
    <Text style={styles.title} numberOfLines={2}>{note.title || 'Моя заметка'}</Text>
    <Text style={styles.body} numberOfLines={2}>{note.body || 'Продолжить запись…'}</Text>
    <Text style={styles.footer} numberOfLines={1}>{getLanguageLabel(note.language)}{note.tags.length ? ` · ${note.tags.join(' · ')}` : ''}</Text>
    <View style={styles.fold} />
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  card: { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: 16, borderBottomRightRadius: 5, padding: 16,
    marginBottom: 12, overflow: 'hidden', shadowColor: '#5B4932', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 3, elevation: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  meta: { fontSize: 12, color: '#625C60', flexShrink: 1 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: '#263040', marginTop: 8 },
  body: { fontSize: 14, lineHeight: 21, color: '#3E4754', marginTop: 5 },
  footer: { fontSize: 12, color: '#625C60', marginTop: 13, paddingRight: 10 },
  fold: { position: 'absolute', bottom: 0, right: 0, width: 0, height: 0, borderStyle: 'solid', borderTopWidth: 15,
    borderRightWidth: 15, borderTopColor: 'transparent', borderRightColor: 'rgba(91,73,50,0.13)' },
});
