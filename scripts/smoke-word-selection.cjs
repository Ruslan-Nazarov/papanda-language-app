// Focused queue lifecycle checks. Export a fresh web bundle first; all remote traffic is blocked.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/word-selection');
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
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      return void req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => {
      if (window !== window.top || location.origin === 'null') return;
      localStorage.setItem('papanda-onboarded', '1');
      Math.random = () => 0.5;
    });
    await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const seed = async state => {
      const script = await page.evaluateOnNewDocument(state => {
        if (window !== window.top || location.origin === 'null') return;
        localStorage.setItem('papanda-storage', JSON.stringify({ state, version: 0 }));
      }, state);
      try { await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('[role="tab"]'); }
      finally { await page.removeScriptToEvaluateOnNewDocument(script.identifier); }
    };
    const tab = name => page.click(`[role="tab"][aria-label="${name}"]`);
    const click = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')].some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')].filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
    };
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const progress = (done, total) => page.waitForFunction(expected => document.querySelector('[data-testid="word-tour-progress"]')?.textContent === expected, {}, `Пройдено: ${done} / ${total}`);
    const currentWord = () => page.$eval('[data-testid="word-sentence-en"]', el => el.textContent);
    const swipeNext = async () => {
      const r = await page.$eval('[data-testid="word-sentence-en"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.right - 8, y: r.top + r.height / 2, end: Math.max(16, r.left - 90) };
      });
      await page.touchscreen.touchStart(r.x, r.y);
      for (let step = 1; step <= 12; step++) await page.touchscreen.touchMove(r.x + (r.end - r.x) * step / 12, r.y);
      await page.touchscreen.touchEnd();
    };
    const customWords = ['a', 'b', 'c'].map(key => ({ eng: `selection-${key}`, word: `selection-${key}`,
      ru: `значение-${key}`, translations: { en: `selection-${key}`, it: `selezione-${key}` },
      count: 0, is_learned: 0, knowledge_stats: {}, show_stats: {}, is_favorite: true }));
    const learned = Object.fromEntries(require('../src/data/words.json').map(w => [w.eng, { knowledge_stats: { en: true, it: true } }]));
    const fixture = { activeLanguages: ['en', 'it'], userWordProgress: learned, customWords,
      wordTourSize: 5, workoutWordCount: 5, workoutFavoritesOnly: true, hasSeenSnoozeHint: true };

    await seed(fixture);
    await tab('Word Triples');
    await progress(0, 3);
    const first = await currentWord();
    await swipeNext(); await progress(1, 3);
    const second = await currentWord();
    assert.notEqual(first, second);
    await page.click('[data-testid="word-undo"]'); await progress(0, 3);
    assert.equal(await currentWord(), first);
    await swipeNext(); await progress(1, 3);
    assert.equal(await currentWord(), second, 'Undo then forward must keep the original queue');
    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="word-mark-learned"]');
      button.click(); button.click();
    });
    await progress(2, 3);
    const third = await currentWord();
    assert.equal(new Set([first, second, third]).size, 3);
    await swipeNext();
    await page.waitForSelector('[data-testid="word-tour-complete"]');
    const beforeReturn = (await state()).dailyShows;
    await tab('Statistics'); await tab('Word Triples');
    await page.waitForSelector('[data-testid="word-tour-complete"]');
    assert.deepEqual((await state()).dailyShows, beforeReturn);
    await click('Следующий тур'); await progress(0, 2);

    await seed(fixture);
    await tab('Brain Workout');
    const workoutPosition = position => page.waitForFunction(position => document.querySelector('[data-testid="workout-position"]')?.textContent === position, {}, position);
    const workoutWord = () => page.$eval('[data-testid="workout-prompt"]', el => el.textContent);
    await workoutPosition('1 / 3');
    const workoutFirst = await workoutWord();
    await click('Знаю'); await workoutPosition('2 / 3');
    const workoutSecond = await workoutWord();
    // Add a dictionary entry while a workout is active: its queue and position must survive.
    await tab('Word Triples');
    await page.click('[aria-label="Открыть словарь"]');
    await click('+ Добавить');
    await page.waitForSelector('[aria-label^="Слово ("]');
    const fields = await page.$$('[aria-label^="Слово ("]');
    for (let i = 0; i < fields.length; i++) await fields[i].type(`selection-added-${i}`);
    await click('Сохранить');
    await page.waitForFunction(() => !document.querySelector('[aria-label^="Слово ("]'));
    await page.click('[aria-label="Назад"]');
    await tab('Brain Workout'); await workoutPosition('2 / 3');
    assert.equal(await workoutWord(), workoutSecond, 'Dictionary additions must not restart the workout');
    await click('Не знаю'); await workoutPosition('3 / 3');
    const workoutThird = await workoutWord();
    const keys = [workoutFirst, workoutSecond, workoutThird].map(s => s.replace('selezione-', 'selection-'));
    assert.equal(new Set(keys).size, 3, 'No repeated word, even in another language');
    await click('Знаю');
    await page.waitForFunction(() => document.body.innerText.includes('Тренировка завершена!'));
    assert.equal((await state()).workoutSnapshots.at(-1).total, 3);
    assert.equal((await state()).workoutSnapshots.at(-1).correct, 2);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: fixed tours, no duplicates across languages, undo/forward, rapid double taps, short tours, completion, catalog additions, scores.');
  } catch (error) {
    if (page) console.error((await page.$eval('body', el => el.innerText)).slice(-2500));
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
