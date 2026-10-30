// Real browser + actual isolated runtime. Every request uses synthetic fixtures.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE } from '../helpers/people-runtime-fixture.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist');
const evidence=resolve(project,'.local-data/browser-evidence');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],reports=[];
async function fixture(width){
  const runtime=await peopleRuntimeFixture({capacity:4,mail:false});
  const imported=await runtime.app.registrationService.submitStaffRegistration({actor:runtime.users[0],sourceContactId:'synthetic-ticket-import',
    input:{fields:{name:'合成导入参会者',email:'synthetic.import@example.invalid',organization:'合成机构'},permissionReference:'synthetic-explicit-permission'}});
  assert.equal(imported.outcome,'created');
  const pending=await runtime.seedPublic({intake:'general-v2',name:'合成待审核者'});
  const headers=await runtime.login(),context=await browser.newContext({viewport:{width,height:900}});
  const [name,...value]=headers.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  let links=0,expireLink=false;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.ok([SITE,API].includes(url.origin),'no unmocked network origin');
    if(url.origin===API&&url.pathname.startsWith('/api/')){
      if(url.pathname.includes('/registration-confirmation/link/')){
        links++;
        if(expireLink)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'AUTH_REQUIRED'}})});
      }
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),
        ...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',webp:'image/webp',png:'image/png',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  async function open(){await page.goto(API+'/admin/registrations/',{waitUntil:'domcontentloaded'});await page.locator('[data-review-workspace]:visible').waitFor();await page.waitForFunction(()=>[...document.querySelectorAll('[data-review-admission-row]')].some(el=>el.dataset.admissionState==='confirmed'));}
  async function select(name){await page.locator('[data-review-rows] tr').filter({hasText:name}).getByRole('button',{name:'查看与核查'}).click();await page.locator('[data-review-dialog][open]').waitFor();}
  return{runtime,context,page,open,select,id:imported.receipt.registrationId,pending,linkCount:()=>links,expire:()=>{expireLink=true;}};
}
try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture(width),{page}=f;await f.open();
    assert.equal(await page.locator('.review-summary-table thead th').count(),4);
    assert.equal(await page.locator('.review-tools').evaluate(el=>el.open),false);
    assert.equal(await page.locator('.review-more-filters').evaluate(el=>el.open),false);
    assert.equal(await page.locator('.review-export').evaluate(el=>el.open),false);
    assert.equal(f.linkCount(),0,'listing never creates or bulk-loads private links');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.doesNotMatch(await page.locator('[data-review-rows]').innerText(),/新报名|内部建议/u);
    await page.screenshot({path:resolve(evidence,'registration-list-'+width+'.png'),fullPage:true});
    await f.select('合成导入参会者');
    assert.match(await page.locator('[data-review-admission-status]').innerText(),/已确认/u);
    assert.equal(await page.locator('[data-review-approval-actions]').isVisible(),false);
    assert.equal(await page.locator('.review-original').evaluate(el=>el.open),false);
    assert.equal(await page.locator('[data-review-form] .review-detail-group').first().evaluate(el=>el.open),false);
    await page.screenshot({path:resolve(evidence,'registration-detail-'+width+'.png'),fullPage:false});
    const before=await f.runtime.app.registrationService.repository.readIndex();
    await page.locator('[data-review-confirmation-prepare]').click();
    await page.locator('[data-review-confirmation-result]:visible').waitFor();
    const url=await page.locator('[data-review-confirmation-open]').getAttribute('href');
    assert.ok(url.startsWith(SITE+'/registration/confirmation/#r=c1.'));
    const response=await f.runtime.app.handle(new Request(API+'/api/admin/registration/confirmation',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},body:JSON.stringify({receiptToken:new URL(url).hash.slice(3)})}));
    assert.equal(response.status,200);const value=await response.json();
    assert.equal(value.attendee.name,'合成导入参会者');assert.equal(value.admission.status,'confirmed');assert.equal(value.email.status,'not_applicable');
    assert.equal(f.runtime.messages.length,0);assert.deepEqual((await f.runtime.app.registrationService.repository.readIndex()).value,before.value);
    const scope=page.locator('[data-review-form] .review-detail-group').first();await scope.locator('summary').click();
    await scope.locator('[name=internalNotes]').fill('合成备注保存后保留编辑区');await page.locator('[data-review-save]').click();
    await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    assert.equal(await scope.evaluate(el=>el.open),true,'saving keeps the current editor open');
    assert.equal(await scope.locator('[name=internalNotes]').inputValue(),'合成备注保存后保留编辑区');
    await page.screenshot({path:resolve(evidence,'registration-workflow-'+width+'.png'),fullPage:true});
    await page.locator('[data-review-dialog] [data-review-detail-close]').first().click();
    assert.equal(await page.locator('[data-review-confirmation-open]').getAttribute('href'),null);
    await f.select('合成待审核者');assert.equal(await page.locator('[data-review-ticket]').isVisible(),false);
    assert.equal(await page.locator('[data-review-approval-actions]').isVisible(),true);
    assert.equal(await page.locator('[data-review-confirmation-fallback]').inputValue(),'');
    await page.locator('[data-review-dialog] [data-review-detail-close]').first().click();
    await f.select('合成导入参会者');f.expire();await page.locator('[data-review-confirmation-prepare]').click();
    await page.locator('[data-review-login-panel]:visible').waitFor();
    assert.equal(await page.locator('[data-review-confirmation-open]').getAttribute('href'),null);
    assert.equal(await page.locator('[data-review-summary]').textContent(),'');
    assert.equal(await page.locator('[data-review-details]').textContent(),'');
    assert.equal(await page.locator('[data-review-confirmation-fallback]').inputValue(),'');
    await f.context.close();reports.push({width,compactList:true,importedConfirmedLink:true,noRegistrationOrEmail:true,internalEditorRetained:true,pendingHasNoTicket:true,sessionClearsPrivateLink:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:reports,pageErrors:errors},null,2));
}finally{await browser.close();}
