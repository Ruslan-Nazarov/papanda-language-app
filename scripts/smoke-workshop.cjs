// Run after exporting to dist-audit with https://smoke.invalid/v1/generate.
// Network requests never leave this browser; AI responses below are fixtures.
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
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser, page;
  try {
    browser = await puppeteer.launch({headless:true});
    page = await browser.newPage();
    await page.setViewport({width:320,height:740});
    const errors = [];
    page.on('pageerror',e=>errors.push(e.message));
    const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, X-Install-Id','access-control-allow-methods':'POST, OPTIONS'};
    await page.setRequestInterception(true);
    page.on('request',req=>{
      if(req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      if(req.method()==='OPTIONS') return void req.respond({status:200,headers});
      void req.respond({status:503,headers,contentType:'application/json',body:'{"error":"Offline test","retryable":false}'});
    });
    await page.evaluateOnNewDocument(()=>localStorage.setItem('papanda-onboarded','1'));
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
    const click = async text => {
      await page.waitForFunction(text=>[...(document.querySelector('[data-testid="workshop-screen"]') || document).querySelectorAll('[role="button"]')].some(el=>(el.textContent===text || el.getAttribute('aria-label')===text) && el.getBoundingClientRect().height>0),{},text);
      await page.evaluate(text=>[...(document.querySelector('[data-testid="workshop-screen"]') || document).querySelectorAll('[role="button"]')].find(el=>(el.textContent===text || el.getAttribute('aria-label')===text) && el.getBoundingClientRect().height>0).click(),text);
      await new Promise(resolve=>setTimeout(resolve,200));
    };
    const body=()=>page.$eval('[data-testid="workshop-screen"]',el=>el.innerText);
    await page.click('[data-testid="sentence-options"]');
    await page.waitForSelector('[data-testid="trainer-cache-stats"]', { visible: true });
    await page.click('[data-testid="growing-sentence-entry"]');
    await page.waitForSelector('[data-testid="workshop-screen"]');
    assert.ok((await body()).includes('От короткого к полному'));
    assert.ok((await body()).includes('Предложение по нарастающей'));
    await click('🇬🇧 English · изменить');
    await click('🇬🇧 English');
    assert.ok((await body()).includes('The boy reads.'));
    await click('2. + Определение');
    assert.ok((await body()).includes('Было: The boy reads.'));
    await click('Что добавилось?');
    assert.ok((await body()).includes('новое'));
    await click('4. + Обстоятельство');
    await page.screenshot({path:path.join(root,'workshop-chain.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow');
    assert.deepEqual(errors,[]);
    console.log('Workshop smoke passed: growing sentence series and step progression at 320px.');
  } catch(error) {
    if(page){console.error((await page.$eval('body',el=>el.innerText)).slice(-6000));await page.screenshot({path:path.join(root,'workshop-failure.png')});}
    throw error;
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
