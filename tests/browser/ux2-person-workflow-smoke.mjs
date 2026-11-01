// Built person/directory UI over the actual isolated application and memory OSS.
// Every request is intercepted; evidence contains only synthetic screenshots and hashes/counts.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE,PEOPLE_FIXTURE_PASSWORD,PEOPLE_FIXTURE_EVENT} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
import {createConfirmationRepository} from '../../functions/registration-confirmation/repository.mjs';
import {createObjectJournal} from '../../functions/cloud-content/object-journal.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/ux2-person-workflow'));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),assets=new Map(),reports=[],errors=[];
const hash=value=>createHash('sha256').update(value).digest('hex'),op=()=>randomBytes(32).toString('base64url');
const json=(status,code)=>({status,contentType:'application/json',body:JSON.stringify({error:{code}})});
const mime=file=>({html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',png:'image/png',svg:'image/svg+xml',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
async function drafts(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('artdico-browser-drafts-v1');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve([]);return;}const tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').getAll();read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};}));}
async function staticFile(path){const fileFor=value=>resolve(dist,'.'+(value.endsWith('/')?value+'index.html':value));let file=fileFor(path);assert.ok(file.startsWith(dist+'/'));if(aliases.has(path)){try{await stat(file);}catch(error){if(error.code!=='ENOENT')throw error;file=fileFor(aliases.get(path));}}return file;}
async function fixture(width,{lostAck=false,unknown=false,contacts=0,automatic=false}={}){
 const runtime=await peopleRuntimeFixture({capacity:100,mail:true,mailResult:unknown?'unknown':'accepted'}),actor=runtime.users[0],auth=await runtime.login();
 const enabled=async value=>runtime.app.confirmationService.setSettings({actor,expectedRevision:(await runtime.app.confirmationService.settings({actor})).revision,operationId:op(),enabled:value});
 if(!automatic)await enabled(false);
 const registration=await runtime.seedPublic({intake:'general-v2',name:'合成单人确认甲'});await runtime.approvePublic(registration.reference_code,{headers:auth});
 if(!automatic)await enabled(true);
 const roster=[];let linkedRegistrationId=null;for(let n=0;n<contacts;n++)roster.push((await runtime.createContact({name:'合成队列 '+String(n).padStart(2,'0')})).contact);
 if(roster.length>1){
  const selected=roster[1],current=await runtime.app.contactsStore.read();await runtime.app.contactsStore.saveOperations(selected.id,current.revision,{...selected.operations,responseStatus:'attending'},actor.id);
  const conversion=await runtime.app.intentService.convertContacts({actor,contactIds:[selected.id],expectedContactRevision:current.revision+1,permissionReference:'合成已确认旧来源授权'});assert.equal(conversion.registrations.length,1);linkedRegistrationId=conversion.registrations[0].registrationId;assert.equal(runtime.messages.length,0,'historical integration never sends a formal message');
 }
 const context=await browser.newContext({viewport:{width,height:940}}),[cookieName,...cookieValue]=auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name:cookieName,value:cookieValue.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.addInitScript(()=>{
  window.__ux2={acked:[],quota:false};const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,...args){
   if(this.name==='drafts'&&value?.kind==='pending_submission'&&value.scope?.page?.startsWith('person-confirmation:roles=')){
    if(window.__ux2.quota)throw new DOMException('Synthetic full local storage','QuotaExceededError');
    const raw=value.value.payloadJson;this.transaction.addEventListener('complete',()=>window.__ux2.acked.push(raw),{once:true});
   }return original.call(this,value,...args);
  };
 });
 const page=await context.newPage(),calls=[],controls={lookupStatus:0,personStatus:0,deliveryStatus:0},metrics={durable:false,ackBeforePost:false};
 page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'all requests use intercepted synthetic origin');
  if(path.startsWith('/api/')){
   const entry={path,method:req.method(),raw:req.postData(),query:url.search};calls.push(entry);
   const send=path.startsWith('/api/admin/registration-confirmation/send/');
   assert.ok(req.method()==='GET'||req.method()==='POST'&&(send||['/api/admin/login','/api/admin/logout'].includes(path))||req.method()==='PUT'&&/^\/api\/admin\/contacts\//u.test(path),'only explicit session, single mail and reply actions can write');
   if(path.startsWith('/api/admin/registration-confirmation/operation/')&&controls.lookupStatus){entry.status=controls.lookupStatus;return route.fulfill(json(controls.lookupStatus,'SYNTHETIC_LOOKUP_UNAVAILABLE'));}
   if(path.startsWith('/api/admin/registration-confirmation/delivery/')&&controls.deliveryStatus){entry.status=controls.deliveryStatus;return route.fulfill(json(controls.deliveryStatus,'SYNTHETIC_DELIVERY_UNAVAILABLE'));}
   if(path.startsWith('/api/admin/people/')&&!path.includes('/directory')&&controls.personStatus){const status=controls.personStatus;controls.personStatus=0;entry.status=status;return route.fulfill(json(status,'SYNTHETIC_PERSON_UNAVAILABLE'));}
   if(send){
    const records=await drafts(page),record=records.find(value=>value.kind==='pending_submission'&&value.value?.payloadJson===entry.raw);
    assert.ok(record,'original raw body is committed before the first POST');assert.equal(record.scope.actorId,actor.id);assert.equal(record.scope.entityId,'registration:'+registration.reference_code);assert.equal(record.scope.page,'person-confirmation:roles='+[...actor.roles].sort().join(','));
    assert.deepEqual(Object.keys(record.value).sort(),['method','path','payloadJson']);assert.deepEqual(Object.keys(JSON.parse(entry.raw)).sort(),['expectedRevision','operationId','retryRejected']);
    assert.doesNotMatch(JSON.stringify(record),/example\.invalid|合成单人|receiptToken|confirmationUrl/u);metrics.durable=true;
    metrics.ackBeforePost=await page.evaluate(raw=>window.__ux2.acked.includes(raw),entry.raw);assert.equal(metrics.ackBeforePost,true,'IDB complete ACK precedes network request');
   }
   const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(req.method()==='GET'?{}:{body:entry.raw})}));entry.actualStatus=response.status;
   const body=Buffer.from(await response.arrayBuffer());
   if(send&&lostAck){lostAck=false;assert.equal(response.status,200);entry.status=503;return route.fulfill(json(503,'SYNTHETIC_COMMITTED_ACK_LOST'));}
   entry.status=response.status;return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
  }
  const file=await staticFile(path),body=await readFile(file);assets.set(path,{path,bytes:body.length,sha256:hash(body)});return route.fulfill({status:200,contentType:mime(file),body});
 });
 return{runtime,actor,registration,roster,linkedRegistrationId,context,page,calls,controls,metrics,width};
}
const sends=f=>f.calls.filter(row=>row.path.startsWith('/api/admin/registration-confirmation/send/'));
const localPending=async f=>(await drafts(f.page)).filter(row=>row.scope.page.startsWith('person-confirmation:roles='));
async function person(f,key='registration='+f.registration.reference_code){await f.page.goto(SITE+'/admin/person/#'+key);await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-refresh]:enabled').waitFor();}
async function services(f){const more=f.page.locator('[data-person-more]');if(!await more.evaluate(node=>node.open))await more.locator(':scope>summary').click();await f.page.locator('[data-person-service-open]').click();await f.page.locator('[data-person-confirmation-check]:enabled').waitFor();}
async function readySend(f){await services(f);await f.page.locator('[data-person-confirmation-status]').filter({hasText:'可以寄送'}).waitFor();await f.page.locator('[data-person-confirmation-send]:enabled').waitFor();}
async function pending(f){await f.page.locator('[data-person-confirmation-status]').filter({hasText:'待核对'}).waitFor();await f.page.locator('[data-person-confirmation-check]:enabled').waitFor();assert.equal(await f.page.locator('[data-person-confirmation-send]').isDisabled(),true);}
async function login(f){await f.page.locator('[data-person-login-panel]:visible').waitFor();await f.page.locator('[data-person-login] [name=username]').fill('owner');await f.page.locator('[data-person-login] [name=password]').fill(PEOPLE_FIXTURE_PASSWORD);await f.page.locator('[data-person-login-submit]').click();await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-refresh]:enabled').waitFor();}
async function noOverflow(f){assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at '+f.width);}
async function list(f){await f.page.goto(SITE+'/admin/contacts/');await f.page.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();}
async function search(f,work='all'){await f.page.locator('[data-directory-work]').selectOption(work);await f.page.locator('[data-directory-search] [name=query]').fill('合成队列');await f.page.locator('[data-directory-search] button[type=submit]').click();await f.page.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();await f.page.waitForFunction(()=>!document.querySelector('[data-people-directory]').hasAttribute('aria-busy'));}
async function openRow(f,index=1){const row=f.page.locator('[data-directory-rows] tr').nth(index),key=await row.getAttribute('data-directory-person');await row.locator('[data-directory-primary]').click();await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-next]:enabled').waitFor();return key;}
async function quick(f){const panel=f.page.locator('[data-person-quick-panel]');if(!await panel.evaluate(node=>node.open))await panel.locator(':scope>summary').click();return f.page.locator('[data-person-quick-form]');}
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 await mkdir(evidence,{recursive:true});
 for(const width of[320,390,1440]){
  const f=await fixture(width,{lostAck:true});try{
   await person(f);await readySend(f);assert.equal(await f.page.locator('[data-person-last-check]').isVisible(),false);assert.equal(f.runtime.messages.length,0);await f.page.locator('[data-person-confirmation-send]').click();await pending(f);
   assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);const raw=sends(f)[0].raw,operationId=JSON.parse(raw).operationId;
   f.controls.lookupStatus=404;await f.page.reload();await pending(f);assert.equal((await localPending(f))[0].value.payloadJson,raw);
   f.controls.lookupStatus=503;await f.page.locator('[data-person-confirmation-check]').click();await pending(f);assert.equal((await localPending(f))[0].value.payloadJson,raw);
   f.controls.lookupStatus=0;await f.page.locator('[data-person-confirmation-check]').click();await f.page.locator('[data-person-last-check]:visible').waitFor();assert.equal(await f.page.locator('[data-person-last-check] time').getAttribute('datetime'),'2026-10-21T09:00:00.000Z');await f.page.waitForFunction(()=>document.querySelector('[data-person-confirmation]').hidden);await services(f);await f.page.locator('[data-person-confirmation-status]').filter({hasText:'邮件服务已接收'}).waitFor();assert.equal(await f.page.locator('[data-person-last-check]').isVisible(),true);
   assert.equal((await localPending(f)).length,0);assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);assert.ok(f.calls.filter(row=>row.path.endsWith('/operation/'+operationId)).every(row=>row.method==='GET'&&row.raw===null));
   await noOverflow(f);await f.page.screenshot({path:resolve(evidence,'single-confirmation-'+width+'.png'),fullPage:true});reports.push({width,durableAckBeforePost:f.metrics.ackBeforePost,lostAckReloadOnlyOriginalGet:true,missingAndUnavailableKeepLock:true,serverReadTimeVisibleAcrossRefresh:true,onePostOneMockMail:true,bodySha256:hash(raw),noOverflow:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390);try{await person(f);await readySend(f);await f.page.evaluate(()=>{window.__ux2.quota=true;});await f.page.locator('[data-person-confirmation-send]').click();await f.page.locator('[data-person-confirmation-status]').filter({hasText:'尚未开始寄送'}).waitFor();assert.equal(sends(f).length,0);assert.equal(f.runtime.messages.length,0);assert.equal((await localPending(f)).length,0);reports.push({quotaFailureZeroPostAndMail:true});}finally{await f.context.close();}
 }
 {
  const f=await fixture(390);try{
   await person(f);await readySend(f);f.controls.deliveryStatus=503;await f.page.locator('[data-person-confirmation-send]').click();await f.page.locator('[data-person-confirmation-status]').filter({hasText:'当前寄送状态暂时无法核对'}).waitFor();await f.page.locator('[data-person-confirmation-check]:enabled').waitFor();assert.equal(await f.page.locator('[data-person-confirmation-send]').isDisabled(),true);assert.equal(await f.page.locator('[data-person-confirmation-recipient]').textContent(),'');assert.equal((await localPending(f)).length,0);assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);
   f.controls.deliveryStatus=0;await f.page.locator('[data-person-confirmation-check]').click();await f.page.locator('[data-person-confirmation-status]').filter({hasText:'邮件服务已接收'}).waitFor();assert.equal(await f.page.locator('[data-person-confirmation-send]').isDisabled(),true);assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);reports.push({acceptedPostFailedRefreshClearsStaleEligibility:true,freshReadResolvesWithoutSecondSend:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{unknown:true});try{
   await person(f);await readySend(f);await f.page.locator('[data-person-confirmation-send]').click();await pending(f);const raw=sends(f)[0].raw;
   f.controls.lookupStatus=401;await f.page.reload();await f.page.locator('[data-person-login-panel]:visible').waitFor();assert.equal((await localPending(f))[0].value.payloadJson,raw);assert.equal(await f.page.locator('[data-person-confirmation-recipient]').textContent(),'');assert.equal(await f.page.locator('[data-person-last-check]').textContent(),'');assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('artdico:people-navigation:v1')),null);
   f.controls.lookupStatus=0;await login(f);await pending(f);assert.equal((await localPending(f))[0].value.payloadJson,raw);assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);
   await f.page.locator('[data-person-logout]').click();await f.page.locator('[data-person-login-panel]:visible').waitFor();assert.equal((await drafts(f.page)).filter(row=>row.scope.actorId===f.actor.id).length,0);const before=f.calls.length;
   await login(f);await f.page.locator('[data-person-more]>summary').click();await f.page.locator('[data-person-service-open]').click();assert.equal(await f.page.locator('[data-person-confirmation-send]').isVisible(),false);assert.match(await f.page.locator('[data-person-communications]').textContent(),/待核对|结果不明/u);assert.equal(f.calls.slice(before).some(row=>row.path.includes('/operation/')),false);assert.equal(sends(f).length,1);assert.equal(f.runtime.messages.length,1);reports.push({providerUnknownStaysLocked:true,unauthorizedClearsDomPreservesOpaquePending:true,sameActorRecoveryOnlyGet:true,explicitLogoutClearsActorThenCloudOnly:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{automatic:true});try{await person(f);await services(f);await f.page.locator('[data-person-confirmation-status]').filter({hasText:'邮件服务已接收'}).waitFor();assert.equal(f.calls.some(row=>row.path.includes('/operation/')),false);assert.equal(await f.page.locator('[data-person-last-check]').isVisible(),false);assert.equal(sends(f).length,0);assert.equal((await localPending(f)).length,0);assert.equal(f.runtime.messages.length,2);reports.push({automaticFormalWithoutOperationUsesDeliveryOnly:true,noFakeOperationOrReadTimeOrSend:true});}finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{contacts:4});try{
   const repo=createConfirmationRepository({eventId:PEOPLE_FIXTURE_EVENT,journal:createObjectJournal({objects:f.runtime.objects,prefix:f.runtime.app.confirmationService.prefix}),clock:()=>Date.parse('2026-10-21T09:00:00Z')});
   await repo.append(await repo.read(),'dispatch_started',{operationId:op(),requestHash:'a'.repeat(64),registrationIds:[f.linkedRegistrationId],retryRejected:false},f.runtime.users[1].id);
   const history=await f.runtime.app.confirmationService.staffHistory({actor:f.actor,registrationId:f.linkedRegistrationId});assert.deepEqual(history.notices,[]);assert.equal(history.unresolvedConfirmations,true);
   await list(f);await search(f);const row=f.page.locator('[data-directory-person="contact:'+f.roster[1].id+'"]');assert.match(await row.locator('.people-directory-state').textContent(),/待核对/u);await row.locator('[data-directory-primary]').click();await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-refresh]:enabled').waitFor();
   assert.match(await f.page.locator('[data-person-summary]').textContent(),/寄送待核对/u);assert.doesNotMatch(await f.page.locator('[data-person-summary]').textContent(),/确认信未寄送/u);assert.equal(await f.page.locator('[data-person-primary]').getAttribute('data-action'),'check');assert.equal(await f.page.locator('[data-person-next]').isDisabled(),true);assert.equal((await localPending(f)).length,0);assert.equal(await f.page.locator('[data-person-last-check]').isVisible(),false);
   await f.page.locator('[data-person-more]>summary').click();await f.page.locator('[data-person-service-open]').click();assert.equal(await f.page.locator('[data-person-confirmation-send]').isVisible(),false);assert.equal(f.calls.some(row=>row.path.includes('/operation/')),false);assert.equal(f.calls.some(row=>row.method!=='GET'),false);assert.equal(f.runtime.messages.length,0);reports.push({startedOnlyOtherActorCloudSummaryUnknown:true,noFabricatedNoticeOrOperation:true,nextAndSendBlocked:true,zeroBusinessWritesOrMail:true});
  }finally{await f.context.close();}
 }
 for(const width of[320,390,1440]){
  const f=await fixture(width,{contacts:4});try{
   await list(f);await search(f);await f.page.locator('[data-directory-rows] tr').nth(1).scrollIntoViewIfNeeded();const key=await openRow(f),original=await f.page.evaluate(()=>JSON.parse(sessionStorage.getItem('artdico:people-navigation:v1')));
   assert.equal(original.query,'合成队列');assert.equal(original.work,'all');assert.equal(original.selected,key);assert.ok(original.ids.length<=50);assert.equal(new URL(f.page.url()).hash.includes('合成'),false);assert.equal(JSON.stringify(await drafts(f.page)).includes('合成队列'),false);
   await f.page.locator('[data-person-list-context] [data-person-list-return]').click();await f.page.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();assert.equal(await f.page.locator('[data-directory-search] [name=query]').inputValue(),'合成队列');assert.equal(await f.page.locator('[data-directory-work]').inputValue(),'all');assert.equal(await f.page.locator('[data-directory-person="'+key+'"] [data-directory-primary]').evaluate(node=>node===document.activeElement),true);assert.ok(Math.abs(await f.page.evaluate(()=>scrollY)-original.scrollY)<3);
   await f.page.locator('[data-directory-person="'+key+'"] [data-directory-primary]').click();await f.page.locator('[data-person-next]:enabled').waitFor();const form=await quick(f);await form.locator('[name=notes]').fill('合成已核对备注');assert.equal(await f.page.locator('[data-person-next]').isDisabled(),true);await form.locator('[name=owner]').focus();await form.locator('[name=owner]').press('Enter');await f.page.locator('[data-person-quick-state][data-save-state=saved]').waitFor();await form.locator('[name=owner]:enabled').waitFor();assert.equal(f.page.url().split('#')[1],'contact='+key.split(':')[1]);assert.equal(await form.locator('[name=owner]').evaluate(node=>node===document.activeElement),true);
   await f.page.locator('[data-person-next]:enabled').waitFor();await f.page.locator('[data-person-next]').click();await f.page.waitForURL(url=>url.hash==='#contact='+original.ids[2].split(':')[1]);await f.page.locator('[data-person-record]:visible').waitFor();assert.equal(await f.page.locator('[data-person-navigation-status]').textContent(),'');assert.equal(f.calls.filter(row=>row.method==='PUT').length,1);assert.equal(sends(f).length,0);assert.equal(f.runtime.messages.length,0);await noOverflow(f);await f.page.screenshot({path:resolve(evidence,'person-navigation-'+width+'.png'),fullPage:true});reports.push({width,queryWorkScrollFocusRestored:true,queryOnlyTabSession:true,dirtyBlocksNext:true,saveStaysSamePersonAndFocus:true,explicitNextOneClick:true,finishedNavigationClearsPendingMessage:true,noMailFromNavigation:true,noOverflow:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{contacts:54});try{
   await list(f);await search(f);await f.page.locator('[data-directory-next]').click();await f.page.waitForFunction(()=>!document.querySelector('[data-people-directory]').hasAttribute('aria-busy'));assert.equal(await f.page.locator('[data-directory-rows] tr').count(),4);await openRow(f,1);
   const form=await quick(f);await form.locator('[name=notes]').fill('合成分页保存');await f.page.locator('[data-person-quick-save]').click();await f.page.locator('[data-person-quick-state][data-save-state=saved]').waitFor();await f.page.locator('[data-person-next]:enabled').waitFor();const before=f.page.url();await f.page.locator('[data-person-next]').click();await f.page.locator('[data-person-navigation-status]').filter({hasText:'名单已更新，请返回名单核对'}).waitFor();assert.equal(f.page.url(),before,'stale cursor cannot wrap to the first unrelated person');
   await f.page.locator('[data-person-list-context] [data-person-list-return]').click();await f.page.locator('[data-directory-status]').filter({hasText:'名单已更新'}).waitFor();assert.equal(await f.page.locator('[data-directory-search] [name=query]').inputValue(),'合成队列');assert.equal(await f.page.locator('[data-directory-work]').inputValue(),'all');assert.equal(await f.page.locator('[data-directory-rows] tr').count(),50);assert.equal(await f.page.locator('[data-directory-title]').evaluate(node=>node===document.activeElement),true);assert.ok(f.calls.some(row=>row.path==='/api/admin/people/directory'&&row.status===409));
   await f.page.locator('[data-contacts-logout]').click();await f.page.locator('[data-contacts-login-panel]:visible').waitFor();assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('artdico:people-navigation:v1')),null);reports.push({staleCursorRereadsFirstPageKeepingQueryAndFilter:true,noUntrustedNextWrap:true,noStaleRowFocus:true,logoutClearsNavigation:true});
  }finally{await f.context.close();}
 }
 assert.deepEqual(errors,[]);const provenance={dist,personHtmlSha256:hash(await readFile(await staticFile('/admin/person/'))),contactsHtmlSha256:hash(await readFile(await staticFile('/admin/contacts/'))),assets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path))};const result={passed:true,cases:reports.length,reports,pageErrors:errors,provenance};await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await browser.close();}
