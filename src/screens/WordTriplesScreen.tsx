import { useShallow } from 'zustand/react/shallow';
import { useIsFocused } from '@react-navigation/native';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, ScrollView, Platform, PanResponder, Modal, Animated, ActivityIndicator, Alert } from 'react-native';
import TouchableOpacity from '../components/PapandaAction';
import type { WordTriplesScreenProps } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';
import { getWordKey, getWordTranslation } from '../utils/words';
import { readWordStats } from '../utils/statistics';
import { buildWordTour } from '../utils/wordCards';
import { canStudyWord } from '../utils/wordStudy';
import { captureKnowledgeUndo, type KnowledgeUndo } from '../utils/wordProgress';
import { auditNextWordInBackground, auditWordManually } from '../services/wordAuditService';
import { useCardTransition } from '../hooks/useCardTransition';
import { usePronunciation } from '../hooks/usePronunciation';
import PronunciationModal from '../components/PronunciationModal';
import { papanda } from '../design/papanda';
import PapandaIcon from '../components/PapandaIcon';


const SWIPE_THRESHOLD = 72;
const SWIPE_EXIT_DISTANCE = 520;
const SWIPE_ENTRY_OFFSET = 56;

const isHorizontalSwipe = (gesture: { dx: number; dy: number }) =>
  Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.4;

