import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Word, Sentence, Token } from '../models/types';
import { DailyShows, WorkoutSnapshot } from '../utils/statistics';
import wordsData from '../data/words.json';
import sentencesData from '../data/sentences.json';

interface TargetSentenceInfo {
  langCode: string;
  sentenceId?: string;
  sentenceIndex?: number;
  highlightWord?: string;
}

interface UserWordProgress {
  count?: number;
  is_learned?: number;
  knowledge_stats?: Record<string, boolean>;
  show_stats?: Record<string, number>;
  last_shown?: string;
  personal_association?: string;
  custom_word?: string;
  custom_ru?: string;
  custom_translations?: Record<string, string>;
  is_favorite?: boolean;
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
  workoutWordCount: number;
  workoutLearnedWordCount: number;
  workoutFavoritesOnly: boolean;
  learnedSentences: string[];
  
  // Actions
  initializeStore: () => void;
  setLanguages: (langs: string[]) => void;
  setTargetSentenceInfo: (info: TargetSentenceInfo | null) => void;
  markWordKnown: (wordEng: string, lang: string, isKnown: boolean) => void;
  incrementShowCount: (wordEng: string, lang: string) => void;
  markTripleKnown: (wordEng: string) => void;
  saveWordAssociation: (wordEng: string, assoc: string) => void;
  addSentence: (sentence: Sentence) => void;
  addGeneratedSentences: (sentences: Sentence[]) => void;
  clearGeneratedSentences: (languageLabel?: string) => void;
  updateSentence: (id: string, sentence: Sentence) => void;
  markSentenceLearned: (id: string, isLearned: boolean) => void;
  updateWordDetails: (wordKey: string, details: { word?: string; ru?: string; translations?: Record<string, string> }) => void;
  addCustomWord: (word: Word) => void;
  addWordFromSentenceToken: (token: Token, languageCode: string) => boolean;
  resetStatistics: () => void;
  addWorkoutSnapshot: (snapshot: WorkoutSnapshot) => void;
  setWorkoutWordCount: (count: number) => void;
  setWorkoutLearnedWordCount: (count: number) => void;
  setWorkoutFavoritesOnly: (onlyFavorites: boolean) => void;
  toggleWordFavorite: (wordEng: string) => void;
  restoreWordProgress: (wordEng: string, previousProgress: UserWordProgress | null) => void;
}

// Helper to parse JSON fields safely
const parseJSONField = (field: string | Record<string, any> | null) => {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch { return {}; }
  }
  return field || {};
};

const normalizeDictionaryValue = (value: string) => value.trim().toLocaleLowerCase();

