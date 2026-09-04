import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, Modal, PanResponder, Animated, Easing } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';

interface QueueItem {
  word: Word;
  langCode: string;
}

type WordStats = Record<string, boolean | number>;

const SWIPE_THRESHOLD = 72;
const SWIPE_EXIT_DISTANCE = 520;
const SWIPE_ENTRY_OFFSET = 56;

const readWordStats = (value: Word['knowledge_stats'] | Word['show_stats'] | undefined): WordStats => {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export default function BrainWorkoutScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, markWordKnown, incrementShowCount, workoutWordCount, workoutLearnedWordCount, addWorkoutSnapshot, workoutFavoritesOnly, setWorkoutFavoritesOnly, toggleWordFavorite, restoreWordProgress, userWordProgress } = useStore();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  // Bumped to force a fresh workout queue (finishing a session, closing the result modal).
  const [regenNonce, setRegenNonce] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState({ known: 0, unknown: 0 });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [history, setHistory] = useState<{index: number, knew: boolean, previousProgress: any}[]>([]);
  const [resultModalVisible, setResultModalVisible] = useState(false);
  const [workoutResult, setWorkoutResult] = useState({ known: 0, unknown: 0 });
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const cardTranslateX = React.useRef(new Animated.Value(0)).current;
  const isSwipeAnimating = React.useRef(false);

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
    if (words.length > 0 && activeLanguages.length > 0) {
      const unlearnedItems: (QueueItem & {isFailed: boolean})[] = [];
      const learnedItems: QueueItem[] = [];
      
      words.forEach(w => {
        activeLanguages.forEach(langCode => {
          const hasTranslation = w[langCode as keyof Word] || (w.translations && w.translations[langCode]);
          if (!hasTranslation) return;
          
          if (workoutFavoritesOnly && !w.is_favorite) return;

          const stats = w.knowledge_stats as Record<string, boolean>;
          const isKnown = stats && stats[langCode] === true;
          const isFailed = stats && stats[langCode] === false;
          
          if (isKnown) {
            learnedItems.push({ word: w, langCode });
          } else {
            unlearnedItems.push({ word: w, langCode, isFailed });
          }
        });
      });

      // Sort unlearned: failed first, then by count, then random
      unlearnedItems.sort((a, b) => {
        if (a.isFailed && !b.isFailed) return -1;
        if (!a.isFailed && b.isFailed) return 1;
        
        const countA = a.word.count || 0;
        const countB = b.word.count || 0;
        if (countA !== countB) return countA - countB;
        
        return Math.random() - 0.5;
      });

      // Sort learned: least recently shown first
      learnedItems.sort((a, b) => {
        const timeA = a.word.last_shown ? new Date(a.word.last_shown).getTime() : 0;
        const timeB = b.word.last_shown ? new Date(b.word.last_shown).getTime() : 0;
        return timeA - timeB;
      });

      const numLearnedToTake = Math.min(workoutLearnedWordCount, learnedItems.length);
      const numUnlearnedToTake = workoutWordCount - numLearnedToTake;

      let finalQueue = [
        ...unlearnedItems.slice(0, numUnlearnedToTake),
        ...learnedItems.slice(0, numLearnedToTake)
      ];

      // If we don't have enough unlearned, fill with more learned
      if (finalQueue.length < workoutWordCount && learnedItems.length > numLearnedToTake) {
        const extraLearned = workoutWordCount - finalQueue.length;
        finalQueue = [
          ...finalQueue,
          ...learnedItems.slice(numLearnedToTake, numLearnedToTake + extraLearned)
        ];
      }

      finalQueue.sort(() => Math.random() - 0.5);

      setQueue(finalQueue);
      setCurrentIndex(0);
      setShowAnswer(false);
      setHistory([]);
    } else {
      setQueue([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [words.length, activeLanguages, workoutFavoritesOnly, workoutWordCount, workoutLearnedWordCount, regenNonce]);

  const currentItem = queue[currentIndex];
  // Always use the freshest word data from the store in case it was edited
  const currentWord = currentItem ? (words.find(w => (w.eng || w.word) === (currentItem.word.eng || currentItem.word.word)) || currentItem.word) : undefined;
  const currentLang = currentItem?.langCode;
  
  // Always read the latest favorite status directly from the store
  const currentWordKey = currentWord?.eng || currentWord?.word || '';
  const currentProgress = currentWordKey ? userWordProgress[currentWordKey] : undefined;
  const isFavorite = currentWord ? (currentProgress?.is_favorite ?? currentWord.is_favorite) : false;
  const knowledgeStats = {
    ...readWordStats(currentWord?.knowledge_stats),
    ...(currentProgress?.knowledge_stats || {}),
  } as Record<string, boolean>;
  const showStats = {
    ...readWordStats(currentWord?.show_stats),
    ...(currentProgress?.show_stats || {}),
  } as Record<string, number>;
  const isCurrentLanguageLearned = !!currentLang && knowledgeStats[currentLang] === true;
  const totalShows = currentProgress?.count ?? currentWord?.count ?? 0;
  const lastShown = currentProgress?.last_shown ?? currentWord?.last_shown;

  const handleAnswer = (knew: boolean) => {
    if (!currentWord || !currentLang) return;

    const wordKey = currentWord.eng || currentWord.word || '';
    const previousProgress = useStore.getState().userWordProgress[wordKey];
    
    setHistory(prev => [...prev, {
      index: currentIndex,
      knew,
      previousProgress: previousProgress ? JSON.parse(JSON.stringify(previousProgress)) : null
    }]);

    markWordKnown(wordKey, currentLang, knew);
    incrementShowCount(wordKey, currentLang);

    if (knew) {
      setScore(s => ({ ...s, known: s.known + 1 }));
    } else {
      setScore(s => ({ ...s, unknown: s.unknown + 1 }));
    }

    if (currentIndex < queue.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    } else {
      const finalKnown = score.known + (knew ? 1 : 0);
      const finalUnknown = score.unknown + (knew ? 0 : 1);
      
      addWorkoutSnapshot({
        date: new Date().toISOString().split('T')[0],
        total: finalKnown + finalUnknown,
        correct: finalKnown
      });

      setWorkoutResult({ known: finalKnown, unknown: finalUnknown });
      setResultModalVisible(true);
      
      setScore({ known: 0, unknown: 0 });
      // Rebuild a fresh queue for the next session (the effect resets index/history).
      setRegenNonce(n => n + 1);
    }
  };

  const handlePrevStep = () => {
    if (history.length > 0) {
      const lastAction = history[history.length - 1];
      const wordKey = queue[lastAction.index].word.eng || queue[lastAction.index].word.word || '';
      
      restoreWordProgress(wordKey, lastAction.previousProgress);
      
      if (lastAction.knew) {
        setScore(s => ({ ...s, known: Math.max(0, s.known - 1) }));
      } else {
        setScore(s => ({ ...s, unknown: Math.max(0, s.unknown - 1) }));
      }
      
      setHistory(prev => prev.slice(0, -1));
      setCurrentIndex(lastAction.index);
      setShowAnswer(false);
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
    // A right swipe is the existing "Back" action. Keep the card in place if
    // there is no previous answer to undo.
    if (direction === 'right' && history.length === 0) {
      resetCardPosition();
      return;
    }

    if (isSwipeAnimating.current) return;
    isSwipeAnimating.current = true;

    const exitDirection = direction === 'left' ? -1 : 1;
    Animated.timing(cardTranslateX, {
      toValue: exitDirection * SWIPE_EXIT_DISTANCE,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) {
        isSwipeAnimating.current = false;
        return;
      }

      // Place the next card just beyond the opposite edge before React renders
      // it, then spring it into place for a continuous deck-like transition.
      cardTranslateX.setValue(-exitDirection * SWIPE_ENTRY_OFFSET);
      if (direction === 'left') {
        handleAnswer(false);
      } else {
        handlePrevStep();
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
          <Text style={styles.emptyIcon}>🎉</Text>
          <Text style={styles.header}>Все слова выучены!</Text>
          <Text style={styles.emptySub}>Нет доступных новых слов для выбранных языков. Выберите другие языки в Настройках или сбросьте статистику.</Text>
        </View>
      </View>
    );
  }

  const targetTranslation = (currentWord[currentLang as keyof Word] || (currentWord.translations && currentWord.translations[currentLang])) as string;
  const activeLangObj = LANGUAGES.find(l => l.code === currentLang);

  callbacks.current.handleSwipe = handleSwipe;
  callbacks.current.resetCardPosition = resetCardPosition;

  const cardRotation = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, 0, SWIPE_EXIT_DISTANCE],
    outputRange: ['-8deg', '0deg', '8deg'],
    extrapolate: 'clamp',
  });
  const cardOpacity = cardTranslateX.interpolate({
    inputRange: [-SWIPE_EXIT_DISTANCE, 0, SWIPE_EXIT_DISTANCE],
    outputRange: [0.15, 1, 0.15],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
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
            {workoutFavoritesOnly ? '★ Избранные' : '☆ Все'}
          </Text>
        </TouchableOpacity>

        <View style={styles.progressPill}>
          <Text style={styles.progressText}>{currentIndex + 1} / {queue.length}</Text>
        </View>
      </View>

      {/* Main Flashcard */}
      <View style={styles.cardArea}>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.cardMotion,
            {
              opacity: cardOpacity,
              transform: [{ translateX: cardTranslateX }, { rotate: cardRotation }],
            },
          ]}
        >
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => setShowAnswer(!showAnswer)}
          >
            <View style={styles.cardToolbar}>
              <TouchableOpacity
                style={styles.favCardBtn}
                onPress={(e) => {
                  e.stopPropagation();
                  toggleWordFavorite(currentWordKey);
                }}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.favCardBtnText, isFavorite ? {color: '#F59E0B'} : {color: '#D1D5DB'}]}>
                  {isFavorite ? '★' : '☆'}
                </Text>
              </TouchableOpacity>

              <View style={styles.cardToolbarActions}>
                {isCurrentLanguageLearned && (
                  <View style={styles.learnedBadge}>
                    <Text style={styles.learnedBadgeText}>✓ Выучено</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.statsCardBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    setIsStatsVisible(true);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.statsCardBtnText}>📊 Статистика</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.editCardBtn}
                  onPress={(e) => {
                    e.stopPropagation();
                    setEditingWord(currentWord);
                    setIsModalVisible(true);
                  }}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.editCardBtnText}>✏️</Text>
                </TouchableOpacity>
              </View>
            </View>

            <Text style={styles.targetForeignWord}>{targetTranslation}</Text>

            <View style={styles.divider} />

            {showAnswer ? (
              <View style={styles.answerBox}>
                <Text style={styles.nativeRu}>{currentWord.ru}</Text>
                {!!currentWord.eng && currentWord.eng !== currentWord.ru && (
                  <Text style={styles.engWord}>🇬🇧 {currentWord.eng}</Text>
                )}
                {!!currentWord.personal_association && (
                  <View style={styles.assocNote}>
                    <Text style={styles.assocNoteTitle}>💡 Ассоциация:</Text>
                    <Text style={styles.assocNoteText}>{currentWord.personal_association}</Text>
                  </View>
                )}
                {!!currentWord.meaning && (
                  <Text style={styles.meaningText}>Контекст: {currentWord.meaning}</Text>
                )}
              </View>
            ) : (
              <View style={styles.tapToRevealContainer}>
                <Text style={styles.tapToRevealIcon}>👆</Text>
                <Text style={styles.tapToRevealText}>Нажмите на карточку, чтобы увидеть перевод</Text>
              </View>
            )}
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

        <View style={styles.actionButtons}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.btnUnknown]}
            activeOpacity={0.8}
            onPress={() => handleAnswer(false)}
          >
            <Text style={styles.btnIcon}>✕</Text>
            <Text style={styles.btnText}>Не знаю</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.btnKnown]}
            activeOpacity={0.8}
            onPress={() => handleAnswer(true)}
          >
            <Text style={styles.btnIcon}>✓</Text>
            <Text style={styles.btnText}>Знаю</Text>
          </TouchableOpacity>
        </View>
      </View>

      <EditWordModal 
        visible={isModalVisible} 
        onClose={() => setIsModalVisible(false)} 
        wordToEdit={editingWord} 
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
      <Modal visible={resultModalVisible} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.resultModalCard}>
            <Text style={styles.resultIcon}>🎉</Text>
            <Text style={styles.resultTitle}>Тренировка завершена!</Text>
            
            <View style={styles.resultStatsRow}>
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatValueKnown}>{workoutResult.known}</Text>
                <Text style={styles.resultStatLabel}>Вспомнили</Text>
              </View>
              <View style={styles.resultStatDivider} />
              <View style={styles.resultStatBox}>
                <Text style={styles.resultStatValueUnknown}>{workoutResult.unknown}</Text>
                <Text style={styles.resultStatLabel}>Повторить</Text>
              </View>
            </View>

            <TouchableOpacity 
              style={styles.resultOkBtn}
              onPress={() => setResultModalVisible(false)}
            >
              <Text style={styles.resultOkBtnText}>Отлично!</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 24,
    justifyContent: 'space-between',
  },
  headerSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  langBadge: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#BEE3F8',
  },
  langBadgeText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#2B6CB0',
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
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 22,
    padding: 24,
    minHeight: 280,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.09,
    shadowRadius: 14,
    elevation: 6,
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
    alignItems: 'center',
    gap: 8,
  },
  editCardBtn: {
    padding: 4,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editCardBtnText: {
    fontSize: 16,
  },
  favCardBtn: {
    padding: 4,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  favCardBtnText: {
    fontSize: 18,
  },
  learnedBadge: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
  },
  learnedBadgeText: {
    color: '#15803D',
    fontSize: 12,
    fontWeight: '700',
  },
  statsCardBtn: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
  },
  statsCardBtnText: {
    color: '#2563EB',
    fontSize: 12,
    fontWeight: '700',
  },
  targetForeignWord: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#007BFF',
    textAlign: 'center',
    marginVertical: 10,
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
  },
  nativeRu: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1A202C',
    textAlign: 'center',
    marginBottom: 6,
  },
  engWord: {
    fontSize: 16,
    color: '#718096',
    marginBottom: 10,
  },
  assocNote: {
    backgroundColor: '#FFFDF0',
    borderWidth: 1,
    borderColor: '#FEF08A',
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
    fontSize: 14,
    color: '#4A5568',
  },
  meaningText: {
    fontSize: 13,
    color: '#A0AEC0',
    marginTop: 8,
    textAlign: 'center',
  },
  tapToRevealContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  tapToRevealIcon: {
    fontSize: 28,
    marginBottom: 8,
  },
  tapToRevealText: {
    fontSize: 14,
    color: '#A0AEC0',
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
    color: '#007BFF',
    marginRight: 4,
  },
  backBtnText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#007BFF',
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
  actionButtons: {
    flexDirection: 'row',
    gap: 14,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 4,
  },
  btnUnknown: {
    backgroundColor: '#DC3545',
  },
  btnKnown: {
    backgroundColor: '#28A745',
  },
  btnIcon: {
    color: '#FFF',
    fontSize: 20,
    fontWeight: 'bold',
    marginRight: 8,
  },
  btnText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  emptyCard: {
    backgroundColor: '#FFF',
    padding: 30,
    borderRadius: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 4,
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
    borderRadius: 24,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 10,
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
    backgroundColor: '#007BFF',
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
  },
  resultOkBtnText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: 'bold',
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
    color: '#007BFF',
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
    backgroundColor: '#007BFF',
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
