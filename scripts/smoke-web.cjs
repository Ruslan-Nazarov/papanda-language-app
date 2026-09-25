// Run after `expo export --platform web --output-dir dist-audit`.
// All non-local requests are blocked; this test never spends AI quota.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '../dist-audit');
  const server = http.createServer((request, response) => {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (relative === '/' ? '/index.html' : relative));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end(); return;
    }
    const contentType = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.ttf': 'font/ttf' }[path.extname(file)];
    response.setHeader('Content-Type', contentType || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewport({ width: 430, height: 932 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) void request.continue();
      else void request.respond({ status: 503, contentType: 'application/json', body: '{"error":"Offline smoke test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('papanda-onboarded', '1'); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[role="tab"]');
    const tabs = await page.$$eval('[role="tab"]', elements => elements.map(element => ({ label: element.getAttribute('aria-label'), text: element.textContent })));
    console.log('Tabs:', JSON.stringify(tabs));
    console.log('Screen:', (await page.$eval('body', body => body.innerText)).slice(0, 900));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(tabs.length, 5);
    for (let index = 0; index < tabs.length; index++) {
      const elements = await page.$$('[role="tab"]');
      await elements[index].click();
      await page.waitForFunction(() => !document.body.innerText.includes('Что-то пошло не так'));
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[role="tab"]');
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.evaluate(() => localStorage.setItem('papanda-storage', 'broken-json'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Не удалось прочитать сохранённый прогресс'));
    assert.equal(await page.evaluate(() => localStorage.getItem('papanda-storage')), 'broken-json');
    console.log('Web smoke passed: hydration, 5 tabs, reload, corrupt storage preserved; no uncaught exceptions.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
