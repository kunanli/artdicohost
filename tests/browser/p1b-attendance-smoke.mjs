// Built P1b admin/public UI over the actual isolated runtime and memory-only OSS.
// All requests are intercepted; contacts, publication and replies are synthetic.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_ATTENDANCE_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/p1b-attendance'));
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {createObjectJournal}=await import(pathToFileURL(resolve(source,'functions/cloud-content/object-journal.mjs')));
const {validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const PRIVATE='SYNTHETIC_P1B_PRIVATE_NEVER_PUBLIC';
const IDS={speaker:'p1b-speaker',host:'p1b-host',declined:'p1b-declined',unlinked:'p1b-unlinked',private:'p1b-private',panel:'p1b-panel',cancelled:'p1b-cancelled'};
const PUBLIC_GUEST_IDS=[IDS.speaker,IDS.host,IDS.declined,IDS.unlinked];
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
const guest=(id,contactId,extras={})=>({id,contactId,name:'合成嘉宾 '+id,company:'合成机构',ggjRole:'',portraitId:'',status:'confirmed',publicConsent:false,internalNotes:PRIVATE,...extras});
const session=(id,extra={})=>({id,start:'10:00',end:'11:00',zone:'B',title:'合成多人圆桌',format:'roundtable',guestId:IDS.speaker,speakerName:'',speakerStatus:'pending',status:'scheduled',internalNotes:PRIVATE,...extra});
async function setReply(runtime,contactId,responseStatus){
  const roster=await runtime.app.contactsStore.read(),contact=roster.contacts.find(row=>row.id===contactId);assert.ok(contact);
  return runtime.app.contactsStore.saveOperations(contactId,roster.revision,{...contact.operations,responseStatus},runtime.users[0].id);
}
async function fixture(browser,width){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false}),contacts={};
  for(const key of ['speaker','host','declined','private']){
    const saved=await runtime.createContact({name:'合成人员 '+key,email:'synthetic.p1b.'+key+'@example.invalid'});
    contacts[key]=saved.contact.id;
  }
  await setReply(runtime,contacts.speaker,'attending');await setReply(runtime,contacts.declined,'declined');await setReply(runtime,contacts.private,'attending');
  const content=(await runtime.app.store.read()).draft.content;
  content.sessions=[session(IDS.panel),session(IDS.cancelled,{title:'合成已取消场次',zone:'A',start:'11:00',end:'12:00',status:'cancelled'})];
  content.guests=[guest(IDS.speaker,contacts.speaker,{status:'pending'}),guest(IDS.host,contacts.host),guest(IDS.declined,contacts.declined),guest(IDS.unlinked,''),guest(IDS.private,contacts.private,{visibility:'private',name:'合成私密人物'})];
  content.booths=[];content.showcases=[];content.organizations=[];
  const checked=validateContent(content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  const journal=createObjectJournal({objects:runtime.objects,prefix:'cms/v1/content'});
  await journal.commit((await journal.read()).cursor,{storageVersion:1,draft:{revision:0,content:checked.value},published:null,audit:[]});
  // Deliberately construct a real historical publication without attendance proof.
  const legacy=await runtime.app.store.publish(0,runtime.users[0].id);assert.equal(Object.hasOwn(legacy.content,'guestAttendance'),false);
  const admissions=await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]});
  const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:940}}),calls=[],dialogs=[];
  let publicProofOverride=null;
  const auth=await runtime.login(),[name,...value]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.ok([API,SITE].includes(url.origin),'all page requests are intercepted synthetic origins');
    if(url.pathname.startsWith('/api/')){
      assert.equal(url.origin,API);
      if(!['GET','HEAD','OPTIONS'].includes(request.method()))assert.ok(url.pathname==='/api/admin/content'||url.pathname==='/api/admin/content/publish','no sending, registrations, admissions or accounts');
      const headers=await request.allHeaders();
      if(url.pathname==='/api/public/content')assert.equal(headers.cookie,undefined,'anonymous public reads carry no staff cookie');
      const entry={path:url.pathname,method:request.method()};calls.push(entry);
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers,...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
      const replyHeaders=Object.fromEntries(response.headers);delete replyHeaders['content-length'];entry.status=response.status;
      let body=Buffer.from(await response.arrayBuffer());
      if(url.pathname==='/api/public/content'&&publicProofOverride!==null){const envelope=JSON.parse(body);envelope.content.guestAttendance=publicProofOverride;body=Buffer.from(JSON.stringify(envelope));}
      return route.fulfill({status:response.status,headers:replyHeaders,body});
    }
    const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.clock.setSystemTime(new Date('2026-10-21T09:00:00.000Z'));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{dialogs.push(dialog.message());void (/^将更新前台全部已保存内容/u.test(dialog.message())?dialog.accept():dialog.dismiss());});
  return {runtime,contacts,context,page,calls,dialogs,admissions,width,legacy,overridePublicProof:proof=>{publicProofOverride=proof;}};
}
async function openAdmin(f,key){await f.page.goto(API+'/admin/content/'+key+'/',{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await f.page.locator('[data-content-panel="'+key+'"]:visible').waitFor();}
async function openPublic(f){await f.page.goto(SITE+'/',{waitUntil:'networkidle'});await f.page.locator('#program-'+IDS.panel).waitFor({state:'attached'});}
async function shot(f,name){assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at '+f.width);const path=resolve(evidence,name+'-'+f.width+'.png');await f.page.screenshot({path,fullPage:true});await f.page.screenshot({path:resolve(evidence,name+'-'+f.width+'-viewport.png')});return path;}
async function publish(f){
  const before=f.dialogs.length;
  const [response]=await Promise.all([
    f.page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/content/publish'&&response.request().method()==='POST'),
    f.page.locator('[data-admin-publish]:visible').first().click(),
  ]);
  const body=await response.json();assert.equal(response.status(),200,JSON.stringify(body));
  await f.page.getByText('已发布到前台。',{exact:true}).first().waitFor();
  assert.equal(f.dialogs.length,before+1,'exactly one impact confirmation per explicit publication');
  return body.published;
}
async function publicChecks(f,expectedCards,{legacy=false,attendingIds=[]}={}){
  await openPublic(f);
  assert.deepEqual(await f.page.locator('[data-public-guests] > [data-guest-id]').evaluateAll(rows=>rows.map(row=>row.dataset.guestId)),expectedCards);
  assert.deepEqual(await f.page.locator('[data-public-guests] > [data-guest-id]').evaluateAll(rows=>rows.map(row=>({id:row.dataset.guestId,attendance:row.dataset.guestAttendance}))),expectedCards.map(id=>({id,attendance:attendingIds.includes(id)?'attending':'pending'})),'public visibility retains every saved public profile while attendance comes only from the frozen proof');
  assert.equal(await f.page.locator('#guest-'+IDS.private).count(),0,'private profiles never become public legacy cards');
  assert.equal(await f.page.locator('[data-public-guests] .ah-guest-attendance').count(),0,'bubble caption uses public profile values rather than invented attendance text');
  if(legacy)for(const id of expectedCards){const card=f.page.locator('#guest-'+id+' [data-guest-toggle]');assert.equal(await card.getAttribute('aria-label'),['合成嘉宾 '+id,'合成机构'].join('，'));assert.equal(await card.locator('.ah-guest-affiliation').textContent(),'合成机构','legacy company remains readable without inventing a position');assert.equal(await card.locator('.ah-guest-affiliation').getAttribute('data-affiliation-source'),'company');assert.equal(await card.locator('.ah-guest-subtitle').count(),0,'missing legacy title and role stay empty instead of duplicating company');}
  if(expectedCards.includes(IDS.speaker))assert.equal(await f.page.locator('[data-public-guests] > [data-guest-id="'+IDS.speaker+'"] a[href="#program-'+IDS.panel+'"]').count(),0,'compact circular identities omit duplicate profile links; editorial session associations remain in the saved publication');
  assert.equal(await f.page.locator('[data-public-guests] details,.ah-guest-detail-body,.ah-guest-title').count(),0,'public guest circles omit the square panel and company job titles');
  const panel=f.page.locator('#program-'+IDS.panel);assert.match(await panel.textContent(),/合成多人圆桌/u);
  assert.equal(await panel.locator('.ah-session-meta').count(),0,'public timetable omits the speaker/host field regardless of attendance');
  assert.match(await f.page.locator('#program-'+IDS.cancelled).textContent(),/本场已取消/u);
  assert.doesNotMatch(await f.page.locator('[data-agenda]').textContent(),/合成私密人物|SYNTHETIC_P1B_PRIVATE/u);
  return panel;
}
async function previewChecks(f,attendingIds){
  await f.page.locator('[data-admin-preview]').click();
  await f.page.locator('[data-admin-preview-panel]:visible').waitFor();
  const preview=f.page.locator('[data-admin-public-preview]');
  const sessionPreview=preview.locator('[data-preview-session-id="'+IDS.panel+'"]');
  assert.match(await sessionPreview.textContent(),/主持人[\s\S]*圆桌嘉宾/u);
  assert.match(await sessionPreview.textContent(),/合成嘉宾 p1b-host[\s\S]*安排待确认/u);
  assert.deepEqual(await preview.locator('.ah-admin-guest-preview-grid article h4').allTextContents(),PUBLIC_GUEST_IDS.map(id=>'合成嘉宾 '+id),'preview keeps every valid public profile independently of attendance');
  assert.deepEqual(await preview.locator('.ah-admin-guest-preview-grid article').evaluateAll(rows=>rows.map(row=>({id:row.dataset.previewGuestId,attendance:row.dataset.previewGuestAttendance}))),PUBLIC_GUEST_IDS.map(id=>({id,attendance:attendingIds.includes(id)?'attending':'pending'})),'preview attendance is checked independently from public profile membership');
  assert.equal(await preview.locator('[data-preview-guest-id="'+IDS.private+'"]').count(),0,'the private profile is excluded even when its source reply is attending');
  assert.equal(await preview.locator('.ah-admin-guest-preview-grid article p').filter({hasText:/^出席待确认$/u}).count(),PUBLIC_GUEST_IDS.length-attendingIds.length,'unproved profiles remain pending rather than disappearing');
  await f.page.locator('[data-admin-preview-close]').click();
}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width);
    try{
      const legacyCards=PUBLIC_GUEST_IDS;
      await publicChecks(f,legacyCards,{legacy:true});
      assert.deepEqual((await f.runtime.app.store.read()).published,f.legacy,'legacy public reads retain exact frozen bytes');
      await openAdmin(f,'sessions');
      await f.page.locator('[data-admin-sessions] tr').filter({hasText:'合成多人圆桌'}).locator('[data-row-action=edit]').click();
      const form=f.page.locator('[data-session-form]');assert.equal(await form.locator('[name=guestId]').inputValue(),IDS.speaker);
      await f.page.locator('[data-session-participants-panel] > summary').click();
      for(const [id,roles] of [[IDS.host,['moderator','panelist']],[IDS.declined,['organizer']],[IDS.private,['speaker']]]){
        await f.page.locator('[data-session-add-participant]').click();
        const row=f.page.locator('[data-session-participants] > fieldset').last();
        await row.locator('select[name=participantGuest]').selectOption(id);
        for(const role of roles)await row.locator('input[name=participantRole][value='+role+']').check();
      }
      await form.locator('[name=internalNotes]').fill(PRIVATE+' UPDATED');
      await f.page.locator('[data-session-submit]:enabled').click();await f.page.locator('[data-content-form-save-state=session][data-save-state=saved]').waitFor();
      assert.equal(await f.page.locator('[data-session-dialog]').isVisible(),true);assert.deepEqual(f.dialogs,[],'ordinary save stays open and needs no confirmation');
      const state=await f.runtime.app.store.read(),saved=state.draft.content.sessions.find(row=>row.id===IDS.panel);
      assert.equal(saved.guestId,IDS.speaker);assert.equal(saved.participants.length,3);assert.deepEqual(saved.participants[0].roles,['moderator','panelist']);
      assert.deepEqual(state.published,f.legacy,'saving participants does not publish them');
      await f.page.locator('[data-session-participants] > fieldset').first().scrollIntoViewIfNeeded();
      const editorShot=await shot(f,'session-editor');
      await f.page.locator('[data-close-dialog=session]').first().click();await f.page.locator('[data-session-dialog]').waitFor({state:'hidden'});
      // A hidden JSON field must not carry A's people into an old B record or a
      // new editor when form.reset() retains an earlier hidden input value.
      await f.page.locator('[data-admin-sessions] tr').filter({hasText:'合成已取消场次'}).locator('[data-row-action=edit]').click();
      assert.equal(await form.locator('[name=participants]').inputValue(),'');
      assert.equal(await f.page.locator('[data-session-participants] > fieldset').count(),0);
      await form.locator('[name=internalNotes]').fill(PRIVATE+' LEGACY B');
      await f.page.locator('[data-session-submit]:enabled').click();await f.page.locator('[data-content-form-save-state=session][data-save-state=saved]').waitFor();
      assert.equal(Object.hasOwn((await f.runtime.app.store.read()).draft.content.sessions.find(row=>row.id===IDS.cancelled),'participants'),false,'saving legacy B never copies A participants');
      await f.page.locator('[data-close-dialog=session]').first().click();await f.page.locator('[data-session-dialog]').waitFor({state:'hidden'});
      await f.page.locator('[data-admin-add-session]').click();
      assert.equal(await form.locator('[name=participants]').inputValue(),'');
      assert.equal(await f.page.locator('[data-session-participants] > fieldset').count(),0);
      await f.page.locator('[data-close-dialog=session]').first().click();await f.page.locator('[data-session-dialog]').waitFor({state:'hidden'});
      await f.page.locator('[data-admin-sessions] tr').filter({hasText:'合成多人圆桌'}).locator('[data-row-action=edit]').click();
      assert.equal(JSON.parse(await form.locator('[name=participants]').inputValue()).length,3,'returning to A restores its own saved participants');
      assert.equal(await f.page.locator('[data-session-participants] > fieldset').count(),3);
      await f.page.locator('[data-close-dialog=session]').first().click();await f.page.locator('[data-session-dialog]').waitFor({state:'hidden'});
      assert.deepEqual(f.dialogs,[],'switching saved editors adds no confirmation');
      await openAdmin(f,'publish');
      await previewChecks(f,[IDS.speaker]);
      const first=await publish(f);assert.deepEqual(first.content.guestAttendance.confirmedGuestIds,[IDS.speaker]);
      assert.equal(first.content.sessions.find(row=>row.id===IDS.panel).participants.some(row=>row.guestId===IDS.private),false,'private participant identity is not public');
      assert.doesNotMatch(JSON.stringify(first),/contactId|email|wechat|internalNotes|SYNTHETIC_P1B_PRIVATE/u);
      let panel=await publicChecks(f,PUBLIC_GUEST_IDS,{attendingIds:[IDS.speaker]});
      assert.equal(await panel.locator('strong').textContent(),'合成多人圆桌','editorial participants remain saved without adding a public subtitle');
      await f.page.locator('[data-zone="B"]').first().click();
      const publicShot=await shot(f,'published-people');

      await setReply(f.runtime,f.contacts.speaker,'declined');
      await publicChecks(f,PUBLIC_GUEST_IDS,{attendingIds:[IDS.speaker]});
      assert.deepEqual((await f.runtime.app.store.read()).published,first,'reply changes never silently replace frozen publication');
      await openAdmin(f,'publish');
      assert.match(await f.page.locator('[data-admin-publication-detail]').textContent(),/出席.*更新前台/u);
      await previewChecks(f,[]);
      const withdrawn=await publish(f);
      assert.ok(withdrawn.revision>first.revision,'explicit attendance publication advances content revision');
      assert.deepEqual(withdrawn.content.guestAttendance.confirmedGuestIds,[]);
      assert.equal(withdrawn.content.sessions.length,2,'attendance changes never remove the timetable');
      panel=await publicChecks(f,PUBLIC_GUEST_IDS);assert.equal(await panel.locator('strong').textContent(),'合成多人圆桌');
      assert.deepEqual(withdrawn.content.guests.map(row=>row.id),PUBLIC_GUEST_IDS,'an explicit empty proof preserves every saved public profile');
      // This intercepted invalid envelope is synthetic and never written to the runtime.
      // A private ID cannot become a valid attendance proof or public fallback card.
      f.overridePublicProof({schemaVersion:1,sourceRevision:12,confirmedGuestIds:[IDS.private]});
      await f.page.goto(SITE+'/',{waitUntil:'networkidle'});
      assert.equal(await f.page.locator('[data-guest-id]').count(),0,'an invalid proof fails closed on an initial public read');
      assert.match(await f.page.locator('[data-public-content-status]').textContent(),/无法|暂时/u);
      assert.deepEqual((await f.runtime.app.store.read()).published,withdrawn,'invalid public input never changes the saved publication or its empty proof');
      assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.admissions);
      assert.equal(f.runtime.messages.length,0);
      assert.equal(f.calls.filter(row=>row.status>=400).length,0,'actual synthetic API responses all succeed');
      assert.equal(f.dialogs.length,2);assert.ok(f.dialogs.every(message=>/^将更新前台全部已保存内容/u.test(message)));
      reports.push({width,legacyCards,legacyAttendance:'pending only; no invented proof',publicCards:PUBLIC_GUEST_IDS,confirmedAttendanceIds:[IDS.speaker],afterWithdrawalCards:PUBLIC_GUEST_IDS.length,afterWithdrawalAttendanceCount:0,emptyProofKeepsPendingPublicCards:true,invalidProofFailClosed:true,privateProfileExcluded:true,additionalParticipants:3,publicAdditionalParticipants:2,legacyAndNewEditorClear:true,ordinarySaveConfirmations:0,publishConfirmations:f.dialogs.length,firstRevision:first.revision,withdrawnRevision:withdrawn.revision,requests:f.calls.length,screenshots:[editorShot,publicShot]});
    }catch(error){
      await writeFile(resolve(evidence,'failure.json'),JSON.stringify({width,url:f.page.url(),dialogs:f.dialogs,calls:f.calls,pageErrors:errors,text:await f.page.locator('body').innerText()},null,2)+'\n');
      await f.page.screenshot({path:resolve(evidence,'failure-'+width+'.png'),fullPage:true});throw error;
    }finally{await f.context.close();}
  }
  assert.deepEqual(errors,[]);
  const admin=await readFile(resolve(dist,'admin/index.html')),home=await readFile(resolve(dist,'index.html'));
  const result={ok:true,dist,adminHtmlSha256:createHash('sha256').update(admin).digest('hex'),publicHtmlSha256:createHash('sha256').update(home).digest('hex'),reports,pageErrors:errors,syntheticOnly:true};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
