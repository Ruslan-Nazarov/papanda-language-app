import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SyntaxRole, Token } from '../models/types';
import { computeSentenceGroups } from '../utils/sentenceGroups';

const ROLE_RU: Record<SyntaxRole, string> = {
  Subject: 'Подлежащее',
  Predicate: 'Сказуемое',
  Object: 'Дополнение',
  Attribute: 'Определение',
  Attribute_Subject: 'Определение',
  Attribute_Object: 'Определение',
  Circumstance: 'Обстоятельство',
  Adverbial: 'Обстоятельство',
  Conjunction: 'Союз',
  Preposition: 'Предлог',
  Particle: 'Частица',
  Article: 'Артикль',
  Other: 'Другое',
};

const roleColor = (role: SyntaxRole) => {
  switch (role) {
    case 'Subject':
      return '#3B82F6';
    case 'Predicate':
      return '#EF4444';
    case 'Object':
      return '#F97316';
    case 'Attribute':
    case 'Attribute_Subject':
    case 'Attribute_Object':
      return '#10B981';
    case 'Circumstance':
    case 'Adverbial':
      return '#8B5CF6';
    default:
      return '#CBD5E1';
  }
};

const EXAMPLE_TEXT = 'La bambina legge un libro nuovo';
const EXAMPLE_TOKENS: Token[] = [
  { text: 'La', label: 'La', role: 'Article', translation: 'артикль', is_in_my_dict: false },
  { text: 'bambina', label: 'bambina', role: 'Subject', translation: 'девочка', is_in_my_dict: false },
  { text: 'legge', label: 'legge', role: 'Predicate', translation: 'читает', is_in_my_dict: false },
  { text: 'un', label: 'un', role: 'Article', translation: 'артикль', is_in_my_dict: false },
  { text: 'libro', label: 'libro', role: 'Object', translation: 'книгу', is_in_my_dict: false },
  { text: 'nuovo', label: 'nuovo', role: 'Attribute_Object', translation: 'новую', is_in_my_dict: false },
];

interface Props {
  onDone: () => void;
}

