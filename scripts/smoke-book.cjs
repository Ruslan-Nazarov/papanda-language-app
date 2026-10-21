// Export to dist-book with https://smoke.invalid/v1/generate. All remote traffic is mocked.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const data = require('../src/data/book.generated.json');
async function main() {
  const root = path.resolve(__dirname, '..', process.env.BOOK_SMOKE_DIR || 'dist-book');
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + (decodeURIComponent(new URL(req.url, 'http://localhost').pathname) === '/' ? '/index.html' : decodeURIComponent(new URL(req.url, 'http://localhost').pathname)));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.html':'text/html', '.js':'application/javascript', '.ttf':'font/ttf', '.png':'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser, page;
  try {
    browser = await puppeteer.launch({ headless:true });
    page = await browser.newPage();
    await page.setViewport({ width:320, height:780 });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      const headers = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'Content-Type, X-Install-Id', 'access-control-allow-methods':'POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return void req.respond({ status:200, headers });
      requests.push(req.postData() || '');
      if ((req.postData() || '').includes('Пожалуйста, разбери')) {
        const body = JSON.parse(req.postData());
        const match = body.prompt.match(/book:\/\/(?:method|scheme|en|de|it|fr|es|ru|kz)-\d+\/[\w-]+/);
        return void req.respond({ status:200, headers, contentType:'application/json', body:JSON.stringify({ text:`**Основа предложения**\n\nСказуемое показывает действие.\n\n[Правило в книге](${match[0]})\n\n**Подробности**\n\nМорфемы в тестовом объяснении.` }) });
      }
      void req.respond({ status:503, headers, contentType:'application/json', body:'{"error":"Offline fixture","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    const click = async (text, scope = '[data-testid="book-screen"]') => {
      await page.waitForFunction((text, scope) => [...([...document.querySelectorAll(scope)].find(el => el.getBoundingClientRect().height > 0) || document).querySelectorAll('[role="button"]')].some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text, scope);
      await page.evaluate((text, scope) => [...([...document.querySelectorAll(scope)].find(el => el.getBoundingClientRect().height > 0) || document).querySelectorAll('[role="button"]')].find(el => el.textContent === text && el.getBoundingClientRect().height > 0).click(), text, scope);
    };
    const wait = () => new Promise(resolve => setTimeout(resolve, 180));
    const overflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal page overflow at 320px');
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-book-reader')).state);
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil:'networkidle0' });
    await page.waitForSelector('[data-testid="book-entry"]');
    await page.click('[data-testid="book-entry"]');
    await page.waitForSelector('[data-testid="book-library"]');
    await overflow();
    await page.screenshot({ path:path.join(root, 'book-library.png') });
    let verified = 0;
    for (const language of data.languages) {
      await click(`${language.flag} ${language.title}`);
      const chapters = data.chapters.filter(c => c.language === language.code);
      for (const chapter of chapters) {
        await page.click(`[data-testid="book-chapter-${chapter.id}"]`);
        await page.waitForSelector('[data-testid="book-reader"]');
        await page.waitForFunction(count => document.querySelectorAll('[data-testid="book-screen"] [data-testid^="book-block-"]').length === count, {}, chapter.blocks.length);
        await overflow();
        const text = await page.$eval('[data-testid="book-reader"]', el => el.innerText);
        assert.ok(text.includes('Источник: ' + chapter.sourcePath));
        assert.ok(!text.includes('<table'));
        if (chapter.number === 2 && ['en','kz','ru'].includes(language.code)) {
          await page.screenshot({ path:path.join(root, `book-${language.code}-reader.png`) });
          const toggle = await page.$('[aria-label="Показать исходную таблицу"]');
          if (toggle) { await toggle.click(); await overflow(); await page.click('[aria-label="Показать таблицу карточками"]'); }
        }
        await click('Оглавление');
        await page.waitForSelector(`[data-testid="book-chapter-${chapter.id}"]`);
        verified++;
      }
      console.log(`${language.title}: ${chapters.length} chapters rendered.`);
    }
    assert.equal(verified, 66);
    await click('🇬🇧 Английский');
    await page.type('[aria-label="Поиск в книге"]', 'начальная форма');
    await page.waitForFunction(() => document.querySelector('[data-testid="book-library"]').innerText.includes('Найдено фрагментов:'));
    const firstResult = await page.$eval('[data-testid="book-library"]', el => [...el.querySelectorAll('[role="button"]')].find(b => b.textContent.includes('начальная форма'))?.textContent);
    assert.ok(firstResult, 'Search result exists');
    await click(firstResult);
    await page.waitForSelector('[data-testid="book-reader"]'); await wait();
    const highlighted = await page.$eval('[data-testid="book-reader"]', el => [...el.querySelectorAll('[data-testid^="book-block-"]')].find(b => b.innerText.includes('начальная форма')).getBoundingClientRect().top);
    assert.ok(highlighted >= 0 && highlighted < 700, 'Search jumps to the exact source block');
    await click('☆ Закладка');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-book-reader')).state.bookmarks.length === 1);
    const bookmark = (await saved()).bookmarks[0];
    await click('Оглавление');
    await click('Закладки · 1');
    const bookmarkLink = await page.$eval('[data-testid="book-library"]', el => [...el.querySelectorAll('[role="button"]')].find(b => b.textContent.startsWith('Английский ·'))?.textContent);
    await click(bookmarkLink); await wait();
    assert.equal((await saved()).lastLocation.blockId, bookmark.blockId);
    await page.click('[aria-label="Увеличить шрифт книги"]');
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('papanda-book-reader')).state.fontSize === 18);
    await page.reload({ waitUntil:'networkidle0' });
    await page.click('[data-testid="book-entry"]');
    assert.equal((await saved()).bookmarks.length, 1);
    const continueText = await page.$eval('[data-testid="book-library"]', el => [...el.querySelectorAll('[role="button"]')].find(b => b.textContent.startsWith('Продолжить:')).textContent);
    await click(continueText); await wait();
    assert.equal((await saved()).lastLocation.blockId, bookmark.blockId);
    await page.screenshot({ path:path.join(root, 'book-search-resume.png') });
    await click('Практика этого языка');
    await page.waitForSelector('[data-testid="workshop-screen"]');
    assert.ok((await page.$eval('[data-testid="workshop-screen"]', el => el.innerText)).includes('The little boy'));
    const ruleLink = await page.$eval('[data-testid="workshop-screen"]', el => [...el.querySelectorAll('[role="button"]')].find(b => b.textContent.startsWith('Книга:'))?.textContent);
    await click(ruleLink, '[data-testid="workshop-screen"]');
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="book-reader"]')].some(el => el.getBoundingClientRect().height > 0));
    await click('Назад');
    await page.waitForSelector('[aria-label="Слово 4: reads"]');
    await page.click('[aria-label="Слово 4: reads"]');
    await click('Проверить выбор', '[data-testid="workshop-screen"]');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.structureAttempts.at(-1).hintLevel), 2, 'Reading the rule counts as assistance');
    await overflow();
    assert.deepEqual(errors, []);
    assert.ok(requests.every(body => !body.includes('Пожалуйста, разбери')), 'Offline reading never requests an AI explanation');
    await click('Назад', '[data-testid="workshop-screen"]');
    await click('Назад');
    await page.click('[data-testid="trainer-ai-explain"]');
    await page.waitForFunction(() => document.body.innerText.includes('Разобрать слова и окончания'));
    assert.ok(await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="sentence-explanation-modal"]').getBoundingClientRect();
      const close = document.querySelector('[aria-label="Закрыть объяснение"]').getBoundingClientRect();
      return close.left >= modal.left && close.right <= modal.right;
    }), 'Close button stays inside the modal at 320px');
    assert.ok(!await page.evaluate(() => document.body.innerText.includes('Морфемы в тестовом объяснении.')), 'Details start collapsed');
    assert.ok(!await page.evaluate(() => document.body.innerText.includes('Эти фрагменты переданы ИИ как источники.')), 'Source list starts collapsed');
    await click('Разобрать слова и окончания', 'body');
    assert.ok(await page.evaluate(() => document.body.innerText.includes('Морфемы в тестовом объяснении.')));
    await click('Свернуть разбор слов', 'body');
    assert.ok(!await page.evaluate(() => document.body.innerText.includes('Морфемы в тестовом объяснении.')), 'Details can be collapsed again');
    await click('Разобрать слова и окончания', 'body');
    await wait(); await wait();
    await page.screenshot({ path:path.join(root, 'book-ai-explanation.png') });
    // react-native-markdown-display renders a pressable Text, not an HTML anchor.
    await page.evaluate(() => [...document.querySelectorAll('span,a')].find(el => el.textContent === 'Правило в книге' && el.getBoundingClientRect().height > 0).click());
    await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="book-reader"]')].some(el => el.getBoundingClientRect().height > 0));
    assert.ok(requests.some(body => body.includes('BOOK_SOURCE_CONTEXT') && body.includes('Пожалуйста, разбери')));
    await overflow();
    assert.deepEqual(errors, []);
    console.log(`Book UI passed: ${verified} chapters at 320px, card/table modes, search anchor, bookmarks, resume, font size, book → practice → rule → assisted answer, layered AI explanation and clickable citation. No runtime errors.`);
  } catch (error) {
    if (page) {
      console.error('Failed screen:', (await page.$eval('body', el => el.innerText)).slice(-4000));
      await page.screenshot({ path:path.join(root, 'book-failure.png') });
    }
    throw error;
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
