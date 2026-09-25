import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Word, Sentence, Token } from '../models/types';
import { DailyShows, WorkoutSnapshot, ImwSnapshot, calculateIMWIndex } from '../utils/statistics';
import { cleanDictionaryForm, getWordKey, getWordTranslation } from '../utils/words';
import { localDateKey } from '../utils/date';
import { sentenceFingerprint } from '../utils/sentenceValidation';
import { LANGUAGES } from '../constants/languages';
import { applyWordProgress, baseStaticWords, deriveCatalog, mergeSentences } from './catalog';
import { createDefaultProgress, pickPersistedFields, PersistedProgress, UserWordProgress, WordAiVerification } from './progressTypes';
import { parseProgress } from './progressValidation';
export type { PersistedProgress, UserWordProgress, WordAiVerification, WordAiIssue } from './progressTypes';

interface TargetSentenceInfo {
  langCode: string;
  sentenceId?: string;
  sentenceIndex?: number;
  highlightWord?: string;
}

interface AppState {
  words: Word[];
  sentences: Sentence[];
  customSentences: Sentence[];
  generatedSentences: Sentence[];
  customWords: Word[];
  userWordProgress: Record<string, UserWordProgress>;
  activeLanguages: string[];
  targetSentenceInfo: TargetSentenceInfo | null;
  dailyShows: DailyShows;
  workoutSnapshots: WorkoutSnapshot[];
  imwSnapshots: ImwSnapshot[];
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  hasSeenSnoozeHint: boolean;

  // Actions
  initializeStore: () => void;
  recordImwSnapshot: () => void;
  setLanguages: (langs: string[]) => void;
  setTargetSentenceInfo: (info: TargetSentenceInfo | null) => void;
  markWordKnown: (wordEng: string, lang: string, isKnown: boolean) => void;
  snoozeWord: (wordEng: string, lang: string, days: number) => void;
  incrementShowCount: (wordEng: string, lang: string) => void;
  recordTripleCardShow: (wordEng: string) => void;
  markTripleKnown: (wordEng: string) => void;
  saveWordAssociation: (wordEng: string, assoc: string) => void;
  setWordAiVerification: (wordKey: string, verification: WordAiVerification) => void;
  addSentence: (sentence: Sentence) => void;
  addGeneratedSentences: (sentences: Sentence[]) => void;
  clearGeneratedSentences: (languageLabel?: string) => void;
  updateSentence: (id: string, sentence: Sentence) => void;
  updateWordDetails: (wordKey: string, details: { word?: string; ru?: string; translations?: Record<string, string>; personal_association?: string }) => void;
  addCustomWord: (word: Word) => void;
  addWordFromSentenceToken: (token: Token, languageCode: string) => boolean;
  resetStatistics: () => void;
  addWorkoutSnapshot: (snapshot: WorkoutSnapshot) => void;
  setWorkoutWordCount: (count: number) => void;
  setWorkoutLearnedWordCount: (count: number) => void;
  setWorkoutFavoritesOnly: (onlyFavorites: boolean) => void;
  setHasSeenSnoozeHint: (hasSeen: boolean) => void;
  toggleWordFavorite: (wordEng: string) => void;
  restoreWordProgress: (wordEng: string, previousProgress: UserWordProgress | null) => void;
  exportProgress: () => PersistedProgress;
  importProgress: (data: unknown) => { ok: boolean; error?: string };
}


// Hydration status lives outside persistence: reporting a read error must not
// overwrite the unread/corrupted on-device data with the default state.
export const useHydrationState = create<{ ready: boolean; error: string | null }>(() => ({ ready: false, error: null }));
const MAX_GENERATED = 80;
const normalize = (value: string) => value.trim().toLocaleLowerCase();

