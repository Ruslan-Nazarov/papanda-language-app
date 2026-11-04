import type { Sentence } from '../models/types';
import { localDateKey } from './date';

export interface SentenceAnalysis {
  id: string;
  language: string;
  sentence: string;
  createdAt: string;
  labels: { label: string; count: number; examples: string[] }[];
}

// Use the card's annotations, never guess morphology from a word's spelling.
const LABELS: Record<string, string> = {
  adjective: 'Прилагательное', subject: 'Подлежащее', object: 'Дополнение',
  particle: 'Частица', place: 'Место', time: 'Время', conjunction: 'Союз',
  pronoun: 'Местоимение', auxiliary: 'Вспомогательный глагол', verb: 'Глагол',
  participle: 'Причастие', gerund: 'Герундий / деепричастие', adverb: 'Наречие',
  postposition: 'Послелог', article: 'Артикль', noun: 'Существительное',
  infinitive: 'Инфинитив', preposition: 'Предлог',
  past: 'Прошедшее время', present: 'Настоящее время', future: 'Будущее время',
  neg: 'Отрицательная форма', negative: 'Отрицательная форма',
  'past simple': 'Past Simple', 'present simple': 'Present Simple', 'future simple': 'Future Simple',
  'present perfect': 'Present Perfect', 'past perfect': 'Past Perfect',
  'present continuous': 'Present Continuous', 'past continuous': 'Past Continuous',
  passive: 'Страдательный залог', plural: 'Множественное число', singular: 'Единственное число',
  nominative: 'Именительный падеж',
  accusative: 'Винительный падеж', dative: 'Дательный падеж', genitive: 'Родительный падеж',
  locative: 'Местный падеж', ablative: 'Исходный падеж', instrumental: 'Творительный падеж',
  prepositional: 'Предложный падеж', vocative: 'Звательный падеж',
  conditional: 'Условное наклонение', imperative: 'Повелительное наклонение',
};
const normalize = (label: string) => label.trim().replace(/\s+/g, ' ').toLowerCase();
export function grammarLabel(label: string): { title: string; form: boolean } {
  const key = normalize(label);
  const detail = /\(([^)]+)\)/.exec(label)?.[1]?.trim();
  const form = detail ? normalize(detail) : key;
  return { title: LABELS[form] ?? detail ?? label.trim(),
    form: !!detail || ['participle', 'gerund', 'infinitive'].includes(key) || (!!LABELS[key] && ![
      'adjective', 'subject', 'object', 'particle', 'place', 'time', 'conjunction', 'pronoun',
      'auxiliary', 'verb', 'adverb', 'postposition', 'article', 'noun', 'preposition',
    ].includes(key)) };
}

export function formatTimes(count: number): string {
  const abs = Math.abs(count);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 14) return `${count} раз`;
  if (mod10 === 1) return `${count} раз`;
  if (mod10 >= 2 && mod10 <= 4) return `${count} раза`;
  return `${count} раз`;
}

export function snapshotSentenceAnalysis(sentence: Sentence, id: string, now = Date.now()): SentenceAnalysis {
  const labels = new Map<string, SentenceAnalysis['labels'][number]>();
  for (const token of sentence.words) {
    const key = normalize(token.label);
    if (!key) continue;
    const row = labels.get(key) ?? { label: token.label.trim(), count: 0, examples: [] };
    row.count++;
    if (!row.examples.includes(token.text) && row.examples.length < 3) row.examples.push(token.text);
    labels.set(key, row);
  }
  return { id, language: sentence.language, sentence: sentence.sentence,
    createdAt: new Date(now).toISOString(), labels: [...labels.values()] };
}

export function summarizeSentenceAnalyses(analyses: SentenceAnalysis[], language?: string, now = Date.now()) {
  const selected = analyses.filter(item => !language || item.language === language);
  const rows = new Map<string, { title: string; form: boolean; count: number; sentences: number; examples: string[] }>();
  for (const item of selected) {
    const seen = new Set<string>();
    for (const label of item.labels) {
      const info = grammarLabel(label.label);
      const key = JSON.stringify([info.form, info.title]);
      const row = rows.get(key) ?? { ...info, count: 0, sentences: 0, examples: [] };
      row.count += label.count;
      if (!seen.has(key)) row.sentences++;
      seen.add(key);
      for (const example of label.examples) {
        if (!row.examples.includes(example) && row.examples.length < 3) row.examples.push(example);
      }
      rows.set(key, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, 'ru'));
  return {
    total: selected.length,
    unique: new Set(selected.map(item => JSON.stringify([item.language, item.sentence.trim().toLowerCase()]))).size,
    today: selected.filter(item => localDateKey(new Date(item.createdAt)) === localDateKey(new Date(now))).length,
    forms: sorted.filter(row => row.form), categories: sorted.filter(row => !row.form),
  };
}
