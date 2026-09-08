import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Platform, KeyboardAvoidingView, ActivityIndicator, Alert, PanResponder } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { SyntaxRole, Token, Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';
import { explainSentenceWithAI } from '../services/aiService';
import { generateSentenceBatch, isSentenceGenerationConfigured } from '../services/sentenceGeneration';
import EditWordModal from '../components/EditWordModal';
import { getWordTranslation } from '../utils/words';
import { SESSION_START, sessionRefreshedLangs } from '../services/sentenceSession';

const STRICT_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction', 
  'Preposition', 'Particle', 'Article', 'Other'
];

const AFFIX_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']; // Palette for multiple suffixes
const GENERATION_RESERVE = 3; // top up when this few unlearned generated sentences remain
const GENERATION_BATCH = 8;
const FULLY_REVEALED = 9999; // sentinel: more than any sentence has role-groups

const ROLE_TRANSLATIONS: Record<SyntaxRole, string> = {
  Subject: 'Подлежащее',
  Predicate: 'Сказуемое',
  Object: 'Дополнение',
  Attribute: 'Определение',
  Attribute_Subject: 'Определение (подлеж.)',
  Attribute_Object: 'Определение (дополн.)',
  Circumstance: 'Обстоятельство',
  Adverbial: 'Обстоятельство',
  Conjunction: 'Союз',
  Preposition: 'Предлог',
  Particle: 'Частица',
  Article: 'Артикль',
  Other: 'Другое'
};

const getRoleColor = (role: SyntaxRole) => {
  switch (role) {
    case 'Subject': return '#3B82F6'; // Blue
    case 'Predicate': return '#EF4444'; // Red
    case 'Object': return '#F97316'; // Orange
    case 'Attribute':
    case 'Attribute_Subject':
    case 'Attribute_Object': return '#10B981'; // Green
    case 'Circumstance':
    case 'Adverbial': return '#8B5CF6'; // Purple
    default: return '#CBD5E1'; // Gray
  }
};

