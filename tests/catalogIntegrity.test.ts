import { it } from 'node:test';
import assert from 'node:assert/strict';
import { baseStaticWords, baseStaticSentences } from '../src/store/catalog';
import { createDefaultProgress } from '../src/store/progressTypes';
import { parseProgress } from '../src/store/progressValidation';
import { getWordKey } from '../src/utils/words';
import { LANGUAGES } from '../src/constants/languages';

it('ships unique word persistence keys and string translations', () => {
  const keys = baseStaticWords.map(getWordKey);
  assert.ok(keys.length > 0);
  assert.ok(keys.every(key => key.trim().length > 0));
  assert.equal(new Set(keys).size, keys.length);
  for (const word of baseStaticWords) {
    assert.ok(Object.values(word.translations ?? {}).every(value => typeof value === 'string'));
  }
});

it('ships unique sentence IDs and complete cards in supported languages', () => {
  for (const language of LANGUAGES) assert.ok(baseStaticSentences.some(card => card.language === language.label), language.label);
  const ids = baseStaticSentences.map(sentence => sentence.id);
  assert.ok(ids.length > 0);
  assert.ok(ids.every(id => id.trim().length > 0));
  assert.equal(new Set(ids).size, ids.length);
  for (const sentence of baseStaticSentences) {
    assert.ok(LANGUAGES.some(language => language.label === sentence.language));
    assert.ok(sentence.sentence.trim() && sentence.words.length > 0);
    assert.ok(sentence.words.every(token => token.text.trim().length > 0));
  }
});

it('keeps seed cards compatible with backups when copied into the manual collection', () => {
  const progress = parseProgress({ ...createDefaultProgress(),
    customSentences: baseStaticSentences });
  assert.deepEqual(progress.customSentences, baseStaticSentences);
});
