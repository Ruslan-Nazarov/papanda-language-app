import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word, Sentence } from '../models/types';
import { LANGUAGES } from '../constants/languages';

export default function WordTriplesScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { words, sentences, activeLanguages, markTripleKnown, saveWordAssociation, setTargetSentenceInfo, setActiveLanguage } = useStore();
  const [currentWord, setCurrentWord] = useState<Word | null>(null);
  const [associationText, setAssociationText] = useState('');

  const pickRandomWord = () => {
    const pending = words.filter(w => {
      const hasAllTranslations = activeLanguages.every(lang => 
        w[lang as keyof Word] || (w.translations && w.translations[lang])
      );
      if (!hasAllTranslations) return false;

      const stats = w.knowledge_stats as Record<string, boolean>;
      if (!stats) return true;
      
      const isKnownInAll = activeLanguages.every(lang => stats[lang] === true);
      return !isKnownInAll;
    });

    if (pending.length > 0) {
      const randomIndex = Math.floor(Math.random() * pending.length);
      const word = pending[randomIndex];
      setCurrentWord(word);
      setAssociationText(word.personal_association || '');
    } else {
      setCurrentWord(null);
    }
  };

  useEffect(() => {
    if (!currentWord && activeLanguages.length > 0) {
      pickRandomWord();
    }
  }, [words, activeLanguages]);

  const handleNext = () => {
    if (currentWord && associationText !== currentWord.personal_association) {
      saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
    }
    pickRandomWord();
  };

  const handleMarkLearned = () => {
    if (currentWord) {
      if (associationText !== currentWord.personal_association) {
        saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
      }
      markTripleKnown(currentWord.eng || currentWord.word || '');
      pickRandomWord();
    }
  };

  // Find matching sentence for a given translation and language
  const findSentenceForWord = (langCode: string, translation: string | undefined): Sentence | null => {
    if (!translation || !sentences || sentences.length === 0) return null;
    
    const langObj = LANGUAGES.find(l => l.code === langCode);
    const targetWord = translation.trim().toLowerCase();
    if (!targetWord) return null;

    const matched = sentences.find(s => {
      if (langObj && s.language && !s.language.toLowerCase().includes(langObj.label.toLowerCase())) {
        return false;
      }
      return s.words?.some(t => 
        t.dictionary_word?.toLowerCase() === targetWord ||
        t.text?.toLowerCase() === targetWord ||
        t.translation?.toLowerCase() === targetWord
      ) || s.sentence?.toLowerCase().includes(targetWord);
    });

    return matched || null;
  };

  const handleWordSentencePress = (langCode: string, translation: string, matchedSentence: Sentence) => {
    if (currentWord && associationText !== currentWord.personal_association) {
      saveWordAssociation(currentWord.eng || currentWord.word || '', associationText);
    }
    
    setActiveLanguage(langCode);
    setTargetSentenceInfo({
      langCode,
      sentenceId: matchedSentence.id,
      highlightWord: translation
    });

    navigation.navigate('Sentence Trainer');
  };

  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);

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
    >
      <View style={[styles.innerWrapper, { paddingTop: topPadding }]}>
        {/* Header with comfortable breathing space */}
        <View style={styles.topHeader}>
          <Text style={styles.headerTitle}>Слова</Text>
        </View>

        {/* Main Card */}
        <View style={styles.card}>
          <Text style={styles.nativeWord}>{currentWord.ru}</Text>

          <View style={styles.divider} />

          {/* Large Centered Words with Subtle Side Badges */}
          <View style={styles.langsContainer}>
            {activeLanguages.map(lang => {
              const translation = (currentWord[lang as keyof Word] || (currentWord.translations && currentWord.translations[lang])) as string;
              const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';
              const matchedSentence = findSentenceForWord(lang, translation);
              const hasSentence = !!matchedSentence;

              return (
                <TouchableOpacity
                  key={lang}
                  activeOpacity={hasSentence ? 0.7 : 1}
                  disabled={!hasSentence}
                  onPress={() => hasSentence && handleWordSentencePress(lang, translation, matchedSentence)}
                  style={[styles.langBlock, hasSentence && styles.langBlockClickable]}
                >
                  {/* Subtle Language Indicator on the Left Side */}
                  <View style={styles.sideBadge}>
                    <Text style={styles.sideFlag}>{langFlag}</Text>
                    <Text style={styles.sideLangCode}>{lang.toUpperCase()}</Text>
                    {hasSentence && <View style={styles.yellowDot} />}
                  </View>

                  {/* Prominent Centered Translation */}
                  <View style={styles.wordCenterContainer}>
                    <Text style={styles.langTranslation}>{translation}</Text>
                  </View>
                </TouchableOpacity>
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
        </View>

        {/* Bottom Actions */}
        <View style={styles.controls}>
          <TouchableOpacity style={[styles.button, styles.btnNext]} activeOpacity={0.8} onPress={handleNext}>
            <Text style={styles.buttonText}>Дальше</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.btnKnown]} activeOpacity={0.8} onPress={handleMarkLearned}>
            <Text style={styles.buttonText}>✓ Выучено</Text>
          </TouchableOpacity>
        </View>
      </View>
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
    borderColor: '#ECEFF1'
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
  langBlockClickable: {
    backgroundColor: '#FFFDF0',
    borderColor: '#FDE047'
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
  yellowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#EAB308',
    marginLeft: 2,
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
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
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
  }
});
