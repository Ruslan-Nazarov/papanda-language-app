import './setup';
import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateGeminiText } from '../src/services/geminiClient';
import { getInstallId } from '../src/services/installId';
import { generateSentenceBatch } from '../src/services/sentenceGeneration';

const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
  else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL;
});
const configure = () => { process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate'; };
const draft = { taskId: 'task-1', sentence: 'The train stopped.' };
const annotation = { ...draft, literalTranslation: 'Поезд остановился.', review: { natural: true, taskFit: true, analysisReliable: true }, words: [
  { text: 'The', role: 'Article', dictionary_form: 'the' }, { text: 'train', role: 'Subject', dictionary_form: 'train' },
  { text: 'stopped', role: 'Predicate', dictionary_form: 'stop' },
].map(word => ({ ...word, label: 'tag', translation: 'перевод', clauseIndex: 0, parts: [word.text] })) };
const reply = (data: unknown) => Response.json({ text: JSON.stringify(data) });
const stageOf = (init?: RequestInit) => JSON.parse(init!.body as string).prompt.split('\n')[0];
const audit = (items: { taskId: string }[]) => items.map(item => ({ taskId: item.taskId,
  natural: true, translation: true, roles: true, morphology: true, chain: true, reason: '' }));

it('concurrent first requests receive one installation id', async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () => getInstallId()));
  assert.equal(new Set(ids).size, 1);
  assert.match(ids[0], /^[a-z0-9-]{8,64}$/i);
});
it('does not retry an unclassified permanent HTTP error', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: 'Bad request' }, { status: 400 }); };
  await assert.rejects(generateGeminiText('test'), /Bad request/);
  assert.equal(calls, 1);
});
it('coalesces the three pipeline stages and releases the batch afterward, even with no dictionary', async () => {
  configure();
  const stages: string[] = [];
  globalThis.fetch = async (_, init) => {
    const body = JSON.parse(init!.body as string);
    const stage = body.prompt.split('\n')[0];
    stages.push(stage);
    assert.ok(body.generationConfig.responseJsonSchema);
    return reply(stage === 'COMPOSE_SENTENCES' ? [draft] : stage === 'REVIEW_AND_ANNOTATE' ? [annotation] : audit([annotation]));
  };
  const first = generateSentenceBatch('en', [], 1);
  const second = generateSentenceBatch('en', [], 1);
  assert.equal(first, second);
  assert.equal((await first).length, 1);
  assert.deepEqual(stages, ['COMPOSE_SENTENCES', 'REVIEW_AND_ANNOTATE', 'AUDIT_SENTENCE_CARDS']);
  await generateSentenceBatch('en', [], 1);
  assert.equal(stages.length, 6);
});
it('rejects a weak review and supplies feedback for one bounded repair round', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    if (calls === 3) assert.match(JSON.parse(init!.body as string).prompt, /не прошла проверку/);
    const stage = stageOf(init);
    if (stage === 'COMPOSE_SENTENCES') return reply([draft]);
    if (stage === 'AUDIT_SENTENCE_CARDS') return reply(audit([annotation]));
    return reply([{ ...annotation, review: { ...annotation.review, natural: calls !== 2 } }]);
  };
  assert.equal((await generateSentenceBatch('en', [], 1)).length, 1);
  assert.equal(calls, 5);
});
it('cannot claim targeted success when the requested word is missing', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => { calls++; return reply(stageOf(init) === 'COMPOSE_SENTENCES' ? [draft] : [annotation]); };
  await assert.rejects(generateSentenceBatch('en', [], 1, { lemma: 'book' }), /отсутствует запрошенное слово/);
  assert.equal(calls, 4);
});
it('honours an inflected requested lexeme and marks it even outside the existing dictionary', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => { calls++; const stage = stageOf(init);
    return reply(stage === 'COMPOSE_SENTENCES' ? [draft] : stage === 'REVIEW_AND_ANNOTATE' ? [annotation] : audit([annotation])); };
  const result = await generateSentenceBatch('en', [], 1, { lemma: 'stop' });
  assert.equal(result[0].words[2].dictionary_word, 'stop');
});
it('malformed drafts cannot start annotation requests or unbounded retries', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return reply({ unexpected: true }); };
  await assert.rejects(generateSentenceBatch('en', [], 1), /Не получены тексты/);
  assert.equal(calls, 2);
});

