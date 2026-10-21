// Export with EXPO_PUBLIC_GEMINI_PROXY_URL=https://smoke.invalid/v1/generate,
// then run `expo export --platform web --output-dir dist-audit`.
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
  let page;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    await page.setViewport({ width: 430, height: 932 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Only this deterministic fixture may succeed; no external request leaves the browser.
    let pronunciationFixture = false;
    const pronunciationRequests = [];
    let holdPronunciation = false;
    let failDetailedPronunciation = false;
    const heldPronunciation = [];
    let holdGeneration = false;
    let heldGeneration = [];
    const explanationRequests = [];
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url().startsWith('http://127.0.0.1:') || request.url().startsWith('data:')) void request.continue();
      else if (holdGeneration && request.postData()?.includes('COMPOSE_SENTENCES')) { heldGeneration.push(request); }
      else if (request.postData()?.includes('Пожалуйста, разбери это предложение')) {
        explanationRequests.push(JSON.parse(request.postData()).prompt);
        void request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ text: `Объяснение фразы №${explanationRequests.length}` }) });
      }
      else if (pronunciationFixture && request.postData()?.includes('объясни правила произношения')) {
        const detailed = request.postData().includes('Ты опытный фонетист');
        pronunciationRequests.push(detailed ? 'detailed' : 'short');
        if (holdPronunciation && detailed) { heldPronunciation.push(request); return; }
        if (failDetailedPronunciation && detailed) {
          void request.respond({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({ error: 'Не удалось загрузить подробный разбор', retryable: false }) });
          return;
        }
        void request.respond({ status: 200, contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ text: detailed
            ? '**Подробный тест произношения**\nТранскрипция: /neɪm/. Последняя e не читается.'
            : '**Тест произношения → нэ́йм**\n«Эй» — как в русском «эй!». Последняя e не читается.' }) });
      } else if (request.method() === 'OPTIONS') {
        void request.respond({ status: 200, headers: { 'access-control-allow-origin': '*',
          'access-control-allow-headers': 'Content-Type, X-Install-Id', 'access-control-allow-methods': 'POST, OPTIONS' } });
      } else void request.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline smoke test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => { localStorage.setItem('papanda-onboarded', '1'); });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[role="tab"]');
    const tabs = await page.$$eval('[role="tab"]', elements => elements.map(element => ({ label: element.getAttribute('aria-label'), text: element.textContent })));
    console.log('Tabs:', JSON.stringify(tabs));
    console.log('Screen:', (await page.$eval('body', body => body.innerText)).slice(0, 900));
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(tabs.length, 5);
    for (const width of [320, 430]) {
      await page.setViewport({ width, height: 740 });
      const center = await page.$eval('[role="tab"][aria-label="Sentence Trainer"]', el => {
        const rect = el.getBoundingClientRect();
        return Math.abs(rect.left + rect.width / 2 - innerWidth / 2);
      });
      assert.ok(center < 2, 'Sentence trainer must be centered');
    }
    for (let index = 0; index < tabs.length; index++) {
      const elements = await page.$$('[role="tab"]');
      await elements[index].click();
      await page.waitForFunction(() => !document.body.innerText.includes('Что-то пошло не так'));
      if (index === 3) {
        await page.waitForFunction(() => document.body.innerText.includes('Нажмите на карточку, чтобы увидеть перевод'));
        await page.evaluate(() => {
          const hint = [...document.querySelectorAll('div')].find(element => element.textContent === 'Нажмите на карточку, чтобы увидеть перевод');
          hint.click();
        });
        await page.waitForSelector('[aria-label="Разбор произношения"]');
        for (const width of [320, 430]) {
          await page.setViewport({ width, height: 932 });
          const separated = await page.$eval('[aria-label="Разбор произношения"]', button => {
            const text = button.previousElementSibling.getBoundingClientRect();
            const icon = button.getBoundingClientRect();
            return text.right <= icon.left && icon.right <= innerWidth;
          });
          assert.ok(separated, `Pronunciation overlaps translation at ${width}px`);
        }
        await page.screenshot({ path: path.join(root, 'workout-layout.png') });
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('[role="tab"]');
    assert.equal(errors.length, 0, errors.join('\n'));
    const clickText = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')]
        .some(el => el.textContent.trim() === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')]
        .find(el => el.textContent.trim() === text && el.getBoundingClientRect().height > 0).click(), text);
      await new Promise(resolve => setTimeout(resolve, 350));
    };
    const openEditor = async action => {
      await page.click('[data-testid="sentence-options"]');
      // Menu buttons include a decorative icon before the label.
      await page.waitForFunction(action => [...document.querySelectorAll('div')]
        .some(el => el.textContent.endsWith(action) && el.getBoundingClientRect().height > 0), {}, action);
      await page.evaluate(action => [...document.querySelectorAll('div')]
        .filter(el => el.textContent.endsWith(action) && el.getBoundingClientRect().height > 0)
        .sort((a,b) => a.textContent.length-b.textContent.length)[0].click(), action);
      await page.waitForSelector('[placeholder="Введите предложение"]', { visible: true });
    };
    const storedSentences = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.customSentences);
    await page.click('[role="tab"][aria-label="Sentence Trainer"]');
    const before = await storedSentences();
    await openEditor('Добавить');
    await page.type('[placeholder="Введите предложение"]', 'Birds sing');
    await clickText('Разбить на слова (Сброс)');
    await clickText('Отмена');
    assert.deepEqual(await storedSentences(), before, 'Cancel must not persist a draft');
    await openEditor('Добавить');
    assert.equal(await page.$eval('[placeholder="Введите предложение"]', el => el.value), '');
    await page.type('[placeholder="Введите предложение"]', 'Birds sing');
    await clickText('Разбить на слова (Сброс)');
    await page.type('[placeholder="Перевод"]', 'Птицы');
    await clickText('Сохранить');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-storage')).state.customSentences.some(s => s.sentence === 'Birds sing'));
    const created = (await storedSentences()).find(s => s.sentence === 'Birds sing');
    assert.equal(created.words.length, 2);
    assert.equal(created.words[0].translation, 'Птицы');
    await page.click('[data-testid="trainer-ai-explain"]');
    await page.waitForFunction(() => document.body.innerText.includes('Объяснение фразы №1'));
    await page.click('[aria-label="Закрыть объяснение"]');
    await openEditor('Изменить');
    assert.equal(await page.$eval('[placeholder="Введите предложение"]', el => el.value), 'Birds sing');
    await page.focus('[placeholder="Введите предложение"]');
    await page.keyboard.press('End');
    await page.type('[placeholder="Введите предложение"]', ' softly');
    await clickText('Разбить на слова (Сброс)');
    await clickText('Сохранить');
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('papanda-storage')).state.customSentences.some(s => s.id === id && s.words.length === 3), {}, created.id);
    assert.equal((await storedSentences()).length, before.length + 1);
    await page.click('[data-testid="trainer-ai-explain"]');
    await page.waitForFunction(() => document.body.innerText.includes('Объяснение фразы №2'));
    assert.equal(explanationRequests.length, 2, 'Editing the same card must invalidate its AI explanation');
    assert.ok(explanationRequests[1].includes('Birds sing softly'));
    await page.click('[aria-label="Закрыть объяснение"]');
    await page.reload({ waitUntil: 'networkidle0' });
    assert.equal((await storedSentences()).find(s => s.id === created.id).sentence, 'Birds sing softly');
    await page.click('[role="tab"][aria-label="Word Triples"]');
    await clickText('📖');
    await page.waitForFunction(() => document.body.innerText.includes('Словарь ('));
    await clickText('←');
    await page.waitForSelector('[role="tab"]');
    pronunciationFixture = true;
    await clickText('📢');
    await page.waitForSelector('[data-testid="pronunciation-close"]', { visible: true });
    // A bundle without a proxy URL cannot call the AI fixture.
    const hasProxy = await page.waitForFunction(() => document.body.innerText.includes('Тест произношения'), { timeout: 3000 }).then(() => true, () => false);
    if (hasProxy) {
      assert.deepEqual(pronunciationRequests, ['short'], 'Details must load only on request');
      for (const width of [320, 430]) {
        await page.setViewport({ width, height: 740 });
        assert.ok(await page.$eval('[data-testid="pronunciation-mode-detailed"]', el => el.getBoundingClientRect().right <= innerWidth));
      }
      await page.screenshot({ path: path.join(root, 'pronunciation-modal.png') });
      await page.click('[data-testid="pronunciation-mode-detailed"]');
      await page.waitForFunction(() => document.body.innerText.includes('Подробный тест произношения'));
      await page.click('[data-testid="pronunciation-mode-short"]');
      await page.waitForFunction(() => document.body.innerText.includes('Тест произношения → нэ́йм'));
      await page.click('[data-testid="pronunciation-mode-detailed"]');
      assert.deepEqual(pronunciationRequests, ['short', 'detailed'], 'Switching back must reuse both answers');
      await page.click('[data-testid="pronunciation-close"]');
      await clickText('📢');
      await page.waitForFunction(() => document.body.innerText.includes('Тест произношения → нэ́йм'));
      assert.equal(await page.$eval('[data-testid="pronunciation-mode-short"]', el => el.getAttribute('aria-selected')), 'true');
      failDetailedPronunciation = true;
      await page.click('[data-testid="pronunciation-mode-detailed"]');
      await page.waitForSelector('[data-testid="pronunciation-retry"]');
      failDetailedPronunciation = false;
      await page.click('[data-testid="pronunciation-retry"]');
      await page.waitForFunction(() => document.body.innerText.includes('Подробный тест произношения'));
      await page.click('[data-testid="pronunciation-close"]');
      await clickText('📢');
      await page.waitForFunction(() => document.body.innerText.includes('Тест произношения → нэ́йм'));
      holdPronunciation = true;
      const pendingDetails = page.waitForRequest(request => request.postData()?.includes('Ты опытный фонетист'));
      await page.click('[data-testid="pronunciation-mode-detailed"]');
      await pendingDetails;
      assert.equal(heldPronunciation.length, 1);
      await page.waitForFunction(() => document.body.innerText.includes('Готовим подробный разбор'));
      // Return to the cached short answer while details are still pending.
      await page.click('[data-testid="pronunciation-mode-short"]');
      await page.waitForFunction(() => document.body.innerText.includes('Тест произношения → нэ́йм'));
      holdPronunciation = false;
      for (const request of heldPronunciation.splice(0)) {
        await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ text: 'Поздний подробный ответ' }) }).catch(() => {});
      }
      await page.waitForNetworkIdle({ idleTime: 100 });
      assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Поздний подробный ответ'));
      holdPronunciation = true;
      const detailsBeforeClose = page.waitForRequest(request => request.postData()?.includes('Ты опытный фонетист'));
      await page.click('[data-testid="pronunciation-mode-detailed"]');
      await detailsBeforeClose;
      await page.click('[data-testid="pronunciation-close"]');
      holdPronunciation = false;
      for (const request of heldPronunciation.splice(0)) {
        await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ text: 'Ответ после закрытия' }) }).catch(() => {});
      }
      await clickText('📢');
      await page.waitForFunction(() => document.body.innerText.includes('Тест произношения → нэ́йм'));
      await page.waitForNetworkIdle({ idleTime: 100 });
      assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Ответ после закрытия'));
      await page.click('[data-testid="pronunciation-close"]');
    } else {
      throw new Error('Build smoke bundle with EXPO_PUBLIC_GEMINI_PROXY_URL=https://smoke.invalid/v1/generate to exercise pronunciation');
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Editor create/cancel/edit/reload, dictionary navigation and pronunciation fixture passed.');
    // Card reporting and hiding have been removed from the UI.
    await page.click('[role="tab"][aria-label="Sentence Trainer"]');
    await page.click('[data-testid="sentence-options"]');
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Сообщить об ошибке'));
    await page.click('[aria-label="Закрыть меню"]');
    await page.click('[role="tab"][aria-label="Settings"]');
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Карточки с замечаниями'));

    // File preview is read-only; a committed import can be undone after reload.
    const previous = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const imported = { ...previous, workoutWordCount: 20, activeLanguages: ['en'], customSentences: [],
      userWordProgress: { book: { count: 2, show_stats: { en: 2 }, knowledge_stats: { en: false }, last_shown_by_lang: { en: '2020-01-01' } } } };
    const fixturePath = path.join(root, 'smoke-backup.json');
    fs.writeFileSync(fixturePath, JSON.stringify({ app: 'papanda', version: 1, data: imported }));
    const chooseBackup = async () => {
      const chooserPromise = page.waitForFileChooser();
      await clickText('📥 Импортировать прогресс');
      await (await chooserPromise).accept([fixturePath]);
      await page.waitForFunction(() => document.body.innerText.includes('Проверка резервной копии'));
      await new Promise(resolve => setTimeout(resolve, 350));
    };
    await chooseBackup();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.workoutWordCount), previous.workoutWordCount);
    await clickText('Отмена');
    await chooseBackup();
    await page.screenshot({ path: path.join(root, 'backup-preview.png') });
    await clickText('Заменить прогресс');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-storage')).state.workoutWordCount === 20);
    await page.click('[role="tab"][aria-label="Statistics"]');
    await clickText('Повторить сегодня');
    await page.waitForFunction(() => document.body.innerText.includes('План на сегодня'));
    assert.ok((await page.$eval('body', el => el.innerText)).includes('book'));
    await page.screenshot({ path: path.join(root, 'review-plan.png') });
    await clickText('План на сегодня · Вернуться к обычной тренировке');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('[role="tab"][aria-label="Settings"]');
    await clickText('↩ Вернуть состояние до импорта');
    await clickText('Восстановить');
    await page.waitForFunction(count => JSON.parse(localStorage.getItem('papanda-storage')).state.workoutWordCount === count, {}, previous.workoutWordCount);
    assert.deepEqual(await storedSentences(), previous.customSentences);

    // Hold an AI request until the learner cancels; no response can enter storage.
    await page.click('[role="tab"][aria-label="Sentence Trainer"]');
    const generatedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.generatedSentences);
    holdGeneration = true;
    await page.click('[data-testid="sentence-options"]');
    await page.evaluate(() => [...document.querySelectorAll('div')].filter(el => el.textContent.endsWith('Сгенерировать ещё (ИИ)') && el.getBoundingClientRect().height > 0).sort((a,b) => a.textContent.length-b.textContent.length)[0].click());
    await page.click('[data-testid="sentence-options"]');
    await clickText('Отменить генерацию');
    await page.waitForFunction(() => document.body.innerText.includes('Генерация отменена'));
    holdGeneration = false;
    for (const request of heldGeneration) await request.respond({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"text":"[]"}' }).catch(() => {});
    heldGeneration = [];
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.generatedSentences), generatedBefore);
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Report UI removal, import preview/cancel/restore, review plan and AI cancellation passed.');
    // Every language has offline cards, and the seven-language word card can scroll.
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('papanda-storage'));
      saved.state.activeLanguages = ['en', 'it', 'es', 'de', 'fr', 'kz', 'la'];
      localStorage.setItem('papanda-storage', JSON.stringify(saved));
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.click('[role="tab"][aria-label="Sentence Trainer"]');
    for (const label of ['🇬🇧 English', '🇮🇹 Italiano', '🇪🇸 Español', '🇩🇪 Deutsch', '🇫🇷 Français', '🇰🇿 Қазақша', '🏛️ Latin']) {
      await clickText(label);
      await page.waitForSelector('[data-testid="sentence-options"]', { visible: true });
      assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Пока нет предложений'), label);
    }
    await page.click('[role="tab"][aria-label="Word Triples"]');
    await page.setViewport({ width: 320, height: 740 });
    await page.$eval('[data-testid="words-scroll"]', el => { el.scrollTop = el.scrollHeight; });
    assert.ok(await page.$eval('[data-testid="words-scroll"]', el => el.scrollTop > 0));
    await page.screenshot({ path: path.join(root, 'words-all-languages.png') });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('All seven offline languages and long-card scrolling passed.');
    await page.evaluate(() => localStorage.setItem('papanda-storage', 'broken-json'));
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('Не удалось прочитать сохранённый прогресс'));
    assert.equal(await page.evaluate(() => localStorage.getItem('papanda-storage')), 'broken-json');
    console.log('Web smoke passed: 5 symmetric tabs, non-overlapping pronunciation, corrupt storage preserved; no uncaught exceptions.');
  } catch (error) {
    if (page) {
      console.error('Failed screen:', (await page.$eval('body', body => body.innerText)).slice(-5000));
      await page.screenshot({ path: path.join(root, 'smoke-failure.png') });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
