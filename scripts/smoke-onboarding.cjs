// Run after `expo export --platform web --output-dir dist-audit`.
// Exercise a real first launch: do not pre-populate the onboarding flag.
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
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser, page;
  const errors = [];
  try {
    browser = await puppeteer.launch({ headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const openFresh = async viewport => {
      if (page) await page.browserContext().close();
      const context = await browser.createBrowserContext();
      page = await context.newPage();
      await page.setViewport(viewport);
      page.on('pageerror', error => errors.push(error.message));
      await page.setRequestInterception(true);
      page.on('request', req => {
        if (req.url().startsWith(origin) || req.url().startsWith('data:')) void req.continue();
        else void req.abort();
      });
      await page.goto(origin, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.body.innerText.includes('Пропустить'));
    };
    const clickButton = async text => {
      const button = await page.waitForFunction(text => [...document.querySelectorAll('[role="button"], [tabindex="0"]')]
        .find(el => el.textContent === text), {}, text);
      const geometry = await button.evaluate(el => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { top: r.top, bottom: r.bottom, height: innerHeight, reachable: !!hit && el.contains(hit) };
      });
      assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.height && geometry.reachable,
        `${text} must be visible and clickable: ${JSON.stringify(geometry)}`);
      await button.asElement().click();
    };
    for (const viewport of [{ width: 320, height: 568 }, { width: 430, height: 932 }, { width: 1280, height: 720 }]) {
      await openFresh(viewport);
      await page.screenshot({ path: path.join(root, `onboarding-before-${viewport.width}.png`) });
      await clickButton('Далее');
      await new Promise(resolve => setTimeout(resolve, 700));
      await clickButton('Далее');
      await page.waitForFunction(() => [...document.querySelectorAll('[role="button"], [tabindex="0"]')].some(el => el.textContent === 'Начать'));
      await clickButton('Начать');
      await page.waitForSelector('[role="tab"]');
      await new Promise(resolve => setTimeout(resolve, 300));
      const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.userWordProgress);
      assert.ok(Object.keys(progress).length > 0, 'First sentence must record its dictionary words');
      assert.ok(Object.values(progress).every(word => word.count === 1), 'Count each word once per presentation');
      await new Promise(resolve => setTimeout(resolve, 500));
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.userWordProgress),
        progress, 'An idle sentence must not repeatedly increment word statistics');
      assert.equal(await page.evaluate(() => localStorage.getItem('papanda-onboarded')), '1');
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('[role="tab"]');
      await page.click('[role="tab"][aria-label="Settings"]');
      const beforeLanguageChange = await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.userWordProgress);
      // Remove the trainer's selected language while it is mounted in the background.
      const english = await page.waitForFunction(() => [...document.querySelectorAll('[tabindex="0"]')]
        .find(el => el.textContent === '🇬🇧 English✓'));
      await english.asElement().click();
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('papanda-storage')).state.activeLanguages.includes('en'));
      await new Promise(resolve => setTimeout(resolve, 400));
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('papanda-storage')).state.userWordProgress),
        beforeLanguageChange, 'A hidden trainer must not record shows after a language change');
      console.log(`Onboarding next/start/reload passed at ${viewport.width}x${viewport.height}`);
    }
    await openFresh({ width: 320, height: 568 });
    await clickButton('Пропустить');
    await page.waitForSelector('[role="tab"]');
    assert.equal(await page.evaluate(() => localStorage.getItem('papanda-onboarded')), '1');
    await openFresh({ width: 430, height: 932 });
    const pager = await page.waitForFunction(() => [...document.querySelectorAll('div')]
      .find(el => getComputedStyle(el).overflowX === 'auto' && el.scrollWidth > el.clientWidth));
    await pager.asElement().hover();
    for (let slide = 1; slide <= 2; slide++) {
      await page.mouse.wheel({ deltaX: 430, deltaY: 0 });
      await page.waitForFunction(slide => [...document.querySelectorAll('div')]
        .some(el => getComputedStyle(el).overflowX === 'auto' && Math.abs(el.scrollLeft - slide * 430) < 2), {}, slide);
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    await page.waitForFunction(() => [...document.querySelectorAll('[tabindex="0"]')]
      .some(el => el.textContent === 'Начать'), { timeout: 3000 });
    await clickButton('Начать');
    await page.waitForSelector('[role="tab"]');
    assert.deepEqual(errors, []);
    console.log('Onboarding skip and horizontal scrolling passed; no uncaught exceptions.');
  } catch (error) {
    if (page) {
      console.error('Failed screen:', await page.$eval('body', el => el.innerText));
      await page.screenshot({ path: path.join(root, 'onboarding-failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
