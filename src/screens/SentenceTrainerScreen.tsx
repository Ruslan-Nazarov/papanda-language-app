import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { SyntaxRole, Token } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import { explainSentenceWithAI } from '../services/aiService';

const STRICT_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction', 
  'Preposition', 'Particle', 'Article', 'Other'
];

const AFFIX_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6']; // Palette for multiple suffixes

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
  const { sentences, addSentence, updateSentence, activeLanguages, targetSentenceInfo, setTargetSentenceInfo } = useStore();
  const [currentFilteredIndex, setCurrentFilteredIndex] = useState(0);
  const [revealedRoles, setRevealedRoles] = useState<SyntaxRole[]>([]);
  const [showTranslations, setShowTranslations] = useState(false);
  const [isTableMode, setIsTableMode] = useState(false);

  // Modal state
  const [isModalVisible, setModalVisible] = useState(false);
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [newSentenceText, setNewSentenceText] = useState('');
  const [parsedTokens, setParsedTokens] = useState<Token[]>([]);

  // AI state
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);

  const [selectedLanguageCode, setSelectedLanguageCode] = useState(activeLanguages[0] || 'it');

  // Filter sentences by selectedLanguageCode
  const activeLangObj = LANGUAGES.find(l => l.code === selectedLanguageCode);
  const filteredSentences = sentences.filter(s => {
    if (!s.language || !activeLangObj) return false;
    return s.language.toLowerCase().includes(activeLangObj.label.toLowerCase());
  });

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
          setRevealedRoles(STRICT_ORDER); // Reveal to show the sentence structure
          setShowTranslations(true);
        }
      }
      
      // Clear target so user can freely navigate afterward
      setTargetSentenceInfo(null);
    }
  }, [targetSentenceInfo, sentences]);
  
  const currentSentence = filteredSentences[currentFilteredIndex];

  const handleNextStep = () => {
    if (!currentSentence) return;
    
    const rolesInSentence = new Set(currentSentence.words.map((t: Token) => t.role));
    const nextRole = STRICT_ORDER.find(role => rolesInSentence.has(role) && !revealedRoles.includes(role));
    
    if (nextRole) {
      setRevealedRoles(prev => [...prev, nextRole]);
    } else {
      if (currentFilteredIndex < filteredSentences.length - 1) {
        setCurrentFilteredIndex(prev => prev + 1);
      } else {
        setCurrentFilteredIndex(0);
      }
      setRevealedRoles([]);
      setShowTranslations(false);
      setAiExplanation(null);
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
    // Form a rough translation from token translations
    const nativeTranslation = currentSentence.words.map(w => w.translation).filter(Boolean).join(' ');
    
    setIsAiLoading(true);
    setShowAiModal(true);
    try {
      const result = await explainSentenceWithAI(sentenceText, activeLangObj?.label || 'Unknown', nativeTranslation);
      setAiExplanation(result);
    } catch (error: any) {
      alert(error.message);
      setShowAiModal(false);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleFlash = () => setRevealedRoles(STRICT_ORDER);

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
      alert('Пожалуйста, введите предложение и разберите его.');
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
    const isRevealed = revealedRoles.includes(token.role);

    return (
      <View key={`${index}-${token.text}`} style={styles.tokenContainer}>
        {isRevealed ? (
          <View style={[
            styles.wordCard, 
            { borderColor: getRoleColor(token.role) },
            token.is_in_my_dict && { backgroundColor: '#FFFDF0' } // Gentle yellow background for dict words
          ]}>
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
          </View>
        ) : (
          <View style={styles.hiddenCard}>
            <Text style={styles.hiddenText}>???</Text>
          </View>
        )}
      </View>
    );
  };

  const renderTokenTableMode = (token: Token, index: number) => {
    const isRevealed = revealedRoles.includes(token.role);

    return (
      <View key={`${index}-${token.text}`} style={styles.tableRow}>
        <View style={styles.tableColWord}>
          {isRevealed ? (
            <View style={[
              styles.wordCard, 
              { borderColor: getRoleColor(token.role), minWidth: 0, paddingVertical: 8, paddingHorizontal: 12 },
              token.is_in_my_dict && { backgroundColor: '#FFFDF0' }
            ]}>
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
            </View>
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
            <Text style={[styles.roleText, { color: getRoleColor(token.role), marginTop: 0 }]}>
              {ROLE_TRANSLATIONS[token.role] || token.role.replace('_', ' ')}
            </Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={{flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginBottom: 20, position: 'relative'}}>
        <Text style={[styles.header, {marginBottom: 0}]}>Разбор предложений</Text>
        {filteredSentences.length > 0 && (
          <TouchableOpacity 
            onPress={handleExplainAI} 
            disabled={isAiLoading}
            style={{position: 'absolute', right: 0, padding: 5}}
          >
            {isAiLoading ? (
              <ActivityIndicator size="small" color="#EAB308" />
            ) : (
              <Text style={{fontSize: 22}}>✨</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
      
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
                setRevealedRoles([]);
                setShowTranslations(false);
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
        <TouchableOpacity activeOpacity={0.9} onPress={handleFlash} style={{flex: 1}}>
          <ScrollView contentContainerStyle={isTableMode ? styles.tableContainer : styles.sentenceWrapper}>
            {isTableMode 
              ? currentSentence?.words?.map(renderTokenTableMode)
              : currentSentence?.words?.map(renderToken)
            }
          </ScrollView>
        </TouchableOpacity>
      ) : (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
          <Text style={{color: '#999'}}>No sentences found for {activeLangObj?.label}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={handleNextStep}>
          <Text style={styles.buttonText}>Шаг (Роль)</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, showTranslations ? styles.buttonActive : styles.buttonSecondary]} 
          onPress={() => setShowTranslations(!showTranslations)}
        >
          <Text style={styles.buttonText}>Перевод</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, styles.buttonSecondary]} 
          onPress={() => setIsTableMode(!isTableMode)}
        >
          <Text style={styles.buttonText}>{isTableMode ? 'Карточки' : 'Таблица'}</Text>
        </TouchableOpacity>
      </View>
      
      <View style={[styles.controls, {marginTop: 10}]}>
        <TouchableOpacity style={[styles.button, {backgroundColor: '#17A2B8'}]} onPress={openEditModal}>
          <Text style={styles.buttonText}>Edit Current</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, {backgroundColor: '#20C997'}]} onPress={openAddModal}>
          <Text style={styles.buttonText}>+ Add New</Text>
        </TouchableOpacity>
      </View>

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
              <Text style={[styles.modalHeader, {marginBottom: 0}]}>✨ Объяснение ИИ</Text>
              <TouchableOpacity onPress={() => setShowAiModal(false)} style={{padding: 5}}>
                <Text style={{fontSize: 20, color: '#94A3B8'}}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <ScrollView style={{flex: 1}} showsVerticalScrollIndicator={false}>
              {isAiLoading ? (
                <View style={{padding: 40, alignItems: 'center'}}>
                  <ActivityIndicator size="large" color="#007BFF" />
                  <Text style={{marginTop: 15, color: '#64748B'}}>Анализирую структуру...</Text>
                </View>
              ) : (
                <Text style={styles.aiText}>{aiExplanation}</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: '#F5F5F5' },
  header: { fontSize: 24, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  sentenceWrapper: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 20 },
  tokenContainer: { margin: 4 },
  wordCard: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 8, borderWidth: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, alignItems: 'center', minWidth: 80 },
  hiddenCard: { backgroundColor: '#E0E0E0', padding: 10, borderRadius: 8, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', minWidth: 80 },
  wordText: { fontSize: 18, fontWeight: '600' },
  wordRoot: { fontWeight: '600', color: '#111827' },
  wordAffix: { fontWeight: '800' },
  translationText: { fontSize: 14, color: '#666', marginTop: 4 },
  roleText: { fontSize: 10, fontWeight: '600', marginTop: 4, opacity: 0.8 },
  hiddenText: { fontSize: 18, color: '#999' },
  controls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 10, gap: 10 },
  button: { flex: 1, backgroundColor: '#007BFF', padding: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonSecondary: { backgroundColor: '#6C757D' },
  buttonActive: { backgroundColor: '#28A745' },
  btnKnown: { backgroundColor: '#28A745' },
  buttonText: { color: '#FFF', fontWeight: 'bold', fontSize: 13, textAlign: 'center' },
  
  // Table Mode Styles
  tableContainer: { width: '100%', marginTop: 20, backgroundColor: '#FFF', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#E2E8F0', paddingBottom: 10 },
  tableRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#E2E8F0', padding: 10 },
  tableColWord: { flex: 2, alignItems: 'flex-start' },
  tableColTrans: { flex: 2, paddingHorizontal: 10 },
  tableColRole: { flex: 1.5, alignItems: 'flex-end' },
  
  modalContainer: { flex: 1, padding: 20, backgroundColor: '#F8FAFC', alignItems: 'center' },
  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 15, color: '#1E293B' },
  mainInput: { width: '100%', borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16, minHeight: 80, textAlignVertical: 'top' },
  
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
  aiText: { fontSize: 15, lineHeight: 24, color: '#334155' }
});
