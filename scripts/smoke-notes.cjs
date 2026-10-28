// Focused offline checks for the note workflow, against a fresh Expo web export.
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
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.ttf': 'font/ttf', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  try {
    browser = await puppeteer.launch({ headless: true });
    page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewport({ width: 360, height: 800 });
    await page.setRequestInterception(true);
    page.on('request', req => {
      if (req.url().startsWith('http://127.0.0.1:') || /^(data|blob):/.test(req.url())) return void req.continue();
      void req.respond({ status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":"Offline check","retryable":false}' });
    });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('papanda-onboarded', '1');
      if (!localStorage.getItem('papanda-storage')) localStorage.setItem('papanda-storage', JSON.stringify({ version: 0, state: { userWordProgress: {}, activeLanguages: ['en'] } }));
      Math.random = () => 0;
      const create = URL.createObjectURL;
      URL.createObjectURL = blob => { void blob.text().then(text => { window.lastBackup = text; }); return create(blob); };
    });
    const selector = id => `[data-testid="${id}"]`;
    const click = async id => {
      const css = selector(id);
      // Native-stack keeps the trainer underneath the collection. Its preview
      // can have the same note ID; interact with the visible instance.
      await page.waitForFunction(css => [...document.querySelectorAll(css)].some(el => el.checkVisibility()), {}, css);
      const handle = await page.evaluateHandle(css => [...document.querySelectorAll(css)].find(el => el.checkVisibility()), css);
      await handle.asElement().click();
      await handle.dispose();
    };
    const text = async label => {
      await page.waitForFunction(label => [...document.querySelectorAll('[role="button"],div')].some(el => el.textContent === label && el.checkVisibility()), {}, label);
      await page.evaluate(label => [...document.querySelectorAll('[role="button"],div')].filter(el => el.textContent === label && el.checkVisibility()).at(-1).click(), label);
    };
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state);
    const waitNotes = (count, drafts) => page.waitForFunction((count, drafts) => {
      const state = JSON.parse(localStorage.getItem('papanda-storage')).state;
      return state.languageNotes?.length === count && (drafts === undefined || state.noteDrafts?.length === drafts);
    }, {}, count, drafts);
    const back = async () => {
      await page.evaluate(() => [...document.querySelectorAll('[aria-label="Назад"]')]
        .find(el => el.checkVisibility())?.click());
    };
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector(selector('trainer-notes'));
    assert.equal(await page.$(selector('sentence-notes')), null);
    const firstSentence = await page.$eval(selector('trainer-sentence-text'), el => el.textContent);
    await click('trainer-notes');
    await click('notes-create-for-source');
    await page.type(selector('note-title'), 'Моя опора');
    await page.type(selector('note-body'), 'Сначала нахожу действие, потом связываю слова.');
    await page.type(selector('note-tags'), 'разбор, моя мысль');
    await text('Вопрос');
    await text('Повторить');
    await click('note-pinned');
    await click('note-editor-back');
    await waitNotes(0, 1);
    await page.reload({ waitUntil: 'networkidle0' });
    await click('trainer-notes');
    await click('notes-folder-drafts');
    const draft = (await state()).noteDrafts[0];
    await click(`note-card-${draft.id}`);
    assert.equal(await page.$eval(selector('note-body'), el => el.value), draft.body);
    await page.screenshot({ path: path.join(root, 'notes-editor.png') });
    await click('note-save');
    await waitNotes(1, 0);
    await click('notes-folder-active');
    let note = (await state()).languageNotes[0];
    assert.equal(note.kind, 'question');
    assert.equal(note.understanding, 'review');
    assert.equal(note.pinned, true);
    assert.equal(note.sources[0].text, firstSentence);
    await page.type(selector('notes-search'), 'моя мысль');
    await click(`note-card-${note.id}`);
    await page.type(selector('note-body'), ' Дописываю мысль.');
    await click('note-editor-back');
    await click(`note-card-${note.id}`);
    assert.match(await page.$eval(selector('note-body'), el => el.value), /Дописываю мысль/);
    await click('note-discard-draft');
    await waitNotes(1, 0);
    assert.doesNotMatch((await state()).languageNotes[0].body, /Дописываю мысль/);
    await click(`note-card-${note.id}`);
    await click('note-archive');
    await click('notes-folder-archive');
    await click(`note-card-${note.id}`);
    await click('note-delete');
    await click('notes-folder-trash');
    await click(`note-card-${note.id}`);
    await click('note-editor-restore');
    await click('notes-folder-archive');
    await click(`note-card-${note.id}`);
    await click('note-archive');
    await click('notes-folder-active');
    await page.screenshot({ path: path.join(root, 'notes-collection.png') });
    await back();
    await click('trainer-next');
    await page.waitForFunction(first => document.querySelector('[data-testid="trainer-sentence-text"]').textContent !== first, {}, firstSentence);
    await click('trainer-notes');
    await click('notes-link-for-source');
    await click(`note-card-${note.id}`);
    await page.waitForFunction(id => JSON.parse(localStorage.getItem('papanda-storage')).state.languageNotes.find(n => n.id === id).sources.length === 2, {}, note.id);
    await page.screenshot({ path: path.join(root, 'notes-linked-from-top.png') });
    await back();
    assert.equal(await page.$(selector('sentence-notes')), null);

    // Token taps open the form explanation, with a separate note action.
    await click('trainer-reveal');
    await page.waitForSelector('[aria-label^="Объяснить форму слова:"]');
    await page.click('[aria-label^="Объяснить форму слова:"]');
    await click('word-create-note');
    assert.ok(await page.$eval(selector('note-example'), el => el.value));
    await page.type(selector('note-body'), 'Вопрос к слову');
    await page.setViewport({ width: 320, height: 800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= 320));
    await page.screenshot({ path: path.join(root, 'notes-narrow.png') });
    await click('note-editor-back');
    await waitNotes(1, 1);
    await page.click('[role="tab"][aria-label="Settings"]');
    await text('📤 Экспортировать прогресс');
    await page.waitForFunction(() => !!window.lastBackup);
    const backup = await page.evaluate(() => JSON.parse(window.lastBackup));
    assert.equal(backup.data.languageNotes.length, 1);
    assert.equal(backup.data.noteDrafts.length, 1);
    assert.equal(backup.data.languageNotes[0].sources.length, 2);
    assert.deepEqual(errors, []);
    console.log('Notes UI passed: create, cold-start draft, edit/cancel, pin/status, search, archive/trash/restore, multi-example link, word action, narrow layout, backup.');
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(root, 'notes-failure.png') }).catch(() => {});
      console.error(await page.$eval('body', el => el.innerText).catch(() => 'No page'));
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
