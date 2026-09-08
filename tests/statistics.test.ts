import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  readWordStats,
  wordMemoryWeight,
  calculateTotalVolume,
  calculateCoverage,
  calculateIMWIndex,
  calculateFullyLearned,
  calculateKnownByLanguage,
  calculateShownToday,
  calculateKnowledgeDistribution,
  calculateFamiliarWordsEfficiency,
  calculateSeenWords
} from '../src/utils/statistics';
import { Word } from '../src/models/types';

describe('Statistics Utilities', () => {
  describe('readWordStats', () => {
    it('returns empty object for undefined or null', () => {
      assert.deepStrictEqual(readWordStats(undefined), {});
    });

    it('parses valid JSON string safely', () => {
      const parsed = readWordStats('{"kz": 12, "en": 5}');
      assert.deepStrictEqual(parsed, { kz: 12, en: 5 });
    });

    it('gracefully tolerates corrupted or non-object JSON without throwing', () => {
      assert.deepStrictEqual(readWordStats('not-a-json'), {});
      assert.deepStrictEqual(readWordStats('[1, 2, 3]'), {});
    });

    it('returns object if already an object', () => {
      const obj = { kz: 20 };
      assert.strictEqual(readWordStats(obj), obj);
    });
  });

  const mockWords: Word[] = [
    {
      id: '1',
      eng: 'cat',
      word: 'мысық',
      ru: 'кошка',
      translations: { kz: 'мысық', en: 'cat' },
      source_language: 'kz',
      count: 10,
      is_learned: 1,
      knowledge_stats: { kz: true, en: true },
      show_stats: { kz: 80, en: 40 },
      personal_association: '',
      is_favorite: false
    },
    {
      id: '2',
      eng: 'dog',
      word: 'ит',
      ru: 'собака',
      translations: { kz: 'ит', en: 'dog' },
      source_language: 'kz',
      count: 5,
      is_learned: 0,
      knowledge_stats: { kz: true, en: false },
      show_stats: { kz: 20, en: 0 },
      personal_association: '',
      is_favorite: false
    },
    {
      id: '3',
      eng: 'bird',
      word: 'құс',
      ru: 'птица',
      translations: { kz: 'құс', en: 'bird' },
      source_language: 'kz',
      count: 0,
      is_learned: 0,
      knowledge_stats: {},
      show_stats: {},
      personal_association: '',
      is_favorite: false
    }
  ];

  it('calculates total volume', () => {
    assert.strictEqual(calculateTotalVolume(mockWords), 3);
    assert.strictEqual(calculateTotalVolume([]), 0);
  });

  it('calculates coverage across active languages', () => {
    const coverage = calculateCoverage(mockWords, ['kz', 'en']);
    // Word 1 has kz=80, en=40; Word 2 has kz=20, en=0; Word 3 has none.
    // kz covered: 2/3 = 66.66%
    // en covered: 1/3 = 33.33%
    assert.strictEqual(Math.round(coverage.byLanguage.kz), 67);
    assert.strictEqual(Math.round(coverage.byLanguage.en), 33);
    assert.strictEqual(Math.round(coverage.overall), 50);
  });

  it('calculates iMW as the mean memory weight of started words', () => {
    // mockWords have no last_shown -> retention = 1, both kz words known.
    // Word 1 kz: min(1, 80/80) * 1 * 1 = 1.0
    // Word 2 kz: min(1, 20/80) * 1 * 1 = 0.25
    // mean = 0.625 -> 62.5%. Word 3 (0 shows) is excluded.
    const imw = calculateIMWIndex(mockWords, ['kz']);
    assert.strictEqual(imw.byLanguage.kz, 62.5);
    assert.strictEqual(imw.overall, 62.5);
  });

  it('wordMemoryWeight: 0 for never-shown, halved for not-known, decays over time', () => {
    const now = new Date('2026-01-31T00:00:00Z').getTime();
    const base: Word = {
      id: 'x', eng: 'x', word: 'x', ru: 'x', translations: { kz: 'x' },
      count: 0, is_learned: 0, knowledge_stats: {}, show_stats: {}, is_favorite: false,
    };

    assert.strictEqual(wordMemoryWeight(base, 'kz', now), 0);

    // 80 shows, known, shown "now" -> full weight
    const mastered: Word = { ...base, show_stats: { kz: 80 }, knowledge_stats: { kz: true }, last_shown: new Date(now).toISOString() };
    assert.ok(wordMemoryWeight(mastered, 'kz', now) > 0.99);

    // same but NOT known -> about half
    const notKnown: Word = { ...mastered, knowledge_stats: { kz: false } };
    const w = wordMemoryWeight(notKnown, 'kz', now);
    assert.ok(w > 0.48 && w < 0.52, `expected ~0.5, got ${w}`);

    // known & drilled but last seen 200 days ago -> decayed well below fresh
    const stale: Word = { ...mastered, last_shown: new Date(now - 200 * 86400000).toISOString() };
    assert.ok(wordMemoryWeight(stale, 'kz', now) < 0.6);

    // shows above 80 do not push exposure past 1
    const over: Word = { ...mastered, show_stats: { kz: 500 } };
    assert.ok(Math.abs(wordMemoryWeight(over, 'kz', now) - wordMemoryWeight(mastered, 'kz', now)) < 0.01);
  });

  it('calculates fully learned words across all active languages', () => {
    // Only Word 1 is learned in both 'kz' and 'en'
    assert.strictEqual(calculateFullyLearned(mockWords, ['kz', 'en']), 1);
    // In 'kz' alone, Word 1 and Word 2 are learned
    assert.strictEqual(calculateFullyLearned(mockWords, ['kz']), 2);
  });

  it('calculates known words per language separately', () => {
    const known = calculateKnownByLanguage(mockWords, ['kz', 'en']);
    assert.strictEqual(known.kz.count, 2);
    assert.strictEqual(Math.round(known.kz.percentage), 67);
    assert.strictEqual(known.en.count, 1);
    assert.strictEqual(Math.round(known.en.percentage), 33);
  });

  it('calculates shown today correctly', () => {
    const today = new Date().toISOString().split('T')[0];
    const dailyShows = {
      [today]: 42,
      '2025-01-01': 10
    };
    assert.strictEqual(calculateShownToday(dailyShows), 42);
    assert.strictEqual(calculateShownToday({}), 0);
  });

  it('calculates knowledge distribution buckets', () => {
    const dist = calculateKnowledgeDistribution(mockWords, ['kz', 'en']);
    // Word 1: kz=80, en=40 -> avg = 60 -> expert (41-80)
    // Word 2: kz=20, en=0 -> avg = 20 / 1 = 20 -> advanced (16-40)
    // Word 3: shows 0 -> new
    assert.strictEqual(dist.new, 1);
    assert.strictEqual(dist.advanced, 1);
    assert.strictEqual(dist.expert, 1);
  });

  it('calculates familiar words efficiency aggregated by day', () => {
    const snapshots = [
      { date: '2026-09-01', total: 10, correct: 8 },
      { date: '2026-09-01', total: 10, correct: 9 }, // same day, should combine to 20 total, 17 correct (85%)
      { date: '2026-09-02', total: 5, correct: 5 }   // 100%
    ];

    const efficiency = calculateFamiliarWordsEfficiency(snapshots);
    assert.strictEqual(efficiency.length, 2);
    assert.strictEqual(efficiency[0].date, '2026-09-01');
    assert.strictEqual(efficiency[0].total, 20);
    assert.strictEqual(efficiency[0].absolute, 17);
    assert.strictEqual(efficiency[0].percentage, 85);

    assert.strictEqual(efficiency[1].date, '2026-09-02');
    assert.strictEqual(efficiency[1].percentage, 100);
  });

  it('calculates seen words count', () => {
    assert.strictEqual(calculateSeenWords(mockWords, ['kz']), 2);
    assert.strictEqual(calculateSeenWords(mockWords, ['en']), 1);
    assert.strictEqual(calculateSeenWords(mockWords, ['kz', 'en']), 2);
    assert.strictEqual(calculateSeenWords(mockWords, ['fr']), 0);
  });
});
