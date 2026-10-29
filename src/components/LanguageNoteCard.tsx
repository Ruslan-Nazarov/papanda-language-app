import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UI } from '../constants/theme';
import type { LanguageNote } from '../models/notes';
import { NOTE_KINDS, NOTE_UNDERSTANDING } from '../utils/notes';
import { getLanguageLabel } from '../constants/languages';

export const NOTE_COLORS = { rule: '#FFF4CE', question: '#F0E9FC', observation: '#E7F1FC' };

export default function LanguageNoteCard({ note, onPress, draft = false }: {
  note: LanguageNote; onPress: () => void; draft?: boolean;
}) {
  return <TouchableOpacity testID={`note-card-${note.id}`} accessibilityRole="button"
    accessibilityLabel={`${draft ? 'Черновик: ' : ''}${note.title || 'Без названия'}. ${NOTE_KINDS[note.kind]}. ${NOTE_UNDERSTANDING[note.understanding]}`}
    onPress={onPress} activeOpacity={0.8} style={[styles.card, { backgroundColor: UI.surface }]}>
    <View style={styles.row}>
      <Text style={styles.meta}>{draft ? 'Черновик' : NOTE_KINDS[note.kind]} · {NOTE_UNDERSTANDING[note.understanding]}</Text>
      {note.pinned && <Ionicons name="pin" size={14} color="#6B634C" />}
    </View>
    <Text style={styles.title} numberOfLines={2}>{note.title || 'Моя заметка'}</Text>
    <Text style={styles.body} numberOfLines={2}>{note.body || 'Продолжить запись…'}</Text>
    <Text style={styles.footer} numberOfLines={1}>{getLanguageLabel(note.language)}{note.tags.length ? ` · ${note.tags.join(' · ')}` : ''}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  card: { borderRadius: UI.radius, borderWidth: 1, borderColor: UI.border, padding: 16, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  meta: { fontSize: 12, color: '#625C60', flexShrink: 1 },
  title: { fontSize: 17, lineHeight: 23, fontWeight: '700', color: '#263040', marginTop: 8 },
  body: { ...UI.reading, color: '#3E4754', marginTop: 5 },
  footer: { fontSize: 12, color: '#625C60', marginTop: 13, paddingRight: 10 },
});
