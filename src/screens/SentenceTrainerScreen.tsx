import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, TextInput, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { SyntaxRole, Token } from '../models/types';
import { LANGUAGES } from '../constants/languages';

const STRICT_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction', 
  'Preposition', 'Particle', 'Article', 'Other'
];

export default function SentenceTrainerScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { sentences, addSentence, activeLanguage, targetSentenceInfo, setTargetSentenceInfo } = useStore();
  const [currentFilteredIndex, setCurrentFilteredIndex] = useState(0);
  const [revealedRoles, setRevealedRoles] = useState<SyntaxRole[]>([]);
  const [showTranslations, setShowTranslations] = useState(false);

  // Modal state
  const [isModalVisible, setModalVisible] = useState(false);
  const [newSentenceText, setNewSentenceText] = useState('');
  const [newSentenceTranslation, setNewSentenceTranslation] = useState('');
  const [parsedTokens, setParsedTokens] = useState<Token[]>([]);

  const [selectedLanguageCode, setSelectedLanguageCode] = useState(activeLanguage);

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
    }
  };

  const handleFlash = () => setRevealedRoles(STRICT_ORDER);

  const openAddModal = () => {
    setNewSentenceText('');
    setNewSentenceTranslation('');
    setParsedTokens([]);
    setModalVisible(true);
  };

  const parseSentence = () => {
    // Split by spaces and remove punctuation for simplicity
    const words = newSentenceText.trim().split(/\s+/);
    const tokens: Token[] = words.map((w) => ({
      text: w,
      label: w,
      translation: '', // user can fill this later if needed
      role: 'Other', // default role
      is_in_my_dict: false
    }));
    setParsedTokens(tokens);
  };

  const updateTokenRole = (index: number, role: SyntaxRole) => {
    const updated = [...parsedTokens];
    updated[index].role = role;
    setParsedTokens(updated);
  };

  const saveNewSentence = () => {
    if (!newSentenceText || parsedTokens.length === 0) {
      alert('Пожалуйста, введите предложение и разберите его.');
      return;
    }
    
    addSentence({
      id: Date.now().toString(),
      language: activeLangObj?.label || 'Unknown',
      sentence: newSentenceText,
      words: parsedTokens
    });
    
    setModalVisible(false);
  };

  const renderToken = (token: Token, index: number) => {
    const isRevealed = revealedRoles.includes(token.role);

    return (
      <View key={`${index}-${token.text}`} style={styles.tokenContainer}>
        {isRevealed ? (
          <View style={[styles.wordCard, token.is_in_my_dict && styles.inDictBorder]}>
            <Text style={styles.wordText}>{token.text}</Text>
            {showTranslations && <Text style={styles.translationText}>{token.translation}</Text>}
            <Text style={styles.roleText}>{token.role}</Text>
          </View>
        ) : (
          <View style={styles.hiddenCard}>
            <Text style={styles.hiddenText}>???</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <Text style={styles.header}>Разбор предложений</Text>
      
      {/* Language Selector */}
      <View style={{height: 50, marginBottom: 10}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center'}}>
          {LANGUAGES.map(lang => (
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
          <ScrollView contentContainerStyle={styles.sentenceWrapper}>
            {currentSentence?.words?.map(renderToken)}
          </ScrollView>
        </TouchableOpacity>
      ) : (
        <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
          <Text style={{color: '#999'}}>No sentences found for {activeLangObj?.label}</Text>
        </View>
      )}

      <View style={styles.controls}>
        <TouchableOpacity style={styles.button} onPress={handleNextStep}>
          <Text style={styles.buttonText}>Step (Next Role)</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.button, showTranslations ? styles.buttonActive : styles.buttonSecondary]} 
          onPress={() => setShowTranslations(!showTranslations)}
        >
          <Text style={styles.buttonText}>Toggle Translations</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.button, {backgroundColor: '#17A2B8'}]} onPress={openAddModal}>
          <Text style={styles.buttonText}>+ Add Sentence</Text>
        </TouchableOpacity>
      </View>

      {/* Add Sentence Modal */}
      <Modal visible={isModalVisible} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modalContainer}>
          <Text style={styles.modalHeader}>Add New Sentence</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter sentence in foreign language"
            value={newSentenceText}
            onChangeText={setNewSentenceText}
          />
          <TextInput
            style={styles.input}
            placeholder="Enter translation (RU)"
            value={newSentenceTranslation}
            onChangeText={setNewSentenceTranslation}
          />
          <TouchableOpacity style={[styles.button, {marginBottom: 20}]} onPress={parseSentence}>
            <Text style={styles.buttonText}>Parse into Words</Text>
          </TouchableOpacity>

          <ScrollView style={{flex: 1, width: '100%'}}>
            {parsedTokens.map((token, i) => (
              <View key={i} style={styles.tokenEditorRow}>
                <Text style={styles.tokenEditorText}>{token.text}</Text>
                
                {/* Simplified Role Selector (React Native lacks a built-in cross-platform select) */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1}}>
                  {STRICT_ORDER.map(role => (
                    <TouchableOpacity 
                      key={role} 
                      style={[styles.roleSelectBtn, token.role === role && styles.roleSelectBtnActive]}
                      onPress={() => updateTokenRole(i, role)}
                    >
                      <Text style={[styles.roleSelectText, token.role === role && {color: '#FFF'}]}>
                        {role}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.controls, {width: '100%'}]}>
            <TouchableOpacity style={[styles.button, styles.buttonSecondary]} onPress={() => setModalVisible(false)}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.btnKnown]} onPress={saveNewSentence}>
              <Text style={styles.buttonText}>Save Sentence</Text>
            </TouchableOpacity>
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
  wordCard: { backgroundColor: '#FFFFFF', padding: 10, borderRadius: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3, alignItems: 'center', minWidth: 80 },
  inDictBorder: { borderWidth: 2, borderColor: '#FFC107' },
  hiddenCard: { backgroundColor: '#E0E0E0', padding: 10, borderRadius: 8, alignItems: 'center', minWidth: 80 },
  wordText: { fontSize: 18, fontWeight: '600' },
  translationText: { fontSize: 14, color: '#666', marginTop: 4 },
  roleText: { fontSize: 10, color: '#999', marginTop: 4 },
  hiddenText: { fontSize: 18, color: '#999' },
  controls: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20, gap: 10 },
  button: { flex: 1, backgroundColor: '#007BFF', padding: 15, borderRadius: 10, alignItems: 'center' },
  buttonSecondary: { backgroundColor: '#6C757D' },
  buttonActive: { backgroundColor: '#28A745' },
  btnKnown: { backgroundColor: '#28A745' },
  buttonText: { color: '#FFF', fontWeight: 'bold' },
  
  modalContainer: { flex: 1, padding: 20, backgroundColor: '#FFF', alignItems: 'center' },
  modalHeader: { fontSize: 22, fontWeight: 'bold', marginBottom: 20 },
  input: { width: '100%', borderWidth: 1, borderColor: '#CCC', padding: 15, borderRadius: 10, marginBottom: 15, fontSize: 16 },
  tokenEditorRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#EEE', width: '100%' },
  tokenEditorText: { fontSize: 18, fontWeight: 'bold', width: 100 },
  roleSelectBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15, backgroundColor: '#EEE', marginHorizontal: 3 },
  roleSelectBtnActive: { backgroundColor: '#007BFF' },
  roleSelectText: { fontSize: 12, color: '#333' },
  langSelectBtn: { paddingHorizontal: 15, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E0E0E0', marginHorizontal: 5 },
  langSelectBtnActive: { backgroundColor: '#007BFF' },
  langSelectText: { fontSize: 14, color: '#333' }
});
