import { it } from 'node:test';
import assert from 'node:assert/strict';
import { planSentenceBatch, parseSentenceDrafts } from '../src/services/sentenceCurriculum';
import { getAllDictionaryCandidates, getLanguagePrompt } from '../src/services/sentencePrompts';
import { parseProgress } from '../src/store/progressValidation';

it('starts with the sentence basis and develops members in the book order', () => {
  assert.deepEqual(planSentenceBatch(4).map(task => task.focus), ['core', 'attribute', 'object', 'circumstance']);
  const tasks = planSentenceBatch(8);
  assert.equal(tasks.filter(task => !['negative', 'question'].includes(task.focus)).length, 6);
  assert.equal(tasks.filter(task => task.focus === 'complex').length, 1);
  assert.equal(tasks[1].develops, tasks[0].id);
  assert.equal(tasks[2].develops, tasks[1].id);
  assert.equal(tasks[3].develops, tasks[2].id);
  assert.equal(planSentenceBatch(4)[3].develops, 'task-3');
  assert.equal(planSentenceBatch(1)[0].develops, undefined);
});
it('filters foreign or duplicate draft IDs and restores planned order', () => {
  assert.deepEqual(parseSentenceDrafts([{ taskId: 'task-2', sentence: 'B.' }, { taskId: 'bad', sentence: 'X.' },
    { taskId: 'task-1', sentence: 'A.' }, { taskId: 'task-1', sentence: 'Again.' }], planSentenceBatch(2)),
  [{ taskId: 'task-1', sentence: 'A.' }, { taskId: 'task-2', sentence: 'B.' }]);
});
it('allows a requested expression to choose its natural construction without forcing a development chain', () => {
  const tasks = planSentenceBatch(8, true);
  assert.equal(tasks[0].focus, 'usage');
  assert.ok(tasks.every(task => task.develops === undefined));
});
it('keeps short and multiword dictionary entries and supports all seven languages', () => {
  const words = ['a', 'take care of', 'take care of'].map(eng => ({ eng, ru: 'перевод', count: 0, is_learned: 0 }));
  assert.deepEqual(getAllDictionaryCandidates(words, 'en').map(word => word.lemma), ['a', 'take care of']);
  for (const code of ['en', 'kz', 'de', 'es', 'it', 'fr', 'la']) assert.ok(getLanguagePrompt(code).grammar);
});
it('preserves new sentence metadata through backup and rejects malformed known fields', () => {
  const sentence = { id: 'x', language: 'English', sentence: 'Go.', literalTranslation: 'Иди.', learningGoal: 'Найдите сказуемое.', generationTaskId: 'task-1',
    words: [{ text: 'Go', role: 'Predicate', label: 'Verb', translation: 'иди', is_in_my_dict: false, clauseIndex: 0 }] };
  const restored = parseProgress({ userWordProgress: {}, generatedSentences: [sentence] });
  assert.deepEqual(restored.generatedSentences[0], sentence);
  assert.throws(() => parseProgress({ userWordProgress: {}, generatedSentences: [{ ...sentence, literalTranslation: 1 }] }));
  assert.throws(() => parseProgress({ userWordProgress: {}, generatedSentences: [{ ...sentence, words: [{ ...sentence.words[0], clauseIndex: -1 }] }] }));
});