const getWordValueForLanguage = (word: Word, languageCode: string): string => {
  if (languageCode === 'en') return word.translations?.en || word.eng || word.word || '';
  const directValue = word[languageCode as keyof Word];
  return (typeof directValue === 'string' && directValue.trim() ? directValue : word.translations?.[languageCode]) || '';
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
      workoutWordCount: 10,
      workoutLearnedWordCount: 2,
      workoutFavoritesOnly: false,
      learnedSentences: [],

      initializeStore: () => {
        const { userWordProgress, customSentences, customWords, generatedSentences } = get();
        
        // Merge baseStaticWords with persisted userWordProgress
        const mergedWords = baseStaticWords.map(w => {
          const key = w.eng || w.word || '';
          const prog = userWordProgress[key];
          if (prog) {
            return {
              ...w,
              word: prog.custom_word !== undefined ? prog.custom_word : w.word,
              eng: prog.custom_word !== undefined && !w.source_language ? prog.custom_word : w.eng,
              ru: prog.custom_ru !== undefined ? prog.custom_ru : w.ru,
              translations: { ...w.translations, ...(prog.custom_translations || {}) },
              count: prog.count !== undefined ? prog.count : w.count,
              is_learned: prog.is_learned !== undefined ? prog.is_learned : w.is_learned,
              knowledge_stats: prog.knowledge_stats || w.knowledge_stats,
              show_stats: prog.show_stats || w.show_stats,
              last_shown: prog.last_shown || w.last_shown,
              personal_association: prog.personal_association || w.personal_association,
              is_favorite: prog.is_favorite !== undefined ? prog.is_favorite : w.is_favorite
            };
          }
          return w;
        });

        const mergedCustomWords = (customWords || []).map(w => {
          const key = w.eng || w.word || '';
          const prog = userWordProgress[key];
          if (prog) {
            return {
              ...w,
              word: prog.custom_word !== undefined ? prog.custom_word : w.word,
              eng: prog.custom_word !== undefined && !w.source_language ? prog.custom_word : w.eng,
              ru: prog.custom_ru !== undefined ? prog.custom_ru : w.ru,
              translations: { ...w.translations, ...(prog.custom_translations || {}) },
              count: prog.count !== undefined ? prog.count : w.count,
              is_learned: prog.is_learned !== undefined ? prog.is_learned : w.is_learned,
              knowledge_stats: prog.knowledge_stats || w.knowledge_stats,
              show_stats: prog.show_stats || w.show_stats,
              last_shown: prog.last_shown || w.last_shown,
              personal_association: prog.personal_association || w.personal_association,
              is_favorite: prog.is_favorite !== undefined ? prog.is_favorite : w.is_favorite
            };
          }
          return w;
        });

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

          const updatedProg: UserWordProgress = {
            ...currentProg,
            count: newCount,
            last_shown: nowIso,
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
          const nowIso = new Date().toISOString();

          state.activeLanguages.forEach(lang => {
            currentStats[lang] = true;
            currentShowStats[lang] = (currentShowStats[lang] || 0) + 1;
          });

          const updatedProg: UserWordProgress = {
            ...currentProg,
            knowledge_stats: currentStats,
            show_stats: currentShowStats,
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

          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              return { ...w, personal_association: assoc };
            }
            return w;
          });

          return { 
            userWordProgress: newProgress,
            words: newWords 
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
          const knownTexts = new Set(state.sentences.map(sentence => `${sentence.language}:${sentence.sentence}`));
          const uniqueSentences = newSentences.filter(sentence => !knownTexts.has(`${sentence.language}:${sentence.sentence}`));
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
          
          const updatedTranslations = { 
            ...(currentProg.custom_translations || {}), 
            ...(details.translations || {}) 
          };

          const updatedProg: UserWordProgress = {
            ...currentProg,
            ...(details.word !== undefined && { custom_word: details.word }),
            ...(details.ru !== undefined && { custom_ru: details.ru }),
            ...(Object.keys(updatedTranslations).length > 0 && { custom_translations: updatedTranslations })
          };

          const newProgress = {
            ...state.userWordProgress,
            [key]: updatedProg
          };

          const newWords = state.words.map(w => {
            if (w.eng === wordKey || w.word === wordKey) {
              return { 
                ...w, 
                ...(details.word !== undefined && { word: details.word, ...(!w.source_language && { eng: details.word }) }),
                ...(details.ru !== undefined && { ru: details.ru }),
                translations: { ...w.translations, ...updatedTranslations }
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

      addCustomWord: (word) => {
        set((state) => {
          const updatedCustom = [...state.customWords, word];
          return {
            customWords: updatedCustom,
            words: [word, ...state.words] // Prepend new words so they appear first in dictionary
          };
        });
      },

      addWordFromSentenceToken: (token, languageCode) => {
        const dictionaryForm = (token.dictionary_form || token.dictionary_word || token.parts?.[0] || token.text).trim();
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

          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              return { ...w, is_favorite: !currentFav };
            }
            return w;
          });

          return { 
            userWordProgress: newProgress,
            words: newWords 
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
          const newWords = state.words.map(w => {
            if (w.eng === wordEng || w.word === wordEng) {
              if (previousProgress) {
                return {
                  ...w,
                  word: previousProgress.custom_word !== undefined ? previousProgress.custom_word : (baseWord?.word || w.word),
                  eng: previousProgress.custom_word !== undefined && !w.source_language ? previousProgress.custom_word : (baseWord?.eng || w.eng),
                  ru: previousProgress.custom_ru !== undefined ? previousProgress.custom_ru : (baseWord?.ru || w.ru),
                  translations: { ...(baseWord?.translations || {}), ...(previousProgress.custom_translations || {}) },
                  count: previousProgress.count !== undefined ? previousProgress.count : (baseWord?.count || 0),
                  is_learned: previousProgress.is_learned !== undefined ? previousProgress.is_learned : (baseWord?.is_learned || 0),
                  knowledge_stats: previousProgress.knowledge_stats || (baseWord?.knowledge_stats || {}),
                  show_stats: previousProgress.show_stats || (baseWord?.show_stats || {}),
                  last_shown: previousProgress.last_shown || baseWord?.last_shown,
                  personal_association: previousProgress.personal_association || baseWord?.personal_association,
                  is_favorite: previousProgress.is_favorite !== undefined ? previousProgress.is_favorite : (baseWord?.is_favorite || false)
                };
              } else if (baseWord) {
                return { ...baseWord }; // restore to base
              }
            }
            return w;
          });

          return { 
            userWordProgress: newProgress,
            words: newWords 
          };
        });
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
      partialize: (state) => ({
        userWordProgress: state.userWordProgress,
        customSentences: state.customSentences,
        generatedSentences: state.generatedSentences,
        customWords: state.customWords,
        activeLanguages: state.activeLanguages,
        dailyShows: state.dailyShows,
        workoutSnapshots: state.workoutSnapshots,
        workoutWordCount: state.workoutWordCount,
        workoutLearnedWordCount: state.workoutLearnedWordCount,
        workoutFavoritesOnly: state.workoutFavoritesOnly,
        learnedSentences: state.learnedSentences,
      }),
    }
  )
);