const chain = [
  [['Mia', 'Subject'], ['reads', 'Predicate']],
  [['Young', 'Attribute_Subject'], ['Mia', 'Subject'], ['reads', 'Predicate']],
  [['Young', 'Attribute_Subject'], ['Mia', 'Subject'], ['reads', 'Predicate'], ['books', 'Object']],
  [['Young', 'Attribute_Subject'], ['Mia', 'Subject'], ['reads', 'Predicate'], ['books', 'Object'], ['outside', 'Circumstance']],
].map((tokens, index) => ({ ...annotation, taskId: `task-${index + 1}`, sentence: tokens.map(([text]) => text).join(' ') + '.',
  words: tokens.map(([text, role]) => ({ text, role, dictionary_form: text.toLowerCase(), label: 'tag', translation: 'перевод', clauseIndex: 0, parts: [text] })) }));

it('restores development order even when both model responses are reversed', async () => {
  configure();
  globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit(chain).reverse() : [...chain].reverse());
  const result = await generateSentenceBatch('en', [], 4);
  assert.deepEqual(result.map(sentence => sentence.sentence), chain.map(item => item.sentence));
});

it('reconsiders the whole chain when an expansion fails and never accepts orphan expansions', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    if (calls === 2) return reply(chain.map((item, index) => index === 1 ? { ...item, review: { ...item.review, natural: false } } : item));
    if (stageOf(init) === 'AUDIT_SENTENCE_CARDS') return reply(audit(chain));
    if (calls >= 4) {
      const prompt = JSON.parse(init!.body as string).prompt;
      assert.match(prompt, /task-1/);
      if (calls === 4) assert.match(prompt, /Пересоставьте всю связанную серию/);
      return reply(chain);
    }
    return reply(chain);
  };
  const result = await generateSentenceBatch('en', [], 4);
  assert.deepEqual(result.map(sentence => sentence.generationTaskId), chain.map(item => item.taskId));
  assert.equal(calls, 6);
});

it('rejects a changed participant despite a positive model review', async () => {
  configure();
  const broken = chain.map((item, index) => index === 0 ? item : { ...item,
    sentence: item.sentence.replace('Mia', 'Tom'), words: item.words.map(word => word.text === 'Mia' ? { ...word, text: 'Tom', dictionary_form: 'tom', parts: ['Tom'] } : word) });
  globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit(broken) : broken);
  const result = await generateSentenceBatch('en', [], 4);
  assert.deepEqual(result.map(sentence => sentence.generationTaskId), ['task-1']);
});

it('retains the validated prefix when repair fails or produces a shorter different scene', async () => {
  configure();
  for (const failure of ['http', 'empty', 'shorter']) {
    let calls = 0;
    globalThis.fetch = async (_, init) => {
      calls++;
      const stage = stageOf(init);
      if (calls <= 3) return reply(stage === 'AUDIT_SENTENCE_CARDS' ? audit(chain.slice(0, 3)) : chain.slice(0, 3));
      if (failure === 'http') return Response.json({ error: 'Unavailable', retryable: false }, { status: 503 });
      if (failure === 'empty') return reply([]);
      const shorter = chain.slice(0, 1).map(item => ({ ...item, sentence: 'Tom reads.',
        words: item.words.map(word => word.text === 'Mia' ? { ...word, text: 'Tom', dictionary_form: 'tom', parts: ['Tom'] } : word) }));
      return reply(stage === 'AUDIT_SENTENCE_CARDS' ? audit(shorter) : shorter);
    };
    const result = await generateSentenceBatch('en', [], 4);
    assert.deepEqual(result.map(sentence => sentence.sentence), chain.slice(0, 3).map(item => item.sentence), failure);
    assert.ok(calls <= 6);
  }
});

it('rejects lost details and tense changes even when the model approves the chain', async () => {
  configure();
  for (const change of ['attribute', 'tense']) {
    const broken = chain.map((item, index) => {
      if (index < 2) return item;
      const words = change === 'attribute'
        ? item.words.filter(word => word.text !== 'Young')
        : item.words.map(word => word.text === 'reads' ? { ...word, text: 'read', parts: ['read'] } : word);
      return { ...item, words, sentence: words.map(word => word.text).join(' ') + '.' };
    });
    globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit(broken) : broken);
    const result = await generateSentenceBatch('en', [], 4);
    assert.deepEqual(result.map(sentence => sentence.generationTaskId), ['task-1', 'task-2'], change);
  }
});

