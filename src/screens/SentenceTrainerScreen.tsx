import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { generationContext, checkAborted, isAbortError, cancelGenerations, useGenerationStatus } from '../services/generationControl';
import { useShallow } from 'zustand/react/shallow';
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform, ActivityIndicator, Alert, PanResponder, Animated, LayoutAnimation, UIManager, InteractionManager } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Token, Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { Ionicons } from '@expo/vector-icons';
import SentenceExplanation from '../components/SentenceExplanation';
import { explainSentenceWithAI } from '../services/aiService';
import { generateSentenceBatch, isSentenceGenerationConfigured, RequiredWord } from '../services/sentenceGeneration';
import SentenceEditorModal from '../components/SentenceEditorModal';
import { useCardTransition } from '../hooks/useCardTransition';
import { useSentenceEditor } from '../hooks/useSentenceEditor';
import { ROLE_TRANSLATIONS, getRoleColor } from '../constants/sentencePresentation';
import EditWordModal from '../components/EditWordModal';
import { buildWordLookup, cleanDictionaryForm, getWordTranslation } from '../utils/words';
import { SESSION_START, sessionRefreshedLangs } from '../services/sentenceSession';
import { computeSentenceGroups } from '../utils/sentenceGroups';
import { sentenceFingerprint } from '../utils/sentenceValidation';
import { ACCENT, ACCENT_DARK } from '../constants/theme';
import { createQueueOrder, selectTrainerQueue } from '../utils/sentenceQueue';
import BookConnections from '../components/BookConnections';
import { selectBookPassages, parseBookURL } from '../services/bookService';
import type { BookLocation, BookPassage } from '../models/book';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const REVEAL_ANIMATION = LayoutAnimation.create(220, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity);

const AFFIX_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']; // Palette for multiple suffixes
// Top up when this few stand-alone cards remain. A batch of 8 yields only 4 stand-alone
// cards (the other 4 form the Workshop series), so the reserve must stay below 4,
// otherwise every finished batch would immediately trigger another one.
const GENERATION_RESERVE = 3;
const GENERATION_BATCH = 8; // one complete curriculum cycle per top-up

