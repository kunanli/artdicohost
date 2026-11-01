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
const evidence=resolve(project,'.local-data/browser-evidence/p1b-attendance');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {createObjectJournal}=await import(pathToFileURL(resolve(source,'functions/cloud-content/object-journal.mjs')));
const {validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const PRIVATE='SYNTHETIC_P1B_PRIVATE_NEVER_PUBLIC';
const IDS={speaker:'p1b-speaker',host:'p1b-host',declined:'p1b-declined',unlinked:'p1b-unlinked',private:'p1b-private',panel:'p1b-panel',cancelled:'p1b-cancelled'};
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
  const context=await browser.newContext({viewport:{width,height:940}}),calls=[],dialogs=[];
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
      return route.fulfill({status:response.status,headers:replyHeaders,body:Buffer.from(await response.arrayBuffer())});
    }
    const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.clock.setSystemTime(new Date('2026-10-21T09:00:00.000Z'));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{dialogs.push(dialog.message());void (/^将更新前台全部已保存内容/u.test(dialog.message())?dialog.accept():dialog.dismiss());});
  return {runtime,contacts,context,page,calls,dialogs,admissions,width,legacy};
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
async function publicChecks(f,expectedCards){
  await openPublic(f);
  assert.deepEqual(await f.page.locator('[data-public-guests] > [data-guest-id]').evaluateAll(rows=>rows.map(row=>row.dataset.guestId)),expectedCards);
  if(expectedCards.includes(IDS.speaker))assert.equal(await f.page.locator('[data-public-guests] > [data-guest-id="'+IDS.speaker+'"] a[href="#program-'+IDS.panel+'"]').count(),1,'a proved attending primary retains its scheduled session link independently of pending profile status');
  const panel=f.page.locator('#program-'+IDS.panel);assert.match(await panel.textContent(),/合成多人圆桌/u);
  assert.match(await f.page.locator('#program-'+IDS.cancelled).textContent(),/本场已取消/u);
  assert.doesNotMatch(await f.page.locator('[data-agenda]').textContent(),/合成私密人物|SYNTHETIC_P1B_PRIVATE/u);
  return panel;
}
async function previewChecks(f,expectedNames){
  await f.page.locator('[data-admin-preview]').click();
  await f.page.locator('[data-admin-preview-panel]:visible').waitFor();
  const preview=f.page.locator('[data-admin-public-preview]');
  const sessionPreview=preview.locator('[data-preview-session-id="'+IDS.panel+'"]');
  assert.match(await sessionPreview.textContent(),/主持人[\s\S]*圆桌嘉宾/u);
  assert.match(await sessionPreview.textContent(),/合成嘉宾 p1b-host[\s\S]*安排待确认/u);
  assert.deepEqual(await preview.locator('.ah-admin-guest-preview-grid article h4').allTextContents(),expectedNames,'preview guest cards match actual attendance eligibility');
  await f.page.locator('[data-admin-preview-close]').click();
}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width);
    try{
      await publicChecks(f,[]);
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
      await previewChecks(f,['合成嘉宾 '+IDS.speaker]);
      const first=await publish(f);assert.deepEqual(first.content.guestAttendance.confirmedGuestIds,[IDS.speaker]);
      assert.equal(first.content.sessions.find(row=>row.id===IDS.panel).participants.some(row=>row.guestId===IDS.private),false,'private participant identity is not public');
      assert.doesNotMatch(JSON.stringify(first),/contactId|email|wechat|internalNotes|SYNTHETIC_P1B_PRIVATE/u);
      let panel=await publicChecks(f,[IDS.speaker]);
      assert.match(await panel.textContent(),/主持人 \/ 圆桌嘉宾：合成嘉宾 p1b-host · 安排待确认/u);
      assert.match(await panel.textContent(),/组织者：合成嘉宾 p1b-declined · 安排待确认/u);
      await f.page.locator('[data-zone="B"]').first().click();
      const publicShot=await shot(f,'published-people');

      await setReply(f.runtime,f.contacts.speaker,'declined');
      await publicChecks(f,[IDS.speaker]);
      assert.deepEqual((await f.runtime.app.store.read()).published,first,'reply changes never silently replace frozen publication');
      await openAdmin(f,'publish');
      assert.match(await f.page.locator('[data-admin-publication-detail]').textContent(),/出席.*更新前台/u);
      await previewChecks(f,[]);
      const withdrawn=await publish(f);
      assert.ok(withdrawn.revision>first.revision,'explicit attendance publication advances content revision');
      assert.deepEqual(withdrawn.content.guestAttendance.confirmedGuestIds,[]);
      assert.equal(withdrawn.content.sessions.length,2,'guest filtering never removes the timetable');
      panel=await publicChecks(f,[]);assert.match(await panel.textContent(),/讲者：合成嘉宾 p1b-speaker · 安排待确认/u);
      assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.admissions);
      assert.equal(f.runtime.messages.length,0);
      assert.equal(f.calls.filter(row=>row.status>=400).length,0,'actual synthetic API responses all succeed');
      assert.equal(f.dialogs.length,2);assert.ok(f.dialogs.every(message=>/^将更新前台全部已保存内容/u.test(message)));
      reports.push({width,legacyCards:0,confirmedCards:[IDS.speaker],afterWithdrawalCards:0,additionalParticipants:3,publicAdditionalParticipants:2,legacyAndNewEditorClear:true,ordinarySaveConfirmations:0,publishConfirmations:f.dialogs.length,firstRevision:first.revision,withdrawnRevision:withdrawn.revision,requests:f.calls.length,screenshots:[editorShot,publicShot]});
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
