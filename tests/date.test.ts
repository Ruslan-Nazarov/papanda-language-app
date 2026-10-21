import { it } from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey } from '../src/utils/date';
import { wordMemoryWeight } from '../src/utils/statistics';

it('uses local calendar components near midnight', () => {
  assert.equal(localDateKey(new Date(2026, 8, 24, 0, 15)), '2026-09-24');
});
it('malformed timestamps do not poison memory statistics with NaN', () => {
  assert.ok(Number.isFinite(wordMemoryWeight({ count: 1, is_learned: 0, show_stats: { en: 5 }, last_shown: 'invalid' }, 'en')));
});
