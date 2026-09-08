import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform, PanResponder, Modal, Animated, Easing } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';
import { getWordTranslation } from '../utils/words';
import { wordMemoryWeight } from '../utils/statistics';
import { auditNextWordInBackground } from '../services/wordAuditService';
import { prefetchSentencesInBackground } from '../services/sentencePrefetch';

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

export default function WordTriplesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { words, activeLanguages, markTripleKnown, saveWordAssociation, restoreWordProgress, toggleWordFavorite, userWordProgress } = useStore();
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [associationText, setAssociationText] = useState('');
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isStatsVisible, setIsStatsVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [history, setHistory] = useState<{word: Word, markedLearned: boolean, previousProgress: any}[]>([]);

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
    const pending = words.filter(w => {
      const hasAllTranslations = activeLanguages.every(lang =>
        Boolean(getWordTranslation(w, lang))
      );
      if (!hasAllTranslations) return false;

      const stats = readWordStats(w.knowledge_stats);
      const isKnownInAll = activeLanguages.every(lang => stats[lang] === true);
      return !isKnownInAll;
    });

    if (pending.length === 0) {
      setCurrentWord(null);
      return;
    }

    // Weighted pick: the weaker a word's memory weight (new or decayed), the more
    // likely it comes up. The 0.15 floor keeps solid words in rotation too.
    const now = Date.now();
    const weights = pending.map(w => {
      const avgW = activeLanguages.reduce((s, lang) => s + wordMemoryWeight(w, lang, now), 0) / activeLanguages.length;
      return 0.15 + (1 - avgW);
    });
    const total = weights.reduce((s, x) => s + x, 0);
    let r = Math.random() * total;
    let chosen = pending[pending.length - 1];
    for (let i = 0; i < pending.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = pending[i]; break; }
    }

    setCurrentWord(chosen);
    setAssociationText(chosen.personal_association || '');
  };

  useEffect(() => {
    if (!currentWord && activeLanguages.length > 0) {
      pickRandomWord();
    }
  }, [words, activeLanguages]);

  // Sync currentWord with any edits made in the modal/store. The store replaces
  // word objects on every change, so a reference check is enough — no deep compare.
  useEffect(() => {
    if (!currentWord) return;
    const wordKey = currentWord.eng || currentWord.word;
    const latestWord = words.find(w => (w.eng || w.word) === wordKey);
    if (latestWord && latestWord !== currentWord) {
      setCurrentWord(latestWord);
      setAssociationText(latestWord.personal_association || '');
    }
  }, [words, currentWord]);

  const handleNext = () => {
    if (currentWord && associationText !== currentWord.personal_association) {
      saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
    }
    
    if (currentWord) {
      const wordKey = currentWord.eng || currentWord.word || '';
      const previousProgress = useStore.getState().userWordProgress[wordKey];
      setHistory(prev => [...prev, {
        word: currentWord,
        markedLearned: false,
        previousProgress: previousProgress ? JSON.parse(JSON.stringify(previousProgress)) : null
      }]);
    }

    setSessionCount(prev => prev + 1);
    pickRandomWord();
  };

  const handleMarkLearned = () => {
    if (currentWord) {
      if (associationText !== currentWord.personal_association) {
        saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
      }
      
      const wordKey = currentWord.eng || currentWord.word || '';
      const previousProgress = useStore.getState().userWordProgress[wordKey];
      setHistory(prev => [...prev, {
        word: currentWord,
        markedLearned: true,
        previousProgress: previousProgress ? JSON.parse(JSON.stringify(previousProgress)) : null
      }]);

      markTripleKnown(wordKey);
      setSessionCount(prev => prev + 1);
      pickRandomWord();
    }
  };

  const handlePrev = () => {
    if (history.length > 0) {
      const lastAction = history[history.length - 1];
      const wordKey = lastAction.word.eng || lastAction.word.word || '';
      
      restoreWordProgress(wordKey, lastAction.previousProgress);
      
      setSessionCount(prev => Math.max(0, prev - 1));
      setHistory(prev => prev.slice(0, -1));
      
      setCurrentWord(lastAction.word);
      setAssociationText(lastAction.word.personal_association || '');
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

  // Background periodic AI check and sentence prefetching
  useEffect(() => {
    const timer = setTimeout(() => {
      void auditNextWordInBackground();
      void prefetchSentencesInBackground();
    }, 1500);
    return () => clearTimeout(timer);
  }, [currentWord?.eng, currentWord?.word, sessionCount, activeLanguages.length]);

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
  const totalShows = activeLanguages.reduce((total, lang) => total + (showStats[lang] || 0), 0);
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

  if (!currentWord) {
    return (
      <View style={[styles.centerContainer, { paddingTop: topPadding }]}>
        <Text style={styles.info}>Нет доступных слов для выбранной комбинации языков!</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      {...panResponder.panHandlers}
    >
      <View style={[styles.innerWrapper, { paddingTop: topPadding }]}>
        {/* Header with comfortable breathing space */}
        <View style={[styles.topHeader, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View>
            <Text style={styles.headerTitle}>Слова</Text>
            {sessionCount > 0 && (
              <Text style={styles.sessionCountText}>Пройдено за заход: {sessionCount}</Text>
            )}
          </View>
          <TouchableOpacity 
            style={styles.dictionaryBtn} 
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
              style={styles.favCardBtn}
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
              style={styles.editCardBtn}
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
              const translation = getWordTranslation(currentWord, lang) || '—';
              const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';

              return (
                <View key={lang} style={styles.langBlock}>
                  {/* Subtle Language Indicator on the Left Side */}
                  <View style={styles.sideBadge}>
                    <Text style={styles.sideFlag}>{langFlag}</Text>
                    <Text style={styles.sideLangCode}>{lang.toUpperCase()}</Text>
                  </View>

                  {/* Prominent Centered Translation */}
                  <View style={styles.wordCenterContainer}>
                    <Text style={styles.langTranslation}>{translation}</Text>
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
            placeholder="Добавьте свою ассоциацию или смысл для запоминания..."
            placeholderTextColor="#A0AEC0"
            value={associationText}
            onChangeText={setAssociationText}
          />
        </Animated.View>

        {/* Bottom Actions */}
        <View style={styles.controls}>
          <TouchableOpacity 
            style={[styles.button, styles.btnPrev, history.length === 0 && { opacity: 0.5 }]} 
            activeOpacity={0.8} 
            onPress={handlePrev}
            disabled={history.length === 0}
          >
            <Text style={styles.buttonText}>Назад</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.btnNext]} activeOpacity={0.8} onPress={handleNext}>
            <Text style={styles.buttonText}>Дальше</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.btnKnown]} activeOpacity={0.8} onPress={handleMarkLearned}>
            <Text style={styles.buttonText}>✓ Выучено</Text>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8F9FA' 
  },
  innerWrapper: {
    flex: 1,
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
  nativeWord: { 
    fontSize: 28, 
    fontWeight: 'bold', 
    textAlign: 'center', 
    color: '#1A202C',
    marginVertical: 4,
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
    width: '100%',
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
  wordCenterContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langTranslation: { 
    fontSize: 24, 
    color: '#007BFF', 
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
  }
});
