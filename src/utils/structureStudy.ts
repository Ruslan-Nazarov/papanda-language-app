import type { Sentence, SyntaxRole } from '../models/types';
import type { StructureAttempt } from '../models/study';
import { computeSentenceGroups, TokenGroup } from './sentenceGroups';

const CORE = new Set<SyntaxRole>(['Predicate', 'Subject', 'Attribute', 'Attribute_Subject', 'Object', 'Attribute_Object', 'Circumstance', 'Adverbial']);
export const studyGroups = (sentence: Sentence) => computeSentenceGroups(sentence.words).filter(group => CORE.has(group.role));
export const selectionResult = (selected: number[], expected: number[]) => {
  const chosen = new Set(selected), target = new Set(expected);
  const missing = [...target].filter(i => !chosen.has(i));
  const extra = [...chosen].filter(i => !target.has(i));
  return { correct: !missing.length && !extra.length, missing, extra };
};
export const roleQuestion = (role: SyntaxRole) => {
  if (role === 'Predicate') return 'Что говорится о действии или состоянии? Выберите всё сказуемое, включая его вспомогательные части.';
  if (role === 'Subject') return 'О ком или о чём говорится в этой части предложения? При страдательном залоге подлежащее может испытывать действие.';
  if (role === 'Object') return 'На кого или на что направлено действие? Найдите дополнение.';
  if (role === 'Circumstance' || role === 'Adverbial') return 'Где, когда или как происходит действие? Найдите обстоятельство.';
  return 'Какой признак предмета уточняется? Найдите определение.';
};
export function markerObservation(sentence: Sentence, group: TokenGroup): string {
  const hint = sentence.markerHints?.find(item => item.role === group.role && item.clauseIndex === group.clauseIndex);
  if (hint) return (hint.source === 'ai' ? 'Подсказка ИИ: ' : '') + hint.explanation + '\nОпора в тексте: ' + hint.evidence.map(e => '«' + e.form + '»').join(', ');
  const words = group.tokenIndices.map(i => sentence.words[i]);
  const parts = words.filter(w => (w.parts?.length ?? 0) > 1).map(w => `${w.text}: ${w.parts!.join(' + ')}`);
  return `По разметке карточки: ${words.map(w => '«' + w.text + '»').join(', ')}.` +
    (words.length > 1 ? ' Выделяйте все отмеченные части, даже если между ними стоят другие слова.' : '') +
    (parts.length ? '\nУказанное в карточке деление: ' + parts.join('; ') + '.' : '') +
    '\nДля этой карточки конкретный грамматический маркер ещё не описан. Само место слова не доказывает его роль.';
}
export function structureSummary(attempts: StructureAttempt[], language?: string) {
  const groups = new Map<string, { language: string; role: SyntaxRole; total: number; independent: number; errors: number; assisted: number }>();
  for (const item of attempts) {
    if (item.result === 'disputed' || (language && item.language !== language)) continue;
    const key = item.language + ':' + item.role;
    const group = groups.get(key) ?? { language: item.language, role: item.role, total: 0, independent: 0, errors: 0, assisted: 0 };
    group.total++;
    if (item.result === 'incorrect') group.errors++;
    else if (!item.hintLevel) group.independent++;
    else group.assisted++;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a,b) => (b.errors + b.assisted) / b.total - (a.errors + a.assisted) / a.total);
}
export function recommendStructureCard(sentences: Sentence[], attempts: StructureAttempt[], language: string, excludeId?: string) {
  const weak = structureSummary(attempts, language).filter(row => row.errors || row.assisted);
  const candidates = sentences.filter(s => s.language === language && s.id !== excludeId && studyGroups(s).length);
  return candidates.find(s => weak[0] && s.words.some(w => w.role === weak[0].role)) ?? candidates[0];
}
export function addedTokenIndices(previous: Sentence, next: Sentence): number[] {
  // Match occurrences in order; repeated words must not swallow new occurrences.
  const pending = previous.words.map(w => w.text.replace(/[.!?,;:]+$/u, '').toLocaleLowerCase());
  return next.words.flatMap((word, i) => {
    const index = pending.indexOf(word.text.replace(/[.!?,;:]+$/u, '').toLocaleLowerCase());
    if (index < 0) return [i];
    pending.splice(index, 1); return [];
  });
}
export function validateReadingSegments(value: string): string[] {
  const segments = value.split(/\n+/).map(line => line.trim()).filter(Boolean);
  if (!segments.length) throw new Error('Введите хотя бы одно предложение.');
  if (segments.length > 20 || segments.join('\n').length > 6000) throw new Error('Один текст: до 20 предложений и 6000 символов.');
  if (segments.some(line => line.length > 600)) throw new Error('Одно предложение: до 600 символов. Разделите длинный фрагмент.');
  return segments;
}
export function suggestReadingSegments(text: string): string {
  // This is a proposal only: the learner reviews line boundaries before saving.
  return text.trim().replace(/([.!?…][»”"']*)\s+(?=[\p{Lu}«“"'])/gu, '$1\n');
}