export const useStore = create<AppState>()(persist<AppState, [], [], PersistedProgress>((set, get) => {
  const baseFor = (key: string) => get().customWords.find(word => getWordKey(word) === key)
    ?? baseStaticWords.find(word => getWordKey(word) === key);

  // Persisted overrides are authoritative; the same projection is used on edit,
  // undo, import and hydration. Custom words remain immutable base definitions.
  const updateProgress = (key: string, update: (progress: UserWordProgress) => UserWordProgress) => {
    set(state => {
      const progress = update(state.userWordProgress[key] ?? {});
      const base = baseFor(key);
      return {
        userWordProgress: { ...state.userWordProgress, [key]: progress },
        words: state.words.map(word => getWordKey(word) === key && base ? applyWordProgress(base, progress) : word),
      };
    });
  };

  const recordShow = (key: string, languages: string[]) => {
    const now = new Date().toISOString();
    const today = localDateKey();
    set(state => {
      const previous = state.userWordProgress[key] ?? {};
      const showStats = { ...previous.show_stats };
      const lastShown = { ...previous.last_shown_by_lang };
      for (const lang of languages) {
        showStats[lang] = (showStats[lang] ?? 0) + 1;
        lastShown[lang] = now;
      }
      const progress = { ...previous, count: (previous.count ?? 0) + 1, show_stats: showStats, last_shown: now, last_shown_by_lang: lastShown };
      const base = baseFor(key);
      return {
        userWordProgress: { ...state.userWordProgress, [key]: progress },
        words: state.words.map(word => getWordKey(word) === key && base ? applyWordProgress(base, progress) : word),
        dailyShows: { ...state.dailyShows, [today]: (state.dailyShows[today] ?? 0) + 1 },
      };
    });
  };

  const defaults = createDefaultProgress();
  return {
    ...defaults, ...deriveCatalog(defaults), targetSentenceInfo: null,
    initializeStore: () => set(deriveCatalog(get())),
    recordImwSnapshot: () => set(state => {
      if (!state.words.length || !state.activeLanguages.length) return {};
      const { overall, byLanguage } = calculateIMWIndex(state.words, state.activeLanguages);
      const date = localDateKey();
      return { imwSnapshots: [...state.imwSnapshots.filter(item => item.date !== date), { date, imw: overall, byLang: byLanguage }].slice(-180) };
    }),
    setLanguages: langs => {
      const activeLanguages = [...new Set(langs)].filter(code => LANGUAGES.some(lang => lang.code === code));
      if (activeLanguages.length) set({ activeLanguages });
    },
    setTargetSentenceInfo: targetSentenceInfo => set({ targetSentenceInfo }),
    markWordKnown: (key, lang, known) => updateProgress(key, progress => ({
      ...progress, knowledge_stats: { ...progress.knowledge_stats, [lang]: known }, is_learned: known ? 1 : 0,
    })),
    snoozeWord: (key, lang, days) => {
      if (!Number.isFinite(days) || days < 0 || days > 3650) return;
      updateProgress(key, progress => ({ ...progress, snoozed_until_by_lang: {
        ...progress.snoozed_until_by_lang, [lang]: new Date(Date.now() + days * 86400000).toISOString(),
      } }));
    },
    incrementShowCount: (key, lang) => recordShow(key, [lang]),
    recordTripleCardShow: key => recordShow(key, get().activeLanguages),
    markTripleKnown: key => updateProgress(key, progress => ({
      ...progress, is_learned: 1, knowledge_stats: {
        ...progress.knowledge_stats, ...Object.fromEntries(get().activeLanguages.map(lang => [lang, true])),
      },
    })),
    saveWordAssociation: (key, association) => updateProgress(key, progress => ({ ...progress, personal_association: association })),
    setWordAiVerification: (key, verification) => updateProgress(key, progress => ({ ...progress, ai_verification: verification })),
    updateWordDetails: (key, details) => updateProgress(key, progress => ({
      ...progress,
      ...(details.word !== undefined ? { custom_word: details.word } : {}),
      ...(details.ru !== undefined ? { custom_ru: details.ru } : {}),
      ...(details.personal_association !== undefined ? { personal_association: details.personal_association } : {}),
      custom_translations: { ...progress.custom_translations, ...details.translations, ...(details.ru !== undefined ? { ru: details.ru } : {}) },
      // A changed translation invalidates a previous AI verdict.
      ...(details.word !== undefined || details.ru !== undefined || details.translations ? { ai_verification: undefined } : {}),
    })),
    toggleWordFavorite: key => updateProgress(key, progress => ({
      ...progress, is_favorite: !(progress.is_favorite ?? baseFor(key)?.is_favorite ?? false),
    })),
    restoreWordProgress: (key, previousProgress) => set(state => {
      const userWordProgress = { ...state.userWordProgress };
      if (previousProgress) userWordProgress[key] = previousProgress;
      else delete userWordProgress[key];
      const base = baseFor(key);
      return { userWordProgress, words: state.words.map(word =>
        getWordKey(word) === key && base ? applyWordProgress(base, previousProgress ?? undefined) : word) };
    }),
    addCustomWord: word => set(state => {
      const key = getWordKey(word);
      if (!key || state.words.some(item => getWordKey(item) === key)) return {};
      return { customWords: [word, ...state.customWords], words: [word, ...state.words] };
    }),
    addWordFromSentenceToken: (token, languageCode) => {
      const dictionaryForm = cleanDictionaryForm(token.dictionary_form || token.dictionary_word || token.text || '');
      if (!dictionaryForm) return false;
      const normalized = normalize(dictionaryForm);
      if (get().words.some(word => normalize(getWordTranslation(word, languageCode)) === normalized ||
        (word.source_language === languageCode && normalize(word.word || '') === normalized))) return false;
      const key = 'user:' + languageCode + ':' + normalized;
      const translations = Object.fromEntries(get().activeLanguages.map(lang => [lang, '']));
      translations[languageCode] = dictionaryForm;
      get().addCustomWord({ id: key, eng: key, word: dictionaryForm, ru: token.translation?.trim() || '',
        translations, source_language: languageCode, count: 0, is_learned: 0, knowledge_stats: {}, show_stats: {},
        personal_association: '', is_favorite: false });
      return true;
    },
    addSentence: sentence => set(state => {
      const customSentences = [...state.customSentences.filter(item => item.id !== sentence.id), sentence];
      return { customSentences, sentences: mergeSentences(customSentences, state.generatedSentences) };
    }),
    updateSentence: (id, sentence) => set(state => {
      const customSentences = [...state.customSentences.filter(item => item.id !== id), { ...sentence, id, source: 'manual' as const }];
      const generatedSentences = state.generatedSentences.filter(item => item.id !== id);
      return { customSentences, generatedSentences, sentences: mergeSentences(customSentences, generatedSentences) };
    }),
    addGeneratedSentences: incoming => set(state => {
      const fingerprints = new Set(state.sentences.map(sentence => sentenceFingerprint(sentence.language, sentence.sentence)));
      const ids = new Set(state.sentences.map(sentence => sentence.id));
      const unique = incoming.filter(sentence => {
        const fingerprint = sentenceFingerprint(sentence.language, sentence.sentence);
        if (fingerprints.has(fingerprint) || ids.has(sentence.id)) return false;
        fingerprints.add(fingerprint); ids.add(sentence.id); return true;
      }).map(sentence => ({ ...sentence, source: 'generated' as const }));
      if (!unique.length) return {};
      const generatedSentences = [...state.generatedSentences, ...unique].slice(-MAX_GENERATED);
      return { generatedSentences, sentences: mergeSentences(state.customSentences, generatedSentences) };
    }),
    clearGeneratedSentences: language => set(state => {
      const generatedSentences = state.generatedSentences.filter(sentence => language && !sentence.language.toLowerCase().includes(language.toLowerCase()));
      return { generatedSentences, sentences: mergeSentences(state.customSentences, generatedSentences) };
    }),
    resetStatistics: () => set(state => {
      const userWordProgress = Object.fromEntries(Object.entries(state.userWordProgress).map(([key, progress]) => [key, {
        custom_word: progress.custom_word, custom_ru: progress.custom_ru, custom_translations: progress.custom_translations,
        personal_association: progress.personal_association, is_favorite: progress.is_favorite, ai_verification: progress.ai_verification,
      }]));
      const customWords = state.customWords.map(word => ({ ...word, count: 0, is_learned: 0,
        knowledge_stats: {}, show_stats: {}, last_shown: undefined, last_shown_by_lang: undefined, snoozed_until_by_lang: undefined }));
      const next = { ...state, userWordProgress, customWords, dailyShows: {}, workoutSnapshots: [], imwSnapshots: [] };
      return { ...pickPersistedFields(next), ...deriveCatalog(next) };
    }),
    addWorkoutSnapshot: snapshot => set(state => ({ workoutSnapshots: [...state.workoutSnapshots, snapshot].slice(-200) })),
    setWorkoutWordCount: count => {
      if (!Number.isSafeInteger(count) || count < 1 || count > 100) return;
      set(state => ({ workoutWordCount: count, workoutLearnedWordCount: Math.min(count, state.workoutLearnedWordCount) }));
    },
    setWorkoutLearnedWordCount: count => {
      if (!Number.isSafeInteger(count) || count < 0) return;
      set({ workoutLearnedWordCount: Math.min(count, get().workoutWordCount) });
    },
    setWorkoutFavoritesOnly: workoutFavoritesOnly => set({ workoutFavoritesOnly }),
    setHasSeenSnoozeHint: hasSeenSnoozeHint => set({ hasSeenSnoozeHint }),
    exportProgress: () => JSON.parse(JSON.stringify(pickPersistedFields(get()))) as PersistedProgress,
    importProgress: data => {
      try {
        const progress = parseProgress(data);
        set({ ...progress, ...deriveCatalog(progress), targetSentenceInfo: null });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'Не удалось восстановить прогресс.' };
      }
    },
  };
}, {
  name: 'papanda-storage',
  storage: createJSONStorage(() => AsyncStorage),
  partialize: pickPersistedFields,
  merge: (persisted, current) => persisted === undefined ? current : ({ ...current, ...parseProgress(persisted) }),
  onRehydrateStorage: () => (state, error) => {
    if (error) {
      useHydrationState.setState({ ready: false, error: 'Не удалось прочитать сохранённый прогресс. Повторите загрузку.' });
      return;
    }
    state?.initializeStore();
    useHydrationState.setState({ ready: true, error: null });
  },
}));
