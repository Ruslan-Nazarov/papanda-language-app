import type { WordAiVerification } from '../store/progressTypes';

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
