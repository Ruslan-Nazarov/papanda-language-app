import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Word, Sentence, Token } from '../models/types';
import { DailyShows, WorkoutSnapshot, ImwSnapshot, calculateIMWIndex } from '../utils/statistics';
import wordsData from '../data/words.json';
import sentencesData from '../data/sentences.json';

import { getWordTranslation } from '../utils/words';
import { sentenceFingerprint } from '../utils/sentenceValidation';

interface TargetSentenceInfo {
  langCode: string;
  sentenceId?: string;
  sentenceIndex?: number;
  highlightWord?: string;
}

export interface WordAiIssue {
  lang: string;
  issue: string;
  suggestion?: string;
}

export interface WordAiVerification {
  status: 'verified' | 'flagged';
  issues?: WordAiIssue[];
  checkedAt: string;
}

export interface UserWordProgress {
  count?: number;
  is_learned?: number;
  knowledge_stats?: Record<string, boolean>;
  show_stats?: Record<string, number>;
  last_shown?: string;
  last_shown_by_lang?: Record<string, string>;
  personal_association?: string;
  custom_word?: string;
  custom_ru?: string;
  custom_translations?: Record<string, string>;
  is_favorite?: boolean;
  ai_verification?: WordAiVerification;
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
  learnedSentences: string[];

  // Actions
  initializeStore: () => void;
  recordImwSnapshot: () => void;
  setLanguages: (langs: string[]) => void;
  setTargetSentenceInfo: (info: TargetSentenceInfo | null) => void;
  markWordKnown: (wordEng: string, lang: string, isKnown: boolean) => void;
  incrementShowCount: (wordEng: string, lang: string) => void;
  markTripleKnown: (wordEng: string) => void;
  saveWordAssociation: (wordEng: string, assoc: string) => void;
  setWordAiVerification: (wordKey: string, verification: WordAiVerification) => void;
  addSentence: (sentence: Sentence) => void;
  addGeneratedSentences: (sentences: Sentence[]) => void;
  clearGeneratedSentences: (languageLabel?: string) => void;
  updateSentence: (id: string, sentence: Sentence) => void;
  markSentenceLearned: (id: string, isLearned: boolean) => void;
  updateWordDetails: (wordKey: string, details: { word?: string; ru?: string; translations?: Record<string, string>; personal_association?: string }) => void;
  addCustomWord: (word: Word) => void;
  addWordFromSentenceToken: (token: Token, languageCode: string) => boolean;
  resetStatistics: () => void;
  addWorkoutSnapshot: (snapshot: WorkoutSnapshot) => void;
  setWorkoutWordCount: (count: number) => void;
  setWorkoutLearnedWordCount: (count: number) => void;
  setWorkoutFavoritesOnly: (onlyFavorites: boolean) => void;
  toggleWordFavorite: (wordEng: string) => void;
  restoreWordProgress: (wordEng: string, previousProgress: UserWordProgress | null) => void;
  exportProgress: () => PersistedProgress;
  importProgress: (data: unknown) => { ok: boolean; error?: string };
}

// Helper to parse JSON fields safely
const parseJSONField = (field: string | Record<string, any> | null) => {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch { return {}; }
  }
  return field || {};
};

const normalizeDictionaryValue = (value: string) => value.trim().toLocaleLowerCase();

// The subset of state that is persisted to disk and what a backup file
// contains. Shared by the persist middleware's `partialize` and by
// exportProgress/importProgress, so the two can never drift apart.
export interface PersistedProgress {
  userWordProgress: Record<string, UserWordProgress>;
  customSentences: Sentence[];
  generatedSentences: Sentence[];
  customWords: Word[];
  activeLanguages: string[];
  dailyShows: DailyShows;
  workoutSnapshots: WorkoutSnapshot[];
  imwSnapshots: ImwSnapshot[];
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  learnedSentences: string[];
}

const pickPersistedFields = (state: AppState): PersistedProgress => ({
  userWordProgress: state.userWordProgress,
  customSentences: state.customSentences,
  generatedSentences: state.generatedSentences,
  customWords: state.customWords,
  activeLanguages: state.activeLanguages,
  dailyShows: state.dailyShows,
  workoutSnapshots: state.workoutSnapshots,
  imwSnapshots: state.imwSnapshots,
  workoutWordCount: state.workoutWordCount,
  workoutLearnedWordCount: state.workoutLearnedWordCount,
  workoutFavoritesOnly: state.workoutFavoritesOnly,
  learnedSentences: state.learnedSentences,
});