it('rejects a chain whose unchanged verb surface changes meaning in translation', async () => {
  configure();
  const shifted = chain.map((item, index) => index < 2 ? item : { ...item,
    words: item.words.map(word => word.role === 'Predicate' ? { ...word, translation: 'представляет' } : word) });
  globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit(shifted) : shifted);
  const result = await generateSentenceBatch('en', [], 4);
  assert.deepEqual(result.map(sentence => sentence.generationTaskId), ['task-1', 'task-2']);
});

it('does not duplicate a restored chain sentence in an independent repair task', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    const batch = calls <= 3 ? chain.slice(0, 3) : [{ ...chain[0], taskId: 'task-6' }];
    return reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit(batch) : batch);
  };
  const result = await generateSentenceBatch('en', [], 6);
  assert.deepEqual(result.map(sentence => sentence.generationTaskId), ['task-1', 'task-2', 'task-3']);
});

it('passes earlier sentences to composition and rejects repeated text across batches', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    const prompt = JSON.parse(init!.body as string).prompt;
    if (stageOf(init) === 'COMPOSE_SENTENCES') assert.match(prompt, /Avoid exact duplicates: \["The train stopped\."\]/);
    return reply(stageOf(init) === 'COMPOSE_SENTENCES' ? [draft] : [annotation]);
  };
  await assert.rejects(generateSentenceBatch('en', [], 1, undefined, [draft.sentence]), /повтор предложения/);
  assert.equal(calls, 4);
});

it('does not coalesce requests with different sentence histories', async () => {
  configure();
  globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit([annotation]) : [annotation]);
  const first = generateSentenceBatch('en', [], 1, undefined, ['A.']);
  const second = generateSentenceBatch('en', [], 1, undefined, ['B.']);
  assert.notEqual(first, second);
  await Promise.all([first, second]);
});

it('accepts a natural question for a requested question word', async () => {
  configure();
  const question = { ...annotation, sentence: 'Why wait?', words: [
    { ...annotation.words[0], text: 'Why', parts: ['Why'], role: 'Circumstance', dictionary_form: 'why' },
    { ...annotation.words[2], text: 'wait', parts: ['wait'], dictionary_form: 'wait' },
  ] };
  globalThis.fetch = async (_, init) => reply(stageOf(init) === 'AUDIT_SENTENCE_CARDS' ? audit([question]) : [question]);
  assert.equal((await generateSentenceBatch('en', [], 1, { lemma: 'why' }))[0].sentence, 'Why wait?');
  await assert.rejects(generateSentenceBatch('en', [], 1), /вопросительный знак/);
});

it('withholds a fluent-looking card when the independent audit finds a translation defect', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    const stage = stageOf(init);
    if (calls === 4) assert.match(JSON.parse(init!.body as string).prompt, /translation:/);
    if (stage === 'COMPOSE_SENTENCES') return reply([draft]);
    if (stage === 'REVIEW_AND_ANNOTATE') return reply([annotation]);
    return reply([{ ...audit([annotation])[0], translation: calls !== 3, reason: 'Смена значения при переводе.' }]);
  };
  assert.equal((await generateSentenceBatch('en', [], 1)).length, 1);
  assert.equal(calls, 6);
});

it('does not feed random dictionary words into ordinary composition', async () => {
  configure();
  globalThis.fetch = async (_, init) => {
    const stage = stageOf(init);
    const prompt = JSON.parse(init!.body as string).prompt;
    if (stage === 'COMPOSE_SENTENCES') {
      assert.doesNotMatch(prompt, /"lemma":"operation"/);
      assert.match(prompt, /Requested word hint, if any: \[\]/);
    }
    return reply(stage === 'COMPOSE_SENTENCES' ? [draft] : stage === 'REVIEW_AND_ANNOTATE' ? [annotation] : audit([annotation]));
  };
  await generateSentenceBatch('en', [{ eng: 'operation', ru: 'операция', count: 0, is_learned: 0 }], 1);
});

it('does not spend a second full pipeline to fill an optional card after the curriculum chain is complete', async () => {
  configure();
  let calls = 0;
  globalThis.fetch = async (_, init) => {
    calls++;
    const stage = stageOf(init);
    return reply(stage === 'AUDIT_SENTENCE_CARDS' ? audit(chain) : chain);
  };
  const result = await generateSentenceBatch('en', [], 5);
  assert.deepEqual(result.map(sentence => sentence.generationTaskId), ['task-1', 'task-2', 'task-3', 'task-4']);
  assert.equal(calls, 3);
});