export default function OnboardingScreen({ onDone }: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);

  const groups = useMemo(() => computeSentenceGroups(EXAMPLE_TOKENS), []);
  const [revealed, setRevealed] = useState(0);
  const exampleDone = revealed >= groups.length;

  const PAGE_COUNT = 3;

  const goTo = (next: number) => {
    const clamped = Math.max(0, Math.min(PAGE_COUNT - 1, next));
    scrollRef.current?.scrollTo({ x: clamped * width, animated: true });
    setPage(clamped);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const p = Math.round(e.nativeEvent.contentOffset.x / width);
    if (p !== page) setPage(p);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.skipRow}>
        {page < PAGE_COUNT - 1 ? (
          <TouchableOpacity onPress={onDone} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={styles.skipText}>Пропустить</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ height: 20 }} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {/* Page 1 — value proposition */}
        <ScrollView
          style={{ width }}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <Image source={require('../../assets/logo.png')} style={styles.hero} resizeMode="contain" />
          </View>
          <Text style={styles.lead}>
            Язык — это не список слов. Это то, как из слов собирается мысль.
          </Text>
          <Text style={styles.body}>
            papanda берёт живое предложение и раскладывает его на части — в том порядке,
            в котором рождается мысль: сначала действие, потом кто действует, потом над чем.
          </Text>
        </ScrollView>

        {/* Page 2 — the four tabs */}
        <ScrollView
          style={{ width }}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Четыре вкладки</Text>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>📚</Text>
            <View style={styles.featureTextWrap}>
              <Text style={styles.featureName}>Слова</Text>
              <Text style={styles.featureDesc}>
                Карточка слова сразу на нескольких языках. Отмечаешь «знаю» или «не знаю».
              </Text>
            </View>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>💬</Text>
            <View style={styles.featureTextWrap}>
              <Text style={styles.featureName}>Разбор предложений</Text>
              <Text style={styles.featureDesc}>
                Сердце papanda. Предложение → карточки по членам (сказуемое, подлежащее,
                дополнение…), с выделением морфем, которые несут смысл.
              </Text>
            </View>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>⚡</Text>
            <View style={styles.featureTextWrap}>
              <Text style={styles.featureName}>Тренировка</Text>
              <Text style={styles.featureDesc}>
                Быстрый прогон «знаю / не знаю». Приложение само поднимает то, что пора
                повторить.
              </Text>
            </View>
          </View>
          <View style={styles.featureRow}>
            <Text style={styles.featureEmoji}>📊</Text>
            <View style={styles.featureTextWrap}>
              <Text style={styles.featureName}>Статистика</Text>
              <Text style={styles.featureDesc}>
                Индекс запоминания (iMW) и динамика по дням.
              </Text>
            </View>
          </View>
        </ScrollView>

        {/* Page 3 — live example */}
        <ScrollView
          style={{ width }}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title}>Как это выглядит</Text>
          <Text style={styles.exampleSentence}>{EXAMPLE_TEXT}</Text>
          <Text style={styles.exampleMeta}>итальянский · «Девочка читает новую книгу»</Text>

          <View style={styles.cardsWrap}>
            {groups.map((group, gi) => {
              const shown = gi < revealed;
              return group.tokenIndices.map((ti) => {
                const token = EXAMPLE_TOKENS[ti];
                if (!shown) {
                  return (
                    <View key={`${gi}-${ti}`} style={styles.hiddenCard}>
                      <Text style={styles.hiddenText}>???</Text>
                    </View>
                  );
                }
                return (
                  <View
                    key={`${gi}-${ti}`}
                    style={[styles.wordCard, { borderColor: roleColor(token.role) }]}
                  >
                    <View style={[styles.orderBadge, { backgroundColor: roleColor(token.role) }]}>
                      <Text style={styles.orderBadgeText}>{gi + 1}</Text>
                    </View>
                    <Text style={styles.wordText}>{token.text}</Text>
                    <Text style={styles.translationText}>{token.translation}</Text>
                    <Text style={[styles.roleText, { color: roleColor(token.role) }]}>
                      {ROLE_RU[token.role]}
                    </Text>
                  </View>
                );
              });
            })}
          </View>

          {exampleDone ? (
            <Text style={styles.exampleHint}>
              papanda показывает каждое предложение так — от действия к деталям.
            </Text>
          ) : (
            <TouchableOpacity
              style={styles.revealButton}
              onPress={() => setRevealed((n) => Math.min(groups.length, n + 1))}
            >
              <Text style={styles.revealButtonText}>
                {revealed === 0 ? 'Собрать разбор' : 'Следующий член →'}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </ScrollView>

      <View style={styles.dotsRow}>
        {Array.from({ length: PAGE_COUNT }).map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {page < PAGE_COUNT - 1 ? (
          <TouchableOpacity style={styles.primaryButton} onPress={() => goTo(page + 1)}>
            <Text style={styles.primaryButtonText}>Далее</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.primaryButton, !exampleDone && styles.primaryButtonMuted]}
            onPress={onDone}
          >
            <Text style={styles.primaryButtonText}>
              {exampleDone ? 'Начать' : 'Начать без примера'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  skipRow: { height: 36, justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 20 },
  skipText: { color: '#94A3B8', fontSize: 15, fontWeight: '600' },
  pageContent: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 12, paddingBottom: 24, justifyContent: 'center' },

  heroCard: {
    backgroundColor: '#FBE7D5',
    borderRadius: 20,
    paddingVertical: 10,
    marginBottom: 18,
    overflow: 'hidden',
  },
  hero: { width: '100%', height: 190 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#0F172A', textAlign: 'center', marginBottom: 16 },
  lead: { fontSize: 19, fontWeight: '600', color: '#1E293B', textAlign: 'center', lineHeight: 27, marginBottom: 16 },
  body: { fontSize: 15, color: '#475569', textAlign: 'center', lineHeight: 23 },

  featureRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 20 },
  featureEmoji: { fontSize: 26, width: 40, textAlign: 'center' },
  featureTextWrap: { flex: 1, paddingLeft: 8 },
  featureName: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 3 },
  featureDesc: { fontSize: 14, color: '#475569', lineHeight: 21 },

  exampleSentence: { fontSize: 20, fontWeight: '600', color: '#1E293B', textAlign: 'center' },
  exampleMeta: { fontSize: 13, color: '#94A3B8', textAlign: 'center', marginTop: 4, marginBottom: 20 },
  cardsWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'flex-start', gap: 12, minHeight: 120 },
  wordCard: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    minWidth: 84,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  orderBadge: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  orderBadgeText: { color: '#FFF', fontSize: 11, fontWeight: 'bold' },
  wordText: { fontSize: 18, fontWeight: '600', color: '#111827' },
  translationText: { fontSize: 13, color: '#666', marginTop: 4 },
  roleText: { fontSize: 10, fontWeight: '600', marginTop: 4 },
  hiddenCard: {
    backgroundColor: '#E5E7EB',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    minWidth: 84,
    minHeight: 58,
    justifyContent: 'center',
  },
  hiddenText: { fontSize: 18, color: '#9CA3AF' },
  exampleHint: { fontSize: 15, color: '#1E293B', textAlign: 'center', lineHeight: 22, marginTop: 24, fontWeight: '500' },
  revealButton: {
    alignSelf: 'center',
    marginTop: 24,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 24,
  },
  revealButtonText: { color: '#2563EB', fontWeight: '700', fontSize: 15 },

  dotsRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, paddingVertical: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#CBD5E1' },
  dotActive: { backgroundColor: '#2563EB', width: 20 },

  footer: { paddingHorizontal: 28, paddingTop: 4 },
  primaryButton: { backgroundColor: '#007BFF', paddingVertical: 15, borderRadius: 14, alignItems: 'center' },
  primaryButtonMuted: { backgroundColor: '#94A3B8' },
  primaryButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
});
