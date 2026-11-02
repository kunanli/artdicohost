// Real built person page over the actual isolated application and memory-only OSS.
// Every request is intercepted. No real contacts, credentials, mail or admissions.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/p2-person');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE,PEOPLE_FIXTURE_PASSWORD}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const PRIVATE='SYNTHETIC_P2_ORIGINAL_ANSWER_NEVER_IMPLICITLY_PROJECT';
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';

async function drafts(page){return page.evaluate(()=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('artdico-browser-drafts-v1',1);
  request.onerror=()=>reject(request.error);
  request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve([]);return;}const tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').getAll();read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};
}));}
async function fixture(browser,width){
  const runtime=await peopleRuntimeFixture({capacity:10,mail:false});
  const first=(await runtime.createContact({name:'合成旧意向甲',organization:'合成参与机构',background:PRIVATE})).contact;
  const second=(await runtime.createContact({name:'合成旧意向乙',email:'synthetic.p2.second@example.invalid',background:PRIVATE+' SECOND'})).contact;
  const snapshot=await runtime.app.store.read(),content=snapshot.draft.content;
  content.organizations=[{id:'p2-person-org',name:'合成参与机构',logoId:'',website:'',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:PRIVATE}];
  content.sessions=[{id:'p2-person-session',start:'10:00',end:'11:00',zone:'A',title:'合成原场次',format:'talk',guestId:'',speakerName:'',speakerStatus:'pending',status:'scheduled',internalNotes:PRIVATE}];
  content.booths=[{id:'p2-person-booth',code:'C-32',slotNumber:32,zone:'C',organization:'合成参与机构',project:'合成原作品',status:'confirmed',organizationId:'p2-person-org',internalNotes:PRIVATE}];
  await runtime.app.store.save(snapshot.draft.revision,content,runtime.users[0].id);
  const roster=await runtime.app.contactsStore.read();
  await runtime.app.contactsStore.saveOperations(first.id,roster.revision,{...first.operations,responseStatus:'attending',owner:'合成负责同事',notes:'合成先前沟通',participationForms:['speaker','booth'],sessionIds:['p2-person-session'],sessionRoles:[{sessionId:'p2-person-session',roles:['speaker']}],boothIds:['p2-person-booth'],organizationMemberships:[{organizationId:'p2-person-org',role:'lead',title:'合成组织负责人'}]},runtime.users[0].id);
  const converted=await runtime.app.intentService.convertContacts({actor:runtime.users[0],contactIds:[first.id],expectedContactRevision:roster.revision+1,permissionReference:'合成历史本人答应出席及沿用原来源授权'});
  assert.equal(converted.registrations.length,1);const registrationId=converted.registrations[0].registrationId;
  const original=(await runtime.app.contactsStore.read()).contacts.find(item=>item.id===first.id);
  const admissions=await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]});
  const context=await browser.newContext({viewport:{width,height:940}}),calls=[],dialogs=[];
  const auth=await runtime.login(),[name,...value]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  let page,saveFault=null,profileFault=null,syncUnknown=false,readFault=null,linkBudget=0,loginBudget=0,legacyUnknown=null;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.ok([API,SITE].includes(url.origin),'every origin stays inside intercepted fixtures');
    if(url.pathname.startsWith('/api/')){
      assert.equal(url.origin,API);
      const raw=request.postData(),entry={path:url.pathname,method:request.method(),raw};calls.push(entry);
      const profileWrite=request.method()==='PATCH'&&/^\/api\/admin\/registrations\/[A-Za-z0-9_-]{43}\/profile$/u.test(url.pathname);
      if(!['GET','HEAD','OPTIONS'].includes(request.method()))assert.ok(profileWrite||request.method()==='PUT'&&[first.id,second.id].some(id=>url.pathname==='/api/admin/contacts/'+id)||request.method()==='POST'&&['/api/admin/logout','/api/admin/login'].includes(url.pathname),'only explicit profile/reply saves and session actions may write');
      if(url.pathname==='/api/admin/login'){assert.ok(loginBudget>0,'login follows an explicit test action');loginBudget--;}
      if(url.pathname.includes('/registration-confirmation/link/')){assert.ok(linkBudget>0,'credential is fetched only for an explicit selected-person action');linkBudget--;}
      if(request.method()==='PUT'||profileWrite){
        const local=await drafts(page),pending=local.find(row=>row.kind==='pending_submission'&&row.value?.payloadJson===raw);
        assert.ok(pending,'the exact original body is durable locally before the first network write');
        assert.equal(pending.scope.actorId,runtime.users[0].id);assert.ok(pending.scope.entityId.includes(profileWrite?url.pathname.split('/').at(-2):url.pathname.split('/').at(-1)));
      }
      if(profileWrite&&profileFault==='before'){profileFault=null;entry.status=503;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_BEFORE_SAVE_ACK',message:'合成保存前断线'}})});}
      if(profileWrite&&profileFault==='conflict'){profileFault=null;entry.status=409;return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_PRESTART_PROFILE_CONFLICT',message:'合成版本冲突'}})});}
      if(readFault&&request.method()==='GET'&&url.pathname.startsWith('/api/admin/people/contacts/')){
        const status=readFault;readFault=null;entry.status=status;
        return route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:{code:status===401?'AUTH_REQUIRED':'PERSON_UNAVAILABLE',message:status===401?'请先登录。':'人员资料暂时无法核对，请稍后重新读取。'}})});
      }
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(['GET','HEAD'].includes(request.method())?{}:{body:raw})}));
      const headers=Object.fromEntries(response.headers);delete headers['content-length'];entry.actualStatus=response.status;
      let body=Buffer.from(await response.arrayBuffer());
      if(profileWrite&&profileFault==='after'){assert.equal(response.status,200,'lost profile acknowledgement follows a durable save');profileFault=null;entry.status=503;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_PROFILE_LOST_ACK',message:'合成资料回执遗失'}})});}
      if(saveFault&&request.method()==='PUT'){
        assert.equal(response.status,200,'lost acknowledgement follows a real durable save');saveFault=null;entry.status=503;
        return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'SYNTHETIC_LOST_ACK',message:'合成回执遗失'}})});
      }
      if(syncUnknown&&request.method()==='PUT'){
        assert.equal(response.status,200);const value=JSON.parse(body.toString('utf8'));assert.equal(value.replySaved,true);
        value.admission={status:'unavailable'};body=Buffer.from(JSON.stringify(value));syncUnknown=false;entry.syncAcknowledgement='unavailable';
      }
      if(legacyUnknown&&request.method()==='GET'&&url.pathname==='/api/admin/people/contacts/'+first.id){
        assert.equal(response.status,200);const value=JSON.parse(body.toString('utf8'));
        assert.ok(value.communications.timeline.every(item=>!['unknown','reserved','issuing'].includes(item.status)),'the relevant unknown is outside the visible synthetic history');
        value.communications.historyTruncated=true;value.communications.invitationTotal=201;
        if(legacyUnknown==='flagged'){value.communications.unresolvedInvitations=true;value.communications.unresolvedConfirmations=false;}
        else{delete value.communications.unresolvedInvitations;delete value.communications.unresolvedConfirmations;}
        body=Buffer.from(JSON.stringify(value));
      }
      entry.status=response.status;return route.fulfill({status:response.status,headers,body});
    }
    const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  page=await context.newPage();page.setDefaultTimeout(15000);await page.clock.setSystemTime(new Date('2026-10-21T09:00:00.000Z'));
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{if(dialog.type()==='beforeunload'){void dialog.accept();return;}dialogs.push(dialog.message());void dialog.dismiss();});
  return {runtime,context,page,calls,dialogs,width,first,second,registrationId,original,admissions,loseSaveAck:()=>{saveFault='lost';},loseProfileAck:mode=>{profileFault=mode;},conflictProfile:()=>{profileFault='conflict';},loseSyncResult:()=>{syncUnknown=true;},failRead:status=>{readFault=status;},allowLink:()=>{linkBudget++;},allowLogin:()=>{loginBudget++;},showLegacyUnknown:mode=>{legacyUnknown=mode;}};
}
async function open(f,id=f.first.id){await f.page.goto(API+'/admin/person/#contact='+encodeURIComponent(id),{waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();}
async function quick(f){
  const form=f.page.locator('[data-person-quick-form]');
  if(!await form.isVisible()){
    const edit=f.page.locator('[data-person-quick-edit]');
    if(await edit.count())await edit.click();else await form.locator('xpath=ancestor::details[1]').locator('summary').first().click();
  }
  await form.waitFor({state:'visible'});return form;
}
async function saved(f){await f.page.locator('[data-person-quick-state][data-save-state=saved]').waitFor();}
async function noOverflow(f){assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at '+f.width);}
async function shot(f,name){await noOverflow(f);const path=resolve(evidence,name+'-'+f.width+'.png');await f.page.screenshot({path,fullPage:true});await f.page.screenshot({path:resolve(evidence,name+'-'+f.width+'-viewport.png')});return path;}
async function currentContact(f){return (await f.runtime.app.contactsStore.read()).contacts.find(row=>row.id===f.first.id);}
async function protectedRelations(f){const current=await currentContact(f);for(const key of ['priority','sessionIds','sessionRoles','boothIds','participationForms','organizationMemberships'])assert.deepEqual(current.operations[key],f.original.operations[key],key+' is preserved');assert.deepEqual(current.source,f.original.source);assert.deepEqual(current.sourceProfile,f.original.sourceProfile);assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.admissions,'reply and follow-up updates preserve the existing formal admission');assert.equal(f.runtime.messages.length,0);}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width);
    try{
      await open(f);
      assert.equal(await f.page.locator('[data-person-primary]:visible').count(),1,'one prominent next action');
      assert.equal(await f.page.locator('[data-person-record] button.ah-admin-primary:visible').count(),1,'only one visible action has primary emphasis');
      assert.equal(f.calls.filter(call=>call.path.includes('/registration-confirmation/link/')).length,0);
      assert.equal(await f.page.locator('[data-person-more]').evaluate(node=>node.open),false);
      assert.equal(f.calls.filter(call=>call.path.endsWith('/source')).length,0,'original questionnaire is not prefetched');
      await f.page.locator('[data-person-more] > summary').click();
      await f.page.locator('[data-person-source-panel] > summary').click();
      await f.page.waitForFunction(text=>document.querySelector('[data-person-source]')?.textContent.includes(text),PRIVATE);
      assert.deepEqual(f.calls.filter(call=>call.path.endsWith('/source')).map(call=>call.path),['/api/admin/people/contacts/'+f.first.id+'/source']);
      assert.equal(f.calls.some(call=>call.path==='/api/admin/contacts'),false,'selected original answers never require a whole-roster request');
      await f.page.locator('[data-person-source-panel] > summary').click();
      await f.page.waitForFunction(()=>document.querySelector('[data-person-source]')?.textContent==='');
      await f.page.locator('[data-person-more] > summary').click();
      const initialShot=await shot(f,'person-summary'),form=await quick(f);
      await form.locator('[name=responseStatus]').selectOption('pending');
      await form.locator('[name=notes]').fill('合成同一页保存并保留焦点');
      const owner=form.locator('[name=owner]');await owner.fill('合成新负责同事');await owner.focus();
      await f.page.locator('[data-person-quick-save]:enabled').waitFor();
      assert.equal(await f.page.locator('[data-person-record] button.ah-admin-primary:visible').count(),1,'saving is the single emphasized action while editing');
      await owner.evaluate(node=>node.setSelectionRange(2,5));
      // Let the focus scroll finish before measuring the save's viewport anchor.
      await f.page.evaluate(()=>new Promise((resolve,reject)=>{
        let previous=null,stable=0,frames=0;
        const sample=()=>{
          const bounds=document.querySelector('[data-person-quick-form] [name=owner]').getBoundingClientRect(),next=[scrollY,bounds.top,bounds.left];
          stable=previous&&next.every((value,index)=>Math.abs(value-previous[index])<0.01)?stable+1:0;previous=next;
          if(stable>=6)return resolve();
          if(++frames>180)return reject(new Error('pre-save focus geometry did not settle'));
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }));
      const before=await f.page.evaluate(()=>({scrollY,href:location.href,owner:document.querySelector('[data-person-quick-form] [name=owner]').getBoundingClientRect().toJSON()}));
      await owner.press('Enter');await saved(f);
      await form.locator('[name=owner]:enabled').waitFor();
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await f.page.evaluate(()=>location.href),before.href);
      assert.equal(await owner.evaluate(node=>document.activeElement===node),true,'ordinary keyboard save returns focus to the current input');
      assert.deepEqual(await owner.evaluate(node=>[node.selectionStart,node.selectionEnd]),[2,5],'ordinary save preserves the input selection');
      const afterGeometry=await f.page.evaluate(()=>({scrollY,owner:document.querySelector('[data-person-quick-form] [name=owner]').getBoundingClientRect().toJSON()}));
      assert.ok(Math.abs(afterGeometry.owner.top-before.owner.top)<=4,'ordinary save keeps the current input at the same visible position '+JSON.stringify({before,after:afterGeometry}));
      assert.equal(await form.locator('[name=notes]').inputValue(),'合成同一页保存并保留焦点');
      assert.equal((await currentContact(f)).operations.responseStatus,'pending');
      assert.deepEqual(f.dialogs,[],'ordinary save never asks for confirmation');await protectedRelations(f);
      const writes=f.calls.filter(call=>call.method==='PUT').length;
      await form.locator('[name=notes]').fill('合成回执丢失后只核对原操作');f.loseSaveAck();
      await f.page.locator('[data-person-quick-save]').click();
      await f.page.locator('[data-person-quick-state][data-save-state=unknown]').waitFor();
      assert.equal(f.calls.filter(call=>call.method==='PUT').length,writes+1);
      const original=f.calls.filter(call=>call.method==='PUT').at(-1).raw;
      assert.ok((await drafts(f.page)).some(row=>row.kind==='pending_submission'&&row.value?.payloadJson===original));
      assert.match(await f.page.locator('[data-person-primary]').textContent(),/核对/u,'unknown result outranks a new action');
      assert.equal(await f.page.locator('[data-person-record] button.ah-admin-primary:visible').count(),1,'an unknown result emphasizes only reconciliation');
      await f.page.locator('[data-person-primary]').click();await saved(f);
      assert.equal(f.calls.filter(call=>call.method==='PUT').length,writes+1,'reconciliation never re-posts');
      assert.equal((await currentContact(f)).operations.notes,'合成回执丢失后只核对原操作');
      assert.equal((await drafts(f.page)).some(row=>row.kind==='pending_submission'&&row.value?.payloadJson===original),false);
      await protectedRelations(f);await shot(f,'person-saved');

      const prepare=f.page.locator('[data-person-credential-prepare]');assert.equal(await prepare.count(),1);
      if(!await prepare.isVisible()){
        if(!await f.page.locator('[data-person-more]').evaluate(node=>node.open))await f.page.locator('[data-person-more] > summary').click();
        await f.page.locator('[data-person-service-open]').click();
      }
      f.allowLink();await prepare.click();await f.page.locator('[data-person-credential-open][href]').waitFor({state:'visible'});
      const credential=await f.page.locator('[data-person-credential-open]').getAttribute('href');assert.ok(credential.startsWith(SITE+'/registration/confirmation/#r=c1.'));
      assert.doesNotMatch(JSON.stringify(await drafts(f.page)),/confirmationUrl|receiptToken|#r=c1\./u,'private links never enter local recovery');
      await f.page.evaluate(id=>{location.hash='contact='+encodeURIComponent(id);},f.second.id);
      await f.page.waitForFunction(()=>document.querySelector('[data-person-name]')?.textContent==='合成旧意向乙');
      assert.equal(await f.page.locator('[data-person-quick-form] [name=notes]').inputValue(),'');
      assert.equal(await f.page.locator('[data-person-source]').textContent(),'');
      assert.equal(await f.page.locator('[data-person-credential-open]').getAttribute('href'),null);
      assert.doesNotMatch(await f.page.locator('[data-person-record]').textContent(),/合成回执丢失后只核对原操作/u);
      const nextForm=await quick(f);
      await nextForm.locator('[name=responseStatus]').selectOption('attending');await nextForm.locator('[name=notes]').fill('合成乙本人已答应出席');
      await f.page.locator('[data-person-quick-save]').click();await saved(f);
      let after=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]});
      assert.equal(after.people.length,2,'saving a new actual attending reply uses the existing single-person integration');
      assert.equal(after.people.find(item=>item.registrationId===f.registrationId).status,'confirmed','the original person seat stays intact');
      const secondId=after.people.find(item=>item.registrationId!==f.registrationId).registrationId;
      const [refreshed]=await Promise.all([f.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/people/contacts/'+f.second.id),f.page.locator('[data-person-refresh]').click()]);assert.equal(refreshed.status(),200);
      await f.page.locator('[data-person-record]:visible').waitFor();
      assert.equal(await f.page.locator('[data-person-name]').textContent(),'合成旧意向乙');
      await quick(f);await nextForm.locator('[name=notes]').fill('合成乙后续跟进，不另建名额');
      f.loseSyncResult();
      await f.page.locator('[data-person-quick-save]').click();await saved(f);
      await nextForm.locator('[name=owner]:enabled').waitFor();
      assert.equal((await drafts(f.page)).some(row=>row.kind==='pending_submission'),false,'unknown admission synchronization never undoes the proven reply save');
      assert.match(await f.page.locator('[data-person-primary]').textContent(),/核对名额/u);
      const beforeSyncCheck=f.calls.filter(call=>call.method==='PUT').length;
      const [syncRead]=await Promise.all([f.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/people/contacts/'+f.second.id),f.page.locator('[data-person-primary]').click()]);assert.equal(syncRead.status(),200);
      await f.page.locator('[data-person-record]:visible').waitFor();
      assert.equal(f.calls.filter(call=>call.method==='PUT').length,beforeSyncCheck,'checking a missing admission result never re-saves the reply');
      assert.match(await f.page.locator('[data-person-summary]').textContent(),/名额已确认/u);
      after=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]});
      assert.equal(after.people.length,2);assert.equal(after.people.find(item=>item.registrationId===secondId).status,'confirmed');
      assert.equal(f.runtime.messages.length,0);
      f.failRead(503);await f.page.locator('[data-person-refresh]').click();
      await f.page.locator('[data-person-error]:visible').waitFor();
      assert.equal(await f.page.locator('[data-person-record]').isVisible(),false);
      assert.match(await f.page.locator('[data-person-error]').textContent(),/无法核对|未能|暂时/u);
      assert.equal(await f.page.locator('[data-person-quick-form] [name=notes]').inputValue(),'');
      await f.page.locator('[data-person-refresh]').click();await f.page.locator('[data-person-record]:visible').waitFor();
      f.failRead(401);await f.page.locator('[data-person-refresh]').click();
      await f.page.locator('[data-person-login-panel]:visible').waitFor();
      assert.equal(await f.page.locator('[data-person-record]').isVisible(),false);
      assert.equal(await f.page.locator('[data-person-credential-open]').getAttribute('href'),null);
      assert.equal(await f.page.locator('[data-person-quick-form] [name=notes]').inputValue(),'');
      f.allowLogin();await f.page.locator('[data-person-login] [name=username]').fill('owner');await f.page.locator('[data-person-login] [name=password]').fill(PEOPLE_FIXTURE_PASSWORD);
      await f.page.locator('[data-person-login-submit]').click();await f.page.locator('[data-person-record]:visible').waitFor();
      await f.page.locator('[data-person-logout]').click();await f.page.locator('[data-person-login-panel]:visible').waitFor();
      assert.equal(await f.page.locator('[data-person-credential-open]').getAttribute('href'),null);
      assert.equal(await f.page.locator('[data-person-quick-form] [name=notes]').inputValue(),'');
      assert.equal(await f.page.locator('[data-person-source]').textContent(),'');
      assert.deepEqual(f.dialogs,[]);
      reports.push({width,requests:f.calls.length,writes:f.calls.filter(call=>call.method==='PUT').length,persistedBeforeWrite:true,originalLostAckBodySha256:createHash('sha256').update(original).digest('hex'),reconciliationWithoutReplay:true,relationsPreserved:true,newAttendeeIntegratedOnce:true,savedReplySurvivesUnknownAdmission:true,samePersonFocusAndVisiblePosition:true,visibleInputShiftPx:afterGeometry.owner.top-before.owner.top,scrollDeltaPx:afterGeometry.scrollY-before.scrollY,selectedOriginalReadOnly:true,privateCredentialOnlyOnClick:true,sourceFailureUnavailable:true,authSwitchLogoutClears:true,screenshots:[initialShot]});
    }catch(error){await f.page.screenshot({path:resolve(evidence,'failure-'+width+'.png'),fullPage:true});await writeFile(resolve(evidence,'failure.json'),JSON.stringify({width,error:error.message,calls:f.calls.map(({path,method,status,actualStatus})=>({path,method,status,actualStatus})),dialogs:f.dialogs},null,2));throw error;
    }finally{await f.context.close();}
  }
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width);
    try{
      const submitted=await f.runtime.seedPublic({intake:'general-v2',name:'合成错填姓名',email:'synthetic.profile.old@example.invalid',organization:'合成原机构'});
      const id=submitted.reference_code;await f.runtime.approvePublic(id);
      const index=(await f.runtime.app.registrationService.repository.readIndex()).value,entry=index.entries.find(row=>row.id===id);
      const original=await f.runtime.app.registrationService.repository.readRecord(entry);
      const contacts=await f.runtime.app.contactsStore.read(),admissions=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]});
      await f.page.goto(API+'/admin/person/#registration='+encodeURIComponent(id),{waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();
      await f.page.locator('[data-person-more] > summary').click();await f.page.locator('[data-person-profile-panel] > summary').click();
      assert.doesNotMatch(await f.page.locator('[data-person-profile]').textContent(),/尚未关联这部分记录/u,'registration-only profile is usable without creating a contact');
      await f.page.locator('[data-person-profile-edit]').click();
      const form=f.page.locator('[data-person-profile-form]'),name=form.locator('[name=name]');
      const baseName=await name.inputValue(),beforeNoChange=f.calls.filter(call=>call.method==='PATCH').length;
      await name.fill(baseName+' ');assert.equal(await f.page.locator('[data-person-profile-save]').isDisabled(),true,'normalized whitespace alone does not produce a profile change');
      await name.fill('合成暂时输入');await f.page.locator('[data-person-profile-save]:enabled').waitFor();
      await name.fill(baseName);assert.equal(await f.page.locator('[data-person-profile-save]').isDisabled(),true,'restoring the original profile disables save');
      await name.press('Enter');assert.equal(f.calls.filter(call=>call.method==='PATCH').length,beforeNoChange,'unchanged normalized fields never send an empty correction');

      await name.fill('合成版本冲突草稿');f.conflictProfile();await f.page.locator('[data-person-profile-save]').click();
      await f.page.locator('[data-person-profile-state][data-save-state=conflict]').waitFor();
      assert.equal(await name.inputValue(),'合成版本冲突草稿');assert.match(await f.page.locator('[data-person-profile-state]').textContent(),/取消编辑.*重新读取/u);
      assert.equal(await f.page.locator('[data-person-profile-check]').isVisible(),false);assert.equal(await f.page.locator('[data-person-profile-retry]').isVisible(),false);
      assert.equal((await drafts(f.page)).filter(row=>row.kind==='pending_submission'&&row.scope?.entityId==='registration-profile:'+id).length,0,'a known first 409 is not retained as an unknown operation');
      assert.equal(f.calls.filter(call=>call.method==='PATCH').at(-1).actualStatus,undefined,'the explicit first 409 is a pre-start browser fault, not a committed operation');
      await f.page.locator('[data-person-profile-cancel]').click();await form.waitFor({state:'hidden'});
      await f.page.locator('[data-person-refresh]').click();await f.page.locator('[data-person-record]:visible').waitFor();
      for(const selector of ['[data-person-more]','[data-person-profile-panel]'])if(!await f.page.locator(selector).evaluate(node=>node.open))await f.page.locator(selector+' > summary').click();
      await f.page.locator('[data-person-profile-edit]').click();assert.equal(await name.inputValue(),baseName,'cancel then explicit reread restores the current saved profile');
      await name.fill('合成更正姓名');await form.locator('[name=email]').fill('synthetic.profile.corrected@example.invalid');
      await f.page.locator('[data-person-profile-email-note]:visible').waitFor();
      await name.focus();await name.evaluate(node=>node.setSelectionRange(1,3));
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const before=await name.evaluate(node=>({href:location.href,top:node.getBoundingClientRect().top}));
      await name.press('Enter');await f.page.locator('[data-person-profile-state][data-save-state=saved]').waitFor();await form.locator('[name=name]:enabled').waitFor();
      await f.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      assert.equal(await f.page.evaluate(()=>location.href),before.href);assert.equal(await name.evaluate(node=>document.activeElement===node),true);
      assert.deepEqual(await name.evaluate(node=>[node.selectionStart,node.selectionEnd]),[1,3]);
      assert.ok(Math.abs(await name.evaluate(node=>node.getBoundingClientRect().top)-before.top)<=4,'profile save preserves the visible input position');
      assert.equal(await f.page.locator('[data-person-name]').textContent(),'合成更正姓名');
      assert.equal(await form.locator('[name=email]').inputValue(),'synthetic.profile.corrected@example.invalid');
      assert.deepEqual(await f.runtime.app.registrationService.repository.readRecord(entry),original,'original registration remains byte-for-byte logically unchanged');
      assert.deepEqual(await f.runtime.app.contactsStore.read(),contacts,'registration-only correction never fabricates or edits a contact');
      assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),admissions,'ordinary correction never changes admission');
      assert.equal(f.runtime.messages.length,0);assert.deepEqual(f.dialogs,[]);

      await form.locator('[name=phone]').fill('synthetic-profile-phone');f.loseProfileAck('after');await f.page.locator('[data-person-profile-save]').click();
      await f.page.locator('[data-person-profile-state][data-save-state=unknown]').waitFor();
      const firstPending=f.calls.filter(call=>call.method==='PATCH').at(-1),writes=f.calls.filter(call=>call.method==='PATCH').length;
      assert.equal(await f.page.locator('[data-person-profile-retry]').isVisible(),false,'unknown save cannot be retried before checking');
      await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();
      await f.page.locator('[data-person-primary]').click();await form.waitFor({state:'visible'});
      await form.getByRole('button',{name:'恢复待核对操作',exact:true}).click();
      await f.page.locator('[data-person-profile-check]:visible').waitFor();await f.page.locator('[data-person-profile-check]').click();
      await f.page.locator('[data-person-profile-state][data-save-state=saved]').waitFor();
      assert.equal(f.calls.filter(call=>call.method==='PATCH').length,writes,'recovering and checking an unknown receipt does not repeat the save');
      assert.ok(f.calls.some(call=>call.method==='GET'&&call.path.endsWith('/profile-operations/'+JSON.parse(firstPending.raw).operationId)));
      assert.equal(await form.locator('[name=phone]').inputValue(),'synthetic-profile-phone');

      await form.locator('[name=organization]').fill('合成新机构');f.loseProfileAck('before');await f.page.locator('[data-person-profile-save]').click();
      await f.page.locator('[data-person-profile-state][data-save-state=unknown]').waitFor();
      const missing=f.calls.filter(call=>call.method==='PATCH').at(-1).raw;
      await f.page.locator('[data-person-profile-check]').click();await f.page.locator('[data-person-profile-retry]:visible').waitFor();
      await f.page.locator('[data-person-profile-retry]').click();await f.page.locator('[data-person-profile-state][data-save-state=saved]').waitFor();
      assert.equal(f.calls.filter(call=>call.method==='PATCH').at(-1).raw,missing,'a missing operation replays only its original immutable body');
      assert.deepEqual(await f.runtime.app.registrationService.repository.readRecord(entry),original);
      assert.deepEqual(await f.runtime.app.contactsStore.read(),contacts);assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),admissions);
      assert.equal(f.runtime.messages.length,0);assert.deepEqual(f.dialogs,[]);await shot(f,'registration-profile-corrected');
      await f.page.evaluate(id=>{location.hash='contact='+encodeURIComponent(id);},f.second.id);await f.page.waitForFunction(()=>document.querySelector('[data-person-name]')?.textContent==='合成旧意向乙');
      assert.equal(await form.isVisible(),false);assert.equal(await form.locator('[name=email]').inputValue(),'');assert.equal(await f.page.locator('[data-person-credential-open]').getAttribute('href'),null);
      reports.push({width,registrationProfileCorrection:true,registrationOnlyNoFakeContact:true,originalAndAdmissionPreserved:true,normalizedOriginalDisablesSaveWithoutRequest:true,knownInitial409PreservesDraftWithoutUnknownLock:true,explicitCancelRereadAfter409:true,samePersonFocusAndPosition:true,persistedBeforeWrite:true,lostAckRecoveredByRead:true,missingOperationExplicitOriginalReplay:true,zeroAutomaticMail:true,switchClearsProfile:true});
    }catch(error){await f.page.screenshot({path:resolve(evidence,'profile-failure-'+width+'.png'),fullPage:true});await writeFile(resolve(evidence,'profile-failure.json'),JSON.stringify({width,error:error.message,calls:f.calls.map(({path,method,status,actualStatus})=>({path,method,status,actualStatus})),dialogs:f.dialogs},null,2));throw error;}
    finally{await f.context.close();}
  }
  // Service tests prove full-history/alias derivation. These controlled DTO
  // overrides check the new UI flag and the fail-closed historical DTO fallback.
  for(const mode of ['flagged','legacy-truncated']){
    const f=await fixture(browser,390);
    try{
      f.showLegacyUnknown(mode);await open(f);
      assert.match(await f.page.locator('[data-person-primary]').textContent(),/核对结果/u,'an unresolved original invitation outranks a new notification');
      await f.page.locator('[data-person-more] > summary').click();
      await f.page.locator('[data-person-service-open]').click();
      assert.equal(await f.page.locator('[data-person-confirmation-send]').isVisible(),false,'new formal mail is suppressed while the original result is unresolved');
      assert.equal(f.calls.some(call=>call.path.includes('/registration-confirmation/delivery/')),false,'the new formal-send context is not loaded as a replacement for the original operation');
      assert.equal(f.calls.some(call=>!['GET','HEAD','OPTIONS'].includes(call.method)),false);
      assert.equal(f.runtime.messages.length,0);await noOverflow(f);
      if(mode==='flagged')await shot(f,'person-legacy-unknown');
      reports.push({width:390,legacyHistoryMode:mode,originalUnknownPrioritized:true,newFormalSendSuppressed:true,zeroWrites:true});
    }finally{await f.context.close();}
  }
  assert.deepEqual(errors,[]);
  const html=await readFile(resolve(dist,'admin/person/index.html'));
  const result={ok:true,dist,personHtmlSha256:createHash('sha256').update(html).digest('hex'),reports,pageErrors:errors};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
