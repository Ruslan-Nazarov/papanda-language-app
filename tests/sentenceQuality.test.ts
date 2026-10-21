import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSentenceQualityPrompt, parseQualityVerdicts } from '../src/services/sentenceQuality';
import { planSentenceBatch } from '../src/services/sentenceCurriculum';
import type { Sentence } from '../src/models/types';

const good = (taskId: string) => ({ taskId, natural: true, translation: true, roles: true,
  morphology: true, chain: true, reason: '' });

it('fails closed on missing, duplicate and malformed independent quality verdicts', () => {
  const tasks = planSentenceBatch(2);
  assert.deepEqual(parseQualityVerdicts([good('task-1')], tasks).map(item => item.passed), [true, false]);
  assert.equal(parseQualityVerdicts([good('task-1'), good('task-1')], tasks)[0].passed, false);
  assert.equal(parseQualityVerdicts([{ ...good('task-1'), translation: 'yes' }], tasks)[0].passed, false);
  assert.equal(parseQualityVerdicts({}, tasks)[0].passed, false);
});

it('uses concrete quality failures and does not expose the annotator self-review to the auditor', () => {
  const verdict = parseQualityVerdicts([{ ...good('task-1'), roles: false, reason: 'farm is a location' }], planSentenceBatch(1))[0];
  assert.equal(verdict.passed, false);
  assert.match(verdict.reason, /roles: farm is a location/);
  const sentence: Sentence = { id: 's', language: 'English', generationTaskId: 'task-1',
    sentence: 'She reads.', literalTranslation: 'Она читает.', words: [
      { text: 'She', role: 'Subject', label: 'pronoun', translation: 'она', dictionary_form: 'she', parts: ['She'], is_in_my_dict: false },
      { text: 'reads', role: 'Predicate', label: 'verb', translation: 'читает', dictionary_form: 'read', parts: ['read', 's'], is_in_my_dict: false },
    ] };
  const prompt = buildSentenceQualityPrompt('en', planSentenceBatch(1), [sentence], []);
  assert.match(prompt, /She reads\./);
  assert.doesNotMatch(prompt, /analysisReliable|taskFit/);
});
