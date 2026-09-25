import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findLemmaSpan, tokensMatchSentence, validateGeneratedSentences } from '../src/utils/sentenceValidation';
import { planSentenceBatch } from '../src/services/sentenceCurriculum';
import { Token } from '../src/models/types';

const tok = (text: string, role: Token['role'], lemma = text): Token => ({ text, role, label: 'Noun',
  dictionary_form: lemma, translation: 'перевод', parts: [text], is_in_my_dict: false, clauseIndex: 0 });
const train = { sentence: 'The train stopped.', words: [tok('The', 'Article'), tok('train', 'Subject'), tok('stopped', 'Predicate', 'stop')] };
const validate = (value: unknown) => validateGeneratedSentences(value, 'en', 'English', []);

export const reviewedTrain = () => ({ ...train, taskId: 'task-1', literalTranslation: 'Поезд остановился.',
  review: { natural: true, taskFit: true, analysisReliable: true }, words: train.words.map(word => ({ ...word })) });

// Fixtures cover actual failures observed in the old engine, not model fluency.
 describe('generated sentence contract', () => {
  it('rejects malformed payloads and incomplete annotations', () => {
    for (const value of [null, {}, [{ sentence: '', words: [] }], [{ ...train, words: [null] }]]) assert.equal(validate(value).sentences.length, 0);
  });
  it('accepts a short complete sentence without dictionary prerequisites', () => {
    assert.equal(validate([train]).sentences.length, 1);
    assert.equal(validate([{ sentence: 'Келді.', words: [tok('Келді', 'Predicate', 'келу')] }]).sentences.length, 1);
    assert.equal(validate([{ sentence: 'Ол — дәрігер.', words: [tok('Ол', 'Subject'), tok('дәрігер', 'Predicate')] }]).sentences.length, 1);
  });
  it('rejects text/token mismatches, dropped words, merged words and false boundaries', () => {
    for (const sentence of ['The train drinks.', 'The train stopped yesterday.', 'Thetrain stopped.', 'The train stop ped.']) {
      assert.equal(validate([{ ...train, sentence }]).sentences.length, 0, sentence);
    }
    assert.equal(tokensMatchSentence('a part', [{ text: 'apart' }]), false);
    assert.equal(tokensMatchSentence('apart', [{ text: 'a' }, { text: 'part' }]), false);
  });
  it('handles apostrophe clitics, hyphens and Spanish punctuation without rewriting letters', () => {
    assert.equal(tokensMatchSentence('La fille n’a pas acheté le livre.', ['La', 'fille', 'n’', 'a', 'pas', 'acheté', 'le', 'livre'].map(text => ({ text }))), true);
    assert.equal(tokensMatchSentence('¿Llegó?', [{ text: 'Llegó' }]), true);
    assert.equal(tokensMatchSentence('Ата-ана келді.', [{ text: 'Ата-ана' }, { text: 'келді' }]), true);
    assert.equal(tokensMatchSentence('Ата-ана келді.', [{ text: 'Ата' }, { text: 'ана' }, { text: 'келді' }]), false);
  });
  it('never guesses syntactic role from part of speech', () => {
    assert.equal(validate([{ ...train, words: train.words.map(word => ({ ...word, role: 'Noun' })) }]).sentences.length, 0);
    assert.equal(validate([{ ...train, words: train.words.map(word => ({ ...word, role: 'Subject' })) }]).sentences.length, 0);
  });
  it('does not confuse a lemma with surface morphemes', () => {
    const result = validate([{ sentence: 'She is happier.', words: [tok('She', 'Subject'), tok('is', 'Predicate'),
      { ...tok('happier', 'Predicate', 'happy'), parts: ['happy', 'er'] }] }]);
    assert.deepEqual(result.sentences[0].words[2].parts, ['happier']);
    assert.equal(result.sentences[0].words[2].dictionary_form, 'happy');
  });
  it('ignores forged dictionary references and recognises inflected expressions', () => {
    const words = [tok('He', 'Subject'), tok('took', 'Predicate', 'take'), tok('care', 'Object'), tok('of', 'Preposition'), tok('her', 'Object')];
    const result = validateGeneratedSentences([{ sentence: 'He took care of her.', words }], 'en', 'English', [{ lemma: 'take care of', translation: 'заботиться' }]);
    assert.deepEqual(result.sentences[0].words.slice(1, 4).map(word => word.dictionary_word), ['take care of', 'take care of', 'take care of']);
    assert.deepEqual(findLemmaSpan(words, 'take care of'), [1, 2, 3]);
    const forged = validateGeneratedSentences([{ ...train, words: train.words.map(word => ({ ...word, dictionary_word: 'cat', is_in_my_dict: true })) }], 'en', 'English', [{ lemma: 'cat', translation: 'кот' }]);
    assert.ok(forged.sentences[0].words.every(word => !word.is_in_my_dict));
  });
  it('rejects missing predicates in clauses and incomplete/gapped clause IDs', () => {
    for (const clauseIndex of [1, -1, 0.5, undefined]) {
      assert.equal(validate([{ ...train, words: train.words.map((word, i) => i === 1 ? { ...word, clauseIndex } : word) }]).sentences.length, 0);
    }
  });
  it('requires independent review, unchanged draft, literal translation and requested lemma', () => {
    const context = { tasks: planSentenceBatch(1), drafts: [{ taskId: 'task-1', sentence: train.sentence }], requiredWord: 'stop' };
    const check = (data: unknown) => validateGeneratedSentences([data], 'en', 'English', [], context);
    assert.equal(check(reviewedTrain()).sentences.length, 1);
    for (const change of [{ review: { natural: false, taskFit: true, analysisReliable: true } }, { taskId: 'unknown' },
      { literalTranslation: '' }, { sentence: 'The train stopped!' }, { words: train.words.map(word => ({ ...word, dictionary_form: 'wrong' })) }]) {
      assert.equal(check({ ...reviewedTrain(), ...change }).sentences.length, 0);
    }
  });
});
