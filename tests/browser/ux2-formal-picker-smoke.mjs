// Compiled staff picker over the real isolated runtime; every HTTP request is intercepted.
// Raw requests are examined only in memory. Evidence contains booleans/counts/hashes.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE,PEOPLE_FIXTURE_EVENT} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/ux2-formal-picker'));
const hash=value=>createHash('sha256').update(value).digest('hex'),op=()=>randomBytes(32).toString('base64url');
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),assets=new Map(),reports=[],errors=[];
const mime=file=>({html:'text/html; charset=utf-8',js:'text/javascript',css:'text/css',woff2:'font/woff2',svg:'image/svg+xml',png:'image/png',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
async function staticFile(path){const fileFor=value=>resolve(dist,'.'+(value.endsWith('/')?value+'index.html':value));let file=fileFor(path);assert.ok(file.startsWith(dist+'/'));if(aliases.has(path)){try{await stat(file);}catch(error){if(error.code!=='ENOENT')throw error;file=fileFor(aliases.get(path));}}return file;}
async function localDrafts(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').getAll();read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>reject(read.error);};}));}
async function fixture(width,{loseAck=false,providerUnknown=false,people=2}={}){
 const runtime=await peopleRuntimeFixture({capacity:Math.max(people+1,4),mail:true,mailResult:providerUnknown?'unknown':'accepted'}),auth=await runtime.login('owner'),actor=runtime.users[0];
 const setEnabled=async enabled=>runtime.app.confirmationService.setSettings({actor,expectedRevision:(await runtime.app.confirmationService.settings({actor})).revision,operationId:op(),enabled});
 await setEnabled(false);
 const a=await runtime.seedPublic({name:'合成确认甲',email:'synthetic.shared@example.invalid'});await runtime.approvePublic(a.reference_code,{headers:auth});
 const b=await runtime.seedPublic({name:'合成确认乙',email:'synthetic.shared@example.invalid'});await runtime.approvePublic(b.reference_code,{headers:auth});
 for(let index=2;index<people;index++){const item=await runtime.seedPublic({name:'合成长名单人员 '+index,email:'synthetic.long.'+index+'@example.invalid'});await runtime.approvePublic(item.reference_code,{headers:auth});}
 await runtime.seedPublic({name:'合成待审者',email:'synthetic.pending@example.invalid'});assert.equal(runtime.messages.length,0);
 await setEnabled(true);assert.equal(runtime.messages.length,0,'enabling notifications never backfills historical applications');
 const context=await browser.newContext({viewport:{width,height:940}}),[name,...cookie]=auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:cookie.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),calls=[],controls={failPreview:false,failSelected:false,missingOperation:false,failSettings:false},metrics={durableBeforePost:false};
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'only the intercepted local API origin is allowed');
  if(path.startsWith('/api/')){
   const entry={path,method:req.method(),body:req.postData()};calls.push(entry);
   if(path==='/api/admin/registration-confirmation/settings'&&controls.failSettings){entry.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_SETTINGS_UNAVAILABLE'}},503));}
   if(path==='/api/admin/registration-confirmation/preview'&&(controls.failPreview||controls.failSelected&&JSON.parse(req.postData()||'{}').registrationIds)){entry.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_SOURCE_UNAVAILABLE'}},503));}
   if(path.startsWith('/api/admin/registration-confirmation/operation/')&&controls.missingOperation){entry.status=404;return route.fulfill(json({error:{code:'CONFIRMATION_NOT_FOUND'}},404));}
   if(path==='/api/admin/registration-confirmation/dispatch'&&req.method()==='POST'){
    const rows=await localDrafts(page),raw=rows.find(row=>row.scope.entityId==='delivery-formal');assert.ok(raw,'a durable local record precedes the first POST');assert.equal(raw.kind,'pending_submission');assert.equal(raw.value.body,req.postData());assert.equal(raw.value.roleKey,raw.scope.page);assert.equal(raw.value.uncertain,false);
    assert.doesNotMatch(JSON.stringify(raw.value),/合成确认|example\.invalid|receipt|token|confirmationUrl/u);assert.deepEqual(Object.keys(JSON.parse(raw.value.body)).sort(),['expectedRevision','operationId','registrationIds','retryRejected']);metrics.durableBeforePost=true;
   }
   const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));entry.status=response.status;
   if(loseAck&&path==='/api/admin/registration-confirmation/dispatch'&&response.ok){loseAck=false;await response.arrayBuffer();return route.fulfill(json({error:{code:'SYNTHETIC_ACK_LOST'}},503));}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  const file=await staticFile(path),body=await readFile(file);assets.set(path,{path,sha256:hash(body),bytes:body.length});return route.fulfill({status:200,contentType:mime(file),body});
 });
 return{runtime,actor,auth,a,b,page,context,calls,controls,metrics,setEnabled};
}
const posts=f=>f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/dispatch');
async function open(f){await f.page.goto(SITE+'/admin/settings/delivery/',{waitUntil:'domcontentloaded'});await f.page.locator('[data-delivery-state]:visible').waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();}
async function preview(f){await f.page.locator('[data-formal-refresh]').click();await f.page.locator('[data-formal-status]').filter({hasText:'当前已确认'}).waitFor();await f.page.locator('[data-formal-select-all]:enabled').waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
async function seedLegacy(f,value){await f.page.evaluate(({value,actorId,eventId})=>new Promise((resolve,reject)=>{
 const request=indexedDB.open('artdico-browser-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{
  const db=request.result,scope={actorId,eventId,page:'settings',entityId:'delivery-dispatch'},key=JSON.stringify([actorId,eventId,'settings','delivery-dispatch']);
  const tx=db.transaction(['drafts','heads','actors'],'readwrite'),now=Date.now();
  tx.objectStore('actors').put({actorId,epoch:0});tx.objectStore('heads').put({key,actorId,revision:1});
  tx.objectStore('drafts').put({key,scope,revision:1,actorEpoch:0,kind:'pending_submission',baseRevision:value.expectedRevision,value,updatedAt:now,expiresAt:null,pendingFields:['registrationIds','retryRejected','expectedRevision','operationId','action']});
  tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);
 };
}),{value,actorId:f.actor.id,eventId:PEOPLE_FIXTURE_EVENT});}
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 await mkdir(evidence,{recursive:true});
 for(const width of[320,390,1440]){
  const f=await fixture(width);try{
   await open(f);assert.equal(await f.page.locator('textarea[name=registrationIds]').count(),0);assert.equal(await f.page.locator('[data-formal-rows] li').count(),0);await preview(f);
   assert.equal(await f.page.locator('[data-formal-rows] li').count(),2);assert.equal(await f.page.locator('[data-formal-preview] details').getAttribute('open'),null);assert.doesNotMatch(await f.page.locator('[data-formal-rows]').textContent(),/合成待审者/u);
   const values=await f.page.locator('[data-formal-registration]').evaluateAll(nodes=>nodes.map(node=>node.value));assert.equal(new Set(values).size,2,'same mailbox does not merge people');
   await f.page.locator('[data-formal-select-all]').check();assert.equal(await f.page.locator('[data-formal-send]').textContent(),'发送确认信（2 人）');await f.page.locator('[data-formal-send]').click();
   await f.page.locator('[data-formal-results]').filter({hasText:'合成确认甲 · 邮件服务已接收'}).waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();
   assert.equal(posts(f).length,1);assert.equal(f.runtime.messages.length,2);assert.equal(f.metrics.durableBeforePost,true);assert.equal(await f.page.locator('[data-formal-registration]:enabled').count(),0);assert.equal(await f.page.locator('[data-formal-send]').isDisabled(),true);
   assert.doesNotMatch(await f.page.locator('[data-formal-results]').textContent(),new RegExp(values.join('|'),'u'));
   f.controls.failPreview=true;await f.page.locator('[data-formal-refresh]').click();await f.page.locator('[data-formal-status]').filter({hasText:'名单暂无法核对'}).waitFor();assert.equal(await f.page.locator('[data-formal-rows]').textContent(),'');assert.equal(await f.page.locator('[data-formal-results]').textContent(),'');await noOverflow(f.page);
   await f.page.screenshot({path:resolve(evidence,'formal-picker-'+width+'.png'),fullPage:true});reports.push({width,namePicker:true,sameMailboxDistinctPeople:true,collapsedPreview:true,durableBeforeOnePost:true,twoExplicitMails:true,acceptedDisabled:true,failedSourceClearsNames:true,noOverflow:true});
  }finally{await f.context.close();}
 }
 for(const width of[320,390,1440]){
  const f=await fixture(width,{loseAck:true});try{
   await open(f);await preview(f);await f.page.getByLabel('选择确认信收件人 合成确认甲',{exact:true}).check();await f.page.locator('[data-formal-send]').click();await f.page.locator('[data-formal-lookup]:enabled').waitFor();
   const original=posts(f)[0].body,operationId=JSON.parse(original).operationId;assert.equal(f.runtime.messages.length,1);assert.equal((await localDrafts(f.page)).find(row=>row.scope.entityId==='delivery-formal').value.uncertain,true);
   if(width===320)f.controls.failSettings=true;await f.page.reload({waitUntil:'domcontentloaded'});
   if(width===320){await f.page.locator('[data-delivery-error]:visible').waitFor();f.controls.failSettings=false;await f.page.locator('[data-delivery-refresh]:enabled').click();}
   await f.page.locator('[data-formal-lookup]:enabled').waitFor();assert.equal(await f.page.locator('[data-formal-rows] li').count(),0);
   assert.equal((await localDrafts(f.page)).find(row=>row.scope.entityId==='delivery-formal').value.body,original);
   f.controls.missingOperation=true;await f.page.locator('[data-formal-lookup]').click();await f.page.locator('[data-formal-lookup]:enabled').waitFor();assert.equal(await f.page.locator('[data-formal-pending]').isVisible(),true);assert.equal(await f.page.locator('[data-formal-refresh]').isDisabled(),true);f.controls.missingOperation=false;
   if(width===390){f.controls.failSelected=true;await f.page.locator('[data-formal-lookup]').click();await f.page.locator('[data-formal-status]').filter({hasText:'当前人员信息无法核对'}).waitFor();assert.equal(await f.page.locator('[data-formal-results]').textContent(),'');await f.page.reload({waitUntil:'domcontentloaded'});await f.page.locator('[data-formal-lookup]:enabled').waitFor();assert.equal((await localDrafts(f.page)).find(row=>row.scope.entityId==='delivery-formal').value.body,original);f.controls.failSelected=false;}
   await f.page.locator('[data-formal-lookup]').click();await f.page.locator('[data-formal-results]').filter({hasText:'合成确认甲 · 邮件服务已接收'}).waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();
   const reads=f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/operation/'+operationId);assert.ok(reads.length>=2);assert.ok(reads.every(call=>call.method==='GET'&&call.body===null));assert.equal(posts(f).length,1);assert.equal(f.runtime.messages.length,1);
   assert.equal(await f.page.getByLabel('选择确认信收件人 合成确认甲',{exact:true}).isDisabled(),true);assert.equal(await f.page.getByLabel('选择确认信收件人 合成确认乙',{exact:true}).isEnabled(),true);await noOverflow(f.page);
   reports.push({width,lostAckReloadRawUnchanged:true,missingOperationKeepsLock:true,lookupOnlyGet:true,oneOriginalPostOneMail:true,initialSettingsFailureRecoversOnRefresh:width===320,identityFailurePreservesOriginal:width===390,bodySha256:hash(original),noOverflow:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{providerUnknown:true});try{
   await open(f);await preview(f);await f.page.getByLabel('选择确认信收件人 合成确认甲',{exact:true}).check();await f.page.locator('[data-formal-send]').click();await f.page.locator('[data-formal-lookup]:enabled').waitFor();await f.page.locator('[data-formal-results]').filter({hasText:'结果待核对，不重寄'}).waitFor();
   await f.page.locator('[data-formal-lookup]').click();await f.page.locator('[data-formal-lookup]:enabled').waitFor();assert.equal(posts(f).length,1);assert.equal(f.runtime.messages.length,1);assert.equal(await f.page.locator('[data-reminder-refresh]').isDisabled(),true);assert.equal(await f.page.locator('[data-delivery-save-button]').isDisabled(),true);
   assert.equal(await f.page.locator('[data-settings-local-draft="delivery-formal"] button').filter({hasText:'解除锁定'}).isVisible(),false);
   await f.page.locator('[data-settings-logout]').click();await f.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal((await localDrafts(f.page)).filter(row=>row.scope.actorId===f.actor.id).length,0);assert.equal(await f.page.locator('[data-formal-results]').textContent(),'');
   reports.push({width:390,providerUnknownKeepsTotalLock:true,noSecondDispatch:true,formalManualUnlockAbsent:true,explicitLogoutClearsActorDrafts:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390);try{
   const revision=(await f.runtime.app.confirmationService.settings({actor:f.actor})).revision,operationId=op();
   const saved=await f.runtime.app.confirmationService.dispatch({actor:f.actor,expectedRevision:revision,operationId,registrationIds:[f.a.reference_code],retryRejected:false});assert.equal(saved.results[0].status,'provider_accepted');
   await open(f);const parsed={registrationIds:[f.a.reference_code],retryRejected:false,expectedRevision:revision,operationId,action:'dispatch'};await seedLegacy(f,parsed);
   await f.page.reload({waitUntil:'domcontentloaded'});await f.page.locator('[data-formal-legacy-lookup]:enabled').waitFor();assert.equal(await f.page.locator('[data-formal-refresh]').isDisabled(),true);
   const before=(await localDrafts(f.page)).find(row=>row.scope.entityId==='delivery-dispatch');assert.deepEqual(before.value,parsed);assert.equal(Object.hasOwn(before.value,'body'),false);
   await f.page.locator('[data-formal-legacy-lookup]').click();await f.page.locator('[data-formal-results]').filter({hasText:'合成确认甲 · 邮件服务已接收'}).waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();
   assert.equal(posts(f).length,0);assert.equal(f.runtime.messages.length,1);assert.equal(f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/operation/'+operationId&&call.method==='GET').length,1);
   reports.push({width:390,legacyParsedNotRewritten:true,legacyOnlyGetNoPost:true,legacyNamesFromReadOnlyPreview:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390);try{
   await open(f);await preview(f);await f.page.getByLabel('选择确认信收件人 合成确认甲',{exact:true}).check();await f.setEnabled(true);
   await f.page.locator('[data-formal-send]').click();await f.page.locator('[data-delivery-status]').filter({hasText:'本次未寄送，请重新选择后发送'}).waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();
   assert.equal(posts(f).length,1);assert.equal(posts(f)[0].status,409);assert.equal(f.runtime.messages.length,0);assert.equal(await f.page.locator('[data-formal-send]').isDisabled(),true);assert.equal((await localDrafts(f.page)).filter(row=>row.scope.entityId==='delivery-formal').length,0);
   const old=JSON.parse(posts(f)[0].body).operationId;await f.page.getByLabel('选择确认信收件人 合成确认甲',{exact:true}).check();await f.page.locator('[data-formal-send]').click();await f.page.locator('[data-formal-results]').filter({hasText:'合成确认甲 · 邮件服务已接收'}).waitFor();await f.page.locator('[data-formal-refresh]:enabled').waitFor();
   assert.equal(posts(f).length,2);assert.notEqual(JSON.parse(posts(f)[1].body).operationId,old);assert.equal(f.runtime.messages.length,1);
   reports.push({width:390,firstAuthoritative409NoMail:true,atomicKnownRejectionReturnsToSelection:true,noLogoutOrAutomaticRetry:true,newSendOnlyAfterExplicitSelection:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{people:35});try{
   await open(f);await preview(f);assert.equal(await f.page.locator('[data-formal-rows] li').count(),35);
   const list=f.page.getByRole('list',{name:'确认信收件人名单'});await list.focus();
   const bounds=await list.evaluate(node=>({scroll:node.scrollHeight,height:node.clientHeight,overflow:getComputedStyle(node).overflowY,tab:node.tabIndex}));
   assert.ok(bounds.scroll>bounds.height);assert.ok(bounds.height<=480);assert.equal(bounds.overflow,'auto');assert.equal(bounds.tab,0);
   await list.press('End');await f.page.locator('[data-formal-registration]').last().focus();await f.page.locator('[data-formal-registration]').last().press('Space');
   assert.equal(await f.page.locator('[data-formal-send]').textContent(),'发送确认信（1 人）');assert.ok(await list.evaluate(node=>node.scrollTop>0));
   await f.page.locator('[data-formal-send]').focus();assert.equal(await f.page.locator('[data-formal-send]').evaluate(node=>node===document.activeElement),true);
   await noOverflow(f.page);assert.equal(posts(f).length,0);assert.equal(f.runtime.messages.length,0);
   await f.page.screenshot({path:resolve(evidence,'formal-long-list-mobile.png'),fullPage:true});reports.push({width:390,realRuntimePeople:35,boundedScrollableList:true,keyboardTailSelection:true,sendCountAndReachableButton:true,noMassSend:true,noOverflow:true});
  }finally{await f.context.close();}
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
await writeFile(resolve(evidence,'report.json'),JSON.stringify({ok:true,cases:reports.length,reports,assets:[...assets.values()],pageErrors:errors,realNetworkRequests:0},null,2));
console.log(JSON.stringify({ok:true,cases:reports.length,pageErrors:errors,report:resolve(evidence,'report.json')}));
