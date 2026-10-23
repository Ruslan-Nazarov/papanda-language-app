import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, TextInput, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { BookLocation } from '../models/book';
import { BOOK_TITLE, BOOK_AUTHOR, bookLanguages, bookChapters, getBookChapter, chaptersForLanguage, bookLanguageCode, isBookLocation, searchBook, bookSnippet } from '../services/bookService';
import { useBookStore } from '../store/bookStore';
import { BookBlockContent } from '../components/BookContent';
import { BookSections } from '../components/BookSections';
import { StudyButton } from '../components/StudyUI';
import { ACCENT_DARK } from '../constants/theme';

export default function BookScreen({ route, navigation }: NativeStackScreenProps<RootStackParamList, 'Book'>) {
  const insets = useSafeAreaInsets();
  const [location, setLocation] = useState<BookLocation | undefined>(() => route.params?.chapterId && isBookLocation(route.params) ? route.params : undefined);
  const [language, setLanguage] = useState(() => bookLanguageCode(route.params?.language || 'method'));
  const [query, setQuery] = useState('');
  const [allLanguages, setAllLanguages] = useState(false);
  const [showSections, setShowSections] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [currentBlockId, setCurrentBlockId] = useState<string | undefined>();
  const { lastLocation, bookmarks, fontSize, remember, toggleBookmark, setFontSize } = useBookStore();
  const scroll = useRef<ScrollView>(null);
  const offsets = useRef(new Map<string, number>());
  const pendingJump = useRef<string | undefined>(undefined);
  const visibleLocation = useRef<BookLocation | undefined>(undefined);
  const chapter = getBookChapter(location?.chapterId);
  const chapterList = chaptersForLanguage(language);
  const results = useMemo(() => searchBook(query, allLanguages ? undefined : language), [query, allLanguages, language]);
  const open = (next: BookLocation) => {
    if (!isBookLocation(next)) return;
    const selected = getBookChapter(next.chapterId)!;
    const blockId = next.blockId || selected.blocks[0]?.id;
    setLanguage(selected.language); setQuery(''); setShowSections(false); setShowBookmarks(false);
    setCurrentBlockId(blockId); pendingJump.current = blockId;
    visibleLocation.current = { chapterId: next.chapterId, blockId };
    remember(visibleLocation.current);
    if (chapter?.id === next.chapterId && blockId && offsets.current.has(blockId)) {
      scroll.current?.scrollTo({ y: offsets.current.get(blockId), animated: false }); pendingJump.current = undefined;
    } else offsets.current.clear();
    setLocation({ ...next, blockId });
  };
  useEffect(() => {
    if (route.params?.chapterId && isBookLocation(route.params)) open(route.params);
    // Route parameters change when following another source link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.chapterId, route.params?.blockId]);
  useEffect(() => () => {
    if (visibleLocation.current) useBookStore.getState().remember(visibleLocation.current);
  }, []);
  const index = chapter ? chapterList.findIndex(c => c.id === chapter.id) : -1;
  const actualLocation = chapter ? { chapterId: chapter.id, blockId: currentBlockId || chapter.blocks[0]?.id } : undefined;
  const marked = !!actualLocation && bookmarks.some(b => b.chapterId === actualLocation.chapterId && b.blockId === actualLocation.blockId);
  const leaveChapter = () => {
    if (visibleLocation.current) remember(visibleLocation.current);
    setLocation(undefined); setShowSections(false); offsets.current.clear();
  };
  const practiceCode = chapter && ['en', 'de', 'it', 'fr', 'es', 'kz'].includes(chapter.language) ? chapter.language : null;
  return <View testID="book-screen" style={[s.root, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 16) }]}>
    <View style={s.top}>
      <StudyButton title="Назад" onPress={() => navigation.goBack()} />
      {chapter && <StudyButton title="Оглавление" onPress={leaveChapter} />}
      <View style={{ flex: 1 }} />
      {chapter && <>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Уменьшить шрифт книги" onPress={() => setFontSize(fontSize - 1)} style={s.fontButton}><Text style={s.fontText}>А−</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Увеличить шрифт книги" onPress={() => setFontSize(fontSize + 1)} style={s.fontButton}><Text style={s.fontText}>А+</Text></TouchableOpacity>
      </>}
    </View>
    {chapter ? <>
      <View style={s.readerBar}>
        <Text style={s.eyebrow}>{bookLanguages.find(l => l.code === chapter.language)?.title} · {chapter.number ? `Глава ${chapter.number}` : 'Метод'}</Text>
        <Text style={s.readerTitle}>{chapter.title}</Text>
        <View style={s.row}>
          <StudyButton title="Разделы главы" onPress={() => setShowSections(true)} />
          <StudyButton title={marked ? '★ В закладках' : '☆ Закладка'} onPress={() => actualLocation && toggleBookmark(actualLocation)} />
        </View>
      </View>
      {showSections && <BookSections chapter={chapter} currentBlockId={currentBlockId} fontSize={fontSize}
        onSelect={blockId => open({ chapterId: chapter.id, blockId })} onClose={() => setShowSections(false)} />}
      <ScrollView key={chapter.id} ref={scroll} testID="book-reader" scrollEventThrottle={250}
        onScroll={event => {
          if (pendingJump.current) return;
          const y = event.nativeEvent.contentOffset.y + 32;
          let best = chapter.blocks[0]?.id;
          for (const [id, offset] of offsets.current) if (offset <= y) best = id;
          if (best) { visibleLocation.current = { chapterId: chapter.id, blockId: best }; setCurrentBlockId(best); }
        }}
        onScrollEndDrag={() => { if (visibleLocation.current) remember(visibleLocation.current); }}
        onMomentumScrollEnd={() => { if (visibleLocation.current) remember(visibleLocation.current); }}
        contentContainerStyle={[s.reader, { paddingBottom: insets.bottom + 30 }]}>
        <Text style={s.author}>Текст книги · {BOOK_AUTHOR}</Text>
        {chapter.blocks.map(block => <View key={block.id} testID={`book-block-${block.id}`}
          onLayout={event => {
            offsets.current.set(block.id, event.nativeEvent.layout.y);
            if (pendingJump.current === block.id) {
              const y = event.nativeEvent.layout.y;
              requestAnimationFrame(() => { scroll.current?.scrollTo({ y, animated: false }); pendingJump.current = undefined; });
            }
          }} style={[s.block, location?.blockId === block.id && s.target]}>
          <BookBlockContent block={block} fontSize={fontSize} />
        </View>)}
        <View style={s.endCard}>
          <Text style={s.readerTitle}>От правила к предложению</Text>
          <Text style={s.body}>Найдите сказуемое, затем подлежащее и уточняющие части. Проверяйте роль по форме и связи слов.</Text>
          {practiceCode ? <StudyButton title="Практика этого языка" onPress={() => navigation.push('SentenceWorkshop', { language: practiceCode, mode: 'Самостоятельно' })} /> :
            <Text style={s.small}>{chapter.language === 'ru' ? 'Отдельного тренажёра русского языка пока нет. Сопоставляйте эти правила с переводами примеров.' : 'Выберите язык в мастерской и примените порядок разбора.'}</Text>}
          {!practiceCode && chapter.language !== 'ru' && <StudyButton title="Открыть мастерскую" onPress={() => navigation.push('SentenceWorkshop', undefined)} />}
          <View style={s.row}>
            <StudyButton title="Предыдущая глава" disabled={index <= 0} onPress={() => open({ chapterId: chapterList[index - 1].id })} />
            <StudyButton title="Следующая глава" disabled={index < 0 || index === chapterList.length - 1} onPress={() => open({ chapterId: chapterList[index + 1].id })} />
          </View>
        </View>
        <Text style={s.source}>Источник: {chapter.sourcePath}</Text>
      </ScrollView>
    </> : <ScrollView testID="book-library" keyboardShouldPersistTaps="handled" contentContainerStyle={[s.library, { paddingBottom: insets.bottom + 30 }]}>
      <View style={s.hero}><Text style={s.eyebrow}>КНИГА В ПРИЛОЖЕНИИ · БЕЗ ИНТЕРНЕТА</Text><Text style={s.title}>{BOOK_TITLE}</Text><Text style={s.author}>{BOOK_AUTHOR}</Text><Text style={s.body}>От предложения — к сказуемому, подлежащему и развитию мысли. Шесть иностранных языков, русский язык и общая схема.</Text></View>
      {lastLocation && <StudyButton title={`Продолжить: ${getBookChapter(lastLocation.chapterId)?.title}`} onPress={() => open(lastLocation)} />}
      <View style={s.row}><StudyButton title={`Закладки · ${bookmarks.length}`} selected={showBookmarks} onPress={() => setShowBookmarks(!showBookmarks)} /><StudyButton title="Начать с метода" onPress={() => open({ chapterId: 'method-0' })} /></View>
      {showBookmarks && <View style={s.panel}>
        {!bookmarks.length && <Text style={s.body}>Во время чтения нажмите «☆ Закладка», чтобы сохранить текущий фрагмент.</Text>}
        {bookmarks.map(bookmark => {
          const c = getBookChapter(bookmark.chapterId)!;
          const block = c.blocks.find(b => b.id === bookmark.blockId);
          return <View key={bookmark.chapterId + bookmark.blockId} style={s.bookmark}>
            <TouchableOpacity accessibilityRole="button" style={{ flex: 1 }} onPress={() => open(bookmark)}><Text style={s.link}>{bookLanguages.find(l => l.code === c.language)?.title} · {c.title}</Text><Text style={s.small}>{bookSnippet(block?.text || c.title, '', 100)}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Удалить закладку: ${c.title}`} style={s.fontButton} onPress={() => toggleBookmark(bookmark)}><Text style={s.small}>✕</Text></TouchableOpacity>
          </View>;
        })}
      </View>}
      <View style={s.row}>{bookLanguages.map(item => <StudyButton key={item.code} title={`${item.flag} ${item.title}`} selected={language === item.code} onPress={() => setLanguage(item.code)} />)}</View>
      {language === 'la' && <Text style={s.notice}>Отдельной главы о латыни в книге пока нет. Ниже — общая схема метода; особенности латыни объясняются дополнительно.</Text>}
      <TextInput accessibilityLabel="Поиск в книге" placeholder="Найти правило, форму или пример…" value={query} onChangeText={setQuery} style={s.search} clearButtonMode="while-editing" />
      <StudyButton title={allLanguages ? 'Поиск: вся книга' : 'Поиск: выбранный раздел'} selected={allLanguages} onPress={() => setAllLanguages(!allLanguages)} />
      {query.trim().length >= 2 ? <>
        <Text style={s.small}>{results.length >= 60 ? 'Первые 60 совпадений. Уточните запрос.' : `Найдено фрагментов: ${results.length}`}</Text>
        {results.map(result => <TouchableOpacity accessibilityRole="button" key={result.blockId} style={s.chapter} onPress={() => open(result)}><Text style={s.link}>{result.title}</Text><Text style={s.body}>{bookSnippet(result.text, query)}</Text></TouchableOpacity>)}
        {!results.length && <Text style={s.body}>Совпадений нет. Попробуйте часть слова или поиск по всей книге.</Text>}
      </> : chapterList.map(c => <TouchableOpacity accessibilityRole="button" testID={`book-chapter-${c.id}`} key={c.id} style={s.chapter} onPress={() => open({ chapterId: c.id })}>
        <Text style={s.eyebrow}>{c.number ? `Глава ${c.number}` : 'Начните здесь'}</Text><Text style={s.chapterTitle}>{c.title}</Text>
        <Text style={s.small}>{c.blocks.filter(b => b.kind === 'heading').length} разделов · читать →</Text>
      </TouchableOpacity>)}
      <Text style={s.source}>{bookChapters.length} глав и материалов. Источник — авторские файлы книги. Оформление адаптировано для телефона; пояснения ИИ показываются отдельно от текста книги.</Text>
    </ScrollView>}
  </View>;
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' }, top: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 12, gap: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  library: { padding: 18, gap: 14, width: '100%', maxWidth: 780, alignSelf: 'center' }, hero: { backgroundColor: '#FFF7E8', padding: 20, borderRadius: 18, gap: 10 },
  title: { fontSize: 26, lineHeight: 34, fontWeight: '700', color: '#172033' }, eyebrow: { fontSize: 11, color: '#64748B', fontWeight: '700', letterSpacing: 0.7 },
  author: { fontSize: 13, color: '#64748B', marginBottom: 12 }, body: { fontSize: 15, lineHeight: 23, color: '#334155' }, small: { fontSize: 12, lineHeight: 18, color: '#64748B' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, panel: { padding: 12, borderRadius: 12, backgroundColor: '#FFF', gap: 10 }, bookmark: { flexDirection: 'row', gap: 8 },
  chapter: { backgroundColor: '#FFF', padding: 18, borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 }, chapterTitle: { fontSize: 19, lineHeight: 27, color: '#172033', fontWeight: '600' },
  link: { color: ACCENT_DARK, fontSize: 14, lineHeight: 22, fontWeight: '600' }, search: { borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', color: '#172033', borderRadius: 12, padding: 14, fontSize: 16 },
  readerBar: { paddingHorizontal: 18, paddingVertical: 10, gap: 5, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }, readerTitle: { color: '#172033', fontSize: 18, lineHeight: 25, fontWeight: '700' },
  reader: { paddingHorizontal: 18, paddingTop: 20, width: '100%', maxWidth: 780, alignSelf: 'center' }, block: { marginBottom: 8, paddingHorizontal: 8 }, target: { backgroundColor: '#FFF7E8', borderRadius: 10 },
  fontButton: { paddingVertical: 12, paddingHorizontal: 8 }, fontText: { fontSize: 16, color: ACCENT_DARK, fontWeight: '600' },
  source: { color: '#64748B', fontSize: 11, lineHeight: 17, marginVertical: 12 }, endCard: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16, gap: 12, marginTop: 20 },
  notice: { color: '#92400E', fontSize: 14, lineHeight: 21, backgroundColor: '#FFF7E8', borderRadius: 10, padding: 14 },
});
