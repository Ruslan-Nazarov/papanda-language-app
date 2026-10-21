import type { SyntaxRole } from '../models/types';

export const STRICT_ORDER: SyntaxRole[] = [
  'Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object',
  'Attribute_Object', 'Circumstance', 'Adverbial', 'Conjunction',
  'Preposition', 'Particle', 'Article', 'Other'
];

export const ROLE_TRANSLATIONS: Record<SyntaxRole, string> = {
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

export const getRoleColor = (role: SyntaxRole) => {
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
