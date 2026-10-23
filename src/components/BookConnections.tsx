import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { BookLocation, BookPassage } from '../models/book';
import type { SyntaxRole, Token } from '../models/types';
import { bookTopics, hasLanguageBook, selectBookPassages, chapterNumbersForRole } from '../services/bookService';
import { ACCENT_DARK } from '../constants/theme';

export function BookRuleLink({ language, role, sentence = '', tokens = [], onConsult }: { language: string; role: SyntaxRole; sentence?: string; tokens?: Token[]; onConsult?: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const chapter = bookTopics(language, role)[0];
  if (!chapter) return null;
  return <TouchableOpacity accessibilityRole="button" style={s.ruleLink} onPress={() => {
    onConsult?.();
    const passage = selectBookPassages(language, sentence, tokens).find(p => p.chapterId === chapter.id);
    navigation.push('Book', passage || { chapterId: chapter.id });
  }}><Text style={s.link}>Книга: {chapter.title.toLowerCase()} →</Text></TouchableOpacity>;
}
export default function BookConnections({ language, sentence = '', tokens = [], passages, onOpen, initiallyOpen = false, compact = false }: {
  language: string; sentence?: string; tokens?: Token[]; passages?: BookPassage[];
  onOpen?: (location: BookLocation) => void; initiallyOpen?: boolean; compact?: boolean;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [expanded, setExpanded] = useState(initiallyOpen);
  const links = useMemo(() => {
    if (passages) return passages;
    const numbers = new Set([1, 2, 3, ...tokens.flatMap(t => chapterNumbersForRole(t.role))]);
    const selected = selectBookPassages(language, sentence, tokens);
    return bookTopics(language).filter(chapter => numbers.has(chapter.number)).map(chapter => ({
      chapterId: chapter.id, blockId: selected.find(p => p.chapterId === chapter.id)?.blockId, title: chapter.title,
    }));
  }, [language, sentence, tokens, passages]);
  const open = (location: BookLocation) => onOpen ? onOpen(location) : navigation.push('Book', location);
  return <View style={[s.card, compact && s.compactCard]}>
    <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded }} testID="book-rules-toggle" onPress={() => setExpanded(!expanded)} style={[s.toggle, compact && s.compactToggle]}>
      <Text style={[s.title, compact && s.compactTitle]}>Правила из книги {expanded ? '⌃' : '⌄'}</Text>{!compact && <Text style={s.small}>Текст автора · доступен без интернета</Text>}
    </TouchableOpacity>
    {expanded && <View style={s.links}>
      {!hasLanguageBook(language) && <Text style={s.small}>Для этого языка отдельной главы пока нет. Эти ссылки ведут к общей методике; особенности языка требуют дополнительного пояснения.</Text>}
      {passages && <Text style={s.small}>Эти фрагменты переданы ИИ как источники. Проверьте, подходит ли правило к предложению.</Text>}
      {links.map((location, i) => <TouchableOpacity key={location.chapterId + (location.blockId || '') + i} accessibilityRole="button" style={s.ruleLink} onPress={() => open(location)}><Text style={s.link}>{location.title} →</Text></TouchableOpacity>)}
      <TouchableOpacity accessibilityRole="button" style={s.ruleLink} onPress={() => open({ chapterId: 'method-0' })}><Text style={s.link}>Как пользоваться методом →</Text></TouchableOpacity>
    </View>}
  </View>;
}
const s = StyleSheet.create({
  compactCard: { backgroundColor: 'transparent', borderWidth: 0, borderTopWidth: 1, borderColor: '#E4E7EC', borderRadius: 0, padding: 0, marginVertical: 4 },
  compactToggle: { minHeight: 44, justifyContent: 'center' },
  compactTitle: { fontSize: 14, fontWeight: '500', color: '#667085' },
  card: { backgroundColor: '#FFFBF2', borderWidth: 1, borderColor: '#E8D9BC', borderRadius: 12, padding: 12, marginVertical: 10 },
  toggle: { paddingVertical: 5, gap: 4 }, title: { fontSize: 15, fontWeight: '700', color: '#172033' },
  small: { fontSize: 12, lineHeight: 18, color: '#64748B' }, links: { marginTop: 8 },
  ruleLink: { paddingVertical: 10 }, link: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: ACCENT_DARK },
});
