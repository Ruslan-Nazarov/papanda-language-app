// Run after: npx expo export --platform web --output-dir dist/word-tour
// The browser has a test profile and cannot send requests outside localhost.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/word-tour');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      return void req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    await page.setViewport({ width: 360, height: 780 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.evaluate(() => localStorage.setItem('papanda-storage', JSON.stringify({ state: { userWordProgress: {}, activeLanguages: ['en'] }, version: 0 })));
    await page.reload({ waitUntil: 'networkidle0' });
    const initialShows = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('papanda-storage')).state.dailyShows).reduce((a, b) => a + b, 0));
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const shows = async () => Object.values((await state()).dailyShows).reduce((a, b) => a + b, 0) - initialShows;
    const tab = async name => {
      await page.waitForSelector(`[role="tab"][aria-label="${name}"]`);
      await page.click(`[role="tab"][aria-label="${name}"]`);
    };
    const click = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')].some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')].filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
    };
    const progress = (done, total) => page.waitForFunction(expected => document.querySelector('[data-testid="word-tour-progress"]')?.textContent === expected, {}, `Пройдено: ${done} / ${total}`);
    const complete = () => page.waitForSelector('[data-testid="word-tour-complete"]');
    await tab('Word Triples');
    await progress(0, 10);
    assert.equal((await state()).wordTourSize, 10);
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('за заход'));
    await page.mouse.move(280, 350);
    await page.mouse.down();
    await page.mouse.move(60, 350, { steps: 12 });
    await page.mouse.up();
    await progress(1, 10);
    for (let done = 2; done <= 10; done++) {
      await click('✓ Выучено');
      if (done < 10) await progress(done, 10); else await complete();
    }
    assert.equal(await shows(), 10, 'Completing ten cards must not display an eleventh');
    await tab('Statistics');
    await tab('Word Triples');
    await complete();
    assert.equal(await shows(), 10, 'Returning to a completed tour must not display another card');
    await page.screenshot({ path: path.join(root, 'word-tour-complete.png') });
    await click('Вернуть предыдущее слово');
    await progress(9, 10);
    assert.equal(await shows(), 11, 'Undo counts the real repeated presentation');
    await click('✓ Выучено');
    await complete();
    assert.equal(await shows(), 11);
    await click('Следующий тур');
    await progress(0, 10);
    assert.equal(await shows(), 12);
    await tab('Settings');
    await page.waitForSelector('[aria-label="Карточек за тур: 5"]');
    await page.click('[aria-label="Карточек за тур: 5"]');
    await page.waitForFunction(() => document.querySelector('[aria-label="Карточек за тур: 5"]')?.getAttribute('aria-selected') === 'true');
    await page.screenshot({ path: path.join(root, 'word-tour-settings.png') });
    assert.equal((await state()).wordTourSize, 5);
    assert.equal((await state()).workoutWordCount, 10);
    await tab('Word Triples');
    await progress(0, 5);
    const start = await shows();
    for (let done = 1; done <= 5; done++) {
      await click('✓ Выучено');
      if (done < 5) await progress(done, 5); else await complete();
    }
    assert.equal(await shows(), start + 4, 'A five-card tour must stop before its sixth card');
    await page.reload({ waitUntil: 'networkidle0' });
    await tab('Settings');
    await page.waitForFunction(() => document.querySelector('[aria-label="Карточек за тур: 5"]')?.getAttribute('aria-selected') === 'true');
    await tab('Word Triples');
    await progress(0, 5);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 780 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(root, `word-tour-progress-${width}.png`) });
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: default ten, swipe and learned cards, exact tour limit, undo, next tour, settings, five-card limit, reload and narrow layout.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
