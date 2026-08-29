import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '../store/useStore';
import { Word } from '../models/types';
import { LANGUAGES } from '../constants/languages';
import EditWordModal from '../components/EditWordModal';

export default function DictionaryScreen() {
  const insets = useSafeAreaInsets();
  const topPadding = Math.max(insets.top, Platform.OS === 'android' ? 24 : 16);
  const { words, activeLanguages, sentences, toggleWordFavorite } = useStore();
  const [searchQuery, setSearchQuery] = useState('');
  
  const wordsInSentences = useMemo(() => {
    const set = new Set<string>();
    sentences.forEach(s => {
      s.words.forEach(w => {
        if (w.is_in_my_dict) {
          if (w.dictionary_word) set.add(w.dictionary_word.toLowerCase());
          else if (w.text) set.add(w.text.toLowerCase());
        }
      });
    });
    return set;
  }, [sentences]);
  
  // State for editing/adding
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingWord, setEditingWord] = useState<Word | null>(null);

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

  const openEditor = (item?: Word) => {
    setEditingWord(item || null);
    setIsModalVisible(true);
  };

  const renderItem = ({ item }: { item: Word }) => {
    const wordKey = item.eng || item.word || '';
    const isInTrainer = wordsInSentences.has(wordKey.toLowerCase());

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
            <TouchableOpacity style={styles.editBtn} onPress={() => toggleWordFavorite(wordKey)}>
              <Text style={[styles.editBtnText, item.is_favorite ? {color: '#F59E0B'} : {color: '#D1D5DB'}]}>
                {item.is_favorite ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.editBtn} onPress={() => openEditor(item)}>
              <Text style={styles.editBtnText}>✏️</Text>
            </TouchableOpacity>
            {!!item.is_learned && <Text style={styles.badgeLearned}>Выучено</Text>}
            {isInTrainer && <Text style={styles.badgeTrainer}>В тренажере</Text>}
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
        {!!item.personal_association && (
          <View style={styles.assocBox}>
            <Text style={styles.assocTitle}>💡 Личная ассоциация:</Text>
            <Text style={styles.assocContent}>{item.personal_association}</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: topPadding }]}>
      <View style={styles.headerTitleRow}>
        <Text style={styles.header}>Словарь ({filteredWords.length})</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => openEditor()}>
          <Text style={styles.addBtnText}>+ Добавить</Text>
        </TouchableOpacity>
      </View>
      
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
    padding: 16,
    backgroundColor: '#F8F9FA',
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 10,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#212529',
  },
  addBtn: {
    backgroundColor: '#EBF5FF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BEE3F8',
  },
  addBtnText: {
    color: '#2B6CB0',
    fontWeight: 'bold',
    fontSize: 14,
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
  badgeTrainer: {
    backgroundColor: '#FFFBEB',
    color: '#D97706',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 'bold',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#FDE68A',
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
  editBtn: {
    padding: 4,
    marginRight: 4,
  },
  editBtnText: {
    fontSize: 16,
  },
});
