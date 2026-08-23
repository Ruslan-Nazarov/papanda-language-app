import { Word, Sentence } from '../models/types';

export const mockWords: Word[] = [
  {
    id: 'w1',
    word: 'apple',
    eng: 'apple',
    ru: 'яблоко',
    translations: { es: 'manzana', it: 'mela' },
    meaning: 'Круглый фрукт красного или зеленого цвета.',
    count: 0,
    is_learned: 0,
    knowledge_stats: { es: true, it: false },
    show_stats: { es: 1, it: 1 },
  },
  {
    id: 'w2',
    word: 'run',
    eng: 'run',
    ru: 'бежать',
    translations: { es: 'correr', it: 'correre' },
    meaning: 'Двигаться со скоростью быстрее шага.',
    count: 0,
    is_learned: 0,
    knowledge_stats: { es: true, it: true },
    show_stats: { es: 2, it: 2 },
  },
  {
    id: 'w3',
    word: 'beautiful',
    eng: 'beautiful',
    ru: 'красивый',
    translations: { es: 'hermoso', it: 'bello' },
    meaning: 'Приятный для чувств или разума эстетически.',
    count: 0,
    is_learned: 0,
    knowledge_stats: {},
    show_stats: {},
  }
];

export const mockSentences: Sentence[] = [
  {
    id: 's1',
    language: 'English',
    sentence: 'The quick brown fox jumps over the lazy dog.',
    words: [
      { text: 'The', label: 'the', role: 'Article', translation: 'Определенный артикль', is_in_my_dict: false },
      { text: 'quick', label: 'quick', role: 'Attribute_Subject', translation: 'быстрая', is_in_my_dict: true, parts: ['quick'] },
      { text: 'brown', label: 'brown', role: 'Attribute_Subject', translation: 'коричневая', is_in_my_dict: false },
      { text: 'fox', label: 'fox', role: 'Subject', translation: 'лиса', is_in_my_dict: true },
      { text: 'jumps', label: 'jump', role: 'Predicate', translation: 'прыгает', is_in_my_dict: false, parts: ['jump', 's'] },
      { text: 'over', label: 'over', role: 'Preposition', translation: 'через', is_in_my_dict: false },
      { text: 'the', label: 'the', role: 'Article', translation: 'Определенный артикль', is_in_my_dict: false },
      { text: 'lazy', label: 'lazy', role: 'Attribute_Object', translation: 'ленивую', is_in_my_dict: true },
      { text: 'dog', label: 'dog', role: 'Object', translation: 'собаку', is_in_my_dict: false },
      { text: '.', label: '.', role: 'Other', translation: '.', is_in_my_dict: false },
    ]
  }
];