const getWordValueForLanguage = (word: Word, languageCode: string): string => {
  return getWordTranslation(word, languageCode);
};

// Base static words dictionary
const baseStaticWords: Word[] = (wordsData as any[]).map((w, idx) => {
  // words.json only carries top-level it/de/ru; es/fr/la/kz live inside the
  // `translations` JSON string. Fold them in so word.es / word.fr are populated.
  const tr = parseJSONField(w.translations);
  return {
  id: w.id || idx.toString(),
  word: w.word || w.eng || '',
  eng: w.eng || w.word || '',
  ru: w.ru || tr.ru || '',
  it: w.it || tr.it || '',
  es: w.es || tr.es || '',
  de: w.de || tr.de || '',
  fr: w.fr || tr.fr || '',
  meaning: w.meaning || '',
  count: 0,
  is_learned: 0,
  knowledge_stats: {},
  show_stats: {},
  last_shown: undefined,
  translations: tr,
  personal_association: '',
  is_favorite: false
  };
});

const baseStaticSentences: Sentence[] = (sentencesData as Sentence[]).map((s, idx) => ({
  id: s.id || `sent_${idx}`,
  language: s.language || 'Unknown',
  sentence: s.sentence || (s as any).text || '',
  words: s.words || []
}));

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      words: baseStaticWords,
      sentences: baseStaticSentences,
      customSentences: [],
      generatedSentences: [],
      customWords: [],
      userWordProgress: {},
      activeLanguages: ['en', 'kz', 'it'],
      targetSentenceInfo: null,
      dailyShows: {},
      workoutSnapshots: [],
      imwSnapshots: [],
      workoutWordCount: 10,
      workoutLearnedWordCount: 2,
      workoutFavoritesOnly: false,
      learnedSentences: [],

      recordImwSnapshot: () => {
        set((state) => {
          if (state.words.length === 0 || state.activeLanguages.length === 0) return {};
          const { overall, byLanguage } = calculateIMWIndex(state.words, state.activeLanguages);
          const today = new Date().toISOString().split('T')[0];
          const rest = state.imwSnapshots.filter(s => s.date !== today);
          const next: ImwSnapshot[] = [...rest, { date: today, imw: overall, byLang: byLanguage }];
          return { imwSnapshots: next.slice(-180) };
        });
      },

      initializeStore: () => {
        const { userWordProgress, customSentences, customWords, generatedSentences } = get();
        
        const applyUserProgress = (w: Word): Word => {
          const key = w.eng || w.word || '';
          const prog = userWordProgress[key];
          if (!prog) return w;

          const mergedTranslations = {
            ...w.translations,
            ...(prog.custom_translations || {})
          };

          const directLangUpdates: Partial<Word> = {};
          if (prog.custom_translations) {
            if ('it' in prog.custom_translations) directLangUpdates.it = prog.custom_translations.it;
            if ('de' in prog.custom_translations) directLangUpdates.de = prog.custom_translations.de;
            if ('es' in prog.custom_translations) directLangUpdates.es = prog.custom_translations.es;
            if ('fr' in prog.custom_translations) directLangUpdates.fr = prog.custom_translations.fr;
            if ('ru' in prog.custom_translations) directLangUpdates.ru = prog.custom_translations.ru;
          }

          const newWord = prog.custom_word !== undefined ? prog.custom_word : w.word;
          const newEng = prog.custom_word !== undefined && !w.source_language ? prog.custom_word : w.eng;
          const newRu = prog.custom_ru !== undefined ? prog.custom_ru : (directLangUpdates.ru ?? w.ru);

          return {
            ...w,
            ...directLangUpdates,
            word: newWord,
            eng: newEng,
            ru: newRu,
            translations: mergedTranslations,
            count: prog.count !== undefined ? prog.count : w.count,
            is_learned: prog.is_learned !== undefined ? prog.is_learned : w.is_learned,
            knowledge_stats: prog.knowledge_stats || w.knowledge_stats,
            show_stats: prog.show_stats || w.show_stats,
            last_shown: prog.last_shown || w.last_shown,
            last_shown_by_lang: prog.last_shown_by_lang || w.last_shown_by_lang,
            personal_association: prog.personal_association !== undefined ? prog.personal_association : (w.personal_association || ''),
            is_favorite: prog.is_favorite !== undefined ? prog.is_favorite : (w.is_favorite || false)
          };
        };

        const mergedWords = baseStaticWords.map(applyUserProgress);
        const mergedCustomWords = (customWords || []).map(applyUserProgress);

        const mergedSentences = [...baseStaticSentences, ...(customSentences || []), ...(generatedSentences || [])];

        set({ 
          words: [...mergedWords, ...mergedCustomWords], 
          sentences: mergedSentences 
        });
      },

      setLanguages: (langs) => set({ activeLanguages: langs }),

      setTargetSentenceInfo: (info) => set({ targetSentenceInfo: info }),

      markWordKnown: (wordEng, lang, isKnown) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentStats = { ...(currentProg.knowledge_stats || {}) };
          currentStats[lang] = isKnown;

          const updatedProg: UserWordProgress = {
            ...currentProg,
            knowledge_stats: currentStats,
            is_learned: isKnown ? 1 : 0
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              return { 
                ...w, 
                knowledge_stats: currentStats,
                is_learned: isKnown ? 1 : 0
              };
            }
            return w;
          });

          return { 
            userWordProgress: newProgress,
            words: newWords 
          };
        });
      },

      incrementShowCount: (wordEng, lang) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentShowStats = { ...(currentProg.show_stats || {}) };
          currentShowStats[lang] = (currentShowStats[lang] || 0) + 1;
          const newCount = (currentProg.count || 0) + 1;
          const nowIso = new Date().toISOString();
          const today = nowIso.split('T')[0];
          const lastShownByLang = { ...(currentProg.last_shown_by_lang || {}), [lang]: nowIso };

          const updatedProg: UserWordProgress = {
            ...currentProg,
            count: newCount,
            last_shown: nowIso,
            last_shown_by_lang: lastShownByLang,
            show_stats: currentShowStats
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              return {
                ...w,
                count: newCount,
                last_shown: nowIso,
                last_shown_by_lang: lastShownByLang,
                show_stats: currentShowStats
              };
            }
            return w;
          });

          return { 
            userWordProgress: newProgress,
            words: newWords,
            dailyShows: {
              ...state.dailyShows,
              [today]: (state.dailyShows[today] || 0) + 1
            }
          };
        });
      },

      markTripleKnown: (wordEng) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentStats = { ...(currentProg.knowledge_stats || {}) };
          const currentShowStats = { ...(currentProg.show_stats || {}) };
          const lastShownByLang = { ...(currentProg.last_shown_by_lang || {}) };
          const nowIso = new Date().toISOString();

          state.activeLanguages.forEach(lang => {
            currentStats[lang] = true;
            currentShowStats[lang] = (currentShowStats[lang] || 0) + 1;
            lastShownByLang[lang] = nowIso;
          });

          const updatedProg: UserWordProgress = {
            ...currentProg,
            knowledge_stats: currentStats,
            show_stats: currentShowStats,
            last_shown_by_lang: lastShownByLang,
            count: (currentProg.count || 0) + 1,
            last_shown: nowIso,
            is_learned: 1
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              return {
                ...w,
                knowledge_stats: currentStats,
                show_stats: currentShowStats,
                last_shown_by_lang: lastShownByLang,
                count: (w.count || 0) + 1,
                last_shown: nowIso,
                is_learned: 1
              };
            }
            return w;
          });
          
          const today = nowIso.split('T')[0];

          return { 
            userWordProgress: newProgress,
            words: newWords,
            dailyShows: {
              ...state.dailyShows,
              [today]: (state.dailyShows[today] || 0) + state.activeLanguages.length
            }
          };
        });
      },

      saveWordAssociation: (wordEng, assoc) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const updatedProg: UserWordProgress = {
            ...currentProg,
            personal_association: assoc
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const updateAssoc = (w: Word) => {
            if (w.eng === wordEng || w.word === wordEng) {
              return { ...w, personal_association: assoc };
            }
            return w;
          };

          const newWords = state.words.map(updateAssoc);
          const newCustomWords = (state.customWords || []).map(updateAssoc);

          return { 
            userWordProgress: newProgress,
            words: newWords,
            customWords: newCustomWords
          };
        });
      },

      addSentence: (sentence) => {
        set((state) => {
          const updatedCustom = [...state.customSentences, sentence];
          return {
            customSentences: updatedCustom,
            sentences: [...state.sentences, sentence]
          };
        });
      },

      addGeneratedSentences: (newSentences) => {
        set((state) => {
          // Normalized fingerprint (case/punctuation/spacing-insensitive) so a
          // "lite" model regenerating near-identical templates doesn't silently
          // pad the pool with sentences that only look distinct to a string diff.
          const knownFingerprints = new Set(state.sentences.map(sentence => sentenceFingerprint(sentence.language, sentence.sentence)));
          const uniqueSentences: typeof newSentences = [];
          for (const sentence of newSentences) {
            const fp = sentenceFingerprint(sentence.language, sentence.sentence);
            if (knownFingerprints.has(fp)) continue;
            knownFingerprints.add(fp);
            uniqueSentences.push(sentence);
          }
          if (uniqueSentences.length === 0) return {};

          // Cap the stored pool so an old weak batch ages out instead of looping forever.
          const MAX_GENERATED = 80;
          const mergedGenerated = [...state.generatedSentences, ...uniqueSentences];
          const trimmedGenerated = mergedGenerated.slice(-MAX_GENERATED);
          const dropped = new Set(mergedGenerated.slice(0, -MAX_GENERATED).map(s => s.id));

          return {
            generatedSentences: trimmedGenerated,
            sentences: [
              ...state.sentences.filter(s => !dropped.has(s.id)),
              ...uniqueSentences
            ]
          };
        });
      },

      clearGeneratedSentences: (languageLabel) => {
        set((state) => {
          const matches = (s: Sentence) =>
            s.source === 'generated' &&
            (!languageLabel || (s.language || '').toLowerCase().includes(languageLabel.toLowerCase()));
          const removedIds = new Set(state.generatedSentences.filter(matches).map(s => s.id));
          if (removedIds.size === 0) return {};
          return {
            generatedSentences: state.generatedSentences.filter(s => !removedIds.has(s.id)),
            sentences: state.sentences.filter(s => !removedIds.has(s.id)),
            learnedSentences: state.learnedSentences.filter(id => !removedIds.has(id))
          };
        });
      },

      updateSentence: (id, sentence) => {
        set((state) => {
          const newSentences = state.sentences.map(s => s.id === id ? sentence : s);
          
          let newCustom = [...state.customSentences];
          const customIdx = newCustom.findIndex(s => s.id === id);
          if (customIdx >= 0) {
            newCustom[customIdx] = sentence;
          } else {
            // It was a static sentence, save the customized version to persist it
            newCustom.push(sentence);
          }

          return { 
            sentences: newSentences,
            customSentences: newCustom 
          };
        });
      },

      markSentenceLearned: (id, isLearned) => {
        set((state) => {
          let updated = [...state.learnedSentences];
          if (isLearned && !updated.includes(id)) {
            updated.push(id);
          } else if (!isLearned && updated.includes(id)) {
            updated = updated.filter(sId => sId !== id);
          }
          return { learnedSentences: updated };
        });
      },

      updateWordDetails: (wordKey, details) => {
        set((state) => {
          const key = wordKey;
          const currentProg = state.userWordProgress[key] || {};
          
          const updatedTranslations: Record<string, string> = { 
            ...(currentProg.custom_translations || {}), 
            ...(details.translations || {}),
            ...(details.ru !== undefined ? { ru: details.ru } : {})
          };

          const updatedProg: UserWordProgress = {
            ...currentProg,
            ...(details.word !== undefined && { custom_word: details.word }),
            ...(details.ru !== undefined && { custom_ru: details.ru }),
            ...(details.personal_association !== undefined && { personal_association: details.personal_association }),
            ...(Object.keys(updatedTranslations).length > 0 && { custom_translations: updatedTranslations })
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const updateWord = (w: Word): Word => {
            if (w.eng === wordKey || w.word === wordKey) {
              const mergedTranslations = {
                ...w.translations,
                ...updatedTranslations
              };

              const directLangUpdates: Partial<Word> = {};
              if (updatedTranslations.it !== undefined) directLangUpdates.it = updatedTranslations.it;
              if (updatedTranslations.de !== undefined) directLangUpdates.de = updatedTranslations.de;
              if (updatedTranslations.es !== undefined) directLangUpdates.es = updatedTranslations.es;
              if (updatedTranslations.fr !== undefined) directLangUpdates.fr = updatedTranslations.fr;

              const newRu = details.ru !== undefined ? details.ru : (updatedTranslations.ru ?? w.ru);
              const newWord = details.word !== undefined ? details.word : w.word;
              const newEng = details.word !== undefined && !w.source_language ? details.word : w.eng;
              const newAssoc = details.personal_association !== undefined ? details.personal_association : (w.personal_association || '');

              return { 
                ...w, 
                ...directLangUpdates,
                word: newWord,
                eng: newEng,
                ru: newRu,
                personal_association: newAssoc,
                translations: mergedTranslations
              };
            }
            return w;
          };

          const newWords = state.words.map(updateWord);
          const newCustomWords = (state.customWords || []).map(updateWord);

          return { 
            userWordProgress: newProgress,
            words: newWords,
            customWords: newCustomWords
          };
        });
      },

      addCustomWord: (word) => {
        set((state) => {
          const updatedCustom = [...state.customWords, word];
          return {
            customWords: updatedCustom,
            words: [word, ...state.words] // Prepend new words so they appear first in dictionary
          };
        });
      },

      setWordAiVerification: (wordKey, verification) => {
        set((state) => {
          const key = wordKey;
          const currentProg = state.userWordProgress[key] || {};
          const updatedProg: UserWordProgress = {
            ...currentProg,
            ai_verification: verification,
          };
          return {
            userWordProgress: {
              ...state.userWordProgress,
              [key]: updatedProg,
            }
          };
        });
      },

      addWordFromSentenceToken: (token, languageCode) => {
        // Prioritize canonical dictionary form (lemma) or dictionary_word.
        // If neither exists, clean up token.text (strip punctuation) - NEVER use parts[0].
        const rawForm = token.dictionary_form || token.dictionary_word || token.text;
        const dictionaryForm = (rawForm || '')
          .replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, '')
          .trim();
        if (!dictionaryForm) return false;

        const normalizedForm = normalizeDictionaryValue(dictionaryForm);
        const alreadyExists = get().words.some(word =>
          normalizeDictionaryValue(getWordValueForLanguage(word, languageCode)) === normalizedForm ||
          (word.source_language === languageCode && normalizeDictionaryValue(word.word || '') === normalizedForm)
        );
        if (alreadyExists) return false;

        const stableKey = `user:${languageCode}:${normalizedForm}`;
        const newWord: Word = {
          id: `custom_${Date.now().toString()}`,
          // `eng` is a legacy internal key in this app, not the visible language value.
          eng: stableKey,
          word: dictionaryForm,
          ru: token.translation?.trim() || '',
          translations: { [languageCode]: dictionaryForm },
          source_language: languageCode,
          count: 0,
          is_learned: 0,
          knowledge_stats: {},
          show_stats: {},
          personal_association: '',
          is_favorite: false
        };

        set((state) => ({
          customWords: [newWord, ...state.customWords],
          words: [newWord, ...state.words]
        }));
        return true;
      },

      resetStatistics: () => {
        // Clear only progress/stats — keep the user's own words and sentences.
        set(() => ({
          userWordProgress: {},
          dailyShows: {},
          workoutSnapshots: [],
          imwSnapshots: [],
          learnedSentences: []
        }));
        get().initializeStore();
      },

      addWorkoutSnapshot: (snapshot) => {
        const MAX_SNAPSHOTS = 200;
        set((state) => ({
          workoutSnapshots: [...state.workoutSnapshots, snapshot].slice(-MAX_SNAPSHOTS)
        }));
      },
      
      setWorkoutWordCount: (count) => set({ workoutWordCount: count }),
      setWorkoutLearnedWordCount: (count) => set({ workoutLearnedWordCount: count }),

      setWorkoutFavoritesOnly: (onlyFavorites) => set({ workoutFavoritesOnly: onlyFavorites }),

      toggleWordFavorite: (wordEng) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentFav = currentProg.is_favorite;
          
          const updatedProg: UserWordProgress = {
            ...currentProg,
            is_favorite: !currentFav
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const updateFav = (w: Word) => {
            if (w.eng === wordEng || w.word === wordEng) {
              return { ...w, is_favorite: !currentFav };
            }
            return w;
          };

          const newWords = state.words.map(updateFav);
          const newCustomWords = (state.customWords || []).map(updateFav);

          return { 
            userWordProgress: newProgress,
            words: newWords,
            customWords: newCustomWords
          };
        });
      },

      restoreWordProgress: (wordEng, previousProgress) => {
        set((state) => {
          const key = wordEng;
          
          const newProgress = { ...state.userWordProgress };
          if (previousProgress) {
            newProgress[key] = previousProgress;
          } else {
            delete newProgress[key];
          }

          const baseWord = baseStaticWords.find(w => w.eng === wordEng || w.word === wordEng);

          const restoreWord = (w: Word): Word => {
            if (w.eng === wordEng || w.word === wordEng) {
              if (previousProgress) {
                const mergedTranslations = {
                  ...(baseWord?.translations || {}),
                  ...(previousProgress.custom_translations || {})
                };

                const directLangUpdates: Partial<Word> = {};
                if (previousProgress.custom_translations) {
                  if ('it' in previousProgress.custom_translations) directLangUpdates.it = previousProgress.custom_translations.it;
                  if ('de' in previousProgress.custom_translations) directLangUpdates.de = previousProgress.custom_translations.de;
                  if ('es' in previousProgress.custom_translations) directLangUpdates.es = previousProgress.custom_translations.es;
                  if ('fr' in previousProgress.custom_translations) directLangUpdates.fr = previousProgress.custom_translations.fr;
                  if ('ru' in previousProgress.custom_translations) directLangUpdates.ru = previousProgress.custom_translations.ru;
                }

                return {
                  ...w,
                  ...directLangUpdates,
                  word: previousProgress.custom_word !== undefined ? previousProgress.custom_word : (baseWord?.word || w.word),
                  eng: previousProgress.custom_word !== undefined && !w.source_language ? previousProgress.custom_word : (baseWord?.eng || w.eng),
                  ru: previousProgress.custom_ru !== undefined ? previousProgress.custom_ru : (directLangUpdates.ru ?? baseWord?.ru ?? w.ru),
                  translations: mergedTranslations,
                  count: previousProgress.count !== undefined ? previousProgress.count : (baseWord?.count || 0),
                  is_learned: previousProgress.is_learned !== undefined ? previousProgress.is_learned : (baseWord?.is_learned || 0),
                  knowledge_stats: previousProgress.knowledge_stats || (baseWord?.knowledge_stats || {}),
                  show_stats: previousProgress.show_stats || (baseWord?.show_stats || {}),
                  last_shown: previousProgress.last_shown || baseWord?.last_shown,
                  last_shown_by_lang: previousProgress.last_shown_by_lang || baseWord?.last_shown_by_lang,
                  personal_association: previousProgress.personal_association || baseWord?.personal_association || '',
                  is_favorite: previousProgress.is_favorite !== undefined ? previousProgress.is_favorite : (baseWord?.is_favorite || false)
                };
              } else if (baseWord) {
                return { ...baseWord }; // restore to base
              }
            }
            return w;
          };

          const newWords = state.words.map(restoreWord);
          const newCustomWords = (state.customWords || []).map(restoreWord);

          return {
            userWordProgress: newProgress,
            words: newWords,
            customWords: newCustomWords
          };
        });
      },

      exportProgress: () => pickPersistedFields(get()),

      importProgress: (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return { ok: false, error: 'Файл повреждён или имеет неверный формат.' };
        }
        const d = data as Partial<PersistedProgress>;
        set({
          userWordProgress: d.userWordProgress || {},
          customSentences: Array.isArray(d.customSentences) ? d.customSentences : [],
          generatedSentences: Array.isArray(d.generatedSentences) ? d.generatedSentences : [],
          customWords: Array.isArray(d.customWords) ? d.customWords : [],
          activeLanguages: Array.isArray(d.activeLanguages) && d.activeLanguages.length > 0
            ? d.activeLanguages
            : ['en', 'kz', 'it'],
          dailyShows: d.dailyShows || {},
          workoutSnapshots: Array.isArray(d.workoutSnapshots) ? d.workoutSnapshots : [],
          imwSnapshots: Array.isArray(d.imwSnapshots) ? d.imwSnapshots : [],
          workoutWordCount: typeof d.workoutWordCount === 'number' ? d.workoutWordCount : 10,
          workoutLearnedWordCount: typeof d.workoutLearnedWordCount === 'number' ? d.workoutLearnedWordCount : 2,
          workoutFavoritesOnly: Boolean(d.workoutFavoritesOnly),
          learnedSentences: Array.isArray(d.learnedSentences) ? d.learnedSentences : [],
        });
        get().initializeStore();
        return { ok: true };
      }
    }),
    {
      name: 'papanda-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // AsyncStorage rehydrates asynchronously — once the persisted slices are in,
      // rebuild the derived `words` / `sentences` from them.
      onRehydrateStorage: () => (state) => {
        state?.initializeStore();
      },
      // CRITICAL FOR ANDROID: Only persist user changes, NOT the entire 5MB static dataset!
      partialize: pickPersistedFields,
    }
  )
);
