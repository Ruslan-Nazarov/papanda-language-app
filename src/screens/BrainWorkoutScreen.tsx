import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';

export default function BrainWorkoutScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguage, markWordKnown, incrementShowCount } = useStore();
  const [queue, setQueue] = useState<Word[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [score, setScore] = useState({ known: 0, unknown: 0 });

  // Generate workout queue
  useEffect(() => {
    if (words.length > 0) {
      const pendingWords = words.filter(w => {
        const hasTranslation = w[activeLanguage as keyof Word] || (w.translations && w.translations[activeLanguage]);
        if (!hasTranslation) return false;
        
        const stats = w.knowledge_stats as Record<string, boolean>;
        const isKnown = stats && stats[activeLanguage];
        return !isKnown;
      });

      // Sort by count (least shown first)
      pendingWords.sort((a, b) => (a.count || 0) - (b.count || 0));
      setQueue(pendingWords.slice(0, 25));
      setCurrentIndex(0);
      setShowAnswer(false);
    }
  }, [words, activeLanguage]);

  const currentWord = queue[currentIndex];

  const handleAnswer = (knew: boolean) => {
    if (!currentWord) return;

    const wordKey = currentWord.eng || currentWord.word || '';
    markWordKnown(wordKey, knew);
    incrementShowCount(wordKey);

    if (knew) {
      setScore(s => ({ ...s, known: s.known + 1 }));
    } else {
      setScore(s => ({ ...s, unknown: s.unknown + 1 }));
    }

    if (currentIndex < queue.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    } else {
      alert(`Тренировка завершена!\nВы знали: ${score.known + (knew ? 1 : 0)}\nНужно повторить: ${score.unknown + (knew ? 0 : 1)}`);
      setCurrentIndex(0);
      setScore({ known: 0, unknown: 0 });
      setShowAnswer(false);
    }
  };

  if (queue.length === 0 || !currentWord) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyIcon}>🎉</Text>
          <Text style={styles.header}>Все слова выучены!</Text>
          <Text style={styles.emptySub}>Нет доступных новых слов для языка {activeLanguage.toUpperCase()}. Выберите другой язык в Настройках или сбросьте статистику.</Text>
        </View>
      </View>
    );
  }

  const targetTranslation = (currentWord[activeLanguage as keyof Word] || (currentWord.translations && currentWord.translations[activeLanguage])) as string;
  const activeLangObj = LANGUAGES.find(l => l.code === activeLanguage);
  const remainingCount = queue.length - currentIndex;

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      {/* Top Header & Progress */}
      <View style={styles.headerSection}>
        <View style={styles.langBadge}>
          <Text style={styles.langBadgeText}>{activeLangObj?.flag} {activeLangObj?.label || activeLanguage.toUpperCase()}</Text>
        </View>
        <View style={styles.progressPill}>
          <Text style={styles.progressText}>
            Осталось: <Text style={{fontWeight: 'bold', color: '#007BFF'}}>{remainingCount}</Text>
          </Text>
        </View>
      </View>

      {/* Main Flashcard */}
      <View style={styles.cardArea}>
        <TouchableOpacity 
          style={styles.card} 
          activeOpacity={0.85} 
          onPress={() => setShowAnswer(!showAnswer)}
        >
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
          <Text style={styles.scoreKnown}>✓ Знал: {score.known}</Text>
          <Text style={styles.scoreUnknown}>✗ Не знал: {score.unknown}</Text>
        </View>

        <View style={styles.actionButtons}>
          <TouchableOpacity 
            style={[styles.actionBtn, styles.btnUnknown]} 
            activeOpacity={0.8}
            onPress={() => handleAnswer(false)}
          >
            <Text style={styles.btnIcon}>✕</Text>
            <Text style={styles.btnText}>Не знал</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.actionBtn, styles.btnKnown]} 
            activeOpacity={0.8}
            onPress={() => handleAnswer(true)}
          >
            <Text style={styles.btnIcon}>✓</Text>
            <Text style={styles.btnText}>Знал</Text>
          </TouchableOpacity>
        </View>
      </View>
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
