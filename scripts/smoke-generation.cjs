// Use the dist-audit bundle with EXPO_PUBLIC_GEMINI_PROXY_URL=https://smoke.invalid/v1/generate.
// Hold each AI stage and exercise real controls under CPU throttling; no AI calls leave this test.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

const cards = [
  [['Lena', 'Subject'], ['reads', 'Predicate', 'read']],
  [['Young', 'Attribute_Subject'], ['Lena', 'Subject'], ['reads', 'Predicate', 'read']],
  [['Young', 'Attribute_Subject'], ['Lena', 'Subject'], ['reads', 'Predicate', 'read'], ['letters', 'Object', 'letter']],
  [['Young', 'Attribute_Subject'], ['Lena', 'Subject'], ['reads', 'Predicate', 'read'], ['letters', 'Object', 'letter'], ['outside', 'Circumstance']],
  [['The', 'Article'], ['gardener', 'Subject'], ['does', 'Predicate', 'do'], ['not', 'Predicate'], ['sing', 'Predicate']],
  [['The', 'Article'], ['painter', 'Subject'], ['opens', 'Predicate', 'open'], ['a', 'Article'], ['window', 'Object']],
  [['Does', 'Predicate', 'do'], ['the', 'Article'], ['painter', 'Subject'], ['open', 'Predicate'], ['a', 'Article'], ['window', 'Object']],
  [['The', 'Article'], ['gardener', 'Subject'], ['smiles', 'Predicate', 'smile'], ['and', 'Conjunction', 'and', 1], ['the', 'Article', 'the', 1], ['painter', 'Subject', 'painter', 1], ['nods', 'Predicate', 'nod', 1]],
].map((tokens, i) => ({
  taskId: `task-${i + 1}`, sentence: tokens.map(token => token[0]).join(' ') + (i === 6 ? '?' : '.'),
  literalTranslation: 'Учебный пример.', review: { natural: true, taskFit: true, analysisReliable: true },
  words: tokens.map(([text, role, lemma, clauseIndex]) => ({ text, role, dictionary_form: lemma || text.toLowerCase(),
    label: role === 'Predicate' ? 'Verb' : 'Noun', parts: [text], translation: 'перевод', clauseIndex: clauseIndex || 0 })),
}));
const verdicts = cards.map(card => ({ taskId: card.taskId, natural: true, translation: true,
  roles: true, morphology: true, chain: true, reason: '' }));

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist-audit');
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', { '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  let page;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewport({ width: 430, height: 932, hasTouch: true, isMobile: true });
    await page.emulateCPUThrottling(4);
    const errors = [];
    const held = new Map();
    const calls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) return void request.continue();
      if (request.method() === 'OPTIONS') return void request.respond({ status: 200, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Install-Id',
        'access-control-allow-methods': 'POST, OPTIONS' } });
      const body = JSON.parse(request.postData() || '{}');
      const stage = body.prompt?.split('\n')[0];
      calls.push(body.prompt);
      if (['COMPOSE_SENTENCES', 'REVIEW_AND_ANNOTATE', 'AUDIT_SENTENCE_CARDS'].includes(stage)) {
        held.set(stage, request); return;
      }
      void request.respond({ status: 503, headers: { 'access-control-allow-origin': '*' },
        contentType: 'application/json', body: '{"error":"Offline smoke test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('papanda-onboarded', '1'); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    const waitStage = async stage => {
      const deadline = Date.now() + 10000;
      while (!held.has(stage) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(held.has(stage), `Missing stage ${stage}`);
    };
    const respond = async (stage, value) => {
      const request = held.get(stage); held.delete(stage);
      await request.respond({ status: 200, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ text: JSON.stringify(value) }) });
    };
    const tab = async name => {
      const started = Date.now();
      await page.click(`[role="tab"][aria-label="${name}"]`);
      await page.waitForSelector(`[role="tab"][aria-label="${name}"][aria-selected="true"]`, { timeout: 2500 });
      return Date.now() - started;
    };
    const exercise = async stage => {
      const before = await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent);
      const label = await page.$eval('[data-testid="trainer-translation"]', el => el.textContent);
      await page.click('[data-testid="trainer-translation"]');
      await page.waitForFunction(label => document.querySelector('[data-testid="trainer-translation"]').textContent !== label, { timeout: 2500 }, label);
      await page.click('[data-testid="trainer-reveal"]');
      const latencies = [];
      for (const name of ['Settings', 'Word Triples', 'Brain Workout', 'Statistics', 'Sentence Trainer']) latencies.push(await tab(name));
      assert.equal(await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent), before);
      assert.ok(held.has(stage), 'Navigation must work before the AI responds');
      console.log(`${stage}: all tabs and card controls responsive; slowest tab ${Math.max(...latencies)} ms (4x CPU slowdown)`);
    };
    await page.waitForSelector('[data-testid="trainer-sentence-text"]');
    await waitStage('COMPOSE_SENTENCES');
    await exercise('COMPOSE_SENTENCES');
    await respond('COMPOSE_SENTENCES', cards.map(({ taskId, sentence }) => ({ taskId, sentence })));
    await waitStage('REVIEW_AND_ANNOTATE');
    await exercise('REVIEW_AND_ANNOTATE');
    await respond('REVIEW_AND_ANNOTATE', cards);
    await waitStage('AUDIT_SENTENCE_CARDS');
    await exercise('AUDIT_SENTENCE_CARDS');
    await respond('AUDIT_SENTENCE_CARDS', verdicts);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-storage')).state.generatedSentences.length === 8);
    await tab('Settings');
    await new Promise(resolve => setTimeout(resolve, 2500));
    assert.equal(calls.filter(prompt => prompt?.startsWith('COMPOSE_SENTENCES')).length, 1, 'Hidden tabs must not start extra language batches');
    // An explicit word request must start even while the automatic batch is held.
    await tab('Sentence Trainer');
    await page.click('[data-testid="sentence-options"]');
    await page.evaluate(() => [...document.querySelectorAll('div')]
      .filter(el => el.textContent.endsWith('Сгенерировать ещё (ИИ)') && el.getBoundingClientRect().height > 0)
      .sort((a, b) => a.textContent.length - b.textContent.length)[0].click());
    await waitStage('COMPOSE_SENTENCES');
    const background = held.get('COMPOSE_SENTENCES');
    await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    await tab('Word Triples');
    await page.waitForSelector('[data-testid="word-sentence-en"]', { visible: true });
    const word = await page.$eval('[data-testid="word-sentence-en"]', el => el.textContent);
    await page.click('[data-testid="word-sentence-en"]');
    const deadline = Date.now() + 3000;
    while (held.get('COMPOSE_SENTENCES') === background && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.notEqual(held.get('COMPOSE_SENTENCES'), background, 'Explicit generation is blocked by the background batch');
    assert.ok(calls.at(-1).includes(JSON.stringify(word)), 'The new request must include the chosen word');
    await page.click('[data-testid="sentence-options"]');
    await page.click('[data-testid="trainer-cancel-generation"]');
    await respond('COMPOSE_SENTENCES', []).catch(() => {});
    await background.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ text: JSON.stringify(cards) }) }).catch(() => {});
    await page.waitForFunction(() => document.body.innerText.includes('Генерация отменена'));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.generatedSentences.length), 8);

    // Filling an 80-card cache evicts its oldest entries. The current card must
    // stay selected by identity even when its numerical position changes.
    await page.emulateCPUThrottling(1);
    await page.evaluate(() => {
      const generatedSentences = Array.from({ length: 80 }, (_, i) => ({
        id: `eviction-${i}`, language: 'English', source: 'generated', createdAt: Date.now() + 60000,
        sentence: `Reader${i} reads.`, words: [
          { text: `Reader${i}`, role: 'Subject', label: 'Noun', translation: 'читатель', is_in_my_dict: false },
          { text: 'reads', role: 'Predicate', label: 'Verb', translation: 'читает', is_in_my_dict: false },
        ],
      }));
      localStorage.setItem('papanda-storage', JSON.stringify({ version: 0, state: {
        userWordProgress: {}, activeLanguages: ['en'], generatedSentences,
      } }));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitStage('COMPOSE_SENTENCES');
    await page.waitForSelector('[data-testid="trainer-next"]');
    for (let position = 2; position <= 80; position++) {
      await page.click('[data-testid="trainer-next"]');
      await page.waitForFunction(position => document.querySelector('[data-testid="trainer-position"]').textContent === `${position} / 80`, {}, position);
    }
    let selected = await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent);
    while (Number(selected.match(/Reader(\d+)/)[1]) < 8) {
      await page.click('[data-testid="trainer-previous"]');
      await page.waitForFunction(previous => document.querySelector('[data-testid="trainer-sentence-text"]').textContent !== previous, {}, selected);
      selected = await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent);
    }
    const positionBefore = await page.$eval('[data-testid="trainer-position"]', el => el.textContent);
    await respond('COMPOSE_SENTENCES', cards.map(({ taskId, sentence }) => ({ taskId, sentence })));
    await waitStage('REVIEW_AND_ANNOTATE');
    await respond('REVIEW_AND_ANNOTATE', cards);
    await waitStage('AUDIT_SENTENCE_CARDS');
    await respond('AUDIT_SENTENCE_CARDS', verdicts);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-storage')).state.generatedSentences.filter(s => s.id.startsWith('eviction-')).length === 72);
    assert.equal(await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent), selected);
    assert.notEqual(await page.$eval('[data-testid="trainer-position"]', el => el.textContent), positionBefore);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Validated batch saved; no extra language batches; word request takes priority; late cancelled replies ignored; cache eviction preserves the selected card.');
  } catch (error) {
    if (page) {
      console.error((await page.$eval('body', el => el.innerText)).slice(-3000));
      await page.screenshot({ path: path.join(root, 'generation-failure.png') });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
