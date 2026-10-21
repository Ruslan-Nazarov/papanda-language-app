// Run after exporting to dist-audit with https://smoke.invalid/v1/generate.
// Network requests never leave this browser; AI responses below are fixtures.
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
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'application/javascript','.ttf':'font/ttf'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser, page;
  try {
    browser = await puppeteer.launch({headless:true});
    page = await browser.newPage();
    await page.setViewport({width:320,height:740});
    const errors = [], requests = [], held = [];
    let hold = false;
    page.on('pageerror',e=>errors.push(e.message));
    const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'Content-Type, X-Install-Id','access-control-allow-methods':'POST, OPTIONS'};
    const annotated = {taskId:'task-1',sentence:'Birds fly.',literalTranslation:'Птицы летают.',review:{natural:true,taskFit:true,analysisReliable:true},
      words:[{text:'Birds',role:'Subject',translation:'птицы',dictionary_form:'bird'},{text:'fly',role:'Predicate',translation:'летают',dictionary_form:'fly'}].map(w=>({...w,label:'tag',parts:[w.text],clauseIndex:0})),
      markerHints:[{role:'Predicate',clauseIndex:0,explanation:'Fly — личная форма глагола, согласованная с Birds во множественном числе.',evidence:[{tokenIndex:1,form:'fly'}]}]};
    const audit=[{taskId:'task-1',natural:true,translation:true,roles:true,morphology:true,chain:true,reason:''}];
    await page.setRequestInterception(true);
    page.on('request',req=>{
      if(req.url().startsWith('http://127.0.0.1:') || req.url().startsWith('data:')) return void req.continue();
      if(req.method()==='OPTIONS') return void req.respond({status:200,headers});
      const body=req.postData() || '';
      if(body.includes('Birds fly.') && (body.includes('REVIEW_AND_ANNOTATE') || body.includes('AUDIT_SENTENCE_CARDS'))) {
        requests.push(body);
        if(hold) return void held.push(req);
        return void req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({text:JSON.stringify(body.includes('REVIEW_AND_ANNOTATE')?[annotated]:audit)})});
      }
      void req.respond({status:503,headers,contentType:'application/json',body:'{"error":"Offline test","retryable":false}'});
    });
    await page.evaluateOnNewDocument(()=>localStorage.setItem('papanda-onboarded','1'));
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle0'});
    const click = async text => {
      await page.waitForFunction(text=>[...(document.querySelector('[data-testid="workshop-screen"]') || document).querySelectorAll('[role="button"]')].some(el=>el.textContent===text && el.getBoundingClientRect().height>0),{},text);
      await page.evaluate(text=>[...(document.querySelector('[data-testid="workshop-screen"]') || document).querySelectorAll('[role="button"]')].find(el=>el.textContent===text && el.getBoundingClientRect().height>0).click(),text);
      await new Promise(resolve=>setTimeout(resolve,200));
    };
    const body=()=>page.$eval('[data-testid="workshop-screen"]',el=>el.innerText);
    const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('papanda-storage')).state);
    await click('Мастерская предложения');
    await click('🇬🇧 English');
    assert.ok(!(await body()).includes('Маленький мальчик читает книгу здесь.'));
    await page.click('[aria-label="Слово 1: The"]');
    await click('Проверить выбор');
    assert.ok((await body()).includes('Не выбрано: reads'));
    assert.ok((await body()).includes('Лишнее: The'));
    assert.equal((await state()).structureAttempts.at(-1).result,'incorrect');
    await click('Разбор спорный');
    assert.equal((await state()).structureAttempts.at(-1).result,'disputed');
    await click('Следующий шаг');
    await click('Подсказка-вопрос');
    await click('Как это найти?');
    await page.click('[aria-label="Слово 3: boy"]');
    await click('Проверить выбор');
    assert.equal((await state()).structureAttempts.at(-1).hintLevel,2);
    assert.equal((await state()).structureAttempts.at(-1).result,'correct');
    await click('Открыть перевод');
    assert.ok((await body()).includes('Маленький мальчик читает книгу здесь.'));
    await page.screenshot({path:path.join(root,'workshop-self.png')});
    await click('Развитие');
    await click('2. + Определение');
    assert.ok((await body()).includes('Было: The boy reads.'));
    assert.ok((await body()).includes('новое'));
    await click('4. + Обстоятельство');
    await page.screenshot({path:path.join(root,'workshop-chain.png')});
    await click('Языки');
    for(const text of ['The little boy reads a book here.','Der kleine Junge liest hier ein Buch.','Кішкентай бала мұнда кітап оқиды.','Puer parvus hic librum legit.']) assert.ok((await body()).includes(text),text);
    await click('Сказуемое');
    await page.screenshot({path:path.join(root,'workshop-languages.png')});
    await click('Мой текст');
    await page.type('[aria-label="Текст для чтения"]','Birds fly. Birds fly.');
    await click('Предложить границы предложений');
    assert.equal(await page.$eval('[aria-label="Текст для чтения"]',el=>el.value),'Birds fly.\nBirds fly.');
    await click('Сохранить текст с этими границами');
    assert.equal(requests.length,0,'Saving must not send text to AI');
    await click('Подготовить разбор ИИ');
    await page.waitForFunction(()=>!!document.querySelector('[aria-label="Слово 2: fly"]'));
    assert.ok(!(await body()).includes('Птицы летают.'));
    await page.click('[aria-label="Слово 2: fly"]');
    await click('Проверить выбор');
    assert.equal((await state()).structureAttempts.at(-1).result,'correct');
    assert.equal((await state()).structureAttempts.at(-1).hintLevel,0);
    assert.ok((await body()).includes('Подсказка ИИ:'));
    await click('Следующее предложение');
    assert.equal((await state()).readingTexts[0].position,1);
    hold=true;
    await click('Подготовить разбор ИИ');
    await page.waitForFunction(()=>document.body.innerText.includes('Отменить запрос'));
    await click('Отменить запрос');
    hold=false;
    for(const req of held) await req.respond({status:200,headers,contentType:'application/json',body:JSON.stringify({text:JSON.stringify([annotated])})}).catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal((await state()).readingTexts[0].cards['1'],undefined);
    await page.reload({waitUntil:'networkidle0'});
    await click('Мастерская предложения');
    await click('Мой текст');
    await click('Открыть текст');
    assert.ok((await body()).includes('Предложение 2 из 2'));
    await click('Предыдущее предложение');
    assert.ok((await body()).includes('Разбери сам'));
    await page.screenshot({path:path.join(root,'workshop-reading.png')});
    await click('Удалить текст');
    assert.equal((await state()).readingTexts.length,1);
    await click('Оставить текст');
    await click('Удалить текст');
    await click('Подтвердить удаление текста');
    assert.equal((await state()).readingTexts.length,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No horizontal page overflow');
    assert.deepEqual(errors,[]);
    console.log('Workshop smoke passed: self-analysis, hints, disputes, seven-language chains/comparison, own-text AI, cancellation, persistence and deletion at 320px.');
  } catch(error) {
    if(page){console.error((await page.$eval('body',el=>el.innerText)).slice(-6000));await page.screenshot({path:path.join(root,'workshop-failure.png')});}
    throw error;
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
