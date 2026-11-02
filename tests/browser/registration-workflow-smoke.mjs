// Real browser + actual isolated runtime. Every request uses synthetic fixtures.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_API as API, PEOPLE_FIXTURE_PUBLIC as SITE } from '../helpers/people-runtime-fixture.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence'));
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],reports=[];
const legacyFields=['status','recommendation','proposedRole','lastContactDate','mariaReviewDate','mariaFeedback','mariaDecision','invitationStatus'];
const legacyReview={status:'not_this_time',accommodationStatus:'not_requested',recommendation:'priority',proposedRole:'合成旧建议角色',internalNotes:'合成原备注',assignedTo:'合成原负责人',lastContactDate:'2026-10-19',nextStep:'合成原下一步',mariaReviewDate:'2026-10-20',mariaFeedback:'合成旧审阅反馈',mariaDecision:'discussion',invitationStatus:'sent'};
const legacyPart=review=>Object.fromEntries(legacyFields.map(name=>[name,review[name]]));
async function fixture(width){
  const runtime=await peopleRuntimeFixture({capacity:4,mail:false});
  const imported=await runtime.app.registrationService.submitStaffRegistration({actor:runtime.users[0],sourceContactId:'synthetic-ticket-import',
    input:{fields:{name:'合成导入参会者',email:'synthetic.import@example.invalid',organization:'合成机构'},permissionReference:'synthetic-explicit-permission'}});
  assert.equal(imported.outcome,'created');
  const pending=await runtime.seedPublic({intake:'general-v2',name:'合成待审核者'});
  const headers=await runtime.login();
  async function api(path,options={}){const response=await runtime.app.handle(runtime.request(path,{...options,headers}));const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;}
  const original=await api('/api/admin/registrations/'+imported.receipt.registrationId);
  await api('/api/admin/registrations/'+imported.receipt.registrationId+'/review',{method:'PATCH',body:{expectedRevision:original.revision,review:legacyReview}});
  const context=await browser.newContext({viewport:{width,height:900}});
  const [name,...value]=headers.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date('2026-10-21T09:00:00Z'));
  const dialogs=[],confirmDecisions=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{
    const accepted=dialog.type()==='confirm'&&confirmDecisions.length?confirmDecisions.shift():true;
    dialogs.push({type:dialog.type(),message:dialog.message(),accepted});
    if(accepted)await dialog.accept(dialog.type()==='prompt'?'request':undefined);else await dialog.dismiss();
  });
  let links=0,expireLink=false,loseReviewAck=false,releaseResult=null,rawConfirmedAdmission=false,cachedAdmissions=null;const reviewWrites=[],networkWrites=[];
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.ok([SITE,API].includes(url.origin),'no unmocked network origin');
    if(url.origin===API&&url.pathname.startsWith('/api/')){
      if(!['GET','HEAD','OPTIONS'].includes(request.method()))networkWrites.push({method:request.method(),path:url.pathname});
      const reviewWrite=request.method()==='PATCH'&&url.pathname.endsWith('/review');
      if(reviewWrite)reviewWrites.push({path:url.pathname,body:request.postData()});
      if(url.pathname.includes('/registration-confirmation/link/')){
        links++;
        if(expireLink)return route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:{code:'AUTH_REQUIRED'}})});
      }
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),
        ...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
      if(reviewWrite&&loseReviewAck){loseReviewAck=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_LOST_ACK'}})});}
      let body=Buffer.from(await response.arrayBuffer());
      if(reviewWrite&&releaseResult&&response.status===200){const value=JSON.parse(body);value.admissionRelease=releaseResult;body=Buffer.from(JSON.stringify(value));}
      if(request.method()==='GET'&&url.pathname==='/api/admin/admissions'&&response.status===200){
        if(rawConfirmedAdmission&&cachedAdmissions)body=cachedAdmissions;else cachedAdmissions=body;
      }
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
    }
    const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',webp:'image/webp',png:'image/png',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  async function open({expectConfirmed=true}={}){await page.goto(API+'/admin/registrations/',{waitUntil:'domcontentloaded'});await page.locator('[data-review-workspace]:visible').waitFor();if(expectConfirmed)await page.waitForFunction(()=>[...document.querySelectorAll('[data-review-admission-row]')].some(el=>el.dataset.admissionState==='confirmed'));}
  async function select(name){await page.locator('[data-review-rows] tr').filter({hasText:name}).getByRole('button',{name:'查看与核查'}).click();await page.locator('[data-review-dialog][open]').waitFor();}
  return{runtime,context,page,open,select,api,id:imported.receipt.registrationId,pending,reviewWrites,networkWrites,dialogs,confirmOnce:accepted=>confirmDecisions.push(accepted),mockRelease:result=>{releaseResult=result;},staleAdmissions:()=>{assert.ok(cachedAdmissions,'a confirmed raw admission snapshot was read first');assert.equal(JSON.parse(cachedAdmissions).people.find(person=>person.registrationId===imported.receipt.registrationId)?.status,'confirmed');rawConfirmedAdmission=true;},loseReviewAck:()=>{loseReviewAck=true;},linkCount:()=>links,expire:()=>{expireLink=true;}};
}
async function draftRows(page){return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}});}
async function seedOldDraft(f,fields){
  const detail=await f.api('/api/admin/registrations/'+f.id),actor=f.runtime.users[0];
  await f.page.evaluate(async({actor,id,baseRevision,fields})=>{
    const scope={actorId:actor.id,eventId:'ggj-cn-2026',page:'review:roles='+[...actor.roles].sort().join(','),entityId:id},key=JSON.stringify([scope.actorId,scope.eventId,scope.page,scope.entityId]),now=Date.now();
    const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1',1);request.onupgradeneeded=()=>{for(const name of ['drafts','heads','actors'])if(!request.result.objectStoreNames.contains(name))request.result.createObjectStore(name,{keyPath:name==='actors'?'actorId':'key'});};request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try{await new Promise((resolve,reject)=>{const tx=db.transaction(['drafts','heads'],'readwrite');tx.objectStore('heads').put({key,actorId:actor.id,revision:1});tx.objectStore('drafts').put({key,scope,revision:1,actorEpoch:0,kind:'editing',baseRevision,value:{fields},updatedAt:now,expiresAt:now+7*24*60*60*1000,pendingFields:['path','method','payloadJson']});tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error);});}finally{db.close();}
  },{actor:{id:actor.id,roles:actor.roles},id:f.id,baseRevision:detail.revision,fields});
}
async function assertReadonlyHistory(page,expected=legacyReview,{initial=true}={}){
  const group=page.locator('[data-review-legacy-records]');
  if(initial)assert.equal(await group.evaluate(el=>el.open),false,'old review history starts collapsed');
  assert.equal(await group.locator('input,select,textarea').count(),0,'old review values are readable history, not another editable form');
  for(const name of legacyFields)assert.equal(await page.locator('[data-review-form] [name="'+name+'"]').count(),0,'retired input '+name+' is absent');
  if(!await group.evaluate(el=>el.open))await group.locator('summary').click();const text=await page.locator('[data-review-legacy]').innerText();
  for(const value of [expected.proposedRole,expected.lastContactDate,expected.mariaReviewDate,expected.mariaFeedback])assert.ok(text.includes(value),'old review history retains '+value);
  await group.locator('summary').click();
}
function assertWithdrawalImpact(message){for(const term of ['释放名额','候补','正式确认信','私人参会页','群码','新票券'])assert.ok(message.includes(term),'withdrawal preview includes '+term);}
async function assertReleaseFollowup(page,{pending=false,promoted=0}={}){
  await page.locator('[data-review-release-result]:visible').waitFor();
  const status=await page.locator('[data-review-release-status]').innerText();
  assert.ok(status.includes('撤回'),'saved withdrawal has its own result');
  if(pending){for(const term of ['名额','候补','通知','待核对'])assert.ok(status.includes(term),'pending release retains follow-up context '+term);assert.doesNotMatch(status,/名额已释放/u);}
  else{assert.ok(status.includes('名额已释放'));if(promoted){assert.match(status,new RegExp(promoted+'\\s*位候补已转正','u'));assert.match(status,/通知待核对/u);}else assert.doesNotMatch(status,/候补已转正|通知已处理/u);}
  assert.equal(await page.locator('[data-review-release-open]').isVisible(),true);
  assert.equal(await page.locator('[data-review-release-open]').innerText(),'核对名额与通知');
  assert.equal(await page.locator('[data-review-release-open]').isEnabled(),true);
}
async function restoreReviewDraft(page,{pending=false}={}){
  const panel=page.locator('[data-review-form] [data-operations-local-draft]');
  await panel.getByRole('button',{name:pending?'恢复待核对操作':'恢复本机填写',exact:true}).click();
  if(pending)await page.locator('[data-review-form] [data-save-state=unknown]').waitFor();
  else await page.waitForFunction(()=>document.querySelector('[data-review-form] [data-operations-local-draft]')?.dataset.operationsDraftState==='restored');
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
    assert.equal(await page.locator('.review-summary-table').evaluate(table=>{
      const wrap=table.closest('.ah-admin-table-wrap');return wrap.scrollWidth<=wrap.clientWidth+1;
    }),true,'the daily list does not hide its actions inside a horizontal scroller');
    for(const button of await page.locator('[data-review-rows] button').all()){
      const box=await button.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width,'review action stays inside the viewport');
    }
    assert.doesNotMatch(await page.locator('[data-review-rows]').innerText(),/新报名|内部建议/u);
    await page.screenshot({path:resolve(evidence,'registration-list-'+width+'.png'),fullPage:true});
    await f.select('合成导入参会者');
    assert.equal(await page.locator('[data-review-dialog]').evaluate(dialog=>dialog.scrollTop),0,'a newly selected person opens at their name and admission status');
    assert.equal(await page.locator('[data-review-detail-title]').evaluate(heading=>document.activeElement===heading),true);
    assert.match(await page.locator('[data-review-admission-status]').innerText(),/已确认/u);
    assert.equal(await page.locator('[data-review-approval-actions]').isVisible(),false);
    assert.equal(await page.locator('.review-original').evaluate(el=>el.open),false);
    assert.equal(await page.locator('[data-review-form] .review-detail-group').first().evaluate(el=>el.open),false);
    await assertReadonlyHistory(page);
    assert.equal(await page.locator('[data-review-form] [name=accommodationStatus]').count(),1,'accommodation remains a separate daily control');
    await page.screenshot({path:resolve(evidence,'registration-detail-'+width+'.png'),fullPage:false});
    const before=await f.runtime.app.registrationService.repository.readIndex();
    await page.locator('[data-review-confirmation-prepare]').click();
    await page.locator('[data-review-confirmation-result]:visible').waitFor();
    const url=await page.locator('[data-review-confirmation-open]').getAttribute('href');
    assert.ok(url.startsWith(SITE+'/registration/confirmation/#r=c1.'));
    const response=await f.runtime.app.handle(new Request(API+'/api/admin/registration/confirmation',{method:'POST',headers:{Origin:SITE,'Content-Type':'application/json'},body:JSON.stringify({receiptToken:new URL(url).hash.slice(3)})}));
    assert.equal(response.status,200);const value=await response.json();
    assert.equal(value.attendee.name,'合成导入参会者');assert.equal(value.admission.status,'confirmed');assert.equal(value.email.status,'not_configured');
    assert.equal(f.runtime.messages.length,0);assert.deepEqual((await f.runtime.app.registrationService.repository.readIndex()).value,before.value);
    const scope=page.locator('[data-review-form] .review-detail-group').first();await scope.locator('summary').click();
    await scope.locator('[name=assignedTo]').fill('合成当前负责人');await scope.locator('[name=nextStep]').fill('合成当前下一步');
    await scope.locator('[name=internalNotes]').fill('合成备注保存后保留编辑区');await page.locator('[data-review-save]').click();
    await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    assert.equal(await scope.evaluate(el=>el.open),true,'saving keeps the current editor open');
    assert.equal(await scope.locator('[name=internalNotes]').inputValue(),'合成备注保存后保留编辑区');
    const saved=await f.api('/api/admin/registrations/'+f.id);
    assert.deepEqual(legacyPart(saved.review),legacyPart(legacyReview),'daily save preserves every retired field, including old non-withdrawn status');
    assert.equal(saved.review.assignedTo,'合成当前负责人');assert.equal(saved.review.nextStep,'合成当前下一步');
    await scope.screenshot({path:resolve(evidence,'registration-daily-fields-'+width+'.png')});
    await page.locator('[data-review-legacy-records]').screenshot({path:resolve(evidence,'registration-legacy-collapsed-'+width+'.png')});
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
    assert.equal(await page.locator('[data-review-legacy]').textContent(),'','session invalidation clears old private review history');
    assert.equal(await page.locator('[data-review-confirmation-fallback]').inputValue(),'');
    await f.context.close();reports.push({width,compactList:true,importedConfirmedLink:true,noRegistrationOrEmail:true,readonlyLegacyPreserved:true,internalEditorRetained:true,pendingHasNoTicket:true,sessionClearsPrivateLink:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();
    const restored={...legacyReview,status:'awaiting_maria',recommendation:'consider',proposedRole:'合成本机旧建议角色',lastContactDate:'2026-10-18',mariaReviewDate:'2026-10-19',mariaFeedback:'合成本机旧审阅反馈',mariaDecision:'approved',invitationStatus:'to_send',internalNotes:'合成本机旧表单备注'};
    await seedOldDraft(f,restored);await f.select('合成导入参会者');
    await restoreReviewDraft(page);
    const scope=page.locator('[data-review-form] .review-detail-group').first();
    assert.equal(await scope.locator('[name=internalNotes]').inputValue(),restored.internalNotes,'old full-form editing draft restores current fields');
    await assertReadonlyHistory(page,restored,{initial:false});
    assert.equal(f.reviewWrites.length,0,'restoring an old editing draft never writes to the server');
    await page.locator('[data-review-save]').click();await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    assert.deepEqual(legacyPart((await f.api('/api/admin/registrations/'+f.id)).review),legacyPart(restored),'later save retains even old editing-draft values for retired fields');
    assert.equal(f.reviewWrites.length,1);await f.context.close();reports.push({oldFullReviewDraftRestoresReadonlyHistory:true,legacyDraftValuesSurviveDailySave:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();
    const restored={...legacyReview,status:'withdrawn',internalNotes:'合成本机撤回草稿保留'};
    await seedOldDraft(f,restored);await f.select('合成导入参会者');
    await restoreReviewDraft(page);
    const original=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(original.kind,'editing');assert.deepEqual(original.value.fields,restored);
    f.confirmOnce(false);await page.locator('[data-review-save]').click();
    const rejected=f.dialogs.filter(dialog=>dialog.type==='confirm').at(-1);assert.equal(rejected.accepted,false);assertWithdrawalImpact(rejected.message);
    assert.equal(f.reviewWrites.length,0,'a restored withdrawn draft cannot bypass the shared withdrawal confirmation');
    const kept=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(kept.kind,'editing');assert.deepEqual(kept.scope,original.scope);assert.deepEqual(kept.value.fields,original.value.fields,'cancel preserves the original full editing draft instead of clearing it');
    assert.equal((await f.api('/api/admin/registrations/'+f.id)).review.status,legacyReview.status);
    assert.equal(await page.locator('[data-review-save]').isEnabled(),true,'cancelled withdrawal remains reviewable and editable');
    f.confirmOnce(true);await page.locator('[data-review-save]').click();await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    const accepted=f.dialogs.filter(dialog=>dialog.type==='confirm').at(-1);assert.equal(accepted.accepted,true);assertWithdrawalImpact(accepted.message);
    assert.equal(f.reviewWrites.length,1,'only accepting the common impact preview sends the original review mutation');
    assert.equal((await f.api('/api/admin/registrations/'+f.id)).review.status,'withdrawn');await assertReleaseFollowup(page);
    await f.context.close();reports.push({restoredWithdrawalUsesCommonImpactPreview:true,cancelPreservesOriginalDraftAndNoWrite:true,acceptedWithdrawalWritesOnce:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();await f.select('合成导入参会者');
    const scope=page.locator('[data-review-form] .review-detail-group').first();await scope.locator('summary').click();
    await scope.locator('[name=internalNotes]').fill('合成回执丢失后保留原正文');f.loseReviewAck();await page.locator('[data-review-save]').click();
    await page.locator('[data-review-form] [data-save-state=unknown]').waitFor();
    await page.screenshot({path:resolve(evidence,'registration-unknown-save-390.png'),fullPage:false});
    const original=f.reviewWrites[0],pending=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(pending.kind,'pending_submission');assert.equal(pending.value.payloadJson,original.body);assert.equal(pending.value.uncertain,true);
    assert.deepEqual(legacyPart(JSON.parse(original.body).review),legacyPart(legacyReview));
    await f.open();await f.select('合成导入参会者');
    await restoreReviewDraft(page,{pending:true});
    assert.equal(await page.locator('[data-review-save]').isDisabled(),true,'unknown original write remains locked after refresh and restore');
    assert.equal(f.reviewWrites.length,1,'restoring unknown review only restores its original operation, without another PATCH');
    const recovered=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(recovered.kind,'pending_submission');assert.equal(recovered.value.payloadJson,original.body,'pending body stays byte-for-byte intact across recovery');
    assert.deepEqual(legacyPart((await f.api('/api/admin/registrations/'+f.id)).review),legacyPart(legacyReview));
    assert.equal(f.runtime.messages.length,0);await f.context.close();reports.push({unknownReviewRecoveryPreservesExactBody:true,noBlindResave:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();await f.select('合成导入参会者');
    f.mockRelease({status:'released',promotedCount:1,promotionEmail:{status:'pending',attemptedCount:0,pendingCount:1}});
    await page.locator('.review-delete-tools summary').click();await page.locator('[data-review-withdraw]').click();
    await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    const withdrawn=await f.api('/api/admin/registrations/'+f.id);
    assert.equal(withdrawn.review.status,'withdrawn','controlled withdrawal still writes the existing review status');
    assert.deepEqual(legacyPart(withdrawn.review),{...legacyPart(legacyReview),status:'withdrawn'},'withdrawal leaves all other old review facts intact');
    assertWithdrawalImpact(f.dialogs.filter(dialog=>dialog.type==='confirm').at(-1).message);await assertReleaseFollowup(page,{promoted:1});
    assert.equal(await page.locator('[data-review-ticket]').isVisible(),false,'withdrawal invalidates new private-ticket retrieval');
    if(!await page.locator('.review-delete-tools').evaluate(el=>el.open))await page.locator('.review-delete-tools summary').click();
    await page.locator('[data-review-deletion]').click();
    await page.locator('[data-review-deletion-state]').filter({hasText:'已登记删除申请'}).waitFor();
    const deleted=await f.api('/api/admin/registrations/'+f.id);
    assert.equal(deleted.review.deletionRequested.reason,'request');assert.equal(deleted.review.deletionRequested.status,'pending');
    assert.equal(deleted.review.status,'withdrawn');assert.equal(f.runtime.messages.length,0);
    await f.context.close();reports.push({controlledWithdrawalPreserved:true,promotedPendingEmailKeepsFollowupVisible:true,deletionRequestRetainedWithoutErasure:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();await f.select('合成导入参会者');
    await page.locator('[data-review-confirmation-prepare]').click();await page.locator('[data-review-confirmation-result]:visible').waitFor();
    assert.ok(await page.locator('[data-review-confirmation-open]').getAttribute('href'));
    f.loseReviewAck();await page.locator('.review-delete-tools summary').click();await page.locator('[data-review-withdraw]').click();
    await page.locator('[data-review-form] [data-save-state=unknown]').waitFor();
    const original=f.reviewWrites[0],pending=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(JSON.parse(original.body).review.status,'withdrawn');assert.equal(pending.kind,'pending_submission');assert.equal(pending.value.payloadJson,original.body);assert.equal(pending.value.uncertain,true);
    const status=await page.locator('[data-review-admission-status]').innerText();
    assert.match(status,/待核对/u);assert.doesNotMatch(status,/已确认|报名已撤回/u,'unknown withdrawal does not claim a confirmed seat or a completed withdrawal');
    assert.equal(await page.locator('[data-review-ticket]').isVisible(),false);assert.equal(await page.locator('[data-review-confirmation-open]').getAttribute('href'),null,'unknown withdrawal clears the previously prepared credential immediately');
    await page.screenshot({path:resolve(evidence,'registration-unknown-withdrawal-390.png'),fullPage:false});
    const confirmations=f.dialogs.filter(dialog=>dialog.type==='confirm').length;
    await f.open({expectConfirmed:false});await f.select('合成导入参会者');
    await restoreReviewDraft(page,{pending:true});
    assert.equal(f.reviewWrites.length,1,'recovering an unknown withdrawal never sends another PATCH');
    assert.equal(f.dialogs.filter(dialog=>dialog.type==='confirm').length,confirmations,'recovering the exact pending withdrawal does not request a new confirmation');
    const recovered=(await draftRows(page)).find(row=>row.scope.entityId===f.id);
    assert.equal(recovered.kind,'pending_submission');assert.equal(recovered.value.payloadJson,original.body);assert.equal(JSON.parse(recovered.value.payloadJson).review.status,'withdrawn');
    assert.equal(await page.locator('[data-review-save]').isDisabled(),true);assert.equal(await page.locator('[data-review-ticket]').isVisible(),false);assert.equal(await page.locator('[data-review-confirmation-open]').getAttribute('href'),null);
    assert.equal(f.runtime.messages.length,0);await f.context.close();reports.push({unknownWithdrawalStopsCredentialsImmediately:true,unknownWithdrawalExactRecoveryWithoutNewConfirmation:true,noBlindWithdrawalResave:true});
  }
  {
    const f=await fixture(390),{page}=f;await f.open();await f.select('合成导入参会者');
    await page.locator('[data-review-confirmation-prepare]').click();await page.locator('[data-review-confirmation-result]:visible').waitFor();
    assert.ok(await page.locator('[data-review-confirmation-open]').getAttribute('href'),'a previously prepared private link exists before withdrawal');
    f.mockRelease({status:'pending'});f.staleAdmissions();
    await page.locator('.review-delete-tools summary').click();await page.locator('[data-review-withdraw]').click();
    await page.locator('[data-review-form] [data-save-state=saved]').waitFor();
    assert.equal((await f.api('/api/admin/registrations/'+f.id)).review.status,'withdrawn');
    const status=await page.locator('[data-review-admission-status]').innerText();
    assert.doesNotMatch(status,/已确认/u,'saved withdrawal outranks a stale raw confirmed admission index');assert.match(status,/待核对/u);
    assert.equal(await page.locator('[data-review-ticket]').isVisible(),false);assert.equal(await page.locator('[data-review-confirmation-open]').getAttribute('href'),null,'inactive review clears the previously prepared private credential');
    await assertReleaseFollowup(page,{pending:true});const writes=f.networkWrites.length;
    await page.locator('[data-review-admission]').screenshot({path:resolve(evidence,'registration-pending-release-card-390.png')});
    await page.screenshot({path:resolve(evidence,'registration-pending-release-390.png'),fullPage:false});
    await page.locator('[data-review-release-open]').click();await page.waitForFunction(()=>document.querySelector('.review-tools')?.open===true);
    assert.equal(await page.locator('[data-review-dialog]').evaluate(el=>el.open),false,'follow-up returns to the existing tools');
    assert.equal(f.networkWrites.length,writes,'opening quota and notification follow-up never adds another mutation');
    await f.context.close();reports.push({pendingReleaseOutranksStaleConfirmedIndex:true,oldCredentialClearedImmediately:true,existingToolsFollowupNoWrite:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:reports,pageErrors:errors},null,2));
}finally{await browser.close();}
