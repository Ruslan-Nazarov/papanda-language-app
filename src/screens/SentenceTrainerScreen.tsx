import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { generationContext, checkAborted, isAbortError, cancelGenerations, useGenerationStatus } from '../services/generationControl';
import { useShallow } from 'zustand/react/shallow';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView, Modal, Platform, ActivityIndicator, Alert, PanResponder, Animated, LayoutAnimation, UIManager, InteractionManager, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Sentence, Token, Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { Ionicons } from '@expo/vector-icons';
import SentenceExplanation from '../components/SentenceExplanation';
import SentenceDiscussion from '../components/SentenceDiscussion';
import { explainSentenceWithAI } from '../services/aiService';
import { generateSentenceBatch, isSentenceGenerationConfigured, RequiredWord } from '../services/sentenceGeneration';
import SentenceEditorModal from '../components/SentenceEditorModal';
import { useCardTransition } from '../hooks/useCardTransition';
import { useSentenceEditor } from '../hooks/useSentenceEditor';
import { ROLE_TRANSLATIONS, getRoleColor, formatTokenTranslation } from '../constants/sentencePresentation';
import WordFormModal from '../components/WordFormModal';
import type { WordFormContext } from '../services/wordFormExplanation';
import { buildWordLookup, cleanDictionaryForm, getWordTranslation } from '../utils/words';
import { SESSION_START, sessionRefreshedLangs } from '../services/sentenceSession';
import { computeSentenceRevealGroups, tokenRevealIndices } from '../utils/sentenceGroups';
import { sentenceFingerprint } from '../utils/sentenceValidation';
import { getTokenFormParts, getTokenFormSegments } from '../utils/tokenForms';
import { ACCENT, ACCENT_DARK, UI } from '../constants/theme';
import { createQueueOrder, selectTrainerQueue, selectWorkoutBatch, trainerPool } from '../utils/sentenceQueue';
import BookConnections from '../components/BookConnections';
import { selectBookPassages, parseBookURL } from '../services/bookService';
import type { BookLocation, BookPassage } from '../models/book';
import type { NoteSource } from '../models/notes';
import { activeExperimentRun } from '../models/experiments';
import { SENTENCE_LESSON_EXPERIMENT } from '../models/sentenceLessons';
import SentenceLessonsScreen from './SentenceLessonsScreen';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const REVEAL_ANIMATION = LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

const AFFIX_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']; // Palette for multiple suffixes
// Top up when this few stand-alone cards remain. A batch of 8 yields only 4 stand-alone
// cards (the other 4 form the Workshop series), so the reserve must stay below 4,
// otherwise every finished batch would immediately trigger another one.
const GENERATION_RESERVE = 3;

export default function SentenceTrainerScreen() {
  const enabled = useStore(state => !!activeExperimentRun(state.experiments[SENTENCE_LESSON_EXPERIMENT]));
  const target = useStore(state => state.targetSentenceInfo);
  const [free, setFree] = useState(false);
  const [targetMode, setTargetMode] = useState(false);
  useEffect(() => { if (target) setTargetMode(true); }, [target]);
  useEffect(() => { if (!enabled) { setFree(false); setTargetMode(false); } }, [enabled]);
  if (!enabled) return <FreeSentenceTrainerScreen />;
  if (!free && !target && !targetMode) return <SentenceLessonsScreen onFree={() => setFree(true)} />;
  return <FreeSentenceTrainerScreen onLessons={() => { setFree(false); setTargetMode(false); }} />;
}

