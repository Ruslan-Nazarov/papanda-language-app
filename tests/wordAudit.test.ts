import { it } from 'node:test';
import assert from 'node:assert/strict';
import { parseWordAudit } from '../src/utils/wordAudit';

it('rejects structurally invalid AI verdicts before they reach the dictionary screen', () => {
  for (const value of [null, {}, { isValid: 'true' }, { isValid: true, issues: [null] }, { isValid: false, issues: [{ lang: 42, issue: 'bad' }] }]) {
    assert.equal(parseWordAudit(value), null);
  }
  assert.equal(parseWordAudit({ isValid: true, issues: [] })?.status, 'verified');
  assert.equal(parseWordAudit({ isValid: true, issues: [{ lang: 'it', issue: 'ошибка' }] })?.status, 'flagged');
});
