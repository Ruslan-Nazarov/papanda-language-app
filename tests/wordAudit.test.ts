import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordAudit, selectWordAuditCandidate } from '../src/utils/wordAudit';
import type { Word } from '../src/models/types';

it('rejects structurally invalid AI verdicts before they reach the dictionary screen', () => {
  for (const value of [null, {}, { isValid: 'true' }, { isValid: true, issues: [null] }, { isValid: false, issues: [{ lang: 42, issue: 'bad' }] }]) {
    assert.equal(parseWordAudit(value), null);
  }
  assert.equal(parseWordAudit({ isValid: true, issues: [] })?.status, 'verified');
  assert.equal(parseWordAudit({ isValid: true, issues: [{ lang: 'it', issue: 'ошибка' }] })?.status, 'flagged');
  const ruFlagged = parseWordAudit({ isValid: false, issues: [{ lang: 'ru', issue: 'опечатка в слове', suggestion: 'определение' }] });
  assert.equal(ruFlagged?.status, 'flagged');
  assert.equal(ruFlagged?.issues?.[0]?.lang, 'ru');
  assert.equal(ruFlagged?.issues?.[0]?.suggestion, 'определение');
});

it('audits available translations, rotates past failed words and rechecks newly selected languages', () => {
  const words: Word[] = ['missing', 'first', 'second'].map((eng, i) => ({ eng, ru: 'пример', count: 0, is_learned: 0,
    translations: { it: i ? 'esempio' : '', de: i ? 'Beispiel' : '' } }));
  const now = Date.now();
  assert.equal(selectWordAuditCandidate(words, ['it'], {}, now)?.eng, 'first');
  assert.equal(selectWordAuditCandidate(words, ['it'], {}, now, 'first')?.eng, 'second');
  const progress = Object.fromEntries(words.map(word => [word.eng!, { ai_verification: {
    status: 'verified' as const, checkedAt: new Date(now).toISOString(), checkedLanguages: ['it'],
  } }]));
  assert.equal(selectWordAuditCandidate(words, ['it'], progress, now), undefined);
  assert.equal(selectWordAuditCandidate(words, ['it', 'de'], progress, now)?.eng, 'first');
});
