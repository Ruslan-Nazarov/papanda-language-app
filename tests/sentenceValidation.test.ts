import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateGeneratedSentences } from '../src/utils/sentenceValidation';
import { DictionaryCandidate } from '../src/services/sentencePrompts';

describe('Sentence Validation Logic', () => {
  const mockDictionary: DictionaryCandidate[] = [
    { lemma: 'бала', translation: 'ребенок' },
    { lemma: 'кітап', translation: 'книга' },
    { lemma: 'оқу', translation: 'читать/учиться' },
    { lemma: 'мектеп', translation: 'школа' }
  ];

  it('rejects non-array payloads with error message', () => {
    const result = validateGeneratedSentences(null, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.sentences.length, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0], /массива/i);

    const stringResult = validateGeneratedSentences('{"invalid": true}', 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(stringResult.sentences.length, 0);
  });

  it('rejects candidate if missing sentence or tokens', () => {
    const invalidCandidates = [
      { sentence: '', words: [] },
      { sentence: 'Адам кітап оқиды.', words: [] }
    ];

    const result = validateGeneratedSentences(invalidCandidates, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.sentences.length, 0);
    assert.strictEqual(result.errors.length, 2);
  });

  it('rejects sentences missing a Predicate', () => {
    const candidateWithoutPredicate = [
      {
        sentence: 'Бала мен кітап мектепте.',
        words: [
          { text: 'Бала', label: 'Noun', role: 'Subject', translation: 'ребенок' },
          { text: 'мен', label: 'Conjunction', role: 'Conjunction', translation: 'и' },
          { text: 'кітап', label: 'Noun', role: 'Subject', translation: 'книга' },
          { text: 'мектепте', label: 'Noun', role: 'Circumstance', translation: 'в школе' }
        ]
      }
    ];

    const result = validateGeneratedSentences(candidateWithoutPredicate, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.sentences.length, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0], /нет сказуемого/i);
  });

  it('rejects sentences shorter than 4 tokens', () => {
    const shortCandidate = [
      {
        sentence: 'Бала кітап оқиды.',
        words: [
          { text: 'Бала', label: 'Noun', role: 'Subject', translation: 'ребенок' },
          { text: 'кітап', label: 'Noun', role: 'Object', translation: 'книгу' },
          { text: 'оқиды', label: 'Verb', role: 'Predicate', translation: 'читает' }
        ]
      }
    ];

    const result = validateGeneratedSentences(shortCandidate, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.sentences.length, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0], /слишком короткое/i);
  });

  it('rejects sentences with fewer than 2 dictionary words', () => {
    const lowDictionaryCandidate = [
      {
        sentence: 'Бала бүгін ерте келді.',
        words: [
          { text: 'Бала', label: 'Noun', role: 'Subject', translation: 'ребенок' },
          { text: 'бүгін', label: 'Adverb', role: 'Adverbial', translation: 'сегодня' },
          { text: 'ерте', label: 'Adverb', role: 'Adverbial', translation: 'рано' },
          { text: 'келді', label: 'Verb', role: 'Predicate', translation: 'пришел' }
        ]
      }
    ];

    const result = validateGeneratedSentences(lowDictionaryCandidate, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.sentences.length, 0);
    assert.strictEqual(result.errors.length, 1);
    assert.match(result.errors[0], /менее двух слов из словаря/i);
  });

  it('validates a correct sentence, normalizes roles, and strips edge punctuation', () => {
    const validCandidate = [
      {
        sentence: '«Бала» мектепте жаңа кітапты қызығып оқиды.',
        words: [
          {
            text: '«Бала»',
            label: 'Бала',
            role: 'Noun', // Should be aliased to 'Subject'
            parts: ['Бала'],
            translation: 'ребенок',
            dictionary_form: 'бала'
          },
          {
            text: 'мектепте,',
            label: 'Мектеп',
            role: 'Circumstance',
            parts: ['мектеп', 'те'],
            translation: 'в школе',
            dictionary_form: 'мектеп'
          },
          {
            text: 'жаңа',
            label: 'Жаңа',
            role: 'Attribute',
            parts: ['жаңа'],
            translation: 'новую'
          },
          {
            text: 'кітапты',
            label: 'Кітап',
            role: 'Object',
            parts: ['кітап', 'ты'],
            translation: 'книгу',
            dictionary_form: 'кітап'
          },
          {
            text: 'қызығып',
            label: 'Қызығу',
            role: 'Adverbial',
            parts: ['қызығ', 'ып'],
            translation: 'с интересом'
          },
          {
            text: 'оқиды.',
            label: 'Оқу',
            role: 'Verb', // Should be aliased to 'Predicate'
            parts: ['оқ', 'иды'],
            translation: 'читает',
            dictionary_form: 'оқу'
          }
        ]
      }
    ];

    const result = validateGeneratedSentences(validCandidate, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.sentences.length, 1);

    const sentence = result.sentences[0];
    assert.strictEqual(sentence.language, 'Казахский');
    assert.strictEqual(sentence.words.length, 6);

    // Verify token 0 edge punctuation stripping and role alias
    assert.strictEqual(sentence.words[0].text, 'Бала');
    assert.strictEqual(sentence.words[0].role, 'Subject');
    assert.strictEqual(sentence.words[0].is_in_my_dict, true);
    assert.strictEqual(sentence.words[0].dictionary_word, 'бала');

    // Verify token 1 edge comma stripping
    assert.strictEqual(sentence.words[1].text, 'мектепте');
    assert.strictEqual(sentence.words[1].is_in_my_dict, true);

    // Verify predicate token role alias and period stripping
    const predicateToken = sentence.words[5];
    assert.strictEqual(predicateToken.text, 'оқиды');
    assert.strictEqual(predicateToken.role, 'Predicate');
    assert.strictEqual(predicateToken.is_in_my_dict, true);
    assert.strictEqual(predicateToken.dictionary_word, 'оқу');
  });

  it('preserves inner hyphens for compound words while stripping edge punctuation', () => {
    const candidate = [
      {
        sentence: 'Ата-ана балаға кітапты сыйлап берді.',
        words: [
          { text: 'Ата-ана', label: 'Noun', role: 'Subject', translation: 'родители' },
          { text: 'балаға', label: 'Noun', role: 'Object', translation: 'ребенку', dictionary_form: 'бала' },
          { text: 'кітапты', label: 'Noun', role: 'Object', translation: 'книгу', dictionary_form: 'кітап' },
          { text: 'сыйлап', label: 'Adverbial', role: 'Adverbial', translation: 'подарив' },
          { text: 'берді.', label: 'Verb', role: 'Predicate', translation: 'дали' }
        ]
      }
    ];

    const result = validateGeneratedSentences(candidate, 'kz', 'Казахский', mockDictionary);
    assert.strictEqual(result.errors.length, 0);
    assert.strictEqual(result.sentences.length, 1);
    assert.strictEqual(result.sentences[0].words[0].text, 'Ата-ана');
    assert.strictEqual(result.sentences[0].words[4].text, 'берді');
  });
});