export default function SentenceTrainerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, sentences, addGeneratedSentences, clearGeneratedSentences, addWordFromSentenceToken, activeLanguages, targetSentenceInfo, setTargetSentenceInfo, incrementShowCounts } = useStore(useShallow(state => ({
    words: state.words,
    sentences: state.sentences,
    addGeneratedSentences: state.addGeneratedSentences,
    clearGeneratedSentences: state.clearGeneratedSentences,
    addWordFromSentenceToken: state.addWordFromSentenceToken,
    activeLanguages: state.activeLanguages,
    targetSentenceInfo: state.targetSentenceInfo,
    setTargetSentenceInfo: state.setTargetSentenceInfo,
    incrementShowCounts: state.incrementShowCounts,
  })));
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

  // Word modal state for tapping a token
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [isWordModalVisible, setIsWordModalVisible] = useState(false);

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
  useEffect(() => { setTargetSentenceId(null); }, [selectedLanguageCode]);

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

  // AI sentences are the normal training queue. Manually prepared / seed
  // sentences are kept untouched and shown only when Gemini can't provide any.
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
    const generated = allSentencesForLanguage.filter(sentence => sentence.source === 'generated');
    const fallback = allSentencesForLanguage.filter(sentence => sentence.source !== 'generated');
    const session = generated.filter(s => (s.createdAt ?? 0) >= SESSION_START);
    const active = session.length > 0 ? session : generated;
    const pool = active.length > 0 ? active : fallback;
    const filtered = selectTrainerQueue(pool, queueOrder.current);
    return {
      generatedSentences: generated,
      sessionGenerated: session,
      filteredSentences: filtered,
      showingGenerated: active.length > 0,
    };
  }, [allSentencesForLanguage]);

  // Keep the visible card by ID when cache eviction removes earlier entries.
  const currentFilteredIndex = Math.max(0, filteredSentences.findIndex(sentence => sentence.id === queuedSentenceId));
  const setCurrentFilteredIndex = (index: number) => setQueuedSentenceId(filteredSentences[index]?.id ?? null);
  useEffect(() => {
    if (filteredSentences[currentFilteredIndex]?.id !== queuedSentenceId) {
      setQueuedSentenceId(filteredSentences[currentFilteredIndex]?.id ?? null);
    }
  }, [filteredSentences, currentFilteredIndex, queuedSentenceId]);

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

  const generateSentences = async (languageCode = selectedLanguageCode, count = GENERATION_BATCH, requiredWord?: RequiredWord) => {
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
        void generateSentences(selectedLanguageCode, GENERATION_BATCH);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isFocused, selectedLanguageCode, targetSentenceInfo]);

  // Keep an endless queue: quietly top up while the learner still has cards left.
  useEffect(() => {
    if (!isFocused || !isSentenceGenerationConfigured() || targetSentenceInfo) return;
    if (!showingGenerated || generationErrors[selectedLanguageCode]) return;
    const remainingInPlay = filteredSentences.length - currentFilteredIndex;
    if (remainingInPlay <= GENERATION_RESERVE) {
      const timer = setTimeout(() => void generateSentences(selectedLanguageCode, GENERATION_BATCH), 500);
      return () => clearTimeout(timer);
    }
  }, [isFocused, selectedLanguageCode, currentFilteredIndex, generatedCacheCount, showingGenerated, targetSentenceInfo]);

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

  // When a fresh session batch replaces the cached view (or on any set change
  // that leaves the index out of range), jump back to the first sentence.
  const showingSessionBatch = sessionGenerated.length > 0;
  const prevShowingSessionBatch = useRef(showingSessionBatch);
  useEffect(() => {
    if ((showingSessionBatch && !prevShowingSessionBatch.current) || currentFilteredIndex >= filteredSentences.length) {
      setCurrentFilteredIndex(0);
    }
    prevShowingSessionBatch.current = showingSessionBatch;
  }, [showingSessionBatch, filteredSentences.length, currentFilteredIndex]);

  const safeIndex = currentFilteredIndex < filteredSentences.length ? currentFilteredIndex : 0;
  const currentSentence = (targetSentenceId ? allSentencesForLanguage.find(sentence => sentence.id === targetSentenceId) : undefined) ?? filteredSentences[safeIndex];

  const transition = useCardTransition({
    enabled: isFocused && !showAiModal && !editor.isModalVisible && !isWordModalVisible && !isMenuVisible,
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

  const moveToNextSentence = () => {
    if (!transition.beginAction()) return;
    setTargetSentenceId(null);
    if (filteredSentences.length <= 1) {
      setRevealedTokens(new Set());
      setShowTranslations(false);
      setAiExplanation(null);
      return;
    }

    const position = filteredSentences.findIndex(sentence => sentence.id === currentSentence?.id);
    const nextIdx = (position + 1) % filteredSentences.length;
    setCurrentFilteredIndex(nextIdx);
    setRevealedTokens(new Set());
    setShowTranslations(false);
    setAiExplanation(null);
  };

  const moveToPrevSentence = () => {
    if (!transition.beginAction()) return;
    setTargetSentenceId(null);
    if (filteredSentences.length <= 1) {
      setRevealedTokens(new Set());
      setShowTranslations(false);
      setAiExplanation(null);
      return;
    }

    const position = filteredSentences.findIndex(sentence => sentence.id === currentSentence?.id);
    const prevIdx = position < 0 ? filteredSentences.length - 1 : (position - 1 + filteredSentences.length) % filteredSentences.length;
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

  const handleTokenPress = (token: Token) => {
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
    setIsWordModalVisible(true);
  };

  const orderedGroups = React.useMemo(
    () => computeSentenceGroups(currentSentence?.words),
    [currentSentence]
  );

  // Per-token badge numbers, unique within each clause. A role-group can hold
  // several tokens (e.g. two articles revealed together) — numbering them by
  // group alone would print the same number on two different cards, which
  // reads as a mistake. Count tokens instead, restarting at 1 per clause.
  const tokenBadgeNumbers = React.useMemo(() => {
    const map = new Map<number, number>();
    const clauseCounters = new Map<number, number>();
    orderedGroups.forEach(group => {
      group.tokenIndices.forEach(ti => {
        const next = (clauseCounters.get(group.clauseIndex) || 0) + 1;
        clauseCounters.set(group.clauseIndex, next);
        map.set(ti, next);
      });
    });
    return map;
  }, [orderedGroups]);

  const revealBlock = (index: number) => {
    LayoutAnimation.configureNext(REVEAL_ANIMATION);
    setRevealedTokens(previous => previous === null ? null : new Set([...previous, index]));
  };

  const allBlocksRevealed = !!currentSentence?.words.length &&
    (revealedTokens === null || currentSentence.words.every((_, index) => revealedTokens.has(index)));

  // The bottom button opens the next role-group, skipping blocks opened by tap.
  const handleReveal = () => {
    if (!currentSentence) return;
    LayoutAnimation.configureNext(REVEAL_ANIMATION);
    const nextGroup = orderedGroups.find(group => group.tokenIndices.some(index => !revealedTokens?.has(index)));
    if (allBlocksRevealed) {
      setRevealedTokens(new Set());
    } else if (nextGroup) {
      setRevealedTokens(previous => new Set([...(previous ?? []), ...nextGroup.tokenIndices]));
    }
  };

  const handleExplainAI = async () => {
    if (!currentSentence) return;

    // Check if we already have an explanation to avoid refetching
    if (aiExplanation) {
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
      const result = await explainSentenceWithAI(sentenceText, sourceLanguage, nativeTranslation, currentSentence.words, explanationController.current.signal);
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

    const added = addWordFromSentenceToken(token, selectedLanguageCode);
    setAddedTokenKeys(previous => new Set([...previous, key]));
    Alert.alert(
      added ? 'Добавлено в словарь' : 'Уже в словаре',
      added
        ? `Слово «${token.dictionary_form || token.text}» добавлено. Его перевод можно отредактировать в словаре.`
        : `Слово «${token.dictionary_form || token.text}» уже есть в словаре.`
    );
  };

  const renderDictionaryAction = (token: Token) => {
    const added = token.is_in_my_dict || addedTokenKeys.has(tokenKey(token)) || Boolean(findWordInStore(token));
    return (
      <TouchableOpacity
        style={[styles.addToDictionaryBtn, added && styles.addToDictionaryBtnAdded]}
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

  const renderToken = (token: Token, index: number) => {
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const isRevealed = revealedTokens === null || revealedTokens.has(index);
    // In a complex (multi-clause) sentence, wrap words of the 2nd+ clause in a
    // second colored frame so the clause boundary reads at a glance.
    const clauseIndex = groupIndex >= 0 ? (orderedGroups[groupIndex]?.clauseIndex ?? 0) : 0;
    const secondaryClause = clauseIndex >= 1;
    const badgeNumber = tokenBadgeNumbers.get(index) ?? (groupIndex >= 0 ? groupIndex + 1 : 1);

    const card = isRevealed ? (
          <TouchableOpacity
            testID={`trainer-block-${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Открыть слово: ${token.text}`}
            activeOpacity={0.85}
            onPress={(e) => {
              e.stopPropagation();
              handleTokenPress(token);
            }}
            style={[
              styles.wordCard,
              { borderColor: getRoleColor(token.role) },
              token.is_in_my_dict && { backgroundColor: '#FFFDF0' } // Gentle yellow background for dict words
            ]}
          >
            <View style={[styles.orderBadge, { backgroundColor: getRoleColor(token.role) }]}>
              <Text style={styles.orderBadgeText}>{badgeNumber}</Text>
            </View>
            {token.parts && token.parts.length > 0 ? (
              <Text style={styles.wordText}>
                {token.parts.map((part, i) => {
                  const displayPart = (index === 0 && i === 0 && part.length > 0)
                    ? part.charAt(0).toUpperCase() + part.slice(1)
                    : part;
                  return (
                    <Text
                      key={i}
                      style={
                        i === 0
                          ? styles.wordRoot
                          : [styles.wordAffix, { color: AFFIX_COLORS[(i - 1) % AFFIX_COLORS.length] }]
                      }
                    >
                      {displayPart}
                    </Text>
                  );
                })}
              </Text>
            ) : (
              <Text style={styles.wordText}>
                {(index === 0 && token.text) ? token.text.charAt(0).toUpperCase() + token.text.slice(1) : token.text}
              </Text>
            )}
            {showTranslations && <Text style={styles.translationText}>{token.translation}</Text>}
            <Text style={[styles.roleText, { color: getRoleColor(token.role) }]}>{ROLE_TRANSLATIONS[token.role] || token.role.replace('_', ' ')}</Text>
            {renderDictionaryAction(token)}
          </TouchableOpacity>
    ) : (
          <TouchableOpacity testID={`trainer-block-${index}`} accessibilityRole="button"
            accessibilityLabel={`Раскрыть блок ${index + 1}`} activeOpacity={0.65}
            onPress={() => revealBlock(index)} style={styles.hiddenCard}>
            <Ionicons name="hand-left-outline" size={19} color={ACCENT_DARK} />
            <Text style={styles.hiddenText}>Открыть</Text>
          </TouchableOpacity>
    );

    return (
      <View key={`${index}-${token.text}`} style={styles.tokenContainer}>
        {secondaryClause ? (
          <View style={[styles.clauseFrame, { borderColor: isRevealed ? getRoleColor(token.role) : '#94A3B8' }]}>
            {card}
          </View>
        ) : card}
      </View>
    );
  };

  const renderTokenTableMode = (token: Token, index: number) => {
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const isRevealed = revealedTokens === null || revealedTokens.has(index);
    const clauseIndex = groupIndex >= 0 ? (orderedGroups[groupIndex]?.clauseIndex ?? 0) : 0;
    const secondaryClause = clauseIndex >= 1;
    const badgeNumber = tokenBadgeNumbers.get(index) ?? (groupIndex >= 0 ? groupIndex + 1 : 1);

    const card = isRevealed ? (
            <TouchableOpacity
              testID={`trainer-block-${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Открыть слово: ${token.text}`}
              activeOpacity={0.85}
              onPress={(e) => {
                e.stopPropagation();
                handleTokenPress(token);
              }}
              style={[
                styles.wordCard,
                { borderColor: getRoleColor(token.role), minWidth: 0, paddingVertical: 8, paddingHorizontal: 12 },
                token.is_in_my_dict && { backgroundColor: '#FFFDF0' }
              ]}
            >
              <View style={[styles.orderBadge, { backgroundColor: getRoleColor(token.role) }]}>
                <Text style={styles.orderBadgeText}>{badgeNumber}</Text>
              </View>
              {token.parts && token.parts.length > 0 ? (
                <Text style={styles.wordText}>
                  {token.parts.map((part, i) => {
                    const displayPart = (index === 0 && i === 0 && part.length > 0)
                      ? part.charAt(0).toUpperCase() + part.slice(1)
                      : part;
                    return (
                      <Text
                        key={i}
                        style={
                          i === 0
                            ? styles.wordRoot
                            : [styles.wordAffix, { color: AFFIX_COLORS[(i - 1) % AFFIX_COLORS.length] }]
                        }
                      >
                        {displayPart}
                      </Text>
                    );
                  })}
                </Text>
              ) : (
                <Text style={styles.wordText}>
                  {(index === 0 && token.text) ? token.text.charAt(0).toUpperCase() + token.text.slice(1) : token.text}
                </Text>
              )}
            </TouchableOpacity>
    ) : (
            <TouchableOpacity testID={`trainer-block-${index}`} accessibilityRole="button"
              accessibilityLabel={`Раскрыть блок ${index + 1}`} activeOpacity={0.65}
              onPress={() => revealBlock(index)} style={[styles.hiddenCard, { minWidth: 0, paddingHorizontal: 12 }]}>
              <Ionicons name="hand-left-outline" size={19} color={ACCENT_DARK} />
              <Text style={styles.hiddenText}>Открыть</Text>
            </TouchableOpacity>
    );

    return (
      <View key={`${index}-${token.text}`} style={styles.tableRow}>
        <View style={styles.tableColWord}>
          {secondaryClause ? (
            <View style={[styles.clauseFrame, { borderColor: isRevealed ? getRoleColor(token.role) : '#94A3B8' }]}>
              {card}
            </View>
          ) : card}
        </View>

        <View style={styles.tableColTrans}>
          {isRevealed && showTranslations && (
            <Text style={[styles.translationText, { marginTop: 0 }]}>{token.translation}</Text>
          )}
        </View>

        <View style={styles.tableColRole}>
          {isRevealed && (
            <View style={styles.tableRoleActions}>
              <Text style={[styles.roleText, { color: getRoleColor(token.role), marginTop: 0 }]}>
                {ROLE_TRANSLATIONS[token.role] || token.role.replace('_', ' ')}
              </Text>
              {renderDictionaryAction(token)}
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <Text style={styles.header}>Разбор предложений</Text>
      <TouchableOpacity accessibilityRole="button" testID="book-entry" style={{ alignSelf: 'center', padding: 10 }} onPress={() => navigation.navigate('Book', { language: selectedLanguageCode })}>
        <Text style={{ color: ACCENT_DARK, fontWeight: '600' }}>Книга и метод</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" style={{ alignSelf: 'center', padding: 10 }} onPress={() => navigation.navigate('SentenceWorkshop', { sentenceId: currentSentence?.id, language: selectedLanguageCode })}>
        <Text style={{ color: ACCENT_DARK, fontWeight: '600' }}>Мастерская предложения</Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" testID="growing-sentence-entry" style={{ alignSelf: 'center', paddingBottom: 6 }} onPress={() => navigation.navigate('SentenceWorkshop', { language: selectedLanguageCode, mode: 'Нарастающее' })}>
        <Text style={{ color: ACCENT_DARK, fontWeight: '600' }}>Предложение по нарастающей</Text>
      </TouchableOpacity>

      {/* Language Selector */}
      <View style={styles.languageToolbar}>
        <ScrollView style={{ flex: 1 }} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center'}}>
          {LANGUAGES.filter(lang => activeLanguages.includes(lang.code)).map(lang => (
            <TouchableOpacity
              key={lang.code}
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
                selectedLanguageCode === lang.code && {color: '#FFF', fontWeight: 'bold'}
              ]}>
                {lang.flag} {lang.label}
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
            contentContainerStyle={{flexGrow: 1}}
          >
            <View style={{ flex: 1 }}>
              <Text testID="trainer-sentence-text" style={{ fontSize: 18, color: '#475569', textAlign: 'center', marginBottom: 6 }}>
                {currentSentence?.sentence || currentSentence?.words?.map(w => w.text).join(' ')}
              </Text>
              {showTranslations && currentSentence?.literalTranslation && (
                <Text style={{ color: '#666', textAlign: 'center', marginBottom: 8, paddingHorizontal: 16 }}>
                  {currentSentence.literalTranslation}
                </Text>
              )}

              <View style={[isTableMode ? styles.tableContainer : styles.sentenceWrapper, { minHeight: 200 }]}>
                {isTableMode
                  ? currentSentence?.words?.map(renderTokenTableMode)
                  : currentSentence?.words?.map(renderToken)
                }
              </View>
              {currentSentence && <BookConnections key={currentSentence.id} language={selectedLanguageCode} sentence={currentSentence.sentence} tokens={currentSentence.words} />}
            </View>
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
                onPress={() => void generateSentences(selectedLanguageCode, GENERATION_BATCH)}
              >
                <Ionicons name="sparkles" size={18} color="#FFF" style={{ marginRight: 8 }} />
                <Text style={styles.retryButtonText}>Сгенерировать предложения</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

        <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 10}}>
          {currentSentence && isSentenceGenerationConfigured() && (
            <TouchableOpacity
              testID="trainer-ai-explain" accessibilityRole="button" accessibilityLabel="Объяснить структуру"
              onPress={handleExplainAI}
              disabled={isAiLoading}
              style={styles.aiButton}
            >
              {isAiLoading ? (
                <ActivityIndicator size="small" color="#EAB308" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={16} color="#EAB308" style={{marginRight: 8}} />
                  <Text style={styles.aiButtonText}>Объяснить структуру</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={styles.optionsButton}
            testID="sentence-options" accessibilityLabel="Действия с предложением" accessibilityRole="button"
            onPress={() => setIsMenuVisible(true)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#475569" />
          </TouchableOpacity>
        </View>

      {filteredSentences.length > 0 && <View style={styles.sentenceNavigation}>
        <TouchableOpacity testID="trainer-previous" accessibilityRole="button" accessibilityLabel="Предыдущее предложение"
          disabled={filteredSentences.length < 2} onPress={moveToPrevSentence}
          style={[styles.navigationButton, filteredSentences.length < 2 && styles.disabledButton]}>
          <Ionicons name="chevron-back" size={20} color={ACCENT_DARK} />
          <Text style={styles.navigationText}>Назад</Text>
        </TouchableOpacity>
        <Text testID="trainer-position" style={styles.positionText}>{targetSentenceId ? 'Из словаря' : `${safeIndex + 1} / ${filteredSentences.length}`}</Text>
        <TouchableOpacity testID="trainer-next" accessibilityRole="button" accessibilityLabel="Следующее предложение"
          disabled={filteredSentences.length < 2} onPress={moveToNextSentence}
          style={[styles.navigationButton, filteredSentences.length < 2 && styles.disabledButton]}>
          <Text style={styles.navigationText}>Вперёд</Text>
          <Ionicons name="chevron-forward" size={20} color={ACCENT_DARK} />
        </TouchableOpacity>
      </View>}
      {/* Primary Action */}
      <View style={[styles.controls, { marginBottom: 5 }]}>
        <TouchableOpacity testID="trainer-translation" accessibilityRole="button" disabled={!currentSentence} style={[styles.button, styles.buttonSecondary]} onPress={() => setShowTranslations(!showTranslations)}>
          <Text style={styles.buttonText}>{showTranslations ? 'Скрыть перевод' : 'Перевод'}</Text>
        </TouchableOpacity>

        <TouchableOpacity testID="trainer-reveal" accessibilityRole="button" disabled={!currentSentence} style={styles.button} onPress={handleReveal}>
          <Text style={styles.buttonText}>{allBlocksRevealed ? 'Скрыть разбор' : 'Разбор'}</Text>
        </TouchableOpacity>
      </View>

      {/* Options Menu Modal */}
      <Modal visible={isMenuVisible} transparent={true} animationType="fade" onRequestClose={() => setIsMenuVisible(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <TouchableOpacity activeOpacity={1} onPress={event => event.stopPropagation()} style={styles.menuCard}>
            <ScrollView>
            <View testID="trainer-cache-stats" style={styles.menuStats}>
              <Text style={styles.menuStatsTitle}>{activeLangObj?.label} · предложения</Text>
              <Text style={styles.menuStatsText}>В кеше: {languageCache.length}</Text>
              <Text style={styles.menuStatsText}>Создано за сеанс: {createdThisSession}</Text>
              <Text style={styles.menuStatsText}>В очереди разбора: {filteredSentences.length}</Text>
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
                    void generateSentences(selectedLanguageCode, GENERATION_BATCH);
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
                            generatingLanguages.current.delete(selectedLanguageCode);
                            setCurrentFilteredIndex(0);
                            void generateSentences(selectedLanguageCode, GENERATION_BATCH);
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

      {/* AI Explanation Modal */}
      <Modal visible={showAiModal} animationType="fade" transparent={true} onRequestClose={closeExplanation}>
        <View style={styles.modalOverlay}>
          <View testID="sentence-explanation-modal" style={[styles.modalCard, {maxHeight: '80%'}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
              <View style={{flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0}}>
                <Text style={[styles.modalHeader, {marginBottom: 0, flexShrink: 1}]}>Как устроена фраза</Text>
              </View>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Закрыть объяснение" onPress={closeExplanation} style={{padding: 5}}>
                <Text style={{fontSize: 20, color: '#94A3B8'}}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {isAiLoading ? (
                <View style={{padding: 40, alignItems: 'center'}}>
                  <ActivityIndicator size="large" color={ACCENT} />
                  <Text style={{marginTop: 15, color: '#64748B'}}>Разбираем фразу…</Text>
                </View>
              ) : (
                <>
                  <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 8 }}>Пояснение ИИ · с опорой на вашу книгу</Text>
                  <SentenceExplanation key={aiExplanation} text={aiExplanation || ''} style={markdownStyles} onLinkPress={(url: string) => {
                    const location = parseBookURL(url);
                    if (location && aiBookPassages.some(p => p.chapterId === location.chapterId && p.blockId === location.blockId)) {
                      closeExplanation();
                      navigation.push('Book', location);
                    }
                    return false;
                  }} />
                  <BookConnections language={aiBookLanguage} passages={aiBookPassages} onOpen={(location: BookLocation) => { closeExplanation(); navigation.push('Book', location); }} />
                </>
              )}
            </ScrollView>

            <View style={{marginTop: 15, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0'}}>
              <Text style={{fontSize: 12, color: '#94A3B8', textAlign: 'center'}}>Сгенерировано нейросетью. Возможны неточности.</Text>
            </View>
          </View>
        </View>
      </Modal>

      <EditWordModal
        visible={isWordModalVisible}
        onClose={() => setIsWordModalVisible(false)}
        wordToEdit={editingWord}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#F5F5F5' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  languageToolbar: { height: 50, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sentenceWrapper: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20 },
  tokenContainer: { margin: 4 },
  wordCard: { minHeight: 64, justifyContent: 'center', backgroundColor: '#FFFFFF', padding: 12, borderRadius: 12, borderWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, alignItems: 'center', minWidth: 80 },
  // Outer ring for words of a 2nd+ clause in a complex sentence — reads as a double frame.
  clauseFrame: { borderWidth: 2, borderRadius: 13, padding: 3, alignSelf: 'flex-start' },
  orderBadge: { position: 'absolute', top: -10, left: -10, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  orderBadgeText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  hiddenCard: { backgroundColor: '#FFF4E8', padding: 12, borderRadius: 12, borderWidth: 2, borderColor: ACCENT, alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 80, minHeight: 64, shadowColor: ACCENT_DARK, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 3, elevation: 2 },
  wordText: { fontSize: 18, fontWeight: '600' },
  wordRoot: { fontWeight: '600', color: '#111827' },
  wordAffix: { fontWeight: '800' },
  translationText: { fontSize: 14, color: '#666', marginTop: 4 },
  roleText: { fontSize: 10, fontWeight: '600', marginTop: 4, opacity: 0.8 },
  addToDictionaryBtn: { position: 'absolute', bottom: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, alignItems: 'center', justifyContent: 'center', zIndex: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 1, elevation: 2 },
  addToDictionaryBtnAdded: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  addToDictionaryText: { fontSize: 14, color: ACCENT_DARK, fontWeight: '800', lineHeight: 16 },
  addToDictionaryTextAdded: { color: '#15803D' },
  hiddenText: { fontSize: 13, fontWeight: '700', color: ACCENT_DARK },
  controls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10, gap: 10 },
  button: { minHeight: 48, flex: 1, backgroundColor: ACCENT, padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sentenceNavigation: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  navigationButton: { flex: 1, minHeight: 48, flexDirection: 'row', gap: 4, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF4E8', borderWidth: 1, borderColor: ACCENT, borderRadius: 12, paddingHorizontal: 8 },
  navigationText: { color: ACCENT_DARK, fontSize: 14, fontWeight: '700' },
  positionText: { color: '#64748B', fontSize: 12, textAlign: 'center', maxWidth: 80 },
  disabledButton: { opacity: 0.4 },
  optionsButton: { marginLeft: 12, minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 14 },
  buttonSecondary: { backgroundColor: '#6C757D' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },

  // Table Mode Styles
  tableContainer: { width: '100%', marginTop: 20, backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', paddingBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', padding: 10 },
  tableColWord: { flex: 2, alignItems: 'flex-start' },
  tableColTrans: { flex: 2, paddingHorizontal: 10 },
  tableColRole: { flex: 1.5, alignItems: 'flex-end' },
  tableRoleActions: { alignItems: 'flex-end' },

  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#1E293B' },

  menuCard: { width: '100%', maxWidth: 360, maxHeight: '85%', backgroundColor: '#FFF', borderRadius: 16, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  menuStats: { padding: 12, gap: 6, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  menuStatsTitle: { color: '#1E293B', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  menuStatsText: { color: '#475569', fontSize: 14, lineHeight: 20 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15 },
  menuItemText: { fontSize: 16, color: '#1E293B', fontWeight: '500' },




  langSelectBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E0E0E0', marginHorizontal: 5 },
  langSelectBtnActive: { backgroundColor: ACCENT },
  langSelectText: { fontSize: 14, color: '#333' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#FFF', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  aiButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8E7', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#FDE047', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
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
    shadowColor: ACCENT,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: 'bold'
  },
});

const markdownStyles = StyleSheet.create({
  body: { fontSize: 15, lineHeight: 24, color: '#334155' },
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
