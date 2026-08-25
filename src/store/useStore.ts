import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Word, Sentence } from '../models/types';
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
}

interface AppState {
  words: Word[];
  sentences: Sentence[];
  customSentences: Sentence[];
  customWords: Word[];
  userWordProgress: Record<string, UserWordProgress>;
  activeLanguages: string[];
  targetSentenceInfo: TargetSentenceInfo | null;
  dailyShows: DailyShows;
  workoutSnapshots: WorkoutSnapshot[];
  workoutWordCount: number;
  
  // Actions
  initializeStore: () => void;
  setLanguages: (langs: string[]) => void;
  setTargetSentenceInfo: (info: TargetSentenceInfo | null) => void;
  markWordKnown: (wordEng: string, lang: string, isKnown: boolean) => void;
  incrementShowCount: (wordEng: string, lang: string) => void;
  markTripleKnown: (wordEng: string) => void;
  saveWordAssociation: (wordEng: string, assoc: string) => void;
  addSentence: (sentence: Sentence) => void;
  updateSentence: (id: string, sentence: Sentence) => void;
  updateWordDetails: (wordKey: string, details: { word?: string; ru?: string; translations?: Record<string, string> }) => void;
  addCustomWord: (word: Word) => void;
  resetStatistics: () => void;
  addWorkoutSnapshot: (snapshot: WorkoutSnapshot) => void;
  setWorkoutWordCount: (count: number) => void;
}

// Helper to parse JSON fields safely
const parseJSONField = (field: string | Record<string, any> | null) => {
  if (typeof field === 'string') {
    try { return JSON.parse(field); } catch { return {}; }
  }
  return field || {};
};

// Base static words dictionary
const baseStaticWords: Word[] = (wordsData as any[]).map((w, idx) => ({
  id: w.id || idx.toString(),
  word: w.word || w.eng || '',
  eng: w.eng || w.word || '',
  ru: w.ru || '',
  it: w.it || '',
  es: w.es || '',
  de: w.de || '',
  fr: w.fr || '',
  meaning: w.meaning || '',
  count: 0,
  is_learned: 0,
  knowledge_stats: {},
  show_stats: {},
  last_shown: undefined,
  translations: parseJSONField(w.translations),
  personal_association: ''
}));

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
      customWords: [],
      userWordProgress: {},
      activeLanguages: ['en', 'kz', 'it'],
      targetSentenceInfo: null,
      dailyShows: {},
      workoutSnapshots: [],
      workoutWordCount: 10,

      initializeStore: () => {
        const { userWordProgress, customSentences, customWords } = get();
        
        // Merge baseStaticWords with persisted userWordProgress
        const mergedWords = baseStaticWords.map(w => {
          const key = w.eng || w.word || '';
          const prog = userWordProgress[key];
          if (prog) {
            return {
              ...w,
              word: prog.custom_word !== undefined ? prog.custom_word : w.word,
              eng: prog.custom_word !== undefined ? prog.custom_word : w.eng,
              ru: prog.custom_ru !== undefined ? prog.custom_ru : w.ru,
              translations: { ...w.translations, ...(prog.custom_translations || {}) },
              count: prog.count !== undefined ? prog.count : w.count,
              is_learned: prog.is_learned !== undefined ? prog.is_learned : w.is_learned,
              knowledge_stats: prog.knowledge_stats || w.knowledge_stats,
              show_stats: prog.show_stats || w.show_stats,
              last_shown: prog.last_shown || w.last_shown,
              personal_association: prog.personal_association || w.personal_association
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
              eng: prog.custom_word !== undefined ? prog.custom_word : w.eng,
              ru: prog.custom_ru !== undefined ? prog.custom_ru : w.ru,
              translations: { ...w.translations, ...(prog.custom_translations || {}) },
              count: prog.count !== undefined ? prog.count : w.count,
              is_learned: prog.is_learned !== undefined ? prog.is_learned : w.is_learned,
              knowledge_stats: prog.knowledge_stats || w.knowledge_stats,
              show_stats: prog.show_stats || w.show_stats,
              last_shown: prog.last_shown || w.last_shown,
              personal_association: prog.personal_association || w.personal_association
            };
          }
          return w;
        });

        const mergedSentences = [...baseStaticSentences, ...(customSentences || [])];

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
                ...(details.word !== undefined && { word: details.word, eng: details.word }),
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

      resetStatistics: () => {
        set(() => ({
          userWordProgress: {},
          words: baseStaticWords,
          dailyShows: {},
          workoutSnapshots: []
        }));
      },
      
      addWorkoutSnapshot: (snapshot) => {
        set((state) => ({
          workoutSnapshots: [...state.workoutSnapshots, snapshot]
        }));
      },
      
      setWorkoutWordCount: (count) => set({ workoutWordCount: count })
    }),
    {
      name: 'papanda-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // CRITICAL FOR ANDROID: Only persist user changes, NOT the entire 5MB static dataset!
      partialize: (state) => ({
        userWordProgress: state.userWordProgress,
        customSentences: state.customSentences,
        customWords: state.customWords,
        activeLanguages: state.activeLanguages,
        dailyShows: state.dailyShows,
        workoutSnapshots: state.workoutSnapshots,
        workoutWordCount: state.workoutWordCount,
      }),
    }
  )
);

