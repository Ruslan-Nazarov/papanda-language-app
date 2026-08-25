import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';

interface QueueItem {
  word: Word;
  langCode: string;
}

export default function BrainWorkoutScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, markWordKnown, incrementShowCount, workoutWordCount, addWorkoutSnapshot } = useStore();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState({ known: 0, unknown: 0 });
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);

  // Generate workout queue
  useEffect(() => {
    if (words.length > 0 && activeLanguages.length > 0) {
      const pendingItems: QueueItem[] = [];
      
      words.forEach(w => {
        activeLanguages.forEach(langCode => {
          const hasTranslation = w[langCode as keyof Word] || (w.translations && w.translations[langCode]);
          if (!hasTranslation) return;
          
          const stats = w.knowledge_stats as Record<string, boolean>;
          const isKnown = stats && stats[langCode];
          if (!isKnown) {
            pendingItems.push({ word: w, langCode });
          }
        });
      });

      // Sort randomly but roughly by count (least shown first)
      // Since it's a mix of languages, just shuffling is good, but we can also prefer less shown words.
      // Let's sort by count first, then add a small random factor to mix languages
      pendingItems.sort((a, b) => {
        const countA = a.word.count || 0;
        const countB = b.word.count || 0;
        if (countA === countB) {
          return Math.random() - 0.5; // Randomize same count
        }
        return countA - countB;
      });

      // Limit to user settings
      const limitedItems = pendingItems.slice(0, workoutWordCount);

      setQueue(limitedItems);
      setCurrentIndex(0);
      setShowAnswer(false);
    } else {
      setQueue([]);
    }
  }, [words, activeLanguages]);

  const currentItem = queue[currentIndex];
  const currentWord = currentItem?.word;
  const currentLang = currentItem?.langCode;

  const handleAnswer = (knew: boolean) => {
    if (!currentWord || !currentLang) return;

    const wordKey = currentWord.eng || currentWord.word || '';
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

      alert(`Тренировка завершена!\nВы вспомнили: ${finalKnown}\nНужно повторить: ${finalUnknown}`);
      setCurrentIndex(0);
      setScore({ known: 0, unknown: 0 });
      setShowAnswer(false);
      // Let useEffect regenerate a new limited batch
      setQueue([]);
    }
  };

  if (queue.length === 0 || !currentWord || !currentLang) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
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
  const remainingCount = queue.length - currentIndex;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Top Header & Progress */}
      <View style={styles.headerSection}>
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeText}>{activeLangObj?.flag} {activeLangObj?.label || currentLang.toUpperCase()}</Text>
        </View>
        <View style={styles.progressPill}>
          <Text style={styles.progressText}>{currentIndex + 1} / {queue.length}</Text>
        </View>
      </View>

      {/* Main Flashcard */}
      <View style={styles.cardArea}>
        <TouchableOpacity 
          style={styles.card} 
          activeOpacity={0.85} 
          onPress={() => setShowAnswer(!showAnswer)}
        >
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
      </View>

      {/* Bottom Zone: Always Visible Action Buttons (Thumb Friendly) */}
      <View style={styles.bottomZone}>
        <View style={styles.scoreRow}>
          <Text style={styles.scoreKnown}>✓ Видел: {score.known}</Text>
          <Text style={styles.scoreUnknown}>✗ Не видел: {score.unknown}</Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={[styles.actionBtn, styles.btnUnknown]} 
            activeOpacity={0.8}
            onPress={() => handleAnswer(false)}
          >
            <Text style={styles.btnIcon}>✕</Text>
            <Text style={styles.btnText}>Не видел</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionBtn, styles.btnKnown]} 
            activeOpacity={0.8}
            onPress={() => handleAnswer(true)}
          >
            <Text style={styles.btnIcon}>✓</Text>
            <Text style={styles.btnText}>Видел</Text>
          </TouchableOpacity>
        </View>
      </View>

      <EditWordModal 
        visible={isModalVisible} 
        onClose={() => setIsModalVisible(false)} 
        wordToEdit={editingWord} 
      />
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
  editCardBtn: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
    zIndex: 10,
    backgroundColor: '#F8F9FA',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  editCardBtnText: {
    fontSize: 16,
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
    paddingHorizontal: 10,
    marginBottom: 12,
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
});
