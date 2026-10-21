// Native IndexedDB + actual isolated runtime. Every HTTP request is intercepted.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as API,PEOPLE_FIXTURE_PUBLIC as SITE} from '../helpers/people-runtime-fixture.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const reports=[],errors=[];const report=reports.push.bind(reports);reports.push=value=>{console.log('passed '+JSON.stringify(value));return report(value);};
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':SITE}});
async function fixture({width=390,lostAck=false}={}){
  const runtime=await peopleRuntimeFixture({mail:false}),context=await browser.newContext({viewport:{width,height:900}}),calls=[];
  let lose=lostAck,closed=false,privacyChanged=false,rejectNext=false,cleanupFail=false,rejectionFail=false,submitGate=null,releaseSubmit=null;
  await context.addCookies([{domain:new URL(API).hostname,path:'/',name:'synthetic_staff',value:'DO_NOT_SEND',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.addInitScript(()=>{
    const put=IDBObjectStore.prototype.put,remove=IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.put=function(...args){
      if(window.syntheticQuota||window.syntheticRejectQuota&&args[0]?.kind==='editing')throw new DOMException('Synthetic quota','QuotaExceededError');
      return put.apply(this,args);
    };
    IDBObjectStore.prototype.delete=function(...args){if(window.syntheticCleanupQuota)throw new DOMException('Synthetic cleanup quota','QuotaExceededError');return remove.apply(this,args);};
    const descriptor=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');
    Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...descriptor,set(callback){descriptor.set.call(this,function(event){if(window.syntheticHoldAck&&this.mode==='readwrite'){window.syntheticAckQueue??=[];window.syntheticAckQueue.push(()=>callback.call(this,event));}else if(window.syntheticHoldRead&&this.mode==='readonly'&&this.objectStoreNames.length===3){window.syntheticReadQueue??=[];window.syntheticReadQueue.push(()=>callback.call(this,event));}else callback.call(this,event);});}});
  });
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.ok([SITE,API].includes(url.origin),'all network origins intercepted');
    if(url.origin===API&&path.startsWith('/api/')){
      const headers=await request.allHeaders(),entry={path,method:request.method(),body:request.postData(),headers};calls.push(entry);
      if(path.startsWith('/api/admin/registration/')||path.startsWith('/api/public/'))assert.equal(headers.cookie,undefined);
      if(path.endsWith('/registration/submit')&&rejectNext){rejectNext=false;if(rejectionFail)await request.frame().evaluate(()=>{window.syntheticRejectQuota=true;});return route.fulfill(json({error:{code:'INVALID_FIELDS'}},422));}
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers,...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
      let body=Buffer.from(await response.arrayBuffer());
      if(path.endsWith('/registration/config')&&(closed||privacyChanged)){
        const value=JSON.parse(body);if(closed){value.enabled=false;value.reason='closed';}if(privacyChanged)value.privacy.version='synthetic-people-notice-v2';
        return route.fulfill(json(value,response.status));
      }
      if(path.endsWith('/registration/submit')){
        if(submitGate)await submitGate;
        if(cleanupFail)await route.request().frame().evaluate(()=>{window.syntheticCleanupQuota=true;});
        if(rejectionFail)await route.request().frame().evaluate(()=>{window.syntheticRejectQuota=true;});
        if(lose){lose=false;return route.fulfill(json({error:{code:'UNAVAILABLE'}},503));}
      }
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  async function newPage(){const page=await context.newPage();page.setDefaultTimeout(10000);await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));page.on('pageerror',error=>errors.push(error.message));return page;}
  const page=await newPage();
  return{runtime,context,page,calls,newPage,close:()=>context.close(),closed:()=>{closed=true;privacyChanged=true;},reject:()=>{rejectNext=true;},failCleanup:()=>{cleanupFail=true;},failRejection:()=>{rejectionFail=true;rejectNext=true;},holdSubmit:()=>{submitGate=new Promise(resolve=>{releaseSubmit=resolve;});},releaseSubmit:()=>{releaseSubmit?.();submitGate=null;}};
}
const form=page=>page.locator('[data-registration-form]');
async function open(page){await page.goto(SITE+'/#registration',{waitUntil:'domcontentloaded'});await form(page).locator('[data-application-draft-status]').filter({hasText:/已就绪|已恢复|待核对/u}).waitFor();await form(page).locator('[data-submit]:enabled').waitFor();return form(page);}
async function nativeRecords(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').getAll();read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};}));}
async function waitForRecord(page,test){for(let count=0;count<300;count++){const records=await nativeRecords(page);if(test(records))return records;await page.waitForTimeout(20);}assert.fail('native IndexedDB record did not reach expected state');}
async function fill(page,name='合成本机申请人'){const f=form(page);await f.locator('[name=name]').fill(name);await f.locator('[name=email]').fill('synthetic.draft@example.invalid');await f.locator('[name=categories]').selectOption('student');await f.locator('[name=consentAccepted]').check();}
async function reloadAllowed(page){let dialogs=0;const onDialog=async dialog=>{dialogs++;await dialog.accept();};page.on('dialog',onDialog);await page.reload({waitUntil:'domcontentloaded'});await form(page).locator('[data-application-draft-status]').filter({hasText:/已就绪|已恢复|待核对/u}).waitFor();page.off('dialog',onDialog);return dialogs;}
async function blockedReload(page){const dialogEvent=page.waitForEvent('dialog'),navigation=page.reload({waitUntil:'domcontentloaded'}).catch(()=>null);const dialog=await dialogEvent;assert.equal(dialog.type(),'beforeunload');await dialog.dismiss();await navigation;}
const submits=f=>f.calls.filter(call=>call.path.endsWith('/registration/submit'));
try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture({width});await open(f.page);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(f.calls.some(call=>call.method==='POST'),false);await f.close();reports.push({width,nativeDraftReady:true,noServerWrite:true});
  }
  {
    const f=await fixture();await open(f.page);await fill(f.page);await form(f.page).locator('details.ah-general-extra').evaluate(element=>{element.open=true;});await form(f.page).locator('[name=organization]').fill('合成院校');
    await form(f.page).locator('[data-proposal-toggle]').check();await form(f.page).locator('[name="speaker.topic"]').fill('合成主题');await form(f.page).locator('[name="speaker.summary"]').fill('合成摘要');
    const records=await waitForRecord(f.page,rows=>rows[0]?.value.summary==='合成摘要');assert.equal(records[0].kind,'editing');assert.equal(Object.hasOwn(records[0].value,'consentAccepted'),false);assert.doesNotMatch(JSON.stringify(records),/submissionToken|receiptToken|DO_NOT_SEND/u);
    assert.equal(await reloadAllowed(f.page),0,'durably saved editing reload needs no warning');assert.equal(await form(f.page).locator('[name=name]').inputValue(),'合成本机申请人');assert.equal(await form(f.page).locator('[name=organization]').inputValue(),'合成院校');assert.equal(await form(f.page).locator('[name="speaker.summary"]').inputValue(),'合成摘要');assert.equal(await form(f.page).locator('[name=consentAccepted]').isChecked(),false);assert.equal(submits(f).length,0);
    await form(f.page).locator('[data-application-draft-clear]').click();await waitForRecord(f.page,rows=>rows.length===0);assert.equal(await form(f.page).locator('[name=name]').inputValue(),'');await f.close();reports.push({editingRefresh:true,consentNeverRestored:true,explicitClearEditing:true,noCredentialsStored:true});
  }
  {
    const f=await fixture();await open(f.page);await form(f.page).locator('[name=name]').fill('合成立即刷新末字');assert.match(await form(f.page).locator('[data-application-draft-status]').textContent(),/暂存/u);await blockedReload(f.page);assert.equal(await form(f.page).locator('[name=name]').inputValue(),'合成立即刷新末字');await waitForRecord(f.page,rows=>rows[0]?.value.name==='合成立即刷新末字');assert.equal(await reloadAllowed(f.page),0);await f.close();reports.push({immediateReloadWarnsUntilDurableAck:true,savedDraftReloadDoesNotWarn:true});
  }
  {
    const f=await fixture({lostAck:true});await open(f.page);await fill(f.page,'合成未知提交');await form(f.page).locator('[data-submit]').click();await form(f.page).locator('[data-submit]').filter({hasText:/再次确认/u}).waitFor();const original=submits(f)[0],pending=(await nativeRecords(f.page))[0];assert.equal(pending.kind,'pending_submission');assert.equal(pending.value.uncertain,true);assert.equal(await form(f.page).locator('[data-application-draft-clear]').isVisible(),false);f.closed();
    assert.equal(await reloadAllowed(f.page),1,'unknown application warns before leaving');assert.equal(submits(f).length,1);assert.equal(await form(f.page).locator('[name=name]').isDisabled(),true);assert.equal(await form(f.page).locator('[name=consentAccepted]').isChecked(),false);assert.equal(await form(f.page).locator('[data-application-draft-clear]').isVisible(),false);await form(f.page).locator('[data-submit]').click();await f.page.waitForURL(url=>url.pathname==='/registration/confirmation/');await f.page.locator('[data-confirmation-content]:visible').waitFor();
    const replay=submits(f)[1];assert.equal(replay.body,original.body);assert.equal(replay.headers['idempotency-key'],original.headers['idempotency-key']);assert.notEqual(replay.headers['x-registration-token'],original.headers['x-registration-token']);assert.equal(JSON.parse(replay.body).consent.version,'synthetic-people-notice-v1');assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length,1);assert.equal((await nativeRecords(f.page)).length,0);assert.equal(f.runtime.messages.length,0);await f.close();reports.push({unknownReloadFrozen:true,closedChangedPrivacyExactReplay:true,freshToken:true,oneDurableApplication:true});
  }
  {
    const f=await fixture({lostAck:true});await open(f.page);await fill(f.page);await form(f.page).locator('[data-submit]').click();await form(f.page).locator('[data-submit]').filter({hasText:/再次确认/u}).waitFor();const original=(await nativeRecords(f.page))[0].value;f.reject();await form(f.page).locator('[data-submit]').click();await form(f.page).locator('[data-form-error]').filter({hasText:/原申请结果仍待核对/u}).waitFor();const current=(await nativeRecords(f.page))[0].value;assert.equal(current.idempotencyKey,original.idempotencyKey);assert.equal(current.payloadJson,original.payloadJson);assert.equal(await form(f.page).locator('[name=name]').isDisabled(),true);assert.equal(await form(f.page).locator('[data-application-draft-clear]').isVisible(),false);await f.close();reports.push({unknownLater422KeepsExactRecovery:true});
  }
  {
    const f=await fixture();await open(f.page);await f.page.evaluate(()=>{window.syntheticQuota=true;});await form(f.page).locator('[name=name]').fill('合成容量失败');await form(f.page).locator('[data-application-draft-status]').filter({hasText:/失败/u}).waitFor();assert.equal(await form(f.page).locator('[data-submit]').isDisabled(),true);await blockedReload(f.page);assert.equal(await form(f.page).locator('[name=name]').inputValue(),'合成容量失败');assert.equal(submits(f).length,0);assert.equal((await nativeRecords(f.page)).length,0);await f.close();reports.push({quotaFailureNoFalseSaved:true,quotaFailureWarnsAndNoPOST:true});
  }
  {
    const f=await fixture();await open(f.page);const second=await f.newPage();await open(second);await form(f.page).locator('[name=name]').fill('合成第一页签');await waitForRecord(f.page,rows=>rows[0]?.value.name==='合成第一页签');await form(second).locator('[data-application-draft-status]').filter({hasText:/另一页签/u}).waitFor();await form(second).locator('[name=name]').fill('合成第二页签未存');await form(second).locator('[data-application-draft-save]').click();assert.equal((await nativeRecords(second))[0].value.name,'合成第一页签');assert.equal(await form(second).locator('[name=name]').inputValue(),'合成第二页签未存');await form(second).locator('[data-application-draft-restore]').click();await form(second).locator('[data-application-draft-status]').filter({hasText:/已恢复/u}).waitFor();assert.equal(await form(second).locator('[name=name]').inputValue(),'合成第一页签');assert.equal(submits(f).length,0);await f.close();reports.push({twoTabsNoSilentOverwrite:true,explicitRestore:true});
  }
  {
    const f=await fixture();await open(f.page);const second=await f.newPage();await open(second);await f.page.evaluate(()=>{window.syntheticHoldAck=true;});await form(f.page).locator('[name=name]').fill('合成被延迟回执');await waitForRecord(second,rows=>rows[0]?.value.name==='合成被延迟回执');await reloadAllowed(second);await form(second).locator('[name=name]').fill('合成另一页签较新');await waitForRecord(second,rows=>rows[0]?.value.name==='合成另一页签较新');await f.page.evaluate(()=>{window.syntheticHoldAck=false;for(const ack of window.syntheticAckQueue??[])ack();window.syntheticAckQueue=[];});await form(f.page).locator('[data-application-draft-status]').filter({hasText:/另一页签/u}).waitFor();assert.equal(await form(f.page).locator('[name=name]').inputValue(),'合成被延迟回执');assert.equal(await form(f.page).locator('[data-submit]').isDisabled(),true);await f.close();reports.push({externalHintDuringOwnHeldAckRechecked:true,noStaleSavedClaim:true});
  }
  {
    const f=await fixture();await open(f.page);await fill(f.page);f.failRejection();await form(f.page).locator('[data-submit]').click();await form(f.page).locator('[data-submit]').filter({hasText:/再次确认/u}).waitFor();const records=await nativeRecords(f.page);assert.equal(records[0].kind,'pending_submission');assert.equal(records[0].value.uncertain,true);assert.equal(await form(f.page).locator('[data-application-draft-clear]').isVisible(),false);await f.close();reports.push({atomicKnownRejectionQuotaRetainsOriginal:true});
  }
  {
    const f=await fixture();await open(f.page);await fill(f.page);await waitForRecord(f.page,rows=>rows[0]?.value.category==='student');f.reject();await form(f.page).locator('[data-submit]').click();await form(f.page).locator('[data-form-error]').filter({hasText:/资料未通过检查/u}).waitFor();const records=await nativeRecords(f.page);assert.equal(records[0].kind,'editing');assert.equal(records[0].value.name,'合成本机申请人');assert.equal(await form(f.page).locator('[name=name]').isDisabled(),false);assert.equal(await form(f.page).locator('[name=consentAccepted]').isChecked(),false);assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length,0);await f.close();reports.push({knownFirst422AtomicEditableRestore:true});
  }
  {
    const f=await fixture();await open(f.page);await fill(f.page);await waitForRecord(f.page,rows=>rows[0]?.value.category==='student');f.failCleanup();await form(f.page).locator('[data-submit]').click();await f.page.waitForURL(url=>url.pathname==='/registration/confirmation/');await f.page.locator('[data-confirmation-content]:visible').waitFor();const records=await nativeRecords(f.page);assert.equal(records[0].kind,'pending_submission');assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length,1);assert.equal(submits(f).length,1);await f.close();reports.push({receiptValidWhenLocalCleanupFails:true,originalRecoveryIdentityRetained:true});
  }
  {
    const f=await fixture();await open(f.page);await fill(f.page);const rows=await waitForRecord(f.page,rows=>rows[0]?.value.category==='student');await f.page.evaluate(key=>{window.syntheticHoldRead=true;const channel=new BroadcastChannel('artdico-browser-drafts-v1-changes');channel.postMessage({type:'change',key,actorId:'public',revision:1,actorEpoch:0});channel.close();},rows[0].key);await f.page.waitForFunction(()=>window.syntheticReadQueue?.length>0);f.holdSubmit();await form(f.page).locator('[data-submit]').click();await f.page.waitForFunction(()=>document.querySelector('[data-registration-form]').dataset.submitting==='true');for(let i=0;i<200&&!submits(f).length;i++)await f.page.waitForTimeout(20);assert.equal(submits(f).length,1);await f.page.evaluate(()=>{window.syntheticHoldRead=false;for(const ack of window.syntheticReadQueue??[])ack();window.syntheticReadQueue=[];});await f.page.waitForTimeout(50);assert.equal(await form(f.page).getAttribute('data-submitting'),'true');assert.equal(await form(f.page).locator('[data-submit]').isDisabled(),true);f.releaseSubmit();await f.page.waitForURL(url=>url.pathname==='/registration/confirmation/');assert.equal((await f.runtime.app.registrationService.repository.list()).registrations.length,1);await f.close();reports.push({heldWatchReadCannotUnlockActiveSubmit:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors},null,2));
}finally{await browser.close();}
