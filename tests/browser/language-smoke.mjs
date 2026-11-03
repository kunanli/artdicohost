// Local compiled assets and synthetic API only. No real platform or business writes.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInitialContent} from '../../src/config/content.mjs';
import {toPublicContent} from '../../shared/content-schema.mjs';
import {peopleRuntimeFixture} from '../helpers/people-runtime-fixture.mjs';
import {PUBLIC_REGISTRATION_URL} from '../../src/config/event.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/language');
const SITE='https://artdico.host',API='https://api.artdico.host',reports=[],errors=[];
const content=toPublicContent(createInitialContent());content.organizations=[];content.showcases=[];
const mime=path=>({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.avif':'image/avif'})[extname(path)]||'application/octet-stream';
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
await mkdir(evidence,{recursive:true});
async function fixture({width=390,locale='en-US',saved=null,storageBlocked=false,javaScriptEnabled=true}={}){
  const runtime=await peopleRuntimeFixture({capacity:300});
  const context=await browser.newContext({viewport:{width,height:940},locale,javaScriptEnabled,reducedMotion:'reduce'});
  await context.addInitScript(({saved,storageBlocked})=>{
    if(storageBlocked)for(const method of ['getItem','setItem'])Object.defineProperty(Storage.prototype,method,{value(){throw new Error('SYNTHETIC_STORAGE_BLOCKED');}});
    else if(saved&&!sessionStorage.getItem('language-seeded')){localStorage.setItem('artdico-language',saved);sessionStorage.setItem('language-seeded','true');}
  },{saved,storageBlocked});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    assert.equal(request.method(),'GET','viewing, switching and invalid forms never submit');
    if(url.origin===API){
      if(url.pathname==='/api/public/content')return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':SITE},body:JSON.stringify({revision:1,publishedAt:'2026-11-03T00:00:00Z',content})});
      const response=await runtime.app.handle(new Request(request.url(),{headers:await request.allHeaders()}));
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    assert.equal(url.origin,SITE,'all network is intercepted first-party');
    if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
    const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({contentType:mime(file),body:await readFile(file)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(SITE+'/',{waitUntil:'networkidle'});
  await page.evaluate(()=>document.fonts.ready);
  return {context,page};
}
async function language(page,value){await page.waitForFunction(value=>document.documentElement.lang===value,value);}
try{
  for(const width of [320,390,1440,1920]){
    const {context,page}=await fixture({width});
    try{
      await language(page,'en');
      assert.equal(await page.locator('#agenda-heading').textContent(),'Schedule');
      assert.match(await page.title(),/China Meetup/);
      assert.equal(await page.locator('[data-home-title-fallback]').first().isVisible(),true);
      assert.equal(await page.locator('[data-home-title-image]').first().isVisible(),false);
      assert.equal(await page.locator('[data-general-registration]').first().getAttribute('href'),PUBLIC_REGISTRATION_URL);
      assert.equal(await page.locator('#field-name').getAttribute('name'),'name');
      await page.locator('#field-name').fill('合成姓名');
      await page.locator('#field-email').fill('synthetic@example.invalid');
      await page.locator('#field-categories').selectOption('student');
      await page.locator('#field-speaker-topic').fill('合成主题');
      await page.locator('[data-language="zh-CN"]').click();await language(page,'zh-CN');
      assert.equal(await page.locator('#agenda-heading').textContent(),'活动日程');
      assert.equal(await page.locator('#field-name').inputValue(),'合成姓名');
      assert.equal(await page.locator('#field-categories').inputValue(),'student');
      await page.locator('[data-language="en"]').click();await language(page,'en');
      assert.equal(await page.locator('#field-name').inputValue(),'合成姓名');
      assert.equal(await page.locator('#field-speaker-topic').inputValue(),'合成主题');
      assert.equal(await page.locator('[data-language="en"]').getAttribute('aria-pressed'),'true');
      // Asynchronous publication/receipt text changes must be localized too.
      await page.evaluate(()=>{document.querySelector('[data-public-content-status]').textContent='本次活动已取消。';});
      await page.waitForFunction(()=>document.querySelector('[data-public-content-status]').textContent==='This event has been cancelled.');
      await page.locator('[data-language="zh-CN"]').click();
      assert.equal(await page.locator('[data-public-content-status]').textContent(),'本次活动已取消。');
      await page.locator('[data-language="en"]').click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no page overflow');
      const header=await page.locator('[data-home-header]').evaluate(el=>{const boxes=[...el.children].filter(n=>getComputedStyle(n).display!=='none'&&n.getAttribute('aria-hidden')!=='true').map(n=>n.getBoundingClientRect());return boxes.every((b,i)=>b.x>=0&&b.right<=innerWidth+1&&boxes.slice(i+1).every(c=>b.right<=c.x+1||c.right<=b.x+1));});assert.equal(header,true,'header controls fit without overlap');
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      await page.screenshot({path:resolve(evidence,`english-${width}.png`),fullPage:true});
      // Native validation messages remain readable, no request is sent.
      await page.locator('#field-name').fill('');
      await page.locator('[data-submit]').click();
      await page.waitForFunction(()=>document.querySelector('[data-form-error]').textContent.startsWith('Please check'));
      assert.equal(await page.locator('[data-error-for="name"]').textContent(),'Please enter a name of at least two characters.');
      const unknown=await page.evaluate(()=>{const p=document.createElement('p');p.textContent='合成编辑内容不猜译';p.dataset.i18nPreserve='';document.querySelector('main').append(p);return p.textContent;});assert.equal(unknown,'合成编辑内容不猜译');
      reports.push({width,language:'en',inputsPreserved:true,dynamicCopy:true,noOverflow:true,invalidSubmissionOnly:true});
    }finally{await context.close();}
  }
  for(const scenario of [
    {locale:'zh-TW',expected:'zh-CN'},
    {locale:'en-GB',saved:'zh-CN',expected:'zh-CN'},
    {locale:'zh-CN',saved:'en',expected:'en'},
    {locale:'ja-JP',expected:'en'},
    {locale:'en-US',storageBlocked:true,expected:'en'},
    {locale:'en-US',javaScriptEnabled:false,expected:'zh-CN'},
  ]){
    const {context,page}=await fixture(scenario);
    try{
      await language(page,scenario.expected);
      if(scenario.javaScriptEnabled!==false){
        const opposite=scenario.expected==='en'?'zh-CN':'en';await page.locator(`[data-language="${opposite}"]`).click();await language(page,opposite);
        if(scenario.storageBlocked){await page.evaluate(()=>window.dispatchEvent(new Event('languagechange')));await language(page,opposite);}
        else{await page.reload({waitUntil:'networkidle'});await language(page,opposite);}
      }else assert.equal(await page.locator('[data-language-switch]').isVisible(),false);
      reports.push({scenario,passed:true});
    }finally{await context.close();}
  }
  assert.deepEqual(errors,[]);
  const report={ok:true,cases:reports.length,htmlSha256:createHash('sha256').update(await readFile(resolve(dist,'index.html'))).digest('hex'),reports,pageErrors:0,allRequestsIntercepted:true,businessWrites:0};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
}finally{await browser.close();}
