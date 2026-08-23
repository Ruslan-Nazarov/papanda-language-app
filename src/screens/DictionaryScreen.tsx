import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Modal, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';

export default function DictionaryScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, saveWordAssociation } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  
  // State for editing association
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [tempAssoc, setTempAssoc] = useState('');

  const filteredWords = useMemo(() => {
    if (!searchQuery.trim()) return words;
    const query = searchQuery.trim().toLowerCase();

    return words.filter(w => {
      const ruMatch = w.ru?.toLowerCase().includes(query);
      const engMatch = (w.eng || w.word)?.toLowerCase().includes(query);
      const assocMatch = w.personal_association?.toLowerCase().includes(query);
      
      // Check active languages translations
      const transMatch = activeLanguages.some(lang => {
        const trans = (w[lang as keyof Word] || (w.translations && w.translations[lang])) as string | undefined;
        return trans?.toLowerCase().includes(query);
      });

      return ruMatch || engMatch || assocMatch || transMatch;
    });
  }, [words, searchQuery, activeLanguages]);

  const openAssocEditor = (item: Word) => {
    setEditingWord(item);
    setTempAssoc(item.personal_association || '');
  };

  const saveAssoc = () => {
    if (editingWord) {
      const wordKey = editingWord.eng || editingWord.word || '';
      saveWordAssociation(wordKey, tempAssoc);
      setEditingWord(null);
    }
  };

  const renderItem = ({ item }: { item: Word }) => {
    const wordKey = item.eng || item.word || '';

    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <View style={{flex: 1}}>
            <Text style={styles.baseWord}>{item.ru || wordKey}</Text>
            {!!item.eng && item.ru && (
              <Text style={styles.subEng}>{item.eng}</Text>
            )}
          </View>

          <View style={styles.badges}>
            {!!item.is_learned && <Text style={styles.badgeLearned}>Выучено</Text>}
            <Text style={styles.badgeCount}>{(item.count || 0)} пок.</Text>
          </View>
        </View>

        {/* Translations for activeLanguages only */}
        <View style={styles.translationsContainer}>
          {activeLanguages.map(lang => {
            const trans = (item[lang as keyof Word] || (item.translations && item.translations[lang])) as string | undefined;
            const langFlag = LANGUAGES.find(l => l.code === lang)?.flag || '';
            const langLabel = lang.toUpperCase();

            if (!trans) return null;

            return (
              <View key={lang} style={styles.transChip}>
                <Text style={styles.chipFlag}>{langFlag} {langLabel}:</Text>
                <Text style={styles.chipText}>{trans}</Text>
              </View>
            );
          })}
        </View>

        {/* Personal Association */}
        <TouchableOpacity 
          style={styles.assocBox}
          activeOpacity={0.7}
          onPress={() => openAssocEditor(item)}
        >
          <View style={styles.assocHeader}>
            <Text style={styles.assocTitle}>💡 Личная ассоциация:</Text>
            <Text style={styles.assocEditLink}>{item.personal_association ? 'ред.' : '+ добавить'}</Text>
          </View>
          <Text style={[styles.assocContent, !item.personal_association && styles.assocEmpty]}>
            {item.personal_association || 'Нажмите, чтобы добавить ассоциацию для быстрого запоминания'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <Text style={styles.header}>Словарь ({filteredWords.length})</Text>
      
      <View style={styles.searchBar}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Поиск по слову, переводу или ассоциации..."
          placeholderTextColor="#999"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearBtn}>
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredWords}
        keyExtractor={(item, idx) => (item.eng || item.word || idx.toString())}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        initialNumToRender={15}
        maxToRenderPerBatch={20}
        windowSize={10}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Ничего не найдено по запросу "{searchQuery}"</Text>
          </View>
        }
      />

      {/* Association Edit Modal */}
      <Modal visible={!!editingWord} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Ассоциация для слова</Text>
            <Text style={styles.modalWordName}>{editingWord?.ru} ({editingWord?.eng || editingWord?.word})</Text>

            <TextInput
              style={styles.modalInput}
              multiline
              autoFocus
              placeholder="Введите личную ассоциацию или смысловой якорь..."
              value={tempAssoc}
              onChangeText={setTempAssoc}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, styles.modalCancel]} onPress={() => setEditingWord(null)}>
                <Text style={styles.modalCancelText}>Отмена</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, styles.modalSave]} onPress={saveAssoc}>
                <Text style={styles.modalSaveText}>Сохранить</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F8F9FA',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 12,
    textAlign: 'center',
    marginTop: 10,
    color: '#212529',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#1A202C',
    padding: 0,
  },
  clearBtn: {
    padding: 4,
  },
  clearBtnText: {
    fontSize: 14,
    color: '#A0AEC0',
    fontWeight: 'bold',
  },
  list: {
    paddingBottom: 30,
  },
  card: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#EDF2F7',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  baseWord: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2D3748',
  },
  subEng: {
    fontSize: 14,
    color: '#718096',
    marginTop: 2,
  },
  translationsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 6,
  },
  transChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDF2F7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  chipFlag: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    marginRight: 5,
  },
  chipText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#007BFF',
  },
  assocBox: {
    marginTop: 10,
    backgroundColor: '#FFFDF0',
    borderWidth: 1,
    borderColor: '#FEF08A',
    borderRadius: 10,
    padding: 10,
  },
  assocHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  assocTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#B45309',
  },
  assocEditLink: {
    fontSize: 12,
    color: '#007BFF',
    fontWeight: '600',
  },
  assocContent: {
    fontSize: 13,
    color: '#4A5568',
    lineHeight: 18,
  },
  assocEmpty: {
    color: '#A0AEC0',
    fontStyle: 'italic',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeLearned: {
    backgroundColor: '#E6F4EA',
    color: '#137333',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
  },
  badgeCount: {
    backgroundColor: '#F1F3F4',
    color: '#5F6368',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: '600',
    overflow: 'hidden',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#A0AEC0',
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A202C',
  },
  modalWordName: {
    fontSize: 14,
    color: '#718096',
    marginTop: 4,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E0',
    borderRadius: 10,
    padding: 12,
    minHeight: 90,
    fontSize: 15,
    textAlignVertical: 'top',
    backgroundColor: '#F8FAFC',
    marginBottom: 16,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  modalCancel: {
    backgroundColor: '#EDF2F7',
  },
  modalCancelText: {
    color: '#4A5568',
    fontWeight: '600',
  },
  modalSave: {
    backgroundColor: '#007BFF',
  },
  modalSaveText: {
    color: '#FFF',
    fontWeight: 'bold',
  },
});
