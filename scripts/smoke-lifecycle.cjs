// Device failures, cold starts and calendar changes; isolated profile, no remote traffic.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist-audit');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewport({ width: 360, height: 780 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:') || req.url().startsWith('blob:')) return void req.continue();
      void req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('papanda-onboarded', '1');
      Math.random = () => 0;
      const Clock = Date;
      window.clockOffset = 0;
      window.Date = class extends Clock {
        constructor(...args) { if (args.length) super(...args); else super(Clock.now() + window.clockOffset); }
        static now() { return Clock.now() + window.clockOffset; }
      };
      const write = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.failStorage && key === 'papanda-storage') throw new DOMException('Disk full', 'QuotaExceededError');
        return write.call(this, key, value);
      };
      const create = URL.createObjectURL;
      URL.createObjectURL = blob => { void blob.text().then(text => { window.lastBackup = text; }); return create(blob); };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const tab = async name => { await page.waitForSelector(`[role="tab"][aria-label="${name}"]`); await page.click(`[role="tab"][aria-label="${name}"]`); };
    const click = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')].some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')].filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
    };
    const seed = async state => {
      const setup = await page.evaluateOnNewDocument(state => {
        if (window !== window.top || location.origin === 'null') return;
        localStorage.setItem('papanda-storage', JSON.stringify({ state, version: 0 }));
      }, state);
      try { await page.reload({ waitUntil: 'networkidle0' }); }
      finally { await page.removeScriptToEvaluateOnNewDocument(setup.identifier); }
      await page.waitForSelector('[role="tab"]');
    };
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const chapter = require('../src/data/book.generated.json').chapters[0];
    const place = { chapterId: chapter.id, blockId: chapter.blocks[0].id };
    const book = { lastLocation: place, bookmarks: [place], fontSize: 21 };
    await page.evaluate(book => localStorage.setItem('papanda-book-reader', JSON.stringify({ state: book, version: 0 })), book);
    await seed({ userWordProgress: {}, activeLanguages: ['en'] });
    await tab('Settings');
    await page.evaluate(() => { window.failStorage = true; });
    await page.click('[aria-label="Карточек за тур: 5"]');
    await page.waitForFunction(() => document.body.innerText.includes('Изменения ещё не сохранены'));
    assert.equal((await state()).wordTourSize, 10);
    await page.screenshot({ path: path.join(root, 'storage-write-failure.png') });
    await page.evaluate(() => { window.failStorage = false; });
    await click('Повторить сохранение');
    await page.waitForFunction(() => !document.body.innerText.includes('Изменения ещё не сохранены'));
    assert.equal((await state()).wordTourSize, 5);
    await click('📤 Экспортировать прогресс');
    await page.waitForFunction(() => window.lastBackup);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.lastBackup).book), book);

    // An unreadable reader store must not be overwritten with an empty default.
    await page.evaluate(() => localStorage.setItem('papanda-book-reader', '{broken'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Не удалось прочитать закладки книги'));
    assert.equal(await page.evaluate(() => localStorage.getItem('papanda-book-reader')), '{broken');
    await page.evaluate(book => localStorage.setItem('papanda-book-reader', JSON.stringify({ state: book, version: 0 })), book);
    await click('Повторить загрузку');
    await page.waitForSelector('[role="tab"]');
    assert.equal((await state()).wordTourSize, 5);

    const custom = { eng: 'lifecycle-word', word: 'quux', ru: 'Пример', count: 0, is_learned: 0, translations: { en: 'quux' }, is_favorite: true };

    // Clearing a translation in the current quiz cannot record a blank answer.
    await seed({ userWordProgress: {}, activeLanguages: ['en'], customWords: [custom], workoutWordCount: 1, workoutLearnedWordCount: 0, workoutFavoritesOnly: true });
    await tab('Brain Workout');
    await page.click('[aria-label="Редактировать слово"]');
    await page.waitForSelector('[aria-label="Слово (English)"]');
    await page.click('[aria-label="Слово (English)"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    assert.equal(await page.$eval('[aria-label="Слово (English)"]', el => el.value), '');
    await click('Сохранить');
    await page.waitForFunction(() => document.body.innerText.includes('Перевод удалён'));
    await click('Пропустить без оценки');
    await page.waitForFunction(() => document.body.innerText.includes('Тренировка завершена!'));
    assert.equal((await state()).userWordProgress['lifecycle-word'].knowledge_stats?.en, undefined);
    assert.equal((await state()).workoutSnapshots.length, 0);

    // Saved and legacy manually-created cards stay in the normal AI queue.
    const card = (id, text, extra) => ({ id, language: 'English', sentence: text, words: [{ text, role: 'Predicate', label: 'глагол', translation: 'пример', is_in_my_dict: false }], ...extra });
    await seed({ userWordProgress: {}, activeLanguages: ['en'], generatedSentences: [card('ai', 'Invented', { source: 'generated', createdAt: 1 })],
      customSentences: [card('manual', 'Saved', { source: 'manual', chainStep: 1, generationBatchId: 'old' }), card('legacy', 'Legacy', {})] });
    await page.waitForFunction(() => document.querySelector('[data-testid="trainer-position"]')?.textContent === '1 / 3');
    for (const expected of ['Invented', 'Saved', 'Legacy']) {
      await page.waitForFunction(expected => document.querySelector('[data-testid="trainer-sentence-text"]')?.textContent === expected, {}, expected);
      if (expected !== 'Legacy') await page.click('[data-testid="trainer-next"]');
    }

    // Returning to a mounted statistics tab after midnight refreshes the day.
    const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    const laterDay = await page.evaluate(() => { const d = new Date(Date.now() + 2 * 86400000); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
    const clockWords = Object.fromEntries(require('../src/data/words.json').map((word, index) => [word.eng || word.word, { custom_translations: { kz: `clock-fixture-${index}` } }]));
    await seed({ userWordProgress: clockWords, activeLanguages: ['kz'], dailyShows: { [today]: 13, [laterDay]: 24 } });
    await tab('Statistics');
    await page.waitForFunction(() => document.querySelector('[data-testid="statistics-today"]')?.textContent === '13');
    await tab('Settings');
    await page.evaluate(() => { window.clockOffset = 86400000; });
    await tab('Statistics');
    await page.waitForFunction(() => document.querySelector('[data-testid="statistics-today"]')?.textContent === '0');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.clockOffset = 2 * 86400000;
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => document.querySelector('[data-testid="statistics-today"]')?.textContent === '24');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: failed writes/retry, book backup/read recovery, empty quiz card, saved sentence queue, next-day statistics.');
  } catch (error) {
    if (page) { console.error((await page.$eval('body', el => el.innerText)).slice(-4000)); await page.screenshot({ path: path.join(root, 'lifecycle-failure.png') }); }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
