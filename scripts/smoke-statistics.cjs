// Run after `expo export --platform web --output-dir dist/imw`.
// Uses isolated browser storage and blocks all remote requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/imw');
  const words = require('../src/data/words.json');
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
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) return void request.continue();
      return void request.respond({ status: 503, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    await page.setViewport({ width: 320, height: 740 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const seed = async state => {
      await page.evaluate(state => localStorage.setItem('papanda-storage', JSON.stringify({ state, version: 0 })), state);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[role="tab"][aria-label="Statistics"]');
      await page.click('[role="tab"][aria-label="Statistics"]');
      await page.waitForFunction(() => [...document.querySelectorAll('div')]
        .some(el => el.textContent === 'Оценка закрепления' && el.getBoundingClientRect().height > 0));
      if (!await page.$('[data-testid="memory-estimate"]')) {
        await page.evaluate(() => [...document.querySelectorAll('div')]
          .filter(el => el.textContent === 'Оценка закрепления').at(-1).click());
        await page.waitForSelector('[data-testid="memory-estimate"]', { visible: true });
      }
    };
    const score = () => page.$eval('[data-testid="memory-score"]', el => el.textContent);
    // The initial trainer screen must not add incidental sentence exposures.
    const empty = Object.fromEntries(words.map((word, i) => [word.eng || word.word, {
      custom_translations: { kz: `imw-fixture-${i}` },
    }]));
    await seed({ userWordProgress: empty, activeLanguages: ['kz'] });
    assert.equal(await score(), '0 из 100');
    const progress = { ...empty, ...Object.fromEntries(words.slice(0, 10).map(word => [word.eng || word.word, {
      ...empty[word.eng || word.word],
      count: 1, show_stats: { kz: 1 }, knowledge_stats: { kz: false },
    }])) };
    await seed({ userWordProgress: progress, activeLanguages: ['kz'] });
    assert.equal(await score(), '0,002 из 100');
    assert.equal(await page.$eval('[data-testid="memory-score-kz"]', el => el.textContent), '0,002 / 100');
    const body = await page.$eval('[data-testid="memory-estimate"]', el => el.textContent);
    assert.ok(body.includes(`По всему словарю: ${words.length} слов`));
    assert.ok(!body.includes('начали учить'));
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.imwSnapshots.at(-1));
    assert.ok(Math.abs(snapshot.imw - (10 * 0.00625 / words.length) * 100) < 1e-12);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 740 });
      await page.$eval('[data-testid="memory-estimate"]', el => el.scrollIntoView());
      assert.ok(await page.$eval('[data-testid="memory-score"]', el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.left >= 0 && rect.right <= innerWidth;
      }));
      await page.screenshot({ path: path.join(root, `statistics-${width}.png`) });
    }
    await page.click('[aria-label="Как считается: Оценка закрепления"]');
    await page.waitForFunction(() => document.body.innerText.includes('Непоказанные слова тоже учитываются'));
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(`Statistics UI passed: ${words.length} words, ten exposures = ${snapshot.imw}, 320/430px.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
