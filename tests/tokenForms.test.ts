import { it } from 'node:test';
import assert from 'node:assert/strict';
import type { Token } from '../src/models/types';
import { getTokenFormParts, getTokenFormSegments } from '../src/utils/tokenForms';
import { validateGeneratedSentences, tokensMatchSentence } from '../src/utils/sentenceValidation';
import { baseStaticSentences } from '../src/store/catalog';
import { LANGUAGES } from '../src/constants/languages';

const token = (text: string, lemma?: string, parts = [text]): Token => ({
  text, dictionary_form: lemma, parts, role: 'Subject', label: 'Noun', translation: 'пример', is_in_my_dict: false,
});

it('recovers all six Kazakh plural endings, including the screenshot and stale lemmas', () => {
  for (const [text, lemma, expected] of [
    ['Балалар', 'бала', ['Бала', 'лар']], ['үйлер', 'үй', ['үй', 'лер']],
    ['адамдар', 'адам', ['адам', 'дар']], ['киімдер', 'киімдер', ['киім', 'дер']],
    ['кітаптар', 'кітап', ['кітап', 'тар']], ['мектептер', 'мектеп', ['мектеп', 'тер']],
    ['таулар', 'тау', ['тау', 'лар']],
  ] as const) assert.deepEqual(getTokenFormParts(token(text, lemma), 'kz'), expected);
  assert.deepEqual(getTokenFormParts(token('Балалар'), 'kz'), ['Бала', 'лар']);
});

it('reveals separate plural, possessive and case markers even in partially split cached cards', () => {
  assert.deepEqual(getTokenFormParts(token('балаларымызға', 'бала', ['балаларымыз', 'ға']), 'kz'), ['бала', 'лар', 'ымыз', 'ға']);
  assert.deepEqual(getTokenFormParts(token('үйлерімізде', 'үй'), 'kz'), ['үй', 'лер', 'іміз', 'де']);
  assert.deepEqual(getTokenFormParts(token('кітабында', 'кітап'), 'kz'), ['кітаб', 'ы', 'нда']);
  assert.deepEqual(getTokenFormParts(token('паркке', 'парк'), 'kz'), ['парк', 'ке']);
  assert.deepEqual(getTokenFormParts(token('жазбады', 'жазу', ['жаз', 'ба', 'ды']), 'kz'), ['жаз', 'ба', 'ды']);
});

it('recovers transparent inflections in other languages without moving stem letters into an ending', () => {
  for (const [code, text, lemma, parts] of [
    ['en', 'cats', 'cat', ['cat', 's']], ['en', 'boxes', 'box', ['box', 'es']],
    ['en', 'studies', 'study', ['studi', 'es']], ['en', 'reading', 'read', ['read', 'ing']],
    ['en', 'stopped', 'stop', ['stopp', 'ed']], ['en', 'happier', 'happy', ['happi', 'er']],
    ['es', 'libros', 'libro', ['libro', 's']], ['fr', 'livres', 'livre', ['livre', 's']],
    ['it', 'ragazze', 'ragazza', ['ragazz', 'e']], ['de', 'neues', 'neu', ['neu', 'es']],
    ['la', 'librum', 'liber', ['libr', 'um']], ['la', 'dormit.', 'dormire', ['dorm', 'it.']],
  ] as const) assert.deepEqual(getTokenFormParts(token(text, lemma), code), parts);
  assert.deepEqual(getTokenFormParts(token('stopped', 'stop', ['stop', 'ped']), 'en'), ['stopp', 'ed']);
});

it('colors prefixes and endings, leaving the German stem uncolored', () => {
  assert.deepEqual(getTokenFormSegments(token('gekauft', 'kaufen'), 'de'), [
    { text: 'ge', affixIndex: 0 }, { text: 'kauf', affixIndex: null }, { text: 't', affixIndex: 1 },
  ]);
  assert.deepEqual(getTokenFormSegments(token('eingekauft', 'einkaufen', ['ein', 'ge', 'kauf', 't']), 'de')
    .map(part => part.affixIndex), [0, 1, null, 2]);
  assert.deepEqual(getTokenFormSegments(token('«Gekauft!»', 'kaufen'), 'de'), [
    { text: '«Ge', affixIndex: 0 }, { text: 'kauf', affixIndex: null }, { text: 't!»', affixIndex: 1 },
  ]);
});

it('does not invent boundaries for opaque forms or words merely resembling inflections', () => {
  for (const [code, text, lemma] of [
    ['kz', 'олар', 'олар'], ['kz', 'бағдар', 'бағдар'], ['en', 'news', 'news'],
    ['en', 'children', 'child'], ['en', 'went', 'go'], ['it', 'legge', 'leggere'],
    ['fr', 'du', 'de'], ['de', 'Mutter', 'Mutter'],
  ]) assert.deepEqual(getTokenFormParts(token(text, lemma), code), [text]);
  assert.deepEqual(getTokenFormParts(token('Does', 'do', ['Doe', 's']), 'en'), ['Does']);
  assert.deepEqual(getTokenFormParts(token('балықтар', undefined), 'kz'), ['балықтар']);
});

it('preserves exact surface, case, punctuation and caller data when cached parts are stale', () => {
  const original = token('«Балалар!»', 'бала');
  const snapshot = structuredClone(original);
  assert.deepEqual(getTokenFormParts(original, 'kz'), ['«Бала', 'лар!»']);
  assert.deepEqual(original, snapshot);
  assert.deepEqual(getTokenFormParts(token('Reads', 'read', ['read', 's']), 'en'), ['Read', 's']);
  assert.deepEqual(getTokenFormParts(token('word', undefined, ['other']), 'en'), ['word']);
  assert.deepEqual(getTokenFormParts(token('n’a', undefined, ['n’', 'a']), 'fr'), ['n’', 'a']);
});

it('stores recovered plural parts when accepting newly generated cards', () => {
  const words = [token('Балалар', 'бала'), { ...token('барды', 'бару', ['бар', 'ды']), role: 'Predicate' as const }];
  const result = validateGeneratedSentences([{ sentence: 'Балалар барды.', words }], 'kz', 'Қазақша', []);
  assert.equal(result.sentences.length, 1);
  assert.deepEqual(result.sentences[0].words[0].parts, ['Бала', 'лар']);
});

it('all shipped cards retain the source spelling and valid part boundaries', () => {
  for (const sentence of baseStaticSentences) {
    const code = LANGUAGES.find(language => language.label === sentence.language)!.code;
    assert.ok(tokensMatchSentence(sentence.sentence, sentence.words), sentence.id);
    for (const word of sentence.words) {
      assert.equal(word.parts!.join('').toLocaleLowerCase(), word.text.toLocaleLowerCase(), `${sentence.id}: ${word.text}`);
      assert.equal(getTokenFormSegments(word, code).map(part => part.text).join(''), word.text, `${sentence.id}: ${word.text}`);
    }
  }
});
