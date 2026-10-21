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

async function fixture({width=1280,mode='normal'}={}){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);
  const initial=createInitialContent();initial.booths=[{id:BOOTH,code:'C01',slotNumber:1,zone:'C',organization:'合成参展组织',project:OLD,website:'',description:'合成展示说明',contactName:'合成负责人',contactMethods:'synthetic@example.invalid',status:'confirmed',internalNotes:''}];
  let saved={revision:3,content:structuredClone(initial)},arrangementReads=0,putAttempts=0;
  const reads=[],writes=[],unknown=[],dialogs=[];
  page.on('pageerror',error=>errors.push(mode+': '+error.message));
  page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.equal(url.origin,SITE,'all network requests remain inside the intercepted synthetic origin');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      (request.method()==='GET'?reads:writes).push(request.method()==='GET'?path:{path,method:request.method(),body});
      if(path==='/api/admin/session')return route.fulfill(json({user:staff,csrfToken:'s'.repeat(43)}));
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
        arrangementReads++;
        if(mode==='arrangements-failed'&&arrangementReads>1)return route.fulfill(json({error:{code:'SOURCE_UNAVAILABLE'}},503));
        return route.fulfill(json(buildArrangementOverview({content:saved.content,contacts:[],contentRevision:saved.revision,contactsRevision:0})));
      }
      unknown.push(path);return route.fulfill(json({error:{code:'UNEXPECTED_SYNTHETIC_API'}},503));
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return await route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  return {context,page,reads,writes,unknown,dialogs,saved:()=>structuredClone(saved)};
}
const state=f=>f.page.locator('[data-admin-savebar]');
async function waitState(f,value){await f.page.locator('[data-admin-savebar][data-save-state='+value+']').waitFor();}
async function open(f){await f.page.goto(SITE+'/admin/',{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await waitState(f,'loaded');assert.deepEqual(f.writes,[]);}
async function editBooth(f){await f.page.locator('[data-admin-booths] tr').first().locator('button').first().click();await f.page.locator('[data-booth-dialog][open]').waitFor();await f.page.locator('[data-booth-form] [name=project]').fill(UPDATED);}
async function applyBooth(f){await editBooth(f);await f.page.locator('[data-booth-submit]').click();await f.page.locator('[data-booth-dialog]').waitFor({state:'hidden'});await waitState(f,'dirty');assert.deepEqual(f.writes,[],'applying changes is not a cloud write');}
async function saveNearBooth(f){await f.page.locator('[data-admin-save-location=booth]').click();}
async function assertNoPublication(f){assert.equal(f.writes.some(write=>write.path==='/api/admin/content/publish'),false,'saving a draft never publishes');assert.deepEqual(f.unknown,[]);}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no full-page horizontal overflow');}

async function permitReload(f){f.page.removeAllListeners('dialog');f.page.on('dialog',dialog=>dialog.accept());}
async function localSaved(f){await f.page.locator('[data-admin-local-status]').filter({hasText:'已暂存本机'}).waitFor();}
try{
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
  for(const mode of ['unknown-committed','unknown-uncommitted']){
    const f=await fixture({mode});await open(f);await permitReload(f);await applyBooth(f);await saveNearBooth(f);await waitState(f,'unknown');assert.equal(f.writes.length,1);
    const original=structuredClone(f.writes[0]);await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();
    await f.page.locator('[data-admin-local-restore]').click();await waitState(f,'unknown');assert.equal(f.writes.length,1,'refresh/restore does not repeat PUT');
    await state(f).locator('[data-admin-check-save]').click();
    if(mode==='unknown-committed'){await waitState(f,'saved');assert.equal(f.writes.length,1,'readback proof alone completes the old saved result');}
    else{await state(f).locator('[data-admin-retry-save]:visible').waitFor();await state(f).locator('[data-admin-retry-save]').click();await waitState(f,'saved');assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],original,'explicit retry keeps exact original submitted content and cloud revision');}
    await assertNoPublication(f);await f.context.close();reports.push(mode+' refresh retains original pending submission and requires explicit GET proof / original-body retry');
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true,nativeIndexedDB:true},null,2));
}finally{await browser.close();}
