import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Word, Sentence } from '../models/types';
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
}

interface AppState {
  words: Word[];
  sentences: Sentence[];
  customSentences: Sentence[];
  userWordProgress: Record<string, UserWordProgress>;
  activeLanguage: string;
  activeLanguages: string[];
  targetSentenceInfo: TargetSentenceInfo | null;
  
  // Actions
  initializeStore: () => void;
  setActiveLanguage: (lang: string) => void;
  setLanguages: (langs: string[]) => void;
  setTargetSentenceInfo: (info: TargetSentenceInfo | null) => void;
  markWordKnown: (wordEng: string, isKnown: boolean) => void;
  incrementShowCount: (wordEng: string) => void;
  markTripleKnown: (wordEng: string) => void;
  saveWordAssociation: (wordEng: string, assoc: string) => void;
  addSentence: (sentence: Sentence) => void;
  updateSentence: (index: number, sentence: Sentence) => void;
  resetStatistics: () => void;
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
      userWordProgress: {},
      activeLanguage: 'it',
      activeLanguages: ['en', 'kz', 'it'],
      targetSentenceInfo: null,

      initializeStore: () => {
        const { userWordProgress, customSentences } = get();
        
        // Merge baseStaticWords with persisted userWordProgress
        const mergedWords = baseStaticWords.map(w => {
          const key = w.eng || w.word || '';
          const prog = userWordProgress[key];
          if (prog) {
            return {
              ...w,
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
          words: mergedWords, 
          sentences: mergedSentences 
        });
      },

      setActiveLanguage: (lang) => set({ activeLanguage: lang }),

      setLanguages: (langs) => set({ activeLanguages: langs }),

      setTargetSentenceInfo: (info) => set({ targetSentenceInfo: info }),

      markWordKnown: (wordEng, isKnown) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentStats = { ...(currentProg.knowledge_stats || {}) };
          currentStats[state.activeLanguage] = isKnown;

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

      incrementShowCount: (wordEng) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentShowStats = { ...(currentProg.show_stats || {}) };
          currentShowStats[state.activeLanguage] = (currentShowStats[state.activeLanguage] || 0) + 1;
          const newCount = (currentProg.count || 0) + 1;
          const nowIso = new Date().toISOString();

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
            words: newWords 
          };
        });
      },

      markTripleKnown: (wordEng) => {
        set((state) => {
          const key = wordEng;
          const currentProg = state.userWordProgress[key] || {};
          const currentStats = { ...(currentProg.knowledge_stats || {}) };
          state.activeLanguages.forEach(lang => {
            currentStats[lang] = true;
          });

          const updatedProg: UserWordProgress = {
            ...currentProg,
            knowledge_stats: currentStats,
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
                is_learned: 1
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

      updateSentence: (index, sentence) => {
        set((state) => {
          const newSentences = [...state.sentences];
          if (newSentences[index]) {
            newSentences[index] = sentence;
          }
          return { sentences: newSentences };
        });
      },

      resetStatistics: () => {
        set(() => ({
          userWordProgress: {},
          words: baseStaticWords
        }));
      }
    }),
    {
      name: 'papanda-storage',
      storage: createJSONStorage(() => AsyncStorage),
      // CRITICAL FOR ANDROID: Only persist user changes, NOT the entire 5MB static dataset!
      partialize: (state) => ({
        userWordProgress: state.userWordProgress,
        customSentences: state.customSentences,
        activeLanguage: state.activeLanguage,
        activeLanguages: state.activeLanguages,
      }),
    }
  )
);