export default function WordTriplesScreen({ navigation }: WordTriplesScreenProps) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { words, activeLanguages, wordTourSize, markTripleKnown, recordTripleCardShow, undoWordKnowledge, toggleWordFavorite, userWordProgress, setTargetSentenceInfo } = useStore(useShallow(state => ({
    words: state.words,
    activeLanguages: state.activeLanguages,
    wordTourSize: state.wordTourSize,
    markTripleKnown: state.markTripleKnown,
    recordTripleCardShow: state.recordTripleCardShow,
    undoWordKnowledge: state.undoWordKnowledge,
    toggleWordFavorite: state.toggleWordFavorite,
    userWordProgress: state.userWordProgress,
    setTargetSentenceInfo: state.setTargetSentenceInfo,
  })));
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const tourKeys = React.useRef<string[] | null>(null);
  const tourScope = JSON.stringify([activeLanguages, wordTourSize]);
  const previousScope = React.useRef(tourScope);
  const actionLocked = React.useRef(false);
  React.useLayoutEffect(() => { actionLocked.current = false; }, [sessionCount, currentWord?.eng, currentWord?.word, tourScope]);
  const [history, setHistory] = useState<{word: Word, undo?: KnowledgeUndo}[]>([]);
  const [isAuditingWord, setIsAuditingWord] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const manualAuditAbortRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      manualAuditAbortRef.current?.abort();
    };
  }, []);

  const isTourComplete = sessionCount >= wordTourSize || (sessionCount > 0 && !currentWord);
  const { isPronunciationModalVisible, setIsPronunciationModalVisible, pronunciationExplanation,
    setPronunciationExplanation, isPronunciationLoading, handlePronunciation,
    pronunciationMode, changePronunciationMode, pronunciationError, retryPronunciation } = usePronunciation();

  // Avoid stale closures in PanResponder
  const callbacks = React.useRef({
    handleSwipe: (_direction: 'left' | 'right') => {},
    resetCardPosition: () => {},
  });
  const transition = useCardTransition({
    enabled: isFocused && !isModalVisible && !isStatsVisible && !isPronunciationModalVisible,
    scope: JSON.stringify([activeLanguages, wordTourSize]), cardKey: currentWord?.eng || currentWord?.word || '',
    onSwipe: direction => direction === 'left' ? handleNext() : handlePrev(),
    canSwipe: direction => direction === 'left' ? !!currentWord && !isTourComplete : history.length > 0,
    distance: SWIPE_EXIT_DISTANCE, entryOffset: SWIPE_ENTRY_OFFSET, duration: 210,
  });
  const cardTranslateX = transition.translateX;
  const isSwipeAnimating = transition.busy;

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => isHorizontalSwipe(gestureState),
      // Claim horizontal drags before a word's sentence button can treat them as taps.
      onMoveShouldSetPanResponderCapture: (_evt, gestureState) => isHorizontalSwipe(gestureState),
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

  const showTourWord = (index: number) => {
    manualAuditAbortRef.current?.abort();
    setIsAuditingWord(false);
    setAuditError(null);
    const { words, activeLanguages } = useStore.getState();
    let chosen: Word | undefined;
    // Remove unavailable pending cards without rebuilding or revisiting the tour.
    while (tourKeys.current && index < tourKeys.current.length) {
      chosen = words.find(word => getWordKey(word) === tourKeys.current![index]);
      if (chosen && canStudyWord(chosen, activeLanguages)) break;
      tourKeys.current.splice(index, 1);
      chosen = undefined;
    }
    if (!chosen) {
      setCurrentWord(null);
      return;
    }

    setCurrentWord(chosen);
    recordTripleCardShow(chosen.eng || chosen.word || '');
    setPronunciationExplanation(null);
  };

  const resetTour = () => {
    const state = useStore.getState();
    tourKeys.current = buildWordTour(state.words, state.activeLanguages, state.wordTourSize).map(getWordKey);
    setHistory([]);
    setSessionCount(0);
    showTourWord(0);
  };

  // Sync currentWord with any edits made in the modal/store. The store replaces
  // word objects on every change, so a reference check is enough — no deep compare.
  useEffect(() => {
    if (previousScope.current !== tourScope) {
      previousScope.current = tourScope;
      tourKeys.current = null;
      setHistory([]);
      setSessionCount(0);
      if (isFocused) resetTour();
      else setCurrentWord(null);
      return;
    }
    if (!isFocused || isTourComplete) return;
    if (!tourKeys.current) {
      resetTour();
      return;
    }
    if (!currentWord) return;
    const wordKey = currentWord.eng || currentWord.word;
    const latestWord = words.find(w => (w.eng || w.word) === wordKey);
    if (!latestWord || !canStudyWord(latestWord, activeLanguages)) {
      showTourWord(sessionCount);
    } else if (latestWord !== currentWord) {
      setCurrentWord(latestWord);
    }
  }, [words, currentWord, tourScope, isFocused, isTourComplete]);

  const advanceTour = () => {
    manualAuditAbortRef.current?.abort();
    setIsAuditingWord(false);
    setAuditError(null);
    const nextCount = sessionCount + 1;
    setSessionCount(nextCount);
    if (nextCount >= wordTourSize) {
      setCurrentWord(null);
      setPronunciationExplanation(null);
    } else {
      showTourWord(nextCount);
    }
  };

  const startNewTour = () => {
    if (!transition.beginAction()) return;
    manualAuditAbortRef.current?.abort();
    setIsAuditingWord(false);
    setAuditError(null);
    cardTranslateX.setValue(0);
    resetTour();
  };

  const handleNext = () => {
    if (actionLocked.current || !transition.beginAction()) return;
    if (!currentWord || isTourComplete) return;
    actionLocked.current = true;

    if (currentWord) {
      setHistory(prev => [...prev, { word: currentWord }].slice(-100));
    }

    advanceTour();
  };

  const handleMarkLearned = () => {
    if (actionLocked.current || !transition.beginAction()) return;
    if (currentWord && !isTourComplete) {
      actionLocked.current = true;
      const wordKey = currentWord.eng || currentWord.word || '';
      const undo = captureKnowledgeUndo(currentWord, activeLanguages, true);
      markTripleKnown(wordKey);
      undo.reviewsApplied = useStore.getState().userWordProgress[wordKey]?.review_by_lang;
      setHistory(prev => [...prev, { word: currentWord, undo }].slice(-100));
      advanceTour();
    }
  };

  const handlePrev = () => {
    if (actionLocked.current || !transition.beginAction()) return;
    manualAuditAbortRef.current?.abort();
    setIsAuditingWord(false);
    setAuditError(null);
    if (history.length > 0) {
      actionLocked.current = true;
      const lastAction = history[history.length - 1];
      const wordKey = lastAction.word.eng || lastAction.word.word || '';

      if (lastAction.undo) undoWordKnowledge(wordKey, lastAction.undo);
      recordTripleCardShow(wordKey);

      setSessionCount(prev => Math.max(0, prev - 1));
      setHistory(prev => prev.slice(0, -1));

      const latestWord = useStore.getState().words.find(word => (word.eng || word.word) === wordKey);
      setCurrentWord(latestWord ?? null);
      setPronunciationExplanation(null);
    }
  };

  const runManualAudit = async () => {
    if (!currentWord || isAuditingWord) return;
    manualAuditAbortRef.current?.abort();
    const controller = new AbortController();
    manualAuditAbortRef.current = controller;
    setIsAuditingWord(true);
    setAuditError(null);

    try {
      await auditWordManually(currentWord, activeLanguages, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        const message = err instanceof Error ? err.message : 'Не удалось проверить слово.';
        setAuditError(message);
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsAuditingWord(false);
      }
    }
  };

  const handleAuditButtonPress = () => {
    if (isAuditingWord) return;
    const aiStatus = currentProgress?.ai_verification?.status;
    if (aiStatus === 'flagged') {
      setEditingWord(currentWord);
      setIsModalVisible(true);
      return;
    }
    if (aiStatus === 'verified') {
      Alert.alert(
        'Слово проверено',
        'ИИ проверил написание и перевод — ошибок не обнаружено.\n\nЗапустить проверку повторно?',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Проверить снова', onPress: () => void runManualAudit() },
        ]
      );
      return;
    }
    void runManualAudit();
  };

  const resetCardPosition = transition.reset;
  const handleSwipe = transition.animate;

  // Only the visible word screen audits words. The trainer owns sentence top-ups.
  useEffect(() => {
    if (!isFocused || isTourComplete) return;
    const timer = setTimeout(() => {
      void auditNextWordInBackground();
    }, 1500);
    return () => clearTimeout(timer);
  }, [isFocused, currentWord?.eng, currentWord?.word, sessionCount, activeLanguages.length, isTourComplete]);

  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);

  const currentWordKey = currentWord?.eng || currentWord?.word || '';
  const currentProgress = currentWordKey ? userWordProgress[currentWordKey] : undefined;
  const isFavorite = currentProgress?.is_favorite ?? currentWord?.is_favorite ?? false;
  const knowledgeStats = {
    ...readWordStats(currentWord?.knowledge_stats),
    ...(currentProgress?.knowledge_stats || {}),
  } as Record<string, boolean>;
  const showStats = {
    ...readWordStats(currentWord?.show_stats),
    ...(currentProgress?.show_stats || {}),
  } as Record<string, number>;
  const totalShows = currentProgress?.count ?? currentWord?.count ?? 0;
  const lastShown = currentProgress?.last_shown ?? currentWord?.last_shown;

  callbacks.current.handleSwipe = handleSwipe;
  callbacks.current.resetCardPosition = resetCardPosition;

  const cardOpacity = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, -SWIPE_EXIT_DISTANCE / 2, 0, SWIPE_EXIT_DISTANCE / 2, SWIPE_EXIT_DISTANCE],
    outputRange: [0.15, 0.85, 1, 0.85, 0.15],
    extrapolate: 'clamp',
  });

  const previousWordButton = history.length > 0 ? (
    <TouchableOpacity
      testID="word-undo"
      style={styles.undoButton}
      onPress={handlePrev}
      accessibilityRole="button"
    >
      <Text style={styles.undoButtonText}>
        {history[history.length - 1].undo ? '↶ Отменить «Выучено»' : '← Предыдущее слово'}
      </Text>
    </TouchableOpacity>
  ) : null;

  if (activeLanguages.length === 0) {
    return (
      <View style={[styles.centerContainer, { paddingTop: topPadding }]}>
        <Text style={styles.info}>Пожалуйста, выберите активные языки в Настройках.</Text>
      </View>
    );
  }

  if (isTourComplete) {
    return (
      <View style={[styles.centerContainer, { paddingTop: topPadding }]} testID="word-tour-complete">
        <Text style={styles.headerTitle}>Тур завершён</Text>
        <Text style={styles.info}>Пройдено карточек: {sessionCount}</Text>
        {previousWordButton}
        <TouchableOpacity style={[styles.button, styles.btnKnown, styles.tourStartButton]} onPress={startNewTour} accessibilityRole="button">
          <Text style={styles.buttonText}>Следующий тур</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!currentWord) {
    return (
      <View style={[styles.centerContainer, { paddingTop: topPadding }]}>
        <Text style={styles.info}>Нет доступных слов для выбранной комбинации языков!</Text>
        {previousWordButton}
        <TouchableOpacity onPress={startNewTour} accessibilityRole="button"><Text>Проверить снова</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...panResponder.panHandlers}
    >
      <ScrollView testID="words-scroll" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[styles.innerWrapper, { paddingTop: topPadding }]}>
        {/* Header with comfortable breathing space */}
        <View style={[styles.topHeader, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={styles.headerTitle}>Слова</Text>
            <Text testID="word-tour-progress" style={styles.sessionCountText}>Пройдено: {sessionCount} / {tourKeys.current?.length ?? wordTourSize}</Text>
          </View>
          <TouchableOpacity
            style={styles.dictionaryBtn} accessibilityLabel="Открыть словарь" accessibilityRole="button"
            onPress={() => navigation.navigate('Dictionary')}
          >
            <PapandaIcon name="read" size={24} />
          </TouchableOpacity>
        </View>

        {/* Main Card */}
        <Animated.View
          style={[
            styles.card,
            { transform: [{ translateX: cardTranslateX }], opacity: cardOpacity },
          ]}
        >
          <View style={styles.cardActions}>
            <View
              testID="word-show-count"
              accessibilityLabel={`Показов слова: ${totalShows}`}
              style={styles.showCount}
            >
              <PapandaIcon name="eye" size={16} color={papanda.color.textSecondary} />
              <Text style={styles.metaText}>{totalShows}</Text>
            </View>
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="Изменить отметку избранного" style={styles.favCardBtn}
              accessibilityState={{ selected: isFavorite }}
              onPress={() => {
                const wordKey = currentWord.eng || currentWord.word || '';
                toggleWordFavorite(wordKey);
              }}
            >
              <PapandaIcon name="star" color={isFavorite ? papanda.color.accentHover : papanda.color.textSecondary} />
              {isFavorite && <View style={styles.favoriteMark}><Text style={styles.favoriteMarkText}>✓</Text></View>}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statsCardBtn}
              accessibilityRole="button" accessibilityLabel="Статистика слова"
              onPress={() => setIsStatsVisible(true)}
            >
              <PapandaIcon name="chart" size={16} />
              <Text style={styles.statsCardBtnText}>Статистика</Text>
            </TouchableOpacity>

            <TouchableOpacity
              testID="word-request-audit"
              style={[
                styles.statsCardBtn,
                currentProgress?.ai_verification?.status === 'verified' && styles.auditCardBtnVerified,
                currentProgress?.ai_verification?.status === 'flagged' && styles.auditCardBtnFlagged,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                currentProgress?.ai_verification?.status === 'verified'
                  ? 'Слово проверено ИИ: ошибок не найдено'
                  : currentProgress?.ai_verification?.status === 'flagged'
                  ? 'Обнаружена возможная неточность перевода'
                  : 'Запросить проверку написания и перевода'
              }
              disabled={isAuditingWord}
              onPress={handleAuditButtonPress}
            >
              {isAuditingWord ? (
                <ActivityIndicator size="small" color={papanda.color.accentText} />
              ) : (
                <PapandaIcon
                  name={currentProgress?.ai_verification?.status === 'flagged' ? 'warning' : 'verify'}
                  size={16}
                  color={
                    currentProgress?.ai_verification?.status === 'verified'
                      ? '#059669'
                      : currentProgress?.ai_verification?.status === 'flagged'
                      ? papanda.color.errorText
                      : papanda.color.textSecondary
                  }
                />
              )}
              <Text
                style={[
                  styles.statsCardBtnText,
                  currentProgress?.ai_verification?.status === 'verified' && styles.auditCardBtnTextVerified,
                  currentProgress?.ai_verification?.status === 'flagged' && styles.auditCardBtnTextFlagged,
                ]}
              >
                {isAuditingWord
                  ? 'Проверка...'
                  : currentProgress?.ai_verification?.status === 'verified'
                  ? 'Проверено'
                  : currentProgress?.ai_verification?.status === 'flagged'
                  ? 'Неточность'
                  : 'Проверить'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="Редактировать слово" style={styles.editCardBtn}
              onPress={() => {
                setEditingWord(currentWord);
                setIsModalVisible(true);
              }}
            >
              <PapandaIcon name="edit" />
            </TouchableOpacity>
          </View>

          <Text style={styles.nativeWord}>{currentWord.ru}</Text>

          {isAuditingWord && (
            <View style={styles.aiCheckingBanner} testID="word-audit-loading">
              <ActivityIndicator size="small" color={papanda.color.accentText} />
              <Text style={styles.aiCheckingText}>ИИ проверяет написание и перевод...</Text>
            </View>
          )}

          {Boolean(auditError) && !isAuditingWord && (
            <View style={styles.aiErrorBanner} testID="word-audit-error">
              <PapandaIcon name="warning" color={papanda.color.errorText} size={16} />
              <View style={{ flex: 1 }}>
                <Text style={styles.aiErrorText}>{auditError}</Text>
              </View>
              <TouchableOpacity onPress={() => void runManualAudit()}>
                <Text style={styles.aiRetryText}>Повторить</Text>
              </TouchableOpacity>
            </View>
          )}

          {currentProgress?.ai_verification?.status === 'verified' && !isAuditingWord && (
            <View style={styles.aiVerifiedBanner} testID="word-audit-verified">
              <PapandaIcon name="verify" color="#059669" size={16} />
              <Text style={styles.aiVerifiedText}>Проверено ИИ: написание и перевод точны</Text>
            </View>
          )}

          {currentProgress?.ai_verification?.status === 'flagged' && !isAuditingWord && (
            <TouchableOpacity
              style={styles.aiWarningBanner}
              activeOpacity={0.8}
              onPress={() => {
                setEditingWord(currentWord);
                setIsModalVisible(true);
              }}
            >
              <PapandaIcon name="warning" color={papanda.color.errorText} />
              <View style={{ flex: 1 }}>
                <Text style={styles.aiWarningTitle}>Возможна неточность перевода (ИИ)</Text>
                {currentProgress.ai_verification.issues?.map((iss, i) => (
                  <Text key={i} style={styles.aiWarningIssue}>
                    • {iss.lang.toUpperCase()}: {iss.issue} {iss.suggestion ? `(совет: ${iss.suggestion})` : ''}
                  </Text>
                ))}
              </View>
              <PapandaIcon name="edit" size={16} />
            </TouchableOpacity>
          )}

          <View style={styles.divider} />

          {/* Large Centered Words with Subtle Side Badges */}
          <View style={styles.langsContainer}>
            {activeLanguages.map(lang => {
              const translation = getWordTranslation(currentWord, lang);
              const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';
              const composeSentence = () => {
                if (!transition.beginAction()) return;
                setTargetSentenceInfo({ langCode: lang, highlightWord: translation });
                navigation.navigate('Sentence Trainer');
              };

              return (
                <View key={lang} style={styles.langBlock}>
                  {/* Subtle Language Indicator on the Left Side */}
                  <View style={styles.sideBadge}>
                    <Text style={styles.sideFlag}>{langFlag}</Text>
                    <Text style={styles.sideLangCode}>{lang.toUpperCase()}</Text>
                  </View>

                  {/* Prominent Centered Translation — tap to practise it in a generated sentence */}
                  <TouchableOpacity
                    testID={`word-sentence-${lang}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Предложение со словом ${translation}`}
                    style={styles.wordCenterContainer}
                    activeOpacity={translation ? 0.6 : 1}
                    disabled={!translation}
                    onPress={composeSentence}
                  >
                    <Text style={styles.langTranslation}>{translation || '—'}</Text>
                  </TouchableOpacity>

                  {/* Action Buttons: Sentence composition & Pronunciation explanation */}
                  {translation && (
                    <View style={styles.langActions}>
                      <TouchableOpacity
                        testID={`word-compose-${lang}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Составить предложение со словом ${translation}`}
                        style={styles.langActionBtn}
                        activeOpacity={0.7}
                        onPress={composeSentence}
                      >
                        <PapandaIcon name="language" />
                      </TouchableOpacity>

                      <TouchableOpacity
                        accessibilityLabel="Разбор произношения"
                        accessibilityRole="button"
                        style={styles.langActionBtn}
                        activeOpacity={0.7}
                        onPress={() => handlePronunciation(translation, lang, currentWord?.ru || currentWord?.meaning || '')}
                      >
                        <PapandaIcon name="microphone" />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
          </View>

        </Animated.View>

        {/* Bottom Actions */}
        <View style={styles.controls}>
          <TouchableOpacity
            testID="word-mark-learned"
            accessibilityRole="button"
            accessibilityLabel="Выучено"
            accessibilityHint="Отметить переводы как выученные и перейти к следующему слову"
            style={styles.learnedButton}
            activeOpacity={0.7}
            onPress={handleMarkLearned}
          >
            <PapandaIcon name="check" size={24} color={papanda.color.textBody} />
          </TouchableOpacity>
        </View>
        {previousWordButton}
      </ScrollView>

      <EditWordModal
        visible={isModalVisible}
        onClose={() => setIsModalVisible(false)}
        wordToEdit={editingWord}
      />

      <Modal
        visible={isStatsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsStatsVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.statsModalCard}>
            <Text style={styles.statsModalTitle}>Статистика слова</Text>
            <Text style={styles.statsModalWord}>{currentWord.ru}</Text>

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

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: papanda.color.canvas,
  },
  innerWrapper: {
    flexGrow: 1,
    width: '100%',
    maxWidth: papanda.learningColumnWidth,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: papanda.color.canvas,
  },
  tourStartButton: {
    flex: 0,
    paddingHorizontal: 24,
    marginTop: 16,
  },
  topHeader: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '600',
    color: papanda.color.text,
  },
  sessionCountText: {
    fontSize: 14,
    color: papanda.color.textSecondary,
    marginTop: 4,
  },
  info: {
    fontSize: 16,
    color: papanda.color.textBody,
    textAlign: 'center',
    maxWidth: papanda.learningColumnWidth,
    lineHeight: 24,
  },
  card: {
    backgroundColor: papanda.color.surface,
    padding: 16,
    borderRadius: papanda.radius.surface,
    borderWidth: 1,
    borderColor: papanda.color.borderSubtle,
    position: 'relative',
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 4,
    rowGap: 8,
    marginBottom: 2,
  },
  editCardBtn: {
    minWidth: 44, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: papanda.radius.control,
  },
  favCardBtn: {
    minWidth: 44, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: papanda.radius.control,
  },
  favoriteMark: { position: 'absolute', right: 2, bottom: 4, backgroundColor: papanda.color.surface, borderRadius: 4 },
  favoriteMarkText: { fontSize: 12, lineHeight: 14, color: papanda.color.accentText },
  statsCardBtn: {
    flexDirection: 'row', gap: 4,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: papanda.radius.control,
  },
  statsCardBtnText: {
    color: papanda.color.accentText,
    fontSize: 12,
    fontWeight: '600',
  },
  nativeWord: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600',
    textAlign: 'center',
    color: papanda.color.text,
    marginVertical: 12,
  },
  showCount: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginRight: 'auto',
    flexShrink: 0,
    minWidth: 40,
  },
  metaText: { fontSize: 12, color: papanda.color.textSecondary },
  wordCenterContainer: {
    flex: 1,
    minHeight: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  langActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: 2,
  },
  langActionBtn: {
    minWidth: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: papanda.radius.control,
  },
  pronunciationBtn: {
    minWidth: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: papanda.radius.control,
  },
  divider: {
    height: 1,
    backgroundColor: papanda.color.borderSubtle,
    marginVertical: 12,
  },
  langsContainer: {
    flexDirection: 'column',
    gap: 8,
  },
  langBlock: {
    backgroundColor: papanda.color.surface,
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: papanda.radius.control,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  aiWarningBanner: {
    minHeight: 44,
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiWarningTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  aiWarningIssue: {
    fontSize: 14,
    color: '#78350F',
    marginTop: 1,
  },
  auditCardBtnVerified: {
    backgroundColor: '#ECFDF5',
  },
  auditCardBtnFlagged: {
    backgroundColor: '#FEF3C7',
  },
  auditCardBtnTextVerified: {
    color: '#059669',
    fontWeight: '700',
  },
  auditCardBtnTextFlagged: {
    color: '#B45309',
    fontWeight: '700',
  },
  aiVerifiedBanner: {
    minHeight: 40,
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiVerifiedText: {
    fontSize: 13,
    color: '#065F46',
    fontWeight: '600',
    flex: 1,
  },
  aiCheckingBanner: {
    minHeight: 40,
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiCheckingText: {
    fontSize: 13,
    color: papanda.color.textSecondary,
    flex: 1,
  },
  aiErrorBanner: {
    minHeight: 40,
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiErrorText: {
    fontSize: 13,
    color: '#991B1B',
    flex: 1,
  },
  aiRetryText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B91C1C',
    textDecorationLine: 'underline',
  },
  sideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: papanda.color.surfaceSubtle,
    minWidth: 46,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: papanda.radius.small,
  },
  sideFlag: {
    fontSize: 12,
  },
  sideLangCode: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },

  langTranslation: {
    width: '100%',
    flexShrink: 1,
    fontSize: 22,
    lineHeight: 30,
    color: papanda.color.text,
    fontWeight: '600',
    textAlign: 'left',
  },
  assocHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap', gap: 8,
    marginBottom: 8,
  },
  assocTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  assocLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: papanda.color.textBody,
  },
  assocSavedBadge: {
    fontSize: 12,
    fontWeight: '500',
    color: papanda.color.successText,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: papanda.color.border,
    borderRadius: papanda.radius.control,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 16,
    lineHeight: 24,
    backgroundColor: papanda.color.surface,
    color: papanda.color.text,
  },
  inputWithContent: {
    backgroundColor: papanda.color.surface,
    borderColor: papanda.color.border,
  },
  inputFocused: { borderColor: papanda.focus.color, borderWidth: 2, paddingHorizontal: 11, paddingVertical: 7 },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
  },
  learnedButton: {
    width: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: papanda.radius.control,
  },
  undoButton: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoButtonText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    minHeight: papanda.control.minHeightPx,
    borderRadius: papanda.radius.control,
    alignItems: 'center',
  },
  dictionaryBtn: {
    minWidth: 44, minHeight: 44,
    alignItems: 'center', justifyContent: 'center',
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: papanda.radius.control,
  },
  btnPrev: {
    backgroundColor: '#94A3B8'
  },
  btnNext: {
    backgroundColor: '#64748B'
  },
  btnKnown: {
    backgroundColor: papanda.color.accent,
  },
  buttonText: {
    color: papanda.color.onAccent,
    fontSize: 16,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statsModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFF',
    borderRadius: 12,
    padding: 16,
  },
  statsModalTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: papanda.color.text,
    textAlign: 'center',
  },
  statsModalWord: {
    fontSize: 24,
    fontWeight: 'bold',
    color: papanda.color.accentText,
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
    flexShrink: 1,
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
    backgroundColor: papanda.color.accent,
    borderRadius: papanda.radius.control,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  statsCloseBtnText: {
    color: papanda.color.onAccent,
    fontSize: 16,
    fontWeight: 'bold',
  },
});
