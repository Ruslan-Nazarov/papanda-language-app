import { useShallow } from 'zustand/react/shallow';
import { useIsFocused } from '@react-navigation/native';
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, ScrollView, Platform, PanResponder, Modal, Animated, Easing } from 'react-native';
import type { WordTriplesScreenProps } from '../navigation/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';
import { getWordTranslation } from '../utils/words';
import { readWordStats } from '../utils/statistics';
import { pickWordCard } from '../utils/wordCards';
import { captureKnowledgeUndo, type KnowledgeUndo } from '../utils/wordProgress';
import { auditNextWordInBackground } from '../services/wordAuditService';
import { usePronunciation } from '../hooks/usePronunciation';
import PronunciationModal from '../components/PronunciationModal';
import { ACCENT, ACCENT_DARK, ACCENT_LIGHT, ACCENT_BORDER } from '../constants/theme';


const SWIPE_THRESHOLD = 72;
const SWIPE_EXIT_DISTANCE = 520;
const SWIPE_ENTRY_OFFSET = 56;


export default function WordTriplesScreen({ navigation }: WordTriplesScreenProps) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { words, activeLanguages, wordTourSize, markTripleKnown, recordTripleCardShow, saveWordAssociation, undoWordKnowledge, toggleWordFavorite, userWordProgress, setTargetSentenceInfo } = useStore(useShallow(state => ({
    words: state.words,
    activeLanguages: state.activeLanguages,
    wordTourSize: state.wordTourSize,
    markTripleKnown: state.markTripleKnown,
    recordTripleCardShow: state.recordTripleCardShow,
    saveWordAssociation: state.saveWordAssociation,
    undoWordKnowledge: state.undoWordKnowledge,
    toggleWordFavorite: state.toggleWordFavorite,
    userWordProgress: state.userWordProgress,
    setTargetSentenceInfo: state.setTargetSentenceInfo,
  })));
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [associationText, setAssociationText] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [history, setHistory] = useState<{word: Word, undo?: KnowledgeUndo}[]>([]);
  const isTourComplete = sessionCount >= wordTourSize || (sessionCount > 0 && !currentWord);
  const { isPronunciationModalVisible, setIsPronunciationModalVisible, pronunciationExplanation,
    setPronunciationExplanation, isPronunciationLoading, handlePronunciation,
    pronunciationMode, changePronunciationMode, pronunciationError, retryPronunciation } = usePronunciation();

  // Avoid stale closures in PanResponder
  const callbacks = React.useRef({
    handleSwipe: (_direction: 'left' | 'right') => {},
    resetCardPosition: () => {},
  });
  const cardTranslateX = React.useRef(new Animated.Value(0)).current;
  const isSwipeAnimating = React.useRef(false);

  const panResponder = React.useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_evt, gestureState) => {
        return Math.abs(gestureState.dx) > 8 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy) * 1.4;
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

  const pickRandomWord = () => {
    const { words, activeLanguages } = useStore.getState();
    const chosen = pickWordCard(words, activeLanguages, currentWord?.eng || currentWord?.word);
    if (!chosen) {
      setCurrentWord(null);
      return;
    }

    setCurrentWord(chosen);
    setAssociationText(chosen.personal_association || '');
    recordTripleCardShow(chosen.eng || chosen.word || '');
    setPronunciationExplanation(null);
  };

  // Sync currentWord with any edits made in the modal/store. The store replaces
  // word objects on every change, so a reference check is enough — no deep compare.
  const previousLanguages = React.useRef(activeLanguages);
  const previousTourSize = React.useRef(wordTourSize);
  useEffect(() => {
    if (previousLanguages.current !== activeLanguages || previousTourSize.current !== wordTourSize) {
      previousLanguages.current = activeLanguages;
      previousTourSize.current = wordTourSize;
      setHistory([]);
      setSessionCount(0);
      if (isFocused) pickRandomWord();
      else setCurrentWord(null);
      return;
    }
    if (!isFocused || isTourComplete) return;
    if (!currentWord) {
      pickRandomWord();
      return;
    }
    const wordKey = currentWord.eng || currentWord.word;
    const latestWord = words.find(w => (w.eng || w.word) === wordKey);
    if (!latestWord || !activeLanguages.every(lang => getWordTranslation(latestWord, lang))) {
      pickRandomWord();
    } else if (latestWord !== currentWord) {
      setCurrentWord(latestWord);
      if (latestWord.personal_association !== currentWord.personal_association) {
        setAssociationText(latestWord.personal_association || '');
      }
    }
  }, [words, currentWord, activeLanguages, wordTourSize, isFocused, isTourComplete]);

  const advanceTour = () => {
    const nextCount = sessionCount + 1;
    setSessionCount(nextCount);
    if (nextCount >= wordTourSize) {
      setCurrentWord(null);
      setPronunciationExplanation(null);
    } else {
      pickRandomWord();
    }
  };

  const startNewTour = () => {
    setSessionCount(0);
    setHistory([]);
    cardTranslateX.setValue(0);
    pickRandomWord();
  };

  const handleNext = () => {
    if (!currentWord || isTourComplete) return;
    if (currentWord && associationText !== currentWord.personal_association) {
      saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
    }

    if (currentWord) {
      setHistory(prev => [...prev, { word: currentWord }].slice(-100));
    }

    advanceTour();
  };

  const handleMarkLearned = () => {
    if (currentWord && !isTourComplete) {
      if (associationText !== currentWord.personal_association) {
        saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
      }

      const wordKey = currentWord.eng || currentWord.word || '';
      setHistory(prev => [...prev, {
        word: currentWord,
        undo: captureKnowledgeUndo(currentWord, activeLanguages, true),
      }].slice(-100));

      markTripleKnown(wordKey);
      advanceTour();
    }
  };

  const handlePrev = () => {
    if (history.length > 0) {
      if (currentWord && associationText !== (currentWord.personal_association || '')) {
        saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
      }
      const lastAction = history[history.length - 1];
      const wordKey = lastAction.word.eng || lastAction.word.word || '';

      if (lastAction.undo) undoWordKnowledge(wordKey, lastAction.undo);
      recordTripleCardShow(wordKey);

      setSessionCount(prev => Math.max(0, prev - 1));
      setHistory(prev => prev.slice(0, -1));

      const latestWord = useStore.getState().words.find(word => (word.eng || word.word) === wordKey);
      setCurrentWord(latestWord ?? null);
      setAssociationText(latestWord?.personal_association || '');
      setPronunciationExplanation(null);
    }
  };

  const resetCardPosition = () => {
    if (isSwipeAnimating.current) return;
    Animated.spring(cardTranslateX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 18,
      bounciness: 5,
    }).start();
  };


  const handleSwipe = (direction: 'left' | 'right') => {
    // Right swipe undoes the previous card; keep it in place if nothing to undo.
    if (direction === 'right' && history.length === 0) {
      resetCardPosition();
      return;
    }
    if (isSwipeAnimating.current) return;
    isSwipeAnimating.current = true;

    const exitDirection = direction === 'left' ? -1 : 1;
    Animated.timing(cardTranslateX, {
      toValue: exitDirection * SWIPE_EXIT_DISTANCE,
      duration: 210,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        isSwipeAnimating.current = false;
        return;
      }
      // Drop the next card just beyond the opposite edge, then spring it home.
      cardTranslateX.setValue(-exitDirection * SWIPE_ENTRY_OFFSET);
      if (direction === 'left') {
        handleNext();
      } else {
        handlePrev();
      }
      requestAnimationFrame(() => {
        Animated.spring(cardTranslateX, {
          toValue: 0,
          useNativeDriver: true,
          speed: 18,
          bounciness: 4,
        }).start(() => {
          isSwipeAnimating.current = false;
        });
      });
    });
  };

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

  const cardRotation = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, 0, SWIPE_EXIT_DISTANCE],
    outputRange: ['-7deg', '0deg', '7deg'],
    extrapolate: 'clamp',
  });
  const cardOpacity = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, -SWIPE_EXIT_DISTANCE / 2, 0, SWIPE_EXIT_DISTANCE / 2, SWIPE_EXIT_DISTANCE],
    outputRange: [0.15, 0.85, 1, 0.85, 0.15],
    extrapolate: 'clamp',
  });

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
        <TouchableOpacity style={[styles.button, styles.btnKnown, styles.tourStartButton]} onPress={startNewTour} accessibilityRole="button">
          <Text style={styles.buttonText}>Следующий тур</Text>
        </TouchableOpacity>
        {history.length > 0 && (
          <TouchableOpacity onPress={handlePrev} accessibilityRole="button" style={{ marginTop: 16 }}>
            <Text style={styles.statsCardBtnText}>Вернуть предыдущее слово</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  if (!currentWord) {
    return (
      <View style={[styles.centerContainer, { paddingTop: topPadding }]}>
        <Text style={styles.info}>Нет доступных слов для выбранной комбинации языков!</Text>
        {history.length > 0 && (
          <TouchableOpacity onPress={handlePrev} accessibilityRole="button">
            <Text style={styles.statsCardBtnText}>Вернуть предыдущее слово</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...panResponder.panHandlers}
    >
      <ScrollView testID="words-scroll" keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.innerWrapper, { paddingTop: topPadding }]}>
        {/* Header with comfortable breathing space */}
        <View style={[styles.topHeader, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={styles.headerTitle}>Слова</Text>
            <Text testID="word-tour-progress" style={styles.sessionCountText}>Пройдено: {sessionCount} / {wordTourSize}</Text>
          </View>
          <TouchableOpacity
            style={styles.dictionaryBtn} accessibilityLabel="Открыть словарь" accessibilityRole="button"
            onPress={() => navigation.navigate('Dictionary')}
          >
            <Text style={{fontSize: 24}}>📖</Text>
          </TouchableOpacity>
        </View>

        {/* Main Card */}
        <Animated.View
          style={[
            styles.card,
            { transform: [{ translateX: cardTranslateX }, { rotate: cardRotation }], opacity: cardOpacity },
          ]}
        >
          <View style={styles.cardActions}>
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="Изменить отметку избранного" style={styles.favCardBtn}
              onPress={() => {
                const wordKey = currentWord.eng || currentWord.word || '';
                toggleWordFavorite(wordKey);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={[styles.editCardBtnText, (userWordProgress[currentWord.eng || currentWord.word || '']?.is_favorite ?? currentWord.is_favorite) ? {color: '#F59E0B'} : {color: '#D1D5DB'}]}>
                {(userWordProgress[currentWord.eng || currentWord.word || '']?.is_favorite ?? currentWord.is_favorite) ? '★' : '☆'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statsCardBtn}
              onPress={() => setIsStatsVisible(true)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.statsCardBtnText}>📊 Статистика</Text>
            </TouchableOpacity>

            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel="Редактировать слово" style={styles.editCardBtn}
              onPress={() => {
                setEditingWord(currentWord);
                setIsModalVisible(true);
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.editCardBtnText}>✏️</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.nativeWord}>{currentWord.ru}</Text>
          <Text testID="word-show-count" style={styles.showCount}>
            Показов слова: {totalShows}
          </Text>

          {currentProgress?.ai_verification?.status === 'flagged' && (
            <TouchableOpacity
              style={styles.aiWarningBanner}
              activeOpacity={0.8}
              onPress={() => {
                setEditingWord(currentWord);
                setIsModalVisible(true);
              }}
            >
              <Text style={styles.aiWarningIcon}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.aiWarningTitle}>Возможна неточность перевода (ИИ)</Text>
                {currentProgress.ai_verification.issues?.map((iss, i) => (
                  <Text key={i} style={styles.aiWarningIssue}>
                    • {iss.lang.toUpperCase()}: {iss.issue} {iss.suggestion ? `(совет: ${iss.suggestion})` : ''}
                  </Text>
                ))}
              </View>
              <Text style={styles.aiWarningEdit}>✏️</Text>
            </TouchableOpacity>
          )}

          <View style={styles.divider} />

          {/* Large Centered Words with Subtle Side Badges */}
          <View style={styles.langsContainer}>
            {activeLanguages.map(lang => {
              const translation = getWordTranslation(currentWord, lang);
              const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';

              return (
                <View key={lang}>
                <View style={styles.langBlock}>
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
                    onPress={() => {
                      setTargetSentenceInfo({ langCode: lang, highlightWord: translation });
                      navigation.navigate('Sentence Trainer');
                    }}
                  >
                    <Text style={styles.langTranslation}>{translation || '—'}</Text>
                  </TouchableOpacity>

                  {/* Pronunciation Button */}
                  {translation && (
                    <TouchableOpacity
                      accessibilityLabel="Разбор произношения" accessibilityRole="button"
                      style={styles.pronunciationBtn}
                      activeOpacity={0.7}
                      onPress={() => handlePronunciation(translation, lang, currentWord?.ru || currentWord?.meaning || '')}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Text style={styles.pronunciationBtnText}>📢</Text>
                    </TouchableOpacity>
                  )}
                </View>
                </View>
              );
            })}
          </View>

          <View style={styles.divider} />

          {/* Association Input */}
          <View style={styles.assocHeaderRow}>
            <Text style={styles.assocLabel}>💡 Личная ассоциация:</Text>
            {!!associationText.trim() && (
              <Text style={styles.assocSavedBadge}>✓ есть ассоциация</Text>
            )}
          </View>
          <TextInput
            style={[styles.input, !!associationText.trim() && styles.inputWithContent]}
            multiline
            placeholder="Что поможет вам запомнить это слово?"
            testID="word-association"
            placeholderTextColor="#A0AEC0"
            value={associationText}
            onChangeText={setAssociationText}
          />
        </Animated.View>

        {/* Bottom Actions */}
        <View style={styles.controls}>
          <TouchableOpacity style={[styles.button, styles.btnKnown]} activeOpacity={0.8} onPress={handleMarkLearned}>
            <Text style={styles.buttonText}>✓ Выучено</Text>
          </TouchableOpacity>
        </View>
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
    backgroundColor: '#F8F9FA'
  },
  innerWrapper: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingBottom: 14,
    justifyContent: 'space-between',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F8F9FA'
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
    fontWeight: 'bold',
    color: '#1A202C',
    letterSpacing: 0.3,
  },
  sessionCountText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '600'
  },
  info: {
    fontSize: 16,
    color: '#718096',
    textAlign: 'center'
  },
  card: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#ECEFF1',
    position: 'relative',
  },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginBottom: 2,
  },
  editCardBtn: {
    padding: 4,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  favCardBtn: {
    padding: 4,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editCardBtnText: {
    fontSize: 16,
  },
  statsCardBtn: {
    backgroundColor: ACCENT_LIGHT,
    borderColor: ACCENT_BORDER,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statsCardBtnText: {
    color: ACCENT_DARK,
    fontSize: 12,
    fontWeight: '700',
  },
  nativeWord: {
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    color: '#1A202C',
    marginVertical: 4,
  },
  showCount: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 2,
  },
  wordCenterContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: 48,
    paddingRight: 0,
  },
  pronunciationBtn: {
    marginLeft: 8,
    padding: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pronunciationBtnText: {
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#EDF2F7',
    marginVertical: 10
  },
  langsContainer: {
    flexDirection: 'column',
    gap: 10
  },
  langBlock: {
    backgroundColor: '#F8F9FA',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E9ECEF',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },
  aiWarningBanner: {
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
  aiWarningIcon: {
    fontSize: 18,
  },
  aiWarningTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#92400E',
    marginBottom: 2,
  },
  aiWarningIssue: {
    fontSize: 11,
    color: '#78350F',
    marginTop: 1,
  },
  aiWarningEdit: {
    fontSize: 16,
    paddingHorizontal: 4,
  },
  sideBadge: {
    position: 'absolute',
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sideFlag: {
    fontSize: 12,
  },
  sideLangCode: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748B',
  },

  langTranslation: {
    fontSize: 24,
    color: ACCENT,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  assocHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  assocLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#475569',
  },
  assocSavedBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 52,
    maxHeight: 68,
    textAlignVertical: 'top',
    fontSize: 14,
    backgroundColor: '#FAFAFA',
    color: '#1E293B'
  },
  inputWithContent: {
    backgroundColor: '#FFFDF0',
    borderColor: '#FEF08A',
    color: '#1E293B',
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  dictionaryBtn: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2
  },
  btnPrev: {
    backgroundColor: '#94A3B8'
  },
  btnNext: {
    backgroundColor: '#64748B'
  },
  btnKnown: {
    backgroundColor: '#28A745'
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold'
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
    borderRadius: 24,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
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
    fontSize: 11,
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
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
