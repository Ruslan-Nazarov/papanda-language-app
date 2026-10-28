// Focused offline workflow check against a fresh Expo web export.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/experiments');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewport({ width: 360, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || /^(data|blob):/.test(request.url())) return void request.continue();
      void request.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline check","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    const id = 'hide-daily-review';
    const selector = testId => `[data-testid="${testId}"]`;
    const click = async testId => {
      const css = selector(testId);
      await page.waitForSelector(css, { visible: true });
      await page.$eval(css, el => el.scrollIntoView({ block: 'center' }));
      await page.click(css);
    };
    const tab = async name => {
      const css = `[role="tab"][aria-label="${name}"]`;
      await page.waitForSelector(css, { visible: true });
      await page.click(css);
    };
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const waitRun = (count, active) => page.waitForFunction((id, count, active) => {
      const runs = JSON.parse(localStorage.getItem('papanda-storage')).state.experiments?.[id]?.runs;
      return runs?.length === count && (runs.at(-1).stoppedAt === null) === active;
    }, {}, id, count, active);
    const reviewVisible = visible => page.waitForFunction(visible =>
      [...document.querySelectorAll('div')].some(el => el.textContent === 'Повторение на сегодня' && el.checkVisibility()) === visible, {}, visible);

    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await tab('Statistics');
    await reviewVisible(true);
    await tab('Settings');
    await click('settings-experiments');
    await page.waitForSelector(selector(`experiment-note-${id}`), { visible: true });
    assert.equal(await page.$eval(selector(`experiment-status-${id}`), el => el.textContent), 'Ещё не запускался');
    await page.type(selector(`experiment-note-${id}`), 'Проверяем пользу повторения');
    await click(`experiment-toggle-${id}`);
    await waitRun(1, true);
    const first = (await state()).experiments[id].runs[0];
    await page.type(selector(`experiment-run-note-${first.id}`), 'Первый запуск');
    await click('experiments-back');
    await tab('Statistics');
    await reviewVisible(false);
    await tab('Settings');
    await click('settings-experiments');
    await click(`experiment-toggle-${id}`);
    await waitRun(1, false);
    await click('experiments-back');
    await tab('Statistics');
    await reviewVisible(true);
    await tab('Settings');
    await click('settings-experiments');
    await click(`experiment-toggle-${id}`);
    await waitRun(2, true);
    await page.reload({ waitUntil: 'networkidle0' });
    await tab('Statistics');
    await reviewVisible(false);
    await tab('Settings');
    await click('settings-experiments');
    await page.waitForSelector(selector(`experiment-note-${id}`), { visible: true });
    assert.equal(await page.$eval(selector(`experiment-note-${id}`), el => el.value), 'Проверяем пользу повторения');
    assert.equal(await page.$eval(selector(`experiment-run-note-${first.id}`), el => el.value), 'Первый запуск');
    assert.equal(await page.$$eval(selector('experiment-run'), nodes => nodes.length), 2);
    const saved = (await state()).experiments[id];
    assert.ok(saved.runs[0].stoppedAt);
    assert.equal(saved.runs[1].stoppedAt, null);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 800 });
      await page.$eval(selector(`experiment-status-${id}`), el => el.scrollIntoView({ block: 'start' }));
      assert.ok(await page.$eval(selector(`experiment-note-${id}`), el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.width > 0;
      }));
      await page.screenshot({ path: path.join(root, `experiments-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('Experiments UI passed: start/stop/restart, review visibility, notes and history after reload, 320/430px.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
