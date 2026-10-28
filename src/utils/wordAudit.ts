import type { UserWordProgress, WordAiVerification } from '../store/progressTypes';
import type { Word } from '../models/types';
import { getWordKey, getWordTranslation } from './words';

/** Missing translations and one failed AI response must not block the remaining dictionary. */
export function selectWordAuditCandidate(words: Word[], languages: string[], progress: Record<string, UserWordProgress>, now: number, previousKey?: string): Word | undefined {
  const start = words.findIndex(word => getWordKey(word) === previousKey) + 1;
  for (let offset = 0; offset < words.length; offset++) {
    const word = words[(start + offset) % words.length];
    const available = languages.filter(lang => getWordTranslation(word, lang).trim());
    if (!getWordKey(word) || !(word.ru || word.word) || !available.length) continue;
    const verification = progress[getWordKey(word)]?.ai_verification;
    if (!verification || available.some(lang => !verification.checkedLanguages?.includes(lang)) ||
        !Number.isFinite(Date.parse(verification.checkedAt)) || Date.parse(verification.checkedAt) < now - 30 * 86400000) return word;
  }
}

/** AI output is untrusted even when a JSON response mode is requested. */
export function parseWordAudit(value: unknown): WordAiVerification | null {
  if (!value || typeof value !== 'object' || !('isValid' in value) || typeof value.isValid !== 'boolean') return null;
  const issues = 'issues' in value ? value.issues : [];
  if (!Array.isArray(issues)) return null;
  const validated: NonNullable<WordAiVerification['issues']> = [];
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object' || typeof issue.lang !== 'string' || typeof issue.issue !== 'string' ||
      (issue.suggestion !== undefined && typeof issue.suggestion !== 'string')) return null;
    validated.push({ lang: issue.lang, issue: issue.issue, suggestion: issue.suggestion });
  }
  return { status: value.isValid && !validated.length ? 'verified' : 'flagged', issues: validated, checkedAt: new Date().toISOString() };
}
