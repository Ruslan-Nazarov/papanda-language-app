// Run against dist-audit. All remote requests are blocked; storage is a test profile.
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
    const errors = [];
    let holdAudits = false;
    const heldAudits = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) return void request.continue();
      if (holdAudits && request.method() === 'OPTIONS') return void request.respond({ status: 200, headers: {
        'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type, X-Install-Id',
        'access-control-allow-methods': 'POST, OPTIONS' } });
      if (holdAudits && JSON.parse(request.postData() || '{}').prompt?.startsWith('Ты — эксперт-лингвист')) {
        heldAudits.push(request);
        return;
      }
      return void request.respond({ status: 503, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => {
      if (window !== window.top || location.origin === 'null') return;
      localStorage.setItem('papanda-onboarded', '1');
      Math.random = () => 0;
    });
    await page.setViewport({ width: 320, height: 740, hasTouch: true, isMobile: true });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const clickText = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')]
        .some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')]
        .filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
    };
    const tab = name => page.click(`[role="tab"][aria-label="${name}"]`);
    const seed = async state => {
      // Inject before hydration: a pending write from the old page must not
      // replace the fixture between localStorage.setItem and reload.
      const script = await page.evaluateOnNewDocument(state => {
        if (window !== window.top || location.origin === 'null') return;
        localStorage.setItem('papanda-storage', JSON.stringify({ state, version: 0 }));
      }, state);
      try {
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('[role="tab"]');
      } finally { await page.removeScriptToEvaluateOnNewDocument(script.identifier); }
    };
    const custom = { eng: 'review-fixture', word: 'example', ru: 'Двусмысленность', count: 7, is_learned: 0,
      translations: { en: 'ambiguity', it: 'ambiguità' }, knowledge_stats: {}, show_stats: { en: 7, it: 7 } };
    const learned = Object.fromEntries(require('../src/data/words.json').map(w =>
      [w.eng || w.word, { knowledge_stats: { en: true, it: true }, is_learned: 1 }]));
    const fixture = { userWordProgress: learned, activeLanguages: ['en', 'it'], customWords: [custom] };
    // Undo is available during a tour; keep another card pending after "Learned".
    await seed({ ...fixture, customWords: [custom, { ...custom, eng: 'review-spare-fixture', word: 'spare', translations: { en: 'spare', it: 'riserva' } }] });
    const showsBefore = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('papanda-storage')).state.dailyShows).reduce((a, b) => a + b, 0));
    await tab('Word Triples');
    const counter = '[data-testid="word-show-count"]';
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.getAttribute('aria-label') === 'Показов слова: 8');
    await page.click('[aria-label="Изменить отметку избранного"]');
    await page.click('[data-testid="word-mark-learned"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="word-tour-progress"]')?.textContent === 'Пройдено: 1 / 2');
    // Swipe the word itself: fixed screen coordinates can land on a language
    // badge after a layout change and start desktop text selection instead.
    const swipe = await page.$eval('[data-testid="word-sentence-en"]', el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + 8, y: r.top + r.height / 2, end: Math.min(innerWidth - 16, r.left + 188) };
    });
    await page.touchscreen.touchStart(swipe.x, swipe.y);
    for (let step = 1; step <= 12; step++) await page.touchscreen.touchMove(swipe.x + (swipe.end - swipe.x) * step / 12, swipe.y);
    await page.touchscreen.touchEnd();
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.getAttribute('aria-label') === 'Показов слова: 9');
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.equal(progress.userWordProgress['review-fixture'].count, 9);
    assert.equal(progress.userWordProgress['review-fixture'].is_favorite, true);
    assert.equal(Object.values(progress.dailyShows).reduce((a, b) => a + b, 0), showsBefore + 3);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 740, hasTouch: true, isMobile: true });
      await page.waitForFunction(selector => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.height > 0;
      }, {}, counter);
      await page.screenshot({ path: path.join(root, `review-counter-${width}.png`) });
    }
    await page.click('[aria-label="Статистика слова"]');
    await page.waitForFunction(() => document.body.innerText.includes('9\nпоказов'));
    await clickText('Закрыть');

    // Import replaces the mounted training session, including its undo history.
    await page.click('[data-testid="word-mark-learned"]');
    await tab('Settings');
    const backupPath = path.join(root, 'review-fixture.json');
    fs.writeFileSync(backupPath, JSON.stringify({ app: 'papanda', version: 1, data: {
      ...fixture, customWords: [{ ...custom, count: 0, show_stats: {} }],
    } }));
    const chooser = page.waitForFileChooser();
    await clickText('📥 Импортировать прогресс');
    await (await chooser).accept([backupPath]);
    await clickText('Заменить прогресс');
    await page.waitForFunction(() => !document.body.innerText.includes('Проверка резервной копии'));
    await tab('Word Triples');
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.getAttribute('aria-label') === 'Показов слова: 1');
    assert.equal(await page.$eval('[data-testid="word-tour-progress"]', el => el.textContent), 'Пройдено: 0 / 1');

    // Finishing a one-word workout shows its result before starting another tour.
    await seed({ userWordProgress: {}, activeLanguages: ['en'], workoutWordCount: 1, workoutLearnedWordCount: 0, workoutFavoritesOnly: true,
      customWords: [{ ...custom, is_favorite: true, count: 3, show_stats: { en: 3 }, knowledge_stats: { en: false },
        last_shown: '2026-01-01T00:00:00.000Z', last_shown_by_lang: { en: '2026-01-01T00:00:00.000Z' } }] });
    await tab('Brain Workout');
    await clickText('Знаю');
    await page.waitForFunction(() => document.body.innerText.includes('Тренировка завершена!'));
    await page.screenshot({ path: path.join(root, 'review-workout-result.png') });
    await clickText('Отлично!');
    await page.waitForFunction(() => !document.body.innerText.includes('Тренировка завершена!'));
    await page.waitForSelector('[data-testid="workout-position"]');

    // A delayed swipe must not answer on a hidden screen. A second action
    // during the transition must not snooze/advance the same card as well.
    const workoutFixture = { userWordProgress: {}, activeLanguages: ['en'], workoutWordCount: 1,
      workoutLearnedWordCount: 0, workoutFavoritesOnly: true, hasSeenSnoozeHint: true,
      customWords: [{ ...custom, count: 0, show_stats: {}, is_favorite: true }] };

    // Manual word audit is available before revealing the recall answer. It must
    // not count as an answer/show, and late results must be cancelled on blur.
    holdAudits = true;
    const respondToAudit = async (value, status = 200) => {
      const deadline = Date.now() + 5000;
      while (!heldAudits.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(heldAudits.length, 'Manual word audit must reach the proxy');
      await heldAudits.shift().respond({ status, contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(status === 200
          ? { text: JSON.stringify(value) } : { error: 'Ошибка тестовой проверки', retryable: false }) });
    };
    const auditButton = '[data-testid="workout-request-audit"]';
    const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    await seed({ ...workoutFixture, activeLanguages: ['en', 'it'] });
    await tab('Brain Workout');
    await page.click(auditButton);
    await page.waitForSelector('[data-testid="workout-audit-loading"]');
    assert.ok(!(await page.$eval('[data-testid="workout-card"]', el => el.innerText)).includes(custom.ru), 'Audit must not reveal the recall answer');
    assert.equal(await page.$eval(auditButton, el => el.getAttribute('aria-disabled')), 'true');
    await respondToAudit(null, 400);
    await page.waitForSelector('[data-testid="workout-audit-error"]');
    await page.click('[data-testid="workout-audit-error"] [role="button"]');
    await respondToAudit({ isValid: true, issues: [] });
    await page.waitForSelector('[data-testid="workout-audit-verified"]');
    const audited = (await readState()).userWordProgress['review-fixture'];
    assert.deepEqual(audited.ai_verification.checkedLanguages, ['en', 'it']);
    assert.equal(audited.knowledge_stats?.en, undefined);
    assert.equal(audited.knowledge_stats?.it, undefined);
    assert.equal(audited.count || 0, 0);
    assert.equal(audited.review_by_lang, undefined);

    await seed(workoutFixture);
    await tab('Brain Workout');
    await page.click(auditButton);
    await respondToAudit({ isValid: false, issues: [{ lang: 'en', issue: 'Неверный перевод', suggestion: 'example' }] });
    await page.waitForSelector('[data-testid="workout-audit-flagged"]');
    await page.click(auditButton);
    await page.waitForSelector('[data-testid="modal-request-audit"]');
    assert.ok((await page.$eval('body', el => el.innerText)).includes('Неверный перевод'));
    await clickText('Отмена');

    await seed(workoutFixture);
    await tab('Brain Workout');
    await page.click(auditButton);
    await page.waitForSelector('[data-testid="workout-audit-loading"]');
    await tab('Settings');
    await respondToAudit({ isValid: true, issues: [] });
    await tab('Brain Workout');
    assert.equal(await page.$('[data-testid="workout-audit-loading"]'), null);
    assert.equal((await readState()).userWordProgress['review-fixture']?.ai_verification, undefined);
    holdAudits = false;

    await seed(workoutFixture);
    await tab('Brain Workout');
    await page.waitForSelector('[data-testid="workout-show-count"]');
    await page.evaluate(() => {
      [...document.querySelectorAll('div')].filter(el => el.textContent === 'Знаю' && el.getBoundingClientRect().height > 0).at(-1).click();
      document.querySelector('[role="tab"][aria-label="Settings"]').click();
    });
    await new Promise(resolve => setTimeout(resolve, 600));
    let state = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.equal(state.userWordProgress['review-fixture']?.knowledge_stats?.en, undefined, 'Hidden animation must not record an answer');
    assert.equal(state.workoutSnapshots.length, 0);
    await tab('Brain Workout');
    await page.evaluate(() => {
      const click = text => [...document.querySelectorAll('div')].filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click();
      click('Знаю'); click('Реже');
    });
    await page.waitForFunction(() => document.body.innerText.includes('Тренировка завершена!'));
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.equal(state.workoutSnapshots.length, 1);
    assert.equal(state.workoutSnapshots[0].correct, 1);
    assert.equal(state.userWordProgress['review-fixture'].snoozed_until_by_lang, undefined);

    // Saving an unchanged form cannot certify a translation flagged by the AI.
    const flagged = { status: 'flagged', checkedAt: new Date().toISOString(), issues: [{ lang: 'en', issue: 'Неверный перевод' }] };
    await seed({ ...fixture, userWordProgress: { ...learned, 'review-fixture': { ai_verification: flagged } } });
    await tab('Word Triples');
    await page.click('[aria-label="Редактировать слово"]');
    await page.waitForFunction(() => document.body.innerText.includes('Редактировать слово'));
    await clickText('Сохранить');
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.deepEqual(state.userWordProgress['review-fixture'].ai_verification, flagged);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: counts, undo, import, last review, manual recall audit (retry, verdicts, editor, cancellation), animation cancellation, overlapping answers, AI verdict preservation, 320/430px.');
  } catch (error) {
    if (page) {
      console.error('Failed screen:', (await page.$eval('body', el => el.innerText).catch(() => '<navigation in progress>')).slice(-4000));
      await page.screenshot({ path: path.join(root, 'review-failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
