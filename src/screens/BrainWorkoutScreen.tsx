import { useIsFocused } from '@react-navigation/native';
import { useCardTransition } from '../hooks/useCardTransition';
import { useShallow } from 'zustand/react/shallow';
import { buildWorkoutQueue, QueueItem } from '../utils/workout';
import { localDateKey } from '../utils/date';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, PanResponder, Animated, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { captureKnowledgeUndo, type KnowledgeUndo } from '../utils/wordProgress';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';
import { auditWordManually } from '../services/wordAuditService';
import { getWordTranslation } from '../utils/words';
import { usePronunciation } from '../hooks/usePronunciation';
import PapandaIcon from '../components/PapandaIcon';
import PronunciationModal from '../components/PronunciationModal';
import { readWordStats } from '../utils/statistics';
import { canStudyWord } from '../utils/wordStudy';
import { ACCENT, ACCENT_DARK, ACCENT_LIGHT, ACCENT_BORDER, UI } from '../constants/theme';



const SWIPE_THRESHOLD = 72;
const SWIPE_EXIT_DISTANCE = 520;
const SWIPE_ENTRY_OFFSET = 56;


export default function BrainWorkoutScreen() {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, markWordKnown, incrementShowCount, workoutWordCount, addWorkoutSnapshot, recordImwSnapshot, workoutFavoritesOnly, setWorkoutFavoritesOnly, toggleWordFavorite, undoWordKnowledge, userWordProgress, snoozeWord, hasSeenSnoozeHint, setHasSeenSnoozeHint } = useStore(useShallow(state => ({
    words: state.words,
    activeLanguages: state.activeLanguages,
    markWordKnown: state.markWordKnown,
    incrementShowCount: state.incrementShowCount,
    workoutWordCount: state.workoutWordCount,
    addWorkoutSnapshot: state.addWorkoutSnapshot,
    recordImwSnapshot: state.recordImwSnapshot,
    workoutFavoritesOnly: state.workoutFavoritesOnly,
    setWorkoutFavoritesOnly: state.setWorkoutFavoritesOnly,
    toggleWordFavorite: state.toggleWordFavorite,
    undoWordKnowledge: state.undoWordKnowledge,
    userWordProgress: state.userWordProgress,
    snoozeWord: state.snoozeWord,
    hasSeenSnoozeHint: state.hasSeenSnoozeHint,
    setHasSeenSnoozeHint: state.setHasSeenSnoozeHint,
  })));
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const queueScope = JSON.stringify([activeLanguages, workoutFavoritesOnly, workoutWordCount]);
  const initializedScope = React.useRef<string | null>(null);
  // Bumped to force a fresh workout queue (finishing a session, closing the result modal).
  const [regenNonce, setRegenNonce] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const actionLocked = React.useRef(false);
  React.useLayoutEffect(() => { actionLocked.current = false; }, [queue, currentIndex]);
  const [score, setScore] = useState({ known: 0, unknown: 0 });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [isAuditingWord, setIsAuditingWord] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const manualAuditAbortRef = React.useRef<AbortController | null>(null);

  const { isPronunciationModalVisible, setIsPronunciationModalVisible, pronunciationExplanation,
    setPronunciationExplanation, isPronunciationLoading, handlePronunciation,
    pronunciationMode, changePronunciationMode, pronunciationError, retryPronunciation } = usePronunciation();

  const [history, setHistory] = useState<{index: number, knew: boolean, undo: KnowledgeUndo}[]>([]);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [workoutResult, setWorkoutResult] = useState({ known: 0, unknown: 0 });
  const closeResult = () => {
    setResultModalVisible(false);
    setRegenNonce(n => n + 1);
  };
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const transition = useCardTransition({
    enabled: isFocused && !resultModalVisible && !isModalVisible && !isStatsVisible && !isPronunciationModalVisible,
    scope: JSON.stringify([queueScope, regenNonce]),
    cardKey: JSON.stringify([queue[currentIndex]?.word.eng || queue[currentIndex]?.word.word, queue[currentIndex]?.langCode, currentIndex]),
    onSwipe: direction => handleAnswer(direction === 'right'),
    canSwipe: () => Boolean(currentWord && currentLang && getWordTranslation(currentWord, currentLang)),
    distance: SWIPE_EXIT_DISTANCE, entryOffset: SWIPE_ENTRY_OFFSET, duration: 220,
  });
  const cardTranslateX = transition.translateX;
  const isSwipeAnimating = transition.busy;

  const callbacks = React.useRef({
    handleSwipe: (_direction: 'left' | 'right') => {},
    resetCardPosition: () => {},
  });

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return Math.abs(gestureState.dx) > 4 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_evt, gestureState) => {
        if (!isSwipeAnimating.current) {
          cardTranslateX.setValue(gestureState.dx);
        }
      },
      onPanResponderRelease: (_evt, gestureState) => {
        if (gestureState.dx < -SWIPE_THRESHOLD) {
          callbacks.current.handleSwipe('left');
        } else if (gestureState.dx > SWIPE_THRESHOLD) {
          callbacks.current.handleSwipe('right');
        } else {
          callbacks.current.resetCardPosition();
        }
      },
      onPanResponderTerminate: () => callbacks.current.resetCardPosition(),
    })
  ).current;

  // Generate workout queue
  useEffect(() => {
    if (!isFocused) return;
    const scope = JSON.stringify([queueScope, regenNonce]);
    if (initializedScope.current === scope && queue.length > 0) return;
    initializedScope.current = scope;
    setQueue(buildWorkoutQueue(useStore.getState()));
    setCurrentIndex(0);
    setHistory([]);
    setScore({ known: 0, unknown: 0 });
    setResultModalVisible(false);
    setPronunciationExplanation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueScope, regenNonce, isFocused]);

  const currentItem = queue[currentIndex];
  // Always use the freshest word data from the store in case it was edited
  const currentStoredWord = currentItem ? words.find(w => (w.eng || w.word) === (currentItem.word.eng || currentItem.word.word)) : undefined;
  const currentWord = currentStoredWord ?? currentItem?.word;
  const currentLang = currentItem?.langCode;
  const cardContext = JSON.stringify([queueScope, regenNonce, currentIndex, currentItem?.word.eng, currentLang]);
  const activeCardContext = React.useRef<string | null>(null);
  activeCardContext.current = isFocused ? cardContext : null;

  // Always read the latest favorite status directly from the store
  const currentWordKey = currentWord?.eng || currentWord?.word || '';
  const currentProgress = currentWordKey ? userWordProgress[currentWordKey] : undefined;
  const aiStatus = currentProgress?.ai_verification?.status;
  const auditInput = JSON.stringify([currentWord?.ru, currentWord?.meaning,
    activeLanguages.map(lang => [lang, currentWord && getWordTranslation(currentWord, lang)])]);
  React.useLayoutEffect(() => {
    setIsAuditingWord(false);
    setAuditError(null);
    return () => {
      manualAuditAbortRef.current?.abort();
      manualAuditAbortRef.current = null;
    };
  }, [cardContext, auditInput, isFocused, resultModalVisible, isModalVisible]);

  const runManualAudit = async () => {
    if (!currentStoredWord || activeCardContext.current !== cardContext || resultModalVisible || isModalVisible
      || manualAuditAbortRef.current) return;
    const controller = new AbortController();
    manualAuditAbortRef.current = controller;
    setIsAuditingWord(true);
    setAuditError(null);
    try {
      await auditWordManually(currentStoredWord, activeLanguages, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setAuditError(err instanceof Error ? err.message : 'Не удалось проверить слово.');
      }
    } finally {
      if (manualAuditAbortRef.current === controller) {
        manualAuditAbortRef.current = null;
        setIsAuditingWord(false);
      }
    }
  };

  const handleAuditButtonPress = () => {
    if (isAuditingWord) return;
    if (aiStatus === 'flagged') {
      setEditingWord(currentWord ?? null);
      setIsModalVisible(true);
    } else if (aiStatus === 'verified') {
      Alert.alert('Слово проверено', 'ИИ проверил написание и перевод — ошибок не обнаружено.\n\nЗапустить проверку повторно?', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Проверить снова', onPress: () => void runManualAudit() },
      ]);
    } else {
      void runManualAudit();
    }
  };

  const isFavorite = currentWord ? (currentProgress?.is_favorite ?? currentWord.is_favorite) : false;
  const knowledgeStats = {
    ...readWordStats(currentWord?.knowledge_stats),
    ...(currentProgress?.knowledge_stats || {}),
  } as Record<string, boolean>;
  const showStats = {
    ...readWordStats(currentWord?.show_stats),
    ...(currentProgress?.show_stats || {}),
  } as Record<string, number>;
  const previousAnswer = currentLang ? knowledgeStats[currentLang] : undefined;
  const isCurrentLanguageLearned = previousAnswer === true;
  const totalShows = currentProgress?.count ?? currentWord?.count ?? 0;
  const lastShown = currentProgress?.last_shown ?? currentWord?.last_shown;

  const advanceWorkout = (known = score.known, unknown = score.unknown) => {
    const latestWords = useStore.getState().words;
    const nextIndex = queue.findIndex((item, index) => index > currentIndex && latestWords.some(word =>
      (word.eng || word.word) === (item.word.eng || item.word.word) && canStudyWord(word, [item.langCode])));
    if (nextIndex >= 0) {
      setCurrentIndex(nextIndex);
      setPronunciationExplanation(null);
    } else {
      if (known + unknown > 0) {
        addWorkoutSnapshot({ date: localDateKey(), total: known + unknown, correct: known });
        recordImwSnapshot();
      }
      setWorkoutResult({ known, unknown });
      setResultModalVisible(true);
      setScore({ known: 0, unknown: 0 });
    }
  };

  const handleAnswer = (knew: boolean) => {
    if (actionLocked.current || !transition.beginAction() || !currentStoredWord || !currentLang || !canStudyWord(currentStoredWord, [currentLang]) || resultModalVisible) return;
    actionLocked.current = true;

    const wordKey = currentWord.eng || currentWord.word || '';
    const undo = captureKnowledgeUndo(currentWord, [currentLang], knew);
    markWordKnown(wordKey, currentLang, knew);
    undo.reviewsApplied = useStore.getState().userWordProgress[wordKey]?.review_by_lang;
    setHistory(prev => [...prev, { index: currentIndex, knew, undo }]);
    incrementShowCount(wordKey, currentLang);

    if (knew) {
      setScore(s => ({ ...s, known: s.known + 1 }));
    } else {
      setScore(s => ({ ...s, unknown: s.unknown + 1 }));
    }

    advanceWorkout(score.known + (knew ? 1 : 0), score.unknown + (knew ? 0 : 1));
  };

  const executeSnooze = React.useCallback(() => {
    // A native confirmation may outlive the card or the session that opened it.
    if (activeCardContext.current !== cardContext || actionLocked.current || !transition.beginAction() || !currentStoredWord || !currentLang) return;
    actionLocked.current = true;
    const wordKey = currentWord.eng || currentWord.word || '';

    // Snooze for 7 days
    snoozeWord(wordKey, currentLang, 7);

    advanceWorkout();
  }, [cardContext, currentStoredWord, currentWord, currentLang, currentIndex, queue.length, score, snoozeWord, addWorkoutSnapshot, recordImwSnapshot]);

  const handleSnooze = React.useCallback(() => {
    if (!transition.beginAction()) return;
    if (!hasSeenSnoozeHint) {
      Alert.alert(
        'Отложить слово',
        'Это слово не будет попадаться в тренировках следующие 7 дней. Отложить?',
        [
          { text: 'Отмена', style: 'cancel' },
          {
            text: 'Отложить',
            onPress: () => {
              setHasSeenSnoozeHint(true);
              executeSnooze();
            }
          }
        ]
      );
    } else {
      executeSnooze();
    }
  }, [hasSeenSnoozeHint, executeSnooze, setHasSeenSnoozeHint]);

  const handlePrevStep = () => {
    if (actionLocked.current || !transition.beginAction()) return;
    if (history.length > 0) {
      actionLocked.current = true;
      const lastAction = history[history.length - 1];
      const wordKey = queue[lastAction.index].word.eng || queue[lastAction.index].word.word || '';

      undoWordKnowledge(wordKey, lastAction.undo);

      if (lastAction.knew) {
        setScore(s => ({ ...s, known: Math.max(0, s.known - 1) }));
      } else {
        setScore(s => ({ ...s, unknown: Math.max(0, s.unknown - 1) }));
      }

      setHistory(prev => prev.slice(0, -1));
      setCurrentIndex(lastAction.index);
      setPronunciationExplanation(null);
    }
  };

  const resetCardPosition = transition.reset;
  const handleSwipe = transition.animate;

  useEffect(() => {
    if (isFocused && queue.length && !resultModalVisible && currentItem
      && (!currentStoredWord || !canStudyWord(currentStoredWord, [currentItem.langCode]))) advanceWorkout();
  }, [isFocused, queue, currentIndex, words, resultModalVisible]);

  if (queue.length === 0 || !currentWord || !currentLang) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <View style={styles.headerSection}>
          <TouchableOpacity
            style={[styles.favoriteToggleBtn, workoutFavoritesOnly && styles.favoriteToggleBtnActive]}
            onPress={() => setWorkoutFavoritesOnly(!workoutFavoritesOnly)}
          >
            <Text style={[styles.favoriteToggleText, workoutFavoritesOnly && styles.favoriteToggleTextActive]}>
              {workoutFavoritesOnly ? '★ Только избранные' : '☆ Все слова'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.emptyCard}>
          <PapandaIcon name="check" size={28} />
          <Text style={styles.header}>Нет доступных слов</Text>
          <Text style={styles.emptySub}>{'Нет доступных слов для текущего набора языков и фильтров. Измените фильтр или языки в настройках.'}</Text>
          <TouchableOpacity accessibilityRole="button" onPress={() => setRegenNonce(n => n + 1)}><Text>Проверить снова</Text></TouchableOpacity>
        </View>
      </View>
    );
  }

  const targetTranslation = getWordTranslation(currentWord, currentLang);
  const activeLangObj = LANGUAGES.find(l => l.code === currentLang);
  const cardOpacity = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, 0, SWIPE_EXIT_DISTANCE],
    outputRange: [0.15, 1, 0.15],
    extrapolate: 'clamp',
  });
  const cardRotate = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, 0, SWIPE_EXIT_DISTANCE],
    outputRange: ['-10deg', '0deg', '10deg'],
    extrapolate: 'clamp',
  });
  const knownStampOpacity = cardTranslateX.interpolate({
    inputRange: [10, 45, 90],
    outputRange: [0, 0.5, 1],
    extrapolate: 'clamp',
  });
  const unknownStampOpacity = cardTranslateX.interpolate({
    inputRange: [-90, -45, -10],
    outputRange: [1, 0.5, 0],
    extrapolate: 'clamp',
  });

  callbacks.current.handleSwipe = handleSwipe;
  callbacks.current.resetCardPosition = resetCardPosition;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingTop: topPadding }]}>
      {/* Top Header & Progress */}
      <View style={styles.headerSection}>
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeText}>{activeLangObj?.flag} {activeLangObj?.label || currentLang.toUpperCase()}</Text>
        </View>

        <TouchableOpacity
          style={[styles.favoriteToggleBtn, workoutFavoritesOnly && styles.favoriteToggleBtnActive]}
            onPress={() => setWorkoutFavoritesOnly(!workoutFavoritesOnly)}
        >
          <Text style={[styles.favoriteToggleText, workoutFavoritesOnly && styles.favoriteToggleTextActive]}>
            {workoutFavoritesOnly ? '★ Только избранные' : '☆ Все слова'}
          </Text>
        </TouchableOpacity>

        <View style={styles.progressPill}>
          <Text testID="workout-position" style={styles.progressText}>{currentIndex + 1} / {queue.length}</Text>
        </View>
      </View>

      {/* Main Flashcard with Swipe Animation */}
      <View style={styles.cardArea}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.cardMotion,
            {
              opacity: cardOpacity,
              transform: [
                { translateX: cardTranslateX },
                { rotate: cardRotate },
              ],
            },
          ]}
        >
            {(typeof previousAnswer === 'boolean' || totalShows > 0) && (
              <Text
                testID="workout-previous-answer"
                style={[
                  styles.previousAnswer,
                  previousAnswer === true && styles.scoreKnown,
                  previousAnswer === false && styles.scoreUnknown,
                ]}
              >
                {typeof previousAnswer === 'boolean'
                  ? `В прошлый раз: ${previousAnswer ? '✓ Знаю' : '✗ Не знаю'}`
                  : 'На этом языке ещё не оценивали'}
              </Text>
            )}
          <TouchableOpacity
            testID="workout-card"
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => {
              if (targetTranslation && currentLang) {
                handlePronunciation(targetTranslation, currentLang, currentWord.ru || currentWord.meaning || '');
              }
            }}
          >
            {/* Visual feedback stamps during swipe */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.swipeStamp,
                styles.swipeStampKnown,
                { opacity: knownStampOpacity },
              ]}
            >
              <Text style={styles.swipeStampKnownText}>✓ ЗНАЮ</Text>
            </Animated.View>

            <Animated.View
              pointerEvents="none"
              style={[
                styles.swipeStamp,
                styles.swipeStampUnknown,
                { opacity: unknownStampOpacity },
              ]}
            >
              <Text style={styles.swipeStampUnknownText}>✕ НЕ ЗНАЮ</Text>
            </Animated.View>

            <View style={styles.cardToolbar}>
              <Text testID="workout-show-count" accessibilityLabel={`Показов слова: ${totalShows}`} style={styles.showCount}>
                👁 {totalShows}
              </Text>
              <TouchableOpacity
                accessibilityRole="button" accessibilityLabel="Изменить отметку избранного" style={styles.favCardBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  toggleWordFavorite(currentWordKey);
                }}
              >
                <Text style={[styles.favCardBtnText, isFavorite ? {color: '#F59E0B'} : {color: '#D1D5DB'}]}>
                  {isFavorite ? '★' : '☆'}
                </Text>
              </TouchableOpacity>

              <View style={styles.cardToolbarActions}>
                <TouchableOpacity
                  style={styles.statsCardBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    setIsStatsVisible(true);
                  }}
                >
                  <Text style={styles.statsCardBtnText}>Статистика</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="workout-request-audit"
                  accessibilityRole="button"
                  accessibilityLabel={aiStatus === 'verified' ? 'Слово проверено ИИ: ошибок не найдено'
                    : aiStatus === 'flagged' ? 'Обнаружена возможная неточность перевода'
                    : 'Запросить проверку написания и перевода'}
                  accessibilityState={{ disabled: isAuditingWord, busy: isAuditingWord }}
                  style={styles.statsCardBtn}
                  disabled={isAuditingWord}
                  onPress={event => {
                    event.stopPropagation();
                    handleAuditButtonPress();
                  }}
                >
                  {isAuditingWord && <ActivityIndicator size="small" color={ACCENT_DARK} />}
                  <Text style={[styles.statsCardBtnText, aiStatus === 'verified' && styles.auditVerified,
                    aiStatus === 'flagged' && styles.auditWarning]}>
                    {isAuditingWord ? 'Проверка…' : aiStatus === 'verified' ? 'Проверено'
                      : aiStatus === 'flagged' ? 'Неточность' : 'Проверить'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button" accessibilityLabel="Редактировать слово" style={styles.editCardBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    setEditingWord(currentWord);
                    setIsModalVisible(true);
                  }}
                >
                  <PapandaIcon name="edit" />
                </TouchableOpacity>
              </View>
            </View>

            {isAuditingWord && <Text testID="workout-audit-loading" style={styles.auditMessage}>
              ИИ проверяет написание и перевод…
            </Text>}
            {auditError && !isAuditingWord && <View testID="workout-audit-error" style={styles.auditNotice}>
              <Text accessibilityLiveRegion="polite" style={[styles.auditMessage, styles.auditWarning]}>{auditError}</Text>
              <TouchableOpacity accessibilityRole="button" style={styles.statsCardBtn} onPress={event => {
                event.stopPropagation();
                void runManualAudit();
              }}><Text style={styles.statsCardBtnText}>Повторить</Text></TouchableOpacity>
            </View>}
            {aiStatus === 'verified' && !isAuditingWord && <Text testID="workout-audit-verified"
              accessibilityLiveRegion="polite" style={[styles.auditMessage, styles.auditVerified]}>
              Проверено ИИ: написание и перевод точны
            </Text>}
            {aiStatus === 'flagged' && !isAuditingWord && <TouchableOpacity testID="workout-audit-flagged"
              accessibilityRole="button" style={styles.auditNotice} onPress={event => {
                event.stopPropagation();
                setEditingWord(currentWord);
                setIsModalVisible(true);
              }}>
              <Text accessibilityLiveRegion="polite" style={[styles.auditMessage, styles.auditWarning]}>
                Возможна неточность перевода (ИИ) · Открыть редактор
              </Text>
            </TouchableOpacity>}

                {isCurrentLanguageLearned && (
                  <View style={styles.learnedBadge}>
                    <Text style={styles.learnedBadgeText}>✓ Выучено</Text>
                  </View>
                )}
            <Text testID="workout-prompt" style={styles.targetForeignWord}>{targetTranslation || 'Перевод удалён'}</Text>
            {!targetTranslation && <TouchableOpacity accessibilityRole="button" onPress={event => {
              event.stopPropagation();
              if (transition.beginAction()) advanceWorkout();
            }} style={{ padding: 12 }}><Text>Пропустить без оценки</Text></TouchableOpacity>}

            <View style={styles.divider} />

            <View style={styles.answerBox}>
              <View style={styles.answerBoxHeader}>
                <Text testID="workout-translation" style={styles.nativeRu}>{currentWord.ru}</Text>
                {targetTranslation && (
                  <TouchableOpacity
                    style={styles.workoutPronunciationBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Разбор произношения"
                    activeOpacity={0.7}
                    onPress={(e) => {
                      e.stopPropagation();
                      handlePronunciation(targetTranslation, currentLang, currentWord.ru || currentWord.meaning || '');
                    }}
                  >
                    <PapandaIcon name="microphone" />
                  </TouchableOpacity>
                )}
              </View>
              {!!currentWord.meaning && (
                <Text style={styles.meaningText}>Контекст: {currentWord.meaning}</Text>
              )}
            </View>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Bottom Zone: Always Visible Action Buttons (Thumb Friendly) */}
      <View style={styles.bottomZone}>
        <View style={styles.scoreRow}>
          <TouchableOpacity
            onPress={handlePrevStep}
            disabled={history.length === 0}
            style={[styles.backBtn, { opacity: history.length === 0 ? 0.3 : 1 }]}
          >
            <Text style={styles.backBtnIcon}>⬅</Text>
            <Text style={styles.backBtnText}>Назад</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Text style={styles.scoreKnown}>✓ Знаю: {score.known}</Text>
            <Text style={styles.scoreUnknown}>✗ Не знаю: {score.unknown}</Text>
          </View>
        </View>

        {/* Swipe Hint Guide */}
        <View style={styles.swipeHintRow} pointerEvents="none">
          <Text style={styles.swipeHintText}>👈 влево — «Не знаю»</Text>
          <Text style={styles.swipeHintDot}>•</Text>
          <Text style={styles.swipeHintText}>«Знаю» — вправо 👉</Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity
            testID="workout-btn-unknown"
            style={[styles.actionBtn, styles.btnUnknown]}
            activeOpacity={0.8}
            onPress={() => handleSwipe('left')}
            disabled={!targetTranslation}
          >
            <Text style={styles.btnArrow}>←</Text>
            <Text style={styles.btnIcon}>✕</Text>
            <Text style={styles.btnText}>Не знаю</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="workout-btn-snooze"
            style={[styles.actionBtn, styles.btnSnooze]}
            activeOpacity={0.8}
            onPress={handleSnooze}
            disabled={!targetTranslation}
          >
            <Text style={[styles.btnIcon, styles.btnSnoozeText]}>⏱</Text>
            <Text style={[styles.btnText, styles.btnSnoozeText]}>Реже</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="workout-btn-known"
            style={[styles.actionBtn, styles.btnKnown]}
            activeOpacity={0.8}
            onPress={() => handleSwipe('right')}
            disabled={!targetTranslation}
          >
            <Text style={styles.btnIcon}>✓</Text>
            <Text style={styles.btnText}>Знаю</Text>
            <Text style={[styles.btnArrow, styles.btnArrowKnown]}>→</Text>
          </TouchableOpacity>
        </View>
      </View>

      <EditWordModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        wordToEdit={editingWord}
      />

      <PronunciationModal
        visible={isPronunciationModalVisible}
        onClose={() => setIsPronunciationModalVisible(false)}
        loading={isPronunciationLoading}
        explanation={pronunciationExplanation}
        mode={pronunciationMode}
        onModeChange={changePronunciationMode}
        error={pronunciationError}
        onRetry={retryPronunciation}
      />

      <Modal
        visible={isStatsVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsStatsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.statsModalCard}>
            <Text style={styles.statsModalTitle}>Статистика слова</Text>
            <Text style={styles.statsModalWord}>{targetTranslation}</Text>

            <View style={styles.statsSummaryRow}>
              <View style={styles.statsSummaryItem}>
                <Text style={styles.statsSummaryValue}>{totalShows}</Text>
                <Text style={styles.statsSummaryLabel}>показов</Text>
              </View>
              <View style={styles.statsSummaryDivider} />
              <View style={styles.statsSummaryItem}>
                <Text style={styles.statsSummaryValue}>{lastShown ? new Date(lastShown).toLocaleDateString('ru-RU') : '—'}</Text>
                <Text style={styles.statsSummaryLabel}>последний показ</Text>
              </View>
            </View>

            <Text style={styles.statsLanguagesTitle}>Активные языки</Text>
            <View style={styles.statsLanguagesList}>
              {activeLanguages.map(lang => {
                const language = LANGUAGES.find(item => item.code === lang);
                const learned = knowledgeStats[lang] === true;
                return (
                  <View key={lang} style={styles.statsLanguageRow}>
                    <Text style={styles.statsLanguageName}>{language?.flag} {language?.label || lang.toUpperCase()}</Text>
                    <Text style={[styles.statsLanguageStatus, learned ? styles.statsLanguageStatusLearned : styles.statsLanguageStatusPending]}>
                      {learned ? '✓ Выучено' : '○ В процессе'} · {showStats[lang] || 0} пок.
                    </Text>
                  </View>
                );
              })}
            </View>

            <TouchableOpacity style={styles.statsCloseBtn} onPress={() => setIsStatsVisible(false)}>
              <Text style={styles.statsCloseBtnText}>Закрыть</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Workout Result Modal */}
      <Modal visible={resultModalVisible} transparent={true} animationType="fade" onRequestClose={closeResult}>
        <View style={styles.modalOverlay}>
          <View style={styles.resultModalCard}>
            <PapandaIcon name="check" size={28} />
            <Text style={styles.resultTitle}>Сессия Wink завершена!</Text>

            <View style={styles.resultStatsRow}>
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatValueKnown}>{workoutResult.known}</Text>
                <Text style={styles.resultStatLabel}>Знаю</Text>
              </View>
              <View style={styles.resultStatDivider} />
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatValueUnknown}>{workoutResult.unknown}</Text>
                <Text style={styles.resultStatLabel}>Не знаю</Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.resultOkBtn}
              onPress={closeResult}
            >
              <Text style={styles.resultOkBtnText}>Отлично!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: UI.canvas },
  container: {
    flexGrow: 1,
    width: '100%',
    maxWidth: UI.column,
    alignSelf: 'center',
    backgroundColor: UI.canvas,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  headerSection: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  langBadge: {
    backgroundColor: ACCENT_LIGHT,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: ACCENT_BORDER,
  },
  langBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: ACCENT_DARK,
  },
  progressPill: {
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  progressText: {
    fontSize: 13,
    color: '#718096',
  },
  cardArea: {
    flex: 1,
    justifyContent: 'center',
    marginVertical: 10,
  },
  cardMotion: {
    width: '100%',
    position: 'relative',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: UI.radius,
    padding: 16,
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ECEFF1',
    position: 'relative',
  },
  cardToolbar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardToolbarActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    flexShrink: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
  },
  editCardBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  editCardBtnText: {
    fontSize: 16,
  },
  favCardBtn: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  favCardBtnText: {
    fontSize: 18,
  },
  learnedBadge: { alignSelf: 'flex-start', paddingVertical: 4 },
  learnedBadgeText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '700',
  },
  statsCardBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 10 },
  statsCardBtnText: {
    color: ACCENT_DARK,
    fontSize: 12,
    fontWeight: '700',
  },
  auditNotice: { width: '100%', alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  auditMessage: { fontSize: 13, lineHeight: 19, color: UI.muted, textAlign: 'center', marginVertical: 4 },
  auditVerified: { color: '#059669' },
  auditWarning: { color: '#B45309' },
  targetForeignWord: {
    fontSize: 26,
    lineHeight: 34,
    fontWeight: 'bold',
    color: UI.text,
    textAlign: 'center',
    marginVertical: 10,
  },
  previousAnswer: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 12,
  },
  showCount: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'left',
    minWidth: 44,
    flexShrink: 0,
    marginRight: 'auto',
  },
  divider: {
    width: '90%',
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 16,
  },
  answerBox: {
    alignItems: 'center',
    width: '100%',
    minHeight: 120,
    justifyContent: 'center',
  },
  nativeRu: {
    flexShrink: 1,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: 'bold',
    color: '#1A202C',
    textAlign: 'center',
    marginBottom: 6,
  },
  answerBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    width: '100%',
    gap: 12,
  },
  workoutPronunciationBtn: {
    flexShrink: 0,
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 6,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  workoutPronunciationBtnText: {
    fontSize: 16,
  },
  engWord: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 10,
  },
  assocNote: {
    backgroundColor: UI.subtle,
    borderWidth: 1,
    borderColor: UI.border,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
    width: '100%',
  },
  assocNoteTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#B45309',
    marginBottom: 2,
  },
  assocNoteText: {
    ...UI.reading,
    color: UI.body,
  },
  meaningText: {
    fontSize: 13,
    color: UI.muted,
    marginTop: 8,
    textAlign: 'center',
  },
  tapToRevealContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    minHeight: 120,
    justifyContent: 'center',
  },
  tapToRevealIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  tapToRevealText: {
    fontSize: 14,
    color: UI.muted,
    fontWeight: '500',
  },
  bottomZone: {
    width: '100%',
    paddingTop: 10,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    marginBottom: 12,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtnIcon: {
    fontSize: 16,
    color: ACCENT,
    marginRight: 4,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: ACCENT,
  },
  swipeStamp: {
    position: 'absolute',
    top: 52,
    zIndex: 99,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 2,
    elevation: 4,
  },
  swipeStampKnown: {
    left: 16,
    borderColor: '#16A34A',
    backgroundColor: 'rgba(240, 253, 244, 0.95)',
    transform: [{ rotate: '-12deg' }],
  },
  swipeStampKnownText: {
    color: '#16A34A',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  swipeStampUnknown: {
    right: 16,
    borderColor: '#DC2626',
    backgroundColor: 'rgba(254, 242, 242, 0.95)',
    transform: [{ rotate: '12deg' }],
  },
  swipeStampUnknownText: {
    color: '#DC2626',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  scoreKnown: {
    fontSize: 14,
    fontWeight: '600',
    color: '#28A745',
  },
  scoreUnknown: {
    fontSize: 14,
    fontWeight: '600',
    color: '#DC3545',
  },
  swipeHintRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  swipeHintText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  swipeHintDot: {
    fontSize: 12,
    color: '#CBD5E1',
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnUnknown: {
    backgroundColor: UI.subtle,
  },
  btnSnooze: {
    backgroundColor: '#E2E8F0',
  },
  btnSnoozeText: {
    color: '#475569',
  },
  btnKnown: {
    backgroundColor: ACCENT,
  },
  btnArrow: {
    fontSize: 16,
    fontWeight: 'bold',
    color: UI.onAccent,
    marginRight: 4,
  },
  btnArrowKnown: {
    marginRight: 0,
    marginLeft: 4,
  },
  btnIcon: {
    color: UI.onAccent,
    fontSize: 20,
    fontWeight: 'bold',
    marginRight: 4,
  },
  btnText: {
    color: UI.onAccent,
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyCard: {
    backgroundColor: '#FFF',
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptySub: {
    fontSize: 15,
    color: '#718096',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 10,
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A202C',
    textAlign: 'center',
  },
  favoriteToggleBtn: {
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  favoriteToggleBtnActive: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  favoriteToggleText: {
    fontSize: 13,
    color: '#718096',
    fontWeight: '600',
  },
  favoriteToggleTextActive: {
    color: '#D97706',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  resultModalCard: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: UI.radius,
    padding: 24,
    alignItems: 'center',
  },
  resultIcon: {
    fontSize: 54,
    marginBottom: 16,
  },
  resultTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A202C',
    textAlign: 'center',
    marginBottom: 24,
  },
  resultStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    marginBottom: 24,
    width: '100%',
  },
  resultStatBox: {
    flex: 1,
    alignItems: 'center',
  },
  resultStatDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#E2E8F0',
  },
  resultStatValueKnown: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#10B981', // Green
    marginBottom: 4,
  },
  resultStatValueUnknown: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#F59E0B', // Amber/Orange
    marginBottom: 4,
  },
  resultStatLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  resultOkBtn: {
    backgroundColor: ACCENT,
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  resultOkBtnText: {
    color: UI.onAccent,
    fontSize: 16,
    fontWeight: 'bold',
  },
  statsModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFF',
    borderRadius: UI.radius,
    padding: 24,
  },
  statsModalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1A202C',
    textAlign: 'center',
  },
  statsModalWord: {
    fontSize: 24,
    fontWeight: 'bold',
    color: ACCENT,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18,
  },
  statsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 20,
  },
  statsSummaryItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  statsSummaryValue: {
    color: '#1E293B',
    fontSize: 17,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  statsSummaryLabel: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
    marginTop: 3,
    textAlign: 'center',
  },
  statsSummaryDivider: {
    width: 1,
    height: 38,
    backgroundColor: '#E2E8F0',
  },
  statsLanguagesTitle: {
    color: '#475569',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  statsLanguagesList: {
    gap: 8,
  },
  statsLanguageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  statsLanguageName: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  statsLanguageStatus: {
    fontSize: 12,
    fontWeight: '700',
  },
  statsLanguageStatusLearned: {
    color: '#16A34A',
  },
  statsLanguageStatusPending: {
    color: '#64748B',
  },
  statsCloseBtn: {
    backgroundColor: ACCENT,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  statsCloseBtnText: {
    color: UI.onAccent,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
