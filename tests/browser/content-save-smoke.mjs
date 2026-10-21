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

try{
  await mkdir(evidence,{recursive:true});
  const guarded=await fixture();await open(guarded);await editBooth(guarded);await waitState(guarded,'unapplied');
  for(const save of await guarded.page.locator('[data-admin-save]').all())assert.equal(await save.isDisabled(),true,'unapplied form cannot be saved as if it were the content draft');
  await guarded.page.locator('[data-close-dialog=booth]').first().click();assert.equal(await guarded.page.locator('[data-booth-dialog]').evaluate(node=>node.open),true);assert.equal(await guarded.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.deepEqual(guarded.dialogs,['confirm']);
  await guarded.page.reload({waitUntil:'domcontentloaded',timeout:1500}).catch(error=>{assert.ok(error.name==='TimeoutError'||/ERR_ABORTED|interrupted|cancel/iu.test(error.message),'only a guarded/cancelled navigation may fail');});
  assert.ok(guarded.dialogs.includes('beforeunload'),'typing alone protects a refresh');assert.equal(await guarded.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.deepEqual(guarded.writes,[]);
  await guarded.page.locator('[data-booth-submit]').click();await waitState(guarded,'dirty');assert.match(await state(guarded).textContent(),/未保存|本页/u);assert.deepEqual(guarded.writes,[]);
  await saveNearBooth(guarded);await waitState(guarded,'saved');assert.equal(guarded.saved().content.booths[0].project,UPDATED);assert.equal(guarded.writes.length,1);await assertNoPublication(guarded);
  await guarded.page.reload({waitUntil:'networkidle'});await waitState(guarded,'loaded');await guarded.page.locator('[data-admin-booths] tr').first().locator('button').first().click();assert.equal(await guarded.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);await guarded.context.close();reports.push({typingProtectsCloseAndRefresh:true,applyDoesNotSave:true,nearbyExplicitSave:true,reloadReadsSavedBooth:true,noAutomaticPublication:true});

  for(const mode of ['conflict','unknown-uncommitted','unknown-committed','wrong-ack','malformed']){
    const f=await fixture({mode});await open(f);await applyBooth(f);await saveNearBooth(f);await waitState(f,mode==='conflict'?'conflict':'unknown');
    assert.match(await f.page.locator('[data-admin-booths]').textContent(),new RegExp(UPDATED,'u'));assert.doesNotMatch(await f.page.locator('[data-admin-status]').textContent(),/草稿已保存/u);assert.equal(f.writes.length,1);await f.page.waitForTimeout(100);assert.equal(f.writes.length,1,'uncertain or rejected save never auto-retries');
    if(mode.startsWith('unknown-')){
      assert.equal(f.reads.filter(path=>path==='/api/admin/content').length,1,'unknown save waits for explicit read-back');const before=f.reads.filter(path=>path==='/api/admin/content').length;await state(f).locator('[data-admin-check-save]').click();
      await f.page.waitForFunction(()=>{const button=document.querySelector('[data-admin-savebar] [data-admin-check-save]');return button&&(button.hidden||!button.disabled);});
      assert.equal(f.reads.filter(path=>path==='/api/admin/content').length,before+1);assert.equal(f.writes.length,1,'read-back confirmation is GET only');
      if(mode==='unknown-committed')await waitState(f,'saved');
      else{assert.notEqual(await state(f).getAttribute('data-save-state'),'saved');assert.match(await f.page.locator('[data-admin-booths]').textContent(),new RegExp(UPDATED,'u'));await state(f).locator('[data-admin-retry-save]').click();await waitState(f,'saved');assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0],'controlled retry uses the exact original content and expected revision');assert.equal(f.saved().content.booths[0].project,UPDATED);}
    }
    await assertNoPublication(f);await f.context.close();reports.push({mode,localDraftRetained:true,noFalseSuccess:true,noAutomaticRetry:true,readBackConfirmedOnly:mode==='unknown-committed'});
  }

  const failedOverview=await fixture({mode:'arrangements-failed'});await open(failedOverview);await applyBooth(failedOverview);await saveNearBooth(failedOverview);await waitState(failedOverview,'saved');assert.equal(failedOverview.saved().revision,4);assert.equal(failedOverview.saved().content.booths[0].project,UPDATED);assert.match(await failedOverview.page.locator('[data-admin-status]').textContent(),/保存已完成/u);assert.match(await failedOverview.page.locator('[data-admin-status]').textContent(),/总览.*未刷新/u);await assertNoPublication(failedOverview);await failedOverview.context.close();reports.push({savedContentSurvivesOverviewReadFailure:true});

  for(const width of [320,390]){
    const f=await fixture({width});await open(f);await applyBooth(f);await noOverflow(f.page);await f.page.evaluate(()=>scrollTo(0,document.documentElement.scrollHeight));
    const bar=await state(f).boundingBox();assert.ok(bar&&bar.y>=0&&bar.y+bar.height<=900+1,'save bar stays inside the viewport');
    const lastRowAction=f.page.locator('[data-admin-booths] [data-row-action]').last();await lastRowAction.scrollIntoViewIfNeeded();const rowBounds=await lastRowAction.boundingBox(),rowBar=await state(f).boundingBox();assert.ok(rowBounds&&rowBar&&rowBounds.y+rowBounds.height<=rowBar.y+1,'last booth row action stays above the fixed bar');assert.equal(await lastRowAction.evaluate(node=>{const bounds=node.getBoundingClientRect();const hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);return node===hit||node.contains(hit);}),true,'last booth row action remains reachable');
    const finalAction=f.page.locator('[data-admin-save-location=booth]');await finalAction.scrollIntoViewIfNeeded();
    const target=await finalAction.boundingBox(),currentBar=await state(f).boundingBox();assert.ok(target&&currentBar&&target.y+target.height<=currentBar.y+1,'last section save action remains above the fixed bar');
    assert.equal(await finalAction.evaluate(node=>{const bounds=node.getBoundingClientRect();const hit=document.elementFromPoint(bounds.x+bounds.width/2,bounds.y+bounds.height/2);return node===hit||node.contains(hit);}),true,'the nearby save control can actually be reached');
    await f.page.screenshot({path:resolve(evidence,'content-save-'+width+'.png'),fullPage:true});await saveNearBooth(f);await waitState(f,'saved');await assertNoPublication(f);await f.context.close();reports.push({width,saveBarVisible:true,lastSectionActionReachable:true,lastBoothRowActionReachable:true,noPageOverflow:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
