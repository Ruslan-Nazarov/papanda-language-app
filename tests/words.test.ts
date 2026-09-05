import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getWordTranslation } from '../src/utils/words';
import { Word } from '../src/models/types';

describe('getWordTranslation', () => {
  it('prioritizes nested translations over legacy direct fields', () => {
    const word: Word = {
      id: '1',
      word: 'cane',
      ru: 'собака',
      it: 'vecchio_cane',
      translations: {
        it: 'cane_aggiornato',
        de: 'Hund'
      },
      count: 0,
      is_learned: 0
    };

    assert.strictEqual(getWordTranslation(word, 'it'), 'cane_aggiornato');
    assert.strictEqual(getWordTranslation(word, 'de'), 'Hund');
  });

  it('falls back to direct field if translations is empty or missing key', () => {
    const word: Word = {
      id: '2',
      word: 'Haus',
      ru: 'дом',
      de: 'Haus_direkt',
      translations: {},
      count: 0,
      is_learned: 0
    };

    assert.strictEqual(getWordTranslation(word, 'de'), 'Haus_direkt');
  });

  it('returns word.ru when langCode is ru', () => {
    const word: Word = {
      id: '3',
      word: 'gatto',
      ru: 'кот',
      translations: {
        it: 'gatto'
      },
      count: 0,
      is_learned: 0
    };

    assert.strictEqual(getWordTranslation(word, 'ru'), 'кот');
  });

  it('returns empty string if translation is not found', () => {
    const word: Word = {
      id: '4',
      word: 'albero',
      ru: 'дерево',
      translations: {},
      count: 0,
      is_learned: 0
    };

    assert.strictEqual(getWordTranslation(word, 'kz'), '');
  });
});
