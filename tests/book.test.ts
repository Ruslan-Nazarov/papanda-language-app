import './setup';
import { it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { bookChapters, bookLanguages, bookLanguageCode, chaptersForLanguage, bookTopics, searchBook, bookSnippet,
  getBookChapter, isBookLocation, bookURL, parseBookURL, selectBookPassages, bookContextPrompt, stripUnsupportedBookLinks } from '../src/services/bookService';
import { buildSentenceAnnotationPrompt } from '../src/services/sentencePrompts';
import { explainSentenceWithAI } from '../src/services/aiService';
import type { Token } from '../src/models/types';

const tokens: Token[] = [
  { text: 'She', label: 'местоимение', role: 'Subject', translation: 'она', is_in_my_dict: false },
  { text: 'did', label: 'вспомогательный глагол', role: 'Predicate', translation: 'прошедшее время', is_in_my_dict: false },
  { text: 'not', label: 'частица', role: 'Predicate', translation: 'не', is_in_my_dict: false },
  { text: 'come', label: 'глагол', role: 'Predicate', translation: 'пришла', is_in_my_dict: false },
];
it('book freshness checking accepts Windows checkouts but rejects changed content', () => {
  const script = path.resolve('scripts/build-book.cjs');
  const source = fs.readFileSync(script, 'utf8');
  const requireFromScript = createRequire(script);
  const run = (corrupt: boolean) => vm.runInNewContext(source, {
    __dirname: path.dirname(script), Buffer, console: { log() {} }, process: { argv: ['node', script, '--check'] },
    require: (name: string) => name === 'node:fs' ? { ...fs, readFileSync: (file: string, encoding: BufferEncoding) => {
      const text = fs.readFileSync(file, encoding);
      return file.endsWith('book.generated.json') ? text.replace(/\r?\n/g, '\r\n') + (corrupt ? 'changed' : '') : text;
    } } : requireFromScript(name),
  });
  assert.doesNotThrow(() => run(false));
  assert.throws(() => run(true), /Book data is stale/);
});
it('includes all 66 source documents, all seven languages, the scheme and introduction without changing source files', () => {
  assert.equal(bookChapters.length, 66);
  assert.equal(new Set(bookChapters.map(c => c.id)).size, 66);
  for (const language of ['en', 'de', 'it', 'fr', 'es', 'kz', 'scheme']) assert.equal(chaptersForLanguage(language).length, 8);
  assert.equal(chaptersForLanguage('ru').length, 9);
  for (const chapter of bookChapters) {
    const source = fs.readFileSync(path.join(process.cwd(), chapter.sourcePath), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), chapter.sourceHash);
    assert.ok(chapter.blocks.length > 0);
    assert.equal(new Set(chapter.blocks.map(b => b.id)).size, chapter.blocks.length);
    for (const block of chapter.blocks) {
      assert.ok(block.text.trim(), block.id);
      assert.ok(isBookLocation({ chapterId: chapter.id, blockId: block.id }));
      assert.doesNotMatch(block.text, /<\/?(?:table|td|tr|th|colgroup|col|p|span|strong)\b/i);
      if (block.kind === 'table') for (const row of block.rows) for (const cell of row) {
        assert.ok(cell.colSpan >= 1 && cell.rowSpan >= 1);
        assert.doesNotMatch(cell.markdown, /<\/?[a-z][^>]*>/i);
      }
    }
  }
  const htmlSourceTables = bookChapters.reduce((n, c) => n + (fs.readFileSync(c.sourcePath, 'utf8').match(/<table\b/gi) || []).length, 0);
  const generatedTables = bookChapters.flatMap(c => c.blocks).filter(b => b.kind === 'table');
  assert.ok(generatedTables.length >= htmlSourceTables);
  assert.ok(generatedTables.some(b => b.rows.some(row => row.some(c => c.colSpan > 1))));
  assert.ok(getBookChapter('method-0')!.blocks.filter(b => b.kind === 'heading').length > 5);
  assert.ok(bookChapters.every(c => c.blocks.every(b => !b.text.includes('окончаниеслабая') && !b.text.includes('родапишется') && !b.text.includes('наоснове'))));
});
it('resolves application language labels and uses an explicitly identified fallback for Latin', () => {
  for (const [label, code] of [['English','en'], ['Deutsch','de'], ['Italiano','it'], ['Français','fr'], ['Español','es'], ['Қазақша','kz'], ['Русский','ru']]) {
    assert.equal(bookLanguageCode(label), code);
    assert.ok(chaptersForLanguage(label).every(c => c.language === code));
    assert.equal(bookTopics(label, 'Predicate')[0].number, 2);
  }
  assert.ok(chaptersForLanguage('Latin').every(c => c.language === 'scheme'));
  assert.match(bookContextPrompt('la', 'Puer legit.'), /отдельной главы нет/);
  assert.equal(bookLanguages.length, 9);
});
it('searches source paragraphs and table cells with valid exact destinations and snippets around the match', () => {
  const results = searchBook('did', 'en');
  assert.ok(results.length > 0);
  assert.ok(results.every(r => r.chapterId.startsWith('en-') && isBookLocation(r)));
  assert.ok(results.some(r => r.text.includes('начальная форма')));
  assert.ok(searchBook('кітап', 'kz').length > 0);
  assert.equal(searchBook('d').length, 0);
  assert.ok(bookSnippet('a'.repeat(400) + 'TARGET' + 'b'.repeat(400), 'target').includes('TARGET'));
  assert.equal(searchBook('неттакогословаужточно').length, 0);
});
it('selects actual passages only in the requested language within a bounded prompt, including the applicable negative rule', () => {
  for (const code of ['en','de','it','fr','es','ru','kz','la']) {
    const passages = selectBookPassages(code, 'She did not come.', tokens);
    assert.ok(code === 'la' ? passages.length === 1 : passages.length > 1);
    assert.ok(passages.reduce((n, p) => n + p.text.length, 0) <= 11000);
    assert.ok(passages.every(p => isBookLocation(p)));
    assert.ok(passages.every(p => p.chapterId.startsWith((code === 'la' ? 'scheme' : code) + '-') || p.chapterId === 'method-0'));
    assert.equal(new Set(passages.map(p => p.blockId)).size, passages.length);
  }
  const passages = selectBookPassages('en', 'She did not come.', tokens);
  assert.ok(passages.some(p => p.text.includes('did') && p.text.includes('начальн')));
  assert.ok(selectBookPassages('en', 'Hi.', [], 20).reduce((n,p) => n + p.text.length,0) <= 20);
  const prompt = buildSentenceAnnotationPrompt('kz', [{ id:'task-1', focus:'core', goal:'Найти основу' }], [{ taskId:'task-1', sentence:'Бала оқиды.' }]);
  assert.ok(prompt.startsWith('REVIEW_AND_ANNOTATE'));
  assert.match(prompt, /BOOK_SOURCE_CONTEXT/);
  assert.match(prompt, /book:\/\/kz-/);
});
it('grounds Kazakh questions only in Kazakh rules and the common method', () => {
  for (const language of ['kz', 'kk', 'Қазақша', 'казахский']) {
    const passages = selectBookPassages(language, 'Олар кеше жұмыс істеді ме?');
    assert.ok(passages.some(p => p.chapterId === 'kz-1' && p.title.includes('Вопросительное')));
    assert.ok(passages.some(p => /ма \/|ме|вопросительным словом/.test(p.text)));
    assert.ok(passages.every(p => p.chapterId.startsWith('kz-') || p.chapterId === 'method-0'));
    assert.ok(passages.every(p => !p.title.includes('отрицанием')));
    assert.ok(passages.length <= 7);
  }
});
it('does not supply question or negative sections for affirmative sentences', () => {
  for (const [language, sentence] of [['kz', 'Бала кітап оқиды.'], ['en', 'She does read.'], ['en', 'She did come.']]) {
    const passages = selectBookPassages(language, sentence);
    assert.ok(passages.every(p => !/Вопросительное|отрицанием/.test(p.title)), JSON.stringify(passages));
    assert.ok(passages.every(p => !/-[4-8]$/.test(p.chapterId)), 'Do not automatically include every chapter when tokens are absent');
  }
});
it('keeps negative and question evidence separate, including Kazakh negative suffixes', () => {
  const negative = selectBookPassages('kz', 'Ол мәтінді аудармады.', [{
    text: 'аудармады', role: 'Predicate', label: 'глагол', parts: ['аудар', 'ма', 'ды'], translation: 'не перевёл', is_in_my_dict: false,
  }]);
  assert.ok(negative.some(p => p.title.includes('отрицанием')));
  assert.ok(negative.every(p => !p.title.includes('Вопросительное')));
  const question = selectBookPassages('en', 'Does she read?');
  assert.ok(question.some(p => p.title.includes('Вопросительное')));
  assert.ok(question.every(p => !p.title.includes('отрицанием')));
  assert.ok(selectBookPassages('la', 'Puer legit?').every(p => p.chapterId === 'method-0'));
});
it('rejects fabricated addresses and removes unsupported book links while preserving supported references', () => {
  const passage = selectBookPassages('en', 'She did not come.', tokens)[0];
  assert.deepEqual(parseBookURL(bookURL(passage)), { chapterId: passage.chapterId, blockId: passage.blockId });
  for (const url of ['book://en-999/fake', 'book://en-1/fake', 'https://example.com', 'book://../x']) assert.equal(parseBookURL(url), undefined);
  assert.equal(isBookLocation({ chapterId: 'en-1', blockId: 123 }), false);
  assert.equal(stripUnsupportedBookLinks(`[Правило](${bookURL(passage)}) [Выдумка](book://en-999/fake)`, [passage]), `[Правило](${bookURL(passage)}) Выдумка`);
});
const originalFetch = globalThis.fetch;
const originalURL = process.env.EXPO_PUBLIC_GEMINI_PROXY_URL;
afterEach(() => { globalThis.fetch = originalFetch; if (originalURL === undefined) delete process.env.EXPO_PUBLIC_GEMINI_PROXY_URL; else process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = originalURL; });
it('passes only the Kazakh question sources to the explanation model', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  let prompt = '';
  globalThis.fetch = async (_, init) => {
    prompt = JSON.parse(init!.body as string).prompt;
    return Response.json({ text: 'Частица «ме» превращает высказывание в вопрос.' });
  };
  await explainSentenceWithAI('Олар кеше жұмыс істеді ме?', 'Қазақша', 'Они вчера работали?');
  const sources = [...prompt.matchAll(/"source":"book:\/\/([\w-]+)\//g)].map(match => match[1]);
  assert.ok(sources.some(id => id === 'kz-1'));
  assert.ok(sources.every(id => id.startsWith('kz-') || id === 'method-0'));
  assert.match(prompt, /Правила других языков не используй/);
});
it('sends the book context to explanations and repairs invented citations without losing the explanation', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  const requests: string[] = [];
  globalThis.fetch = async (_, init) => {
    requests.push(JSON.parse(init!.body as string).prompt);
    return Response.json({ text: '**Основа предложения**: сказуемое did not come. [Правило](book://en-999/fake)' });
  };
  const text = await explainSentenceWithAI('She did not come.', 'English', 'Она не пришла.', tokens);
  assert.equal(requests.length, 2);
  assert.match(requests[0], /BOOK_SOURCE_CONTEXT/);
  assert.match(requests[0], /одинаковая роль Predicate/);
  assert.match(requests[1], /ссылка на книгу отсутствует/);
  assert.doesNotMatch(text, /book:\/\/en-999/);
  assert.match(text, /did not come/);
});
it('repairs citation clutter using the actual first answer, without retrying a concise answer', async () => {
  process.env.EXPO_PUBLIC_GEMINI_PROXY_URL = 'https://test.invalid/v1/generate';
  const source = bookURL(selectBookPassages('en', 'She did not come.', tokens)[0]);
  const concise = `**Основа предложения**\n\n**did not come** — «не пришла». [Правило](${source})\n\n**Подробности**\n\n**She** — «она».`;
  const crowded = concise + `\n[Ещё раз](${source}) [И ещё](${source})`;
  const requests: string[] = [];
  globalThis.fetch = async (_, init) => {
    requests.push(JSON.parse(init!.body as string).prompt);
    return Response.json({ text: requests.length === 1 ? crowded : concise });
  };
  assert.equal(await explainSentenceWithAI('She did not come.', 'English', 'Она не пришла.', tokens), concise);
  assert.equal(requests.length, 2);
  assert.ok(requests[1].includes(crowded));
  assert.match(requests[1], /слишком много ссылок/);
  requests.length = 0;
  globalThis.fetch = async (_, init) => {
    requests.push(JSON.parse(init!.body as string).prompt);
    return Response.json({ text: concise });
  };
  assert.equal(await explainSentenceWithAI('She did not come.', 'English', 'Она не пришла.', tokens), concise);
  assert.equal(requests.length, 1);
});
