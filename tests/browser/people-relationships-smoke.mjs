// Actual runtime services + memory OSS; every Chromium request is intercepted.
// All people, pictures, mail and account credentials here are synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE,PEOPLE_FIXTURE_PASSWORD,PEOPLE_FIXTURE_PRIVATE} from '../helpers/people-runtime-fixture.mjs';
import {createOssPortraitStore} from '../../functions/cloud-content/portrait-store.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),errors=[],reports=[];
const PNG='iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});

async function seedRelations(runtime){
  const owner=runtime.users[0],one=(await runtime.createContact({name:'合成同名人员',organization:'合成组织文字'})).contact;
  const two=(await runtime.createContact({name:'合成同名人员',organization:'合成组织文字'})).contact;
  const three=(await runtime.createContact({name:'合成组织成员乙',organization:'合成组织文字'})).contact;
  const content=(await runtime.app.store.read()).draft.content;
  content.organizations=['alpha','beta'].map((suffix,index)=>({id:'synthetic-org-'+suffix,name:'合成同名组织',logoId:'',website:'https://example.invalid/'+suffix,participation:index?'attendee':'exhibitor',status:'confirmed',publicConsent:true,internalNotes:'SYNTHETIC_PRIVATE_ORGANIZATION_NOTE'}));
  const photo=await createOssPortraitStore({objects:runtime.objects}).upload({contentType:'image/png',dataBase64:PNG});
  content.guests=[{id:'synthetic-public-person',contactId:one.id,name:'合成同名人员',company:'合成组织文字',ggjRole:'',portraitId:photo.id,status:'confirmed',publicConsent:true,internalNotes:'SYNTHETIC_PRIVATE_GUEST_NOTE',publicRoles:['speaker','moderator']},
    {id:'synthetic-draft-person',contactId:three.id,name:'合成组织成员乙',company:'合成组织文字',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,internalNotes:'',publicRoles:['guest']}];
  content.booths=[{id:'synthetic-booth-alpha',code:'C-01',slotNumber:1,organization:'与档案不同的展示文字',organizationId:'synthetic-org-alpha',project:'合成展示',zone:'C',status:'confirmed',internalNotes:'SYNTHETIC_PRIVATE_BOOTH_NOTE'}];
  content.sessions[0].guestId='synthetic-public-person';await runtime.app.store.save(0,content,owner.id);await runtime.app.store.publish(1,owner.id);
  for(const [person,organizationId,role,title] of [[one,'synthetic-org-alpha','lead','合成联络负责人'],[three,'synthetic-org-beta','member','合成协作成员']]){
    const roster=await runtime.app.contactsStore.read();await runtime.app.contactsStore.saveOperations(person.id,roster.revision,{...person.operations,organizationMemberships:[{organizationId,role,title}]},owner.id);
  }
  return {one:one.id,two:two.id,three:three.id,content};
}
async function fixture({width=1280,username='owner',mode='normal',relations=true,capacity=3,mail=false}={}){
  const runtime=await peopleRuntimeFixture({capacity,mail}),ids=relations?await seedRelations(runtime):{};
  const context=await browser.newContext({viewport:{width,height:950},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(10000);
  const session=await runtime.login(username),[cookieName,...cookieValue]=session.Cookie.split('=');await context.addCookies([{url:SITE,name:cookieName,value:cookieValue.join('='),httpOnly:true,secure:true}]);
  const writes=[],reads=[],dialogs=[];let catalogFailure=mode==='catalog-unavailable',held=null,finishHeld=null,hold=false,heldPath='',released=null;
  page.on('pageerror',error=>errors.push(mode+': '+error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.type());if(mode==='dirty')await dialog.dismiss();else await dialog.accept();});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'all browser HTTP requests must remain intercepted on the synthetic origin');
    if(path.startsWith('/api/')){
      const body=req.postData()?JSON.parse(req.postData()):null;(req.method()==='GET'?reads:writes).push(req.method()==='GET'?path+url.search:{path,method:req.method(),body});
      assert.equal(/(?:send-email|send-confirmation|publish)$/u.test(path),false,'relationship actions must never send or publish');
      const request=new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(req.method()==='GET'?{}:{body:req.postData()})});
      if(catalogFailure&&path==='/api/admin/people/relationships')return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
      const response=await runtime.app.handle(request);
      if(hold&&path===heldPath){hold=false;await new Promise(resolve=>{held=resolve;released=new Promise(done=>{finishHeld=done;});});try{return await route.fulfill(mode.endsWith('401')?json({},401):{status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}finally{finishHeld();}}
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});
  });
  return {runtime,ids,context,page,writes,reads,dialogs,setCatalogFailure:value=>{catalogFailure=value;},holdNext:path=>{hold=true;heldPath=path;},async waitHeld(){for(let index=0;index<1000&&!held;index++)await page.waitForTimeout(10);assert.ok(held,'synthetic response is held');},async release(){assert.ok(held);held();await released;await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));}};
}
async function openContacts(f,hash=''){await f.page.goto(SITE+'/admin/contacts/'+hash,{waitUntil:'domcontentloaded'});await f.page.locator('[data-contacts-workspace]:visible').waitFor();await f.page.locator('[data-contacts-rows] tr').first().waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
function row(f,id){return f.page.locator('[data-contacts-rows] tr').filter({has:f.page.locator('[data-contact-relationships="'+id+'"]')});}
async function edit(f,id){await row(f,id).locator('button').filter({hasText:'详情与安排'}).click();await f.page.locator('[data-contact-dialog][open]').waitFor();return f.page.locator('[data-contact-form]');}
async function saveContact(f){await f.page.locator('[data-contact-save]').click();await f.page.locator('[data-contact-dialog]').waitFor({state:'hidden'});}
async function login(f,username='owner'){const form=f.page.locator('[data-contacts-login]');await form.locator('[name=username]').fill(username);await form.locator('[name=password]').fill(PEOPLE_FIXTURE_PASSWORD);await form.locator('button[type=submit]').click();await f.page.locator('[data-contacts-workspace]:visible').waitFor();}

try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture({width});await openContacts(f);await f.page.locator('[data-contact-relationships="'+f.ids.one+'"]').filter({hasText:'合成同名组织'}).waitFor();
    assert.equal(await f.page.locator('[data-contacts-rows] tr').count(),3,'same names remain separate people');assert.match(await row(f,f.ids.one).textContent(),/讲者|主持/u);
    await f.page.locator('[data-contacts-organization]').selectOption('synthetic-org-alpha');assert.equal(await f.page.locator('[data-contacts-rows] tr').count(),1);assert.match(await f.page.locator('[data-contacts-rows]').textContent(),/合成同名人员/u);
    await f.page.locator('[data-contacts-organization]').selectOption('__none');assert.equal(await f.page.locator('[data-contacts-rows] tr').count(),1);assert.equal(await f.page.locator('[data-contact-relationships="'+f.ids.two+'"]').count(),1,'profile company text never creates an organization membership');
    await f.page.locator('[data-contacts-organization]').selectOption('');await f.page.locator('[data-contacts-public-role]').selectOption('moderator');assert.equal(await f.page.locator('[data-contacts-rows] tr').count(),1);assert.equal(await f.page.locator('[data-contact-relationships="'+f.ids.one+'"]').count(),1);
    await f.page.locator('[data-contacts-public-role]').selectOption('');await f.page.locator('[data-contacts-public-state]').selectOption('unlinked');assert.equal(await f.page.locator('[data-contacts-rows] tr').count(),1);assert.equal(await f.page.locator('[data-contact-relationships="'+f.ids.two+'"]').count(),1);await f.page.locator('[data-contacts-public-state]').selectOption('');
    assert.deepEqual(f.writes,[],'opening, filtering and profile links never mutate or send');assert.equal(f.runtime.messages.length,0);await noOverflow(f.page);if(width===390)await f.page.screenshot({path:resolve(evidence,'people-relationships-mobile.png'),fullPage:true});if(width===1440)await f.page.screenshot({path:resolve(evidence,'people-relationships-desktop.png'),fullPage:true});await f.context.close();reports.push({width,stablePersonAndOrganizationIds:true,multiplePublicRolesOnePerson:true,organizationAndPublicFilters:true,readOnlyAndNoOverflow:true});
  }

  const membership=await fixture();await openContacts(membership);const form=await edit(membership,membership.ids.two);await membership.page.locator('[data-contact-membership-add]').click();const item=form.locator('[data-contact-membership-row]');await item.locator('[name=organizationId]').selectOption('synthetic-org-beta');await item.locator('[name=role]').selectOption('member');await item.locator('[name=title]').fill('合成新成员');assert.deepEqual(membership.writes,[]);await saveContact(membership);let saved=(await membership.runtime.app.contactsStore.read()).contacts.find(person=>person.id===membership.ids.two);assert.deepEqual(saved.operations.organizationMemberships,[{organizationId:'synthetic-org-beta',role:'member',title:'合成新成员'}]);assert.equal((await membership.runtime.app.registrationService.repository.list()).registrations.length,0);assert.equal(membership.runtime.messages.length,0);await membership.page.reload({waitUntil:'domcontentloaded'});await membership.page.locator('[data-contact-relationships="'+membership.ids.two+'"]').filter({hasText:'合成同名组织'}).waitFor();await membership.context.close();reports.push({membershipSavedExplicitly:true,refreshPreservesStableRelation:true,membershipNeverCreatesAdmissionOrMail:true});

  const failure=await fixture({mode:'catalog-unavailable'});await openContacts(failure);await failure.page.locator('[data-people-relationships-status]').filter({hasText:/无法|未能|暂/u}).waitFor();for(const hook of ['organization','public-role','public-state'])assert.equal(await failure.page.locator('[data-contacts-'+hook+']').isDisabled(),true);assert.equal(await failure.page.locator('[data-contacts-rows] tr').count(),3,'failed catalog is not a successful zero or unlinked result');assert.deepEqual(failure.writes,[]);await failure.context.close();reports.push({relationshipFailureDisablesNegativeFilters:true,sourceFailureNeverShowsFalseZero:true});

  for(const username of ['editor','reviewer']){
    const f=await fixture({username,relations:false});await f.page.goto(SITE+'/admin/contacts/',{waitUntil:'networkidle'});assert.equal(f.reads.some(path=>/^\/api\/admin\/(?:contacts|people\/relationships)/u.test(path)),false,'role gate precedes private relationship requests');assert.deepEqual(f.writes,[]);await f.context.close();reports.push({username,deniedBeforePrivateReads:true});
  }

  const dirty=await fixture({mode:'dirty'});await openContacts(dirty);const dirtyForm=await edit(dirty,dirty.ids.two);await dirty.page.locator('[data-contact-membership-add]').click();await dirtyForm.locator('[data-contact-membership-row] [name=organizationId]').selectOption('synthetic-org-beta');await dirty.page.locator('[data-contact-close]').first().click();assert.equal(await dirty.page.locator('[data-contact-dialog]').isVisible(),true);await dirty.page.keyboard.press('Escape');assert.equal(await dirty.page.locator('[data-contact-dialog]').isVisible(),true);await dirty.page.locator('[data-contacts-logout]').evaluate(node=>node.click());assert.equal(await dirty.page.locator('[data-contacts-workspace]').isVisible(),true);assert.equal(dirty.dialogs.length>=3,true);assert.deepEqual(dirty.writes,[]);await dirty.context.close();reports.push({dirtyMembershipCloseEscapeLogoutGuards:true});

  const attendance=await fixture({relations:false,capacity:3,mail:true});const contact=(await attendance.runtime.createContact({name:'合成确认参加者'})).contact;await openContacts(attendance);const attendanceForm=await edit(attendance,contact.id);await attendanceForm.locator('[name=responseStatus]').selectOption('attending');await saveContact(attendance);let ledger=await attendance.runtime.app.registrationService.getAdmissions({actor:attendance.runtime.users[0]});assert.equal(ledger.summary.confirmedCount,1);let intent=await attendance.runtime.app.intentService.read({actor:attendance.runtime.users[0]});const registrationId=intent.conversions.find(item=>item.sourceContactId===contact.id)?.registrationId;assert.ok(registrationId);assert.equal(attendance.runtime.messages.length,0,'saving attending never sends confirmation or invitation');const repeated=await edit(attendance,contact.id);await repeated.locator('[name=notes]').fill('合成再次核对');await saveContact(attendance);intent=await attendance.runtime.app.intentService.read({actor:attendance.runtime.users[0]});assert.equal(intent.conversions.filter(item=>item.sourceContactId===contact.id).length,1);assert.equal(intent.conversions.find(item=>item.sourceContactId===contact.id).registrationId,registrationId);ledger=await attendance.runtime.app.registrationService.getAdmissions({actor:attendance.runtime.users[0]});assert.equal(ledger.summary.confirmedCount,1);assert.equal(attendance.runtime.messages.length,0);await attendance.context.close();reports.push({attendingAckUpdatesSharedAdmission:true,repeatSaveReusesExactRegistration:true,noAutomaticMail:true});

  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
