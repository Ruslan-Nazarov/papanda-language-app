// Export with the smoke.invalid proxy URL. Every remote request is intercepted.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
async function main() {
  const root = path.resolve(__dirname, '..', process.env.SMOKE_BUNDLE_DIR || 'dist/trainer-fixes');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (new URL(req.url, 'http://localhost').pathname === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewport({ width: 320, height: 740, hasTouch: true, isMobile: true });
    const errors = [], held = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) return void request.continue();
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Install-Id', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (request.method() === 'OPTIONS') return void request.respond({ status: 200, headers });
      if (request.postData()?.includes('COMPOSE_SENTENCES')) return void held.push(request);
      void request.respond({ status: 503, headers, contentType: 'application/json', body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('papanda-onboarded', '1');
      if (localStorage.getItem('trainer-fixture')) return;
      const sentence = (id, language, tokens, createdAt) => ({ id, language, source: 'generated', createdAt,
        sentence: tokens.map(t => t[0]).join(' ') + '.', literalTranslation: 'Перевод примера.', learningGoal: 'Найдите сказуемое.',
        words: tokens.map(([text, role]) => ({ text, role, label: role, translation: 'перевод', parts: [text], dictionary_form: text.toLowerCase(), is_in_my_dict: false, clauseIndex: 0 })) });
      localStorage.setItem('papanda-storage', JSON.stringify({ version: 0, state: {
        userWordProgress: {}, activeLanguages: ['en', 'it'], generatedSentences: [
          sentence('tap-a', 'English', [['Birds', 'Subject'], ['can', 'Predicate'], ['fly', 'Predicate']], Date.now() + 60000),
          sentence('tap-b', 'English', [['Dogs', 'Subject'], ['run', 'Predicate']], Date.now() + 60000),
          sentence('tap-old', 'English', [['Cats', 'Subject'], ['sleep', 'Predicate']], 1),
          sentence('tap-it', 'Italiano', [['Luca', 'Subject'], ['legge', 'Predicate']], 1),
        ],
      } }));
      localStorage.setItem('trainer-fixture', '1');
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' });
    const click = async label => {
      await page.evaluate(label => {
        const node = [...document.querySelectorAll('div')].filter(el => el.textContent === label && el.getBoundingClientRect().height > 0).at(-1);
        if (!node) throw Error('No element: ' + label);
        node.click();
      }, label);
    };
    const body = () => page.$eval('body', el => el.innerText);
    const hidden = () => page.$$eval('[aria-label^="Раскрыть блок"]', els => els.length);
    const openMenu = async () => {
      await page.click('[data-testid="sentence-options"]');
      await page.waitForSelector('[data-testid="trainer-cache-stats"]', { visible: true });
      await new Promise(resolve => setTimeout(resolve, 350)); // Let the modal fade finish before screenshots.
    };
    const closeMenu = async () => {
      await page.click('[aria-label="Закрыть меню"]');
      await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    };
    await page.waitForSelector('[data-testid="trainer-block-0"]');
    const first = await page.$eval('[data-testid="trainer-sentence-text"]', el => el.textContent);
    const count = await hidden();
    assert.ok(count >= 2);
    assert.ok(!(await body()).includes('Найдите'));
    assert.ok(!(await body()).includes('свайп для смены'));
    await page.tap('[data-testid="trainer-block-1"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="trainer-block-1"]').getAttribute('aria-label').startsWith('Раскрыть'));
    assert.equal(await hidden(), count - 1, 'Tap must reveal only that block, even if two words share a role');
    assert.ok(await page.$('[data-testid="trainer-block-0"][aria-label="Раскрыть блок 1"]'));
    await page.click('[data-testid="trainer-translation"]');
    await page.click('[data-testid="trainer-next"]');
    await page.waitForFunction(first => document.querySelector('[data-testid="trainer-sentence-text"]').textContent !== first, {}, first);
    assert.equal(await page.$eval('[data-testid="trainer-translation"]', el => el.textContent), 'Перевод');
    assert.equal(await page.$eval('[data-testid="trainer-position"]', el => el.textContent), '2 / 2');
    await page.click('[data-testid="trainer-previous"]');
    await page.waitForFunction(first => document.querySelector('[data-testid="trainer-sentence-text"]').textContent === first, {}, first);
    assert.equal(await hidden(), count);
    for (let i = 0; i < count && await hidden() > 0; i++) await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), 0);
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), count);
    await page.waitForFunction(() => document.body.innerText.includes('Объяснить структуру'));
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 740, hasTouch: true, isMobile: true });
      for (const selector of ['[data-testid="trainer-next"]', '[data-testid="trainer-previous"]', '[data-testid="trainer-block-0"]']) {
        assert.ok(await page.$eval(selector, el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height >= 44; }));
      }
      assert.ok(!(await body()).includes('Отменить генерацию'), 'Background generation controls belong in the menu');
      await page.screenshot({ path: path.join(root, `trainer-${width}.png`) });
      await openMenu();
      const stats = await page.$eval('[data-testid="trainer-cache-stats"]', el => el.innerText);
      for (const text of ['В кеше: 3', 'Создано за сеанс: 2', 'В очереди разбора: 2', 'Кеш всех языков: 4']) assert.ok(stats.includes(text), stats);
      await page.screenshot({ path: path.join(root, `trainer-menu-${width}.png`) });
      await closeMenu();
    }
    await openMenu();
    await click('Режим: Таблица');
    await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    await page.tap('[data-testid="trainer-block-1"]');
    assert.equal(await hidden(), count - 1);
    await page.screenshot({ path: path.join(root, 'trainer-table.png') });
    await openMenu();
    await click('Режим: Карточки');
    await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    assert.equal(await hidden(), count - 1);
    await click('Italiano');
    await page.waitForFunction(() => document.querySelector('[data-testid="trainer-sentence-text"]').textContent === 'Luca legge.');
    assert.equal(await hidden(), 2);
    assert.equal(await page.$eval('[data-testid="trainer-next"]', el => el.getAttribute('aria-disabled')), 'true');
    await openMenu();
    assert.ok((await page.$eval('[data-testid="trainer-cache-stats"]', el => el.innerText)).includes('В кеше: 1'));
    await page.waitForSelector('[data-testid="trainer-cancel-generation"]');
    await page.click('[data-testid="trainer-cancel-generation"]');
    await page.waitForFunction(() => document.body.innerText.includes('Генерация отменена'));
    assert.deepEqual(errors, []);
    assert.ok(held.length > 0, 'Generation must actually be in flight during card interaction');
    await closeMenu();
    // A full sentence is essential here: short fixtures hide layout regressions.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('papanda-storage'));
      saved.state.activeLanguages = ['en', 'it', 'kz'];
      saved.state.generatedSentences = [{
        id: 'layout-long', language: 'English', source: 'generated', createdAt: Date.now() + 60000,
        sentence: 'The thirsty man drinks cold water because the sun shines.',
        literalTranslation: 'Мужчина, испытывающий жажду, пьёт холодную воду, потому что светит солнце.',
        words: [
          ['The', 'Attribute', 'этот'], ['thirsty', 'Attribute', 'испытывающий жажду'],
          ['man', 'Subject', 'мужчина'], ['drinks', 'Predicate', 'пьёт'],
          ['cold', 'Attribute', 'холодную'], ['water', 'Object', 'воду'],
          ['because', 'Conjunction', 'потому что'], ['the', 'Attribute', 'это'],
          ['sun', 'Subject', 'солнце'], ['shines', 'Predicate', 'светит'],
        ].map(([text, role, translation], index) => ({ text, role, label: role, translation, parts: [text],
          dictionary_form: text, is_in_my_dict: false, clauseIndex: index >= 7 ? 1 : 0 })),
      }];
      localStorage.setItem('papanda-storage', JSON.stringify(saved));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="trainer-block-9"]');
    for (const [width, height] of [[320, 640], [390, 740]]) {
      await page.setViewport({ width, height, hasTouch: true, isMobile: true });
      assert.ok(await page.$eval('[data-testid="trainer-block-9"]', el => {
        const r = el.getBoundingClientRect();
        const footer = document.querySelector('[data-testid="trainer-reveal"]').getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.bottom < footer.top;
      }), 'All ten closed cards must fit above the fixed actions');
      await page.screenshot({ path: path.join(root, `trainer-long-${width}.png`) });
    }
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await page.$$eval('[data-testid^="trainer-block-"]', els => els.length), 10, 'All cards remain present throughout the exercise');
    assert.ok(await page.$('[data-testid="trainer-block-3"][aria-label="Открыть слово: drinks"]'), 'First step reveals the predicate, not the first word');
    assert.ok(await page.$('[data-testid="trainer-block-0"][aria-label="Раскрыть блок 1"]'), 'Other cards remain closed');
    assert.equal(await page.$$eval('[data-testid="trainer-sentence-text"] [role="button"]', els => els.length), 0, 'The original sentence is plain text');
    await page.screenshot({ path: path.join(root, 'trainer-long-first-step.png') });
    await page.click('[data-testid="trainer-translation"]');
    while (await hidden() > 0) await page.click('[data-testid="trainer-reveal"]');
    await page.screenshot({ path: path.join(root, 'trainer-long-revealed.png') });
    assert.deepEqual(errors, []);
    console.log('PASS: per-block tap, grouped reveal, previous/next reset, card/table modes, language/cache stats, quiet background generation and menu cancellation; 320/430px.');
  } catch (error) {
    if (page) { console.error((await bodyText(page)).slice(-3500)); await page.screenshot({ path: path.join(root, 'trainer-failure.png') }); }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
const bodyText = page => page.$eval('body', el => el.innerText);
main().catch(error => { console.error(error); process.exitCode = 1; });
