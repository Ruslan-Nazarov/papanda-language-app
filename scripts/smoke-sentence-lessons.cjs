// Regression: experiment toggle, saved exercise checkpoints, completion and optional extension.
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
    await page.setViewport({ width: 320, height: 740 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      void req.respond({ status: 503, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const click = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('[role="button"]')].some(el => (el.textContent === text || el.getAttribute('aria-label') === text) && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('[role="button"]')].find(el => (el.textContent === text || el.getAttribute('aria-label') === text) && el.getBoundingClientRect().height > 0).click(), text);
      await new Promise(resolve => setTimeout(resolve, 80));
    };
    const tab = async name => {
      await page.waitForSelector(`[role="tab"][aria-label="${name}"]`);
      await page.click(`[role="tab"][aria-label="${name}"]`);
    };
    const experiments = async () => {
      await tab('Settings');
      await page.waitForSelector('[data-testid="settings-experiments"]');
      await page.click('[data-testid="settings-experiments"]');
      await page.waitForSelector('[data-testid="experiment-toggle-sentence-lessons"]');
    };
    const leaveSettings = async () => {
      await page.click('[data-testid="experiments-back"]');
      await tab('Sentence Trainer');
    };
    await page.waitForSelector('[data-testid="trainer-next"]');
    assert.equal(await page.$('[data-testid="sentence-lessons-screen"]'), null, 'off by default');
    await experiments();
    await page.click('[data-testid="experiment-toggle-sentence-lessons"]');
    await leaveSettings();
    await page.waitForSelector('[data-testid="lesson-home"]');
    await page.screenshot({ path: path.join(root, 'sentence-lessons-home.png') });
    await click('Начать занятие');
    await page.waitForSelector('[data-testid="lesson-progress"]');
    const code = (await state()).activeLanguages[0];
    const first = (await state()).sentenceLessons[code].current;
    assert.equal(first.items.length, 5);
    // The first exercise asks for the predicate. Answer it, then reload on the checked step.
    const predicateIndices = first.items[0].sentence.words.flatMap((word, index) => word.role === 'Predicate' && (word.clauseIndex ?? 0) === 0 ? [index] : []);
    for (const index of predicateIndices) await page.click(`[aria-label="Слово ${index + 1}: ${first.items[0].sentence.words[index].text}"]`);
    await click('Проверить выбор');
    const checked = (await state()).sentenceLessons[code].current.items[0].progress;
    assert.equal(checked.checked, true);
    assert.equal(checked.outcomes[0].result, 'correct');
    const attempts = (await state()).structureAttempts.length;
    await page.reload({ waitUntil: 'networkidle0' });
    await click('Продолжить занятие');
    assert.deepEqual((await state()).sentenceLessons[code].current.items[0].progress, checked);
    assert.equal((await state()).structureAttempts.length, attempts, 'reload must not record another answer');
    await click('Разбор спорный');
    await click('Следующий шаг');
    await click('Подсказка-вопрос');
    const resumed = (await state()).sentenceLessons[code].current.items[0].progress;
    assert.equal(resumed.step, 1);
    assert.equal(resumed.hint, 1);
    await click('Продолжить позже');
    await experiments();
    await page.click('[data-testid="experiment-toggle-sentence-lessons"]');
    await leaveSettings();
    await page.waitForSelector('[data-testid="trainer-next"]');
    assert.equal(await page.$('[data-testid="sentence-lessons-screen"]'), null);
    assert.deepEqual((await state()).sentenceLessons[code].current.items[0].progress, resumed);
    await experiments();
    await page.click('[data-testid="experiment-toggle-sentence-lessons"]');
    await leaveSettings();
    await click('Продолжить занятие');
    assert.equal((await state()).sentenceLessons[code].current.id, first.id);
    assert.deepEqual((await state()).sentenceLessons[code].current.items[0].progress, resumed);
    await page.screenshot({ path: path.join(root, 'sentence-lessons-exercise.png') });
    await click('Пропустить предложение');
    // Finish the remaining cards using the same visible checkbox/check/next controls as a learner.
    while (!(await state()).sentenceLessons[code].current.completedAt) {
      const lesson = (await state()).sentenceLessons[code].current;
      const item = lesson.items[lesson.position], cp = item.progress;
      const next = await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].some(el => ['Следующее предложение', 'Завершить занятие'].includes(el.textContent) && el.getBoundingClientRect().height > 0));
      if (next) { await click(lesson.position === 4 ? 'Завершить занятие' : 'Следующее предложение'); continue; }
      const question = await page.evaluate(() => [...document.querySelectorAll('div')].find(el => el.childElementCount === 0 && el.textContent.startsWith('Найдите: '))?.textContent);
      const wanted = question?.includes('сказуемое') ? 'Predicate' : 'Subject';
      const indices = item.sentence.words.flatMap((word, index) => word.role === wanted && (word.clauseIndex ?? 0) === 0 ? [index] : []);
      assert.ok(indices.length, `expected ${wanted} in the core exercise`);
      for (const index of indices) await page.click(`[aria-label="Слово ${index + 1}: ${item.sentence.words[index].text}"]`);
      await click('Проверить выбор');
      await click('Следующий шаг');
    }
    await page.waitForSelector('[data-testid="lesson-result"]');
    const result = (await state()).sentenceLessons[code].history.at(-1);
    assert.equal(result.sentencesCompleted, 4);
    assert.equal(result.sentencesSkipped, 1);
    assert.equal(result.disputed, 1);
    assert.ok(result.independent > 0 && result.assisted > 0);
    await page.screenshot({ path: path.join(root, 'sentence-lessons-result.png') });
    await click('Ещё 3 предложения');
    assert.equal((await state()).sentenceLessons[code].current.items.length, 3);
    for (let i = 0; i < 3; i++) await click('Пропустить предложение');
    await click('Закончить');
    await click('Свободный разбор и свои тексты');
    await page.waitForSelector('[data-testid="trainer-next"]');
    await click('Вернуться к занятию');
    await page.waitForSelector('[data-testid="sentence-lessons-screen"]');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log('Sentence lessons passed: default off, settings toggle, exact resume after reload/stop/restart, hints, disputes, five-card result, three-card extension and free mode at 320px.');
  } catch (error) {
    if (page) { console.error((await page.$eval('body', el => el.innerText)).slice(-5000)); await page.screenshot({ path: path.join(root, 'sentence-lessons-failure.png') }); }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
