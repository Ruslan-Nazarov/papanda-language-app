// Run against dist-audit. All remote requests are blocked; storage is a test profile.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, '../dist-audit');
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
    const clickText = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')]
        .some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')]
        .filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
    };
    const tab = name => page.click(`[role="tab"][aria-label="${name}"]`);
    const seed = async state => {
      await page.evaluate(state => localStorage.setItem('papanda-storage', JSON.stringify({ state, version: 0 })), state);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[role="tab"]');
    };
    const custom = { eng: 'review-fixture', word: 'example', ru: 'Двусмысленность', count: 7, is_learned: 0,
      translations: { en: 'ambiguity', it: 'ambiguità' }, knowledge_stats: {}, show_stats: { en: 7, it: 7 } };
    const learned = Object.fromEntries(require('../src/data/words.json').map(w =>
      [w.eng || w.word, { knowledge_stats: { en: true, it: true }, is_learned: 1 }]));
    const fixture = { userWordProgress: learned, activeLanguages: ['en', 'it'], customWords: [custom] };
    await seed(fixture);
    const showsBefore = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('papanda-storage')).state.dailyShows).reduce((a, b) => a + b, 0));
    await tab('Word Triples');
    const counter = '[data-testid="word-show-count"]';
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.textContent === 'Показов слова: 8');
    const input = '[data-testid="word-association"]';
    await page.type(input, 'Два смысла');
    await page.click('[aria-label="Изменить отметку избранного"]');
    assert.equal(await page.$eval(input, el => el.value), 'Два смысла', 'Favourite must not erase the association draft');
    await clickText('✓ Выучено');
    await clickText('Вернуть предыдущее слово');
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.textContent === 'Показов слова: 9');
    assert.equal(await page.$eval(input, el => el.value), 'Два смысла');
    const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.equal(progress.userWordProgress['review-fixture'].count, 9);
    assert.equal(progress.userWordProgress['review-fixture'].is_favorite, true);
    assert.equal(Object.values(progress.dailyShows).reduce((a, b) => a + b, 0), showsBefore + 2);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 740 });
      assert.ok(await page.$eval(counter, el => {
        const rect = el.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth && rect.height > 0;
      }));
      await page.screenshot({ path: path.join(root, `review-counter-${width}.png`) });
    }
    await clickText('📊 Статистика');
    await page.waitForFunction(() => document.body.innerText.includes('9\nпоказов'));
    await clickText('Закрыть');

    // Import replaces the mounted training session, including its undo history.
    await clickText('✓ Выучено');
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
    await page.waitForFunction(() => document.querySelector('[data-testid="word-show-count"]')?.textContent === 'Показов слова: 1');
    assert.equal(await page.$eval(input, el => el.value), '');
    assert.equal(await page.$eval('[data-testid="word-tour-progress"]', el => el.textContent), 'Пройдено: 0 / 10');

    // Finishing the last due word must show a result before the empty next queue.
    await seed({ userWordProgress: {}, activeLanguages: ['en'], workoutWordCount: 1, workoutLearnedWordCount: 0,
      customWords: [{ ...custom, count: 3, show_stats: { en: 3 }, knowledge_stats: { en: false },
        last_shown: '2026-01-01T00:00:00.000Z', last_shown_by_lang: { en: '2026-01-01T00:00:00.000Z' } }] });
    await tab('Statistics');
    await clickText('Повторить сегодня');
    await clickText('Знаю');
    await page.waitForFunction(() => document.body.innerText.includes('Тренировка завершена!'));
    await page.screenshot({ path: path.join(root, 'review-workout-result.png') });
    await clickText('Отлично!');
    await page.waitForFunction(() => document.body.innerText.includes('Повторение на сегодня завершено'));

    // A delayed swipe must not answer on a hidden screen. A second action
    // during the transition must not snooze/advance the same card as well.
    const workoutFixture = { userWordProgress: {}, activeLanguages: ['en'], workoutWordCount: 1,
      workoutLearnedWordCount: 0, workoutFavoritesOnly: true, hasSeenSnoozeHint: true,
      customWords: [{ ...custom, count: 0, show_stats: {}, is_favorite: true }] };
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

    // Saving an association cannot certify a translation flagged by the AI.
    const flagged = { status: 'flagged', checkedAt: new Date().toISOString(), issues: [{ lang: 'en', issue: 'Неверный перевод' }] };
    await seed({ ...fixture, userWordProgress: { ...learned, 'review-fixture': { ai_verification: flagged } } });
    await tab('Word Triples');
    await page.click('[aria-label="Редактировать слово"]');
    await page.waitForFunction(() => document.body.innerText.includes('Редактировать слово'));
    const fields = await page.$$('textarea[placeholder="Что поможет вам запомнить это слово?"]');
    for (const field of fields) if (await field.isVisible()) await field.type('новая ассоциация');
    await clickText('Сохранить');
    state = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    assert.equal(state.userWordProgress['review-fixture'].personal_association, 'новая ассоциация');
    assert.deepEqual(state.userWordProgress['review-fixture'].ai_verification, flagged);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: counts, drafts, undo, import, last review, animation cancellation, overlapping answers, AI verdict preservation, 320/430px.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
