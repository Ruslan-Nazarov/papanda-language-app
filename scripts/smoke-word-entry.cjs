// Run after: npx expo export --platform web --output-dir dist-audit
// Uses an isolated browser profile and blocks external requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');

async function main() {
  const root = path.resolve(__dirname, process.argv[2] || '../dist-audit');
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
    page.on('dialog', dialog => dialog.accept());
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      return void req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline test","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => localStorage.setItem('papanda-onboarded', '1'));
    await page.setViewport({ width: 360, height: 780 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const click = async text => {
      await page.waitForFunction(text => [...document.querySelectorAll('div')].some(el => el.textContent === text && el.getBoundingClientRect().height > 0), {}, text);
      await page.evaluate(text => [...document.querySelectorAll('div')].filter(el => el.textContent === text && el.getBoundingClientRect().height > 0).at(-1).click(), text);
      await new Promise(resolve => setTimeout(resolve, 200));
    };
    const openDictionary = async () => {
      await page.waitForSelector('[role="tab"][aria-label="Word Triples"]').catch(async error => {
        console.error(await page.$eval('body', el => el.innerText));
        console.error(errors);
        throw error;
      });
      await page.click('[role="tab"][aria-label="Word Triples"]');
      await page.waitForSelector('[aria-label="Открыть словарь"]');
      await page.click('[aria-label="Открыть словарь"]');
      await page.waitForSelector('input[placeholder^="Поиск по слову"]');
    };
    const seed = async data => {
      await page.evaluate(data => localStorage.setItem('papanda-storage', JSON.stringify({ state: { userWordProgress: {}, ...data }, version: 0 })), data);
      await page.reload({ waitUntil: 'networkidle0' });
      await openDictionary();
    };
    const input = label => `input[aria-label="${label}"]`;
    const association = 'textarea[placeholder="Что поможет вам запомнить это слово?"]';
    const visibleField = async selector => {
      for (const element of await page.$$(selector)) if (await element.isVisible()) return element;
      throw new Error(`No visible field: ${selector}`);
    };
    const fill = async (selector, value) => {
      await page.click(selector);
      await page.keyboard.down('Control');
      await page.keyboard.press('A');
      await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.type(selector, value);
    };
    const search = async value => {
      await fill('input[placeholder^="Поиск по слову"]', value);
      await new Promise(resolve => setTimeout(resolve, 200));
    };
    const saved = () => page.waitForFunction(() => !document.body.innerText.includes('Новое слово') && !document.body.innerText.includes('Редактировать слово'));

    await seed({ activeLanguages: ['kz'] });
    await click('+ Добавить');
    assert.equal(await page.$$('input').then(elements => elements.length), 3); // search, Kazakh, Russian
    assert.equal(await page.$(input('Слово (English)')), null);
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Слово/Ключ'));
    await click('Сохранить');
    assert.equal((await state()).customWords.length, 0, 'An empty form must not create a word');
    await page.type(input('Слово (Қазақша)'), '  алма бағы  ');
    await page.type(input('Русский перевод'), '  яблоневый сад  ');
    await (await visibleField(association)).type('мой сад');
    assert.equal(await (await visibleField(association)).evaluate(el => el.value), 'мой сад');
    await page.screenshot({ path: path.join(root, 'word-entry-kz.png') });
    await click('Сохранить');
    await saved();
    let entry = (await state()).customWords[0];
    const key = entry.eng;
    assert.equal(entry.word, 'алма бағы');
    assert.equal(entry.ru, 'яблоневый сад');
    assert.deepEqual(entry.translations, { kz: 'алма бағы' });
    assert.equal(entry.source_language, 'kz');
    assert.ok(key.startsWith('user:kz:'));
    await search('алма бағы');
    await (await visibleField('[aria-label="Изменить отметку избранного"]')).click();
    await (await visibleField('[aria-label="Редактировать слово"]')).click();
    await page.waitForFunction(selector => document.querySelector(selector)?.value === 'алма бағы', {}, input('Слово (Қазақша)'));
    assert.equal(await page.$eval(input('Слово (Қазақша)'), el => el.value), 'алма бағы');
    await fill(input('Слово (Қазақша)'), 'жеміс бағы');
    await click('Сохранить');
    await saved();
    await page.reload({ waitUntil: 'networkidle0' });
    await openDictionary();
    await search('жеміс бағы');
    assert.ok((await page.$eval('body', el => el.innerText)).includes('🇰🇿 жеміс бағы'));
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes(key));
    assert.equal((await state()).userWordProgress[key].is_favorite, true);

    // Adding the same form again must retain its association, translation and key.
    await click('+ Добавить');
    await page.type(input('Слово (Қазақша)'), 'ЖЕМІС БАҒЫ');
    await click('Сохранить');
    await saved();
    assert.equal((await state()).customWords.length, 1);
    await (await visibleField('[aria-label="Редактировать слово"]')).click();
    await page.waitForFunction(selector => document.querySelector(selector)?.value === 'яблоневый сад', {}, input('Русский перевод'));
    assert.equal(await page.$eval(input('Русский перевод'), el => el.value), 'яблоневый сад');
    assert.equal(await (await visibleField(association)).evaluate(el => el.value), 'мой сад');
    await click('Отмена');

    // English may be selected but left empty. Only the entered language is required.
    await seed({ activeLanguages: ['en', 'kz'] });
    await click('+ Добавить');
    await page.type(input('Слово (Қазақша)'), 'алма бағы');
    await click('Сохранить');
    await saved();
    entry = (await state()).customWords[0];
    assert.equal(entry.source_language, 'kz');
    assert.equal(entry.translations.en, '');
    assert.ok((await page.$eval('body', el => el.innerText)).includes('алма бағы'));
    assert.ok(!(await page.$eval('body', el => el.innerText)).includes(entry.eng));

    // Existing English keys keep progress when their displayed translation changes.
    await seed({ activeLanguages: ['en'], customWords: [{ eng: 'legacy-key', word: 'orchard', ru: 'сад', translations: { en: 'orchard' }, count: 7, is_learned: 0, knowledge_stats: {}, show_stats: { en: 7 } }] });
    await search('orchard');
    await (await visibleField('[aria-label="Редактировать слово"]')).click();
    await fill(input('Слово (English)'), 'fruit orchard');
    await click('Сохранить');
    await saved();
    assert.equal((await state()).customWords[0].eng, 'legacy-key');
    assert.equal((await state()).userWordProgress['legacy-key'].custom_translations.en, 'fruit orchard');
    await page.reload({ waitUntil: 'networkidle0' });
    await openDictionary();
    await search('fruit orchard');
    assert.ok((await page.$eval('body', el => el.innerText)).includes('7 пок.'));

    // A disabled English language stays out of the form even for an English source.
    await seed({ activeLanguages: ['kz'], customWords: [{ eng: 'user:en:fixture', word: 'orchard', source_language: 'en', ru: 'сад', translations: { en: 'orchard', kz: 'алма бағы' }, count: 0, is_learned: 0 }] });
    await search('алма бағы');
    await (await visibleField('[aria-label="Редактировать слово"]')).click();
    await page.waitForFunction(selector => document.querySelector(selector)?.value === 'алма бағы', {}, input('Слово (Қазақша)'));
    assert.equal(await page.$(input('Слово (English)')), null);
    assert.equal(await page.$eval(input('Слово (Қазақша)'), el => el.value), 'алма бағы');
    await click('Сохранить');
    await saved();
    assert.equal((await state()).customWords[0].translations.en, 'orchard');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: Kazakh without English, empty validation, generated key, edit/reload, favourite retention, duplicates, optional English, legacy progress.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
