// Chromium only against intercepted synthetic content APIs; no production traffic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInitialContent} from '../../src/config/content.mjs';
import {buildArrangementOverview} from '../../shared/arrangement-overview.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),SITE='https://api.artdico.host';
const OLD='合成原展示项目',UPDATED='合成更新展示项目',BOOTH='synthetic-save-booth';
const staff={id:'synthetic-save-editor',label:'合成活动编辑',roles:['editor','publisher','outreach']};
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const errors=[],reports=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

async function fixture({width=1280,mode='normal',actor=staff}={}){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);
  const initial=createInitialContent();initial.booths=[{id:BOOTH,code:'C01',slotNumber:1,zone:'C',organization:'合成参展组织',project:OLD,website:'',description:'合成展示说明',contactName:'合成负责人',contactMethods:'synthetic@example.invalid',status:'confirmed',internalNotes:''}];
  let saved={revision:3,content:structuredClone(initial)},arrangementReads=0,putAttempts=0,activeActor=structuredClone(actor),expireNext=false;
  const reads=[],writes=[],unknown=[],dialogs=[];
  page.on('pageerror',error=>errors.push(mode+': '+error.message));
  page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.equal(url.origin,SITE,'all network requests remain inside the intercepted synthetic origin');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      (request.method()==='GET'?reads:writes).push(request.method()==='GET'?path:{path,method:request.method(),body});
      if(path==='/api/admin/session'||path==='/api/admin/login')return route.fulfill(json({user:activeActor,csrfToken:'s'.repeat(43)}));
      if(path==='/api/admin/logout'){if(mode==='logout-network')return route.abort('failed');return route.fulfill(json(mode==='logout-401'?{error:{code:'UNAUTHORIZED'}}:{loggedOut:true},mode==='logout-401'?401:200));}
      if(path==='/api/admin/content'){
        if(request.method()==='PUT'){
          putAttempts++;assert.equal(body.expectedRevision,3);assert.equal(body.content.booths[0].id,BOOTH);assert.equal(body.content.booths[0].project,UPDATED);
          if(mode==='conflict')return route.fulfill(json({error:{code:'CONTENT_CONFLICT',message:'合成版本冲突'}},409));
          if(!['malformed','wrong-ack'].includes(mode)&&!(mode==='unknown-uncommitted'&&putAttempts===1))saved={revision:4,content:structuredClone(body.content)};
          if(mode==='unknown-committed'||mode==='unknown-uncommitted'&&putAttempts===1)return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
          if(mode==='wrong-ack')return route.fulfill(json({draft:{revision:4,content:structuredClone(initial)}}));
          if(mode==='malformed')return route.fulfill(json({ok:true}));
        }
        return route.fulfill(json({draft:structuredClone(saved),published:null}));
      }
      if(path==='/api/admin/arrangements'){
        if(expireNext){expireNext=false;return route.fulfill(json({error:{code:'UNAUTHORIZED'}},401));}
        arrangementReads++;
        if(mode==='arrangements-failed'&&arrangementReads>1)return route.fulfill(json({error:{code:'SOURCE_UNAVAILABLE'}},503));
        return route.fulfill(json(buildArrangementOverview({content:saved.content,contacts:[],contentRevision:saved.revision,contactsRevision:0})));
      }
      if(path==='/api/admin/contacts')return route.fulfill(json({revision:0,contacts:[]}));
      if(path==='/api/admin/planning')return route.fulfill(json({features:{intentInvitations:false}}));
      unknown.push(path);return route.fulfill(json({error:{code:'UNEXPECTED_SYNTHETIC_API'}},503));
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return await route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  return {context,page,reads,writes,unknown,dialogs,saved:()=>structuredClone(saved),actor:value=>{activeActor=structuredClone(value);},expireArrangement:()=>{expireNext=true;}};
}
const state=f=>f.page.locator('[data-admin-savebar]');
async function waitState(f,value){await f.page.locator('[data-admin-savebar][data-save-state='+value+']').waitFor();}
async function open(f){await f.page.goto(SITE+'/admin/',{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await waitState(f,'loaded');assert.deepEqual(f.writes,[]);}
async function editBooth(f){await f.page.locator('[data-admin-booths] tr').first().locator('button').first().click();await f.page.locator('[data-booth-dialog][open]').waitFor();await f.page.locator('[data-booth-form] [name=project]').fill(UPDATED);}
async function applyBooth(f){await editBooth(f);await f.page.locator('[data-booth-submit]').click();await f.page.locator('[data-booth-dialog]').waitFor({state:'hidden'});await waitState(f,'dirty');assert.deepEqual(f.writes,[],'applying changes is not a cloud write');}
async function saveNearBooth(f){await f.page.locator('[data-admin-save-location=booth]').click();}
async function assertNoPublication(f){assert.equal(f.writes.some(write=>write.path==='/api/admin/content/publish'),false,'saving a draft never publishes');assert.deepEqual(f.unknown,[]);}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no full-page horizontal overflow');}

async function permitReload(f){f.page.removeAllListeners('dialog');f.page.on('dialog',async dialog=>{f.dialogs.push(dialog.type());await dialog.accept();});}
async function localSaved(f){await f.page.locator('[data-admin-local-status]').filter({hasText:'已暂存本机'}).waitFor();}
try{
  await mkdir(evidence,{recursive:true});
  {
    const f=await fixture();await open(f);await permitReload(f);await editBooth(f);await localSaved(f);
    const stableId=await f.page.locator('[data-booth-form] [name=id]').inputValue();
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();assert.deepEqual(f.writes,[]);
    await f.page.locator('[data-admin-local-restore]').click();await f.page.locator('[data-booth-dialog][open]').waitFor();
    assert.equal(await f.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.equal(await f.page.locator('[data-booth-form] [name=id]').inputValue(),stableId);assert.deepEqual(f.writes,[],'restoration never applies or saves');
    await f.page.locator('[data-booth-submit]').click();await saveNearBooth(f);await waitState(f,'saved');assert.equal(f.writes.length,1);await assertNoPublication(f);await f.context.close();reports.push('incomplete raw booth input survives refresh with same stable ID; explicit apply and cloud save remain separate');
  }
  for(const type of ['guest','session','showcase','organization']){
    const f=await fixture();await open(f);await permitReload(f);
    await f.page.locator(type==='organization'?'[data-organization-add]':'[data-admin-add-'+type+']').click();
    const form=f.page.locator('[data-'+type+'-form]'),field=type==='organization'||type==='guest'?'name':'title',value='PRIVATE-SYNTHETIC-'+type;
    await form.locator('[name='+field+']').fill(value);
    if(['guest','showcase','organization'].includes(type))await form.locator('[name=publicConsent]').check();
    await localSaved(f);const id=await form.locator('[name=id]').inputValue();assert.ok(id);
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();await f.page.locator('[data-admin-local-restore]').click();
    await f.page.locator('[data-'+type+'-dialog][open]').waitFor();assert.equal(await form.locator('[name='+field+']').inputValue(),value);assert.equal(await form.locator('[name=id]').inputValue(),id);
    if(['guest','showcase','organization'].includes(type))assert.equal(await form.locator('[name=publicConsent]').isChecked(),false,'restoration never reaffirms public authorization');
    assert.deepEqual(f.writes,[],'restoring incomplete fields never submits or publishes');await f.context.close();reports.push(type+' incomplete form keeps stable ID and fresh authorization check after native IDB reload');
  }
  {
    const f=await fixture();await open(f);await permitReload(f);
    await f.page.locator('[data-event-form] [name=title]').fill('合成未应用活动名称');
    await f.page.locator('[data-event-add-faq]').click();await f.page.locator('[data-event-faq] [name=faqQuestion]').last().fill('合成未完成问题');
    await localSaved(f);await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();await f.page.locator('[data-admin-local-restore]').click();
    await f.page.waitForFunction(()=>document.querySelector('[data-event-form] [name=title]').value==='合成未应用活动名称');
    assert.equal(await f.page.locator('[data-event-form] [name=title]').inputValue(),'合成未应用活动名称');assert.equal(await f.page.locator('[data-event-faq] [name=faqQuestion]').last().inputValue(),'合成未完成问题');assert.equal(await f.page.locator('[data-event-faq] [name=faqAnswer]').last().inputValue(),'');
    assert.deepEqual(f.writes,[]);await assertNoPublication(f);await f.context.close();reports.push('incomplete event and FAQ inputs explicitly recover without applying or writing cloud content');
  }
  {
    const f=await fixture();await open(f);await permitReload(f);
    await f.page.locator('[data-arrangements-slots] [data-slot-number="1"] [data-arrangements-plan=booth]').click();
    await f.page.locator('[data-planner-booth] [name=project]').fill('合成未应用规划项目');await localSaved(f);
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();await f.page.locator('[data-admin-local-restore]').click();
    await f.page.locator('[data-arrangement-planner]:visible').waitFor();await f.page.waitForFunction(()=>document.querySelector('[data-planner-booth] [name=project]').value==='合成未应用规划项目');assert.equal(await f.page.locator('[data-planner-booth] [name=project]').inputValue(),'合成未应用规划项目');
    assert.equal(f.reads.filter(path=>path==='/api/admin/contacts').length,1,'restoring a planner does not automatically reload or save people assignments');assert.deepEqual(f.writes,[]);await assertNoPublication(f);await f.context.close();reports.push('planner booth raw inputs recover by stable saved position without automatic people requests or assignments');
  }
  for(const mode of ['unknown-committed','unknown-uncommitted']){
    const f=await fixture({mode});await open(f);await permitReload(f);await applyBooth(f);await saveNearBooth(f);await waitState(f,'unknown');assert.equal(f.writes.length,1);
    const original=structuredClone(f.writes[0]);await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();
    await f.page.locator('[data-admin-local-restore]').click();await waitState(f,'unknown');assert.equal(f.writes.length,1,'refresh/restore does not repeat PUT');
    await state(f).locator('[data-admin-check-save]').click();
    if(mode==='unknown-committed'){await waitState(f,'saved');assert.equal(f.writes.length,1,'readback proof alone completes the old saved result');}
    else{await state(f).locator('[data-admin-retry-save]:visible').waitFor();await state(f).locator('[data-admin-retry-save]').click();await waitState(f,'saved');assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],original,'explicit retry keeps exact original submitted content and cloud revision');}
    await assertNoPublication(f);await f.context.close();reports.push(mode+' refresh retains original pending submission and requires explicit GET proof / original-body retry');
  }
  async function loginAgain(f){
    await f.page.locator('[data-admin-login-panel]:visible').waitFor();await f.page.locator('[data-admin-login] [name=username]').fill('synthetic-operator');await f.page.locator('[data-admin-login] [name=password]').fill('synthetic-password-12');await f.page.locator('[data-admin-login-submit]').click();
    await f.page.locator('[data-admin-workspace]:visible').waitFor();
    await f.page.locator('[data-admin-status]').filter({hasText:'已登录。'}).waitFor();
  }
  async function assertPrivateCleared(f){
    await f.page.locator('[data-admin-login-panel]:visible').waitFor();
    const values=await f.page.evaluate(()=>document.body.textContent+' '+[...document.querySelectorAll('input,textarea')].map(field=>field.value).join(' '));assert.equal(values.includes(UPDATED),false,'expired/logout DOM and form values contain no old private project');
    assert.equal(await f.page.locator('[data-admin-login-submit]').isEnabled(),true);
  }
  for(const mode of ['logout-401','logout-network']){
    const f=await fixture({mode});await open(f);await permitReload(f);await applyBooth(f);await localSaved(f);
    await f.page.locator('[data-admin-logout]').click();await assertPrivateCleared(f);await loginAgain(f);
    assert.equal(await f.page.locator('[data-admin-local-recovery]').isVisible(),false,'explicit logout deletes actor draft even if server logout is unauthorized/unknown');
    assert.equal(f.writes.filter(write=>write.path==='/api/admin/content').length,0);await assertNoPublication(f);await f.context.close();reports.push(mode+' clears disk draft and private DOM; same-actor login has no discarded recovery');
  }
  {
    const f=await fixture();await open(f);await permitReload(f);await applyBooth(f);await localSaved(f);f.expireArrangement();
    await f.page.locator('[data-arrangements-refresh]').click();await assertPrivateCleared(f);await loginAgain(f);
    await f.page.locator('[data-admin-local-restore]:visible').waitFor();assert.equal(f.writes.filter(write=>write.path==='/api/admin/content').length,0,'expiry keeps disk recovery without resubmitting');
    await f.page.locator('[data-admin-local-restore]').click();assert.match(await f.page.locator('[data-admin-booths]').textContent(),new RegExp(UPDATED,'u'));
    assert.equal(f.writes.filter(write=>write.path==='/api/admin/content').length,0);await f.context.close();reports.push('current 401 clears private DOM but fresh same-actor authentication can explicitly recover');
  }
  {
    const f=await fixture();await open(f);await permitReload(f);await applyBooth(f);await localSaved(f);f.expireArrangement();await f.page.locator('[data-arrangements-refresh]').click();await assertPrivateCleared(f);
    f.actor({...staff,id:'synthetic-other-editor',label:'合成其他同事'});await loginAgain(f);assert.equal(await f.page.locator('[data-admin-local-recovery]').isVisible(),false);assert.equal((await f.page.locator('[data-admin-booths]').textContent()).includes(UPDATED),false,'other actor never sees the prior draft');
    await f.page.locator('[data-admin-logout]').click();await assertPrivateCleared(f);f.actor(staff);await loginAgain(f);await f.page.locator('[data-admin-local-restore]:visible').waitFor();
    assert.equal(f.writes.filter(write=>write.path==='/api/admin/content').length,0);await f.context.close();reports.push('different actor cannot see or restore original draft; their logout does not delete the original actor recovery');
  }
  for(const mode of ['normal','unknown-committed']){
    const f=await fixture({mode});await open(f);await permitReload(f);await applyBooth(f);await localSaved(f);
    if(mode==='unknown-committed'){await saveNearBooth(f);await waitState(f,'unknown');}
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();await f.page.locator('[data-admin-status]').filter({hasText:'已恢复工作人员会话。'}).waitFor();
    assert.equal(await f.page.locator('[data-admin-logout]').isEnabled(),true,'inactive recovery never prevents leaving the account');
    if(mode==='unknown-committed'){await f.page.locator('[data-admin-local-restore]').click();await waitState(f,'unknown');assert.equal(await f.page.locator('[data-admin-logout]').isEnabled(),true,'read-only pending archive permits explicit logout');}
    const before=f.writes.filter(write=>write.path==='/api/admin/content').length;await f.page.locator('[data-admin-logout]').click();await assertPrivateCleared(f);await loginAgain(f);
    assert.equal(await f.page.locator('[data-admin-local-recovery]').isVisible(),false);assert.equal(f.writes.filter(write=>write.path==='/api/admin/content').length,before,'logout does not retry the old cloud request');assert.ok(f.dialogs.includes('confirm'));await assertNoPublication(f);await f.context.close();reports.push(mode+' inactive recovery permits explicit logout, confirms local removal and never repeats cloud save');
  }
  for(const width of [1280,320]){
    const f=await fixture({width});await open(f);await permitReload(f);await f.page.locator('[data-admin-add-guest]').click();await f.page.locator('[data-guest-form] [name=name]').fill('合成未完成资料');await localSaved(f);
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await f.page.locator('[data-guest-submit]').scrollIntoViewIfNeeded();await f.page.screenshot({path:resolve(evidence,'content-local-guest-'+width+'.png')});await f.context.close();reports.push('visual '+width+'px nearby save/apply distinction and local recovery status captured');
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true,nativeIndexedDB:true},null,2));
}finally{await browser.close();}
