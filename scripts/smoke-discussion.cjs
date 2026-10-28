// Focused discussion check against an export using https://smoke.invalid.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/discussion');
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
    await page.setViewport({ width: 360, height: 740 });
    const errors = [], discussions = [], explanations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || /^(data|blob):/.test(req.url())) return void req.continue();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Install-Id', 'access-control-allow-methods': 'POST, OPTIONS' };
      const reply = (body, status = 200) => req.respond({ status, headers, contentType: 'application/json', body: JSON.stringify(body) });
      if (req.method() === 'OPTIONS') return void reply({});
      const prompt = JSON.parse(req.postData() || '{}').prompt || '';
      if (prompt.startsWith('Ты — преподаватель языка. Обсуди')) {
        const payload = JSON.parse(prompt.slice(prompt.indexOf('{')));
        discussions.push(payload);
        return void (payload.question === 'Ошибка' ? reply({ error: 'Тестовая ошибка сети', retryable: false }, 503)
          : reply({ text: `Ответ на вопрос ${discussions.length}: это действие.` }));
      }
      if (prompt.includes('Пожалуйста, разбери это предложение')) {
        explanations.push(prompt);
        return void reply({ text: prompt.includes('нужен только раздел «Подробности»')
          ? '**Подробности**\nОкончание показывает форму слова.' : 'fly — сказуемое: обозначает действие птиц.' });
      }
      void reply({ error: 'Offline test', retryable: false }, 503);
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('papanda-onboarded', '1');
      localStorage.setItem('papanda-storage', JSON.stringify({ version: 0, state: { userWordProgress: {}, activeLanguages: ['en'] } }));
      Math.random = () => 0;
    });
    const click = async label => {
      await page.waitForFunction(label => [...document.querySelectorAll('[role="button"]')].some(el => el.textContent === label && el.checkVisibility()), {}, label);
      await page.evaluate(label => [...document.querySelectorAll('[role="button"]')].find(el => el.textContent === label && el.checkVisibility()).click(), label);
    };
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-testid="trainer-ai-explain"]');
    await page.click('[data-testid="trainer-ai-explain"]');
    await click('Разобрать слова и окончания');
    await page.waitForFunction(() => document.body.innerText.includes('Окончание показывает форму слова.'));
    assert.equal(explanations.length, 2);
    assert.match(explanations[0], /нужен только раздел «Основа предложения»/);
    await click('Свернуть разбор слов');
    await click('Разобрать слова и окончания');
    assert.equal(explanations.length, 2, 'Expanding loaded details must not generate again');
    await click('Обсудить с ИИ');
    const input = '[aria-label="Вопрос по разбору"]';
    const send = async question => { await page.type(input, question); await click('Отправить'); };
    await send('Почему это сказуемое?');
    await page.waitForFunction(() => document.body.innerText.includes('Ответ на вопрос 1'));
    await send('А можно пример?');
    await page.waitForFunction(() => document.body.innerText.includes('Ответ на вопрос 2'));
    assert.equal(discussions[0].context.explanation, 'fly — сказуемое: обозначает действие птиц.');
    assert.ok(discussions[0].context.sentence);
    assert.ok(discussions[0].context.tokens.length);
    assert.equal(discussions[1].history.length, 2);
    assert.equal(discussions[1].history[0].text, 'Почему это сказуемое?');
    await click('← К объяснению');
    await click('Обсудить с ИИ');
    assert.ok(await page.$eval('body', el => el.innerText.includes('Ответ на вопрос 2')));
    await send('Ошибка');
    await page.waitForFunction(() => document.body.innerText.includes('Тестовая ошибка сети'));
    assert.equal(await page.$eval(input, el => el.value), 'Ошибка');
    await page.$eval(input, el => { el.focus(); el.select(); });
    await page.keyboard.type('Повторный вопрос');
    await click('Повторить отправку');
    await page.waitForFunction(() => document.body.innerText.includes('Ответ на вопрос 4'));
    assert.equal(discussions[3].history.length, 4, 'Failed questions must not corrupt conversation history');
    const bounds = await page.$eval(input, el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; });
    assert.ok(bounds.top >= 0 && bounds.bottom <= bounds.height, 'Composer must fit on a phone viewport');
    await page.screenshot({ path: path.join(root, 'discussion.png') });
    await page.click('[aria-label="Закрыть объяснение"]');
    await page.click('[data-testid="trainer-ai-explain"]');
    await click('Разобрать слова и окончания');
    await page.waitForFunction(() => document.body.innerText.includes('Окончание показывает форму слова.'));
    assert.equal(explanations.length, 2, 'Reopening must reuse cached sections with a fresh cancellation signal');
    await click('Обсудить с ИИ');
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Ответ на вопрос 4'), 'Closing the window ends its discussion');
    assert.deepEqual(errors, []);
    console.log('Discussion UI passed: context, follow-up, return, error/retry, phone layout and session reset.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
