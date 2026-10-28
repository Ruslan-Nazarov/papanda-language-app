// Offline pilot regression check. Run against a fresh dist-audit export.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const project = path.resolve(__dirname, '..');
  const bundle = path.join(project, process.env.SMOKE_BUNDLE_DIR || 'dist-audit');
  const output = path.join(project, process.env.DESIGN_PILOT_OUTPUT_DIR || 'dist/design-pilot');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const base = pathname.startsWith('/kit/') ? path.join(project, 'design-system/papanda-design-system-0.7.167') : bundle;
    const relative = pathname.startsWith('/kit/') ? pathname.slice(4) : pathname;
    const file = path.resolve(base, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    let explanationRequest;
    let explanationMode = 'hold';
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || /^(data|blob):/.test(request.url())) return void request.continue();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Install-Id', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return void request.respond({ status: 200, headers });
      if (request.postData()?.includes('почему выделенное слово')) {
        if (explanationMode === 'hold') { explanationRequest = request; return; }
        return void request.respond({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ text: 'Танысу → танысты: действие завершилось в прошлом.' }) });
      }
      return void request.respond({ status: 503, headers, contentType: 'application/json', body: '{"error":"Offline check","retryable":false}' });
    });
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(url + '/kit/index.html');
    await page.click('#saveExample');
    assert.equal(await page.$eval('#entryError', el => el.hidden), false);
    assert.equal(await page.$eval('#entryTitle', el => el === document.activeElement), true);
    await page.type('#entryTitle', 'Проверка каталога');
    await page.click('#saveExample');
    await page.waitForFunction(() => document.querySelector('#saveStatus').textContent.includes('сохранена'));
    await page.screenshot({ path: path.join(output, 'catalogue-1440.png') });
    await page.setViewport({ width: 390, height: 844 });
    await page.click('[data-section="states"]');
    await page.screenshot({ path: path.join(output, 'catalogue-states-390.png') });

    const baseWords = require('../src/data/words.json');
    const progress = Object.fromEntries(baseWords.map(word => [word.eng || word.word, { knowledge_stats: { kz: true, it: true }, is_learned: 1, is_favorite: false }]));
    const fixture = {
      userWordProgress: progress, activeLanguages: ['kz', 'it'], workoutFavoritesOnly: true,
      customWords: [{ eng: 'pilot-fixture', ru: 'знакомиться', it: 'presentarsi',
        translations: { kz: 'танысу', it: 'presentarsi' }, count: 2, is_learned: 0, is_favorite: true,
        knowledge_stats: { kz: false, it: false }, show_stats: { kz: 1, it: 1 } }],
      generatedSentences: [{ id: 'pilot-sentence', language: 'Қазақша', sentence: 'Бала танысты.',
        literalTranslation: 'Ребёнок познакомился.', source: 'generated', createdAt: Date.now() + 60000,
        words: [
          { text: 'Бала', role: 'Subject', translation: 'ребёнок', dictionary_form: 'бала' },
          { text: 'танысты', role: 'Predicate', translation: 'познакомился', dictionary_form: 'танысу', dictionary_word: 'pilot-fixture' },
        ].map(token => ({ ...token, label: '', parts: [token.text], is_in_my_dict: true, clauseIndex: 0 })) }],
    };
    await page.evaluateOnNewDocument(fixture => {
      if (!localStorage.getItem('pilot-seeded')) {
        localStorage.setItem('papanda-onboarded', '1');
        localStorage.setItem('papanda-storage', JSON.stringify({ version: 0, state: fixture }));
        localStorage.setItem('pilot-seeded', '1');
      }
    }, fixture);
    const select = id => `[data-testid="${id}"]`;
    const tab = name => page.click(`[role="tab"][aria-label="${name}"]`);
    const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`) });
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await tab('Word Triples');
    await page.waitForSelector(select('word-compose-kz'));
    await page.waitForFunction(() => document.fonts.check('16px Inter_400Regular') && document.fonts.check('24px Outfit_500Medium'));
    assert.ok((await page.$eval('body', el => el.innerText)).includes('presentarsi'));
    for (const width of [320, 390, 1440]) {
      await page.setViewport({ width, height: 844 });
      assert.equal(await fits(), true, `${width}px: no horizontal overflow`);
      assert.ok(await page.$eval(select('word-compose-kz'), el => {
        const r = el.getBoundingClientRect(); const s = el.firstElementChild.getBoundingClientRect();
        return r.height >= 44 && s.height <= 36 && r.width < 280;
      }));
      await screenshot(`words-${width}`);
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.focus('[aria-label="Открыть словарь"]');
    assert.equal(await page.$eval('[aria-label="Открыть словарь"]', el => getComputedStyle(el).outlineWidth), '2px');
    await page.keyboard.press('Tab');
    assert.ok(await page.evaluate(() => document.activeElement !== document.body));
    await page.focus(select('word-association'));
    await page.type(select('word-association'), 'Танысу — знакомлюсь с новым человеком.');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-storage')).state.userWordProgress['pilot-fixture'].personal_association?.includes('новым человеком'));
    await page.setViewport({ width: 390, height: 480 });
    await page.$eval(select('word-association'), el => el.scrollIntoView({ block: 'center' }));
    assert.ok(await page.$eval(select('word-association'), el => {
      const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom < innerHeight;
    }));
    await screenshot('words-reduced-viewport');
    await page.setViewport({ width: 390, height: 844 });
    await page.reload({ waitUntil: 'networkidle0' });
    await tab('Word Triples');
    await page.waitForSelector(select('word-association'));
    assert.match(await page.$eval(select('word-association'), el => el.value), /новым человеком/);

    // Long Cyrillic/Kazakh names, large text, and an empty learning queue.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('papanda-storage'));
      saved.state.customWords[0].ru = 'знакомиться с новым собеседником и представляться';
      saved.state.customWords[0].translations.kz = 'жаңа әңгімелесушімен танысу';
      saved.state.customWords[0].it = 'presentarsi a una nuova conoscenza';
      localStorage.setItem('papanda-storage', JSON.stringify(saved));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await tab('Word Triples');
    await page.waitForSelector(select('word-compose-kz'));
    await page.setViewport({ width: 320, height: 740 });
    assert.equal(await fits(), true);
    await screenshot('words-long-320');
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="words-scroll"] [dir="auto"]').forEach(el => {
        const size = parseFloat(getComputedStyle(el).fontSize); el.style.fontSize = size * 1.5 + 'px';
      });
    });
    assert.equal(await fits(), true);
    assert.ok(await page.$$eval('[data-testid^="word-sentence-"] > div', els => els.every(el => el.scrollWidth <= el.clientWidth + 1)), 'Large words must wrap inside their language row');
    await screenshot('words-large-text-320');
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('papanda-storage'));
      saved.state.userWordProgress['pilot-fixture'].knowledge_stats = { kz: true, it: true };
      localStorage.setItem('papanda-storage', JSON.stringify(saved));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await tab('Word Triples');
    await page.waitForFunction(() => document.body.innerText.includes('Нет доступных слов'));
    await screenshot('words-empty-320');

    await tab('Brain Workout');
    await page.waitForSelector(select('workout-previous-answer'));
    assert.ok(await page.evaluate(() => {
      const previous = document.querySelector('[data-testid="workout-previous-answer"]');
      const card = document.querySelector('[data-testid="workout-card"]');
      return !card.contains(previous) && previous.getBoundingClientRect().bottom <= card.getBoundingClientRect().top;
    }), 'Previous answer sits above the flashcard');
    assert.match(await page.$eval(select('workout-show-count'), el => el.textContent), /👁/);
    assert.equal(await fits(), true);
    await screenshot('workout-320');

    // Trainer: compact translation, loading, legacy 402, retry, and closing.
    await page.setViewport({ width: 390, height: 844 });
    await tab('Sentence Trainer');
    await page.waitForSelector(select('trainer-translation'));
    assert.ok(await page.$eval(select('trainer-translation'), el => el.getBoundingClientRect().height >= 44 && el.firstElementChild.getBoundingClientRect().height <= 36));
    await page.click(select('trainer-reveal'));
    await page.click('[aria-label="Объяснить форму слова: танысты"]');
    await page.waitForFunction(() => document.body.innerText.includes('Разбираем форму'));
    await screenshot('word-form-loading');
    assert.ok(explanationRequest);
    await explanationRequest.respond({ status: 502, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"error":"Upstream error 402.","retryable":false}' });
    await page.waitForFunction(() => document.body.innerText.includes('ИИ временно недоступен'));
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Upstream error'));
    assert.ok(await page.$$eval('[data-testid="word-form-modal"] [role="button"]', els => els.every(el => el.getBoundingClientRect().height >= 44)), 'Compact modal actions retain full touch targets');
    await screenshot('word-form-error');
    explanationMode = 'success';
    await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find(el => el.textContent === 'Повторить объяснение').click());
    await page.waitForFunction(() => document.body.innerText.includes('действие завершилось'));
    await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find(el => el.textContent === 'Закрыть').click());
    await page.waitForSelector(select('word-form-modal'), { hidden: true });
    assert.deepEqual(errors, []);
    console.log('Papanda pilot passed: catalogue, 320/390/1440px, bundled fonts, compact touch targets, keyboard focus, association persistence, reduced viewport, long/large text, empty state, loading, 402 and retry.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
