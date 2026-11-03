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
    const revealLabel = () => page.$eval('[data-testid="trainer-reveal"]', el => el.textContent);
    const translationVisible = () => page.$eval('[data-testid="trainer-step-surface"]', el => el.innerText.includes('Перевод примера.'));
    const blockRects = () => page.$$eval('[data-testid^="trainer-block-"]', els => els.map(el => {
      const { x, y, width, height } = el.getBoundingClientRect();
      return [x, y, width, height].map(value => Math.round(value));
    }));
    const tapBackground = async () => {
      const point = await page.$eval('[data-testid="trainer-step-surface"]', el => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.bottom - 12 };
      });
      await page.touchscreen.tap(point.x, point.y);
    };
    const assertClauseFrames = async () => {
      const frames = await page.$$eval('[data-testid^="trainer-block-"]', blocks => blocks.map(block => {
        const frame = getComputedStyle(block.parentElement);
        const card = getComputedStyle(block);
        return { index: Number(block.dataset.testid.split('-').at(-1)),
          framed: parseFloat(frame.borderTopWidth) > 0 && parseFloat(card.borderTopWidth) > 0,
          color: frame.borderTopColor, revealed: block.getAttribute('aria-label').startsWith('Объяснить форму слова:') };
      }));
      assert.equal(frames.length, 10);
      for (const frame of frames) {
        assert.equal(frame.framed, frame.index >= 7, `Block ${frame.index}: second-clause double frames must remain visible before and after reveal`);
        if (frame.index >= 7) assert.equal(frame.color, frame.revealed
          ? ({ 7: 'rgb(16, 185, 129)', 8: 'rgb(59, 130, 246)', 9: 'rgb(239, 68, 68)' })[frame.index]
          : 'rgb(148, 163, 184)', 'Hidden frames show the clause boundary; revealed frames show the role color');
      }
    };
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
    const beforeReveal = await blockRects();
    assert.ok(count >= 2);
    assert.ok(!(await body()).includes('Найдите'));
    assert.ok(!(await body()).includes('свайп для смены'));
    await page.tap('[data-testid="trainer-block-1"]');
    await page.waitForFunction(() => !document.querySelector('[data-testid="trainer-block-1"]').getAttribute('aria-label').startsWith('Раскрыть'));
    assert.equal(await hidden(), count - 1, 'Tap must reveal only that block, even if two words share a role');
    assert.deepEqual(await blockRects(), beforeReveal, 'Revealing a block must preserve every block position and size');
    assert.ok(await page.$('[data-testid="trainer-block-0"][aria-label="Раскрыть блок 1"]'));
    assert.equal(await translationVisible(), false, 'A partial reveal must not show the final translation');
    await page.click('[data-testid="trainer-next"]');
    await page.waitForFunction(first => document.querySelector('[data-testid="trainer-sentence-text"]').textContent !== first, {}, first);
    assert.equal(await translationVisible(), false);
    assert.equal(await page.$eval('[data-testid="trainer-position"]', el => el.textContent), '2 / 3');
    await page.click('[data-testid="trainer-previous"]');
    await page.waitForFunction(first => document.querySelector('[data-testid="trainer-sentence-text"]').textContent === first, {}, first);
    assert.equal(await hidden(), count);
    for (let i = 0; i < count && await hidden() > 0; i++) await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), 0);
    assert.equal(await revealLabel(), 'Перевод');
    assert.equal(await translationVisible(), false);
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), 0, 'Final translation step must keep all blocks revealed');
    assert.equal(await translationVisible(), true);
    const translatedRects = await blockRects();
    assert.deepEqual(translatedRects.map(rect => rect.slice(2)), beforeReveal.map(rect => rect.slice(2)), 'Translation must preserve block dimensions');
    assert.ok((await body()).includes('Перевод примера.'));
    assert.equal(await revealLabel(), 'Повторить с 1 шага');
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), count);
    assert.equal(await translationVisible(), false, 'Restart must also hide translation');
    await tapBackground();
    assert.ok(await hidden() < count, 'Blank-space tap must advance a role-group');
    for (let i = 0; i < count && await hidden() > 0; i++) await tapBackground();
    assert.equal(await hidden(), 0);
    assert.equal(await revealLabel(), 'Перевод');
    await tapBackground();
    assert.equal(await hidden(), 0);
    assert.equal(await translationVisible(), true, 'Blank-space tap must show the final translation');
    await tapBackground();
    assert.equal(await hidden(), count, 'Blank-space tap must restart after translation');
    assert.equal(await translationVisible(), false);
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
      for (const text of ['В кеше: 3', 'Создано за сеанс: 2', 'В очереди разбора: 3', 'Кеш всех языков: 4']) assert.ok(stats.includes(text), stats);
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
    assert.equal(await page.$eval('[data-testid="trainer-next"]', el => el.getAttribute('aria-label')), 'Завершить тренировку');
    assert.equal(await page.$eval('[data-testid="trainer-previous"]', el => el.getAttribute('aria-disabled')), 'true');
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
    await assertClauseFrames();
    for (const [width, height] of [[320, 640], [390, 740]]) {
      await page.setViewport({ width, height, hasTouch: true, isMobile: true });
      await page.$eval('[data-testid="trainer-block-9"]', el => el.scrollIntoView({ block: 'center' }));
      assert.ok(await page.$eval('[data-testid="trainer-block-9"]', el => {
        const r = el.getBoundingClientRect();
        const footer = document.querySelector('[data-testid="trainer-reveal"]').getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth && r.bottom < footer.top;
      }), 'Long exercises must scroll to the last block above the fixed actions');
      await page.screenshot({ path: path.join(root, `trainer-long-${width}.png`) });
    }
    await page.$eval('[data-testid="trainer-block-0"]', el => el.scrollIntoView({ block: 'start' }));
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await page.$$eval('[data-testid^="trainer-block-"]', els => els.length), 10, 'All cards remain present throughout the exercise');
    assert.ok(await page.$('[data-testid="trainer-block-3"][aria-label="Объяснить форму слова: drinks"]'), 'First step reveals the predicate, not the first word');
    assert.ok(await page.$('[data-testid="trainer-block-0"][aria-label="Раскрыть блок 1"]'), 'Other cards remain closed');
    await assertClauseFrames();
    assert.equal(await page.$$eval('[data-testid="trainer-sentence-text"] [role="button"]', els => els.length), 0, 'The original sentence is plain text');
    await page.screenshot({ path: path.join(root, 'trainer-long-first-step.png') });
    while (await hidden() > 0) await page.click('[data-testid="trainer-reveal"]');
    await page.click('[data-testid="trainer-reveal"]');
    await assertClauseFrames();
    await page.screenshot({ path: path.join(root, 'trainer-long-revealed.png') });
    await openMenu();
    await click('Режим: Таблица');
    await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    await assertClauseFrames();
    for (const width of [320, 390]) {
      await page.setViewport({ width, height: 740, hasTouch: true, isMobile: true });
      const rows = await page.$$eval('[data-testid^="trainer-role-"]', rows => rows.map(row => {
        const label = row.firstElementChild.getBoundingClientRect();
        const button = row.querySelector('[role="button"]').getBoundingClientRect();
        return { separated: button.top >= label.bottom + 4, withinScreen: label.left >= 0 && label.right <= innerWidth && button.right <= innerWidth };
      }));
      assert.equal(rows.length, 10);
      assert.ok(rows.every(row => row.separated && row.withinScreen), 'Dictionary actions must not overlap role labels or leave the screen');
    }
    await page.click('[data-testid="trainer-reveal"]');
    assert.equal(await hidden(), 10);
    await assertClauseFrames();
    await page.tap('[data-testid="trainer-block-9"]');
    assert.equal(await hidden(), 9);
    await assertClauseFrames();
    await page.screenshot({ path: path.join(root, 'trainer-table-clause-frames.png') });
    await openMenu();
    await click('Режим: Карточки');
    await page.waitForSelector('[aria-modal="true"]', { hidden: true });
    assert.equal(await hidden(), 9);
    await assertClauseFrames();
    assert.deepEqual(errors, []);
    console.log('PASS: per-block and blank-space taps, grouped reveal → translation → restart, previous/next reset, card/table modes, double clause frames before/after reveal and mode switches, language/cache stats, quiet background generation and menu cancellation; 320/430px.');
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
