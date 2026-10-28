import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Switch, KeyboardAvoidingView, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { LanguageNote, NoteKind, NoteUnderstanding, NoteSource } from '../models/notes';
import { useStore } from '../store/useStore';
import { progressStorage } from '../services/progressStorage';
import { LANGUAGES, getLanguageLabel } from '../constants/languages';
import { ACCENT, ACCENT_DARK } from '../constants/theme';
import { createLanguageNote, NOTE_KINDS, NOTE_UNDERSTANDING, NOTE_LIMITS } from '../utils/notes';
import { NoteChip, noteStyles as s } from '../components/NotesUI';
import { sentenceFingerprint } from '../utils/sentenceValidation';

export default function NoteEditorScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'NoteEditor'>) {
  const insets = useSafeAreaInsets();
  const params = route.params;
  const saved = useStore(state => state.languageNotes.find(n => n.id === params?.noteId));
  const [note, setNote] = useState<LanguageNote | null>(() => {
    const state = useStore.getState();
    if (params?.noteId) return state.noteDrafts.find(n => n.id === params.noteId) || state.languageNotes.find(n => n.id === params.noteId) || null;
    return createLanguageNote(params?.language || state.activeLanguages[0] || 'en', params?.source, params?.initialBody);
  });
  const [tags, setTags] = useState(note?.tags.join(', ') || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hasDraft, setHasDraft] = useState(!!note && useStore.getState().noteDrafts.some(n => n.id === note.id));
  const [showLanguages, setShowLanguages] = useState(false);

  useEffect(() => {
    if (!params?.noteId && params?.initialBody?.trim() && note) {
      try { useStore.getState().saveNoteDraft(note); setHasDraft(true); }
      catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить черновик.'); }
    }
    // Seed an explanation draft once; typing is saved by change().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reportError = (e: unknown) => setError(e instanceof Error ? e.message : 'Не удалось сохранить заметку.');
  const change = (patch: Partial<LanguageNote>) => {
    if (!note || busy) return;
    const next = { ...note, ...patch };
    setNote(next); setError('');
    try { useStore.getState().saveNoteDraft(next); setHasDraft(true); }
    catch (e) { reportError(e); }
  };
  const save = async () => {
    if (!note || busy) return;
    setBusy(true); setError('');
    try {
      useStore.getState().saveLanguageNote(note);
      await progressStorage.flush();
      navigation.goBack();
    } catch (e) { reportError(e); }
    finally { setBusy(false); }
  };
  const disposition = async (patch: Partial<Pick<LanguageNote, 'archived' | 'deletedAt'>>) => {
    if (!note || busy) return;
    setBusy(true); setError('');
    try {
      useStore.getState().setNoteDisposition(note.id, patch);
      // Keep unsaved text available as a draft when archiving or deleting.
      setNote({ ...note, ...patch });
      await progressStorage.flush();
      navigation.goBack();
    } catch (e) { reportError(e); }
    finally { setBusy(false); }
  };
  const discard = async () => {
    if (!note || busy) return;
    setBusy(true); setError('');
    try {
      useStore.getState().discardNoteDraft(note.id);
      await progressStorage.flush();
      navigation.goBack();
    } catch (e) { reportError(e); }
    finally { setBusy(false); }
  };
  const openSource = (source: NoteSource) => {
    const state = useStore.getState();
    const language = LANGUAGES.find(l => l.code === note?.language);
    const sentence = state.sentences.find(item => item.language === language?.label && (item.id === source.sentenceId ||
      sentenceFingerprint(note!.language, item.sentence) === sentenceFingerprint(note!.language, source.text)));
    if (!sentence) { setError('Упражнения уже нет в очереди. Его текст сохранён здесь целиком.'); return; }
    state.setTargetSentenceInfo({ langCode: note!.language, sentenceId: sentence.id });
    navigation.navigate('MainTabs', { screen: 'Sentence Trainer' });
  };

  return <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    style={[s.screen, { paddingTop: Math.max(insets.top, Platform.OS === 'android' ? 24 : 16), paddingBottom: insets.bottom }]}>
    <View style={s.header}>
      <TouchableOpacity testID="note-editor-back" accessibilityRole="button" accessibilityLabel="Назад" disabled={busy}
        onPress={() => navigation.goBack()} style={s.iconButton}><Ionicons name="arrow-back" size={23} color="#344054" /></TouchableOpacity>
      <Text style={s.title}>{saved ? 'Моя заметка' : 'Новая заметка'}</Text>
      {!!note && !note.deletedAt && <TouchableOpacity accessibilityRole="button" testID="note-editor-done" style={s.headerAction} disabled={busy} onPress={() => void save()}>
        {busy ? <ActivityIndicator color={ACCENT_DARK} /> : <Text style={s.actionText}>Готово</Text>}
      </TouchableOpacity>}
    </View>
    {!note ? <View style={s.empty}><Text style={s.emptyTitle}>Заметка не найдена</Text></View> :
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <TouchableOpacity accessibilityRole="button" disabled={!!note.sources.length || !!note.deletedAt || busy} style={s.headerAction}
            onPress={() => setShowLanguages(!showLanguages)}><Text style={s.actionText}>{getLanguageLabel(note.language)}{!note.sources.length ? ' ▾' : ''}</Text></TouchableOpacity>
          <Text style={s.secondary}>{hasDraft ? 'Черновик · автосохранение' : saved ? 'Сохранённая заметка' : 'Своими словами'}</Text>
        </View>
        {showLanguages && !note.sources.length && <View style={s.row}>{LANGUAGES.map(lang => <NoteChip key={lang.code} label={lang.label}
          selected={note.language === lang.code} onPress={() => { change({ language: lang.code }); setShowLanguages(false); }} />)}</View>}
        {!!note.deletedAt && <View style={s.source}>
          <Text style={s.sourceText}>Заметка в корзине. Восстановите её, чтобы продолжить редактирование.</Text>
          <TouchableOpacity accessibilityRole="button" testID="note-editor-restore" onPress={() => void disposition({ deletedAt: undefined })} style={s.primary} disabled={busy}>
            <Text style={s.primaryText}>Восстановить</Text></TouchableOpacity>
        </View>}
        <View>
          <Text style={s.label}>Название · необязательно</Text>
          <TextInput testID="note-title" accessibilityLabel="Название заметки" style={s.input} value={note.title} editable={!note.deletedAt && !busy}
            onChangeText={title => change({ title })} maxLength={NOTE_LIMITS.title} placeholder="Что я хочу запомнить?" placeholderTextColor="#7A8492" />
        </View>
        <View><Text style={s.label}>Тип заметки</Text><View style={s.row}>
          {(Object.entries(NOTE_KINDS) as [NoteKind, string][]).map(([kind, label]) => <NoteChip key={kind} label={label}
            selected={note.kind === kind} onPress={() => { if (!note.deletedAt) change({ kind }); }} />)}
        </View></View>
        <View><Text style={s.label}>Моё понимание</Text><View style={s.row}>
          {(Object.entries(NOTE_UNDERSTANDING) as [NoteUnderstanding, string][]).map(([understanding, label]) => <NoteChip key={understanding} label={label}
            selected={note.understanding === understanding} onPress={() => { if (!note.deletedAt) change({ understanding }); }} />)}
        </View></View>
        <View><Text style={s.label}>Своими словами</Text>
          <TextInput testID="note-body" accessibilityLabel="Текст заметки своими словами" style={[s.input, s.bodyInput]} value={note.body} multiline
            editable={!note.deletedAt && !busy} maxLength={NOTE_LIMITS.body} onChangeText={body => change({ body })}
            placeholder="Как я это понял? Что пока вызывает вопрос?" placeholderTextColor="#7A8492" />
        </View>
        <View><Text style={s.label}>Мой пример</Text>
          <TextInput testID="note-example" accessibilityLabel="Пример к заметке" style={[s.input, { minHeight: 70, textAlignVertical: 'top' }]} value={note.example} multiline
            editable={!note.deletedAt && !busy} maxLength={NOTE_LIMITS.example} onChangeText={example => change({ example })}
            placeholder="Фраза, форма слова или свой пример" placeholderTextColor="#7A8492" />
        </View>
        <View><Text style={s.label}>Темы через запятую · до 10 тем по 40 знаков</Text>
          <TextInput testID="note-tags" accessibilityLabel="Темы заметки" style={s.input} value={tags} editable={!note.deletedAt && !busy} maxLength={410}
            onChangeText={text => { setTags(text); change({ tags: text.split(',').map(t => t.trim()).filter(Boolean) }); }}
            placeholder="Порядок слов, вопросы…" placeholderTextColor="#7A8492" />
        </View>
        <View style={s.toggle}><Text style={s.toggleText}>Закрепить вверху</Text><Switch testID="note-pinned" accessibilityLabel="Закрепить заметку"
          disabled={!!note.deletedAt || busy} value={note.pinned} onValueChange={pinned => change({ pinned })} trackColor={{ true: ACCENT }} /></View>
        {!!note.sources.length && <>
          <View style={s.toggle}><Text style={s.toggleText}>Показывать рядом с примерами</Text><Switch accessibilityLabel="Показывать рядом с примерами"
            disabled={!!note.deletedAt || busy} value={note.showInContext} onValueChange={showInContext => change({ showInContext })} trackColor={{ true: ACCENT }} /></View>
          <Text style={s.label}>Исходные примеры · {note.sources.length}</Text>
          {note.sources.map((source, index) => <View key={`${source.sentenceId}-${index}`} style={s.source}>
            {!!source.token && <Text style={s.label}>К слову «{source.token}»</Text>}
            <Text selectable style={s.sourceText}>{source.text}</Text>
            {!!source.translation && <Text selectable style={s.secondary}>{source.translation}</Text>}
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <TouchableOpacity accessibilityRole="button" style={s.headerAction} onPress={() => openSource(source)}><Text style={s.actionText}>Открыть разбор</Text></TouchableOpacity>
              {!note.deletedAt && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Убрать связь с примером ${index + 1}`} style={s.headerAction}
                onPress={() => change({ sources: note.sources.filter((_, i) => i !== index) })}><Text style={s.secondary}>Убрать связь</Text></TouchableOpacity>}
            </View>
          </View>)}
        </>}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        {!note.deletedAt && <TouchableOpacity testID="note-save" accessibilityRole="button" disabled={busy} onPress={() => void save()} style={[s.primary, busy && s.disabled]}>
          <Text style={s.primaryText}>{busy ? 'Сохраняем…' : 'Сохранить заметку'}</Text></TouchableOpacity>}
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {saved && !note.deletedAt && <>
            <TouchableOpacity testID="note-archive" accessibilityRole="button" disabled={busy} style={s.headerAction} onPress={() => void disposition({ archived: !note.archived })}>
              <Text style={s.actionText}>{note.archived ? 'Вернуть из архива' : 'В архив'}</Text></TouchableOpacity>
            <TouchableOpacity testID="note-delete" accessibilityRole="button" disabled={busy} style={s.headerAction} onPress={() => void disposition({ deletedAt: new Date().toISOString() })}>
              <Text style={s.danger}>В корзину</Text></TouchableOpacity>
          </>}
          {hasDraft && !note.deletedAt && <TouchableOpacity accessibilityRole="button" testID="note-discard-draft" disabled={busy} style={s.headerAction} onPress={() => void discard()}>
            <Text style={s.danger}>{saved ? 'Отменить правки' : 'Удалить черновик'}</Text></TouchableOpacity>}
        </View>
      </ScrollView>}
  </KeyboardAvoidingView>;
}
