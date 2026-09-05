import './setup';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStore } from '../src/store/useStore';
import { Token, Sentence } from '../src/models/types';
import { getWordTranslation } from '../src/utils/words';

describe('Zustand useStore', () => {
  beforeEach(() => {
    useStore.getState().initializeStore();
  });

  describe('addWordFromSentenceToken', () => {
    it('uses dictionary_form lemma rather than parts[0] morpheme', () => {
      const token: Token = {
        text: 'зерттеді',
        label: 'Verb',
        role: 'Predicate',
        parts: ['зертте', 'ді'],
        translation: 'исследовал',
        is_in_my_dict: false,
        dictionary_form: 'зерттеусынағы',
        dictionary_word: 'зерттеусынағы'
      };

      const added = useStore.getState().addWordFromSentenceToken(token, 'kz');
      assert.strictEqual(added, true);

      const state = useStore.getState();
      const addedWord = state.words.find(w => w.word === 'зерттеусынағы');
      assert.ok(addedWord, 'Word with canonical dictionary form «зерттеусынағы» should be present in store');
      assert.strictEqual(addedWord.word, 'зерттеусынағы');
      assert.strictEqual(addedWord.ru, 'исследовал');
      assert.strictEqual(getWordTranslation(addedWord, 'kz'), 'зерттеусынағы');

      // Ensure root morpheme was NOT added as the dictionary word
      const badMorpheme = state.words.find(w => w.word === 'зертте');
      assert.strictEqual(badMorpheme, undefined, 'Morpheme «зертте» must not be added to dictionary');
    });

    it('strips punctuation when falling back to token text', () => {
      const token: Token = {
        text: '«ғарышкерсынақ»!',
        label: 'Noun',
        role: 'Object',
        translation: 'космонавт',
        is_in_my_dict: false
      };

      const added = useStore.getState().addWordFromSentenceToken(token, 'kz');
      assert.strictEqual(added, true);

      const state = useStore.getState();
      const addedWord = state.words.find(w => w.word === 'ғарышкерсынақ');
      assert.ok(addedWord, 'Punctuation should be stripped from word');
      assert.strictEqual(addedWord.word, 'ғарышкерсынақ');
    });

    it('does not duplicate existing word in dictionary', () => {
      const token: Token = {
        text: 'бірегейсөз',
        label: 'Noun',
        role: 'Subject',
        translation: 'уникальное слово',
        is_in_my_dict: false,
        dictionary_form: 'бірегейсөз'
      };

      const firstAdd = useStore.getState().addWordFromSentenceToken(token, 'kz');
      assert.strictEqual(firstAdd, true);

      const secondAdd = useStore.getState().addWordFromSentenceToken(token, 'kz');
      assert.strictEqual(secondAdd, false, 'Adding duplicate word should return false');
    });
  });

  describe('updateWordDetails', () => {
    it('updates translations atomically in words and userWordProgress', () => {
      const state = useStore.getState();
      const targetWord = state.words[0];
      const wordKey = targetWord.eng || targetWord.word || '';

      useStore.getState().updateWordDetails(wordKey, {
        ru: 'Тестовый перевод',
        translations: {
          it: 'nuova_parola',
          de: 'neues_wort'
        },
        personal_association: 'Якорь памяти'
      });

      const updatedState = useStore.getState();
      const updatedWord = updatedState.words.find(w => (w.eng || w.word) === wordKey);
      assert.ok(updatedWord);
      assert.strictEqual(updatedWord.ru, 'Тестовый перевод');
      assert.strictEqual(getWordTranslation(updatedWord, 'it'), 'nuova_parola');
      assert.strictEqual(getWordTranslation(updatedWord, 'de'), 'neues_wort');
      assert.strictEqual(updatedWord.personal_association, 'Якорь памяти');

      const progress = updatedState.userWordProgress[wordKey];
      assert.ok(progress);
      assert.strictEqual(progress.custom_ru, 'Тестовый перевод');
      assert.strictEqual(progress.custom_translations?.it, 'nuova_parola');
      assert.strictEqual(progress.personal_association, 'Якорь памяти');
    });
  });

  describe('setWordAiVerification', () => {
    it('sets and updates AI verification status and issues', () => {
      const wordKey = 'test_word_key';
      useStore.getState().setWordAiVerification(wordKey, {
        status: 'flagged',
        issues: [
          { lang: 'kz', issue: 'неверный падеж', suggestion: 'дос' }
        ],
        checkedAt: '2026-09-05T10:00:00.000Z'
      });

      const state = useStore.getState();
      const progress = state.userWordProgress[wordKey];
      assert.ok(progress?.ai_verification);
      assert.strictEqual(progress.ai_verification.status, 'flagged');
      assert.strictEqual(progress.ai_verification.issues?.length, 1);
      assert.strictEqual(progress.ai_verification.issues?.[0].suggestion, 'дос');

      // Update to verified
      useStore.getState().setWordAiVerification(wordKey, {
        status: 'verified',
        checkedAt: '2026-09-05T10:05:00.000Z'
      });

      const updatedProgress = useStore.getState().userWordProgress[wordKey];
      assert.strictEqual(updatedProgress?.ai_verification?.status, 'verified');
    });
  });

  describe('toggleWordFavorite', () => {
    it('toggles is_favorite flag for word', () => {
      const state = useStore.getState();
      const word = state.words[0];
      const wordKey = word.eng || word.word || '';
      const initialFav = word.is_favorite || false;

      useStore.getState().toggleWordFavorite(wordKey);
      let updatedWord = useStore.getState().words.find(w => (w.eng || w.word) === wordKey);
      assert.strictEqual(updatedWord?.is_favorite, !initialFav);

      useStore.getState().toggleWordFavorite(wordKey);
      updatedWord = useStore.getState().words.find(w => (w.eng || w.word) === wordKey);
      assert.strictEqual(updatedWord?.is_favorite, initialFav);
    });
  });

  describe('generatedSentences', () => {
    it('adds and clears generated sentences by language', () => {
      const sentence: Sentence = {
        id: 'gen_test_1',
        language: 'Italiano',
        sentence: 'Il gatto dorme.',
        source: 'generated',
        words: []
      };

      useStore.getState().addGeneratedSentences([sentence]);
      let state = useStore.getState();
      assert.ok(state.generatedSentences.some(s => s.id === 'gen_test_1'));

      useStore.getState().clearGeneratedSentences('Italiano');
      state = useStore.getState();
      assert.strictEqual(state.generatedSentences.some(s => s.id === 'gen_test_1'), false);
    });
  });
});