function FreeSentenceTrainerScreen({ onLessons }: { onLessons?: () => void }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, sentences, addGeneratedSentences, clearGeneratedSentences, addWordFromSentenceToken, activeLanguages, targetSentenceInfo, setTargetSentenceInfo, incrementShowCounts, sentenceWorkoutCount } = useStore(useShallow(state => ({
    words: state.words,
    sentences: state.sentences,
    addGeneratedSentences: state.addGeneratedSentences,
    clearGeneratedSentences: state.clearGeneratedSentences,
    addWordFromSentenceToken: state.addWordFromSentenceToken,
    activeLanguages: state.activeLanguages,
    targetSentenceInfo: state.targetSentenceInfo,
    setTargetSentenceInfo: state.setTargetSentenceInfo,
    incrementShowCounts: state.incrementShowCounts,
    sentenceWorkoutCount: state.sentenceWorkoutCount,
  })));
  const [workoutOffset, setWorkoutOffset] = useState(0);
  const [workoutCompleteModalVisible, setWorkoutCompleteModalVisible] = useState(false);
  const [queuedSentenceId, setQueuedSentenceId] = useState<string | null>(null);
  const [targetSentenceId, setTargetSentenceId] = useState<string | null>(null);
  // null means fully revealed; otherwise each block can be opened independently.
  const [revealedTokens, setRevealedTokens] = useState<Set<number> | null>(new Set());
  const [showTranslations, setShowTranslations] = useState(false);
  const [isTableMode, setIsTableMode] = useState(false);
  const cachedSentences = useStore(state => state.generatedSentences);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  const [selectedLanguageCode, setSelectedLanguageCode] = useState(activeLanguages[0] || 'it');
  const generationPhase = useGenerationStatus(state => state.phases[selectedLanguageCode]);
  const editor = useSentenceEditor(LANGUAGES.find(l => l.code === selectedLanguageCode)?.label || 'Unknown', setTargetSentenceId);

  // A token opens its contextual form explanation; editing is a separate action inside.
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [isWordModalVisible, setIsWordModalVisible] = useState(false);
  const [wordFormContext, setWordFormContext] = useState<WordFormContext | null>(null);
  const [noteToken, setNoteToken] = useState<string | undefined>();

  // AI state
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiBookPassages, setAiBookPassages] = useState<BookPassage[]>([]);
  const [aiBookLanguage, setAiBookLanguage] = useState('en');
  const explanationRequest = useRef(0);
  const explanationController = useRef<AbortController | null>(null);
  const closeExplanation = () => {
    explanationRequest.current++;
    explanationController.current?.abort();
    setIsAiLoading(false);
    setShowAiModal(false);
  };
  useEffect(() => () => { explanationController.current?.abort(); }, []);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [busyLanguages, setBusyLanguages] = useState<Set<string>>(new Set());
  const isGenerating = busyLanguages.has(selectedLanguageCode) || Boolean(generationPhase);
  const [generationErrors, setGenerationErrors] = useState<Record<string, string>>({});
  const [addedTokenKeys, setAddedTokenKeys] = useState<Set<string>>(new Set());
  const generatingLanguages = useRef(new Map<string, Promise<void>>());
  const targetGenerationRequest = useRef(0);
  const queueOrder = useRef(createQueueOrder());
  const SWIPE_THRESHOLD = 60;
  const SWIPE_EXIT_DISTANCE = 420;
  const SWIPE_ENTRY_OFFSET = 48;
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // A 1:1 dx>dy ratio effectively demanded a near-perfectly horizontal drag —
  // any natural diagonal wobble (very common on a touchscreen) failed to
  // register, especially inside a vertically-scrolling ScrollView that's also
  // eligible to claim the gesture. Lower the distance needed and require only
  // that horizontal clearly dominates (1.4x), same ratio used by the other
  // swipeable screens (Word Triples, Brain Workout) where this feels natural.
  // onMoveShouldSetPanResponderCapture claims the gesture in the capture phase,
  // before the ScrollView's own scroll responder gets a chance to grab it.
  const isHorizontalSwipe = (gestureState: { dx: number; dy: number }) =>
    Math.abs(gestureState.dx) > 10 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4;

  const sentencePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gestureState) => isHorizontalSwipe(gestureState),
      onMoveShouldSetPanResponderCapture: (_event, gestureState) => isHorizontalSwipe(gestureState),
      onPanResponderMove: (_event, gestureState) => {
        if (!isSwipeAnimating.current) cardTranslateX.setValue(gestureState.dx);
      },
      onPanResponderRelease: (_event, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          animateSwipe('left');
        } else if (gestureState.dx > SWIPE_THRESHOLD) {
          animateSwipe('right');
        } else {
          resetCardPosition();
        }
      },
      onPanResponderTerminate: () => resetCardPosition(),
    })
  ).current;

  const selectedLanguageRef = useRef(selectedLanguageCode);
  selectedLanguageRef.current = selectedLanguageCode;
  const seenIdsByLang = useRef<Record<string, Set<string>>>({});
  const lockedWorkoutIds = useRef<string[] | null>(null);
  const generationBatchSize = Math.min(20, Math.max(5, sentenceWorkoutCount));
  useEffect(() => { lockedWorkoutIds.current = null; setTargetSentenceId(null); setWorkoutOffset(0); setWorkoutCompleteModalVisible(false); }, [selectedLanguageCode]);
  useEffect(() => { lockedWorkoutIds.current = null; setWorkoutOffset(0); setWorkoutCompleteModalVisible(false); }, [sentenceWorkoutCount]);

  // If the learner drops the currently-selected language in Settings, the old
  // language's sentences would keep showing (with no button to switch away).
  // Snap back to the first active language.
  useEffect(() => {
    if (activeLanguages.length > 0 && !activeLanguages.includes(selectedLanguageCode)) {
      setSelectedLanguageCode(activeLanguages[0]);
      setCurrentFilteredIndex(0);
      setRevealedTokens(new Set());
      setShowTranslations(false);
    }
  }, [activeLanguages, selectedLanguageCode]);

  // Saved/edited cards remain available alongside AI cards; seeds are the fallback.
  const activeLangObj = useMemo(() => LANGUAGES.find(l => l.code === selectedLanguageCode), [selectedLanguageCode]);
  const allSentencesForLanguage = useMemo(() => {
    if (!activeLangObj) return [];
    const targetLabel = activeLangObj.label.toLowerCase();
    return sentences.filter(s => {
      if (!s.language) return false;
      return s.language.toLowerCase().includes(targetLabel);
    });
  }, [sentences, activeLangObj]);

  const { generatedSentences, sessionGenerated, filteredSentences, showingGenerated } = useMemo(() => {
    const { generated, session, pool, showingGenerated } = trainerPool(allSentencesForLanguage, SESSION_START);
    const filtered = selectTrainerQueue(pool, queueOrder.current, Math.random, SESSION_START);
    return {
      generatedSentences: generated,
      sessionGenerated: session,
      filteredSentences: filtered,
      showingGenerated,
    };
  }, [allSentencesForLanguage]);

  const workoutSentences = useMemo(() => {
    const seen = seenIdsByLang.current[selectedLanguageCode];
    const freshBatch = selectWorkoutBatch(filteredSentences, sentenceWorkoutCount, workoutOffset, seen);
    const hasInteracted = showTranslations || revealedTokens === null || revealedTokens.size > 0;
    if (hasInteracted && !lockedWorkoutIds.current && freshBatch.length > 0) {
      lockedWorkoutIds.current = freshBatch.map(sentence => sentence.id);
    }
    if (lockedWorkoutIds.current && lockedWorkoutIds.current.length > 0) {
      const byId = new Map(filteredSentences.map(sentence => [sentence.id, sentence]));
      const locked = lockedWorkoutIds.current.flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
      if (locked.length > 0) {
        if (locked.length < sentenceWorkoutCount && filteredSentences.length > locked.length) {
          const lockedSet = new Set(locked.map(sentence => sentence.id));
          const extra = freshBatch.filter(sentence => !lockedSet.has(sentence.id)).slice(0, sentenceWorkoutCount - locked.length);
          const combined = [...locked, ...extra];
          lockedWorkoutIds.current = combined.map(sentence => sentence.id);
          return combined;
        }
        return locked;
      }
      lockedWorkoutIds.current = null;
    }
    return freshBatch;
  }, [filteredSentences, sentenceWorkoutCount, workoutOffset, selectedLanguageCode, showTranslations, revealedTokens]);

  // Keep the visible card by ID when cache eviction removes earlier entries.
  const currentFilteredIndex = Math.max(0, workoutSentences.findIndex(sentence => sentence.id === queuedSentenceId));
  const setCurrentFilteredIndex = (index: number) => setQueuedSentenceId(workoutSentences[index]?.id ?? null);
  useEffect(() => {
    if (workoutSentences[currentFilteredIndex]?.id !== queuedSentenceId) {
      setQueuedSentenceId(workoutSentences[currentFilteredIndex]?.id ?? null);
    }
  }, [workoutSentences, currentFilteredIndex, queuedSentenceId]);

  const generationError = generationErrors[selectedLanguageCode];
  const generatedCacheCount = generatedSentences.length;
  const languageCache = useMemo(() => cachedSentences.filter(sentence =>
    activeLangObj && sentence.language.toLowerCase().includes(activeLangObj.label.toLowerCase())
  ), [cachedSentences, activeLangObj]);
  const createdThisSession = languageCache.filter(sentence => (sentence.createdAt ?? 0) >= SESSION_START).length;

  const cancelGeneration = () => {
    targetGenerationRequest.current++;
    cancelGenerations(selectedLanguageCode);
    generatingLanguages.current.delete(selectedLanguageCode);
    setBusyLanguages(previous => { const next = new Set(previous); next.delete(selectedLanguageCode); return next; });
    setGenerationErrors(previous => ({ ...previous, [selectedLanguageCode]: 'Генерация отменена. Можно повторить позже.' }));
  };

  const generateSentences = async (languageCode = selectedLanguageCode, count = generationBatchSize, requiredWord?: RequiredWord) => {
    const language = LANGUAGES.find(item => item.code === languageCode);
    if (!language) return;
    const targetRequest = requiredWord ? ++targetGenerationRequest.current : undefined;
    // An explicit word request takes priority over the automatic batch.
    if (requiredWord) {
      cancelGenerations(languageCode);
      generatingLanguages.current.delete(languageCode);
    } else if (generatingLanguages.current.has(languageCode)) {
      return;
    }
    const context = generationContext(languageCode);
    if (context.signal.aborted) return;
    if (requiredWord && (targetRequest !== targetGenerationRequest.current || selectedLanguageRef.current !== languageCode)) return;

    setBusyLanguages(previous => new Set(previous).add(languageCode));
    setGenerationErrors(previous => {
      if (!previous[languageCode]) return previous;
      const updated = { ...previous };
      delete updated[languageCode];
      return updated;
    });

    const request = (async () => { try {
      const state = useStore.getState();
      const previous = state.sentences.filter(sentence => sentence.language === language.label).map(sentence => sentence.sentence);
      const generated = await generateSentenceBatch(languageCode, state.words, count, requiredWord, previous);
      checkAborted(context.signal);
      addGeneratedSentences(generated);
      if (requiredWord && targetRequest === targetGenerationRequest.current && languageCode === selectedLanguageRef.current) {
        const first = generated.find(sentence => sentence.generationTaskId === 'task-1');
        if (first && isMounted.current) {
          const fingerprint = sentenceFingerprint(first.language, first.sentence);
          const stored = useStore.getState().sentences.find(sentence => sentenceFingerprint(sentence.language, sentence.sentence) === fingerprint);
          setTargetSentenceId(stored?.id ?? first.id);
          setRevealedTokens(null);
          setShowTranslations(true);
        }
      } else if (languageCode === selectedLanguageRef.current && generatedSentences.length === 0 && isMounted.current) {
        setCurrentFilteredIndex(0);
      }
    } catch (error) {
      if (isAbortError(error) || !isMounted.current) return;
      const message = error instanceof Error ? error.message : 'Не удалось сгенерировать предложения.';
      setGenerationErrors(previous => ({ ...previous, [languageCode]: message }));
      if (requiredWord && targetRequest === targetGenerationRequest.current && languageCode === selectedLanguageRef.current) {
        Alert.alert('Не удалось создать предложение', `Не получилось составить предложение со словом «${requiredWord.lemma}». Попробуйте ещё раз.`);
      }
    } })();
    generatingLanguages.current.set(languageCode, request);
    try { await request; } finally {
      // A cancelled transport can settle after a newer request has started.
      if (generatingLanguages.current.get(languageCode) === request) {
        generatingLanguages.current.delete(languageCode);
        if (isMounted.current) {
          setBusyLanguages(previous => { const next = new Set(previous); next.delete(languageCode); return next; });
        }
      }
    }
  };

  // Once per language per app launch: pull a fresh batch so each visit shows new
  // sentences. If it fails, the older cached batch keeps showing (fallback).
  useEffect(() => {
    if (!isFocused || !isSentenceGenerationConfigured() || targetSentenceInfo) return;
    if (!sessionRefreshedLangs.has(selectedLanguageCode) && !generationErrors[selectedLanguageCode]) {
      // Give the tab/language transition and the first card time to paint.
      const timer = setTimeout(() => {
        sessionRefreshedLangs.add(selectedLanguageCode);
        void generateSentences(selectedLanguageCode, generationBatchSize);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isFocused, selectedLanguageCode, targetSentenceInfo, generationBatchSize]);

  // Keep an endless queue: quietly top up while the learner still has cards left.
  useEffect(() => {
    if (!isFocused || !isSentenceGenerationConfigured() || targetSentenceInfo) return;
    if (!showingGenerated || generationErrors[selectedLanguageCode]) return;
    const remainingInPlay = filteredSentences.length - currentFilteredIndex;
    if (remainingInPlay <= GENERATION_RESERVE) {
      const timer = setTimeout(() => void generateSentences(selectedLanguageCode, generationBatchSize), 500);
      return () => clearTimeout(timer);
    }
  }, [isFocused, selectedLanguageCode, currentFilteredIndex, generatedCacheCount, showingGenerated, targetSentenceInfo, generationBatchSize]);

  // Handle incoming target sentence from WordTriples or other screens
  useEffect(() => {
    if (!isFocused || !targetSentenceInfo) return;
    const { langCode, sentenceId, highlightWord } = targetSentenceInfo;

    // Wait for the language switch to actually take effect before doing
    // anything language-dependent below (sentence lookup, generation).
    if (langCode && langCode !== selectedLanguageCode) {
      setSelectedLanguageCode(langCode);
      return;
    }

    if (sentenceId) {
      const langObj = LANGUAGES.find(l => l.code === langCode);
      const sentencesForLang = sentences.filter(s =>
        s.language && langObj && s.language.toLowerCase().includes(langObj.label.toLowerCase())
      );
      if (sentencesForLang.some(s => s.id === sentenceId)) {
        setTargetSentenceId(sentenceId);
        setRevealedTokens(null);
        setShowTranslations(true);
      }
      setTargetSentenceInfo(null);
      return;
    }

    if (highlightWord) {
      setTargetSentenceInfo(null);
      const wordEntry = words.find(w => getWordTranslation(w, langCode) === highlightWord);
      void generateSentences(langCode, 1, { lemma: highlightWord, translation: wordEntry?.ru });
      return;
    }

    setTargetSentenceInfo(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused, targetSentenceInfo, sentences, selectedLanguageCode]);

  // When a fresh session batch replaces the cached view before the learner has
  // started interacting (or on any set change that leaves the index out of range),
  // jump back to the first sentence.
  const showingSessionBatch = sessionGenerated.length > 0;
  const prevShowingSessionBatch = useRef(showingSessionBatch);
  useEffect(() => {
    if ((showingSessionBatch && !prevShowingSessionBatch.current && !lockedWorkoutIds.current) || currentFilteredIndex >= workoutSentences.length) {
      setCurrentFilteredIndex(0);
    }
    prevShowingSessionBatch.current = showingSessionBatch;
  }, [showingSessionBatch, workoutSentences.length, currentFilteredIndex]);

  const safeIndex = currentFilteredIndex < workoutSentences.length ? currentFilteredIndex : 0;
  const currentSentence = (targetSentenceId ? allSentencesForLanguage.find(sentence => sentence.id === targetSentenceId) : undefined) ?? workoutSentences[safeIndex];
  const analysisPresentation = useRef<{ sentence: Sentence; id: string } | null>(null);
  useEffect(() => { analysisPresentation.current = null; }, [currentSentence]);
  const recordCompletedAnalysis = () => {
    if (!currentSentence) return;
    if (analysisPresentation.current?.sentence !== currentSentence) {
      analysisPresentation.current = { sentence: currentSentence, id: `analysis-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    useStore.getState().recordSentenceAnalysis(currentSentence, analysisPresentation.current.id);
  };
  const noteSource: NoteSource | undefined = currentSentence ? {
    sentenceId: currentSentence.id, text: currentSentence.sentence,
    translation: currentSentence.literalTranslation,
  } : undefined;

  const transition = useCardTransition({
    enabled: isFocused && !showAiModal && !editor.isModalVisible && !isWordModalVisible && !isMenuVisible && !workoutCompleteModalVisible,
    scope: selectedLanguageCode, cardKey: currentSentence?.id || '',
    onSwipe: direction => direction === 'left' ? moveToNextSentence() : moveToPrevSentence(),
    distance: SWIPE_EXIT_DISTANCE, entryOffset: SWIPE_ENTRY_OFFSET, duration: 200,
  });
  const cardTranslateX = transition.translateX;
  const isSwipeAnimating = transition.busy;
  const animateSwipe = transition.animate;
  const resetCardPosition = transition.reset;

  // Edits keep the ID, but invalidate cached explanations and revealed answers too.
  useEffect(() => {
    explanationController.current?.abort();
    explanationRequest.current++;
    setAiExplanation(null);
    setIsAiLoading(false);
    setShowAiModal(false);
    setRevealedTokens(targetSentenceId ? null : new Set());
  }, [currentSentence, targetSentenceId]);

  const startNextWorkout = () => {
    analysisPresentation.current = null;
    setWorkoutCompleteModalVisible(false);
    setTargetSentenceId(null);
    const seen = new Set(seenIdsByLang.current[selectedLanguageCode] ?? []);
    for (const sentence of workoutSentences) seen.add(sentence.id);
    if (filteredSentences.every(sentence => seen.has(sentence.id))) {
      seen.clear();
    }
    seenIdsByLang.current[selectedLanguageCode] = seen;
    lockedWorkoutIds.current = null;
    setWorkoutOffset(prev => prev + sentenceWorkoutCount);
    setCurrentFilteredIndex(0);
    setRevealedTokens(new Set());
    setShowTranslations(false);
    setAiExplanation(null);
    if (isSentenceGenerationConfigured()) {
      void generateSentences(selectedLanguageCode, generationBatchSize);
    }
  };

  const restartCurrentWorkout = () => {
    analysisPresentation.current = null;
    setWorkoutCompleteModalVisible(false);
    setTargetSentenceId(null);
    setCurrentFilteredIndex(0);
    setRevealedTokens(new Set());
    setShowTranslations(false);
    setAiExplanation(null);
  };

  const moveToNextSentence = () => {
    if (!transition.beginAction()) return;
    analysisPresentation.current = null;
    if (!lockedWorkoutIds.current && workoutSentences.length > 0) {
      lockedWorkoutIds.current = workoutSentences.map(sentence => sentence.id);
    }
    setTargetSentenceId(null);
    if (workoutSentences.length <= 1) {
      setRevealedTokens(new Set());
      setShowTranslations(false);
      setAiExplanation(null);
      setWorkoutCompleteModalVisible(true);
      return;
    }

    const position = workoutSentences.findIndex(sentence => sentence.id === currentSentence?.id);
    if (position >= workoutSentences.length - 1) {
      setWorkoutCompleteModalVisible(true);
      return;
    }

    const nextIdx = position + 1;
    setCurrentFilteredIndex(nextIdx);
    setRevealedTokens(new Set());
    setShowTranslations(false);
    setAiExplanation(null);
  };

  const moveToPrevSentence = () => {
    if (!transition.beginAction()) return;
    analysisPresentation.current = null;
    setTargetSentenceId(null);
    if (workoutSentences.length <= 1) {
      setRevealedTokens(new Set());
      setShowTranslations(false);
      setAiExplanation(null);
      return;
    }

    const position = workoutSentences.findIndex(sentence => sentence.id === currentSentence?.id);
    const prevIdx = Math.max(0, position - 1);
    setCurrentFilteredIndex(prevIdx);
    setRevealedTokens(new Set());
    setShowTranslations(false);
    setAiExplanation(null);
  };


  // Memoized O(1) word lookup map by normalized dictionary forms.
  // Replaces linear O(N) full-dictionary scanning on every token render.
  const wordLookupMap = useMemo(() => buildWordLookup(words, selectedLanguageCode), [words, selectedLanguageCode]);

  // Does a word matching this token already live in the user's dictionary?
  const findWordInStore = useCallback((token: Token): Word | undefined => {
    const rawForm = token.dictionary_form || token.dictionary_word || token.text;
    const cleanForm = cleanDictionaryForm(rawForm || '').toLowerCase();
    return cleanForm ? wordLookupMap.get(cleanForm) : undefined;
  }, [wordLookupMap]);

  // Progress updates rebuild the word lookup. Remember the displayed card before
  // writing, so that our own update cannot schedule another show indefinitely.
  // A mounted screen under another tab/stack screen is not a new presentation.
  const countedPresentation = useRef<string | null>(null);
  useEffect(() => {
    if (!isFocused) {
      countedPresentation.current = null;
      return;
    }
    if (!currentSentence?.words) {
      countedPresentation.current = null;
      return;
    }
    const presentation = JSON.stringify([currentSentence.id, selectedLanguageCode]);
    if (countedPresentation.current === presentation) return;
    const matchedKeys: string[] = [];
    currentSentence.words.forEach(token => {
      const match = findWordInStore(token);
      const key = match?.eng || match?.word || '';
      if (key && !matchedKeys.includes(key)) {
        matchedKeys.push(key);
      }
    });
    if (!matchedKeys.length) {
      countedPresentation.current = presentation;
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      if (isMounted.current) {
        countedPresentation.current = presentation;
        incrementShowCounts(matchedKeys, selectedLanguageCode);
      }
    });
    return () => task.cancel();
  }, [isFocused, currentSentence?.id, selectedLanguageCode, findWordInStore, incrementShowCounts]);

  useEffect(() => { setIsWordModalVisible(false); }, [currentSentence?.id, selectedLanguageCode, isFocused]);

  const handleTokenPress = (token: Token) => {
    if (!currentSentence) return;
    setNoteToken(token.text);
    const rawForm = token.dictionary_form || token.dictionary_word || token.text;
    const cleanForm = cleanDictionaryForm(rawForm || '');
    if (!cleanForm) return;

    const existing = findWordInStore(token);

    if (existing) {
      setEditingWord(existing);
    } else {
      const stableKey = `user:${selectedLanguageCode}:${cleanForm.toLowerCase()}`;
      const draftWord: Word = {
        id: `custom_${Date.now().toString()}`,
        eng: stableKey,
        word: cleanForm,
        ru: token.translation?.trim() || '',
        translations: { [selectedLanguageCode]: cleanForm },
        source_language: selectedLanguageCode,
        count: 0,
        is_learned: 0,
        knowledge_stats: {},
        show_stats: {},
        personal_association: '',
        is_favorite: false
      };
      setEditingWord(draftWord);
    }
    setWordFormContext({
      sentence: currentSentence.sentence,
      language: LANGUAGES.find(language => language.code === selectedLanguageCode)?.label || selectedLanguageCode,
      token: { ...token, parts: getTokenFormParts(token, selectedLanguageCode) },
    });
    setIsWordModalVisible(true);
  };

  const orderedGroups = React.useMemo(
    () => computeSentenceRevealGroups(currentSentence?.words),
    [currentSentence]
  );

  // Step badge numbers per group. Tokens belonging to the same syntactic unit
  // (e.g. an article and its noun) share the same step number so the breakdown
  // reads as coherent steps of the sentence basis and its additions.
  const tokenBadgeNumbers = React.useMemo(() => {
    const map = new Map<number, number>();
    const clauseCounters = new Map<number, number>();
    orderedGroups.forEach(group => {
      const next = (clauseCounters.get(group.clauseIndex) || 0) + 1;
      clauseCounters.set(group.clauseIndex, next);
      group.tokenIndices.forEach(ti => {
        map.set(ti, next);
      });
    });
    return map;
  }, [orderedGroups]);

  const totalExerciseSteps = orderedGroups.length || (currentSentence?.words.length ?? 0);
  const revealedExerciseSteps = revealedTokens === null
    ? totalExerciseSteps
    : orderedGroups.filter(group => group.tokenIndices.some(ti => revealedTokens.has(ti))).length;

  const revealBlock = (index: number) => {
    if (!currentSentence) return;
    LayoutAnimation.configureNext(REVEAL_ANIMATION);
    const indices = tokenRevealIndices(currentSentence.words, index);
    const next = revealedTokens === null ? null : new Set([...revealedTokens, ...indices]);
    setRevealedTokens(next);
    if (next === null || currentSentence.words.every((_, i) => next.has(i))) recordCompletedAnalysis();
  };

  const allBlocksRevealed = !!currentSentence?.words.length &&
    (revealedTokens === null || currentSentence.words.every((_, index) => revealedTokens.has(index)));

  // Button and background taps share the sequence: role-groups, translation, restart.
  const handleReveal = () => {
    if (!currentSentence) return;
    LayoutAnimation.configureNext(REVEAL_ANIMATION);
    const nextGroup = orderedGroups.find(group => group.tokenIndices.some(index => !revealedTokens?.has(index)));
    if (allBlocksRevealed) {
      if (!showTranslations) {
        recordCompletedAnalysis();
        setShowTranslations(true);
      } else {
        analysisPresentation.current = null;
        setRevealedTokens(new Set());
        setShowTranslations(false);
      }
    } else if (nextGroup) {
      const next = new Set([...(revealedTokens ?? []), ...nextGroup.tokenIndices]);
      setRevealedTokens(next);
      if (currentSentence.words.every((_, i) => next.has(i))) recordCompletedAnalysis();
    }
  };

  const handleExplainAI = async () => {
    if (!currentSentence) return;

    // Check if we already have an explanation to avoid refetching
    if (aiExplanation) {
      explanationController.current = new AbortController();
      setShowAiModal(true);
      return;
    }

    const sentenceText = currentSentence.sentence || currentSentence.words.map(w => w.text).join(' ');
    const nativeTranslation = currentSentence.literalTranslation || currentSentence.words.map(w => w.translation).filter(Boolean).join(' ');

    setIsAiLoading(true);
    setShowAiModal(true);
    const requestId = ++explanationRequest.current;
    try {
      explanationController.current?.abort();
      explanationController.current = new AbortController();
      const sourceLanguage = activeLangObj?.label || 'Unknown';
      setAiBookLanguage(sourceLanguage);
      setAiBookPassages(selectBookPassages(sourceLanguage, sentenceText, currentSentence.words));
      const result = await explainSentenceWithAI(sentenceText, sourceLanguage, nativeTranslation, currentSentence.words, explanationController.current.signal, 'summary');
      if (requestId === explanationRequest.current) setAiExplanation(result);
    } catch (error) {
      if (requestId !== explanationRequest.current) return;
      Alert.alert('Не удалось объяснить', error instanceof Error ? error.message : 'Попробуйте ещё раз.');
      setShowAiModal(false);
    } finally {
      if (requestId === explanationRequest.current) setIsAiLoading(false);
    }
  };

  const tokenKey = (token: Token) => `${selectedLanguageCode}:${(token.dictionary_form || token.dictionary_word || token.text).toLocaleLowerCase()}`;

  const handleAddTokenToDictionary = (token: Token) => {
    const key = tokenKey(token);
    if (token.is_in_my_dict || addedTokenKeys.has(key)) return;

    const added = addWordFromSentenceToken({ ...token, translation: formatTokenTranslation(token) }, selectedLanguageCode);
    setAddedTokenKeys(previous => new Set([...previous, key]));
    Alert.alert(
      added ? 'Добавлено в словарь' : 'Уже в словаре',
      added
        ? `Слово «${token.dictionary_form || token.text}» добавлено. Его перевод можно отредактировать в словаре.`
        : `Слово «${token.dictionary_form || token.text}» уже есть в словаре.`
    );
  };

  const renderDictionaryAction = (token: Token, inline = false) => {
    const added = token.is_in_my_dict || addedTokenKeys.has(tokenKey(token)) || Boolean(findWordInStore(token));
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${added ? 'Слово уже в словаре' : 'Добавить в словарь'}: ${token.text}`}
        style={[styles.addToDictionaryBtn, inline && styles.tableDictionaryButton, added && styles.addToDictionaryBtnAdded]}
        disabled={added}
        onPress={(event) => {
          event.stopPropagation();
          handleAddTokenToDictionary(token);
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={[styles.addToDictionaryText, added && styles.addToDictionaryTextAdded]}>
          {added ? '✓' : '+'}
        </Text>
      </TouchableOpacity>
    );
  };

  // Both layouts share the same card and clause frame, so reveal behavior and
  // the method's visual cues cannot drift between cards and table rows.
  const renderTokenCard = (token: Token, index: number, compact = false) => {
    const formSegments = getTokenFormSegments(token, selectedLanguageCode);
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const group = groupIndex >= 0 ? orderedGroups[groupIndex] : undefined;
    const isRevealed = revealedTokens === null || revealedTokens.has(index);
    // In a complex (multi-clause) sentence, wrap words of the 2nd+ clause in a
    // second colored frame so the clause boundary reads at a glance.
    // Keep the frame visible on hidden blocks too: it is part of the exercise.
    const clauseIndex = groupIndex >= 0 ? (orderedGroups[groupIndex]?.clauseIndex ?? 0) : 0;
    const secondaryClause = clauseIndex >= 1;
    const badgeNumber = tokenBadgeNumbers.get(index) ?? (groupIndex >= 0 ? groupIndex + 1 : 1);
    const effectiveRole = (token.role === 'Article' && group) ? group.role : token.role;
    const roleColor = getRoleColor(effectiveRole);

    // Hidden and revealed blocks share their measured content. Revealing a word
    // changes its visibility, never the surrounding layout or reading position.
    const card = (
        <TouchableOpacity
          testID={`trainer-block-${index}`}
          accessibilityRole="button"
          accessibilityLabel={isRevealed ? `Объяснить форму слова: ${token.text}` : `Раскрыть блок ${index + 1}`}
          accessibilityHint={isRevealed ? 'Удерживайте, чтобы создать заметку к слову' : undefined}
          activeOpacity={0.85}
          onPress={event => { event.stopPropagation(); isRevealed ? handleTokenPress(token) : revealBlock(index); }}
          onLongPress={isRevealed ? () => noteSource && navigation.push('NoteEditor', { language: selectedLanguageCode, source: { ...noteSource, token: token.text } }) : undefined}
          style={[styles.wordCard, { borderColor: isRevealed ? roleColor : UI.border },
            compact && { minWidth: 0, paddingVertical: 8, paddingHorizontal: 12 },
            !isRevealed && styles.hiddenCard]}
        >
          {isRevealed && <View style={[styles.orderBadge, { backgroundColor: roleColor }]}>
            <Text style={styles.orderBadgeText}>{badgeNumber}</Text>
          </View>}
          <View aria-hidden={!isRevealed} accessibilityElementsHidden={!isRevealed}
            importantForAccessibility={isRevealed ? 'auto' : 'no-hide-descendants'}
            pointerEvents="none" style={{ opacity: isRevealed ? 1 : 0 }}>
            <Text style={styles.wordText}>
              {formSegments.map((part, i) => <Text key={i} style={part.affixIndex === null ? styles.wordRoot : [styles.wordAffix, { color: AFFIX_COLORS[part.affixIndex % AFFIX_COLORS.length] }]}>
                {part.text}
              </Text>)}
            </Text>
            {!compact && <>
              <Text aria-hidden={!showTranslations} numberOfLines={2} ellipsizeMode="tail" style={[styles.translationText, { opacity: showTranslations ? 1 : 0 }]}>{formatTokenTranslation(token)}</Text>
              <Text style={[styles.roleText, { color: roleColor }]}>{ROLE_TRANSLATIONS[token.role] || token.role.replace('_', ' ')}</Text>
            </>}
          </View>
          {!isRevealed && <View style={styles.hiddenMark} />}
          {isRevealed && !compact && renderDictionaryAction(token)}
        </TouchableOpacity>
    );

    return secondaryClause ? (
      <View style={[styles.clauseFrame, { borderColor: isRevealed ? roleColor : '#94A3B8' }]}>{card}</View>
    ) : card;
  };

  const renderToken = (token: Token, index: number) => (
    <View key={`${index}-${token.text}`} style={styles.tokenContainer}>{renderTokenCard(token, index)}</View>
  );

  const renderTokenTableMode = (token: Token, index: number) => {
    const isRevealed = revealedTokens === null || revealedTokens.has(index);
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const group = groupIndex >= 0 ? orderedGroups[groupIndex] : undefined;
    const effectiveRole = (token.role === 'Article' && group) ? group.role : token.role;
    const roleColor = getRoleColor(effectiveRole);

    return (
      <View key={`${index}-${token.text}`} style={styles.tableRow}>
        <View style={styles.tableColWord}>
          {renderTokenCard(token, index, true)}
        </View>

        <View style={styles.tableColTrans}>
          {isRevealed && showTranslations && (
            <Text style={[styles.translationText, { marginTop: 0 }]}>{formatTokenTranslation(token)}</Text>
          )}
        </View>

        <View style={styles.tableColRole}>
          {isRevealed && (
            <View testID={`trainer-role-${index}`} style={styles.tableRoleActions}>
              <Text style={[styles.roleText, { color: roleColor, marginTop: 0, maxWidth: '100%', textAlign: 'right' }]}>
                {ROLE_TRANSLATIONS[token.role] || token.role.replace('_', ' ')}
              </Text>
              {renderDictionaryAction(token, true)}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {onLessons && <TouchableOpacity accessibilityRole="button" onPress={onLessons} style={{ paddingVertical: 10 }}>
        <Text style={{ color: ACCENT_DARK, fontWeight: '600' }}>Вернуться к занятию</Text>
      </TouchableOpacity>}
      <View style={styles.headingRow}>
        <Text style={styles.header}>Разбор предложений</Text>
        <TouchableOpacity
          testID="trainer-workshop-header"
          accessibilityRole="button"
          accessibilityLabel="Тренировка: от короткого к полному"
          style={styles.optionsButton}
          onPress={() => navigation.navigate('SentenceWorkshop', { language: selectedLanguageCode })}
        >
          <Ionicons name="layers-outline" size={21} color={ACCENT_DARK} />
        </TouchableOpacity>
        <TouchableOpacity testID="trainer-notes" accessibilityRole="button" accessibilityLabel="Мои заметки"
          style={styles.optionsButton} onPress={() => navigation.navigate('Notes', {
            language: selectedLanguageCode, source: noteSource, contextOnly: !!noteSource,
          })}>
          <Ionicons name="document-text-outline" size={21} color={ACCENT_DARK} />
        </TouchableOpacity>
          <TouchableOpacity
            style={styles.optionsButton}
            testID="sentence-options" accessibilityLabel="Действия с предложением" accessibilityRole="button"
            onPress={() => setIsMenuVisible(true)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#475569" />
          </TouchableOpacity>
      </View>

      {/* Language Selector */}
      <View style={styles.languageToolbar}>
        <ScrollView style={{ flex: 1 }} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center'}}>
          {LANGUAGES.filter(lang => activeLanguages.includes(lang.code)).map(lang => (
            <TouchableOpacity
              key={lang.code}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedLanguageCode === lang.code }}
              style={[
                styles.langSelectBtn,
                selectedLanguageCode === lang.code && styles.langSelectBtnActive
              ]}
              onPress={() => {
                setSelectedLanguageCode(lang.code);
                setCurrentFilteredIndex(0);
                setRevealedTokens(new Set());
                setShowTranslations(false);
                setGenerationErrors(previous => {
                  if (!previous[lang.code]) return previous;
                  const updated = { ...previous };
                  delete updated[lang.code];
                  return updated;
                });
              }}
            >
              <Text style={[
                styles.langSelectText,
                selectedLanguageCode === lang.code && {color: ACCENT_DARK, fontWeight: '700'}
              ]}>
                {lang.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {filteredSentences.length > 0 ? (
        <Animated.View
          style={{
            flex: 1,
            transform: [{ translateX: cardTranslateX }],
            opacity: cardTranslateX.interpolate({
              inputRange: [-SWIPE_EXIT_DISTANCE, -SWIPE_EXIT_DISTANCE / 2, 0, SWIPE_EXIT_DISTANCE / 2, SWIPE_EXIT_DISTANCE],
              outputRange: [0.2, 0.85, 1, 0.85, 0.2],
              extrapolate: 'clamp',
            }),
          }}
        >
          <ScrollView
            {...sentencePanResponder.panHandlers}
            style={{flex: 1}}
            contentContainerStyle={styles.exerciseContent}
          >
            <Pressable testID="trainer-step-surface" accessible={false} style={{ flex: 1, paddingBottom: 32 }} onPress={handleReveal}>
              <View style={styles.sentenceSurface}>
                <View style={styles.sentenceMeta}>
                  <Text testID="trainer-position" style={styles.positionText}>{targetSentenceId ? 'Из словаря' : `${safeIndex + 1} / ${workoutSentences.length}`}</Text>
                </View>
                <Text testID="trainer-sentence-text" style={styles.sentenceText}>
                  {currentSentence?.sentence || currentSentence?.words.map(word => word.text).join(' ')}
                </Text>
                {showTranslations && currentSentence?.literalTranslation && <Text style={styles.sentenceTranslation}>{currentSentence.literalTranslation}</Text>}
              </View>

              <View style={styles.exerciseHeading}>
                <Text style={styles.exerciseLabel}>Разбор по шагам</Text>
                <Text style={styles.exerciseProgress}>{revealedExerciseSteps} / {totalExerciseSteps}</Text>
              </View>
              <View style={isTableMode ? styles.tableContainer : styles.sentenceWrapper}>
                {isTableMode
                  ? currentSentence?.words?.map(renderTokenTableMode)
                  : currentSentence?.words?.map(renderToken)
                }
              </View>
              <View style={styles.explanationRow}>
                {currentSentence && isSentenceGenerationConfigured() && (
                  <TouchableOpacity
                    testID="trainer-ai-explain" accessibilityRole="button" accessibilityLabel="Объяснить структуру"
                    onPress={handleExplainAI}
                    disabled={isAiLoading}
                    style={styles.aiButton}
                  >
                    {isAiLoading ? (
                      <ActivityIndicator size="small" color={ACCENT_DARK} />
                    ) : (
                      <>
                        <Ionicons name="sparkles" size={16} color="#EAB308" style={{marginRight: 8}} />
                        <Text style={styles.aiButtonText}>Объяснить структуру</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}

              </View>
            </Pressable>
          </ScrollView>
        </Animated.View>
      ) : (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24}}>
          {isGenerating ? (
            <>
              <ActivityIndicator size="large" color={ACCENT_DARK} />
            </>
          ) : (
            <>
              <Ionicons name="alert-circle-outline" size={44} color="#94A3B8" style={{ marginBottom: 12 }} />
              <Text style={styles.generationStatus}>
                {generationError || `Для языка «${activeLangObj?.label}» пока нет предложений.`}
              </Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => void generateSentences(selectedLanguageCode, generationBatchSize)}
              >
                <Ionicons name="sparkles" size={18} color={UI.onAccent} style={{ marginRight: 8 }} />
                <Text style={styles.retryButtonText}>Сгенерировать предложения</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity
          testID="trainer-previous"
          accessibilityRole="button"
          accessibilityLabel="Предыдущее предложение"
          disabled={workoutSentences.length < 2 || safeIndex === 0}
          onPress={moveToPrevSentence}
          style={[styles.navigationButton, (workoutSentences.length < 2 || safeIndex === 0) && styles.disabledButton]}
        >
          <Ionicons name="chevron-back" size={20} color={ACCENT_DARK} />
        </TouchableOpacity>
        <TouchableOpacity
          testID="trainer-reveal"
          accessibilityRole="button"
          disabled={!currentSentence}
          style={styles.button}
          onPress={handleReveal}
        >
          <Text style={styles.buttonText}>{allBlocksRevealed ? (showTranslations ? 'Повторить с 1 шага' : 'Перевод') : 'Разбор'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="trainer-next"
          accessibilityRole="button"
          accessibilityLabel={safeIndex >= workoutSentences.length - 1 ? 'Завершить тренировку' : 'Следующее предложение'}
          disabled={workoutSentences.length === 0}
          onPress={moveToNextSentence}
          style={[styles.navigationButton, workoutSentences.length === 0 && styles.disabledButton]}
        >
          <Ionicons
            name={safeIndex >= workoutSentences.length - 1 ? 'checkmark-circle-outline' : 'chevron-forward'}
            size={20}
            color={ACCENT_DARK}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        testID="trainer-next-workout"
        accessibilityRole="button"
        disabled={workoutSentences.length === 0}
        style={[styles.secondaryButton, { marginTop: 8 }, workoutSentences.length === 0 && styles.disabledButton]}
        onPress={startNextWorkout}
      >
        <Text style={styles.secondaryButtonText}>Следующий тур</Text>
      </TouchableOpacity>

      {/* Options Menu Modal */}
      <Modal visible={isMenuVisible} transparent={true} animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={event => event.stopPropagation()} style={styles.menuCard}>
            <ScrollView>
            <Text style={styles.menuHeading}>Практика и материалы</Text>
            <TouchableOpacity accessibilityRole="button" style={styles.menuItem} onPress={() => { setIsMenuVisible(false); startNextWorkout(); }}>
              <Ionicons name="refresh" size={20} color="#475569" style={{ marginRight: 10 }} />
              <Text style={styles.menuItemText}>Новая тренировка предложений</Text>
            </TouchableOpacity>

            <View testID="trainer-cache-stats" style={styles.menuStats}>
              <Text style={styles.menuStatsTitle}>{activeLangObj?.label} · предложения</Text>
              <Text style={styles.menuStatsText}>В кеше: {languageCache.length}</Text>
              <Text style={styles.menuStatsText}>Создано за сеанс: {createdThisSession}</Text>
              <Text style={styles.menuStatsText}>В очереди разбора: {filteredSentences.length}</Text>
              <Text style={styles.menuStatsText}>В тренировке: {workoutSentences.length}</Text>
              <Text style={styles.menuStatsText}>Кеш всех языков: {cachedSentences.length}</Text>
            </View>
            {isGenerating && <View style={styles.menuStats}>
              <Text style={styles.menuStatsText}>{generationPhase || 'Подготавливаем новые предложения…'}</Text>
              <TouchableOpacity accessibilityRole="button" testID="trainer-cancel-generation" onPress={cancelGeneration} style={styles.menuItem}>
                <Text style={[styles.menuItemText, { color: '#DC2626' }]}>Отменить генерацию</Text>
              </TouchableOpacity>
            </View>}
            {!!generationError && !isGenerating && <View style={styles.menuStats}>
              <Text style={styles.menuStatsText}>{generationError}</Text>
            </View>}
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => { setIsTableMode(!isTableMode); setIsMenuVisible(false); }}
            >
              <Ionicons name="list" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Режим: {isTableMode ? 'Карточки' : 'Таблица'}</Text>
            </TouchableOpacity>

            {isSentenceGenerationConfigured() && (
              <>
                <View style={{height: 1, backgroundColor: '#E2E8F0', marginVertical: 5}} />

                <TouchableOpacity
                  accessibilityRole="button" disabled={isGenerating}
                  style={styles.menuItem}
                  onPress={() => {
                    setIsMenuVisible(false);
                    void generateSentences(selectedLanguageCode, generationBatchSize);
                  }}
                >
                  <Ionicons name="sparkles" size={20} color={ACCENT_DARK} style={{marginRight: 10}} />
                  <Text style={styles.menuItemText}>Сгенерировать ещё (ИИ)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.menuItem}
                  onPress={() => {
                    setIsMenuVisible(false);
                    Alert.alert(
                      'Очистить сгенерированные?',
                      `Удалить все предложения от ИИ для языка «${activeLangObj?.label}» и сгенерировать новую подборку.`,
                      [
                        { text: 'Отмена', style: 'cancel' },
                        {
                          text: 'Очистить',
                          style: 'destructive',
                          onPress: () => {
                            clearGeneratedSentences(activeLangObj?.label);
                            seenIdsByLang.current[selectedLanguageCode]?.clear();
                            lockedWorkoutIds.current = null;
                            setWorkoutOffset(0);
                            generatingLanguages.current.delete(selectedLanguageCode);
                            setCurrentFilteredIndex(0);
                            void generateSentences(selectedLanguageCode, generationBatchSize);
                          }
                        }
                      ]
                    );
                  }}
                >
                  <Ionicons name="refresh" size={20} color="#DC2626" style={{marginRight: 10}} />
                  <Text style={styles.menuItemText}>Очистить и сгенерировать заново</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setIsMenuVisible(false); editor.openEditModal(currentSentence); }}
            >
              <Ionicons name="pencil" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Изменить</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setIsMenuVisible(false); editor.openAddModal(); }}
            >
              <Ionicons name="add" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Добавить</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Закрыть меню" style={styles.menuItem} onPress={() => setIsMenuVisible(false)}>
              <Text style={styles.navigationText}>Закрыть</Text>
            </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <SentenceEditorModal editor={editor} />

      {/* Workout Completion Modal */}
      <Modal visible={workoutCompleteModalVisible} transparent animationType="fade" onRequestClose={() => setWorkoutCompleteModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.workoutResultCard}>
            <Ionicons name="checkmark-circle" size={48} color={ACCENT_DARK} style={{ alignSelf: 'center', marginBottom: 12 }} />
            <Text style={styles.workoutResultTitle}>Тренировка завершена!</Text>
            <Text style={styles.workoutResultText}>Разобрано предложений: {workoutSentences.length}</Text>
            <TouchableOpacity accessibilityRole="button" style={[styles.button, { marginTop: 16, width: '100%' }]} onPress={startNextWorkout}>
              <Text style={styles.buttonText}>Следующая тренировка</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={[styles.secondaryButton, { marginTop: 8 }]} onPress={restartCurrentWorkout}>
              <Text style={styles.secondaryButtonText}>Повторить эту тренировку</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={[styles.closeModalButton, { marginTop: 6 }]} onPress={() => setWorkoutCompleteModalVisible(false)}>
              <Text style={styles.closeModalButtonText}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* AI Explanation Modal */}
      <Modal visible={showAiModal} animationType="fade" transparent={true} onRequestClose={closeExplanation}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View testID="sentence-explanation-modal" style={[styles.modalCard, {maxHeight: '80%'}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0}}>
                <Text style={[styles.modalHeader, {marginBottom: 0, flexShrink: 1}]}>Как устроена фраза</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Закрыть объяснение" onPress={closeExplanation} style={{padding: 5}}>
                <Text style={{fontSize: 20, color: '#94A3B8'}}>✕</Text>
              </TouchableOpacity>
            </View>

            {showAiModal && <SentenceDiscussion key={`${currentSentence.id}:${aiExplanation}`} enabled={!isAiLoading && !!aiExplanation}
              context={{ sentence: currentSentence.sentence || currentSentence.words.map(w => w.text).join(' '),
                language: aiBookLanguage, translation: currentSentence.literalTranslation || currentSentence.words.map(w => w.translation).filter(Boolean).join(' '),
                tokens: currentSentence.words, explanation: aiExplanation || '' }} markdownStyle={markdownStyles}>
              {isAiLoading ? (
                <View style={{padding: 40, alignItems: 'center'}}>
                  <ActivityIndicator size="large" color={ACCENT} />
                  <Text style={{marginTop: 15, color: '#64748B'}}>Разбираем фразу…</Text>
                </View>
              ) : (
                <>
                  <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>Пояснение ИИ · с опорой на вашу книгу</Text>
                  <SentenceExplanation key={aiExplanation} text={aiExplanation || ''} style={markdownStyles}
                    loadDetails={() => explainSentenceWithAI(
                      currentSentence.sentence || currentSentence.words.map(w => w.text).join(' '),
                      aiBookLanguage,
                      currentSentence.literalTranslation || currentSentence.words.map(w => w.translation).filter(Boolean).join(' '),
                      currentSentence.words, explanationController.current?.signal, 'details'
                    )} onLinkPress={(url: string) => {
                    const location = parseBookURL(url);
                    if (location && aiBookPassages.some(p => p.chapterId === location.chapterId && p.blockId === location.blockId)) {
                      closeExplanation();
                      navigation.push('Book', location);
                    }
                    return false;
                  }} />
                  <BookConnections language={aiBookLanguage} passages={aiBookPassages} onOpen={(location: BookLocation) => { closeExplanation(); navigation.push('Book', location); }} />
                  {noteSource && !!aiExplanation && <TouchableOpacity accessibilityRole="button" testID="explanation-create-note" style={styles.aiButton}
                    onPress={() => {
                      const initialBody = aiExplanation.split(/^\s*(?:#{1,4}\s*)?(?:\*\*)?Подробности/m)[0].trim();
                      closeExplanation();
                      navigation.push('NoteEditor', { language: selectedLanguageCode, source: noteSource, initialBody });
                    }}>
                    <Ionicons name="document-text-outline" size={18} color={ACCENT_DARK} style={{ marginRight: 8 }} />
                    <Text style={styles.aiButtonText}>Сохранить мысль в заметки</Text>
                  </TouchableOpacity>}
                </>
              )}
            </SentenceDiscussion>}

            <View style={{marginTop: 15, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0'}}>
              <Text style={{fontSize: 12, color: '#94A3B8', textAlign: 'center'}}>Сгенерировано нейросетью. Возможны неточности.</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {isWordModalVisible && wordFormContext && editingWord && <WordFormModal
        context={wordFormContext}
        onClose={() => setIsWordModalVisible(false)}
        word={editingWord}
        onCreateNote={noteSource ? () => {
          setIsWordModalVisible(false);
          navigation.push('NoteEditor', { language: selectedLanguageCode, source: { ...noteSource, token: noteToken } });
        } : undefined}
      />}
    </View>
  );
}

const styles = StyleSheet.create({
  sentenceSurface: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5E8EC', borderRadius: UI.radius, padding: 16 },
  sentenceMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  exerciseContent: { flexGrow: 1, paddingBottom: 16 },
  sentenceText: { fontSize: 22, lineHeight: 32, color: '#172033' },
  sentenceTranslation: { ...UI.reading, color: UI.muted, marginTop: 14 },
  exerciseHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 22, gap: 8 },
  exerciseLabel: { fontSize: 16, fontWeight: '700', color: '#344054' },
  exerciseProgress: { fontSize: 12, color: '#697586' },
  explanationRow: { alignItems: 'flex-start', marginTop: 12 },
  menuHeading: { fontSize: 18, fontWeight: '700', color: '#172033', padding: 15 },
  container: { flex: 1, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: UI.canvas },
  header: { flex: 1, ...UI.heading, color: UI.text },
  languageToolbar: { minHeight: 48, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E4E7EC' },
  sentenceWrapper: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 4, rowGap: 10, paddingTop: 12, paddingBottom: 10 },
  tokenContainer: { maxWidth: '100%' },
  hiddenCard: { backgroundColor: UI.subtle },
  hiddenMark: { position: 'absolute', alignSelf: 'center', top: '50%', width: 16, height: 3, borderRadius: 2, backgroundColor: '#AAB3BE' },
  wordCard: { minHeight: 68, justifyContent: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingTop: 14, paddingBottom: 10, borderRadius: 10, borderWidth: 1, alignItems: 'flex-start', minWidth: 88, maxWidth: '100%' },
  // Outer ring for words of a 2nd+ clause in a complex sentence — reads as a double frame.
  clauseFrame: { borderWidth: 2, borderRadius: 13, padding: 3, alignSelf: 'flex-start', maxWidth: '100%' },
  orderBadge: { position: 'absolute', top: -7, right: 8, width: 16, height: 16, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  orderBadgeText: { color: '#FFF', fontSize: 10, fontWeight: '700' },
  wordText: { fontSize: 18, lineHeight: 26, fontWeight: '600', flexShrink: 1 },
  wordRoot: { fontWeight: '600', color: '#111827' },
  wordAffix: { fontWeight: '800' },
  translationText: { fontSize: 14, color: '#666', marginTop: 4, maxWidth: 200 },
  roleText: { fontSize: 13, lineHeight: 19, fontWeight: '500', marginTop: 5 },
  addToDictionaryBtn: { position: 'absolute', bottom: -6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, alignItems: 'center', justifyContent: 'center', zIndex: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 1, elevation: 2 },
  addToDictionaryBtnAdded: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  addToDictionaryText: { fontSize: 14, color: ACCENT_DARK, fontWeight: '800', lineHeight: 16 },
  addToDictionaryTextAdded: { color: '#15803D' },
  controls: { flexDirection: 'row', alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E7E9EC', gap: 10 },
  button: { minHeight: 48, flex: 1, backgroundColor: ACCENT, padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navigationButton: { width: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: UI.subtle, borderRadius: 10 },
  navigationText: { color: ACCENT_DARK, fontSize: 14, fontWeight: '700' },
  positionText: { color: '#697586', fontSize: 12, fontWeight: '600' },
  disabledButton: { opacity: 0.4 },
  optionsButton: { marginLeft: 8, width: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: UI.onAccent, fontWeight: '600', fontSize: 15, textAlign: 'center' },

  // Table Mode Styles
  tableContainer: { width: '100%', marginTop: 20, backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', paddingBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', padding: 10 },
  tableColWord: { flex: 2, alignItems: 'flex-start' },
  tableColTrans: { flex: 2, paddingHorizontal: 10 },
  tableColRole: { flex: 1.5, alignItems: 'flex-end' },
  tableRoleActions: { alignSelf: 'stretch', alignItems: 'flex-end' },
  tableDictionaryButton: { position: 'relative', bottom: 0, right: 0, marginTop: 8, width: 32, height: 32, borderRadius: 16 },

  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#1E293B' },

  menuCard: { width: '100%', maxWidth: 360, maxHeight: '85%', backgroundColor: '#FFF', borderRadius: 16, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  menuStats: { padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  menuStatsTitle: { color: '#1E293B', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  menuStatsText: { color: '#475569', fontSize: 14, lineHeight: 20 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15 },
  menuItemText: { fontSize: 16, color: '#1E293B', fontWeight: '500' },




  langSelectBtn: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 2, borderBottomColor: 'transparent', marginRight: 8 },
  langSelectBtnActive: { borderBottomColor: ACCENT },
  langSelectText: { fontSize: 14, color: '#667085' },

  workoutResultCard: { width: '100%', maxWidth: 360, backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  workoutResultTitle: { fontSize: 20, fontWeight: '700', color: '#172033', textAlign: 'center', marginBottom: 8 },
  workoutResultText: { fontSize: 15, color: '#475569', textAlign: 'center', marginBottom: 12 },
  secondaryButton: { minHeight: 48, width: '100%', backgroundColor: UI.subtle, padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: ACCENT_DARK, fontWeight: '600', fontSize: 15, textAlign: 'center' },
  closeModalButton: { minHeight: 40, width: '100%', padding: 8, alignItems: 'center', justifyContent: 'center' },
  closeModalButtonText: { color: '#64748B', fontWeight: '500', fontSize: 14, textAlign: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#FFF', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  aiButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 8 },
  aiButtonText: { color: '#B45309', fontWeight: '600', fontSize: 14 },
  generationStatus: { color: '#64748B', textAlign: 'center', marginTop: 14, paddingHorizontal: 28, fontSize: 16, lineHeight: 23 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: ACCENT,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 20,
  },
  retryButtonText: {
    color: UI.onAccent,
    fontSize: 15,
    fontWeight: 'bold'
  },
});

const markdownStyles = StyleSheet.create({
  body: { ...UI.reading, color: UI.body },
  heading1: { fontSize: 20, fontWeight: 'bold', color: '#1E293B', marginVertical: 10 },
  heading2: { fontSize: 18, fontWeight: 'bold', color: '#1E293B', marginVertical: 8 },
  strong: { fontWeight: 'bold', color: '#0F172A' },
  em: { fontStyle: 'italic' },
  blockquote: { borderLeftWidth: 4, borderLeftColor: '#E2E8F0', paddingLeft: 10, marginVertical: 10, opacity: 0.8 },
  table: { borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 4, marginVertical: 10 },
  tr: { borderBottomWidth: 1, borderColor: '#E2E8F0', flexDirection: 'row' },
  th: { padding: 8, backgroundColor: '#F8FAFC', fontWeight: 'bold', flex: 1 },
  td: { padding: 8, flex: 1 }
});