export default function SentenceTrainerScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, sentences, addSentence, addGeneratedSentences, clearGeneratedSentences, addWordFromSentenceToken, updateSentence, activeLanguages, targetSentenceInfo, setTargetSentenceInfo, learnedSentences, markSentenceLearned } = useStore();
  const [currentFilteredIndex, setCurrentFilteredIndex] = useState(0);
  // How many role-groups are revealed; 0 = fully hidden, >= orderedGroups.length = fully revealed.
  const [revealedSteps, setRevealedSteps] = useState(0);
  const [showTranslations, setShowTranslations] = useState(false);
  const [isTableMode, setIsTableMode] = useState(false);
  const [isMenuVisible, setIsMenuVisible] = useState(false);

  // Modal state
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [newSentenceText, setNewSentenceText] = useState('');
  const [parsedTokens, setParsedTokens] = useState<Token[]>([]);

  // Word modal state for tapping a token
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [isWordModalVisible, setIsWordModalVisible] = useState(false);

  // AI state
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationErrors, setGenerationErrors] = useState<Record<string, string>>({});
  const [addedTokenKeys, setAddedTokenKeys] = useState<Set<string>>(new Set());
  const generatingLanguages = useRef(new Set<string>());
  const swipeCallbacks = useRef({ next: () => {}, prev: () => {} });
  const sentencePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gestureState) => (
        Math.abs(gestureState.dx) > 20 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy)
      ),
      onPanResponderRelease: (_event, gestureState) => {
        if (gestureState.dx < -50) {
          swipeCallbacks.current.next();
        } else if (gestureState.dx > 50) {
          swipeCallbacks.current.prev();
        }
      }
    })
  ).current;

  const [selectedLanguageCode, setSelectedLanguageCode] = useState(activeLanguages[0] || 'it');

  // AI sentences are the normal training queue. Manually prepared / seed
  // sentences are kept untouched and shown only when Gemini can't provide any.
  const activeLangObj = LANGUAGES.find(l => l.code === selectedLanguageCode);
  const allSentencesForLanguage = sentences.filter(s => {
    if (!s.language || !activeLangObj) return false;
    return s.language.toLowerCase().includes(activeLangObj.label.toLowerCase());
  });
  const generatedSentences = allSentencesForLanguage.filter(sentence => sentence.source === 'generated');
  const fallbackSentences = allSentencesForLanguage.filter(sentence => sentence.source !== 'generated');
  const generationError = generationErrors[selectedLanguageCode];
  const generatedCacheCount = generatedSentences.length;

  // Sentences generated during this app session (fresh each launch). Older
  // generated ones stay in the store as a fallback for when generation fails.
  const sessionGenerated = generatedSentences.filter(s => (s.createdAt ?? 0) >= SESSION_START);
  const activeGenerated = sessionGenerated.length > 0 ? sessionGenerated : generatedSentences;
  const filteredSentences = activeGenerated.length > 0 ? activeGenerated : fallbackSentences;
  const showingGenerated = activeGenerated.length > 0;

  const generateSentences = async (languageCode = selectedLanguageCode, count = GENERATION_BATCH) => {
    const language = LANGUAGES.find(item => item.code === languageCode);
    if (!language || generatingLanguages.current.has(languageCode)) return;

    generatingLanguages.current.add(languageCode);
    setIsGenerating(true);
    setGenerationErrors(previous => {
      if (!previous[languageCode]) return previous;
      const updated = { ...previous };
      delete updated[languageCode];
      return updated;
    });

    try {
      const generated = await generateSentenceBatch(languageCode, words, count);
      addGeneratedSentences(generated);
      if (languageCode === selectedLanguageCode && generatedSentences.length === 0) {
        setCurrentFilteredIndex(0);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось сгенерировать предложения.';
      setGenerationErrors(previous => ({ ...previous, [languageCode]: message }));
    } finally {
      generatingLanguages.current.delete(languageCode);
      setIsGenerating(false);
    }
  };

  // Once per language per app launch: pull a fresh batch so each visit shows new
  // sentences. If it fails, the older cached batch keeps showing (fallback).
  useEffect(() => {
    if (!isSentenceGenerationConfigured()) {
      setGenerationErrors(previous => ({
        ...previous,
        [selectedLanguageCode]: 'Gemini не подключён: не задан ключ EXPO_PUBLIC_GEMINI_API_KEY. Добавьте его в .env (или в переменные окружения EAS) и пересоберите приложение.'
      }));
      return;
    }
    if (!sessionRefreshedLangs.has(selectedLanguageCode) && !generationErrors[selectedLanguageCode]) {
      sessionRefreshedLangs.add(selectedLanguageCode);
      void generateSentences(selectedLanguageCode, GENERATION_BATCH);
    }
  }, [selectedLanguageCode]);

  // Keep an endless queue: quietly top up while the learner still has cards left.
  useEffect(() => {
    if (!isSentenceGenerationConfigured()) return;
    if (!showingGenerated || generationErrors[selectedLanguageCode]) return;
    const unlearnedInPlay = filteredSentences.filter(s => !learnedSentences.includes(s.id)).length;
    if (unlearnedInPlay <= GENERATION_RESERVE) {
      void generateSentences(selectedLanguageCode, GENERATION_BATCH);
    }
  }, [selectedLanguageCode, currentFilteredIndex, generatedCacheCount, learnedSentences.length, showingGenerated]);

  // Handle incoming target sentence from WordTriples or other screens
  useEffect(() => {
    if (targetSentenceInfo) {
      const { langCode, sentenceId } = targetSentenceInfo;
      if (langCode && langCode !== selectedLanguageCode) {
        setSelectedLanguageCode(langCode);
      }
      
      const langObj = LANGUAGES.find(l => l.code === langCode);
      const sentencesForLang = sentences.filter(s => 
        s.language && langObj && s.language.toLowerCase().includes(langObj.label.toLowerCase())
      );
      
      if (sentenceId) {
        const foundIdx = sentencesForLang.findIndex(s => s.id === sentenceId);
        if (foundIdx !== -1) {
          setCurrentFilteredIndex(foundIdx);
          setRevealedSteps(FULLY_REVEALED);
          setShowTranslations(true);
        }
      }
      
      // Clear target so user can freely navigate afterward
      setTargetSentenceInfo(null);
    }
  }, [targetSentenceInfo, sentences]);
  
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

  const currentSentence = filteredSentences[currentFilteredIndex];

  // Clear state when switching to a different sentence — start fully hidden.
  useEffect(() => {
    setAiExplanation(null);
    setRevealedSteps(0);
  }, [currentSentence?.id]);

  const moveToNextSentence = () => {
    if (filteredSentences.length <= 1) {
      setRevealedSteps(0);
      setShowTranslations(false);
      setAiExplanation(null);
      return;
    }

    const learned: number[] = [];
    const unlearned: number[] = [];
    filteredSentences.forEach((s, idx) => {
      if (idx !== currentFilteredIndex) {
        if (learnedSentences.includes(s.id)) learned.push(idx);
        else unlearned.push(idx);
      }
    });

    let nextIdx = 0;
    if (unlearned.length > 0 && learned.length > 0) {
      if (Math.random() < 0.8) {
        nextIdx = unlearned[Math.floor(Math.random() * unlearned.length)];
      } else {
        nextIdx = learned[Math.floor(Math.random() * learned.length)];
      }
    } else if (unlearned.length > 0) {
      nextIdx = unlearned[Math.floor(Math.random() * unlearned.length)];
    } else if (learned.length > 0) {
      nextIdx = learned[Math.floor(Math.random() * learned.length)];
    }

    setCurrentFilteredIndex(nextIdx);
    setRevealedSteps(0);
    setShowTranslations(false);
    setAiExplanation(null);
  };

  const moveToPrevSentence = () => {
    if (filteredSentences.length <= 1) {
      setRevealedSteps(0);
      setShowTranslations(false);
      setAiExplanation(null);
      return;
    }

    const prevIdx = (currentFilteredIndex - 1 + filteredSentences.length) % filteredSentences.length;
    setCurrentFilteredIndex(prevIdx);
    setRevealedSteps(0);
    setShowTranslations(false);
    setAiExplanation(null);
  };

  swipeCallbacks.current.next = moveToNextSentence;
  swipeCallbacks.current.prev = moveToPrevSentence;

  const handleTokenPress = (token: Token) => {
    const rawForm = token.dictionary_form || token.dictionary_word || token.text;
    const cleanForm = (rawForm || '').replace(/[.,/#!$%^&*;:{}=\-_`~()?"'«»]/g, '').trim();
    if (!cleanForm) return;

    const existing = words.find(w => {
      const tr = getWordTranslation(w, selectedLanguageCode);
      return (
        (tr && tr.toLowerCase() === cleanForm.toLowerCase()) ||
        (w.word && w.word.toLowerCase() === cleanForm.toLowerCase()) ||
        (w.eng && w.eng.toLowerCase() === cleanForm.toLowerCase())
      );
    });

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

  const orderedGroups = React.useMemo(() => {
    if (!currentSentence || !currentSentence.words) return [];
    
    let currentClause = 0;
    let seenPredicate = false;
    let seenSubject = false;
    
    const wordsWithClause = currentSentence.words.map((word, originalIndex) => {
      if (word.role === 'Conjunction' && (seenPredicate || seenSubject)) {
        currentClause++;
        seenPredicate = false;
        seenSubject = false;
      } else if (
        (word.role === 'Predicate' && seenPredicate) || 
        (word.role === 'Subject' && seenPredicate && seenSubject)
      ) {
        currentClause++;
        seenPredicate = false;
        seenSubject = false;
      }
      
      if (word.role === 'Predicate') seenPredicate = true;
      if (word.role === 'Subject') seenSubject = true;
      
      return { role: word.role, clauseIndex: currentClause, originalIndex };
    });

    const groupsMap = new Map<string, { clauseIndex: number, role: SyntaxRole, tokenIndices: number[] }>();
    wordsWithClause.forEach(w => {
      const key = `${w.clauseIndex}-${w.role}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { clauseIndex: w.clauseIndex, role: w.role, tokenIndices: [] });
      }
      groupsMap.get(key)!.tokenIndices.push(w.originalIndex);
    });

    const groups = Array.from(groupsMap.values());
    
    groups.sort((a, b) => {
      if (a.clauseIndex !== b.clauseIndex) {
        return a.clauseIndex - b.clauseIndex;
      }
      const idxA = STRICT_ORDER.indexOf(a.role);
      const idxB = STRICT_ORDER.indexOf(b.role);
      const aVal = idxA === -1 ? 99 : idxA;
      const bVal = idxB === -1 ? 99 : idxB;
      return aVal - bVal;
    });

    return groups;
  }, [currentSentence]);

  // Reveals one more role-group per press; once everything is shown, the next
  // press hides it all again so the sentence can be quizzed again. Moving to a
  // different sentence is swipe-only (see swipeCallbacks).
  const handleReveal = () => {
    if (!currentSentence) return;
    if (revealedSteps < orderedGroups.length) {
      setRevealedSteps(prev => prev + 1);
    } else {
      setRevealedSteps(0);
    }
  };

  const handleMarkLearned = () => {
    if (!currentSentence) return;
    markSentenceLearned(currentSentence.id, true);
    moveToNextSentence();
  };

  const handleExplainAI = async () => {
    if (!currentSentence) return;
    
    // Check if we already have an explanation to avoid refetching
    if (aiExplanation) {
      setShowAiModal(true);
      return;
    }

    const sentenceText = currentSentence.sentence || currentSentence.words.map(w => w.text).join(' ');
    // Form a rough translation from token translations
    const nativeTranslation = currentSentence.words.map(w => w.translation).filter(Boolean).join(' ');
    
    setIsAiLoading(true);
    setShowAiModal(true);
    try {
      const result = await explainSentenceWithAI(sentenceText, activeLangObj?.label || 'Unknown', nativeTranslation);
      setAiExplanation(result);
    } catch (error: any) {
      Alert.alert('Не удалось объяснить', error?.message || 'Попробуйте ещё раз.');
      setShowAiModal(false);
    } finally {
      setIsAiLoading(false);
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
    const added = token.is_in_my_dict || addedTokenKeys.has(tokenKey(token));
    return (
      <TouchableOpacity
        style={[styles.addToDictionaryBtn, added && styles.addToDictionaryBtnAdded]}
        disabled={added}
        onPress={(event) => {
          event.stopPropagation();
          handleAddTokenToDictionary(token);
        }}
      >
        <Text style={[styles.addToDictionaryText, added && styles.addToDictionaryTextAdded]}>
          {added ? '✓ В словаре' : '+ В словарь'}
        </Text>
      </TouchableOpacity>
    );
  };

  const openAddModal = () => {
    setEditingSentenceId(null);
    setNewSentenceText('');
    setParsedTokens([]);
    setModalVisible(true);
  };

  const openEditModal = () => {
    if (!currentSentence) return;
    setEditingSentenceId(currentSentence.id);
    setNewSentenceText(currentSentence.sentence || currentSentence.words.map(w => w.text).join(' '));
    // Deep copy to avoid mutating store directly before save
    setParsedTokens(JSON.parse(JSON.stringify(currentSentence.words)));
    setModalVisible(true);
  };

  const parseSentence = () => {
    // Only add words that are not already in parsedTokens (by checking prefix or just re-parsing if empty)
    // For simplicity, if they re-parse, we overwrite, but ask for confirmation?
    const words = newSentenceText.trim().split(/\s+/);
    const tokens: Token[] = words.map((w) => ({
      text: w,
      label: w,
      translation: '', 
      role: 'Other', 
      is_in_my_dict: false,
      parts: [w]
    }));
    setParsedTokens(tokens);
  };

  const updateTokenRole = (index: number, role: SyntaxRole) => {
    const updated = [...parsedTokens];
    updated[index].role = role;
    setParsedTokens(updated);
  };

  const updateTokenParts = (index: number, partsStr: string) => {
    const updated = [...parsedTokens];
    // Split by hyphen and filter out empty strings
    updated[index].parts = partsStr.split('-').map(p => p.trim()).filter(Boolean);
    setParsedTokens(updated);
  };

  const updateTokenTranslation = (index: number, trans: string) => {
    const updated = [...parsedTokens];
    updated[index].translation = trans;
    setParsedTokens(updated);
  };

  const toggleTokenDict = (index: number) => {
    const updated = [...parsedTokens];
    updated[index].is_in_my_dict = !updated[index].is_in_my_dict;
    setParsedTokens(updated);
  };

  const saveSentence = () => {
    if (!newSentenceText || parsedTokens.length === 0) {
      Alert.alert('Не хватает данных', 'Введите предложение и разберите его на слова.');
      return;
    }
    
    if (editingSentenceId) {
      updateSentence(editingSentenceId, {
        id: editingSentenceId,
        language: activeLangObj?.label || 'Unknown',
        sentence: newSentenceText,
        words: parsedTokens
      });
    } else {
      addSentence({
        id: Date.now().toString(),
        language: activeLangObj?.label || 'Unknown',
        sentence: newSentenceText,
        words: parsedTokens
      });
    }
    
    setModalVisible(false);
  };

  const renderToken = (token: Token, index: number) => {
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const isRevealed = groupIndex < revealedSteps;

    return (
      <View key={`${index}-${token.text}`} style={styles.tokenContainer}>
        {isRevealed ? (
          <TouchableOpacity 
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
              <Text style={styles.orderBadgeText}>{groupIndex + 1}</Text>
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
          <View style={styles.hiddenCard}>
            <Text style={styles.hiddenText}>???</Text>
          </View>
        )}
      </View>
    );
  };

  const renderTokenTableMode = (token: Token, index: number) => {
    const groupIndex = orderedGroups.findIndex(g => g.tokenIndices.includes(index));
    const isRevealed = groupIndex < revealedSteps;

    return (
      <View key={`${index}-${token.text}`} style={styles.tableRow}>
        <View style={styles.tableColWord}>
          {isRevealed ? (
            <TouchableOpacity 
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
                <Text style={styles.orderBadgeText}>{groupIndex + 1}</Text>
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
            <View style={[styles.hiddenCard, { minWidth: 0, paddingVertical: 8, paddingHorizontal: 12 }]}>
              <Text style={styles.hiddenText}>???</Text>
            </View>
          )}
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
      
      {/* Language Selector */}
      <View style={{height: 50, marginBottom: 10}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center'}}>
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
                setRevealedSteps(0);
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
        <ScrollView
          {...sentencePanResponder.panHandlers}
          style={{flex: 1}}
          contentContainerStyle={{flexGrow: 1}}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 18, color: '#475569', textAlign: 'center', marginBottom: 6 }}>
              {currentSentence?.sentence || currentSentence?.words?.map(w => w.text).join(' ')}
            </Text>

            <View style={styles.swipeHintContainer}>
              <Ionicons name="chevron-back" size={13} color="#94A3B8" />
              <Text style={styles.swipeHintText}>свайп для смены предложения</Text>
              <Ionicons name="chevron-forward" size={13} color="#94A3B8" />
            </View>

            <View style={[isTableMode ? styles.tableContainer : styles.sentenceWrapper, { minHeight: 200 }]}>
              {isTableMode
                ? currentSentence?.words?.map(renderTokenTableMode)
                : currentSentence?.words?.map(renderToken)
              }
            </View>
          </View>
        </ScrollView>
      ) : (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24}}>
          {isGenerating ? (
            <>
              <ActivityIndicator size="large" color="#2563EB" />
              <Text style={styles.generationStatus}>Готовим предложение с разбором…</Text>
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

      {filteredSentences.length > 0 && (
        <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 10}}>
          <TouchableOpacity 
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

          <TouchableOpacity 
            style={{marginLeft: 15, padding: 8, backgroundColor: '#F1F5F9', borderRadius: 20}} 
            onPress={() => setIsMenuVisible(true)}
          >
            <Ionicons name="ellipsis-vertical" size={20} color="#475569" />
          </TouchableOpacity>
        </View>
      )}

      {filteredSentences.length > 0 && isGenerating && (
        <View style={styles.generationProgress}>
          <ActivityIndicator size="small" color="#2563EB" />
          <Text style={styles.generationProgressText}>Подготавливаем новые предложения…</Text>
        </View>
      )}

      {filteredSentences.length > 0 && Boolean(generationError) && !isGenerating && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText} numberOfLines={2}>{generationError}</Text>
          <TouchableOpacity onPress={() => void generateSentences(selectedLanguageCode, GENERATION_BATCH)} style={styles.errorRetryBtn}>
            <Text style={styles.errorRetryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Primary Action */}
      <View style={[styles.controls, { marginBottom: 5 }]}>
        <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={() => setShowTranslations(!showTranslations)}>
          <Text style={styles.buttonText}>{showTranslations ? 'Скрыть перевод' : 'Перевод'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.btnKnown]} onPress={handleMarkLearned}>
          <Text style={styles.buttonText}>✓ Разобрался</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.button} onPress={handleReveal}>
          <Text style={styles.buttonText}>Разбор</Text>
        </TouchableOpacity>
      </View>

      {/* Options Menu Modal */}
      <Modal visible={isMenuVisible} transparent={true} animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setIsMenuVisible(false)}>
          <View style={[styles.menuCard, {position: 'absolute', bottom: insets.bottom + 120, right: 20}]}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setIsTableMode(!isTableMode); setIsMenuVisible(false); }}
            >
              <Ionicons name="list" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Режим: {isTableMode ? 'Карточки' : 'Таблица'}</Text>
            </TouchableOpacity>
            
            <View style={{height: 1, backgroundColor: '#E2E8F0', marginVertical: 5}} />
            
            <TouchableOpacity 
              style={styles.menuItem} 
              onPress={() => {
                setIsMenuVisible(false);
                void generateSentences(selectedLanguageCode, GENERATION_BATCH);
              }}
            >
              <Ionicons name="sparkles" size={20} color="#2563EB" style={{marginRight: 10}} />
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

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => { setIsMenuVisible(false); openEditModal(); }}
            >
              <Ionicons name="pencil" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Изменить</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={styles.menuItem} 
              onPress={() => { setIsMenuVisible(false); openAddModal(); }}
            >
              <Ionicons name="add" size={20} color="#475569" style={{marginRight: 10}} />
              <Text style={styles.menuItemText}>Добавить</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Add/Edit Sentence Modal */}
      <Modal visible={isModalVisible} animationType="slide" presentationStyle="pageSheet">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalContainer}>
          <Text style={styles.modalHeader}>{editingSentenceId ? 'Редактировать предложение' : 'Добавить предложение'}</Text>
          <TextInput
            style={styles.mainInput}
            placeholder="Введите предложение"
            value={newSentenceText}
            onChangeText={setNewSentenceText}
            multiline
          />
          <TouchableOpacity style={[styles.button, {marginBottom: 15, width: '100%'}]} onPress={parseSentence}>
            <Text style={styles.buttonText}>Разбить на слова (Сброс)</Text>
          </TouchableOpacity>

          <ScrollView style={{flex: 1, width: '100%'}} contentContainerStyle={{paddingBottom: 20}}>
            {parsedTokens.map((token, i) => {
              const partsStr = (token.parts && token.parts.length > 0) ? token.parts.join('-') : token.text;
              
              return (
                <View key={i} style={styles.tokenEditorCard}>
                  <View style={styles.tokenEditorHeader}>
                    <Text style={styles.tokenEditorText}>{token.text}</Text>
                    <TouchableOpacity 
                      style={[styles.dictToggleBtn, token.is_in_my_dict && styles.dictToggleBtnActive]}
                      onPress={() => toggleTokenDict(i)}
                    >
                      <Text style={[styles.dictToggleText, token.is_in_my_dict && {color: '#FFF'}]}>
                        {token.is_in_my_dict ? 'В словаре ✓' : 'Не в словаре'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  
                  <View style={styles.tokenInputsRow}>
                    <View style={styles.tokenInputGroup}>
                      <Text style={styles.tokenInputLabel}>Состав (через дефис)</Text>
                      <TextInput
                        style={styles.tokenInput}
                        placeholder="напр. оқы-ма-ды"
                        value={partsStr}
                        onChangeText={(val) => updateTokenParts(i, val)}
                      />
                    </View>
                    <View style={styles.tokenInputGroup}>
                      <Text style={styles.tokenInputLabel}>Перевод слова</Text>
                      <TextInput
                        style={styles.tokenInput}
                        placeholder="Перевод"
                        value={token.translation}
                        onChangeText={(val) => updateTokenTranslation(i, val)}
                      />
                    </View>
                  </View>
                  
                  <Text style={styles.tokenInputLabel}>Роль в предложении</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexDirection: 'row', paddingTop: 5}}>
                    {STRICT_ORDER.map(role => {
                      const isActive = token.role === role;
                      return (
                        <TouchableOpacity 
                          key={role} 
                          style={[
                            styles.roleSelectBtn, 
                            isActive && { backgroundColor: getRoleColor(role), borderColor: getRoleColor(role) }
                          ]}
                          onPress={() => updateTokenRole(i, role)}
                        >
                          <Text style={[styles.roleSelectText, isActive && {color: '#FFF', fontWeight: 'bold'}]}>
                            {ROLE_TRANSLATIONS[role] || role.replace('_', ' ')}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.controls, {width: '100%', marginBottom: insets.bottom || 20}]}>
            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={() => setModalVisible(false)}>
              <Text style={styles.buttonText}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.btnKnown]} onPress={saveSentence}>
              <Text style={styles.buttonText}>Сохранить</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* AI Explanation Modal */}
      <Modal visible={showAiModal} animationType="fade" transparent={true}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, {maxHeight: '80%'}]}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <Ionicons name="sparkles" size={24} color="#EAB308" style={{marginRight: 8}} />
                <Text style={[styles.modalHeader, {marginBottom: 0}]}>Объяснение ИИ</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAiModal(false)} style={{padding: 5}}>
                <Text style={{fontSize: 20, color: '#94A3B8'}}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              {isAiLoading ? (
                <View style={{padding: 40, alignItems: 'center'}}>
                  <ActivityIndicator size="large" color="#007BFF" />
                  <Text style={{marginTop: 15, color: '#64748B'}}>Анализирую структуру...</Text>
                </View>
              ) : (
                <Markdown style={markdownStyles}>
                  {aiExplanation || ''}
                </Markdown>
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
  sentenceWrapper: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20 },
  tokenContainer: { margin: 4 },
  wordCard: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 8, borderWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, alignItems: 'center', minWidth: 80 },
  orderBadge: { position: 'absolute', top: -10, left: -10, width: 20, height: 20, borderRadius: 10, justifyContent: 'center', alignItems: 'center', zIndex: 1 },
  orderBadgeText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  hiddenCard: { backgroundColor: '#E0E0E0', padding: 10, borderRadius: 8, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', minWidth: 80 },
  wordText: { fontSize: 18, fontWeight: '600' },
  wordRoot: { fontWeight: '600', color: '#111827' },
  wordAffix: { fontWeight: '800' },
  translationText: { fontSize: 14, color: '#666', marginTop: 4 },
  roleText: { fontSize: 10, fontWeight: '600', marginTop: 4, opacity: 0.8 },
  addToDictionaryBtn: { marginTop: 7, backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  addToDictionaryBtnAdded: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  addToDictionaryText: { fontSize: 10, color: '#2563EB', fontWeight: '700' },
  addToDictionaryTextAdded: { color: '#15803D' },
  hiddenText: { fontSize: 18, color: '#999' },
  controls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10, gap: 10 },
  button: { flex: 1, backgroundColor: '#007BFF', padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  swipeHintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
    marginBottom: 8,
  },
  swipeHintText: {
    fontSize: 12,
    color: '#94A3B8',
    fontWeight: '500',
  },
  btnKnown: { backgroundColor: '#28A745' },
  buttonSecondary: { backgroundColor: '#6C757D' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  
  // Table Mode Styles
  tableContainer: { width: '100%', marginTop: 20, backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', paddingBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', padding: 10 },
  tableColWord: { flex: 2, alignItems: 'flex-start' },
  tableColTrans: { flex: 2, paddingHorizontal: 10 },
  tableColRole: { flex: 1.5, alignItems: 'flex-end' },
  tableRoleActions: { alignItems: 'flex-end' },
  
  modalContainer: { flex: 1, padding: 20, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#1E293B' },
  mainInput: { width: '100%', borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
  
  menuCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6, minWidth: 200 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 15 },
  menuItemText: { fontSize: 16, color: '#1E293B', fontWeight: '500' },
  
  tokenEditorCard: { backgroundColor: '#FFF', borderRadius: 12, padding: 15, marginBottom: 15, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  tokenEditorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 },
  tokenEditorText: { fontSize: 20, fontWeight: 'bold', color: '#0F172A' },
  
  dictToggleBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1' },
  dictToggleBtnActive: { backgroundColor: '#EAB308', borderColor: '#EAB308' },
  dictToggleText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  
  tokenInputsRow: { flexDirection: 'row', gap: 10, marginBottom: 15 },
  tokenInputGroup: { flex: 1 },
  tokenInputLabel: { fontSize: 12, color: '#64748B', marginBottom: 4, fontWeight: '500' },
  tokenInput: { width: '100%', borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8, fontSize: 14 },
  
  roleSelectBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', marginHorizontal: 4 },
  roleSelectText: { fontSize: 12, color: '#475569', fontWeight: '500' },
  langSelectBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E0E0E0', marginHorizontal: 5 },
  langSelectBtnActive: { backgroundColor: '#007BFF' },
  langSelectText: { fontSize: 14, color: '#333' },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { width: '100%', backgroundColor: '#FFF', borderRadius: 16, padding: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10, elevation: 6 },
  aiButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF8E7', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#FDE047', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 2, elevation: 2 },
  aiButtonText: { color: '#B45309', fontWeight: '600', fontSize: 14 },
  generationStatus: { color: '#64748B', textAlign: 'center', marginTop: 14, paddingHorizontal: 28, fontSize: 16, lineHeight: 23 },
  generationProgress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  generationProgressText: { color: '#64748B', marginLeft: 8, fontSize: 12 },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007BFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    marginTop: 20,
    shadowColor: '#007BFF',
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginVertical: 6,
    marginHorizontal: 10
  },
  errorBannerText: {
    color: '#DC2626',
    fontSize: 12,
    flex: 1,
    marginRight: 8
  },
  errorRetryBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#DC2626',
    borderRadius: 6
  },
  errorRetryText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold'
  }
});

const markdownStyles = {
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
} as any;
