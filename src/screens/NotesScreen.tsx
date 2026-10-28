import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Platform, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { LanguageNote } from '../models/notes';
import { useStore } from '../store/useStore';
import { LANGUAGES } from '../constants/languages';
import { ACCENT_DARK } from '../constants/theme';
import { noteMatchesSource, searchNotes, sortNotes } from '../utils/notes';
import LanguageNoteCard from '../components/LanguageNoteCard';
import { NoteChip, noteStyles as s } from '../components/NotesUI';

type Folder = 'active' | 'archive' | 'trash' | 'drafts';
type Filter = 'all' | 'pinned' | 'questions' | 'review';

export default function NotesScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Notes'>) {
  const insets = useSafeAreaInsets();
  const params = route.params;
  const notes = useStore(state => state.languageNotes);
  const drafts = useStore(state => state.noteDrafts);
  const [language, setLanguage] = useState(params?.language || 'all');
  const [folder, setFolder] = useState<Folder>('active');
  const [filter, setFilter] = useState<Filter>('all');
  const [contextOnly, setContextOnly] = useState(!!params?.contextOnly);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [undo, setUndo] = useState<LanguageNote | null>(null);
  const [message, setMessage] = useState('');
  const attaching = !!params?.attach && !!params.source;

  const visible = useMemo(() => {
    const collection = folder === 'drafts' ? drafts : notes;
    return sortNotes(searchNotes(collection.filter(note => {
      if (language !== 'all' && note.language !== language) return false;
      if (folder === 'trash' ? !note.deletedAt : !!note.deletedAt) return false;
      if (folder === 'archive' && !note.archived) return false;
      if (folder === 'active' && note.archived) return false;
      if (contextOnly && params?.source && !noteMatchesSource(note, params.language || note.language, params.source)) return false;
      if (filter === 'pinned' && !note.pinned) return false;
      if (filter === 'questions' && note.kind !== 'question') return false;
      if (filter === 'review' && note.understanding !== 'review') return false;
      return true;
    }), query));
  }, [notes, drafts, folder, language, contextOnly, params?.source, params?.language, filter, query]);

  const open = (note: LanguageNote) => {
    if (!attaching) { navigation.push('NoteEditor', { noteId: note.id }); return; }
    try {
      useStore.getState().linkLanguageNote(note.id, params!.source!);
      navigation.goBack();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось связать заметку.'); }
  };
  const restore = (note: LanguageNote) => {
    useStore.getState().setNoteDisposition(note.id, folder === 'trash' ? { deletedAt: undefined } : { archived: false });
    setUndo(note); setMessage(folder === 'trash' ? 'Заметка восстановлена' : 'Заметка возвращена из архива');
  };

  const controls = <View style={{ gap: 12 }}>
    {!attaching && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      <NoteChip label="Все языки" selected={language === 'all'} onPress={() => setLanguage('all')} />
      {LANGUAGES.map(lang => <NoteChip key={lang.code} label={lang.label} selected={language === lang.code} onPress={() => setLanguage(lang.code)} />)}
    </ScrollView>}
    {params?.source && <View style={s.source}>
      <Text style={s.secondary}>{attaching ? 'Выберите заметку для этого примера' : 'Исходный пример'}</Text>
      <Text style={s.sourceText} numberOfLines={2}>{params.source.text}</Text>
      {!attaching && <View style={s.row}>
        <NoteChip label="К примеру" selected={contextOnly} onPress={() => setContextOnly(true)} />
        <NoteChip label="Все заметки" selected={!contextOnly} onPress={() => setContextOnly(false)} />
      </View>}
      {!attaching && <View style={s.row}>
        <NoteChip testID="notes-create-for-source" label="Создать к примеру" selected={false}
          onPress={() => navigation.push('NoteEditor', { language: params.language, source: params.source })} />
        <NoteChip testID="notes-link-for-source" label="Связать готовую" selected={false}
          onPress={() => navigation.push('Notes', { language: params.language, source: params.source, attach: true })} />
      </View>}
    </View>}
    <TextInput testID="notes-search" accessibilityLabel="Поиск заметок" placeholder="Правило, пример или тема…"
      placeholderTextColor="#7A8492" style={s.input} value={query} onChangeText={setQuery} />
    {!attaching && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {([['active', 'Заметки'], ['drafts', `Черновики · ${drafts.filter(n => !n.deletedAt).length}`], ['archive', 'Архив'], ['trash', 'Корзина']] as const).map(([key, label]) =>
        <NoteChip key={key} testID={`notes-folder-${key}`} label={label} selected={folder === key} onPress={() => { setFolder(key); setFilter('all'); }} />)}
    </ScrollView>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {([['all', 'Все'], ['pinned', 'Закреплённые'], ['questions', 'Вопросы'], ['review', 'Повторить']] as const).map(([key, label]) =>
        <NoteChip key={key} label={label} selected={filter === key} onPress={() => setFilter(key)} />)}
    </ScrollView>
    <Text accessibilityLiveRegion="polite" style={[s.secondary, { marginBottom: 12 }]}>{visible.length} заметок{folder === 'trash' ? ' · можно восстановить' : ''}</Text>
    {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
  </View>;

  return <View style={[s.screen, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 16), paddingBottom: insets.bottom }]}>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Назад" onPress={() => navigation.goBack()} style={s.iconButton}>
        <Ionicons name="arrow-back" size={23} color="#344054" />
      </TouchableOpacity>
      <Text style={s.title}>{attaching ? 'Связать заметку' : 'Мои заметки'}</Text>
      {!attaching && <TouchableOpacity testID="notes-create" accessibilityRole="button" accessibilityLabel="Создать заметку" style={s.headerAction}
        onPress={() => {
          const source = params?.source && (language === 'all' || language === params.language) ? params.source : undefined;
          navigation.push('NoteEditor', { language: source ? params?.language : language === 'all' ? undefined : language, source });
        }}>
        <Ionicons name="add" size={24} color={ACCENT_DARK} />
      </TouchableOpacity>}
    </View>
    <FlatList data={visible} keyExtractor={note => note.id} contentContainerStyle={s.content}
      keyboardShouldPersistTaps="handled" ListHeaderComponent={controls}
      renderItem={({ item }) => <View>
        <LanguageNoteCard note={item} draft={folder === 'drafts'} onPress={() => open(item)} />
        {!attaching && (folder === 'trash' || folder === 'archive') && <TouchableOpacity accessibilityRole="button"
          accessibilityLabel={`Восстановить заметку: ${item.title}`} style={[s.headerAction, { alignSelf: 'flex-start', marginTop: -10 }]}
          onPress={() => restore(item)}><Text style={s.actionText}>{folder === 'trash' ? 'Восстановить' : 'Вернуть из архива'}</Text></TouchableOpacity>}
      </View>}
      ListEmptyComponent={<View style={s.empty}>
        <Ionicons name="documents-outline" size={36} color="#98A2B3" />
        <Text style={s.emptyTitle}>{query || filter !== 'all' ? 'Ничего не найдено' : 'Здесь пока нет заметок'}</Text>
        <Text style={[s.secondary, { textAlign: 'center' }]}>{folder === 'drafts' ? 'Незавершённые записи появятся здесь автоматически.' :
          folder === 'trash' ? 'Удалённые заметки можно будет восстановить.' : folder === 'archive' ? 'Здесь хранятся заметки, убранные из рабочего списка.' :
            'Записывайте правила своими словами, вопросы и собственные примеры.'}</Text>
        {attaching && <TouchableOpacity style={s.primary} accessibilityRole="button" onPress={() => navigation.replace('NoteEditor', { language: params?.language, source: params?.source })}>
          <Text style={s.primaryText}>Создать заметку к примеру</Text>
        </TouchableOpacity>}
      </View>} />
    {!!message && <View style={[s.source, { margin: 12, flexDirection: 'row', alignItems: 'center' }]}>
      <Text accessibilityLiveRegion="polite" style={[s.secondary, { flex: 1 }]}>{message}</Text>
      {undo && <TouchableOpacity accessibilityRole="button" style={s.headerAction} onPress={() => {
        useStore.getState().setNoteDisposition(undo.id, { deletedAt: undo.deletedAt, archived: undo.archived });
        setUndo(null); setMessage('Действие отменено');
      }}><Text style={s.actionText}>Отменить</Text></TouchableOpacity>}
    </View>}
  </View>;
}
