import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findLemmaSpan, sentenceFingerprint, tokensMatchSentence, validateGeneratedSentences } from '../src/utils/sentenceValidation';
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
  it('marks every occurrence of a dictionary lexeme', () => {
    const words = [tok('Dogs', 'Subject', 'dog'), tok('see', 'Predicate'), tok('dogs', 'Object', 'dog')];
    const result = validateGeneratedSentences([{ sentence: 'Dogs see dogs.', words }], 'en', 'English', [{ lemma: 'dog', translation: 'собака' }]);
    assert.deepEqual(result.sentences[0].words.map(word => word.is_in_my_dict), [true, false, true]);
  });
  it('distinguishes intonation questions from affirmative sentences when deduplicating', () => {
    assert.notEqual(sentenceFingerprint('Français', 'Tu viens.'), sentenceFingerprint('Français', 'Tu viens ?'));
    assert.equal(sentenceFingerprint('Français', 'Tu viens?'), sentenceFingerprint('Français', 'Tu viens ?'));
    assert.equal(sentenceFingerprint('English', 'The train stopped.'), sentenceFingerprint('English', ' the TRAIN stopped! '));
  });
  it('requires surface morphemes to preserve written case too', () => {
    const result = validate([{ ...train, words: train.words.map(word => ({ ...word, parts: [word.text.toUpperCase()] })) }]);
    assert.deepEqual(result.sentences[0].words[1].parts, ['train']);
  });
  it('does not display invented visible stems for irregular English auxiliaries', () => {
    const sentence = { sentence: 'Does the train stop?', words: [tok('Does', 'Predicate', 'do'),
      tok('the', 'Article'), tok('train', 'Subject'), tok('stop', 'Predicate')] };
    sentence.words[0].parts = ['Doe', 's'];
    const result = validate([sentence]);
    assert.deepEqual(result.sentences[0].words[0].parts, ['Does']);
  });
  it('rejects a bare Kazakh object separated from the predicate, including a falsely tagged subject piece', () => {
    const tasks = planSentenceBatch(1);
    const check = (sentence: string, words: Token[]) => validateGeneratedSentences([{
      taskId: 'task-1', sentence, words, literalTranslation: 'Ребёнок читает книгу.',
      review: { natural: true, taskFit: true, analysisReliable: true },
    }], 'kz', 'Қазақша', [], { tasks, drafts: [{ taskId: 'task-1', sentence }] });
    assert.equal(check('Бала кітап мектепте оқиды.', [tok('Бала', 'Subject', 'бала'),
      tok('кітап', 'Object', 'кітап'), tok('мектепте', 'Circumstance', 'мектеп'), tok('оқиды', 'Predicate', 'оқу')]).sentences.length, 0);
    assert.equal(check('Сатып алушы келді.', [tok('Сатып', 'Object', 'сату'),
      tok('алушы', 'Subject', 'алу'), tok('келді', 'Predicate', 'келу')]).sentences.length, 0);
    assert.equal(check('Бала мектепте кітап оқиды.', [tok('Бала', 'Subject', 'бала'),
      tok('мектепте', 'Circumstance', 'мектеп'), tok('кітап', 'Object', 'кітап'), tok('оқиды', 'Predicate', 'оқу')]).sentences.length, 1);
    assert.equal(check('Бала кітапты мектепте оқиды.', [tok('Бала', 'Subject', 'бала'),
      tok('кітапты', 'Object', 'кітап'), tok('мектепте', 'Circumstance', 'мектеп'), tok('оқиды', 'Predicate', 'оқу')]).sentences.length, 1);
  });
  it('normalizes Italian predicate negation and rejects joined Russian question particle', () => {
    const sentence = 'La donna non canta.';
    const result = validateGeneratedSentences([{ taskId: 'task-1', sentence,
      literalTranslation: 'Женщина не поёт.', review: { natural: true, taskFit: true, analysisReliable: true },
      words: [tok('La', 'Article'), tok('donna', 'Subject'), tok('non', 'Particle'), tok('canta', 'Predicate')],
    }], 'it', 'Italiano', [], { tasks: planSentenceBatch(1), drafts: [{ taskId: 'task-1', sentence }] });
    assert.equal(result.sentences[0].words[2].role, 'Predicate');
    const bad = validateGeneratedSentences([{ ...reviewedTrain(), literalTranslation: 'Поезд остановился-ли?' }],
      'en', 'English', [], { tasks: planSentenceBatch(1), drafts: [{ taskId: 'task-1', sentence: train.sentence }] });
    assert.equal(bad.sentences.length, 0);
  });
  it('uses grammatical glosses for English articles and auxiliary verbs', () => {
    const sentence = 'Does the child read a book?';
    const words = [tok('Does', 'Predicate', 'do'), tok('the', 'Article'), tok('child', 'Subject'),
      tok('read', 'Predicate'), tok('a', 'Article'), tok('book', 'Object')];
    words[0].translation = 'делает';
    words[0].label = 'Verb';
    words[3].label = 'Verb';
    words[1].translation = 'этот';
    words[4].translation = 'один';
    const result = validateGeneratedSentences([{ taskId: 'task-1', sentence, words,
      literalTranslation: 'Читает ли ребёнок книгу?', review: { natural: true, taskFit: true, analysisReliable: true },
    }], 'en', 'English', [], { tasks: [{ ...planSentenceBatch(1)[0], focus: 'question' }], drafts: [{ taskId: 'task-1', sentence }] });
    assert.deepEqual(result.sentences[0].words.filter(word => ['Does', 'the', 'a'].includes(word.text))
      .map(word => word.translation), ['вспомогательный глагол', 'определённый артикль', 'неопределённый артикль']);
  });
  it('rejects Kazakh question translation with sentence-final «ли» and isolated negative participle gloss', () => {
    const question = 'Қыз кітап оқыды ма?';
    const questionWords = [tok('Қыз', 'Subject'), tok('кітап', 'Object'), tok('оқыды', 'Predicate', 'оқу'), tok('ма', 'Particle')];
    const questionTask = [{ ...planSentenceBatch(1)[0], focus: 'question' as const }];
    const context = { tasks: questionTask, drafts: [{ taskId: 'task-1', sentence: question }] };
    const card = { taskId: 'task-1', sentence: question, words: questionWords,
      review: { natural: true, taskFit: true, analysisReliable: true } };
    assert.equal(validateGeneratedSentences([{ ...card, literalTranslation: 'Девочка книгу читала ли?' }],
      'kz', 'Қазақша', [], context).sentences.length, 0);
    assert.equal(validateGeneratedSentences([{ ...card, literalTranslation: 'Читала ли девочка книгу?' }],
      'kz', 'Қазақша', [], context).sentences.length, 1);
    const negative = 'Қыз ұйықтаған жоқ.';
    const negativeWords = [tok('Қыз', 'Subject'), { ...tok('ұйықтаған', 'Predicate', 'ұйықтау'), translation: 'спавшая' }, tok('жоқ', 'Predicate')];
    assert.equal(validateGeneratedSentences([{ taskId: 'task-1', sentence: negative, words: negativeWords,
      literalTranslation: 'Девочка не спала.', review: { natural: true, taskFit: true, analysisReliable: true },
    }], 'kz', 'Қазақша', [], { tasks: planSentenceBatch(1), drafts: [{ taskId: 'task-1', sentence: negative }] }).sentences.length, 0);
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
