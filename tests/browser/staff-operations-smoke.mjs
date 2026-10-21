// Real Chromium against intercepted synthetic staff APIs. No production traffic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),SITE='https://api.artdico.host';
const ID='a'.repeat(43),CONTACT='contact-synthetic',AT='2026-10-21T01:00:00.000Z';
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
const errors=[],reports=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

function syntheticPerson({kind='contact',id=kind==='contact'?CONTACT:ID,restricted=false,unlinked=false,unavailable=false,attendee=false,draftPublic=false,name='合成人员'}={}){
  const profile={name,displayName:name,organization:'合成组织',position:'合成职务',city:'合成城市',email:'synthetic@example.invalid',wechat:'synthetic-wechat',phone:'',contactConsent:'consented',categories:[],interests:[]};
  const canContact=!restricted||kind==='contact',canRegistration=!restricted||kind==='registration';
  const contact=canContact&&(!unlinked||kind==='contact')?{id:kind==='contact'?id:CONTACT,profile,operations:{owner:'合成同事',priority:'normal',followUpAt:'',responseStatus:attendee?'pending':'attending',notes:'合成内部跟进',participationForms:attendee?['attendee']:['speaker'],sessionRoles:[{sessionId:'session-synthetic',roles:['speaker']}],sessionIds:['session-synthetic'],boothIds:['booth-synthetic']}}:null;
  const registration=canRegistration&&(!unlinked||kind==='registration')?{id:kind==='registration'?id:ID,referenceCode:ID,submittedAt:AT,provenance:{kind:'staff_assisted'},fields:{name,organization:'合成组织',position:'',city:'合成城市',email:'synthetic@example.invalid',wechat:'synthetic-wechat',phone:'',categories:[],participationInterests:[],attendance:'expected',accommodationChoice:'not_needed'},review:{status:'new',accommodationStatus:'not_requested',assignedTo:'',nextStep:'',invitationStatus:'not_sent',deletionRequested:false}}:null;
  const state=available=>unavailable?'unavailable':available?'available':'restricted';
  return {schemaVersion:1,selected:{kind,id},person:Object.fromEntries(['name','displayName','organization','position','city'].map(key=>[key,profile[key]])),
    linkage:{state:unavailable?'unavailable':unlinked?'unlinked':restricted?'restricted':'linked',contactId:contact?.id??null,registrationId:registration?.id??null},
    permissions:{contact:canContact,registration:canRegistration,invitations:canContact,confirmations:canRegistration,arrangements:canContact},
    availability:{contact:unlinked&&kind==='registration'?'unlinked':canContact?'available':'restricted',registration:unlinked&&kind==='contact'?'unlinked':state(canRegistration),admission:unlinked?'unlinked':state(true),arrangements:state(canContact),invitations:state(canContact),confirmations:unlinked?'unlinked':state(canRegistration),publicProfile:state(canContact)},
    revisions:{contacts:canContact?1:null,content:canContact?1:null,invitations:canContact?1:null,registration:canRegistration?1:null,admission:1,confirmations:canRegistration?1:null},
    contact,registration:unavailable?null:registration,admission:unavailable||unlinked?null:{status:'confirmed',kind:'attendee',revision:1},
    arrangements:{sessions:canContact&&!unavailable&&!attendee?[{id:'session-synthetic',title:'合成专题分享',start:'10:00',end:'11:00',zone:'A',status:'scheduled',roles:['speaker'],missing:false}]:[],booths:canContact&&!unavailable&&!attendee?[{id:'booth-synthetic',code:'C01',organization:'合成组织',project:'合成展示',position:'1',status:'confirmed',missing:false}]:[]},
    publicProfile:{state:state(canContact),profiles:canContact&&!unavailable&&!attendee?[{id:'synthetic-guest',name,company:'合成组织',title:'合成讲者',status:'confirmed',publicConsent:true,hasPortrait:true,publicRoles:['speaker'],published:true,publishedMatchesDraft:!draftPublic}]:[],publishedRevision:canContact&&!unavailable?1:null,publishedAt:canContact&&!unavailable?AT:null},
    communications:communicationHistory({invitations:canContact&&!unavailable,confirmations:canRegistration&&!unavailable&&!unlinked})};
}

function communicationHistory({invitations,confirmations}){
  const invitation={id:'synthetic-invitation',channel:'email',status:'prepared',sentChannel:null,createdAt:AT,updatedAt:AT};
  const confirmation={id:'synthetic-confirmation',kind:'initial',status:'provider_accepted',admissionStatus:'confirmed',attempt:1,createdAt:AT,updatedAt:AT};
  const timeline=[...(invitations?[{source:'invitation',id:invitation.id,status:invitation.status,channel:'email',kind:null,at:AT}]:[]),...(confirmations?[{source:'confirmation',id:confirmation.id,status:confirmation.status,channel:'email',kind:'initial',at:AT}]:[])];
  return {historyLimit:200,invitationTotal:invitations?1:0,confirmationTotal:confirmations?1:0,timelineTotal:timeline.length,historyTruncated:false,invitations:invitations?[invitation]:[],confirmations:confirmations?[confirmation]:[],timeline};
}

async function fixture({width=1280,role='superadmin',mode='normal'}={}){
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(10000);
  let authenticated=true,account=0,held=null,finishHeld=null,markHeld=null,deliveryRevision=0,automaticEnabled=false,settingAttempts=0;
  const heldStarted=new Promise(resolve=>{markHeld=resolve;});
  const heldDone=new Promise(resolve=>{finishHeld=resolve;});
  const writes=[],reads=[],unknown=[],dialogEvents=[];
  const accountUser=()=>({id:'synthetic-operations-'+account,label:'合成工作人员',roles:role==='superadmin'?['superadmin','outreach','reviewer','editor']:role==='outreach'?['outreach']:role==='reviewer'?['reviewer']:['editor']});
  const delivery=()=>({revision:deliveryRevision,automaticEnabled,email:{ready:true,missing:[]},wallet:{ready:false,reason:'WALLET_NOT_CONFIGURED',missing:['APPLE_WALLET_TEAM_ID','APPLE_WALLET_PASS_TYPE_ID'],deviceTestRequired:true},counts:{total:3,providerAccepted:1,rejected:1,unknown:1}});
  page.on('pageerror',error=>errors.push(mode+': '+error.message));page.on('dialog',async dialog=>{dialogEvents.push(dialog.type());if(mode==='dirty-settings'&&dialog.type()==='beforeunload')await dialog.dismiss();else await dialog.accept();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.equal(url.origin,SITE,'all requests must remain on the intercepted origin');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      (request.method()==='GET'?reads:writes).push(request.method()==='GET'?path:{path,method:request.method(),body});
      if(path==='/api/admin/session')return route.fulfill(authenticated?json({user:accountUser(),csrfToken:'s'.repeat(43)}):json({},401));
      if(path==='/api/admin/login'){authenticated=true;account++;return route.fulfill(json({user:accountUser(),csrfToken:'t'.repeat(43)}));}
      if(path==='/api/admin/logout'){authenticated=false;return route.fulfill(json({ok:true}));}
      if(path==='/api/admin/registration-confirmation/settings'){
        if(request.method()==='PUT'){
          settingAttempts++;assert.equal(body.expectedRevision,0);assert.equal(typeof body.enabled,'boolean');assert.match(body.operationId,/^[A-Za-z0-9_-]{32,128}$/u);
          automaticEnabled=body.enabled;deliveryRevision=1;
          if(mode==='unknown-setting'&&settingAttempts===1)return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
          return route.fulfill(json({...delivery(),outcome:settingAttempts>1?'replayed':'updated'}));
        }
        if(mode==='settings-expired'||mode==='settings-late-401'&&account===0){if(mode==='settings-late-401')await heldStarted;authenticated=false;return route.fulfill(json({},401));}
        return route.fulfill(json(delivery()));
      }
      if(path==='/api/admin/users')return route.fulfill(json({revision:0,users:[{...accountUser(),username:'synthetic.operations',active:true,protected:true}]}));
      if(path==='/api/admin/group-invite'){
        if(mode==='settings-late-401'&&account===0){await new Promise(resolve=>{held=resolve;markHeld();});try{return await route.fulfill(json({},401));}finally{finishHeld();}}
        return route.fulfill(json({revision:0,configured:true,expired:true,expiresAt:'2026-10-20T01:00:00.000Z'}));
      }
      if(path==='/api/admin/group-invite/image')return route.fulfill({status:200,contentType:'image/png',body:png});
      if(path==='/api/admin/maintenance')return route.fulfill(json({enabled:false,backup:{available:false}}));
      if(path==='/api/admin/intent-invitations')return route.fulfill(json({revision:0,conversions:[],invitations:[],email:{ready:true,reason:'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF'}}));
      const match=path.match(/^\/api\/admin\/people\/(contacts|registrations)\/([^/]+)$/u);
      if(match){
        const kind=match[1]==='contacts'?'contact':'registration',id=decodeURIComponent(match[2]);
        if(id==='missing-synthetic')return route.fulfill(json({error:{code:'PERSON_NOT_FOUND',message:'未找到关联人员。'}},404));
        if(mode==='person-expired'){authenticated=false;return route.fulfill(json({},401));}
        if((mode.startsWith('late-')||mode==='person-account-late-401')&&id===CONTACT&&account===0){
          await new Promise(resolve=>{held=resolve;markHeld();});
          try{return await route.fulfill(['late-401','person-account-late-401'].includes(mode)?json({},401):json(syntheticPerson({kind,id,name:'PRIVATE-STALE-PERSON'})));}
          finally{finishHeld();}
        }
        const value=syntheticPerson({kind,id,restricted:mode==='restricted',unlinked:mode==='unlinked',unavailable:mode==='unavailable',attendee:mode==='attendee',draftPublic:mode==='public-draft',name:account>0?'合成新账号人员':id==='contact-next'?'合成下一位人员':'合成人员'});
        if(mode==='legacy-unavailable'){value.availability.invitations='unavailable';value.revisions.invitations=null;value.communications=communicationHistory({invitations:false,confirmations:false});value.communications.invitationTotal=value.communications.timelineTotal=1;value.communications.timeline=[{source:'legacy_invitation',id:'legacy-synthetic',status:'generated',channel:'manual',kind:null,at:AT}];}
        return route.fulfill(json(value));
      }
      unknown.push(path);return route.fulfill(json({error:{code:'UNIMPLEMENTED_SYNTHETIC_API'}},503));
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return await route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
    catch{return route.fulfill({status:404,body:''});}
  });
  return {context,page,writes,reads,unknown,dialogEvents,setAuthenticated:value=>{authenticated=value;},async waitHeld(){for(let i=0;i<200&&!held;i++)await page.waitForTimeout(10);assert.ok(held,'the delayed response was reached');},async release(){assert.ok(held);held();await heldDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}};
}

async function openSettings(f){await f.page.goto(SITE+'/admin/settings/',{waitUntil:'networkidle'});await f.page.locator('[data-settings-workspace]:visible').waitFor();}
async function openPerson(f,hash=CONTACT){await f.page.goto(SITE+'/admin/person/#contact='+hash,{waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();}
async function login(page,prefix){const form=page.locator(`[data-${prefix}-login]`);await form.locator('[name=username]').fill('synthetic.operations');await form.locator('[name=password]').fill('synthetic-password-123');await form.locator('button[type=submit]').click();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no full-page horizontal overflow');}

try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture({width});await openSettings(f);
    await f.page.locator('[data-delivery-state]:visible').waitFor();
    assert.match(await f.page.locator('[data-delivery-mail-ready]').textContent(),/可用/u);assert.match(await f.page.locator('[data-delivery-wallet-ready]').textContent(),/尚未开放/u);
    assert.match(await f.page.locator('[data-group-status]').textContent(),/已过期/u);assert.equal(await f.page.locator('[data-delivery-automatic] [name=enabled]').isChecked(),false);
    await f.page.locator('[data-settings-refresh]').click();await f.page.locator('[data-settings-page-status]').filter({hasText:'已重新读取'}).waitFor();
    await f.page.locator('[data-delivery-refresh]').click();await f.page.locator('[data-delivery-status]').filter({hasText:'已读取'}).waitFor();
    assert.deepEqual(f.writes,[],'opening and refreshing setup never writes or sends');assert.deepEqual(f.unknown,[]);await noOverflow(f.page);
    const current=f.page.locator('[data-staff-navigation] a[aria-current=page]');assert.equal(await current.getAttribute('href'),'/admin/settings/');
    const menu=f.page.locator('[data-staff-navigation-menu]');if(!(await menu.evaluate(node=>node.open)))await menu.locator('summary').click();await f.page.locator('[data-staff-section-link][href="#group-settings-title"]').click();await f.page.waitForFunction(()=>document.activeElement?.id==='group-settings-title');if(width<1100)assert.equal(await menu.evaluate(node=>node.open),false);
    if(width===390)await f.page.screenshot({path:resolve(evidence,'staff-settings-mobile.png'),fullPage:true});
    await f.context.close();reports.push({width,settingsReadable:true,mailAndWalletIndependent:true,expiredGroupQrVisible:true,readAndRefreshNeverSend:true});
  }

  const restrictedSettings=await fixture({role:'reviewer'});await restrictedSettings.page.goto(SITE+'/admin/settings/',{waitUntil:'networkidle'});
  assert.deepEqual(restrictedSettings.reads,['/api/admin/session'],'unprivileged settings page does not fetch staff private tools');assert.deepEqual(restrictedSettings.writes,[]);assert.equal(await restrictedSettings.page.locator('[data-delivery-state]').isVisible(),false);await restrictedSettings.context.close();reports.push({reviewerCannotReadSettingsSources:true});

  const dirtySettings=await fixture({mode:'dirty-settings'});await openSettings(dirtySettings);await dirtySettings.page.locator('[data-delivery-automatic] [name=enabled]').check();
  await dirtySettings.page.locator('[data-staff-navigation] a[href="/admin/contacts/"]').click();assert.equal(new URL(dirtySettings.page.url()).pathname,'/admin/settings/');assert.deepEqual(dirtySettings.dialogEvents,['beforeunload']);assert.deepEqual(dirtySettings.writes,[]);assert.equal(await dirtySettings.page.locator('[data-delivery-automatic] [name=enabled]').isChecked(),true);
  await dirtySettings.page.locator('[data-settings-logout]').click();await dirtySettings.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal(await dirtySettings.page.locator('[data-delivery-mail-ready]').textContent(),'');assert.equal(await dirtySettings.page.locator('[data-group-image]').getAttribute('src'),null);assert.equal(await dirtySettings.page.locator('[data-users-list]').textContent(),'');assert.equal(await dirtySettings.page.locator('[data-delivery-automatic] [name=enabled]').isChecked(),false);await dirtySettings.context.close();reports.push({dirtySettingsNavigationGuard:true,settingsLogoutClearsPrivateWidgets:true});

  const settingsExpired=await fixture({mode:'settings-expired'});await settingsExpired.page.goto(SITE+'/admin/settings/',{waitUntil:'networkidle'});
  await settingsExpired.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal(await settingsExpired.page.locator('[data-settings-workspace]').isVisible(),false);assert.equal(await settingsExpired.page.locator('[data-group-image]').getAttribute('src'),null);assert.equal(await settingsExpired.page.locator('[data-delivery-mail-ready]').textContent(),'');await settingsExpired.context.close();reports.push({settings401ClearsPrivateWidgets:true});

  const settingsRace=await fixture({mode:'settings-late-401'});await settingsRace.page.goto(SITE+'/admin/settings/',{waitUntil:'domcontentloaded'});await settingsRace.waitHeld();
  await settingsRace.page.locator('[data-settings-login-panel]:visible').waitFor();await login(settingsRace.page,'settings');await settingsRace.page.locator('[data-settings-workspace]:visible').waitFor();await settingsRace.page.locator('[data-delivery-state]:visible').waitFor();await settingsRace.release();
  assert.equal(await settingsRace.page.locator('[data-settings-workspace]').isVisible(),true);assert.match(await settingsRace.page.locator('[data-delivery-mail-ready]').textContent(),/可用/u);assert.equal(settingsRace.writes.filter(item=>item.path==='/api/admin/login').length,1);await settingsRace.context.close();reports.push({oldSettings401CannotClearNewAccount:true});

  const pending=await fixture({mode:'unknown-setting'});await openSettings(pending);
  await pending.page.locator('[data-delivery-automatic] [name=enabled]').check();await pending.page.locator('[data-delivery-automatic] button[type=submit]').click();
  await pending.page.locator('[data-delivery-pending]:visible').waitFor();assert.equal(pending.writes.length,1);await pending.page.waitForTimeout(100);assert.equal(pending.writes.length,1,'unknown acknowledgement never auto-retries');
  await pending.page.locator('[data-delivery-retry]').click();await pending.page.locator('[data-delivery-status]').filter({hasText:'已保存'}).waitFor();
  assert.equal(pending.writes.length,2);assert.deepEqual(pending.writes[1],pending.writes[0],'explicit retry retains the original operation ID and body');
  await pending.context.close();reports.push({explicitToggleRequired:true,unknownSettingRetainsExactRetry:true,noAutomaticRetry:true});

  const full=await fixture();await openPerson(full);assert.equal(await full.page.locator('[data-staff-navigation] a[href="/admin/contacts/"]').getAttribute('aria-current'),'location');
  assert.match(await full.page.locator('[data-person-name]').textContent(),/合成人员/u);assert.match(await full.page.locator('[data-person-profile]').textContent(),/synthetic@example.invalid/u);
  assert.match(await full.page.locator('[data-person-admission]').textContent(),/确认/u);assert.match(await full.page.locator('[data-person-arrangements]').textContent(),/合成专题分享/u);assert.match(await full.page.locator('[data-person-arrangements]').textContent(),/C01/u);
  assert.equal(await full.page.locator('[data-person-steps] > li').count(),5);assert.equal(await full.page.locator('[data-person-step=reply]').getAttribute('data-step-state'),'complete');assert.equal(await full.page.locator('[data-person-step=arrangements]').getAttribute('data-step-state'),'complete');assert.equal(await full.page.locator('[data-person-step=public]').getAttribute('data-step-state'),'complete');assert.ok(await full.page.locator('[data-person-actions] a').count()>0);assert.deepEqual(full.writes,[],'the individual workspace does not mutate records or send');assert.deepEqual(full.unknown,[]);await noOverflow(full.page);
  assert.match(await full.page.locator('[data-person-communications]').textContent(),/已准备，未记录发出/u);assert.match(await full.page.locator('[data-person-communications]').textContent(),/服务商已接受，未证明送达/u);
  assert.equal(await full.page.locator('[data-person-actions] [data-person-action=profile]').getAttribute('href'),'/admin/contacts/#profile='+CONTACT);
  await full.page.screenshot({path:resolve(evidence,'staff-person-desktop.png'),fullPage:true});await full.context.close();reports.push({personProfileAndAdmission:true,sessionAndBoothRoles:true,invitationAndEmailStatesDistinct:true,linksUseExistingActions:true,noPersonWrites:true});

  const reviewerPerson=await fixture({role:'reviewer',mode:'restricted',width:320});await reviewerPerson.page.goto(SITE+'/admin/person/#registration='+ID,{waitUntil:'networkidle'});await reviewerPerson.page.locator('[data-person-record]:visible').waitFor();
  assert.match(await reviewerPerson.page.locator('[data-person-registration]').textContent(),/报名编号/u);assert.match(await reviewerPerson.page.locator('[data-person-profile]').textContent(),/权限/u);assert.match(await reviewerPerson.page.locator('[data-person-communications]').textContent(),/服务商已接受，未证明送达/u);assert.equal(await reviewerPerson.page.locator('[data-person-action=profile]').count(),0);assert.equal(await reviewerPerson.page.locator('[data-person-action=review]').getAttribute('href'),'/admin/registrations/#registration='+ID);assert.equal(await reviewerPerson.page.locator('[data-person-step][data-step-state=complete]').count(),0,'restricted personnel facts are never marked complete');assert.deepEqual(reviewerPerson.writes,[]);await noOverflow(reviewerPerson.page);await reviewerPerson.context.close();reports.push({registrationEntryAndReviewerProjection:true});

  const publicDraft=await fixture({mode:'public-draft'});await openPerson(publicDraft);assert.equal(await publicDraft.page.locator('[data-person-step=public]').getAttribute('data-step-state'),'review');assert.match(await publicDraft.page.locator('[data-person-step=public]').textContent(),/待发布|旧版/u);assert.deepEqual(publicDraft.writes,[]);await publicDraft.context.close();reports.push({publicProfileRequiresCurrentPublishedDraft:true});

  const attendee=await fixture({mode:'attendee',width:390});await openPerson(attendee);assert.equal(await attendee.page.locator('[data-person-step=arrangements]').getAttribute('data-step-state'),'complete');assert.match(await attendee.page.locator('[data-person-step=arrangements]').textContent(),/当前职责不要求/u);assert.equal(await attendee.page.locator('[data-person-step=reply]').getAttribute('data-step-state'),'pending');assert.match(await attendee.page.locator('[data-person-step=reply]').textContent(),/服务商接受.*仍待本人回复/u);assert.match(await attendee.page.locator('[data-person-admission]').textContent(),/尚未确认/u);assert.deepEqual(attendee.writes,[]);await attendee.context.close();reports.push({attendeeNeedsNoSpeakerOrBooth:true,providerAcceptedIsNotPersonReply:true});

  const legacyPartial=await fixture({mode:'legacy-unavailable'});await openPerson(legacyPartial);assert.match(await legacyPartial.page.locator('[data-person-profile]').textContent(),/synthetic@example.invalid/u);assert.match(await legacyPartial.page.locator('[data-person-communications]').textContent(),/暂时无法核对/u);assert.match(await legacyPartial.page.locator('[data-person-communications]').textContent(),/手工邀请函记录.*已生成/u);assert.deepEqual(legacyPartial.writes,[]);await legacyPartial.context.close();reports.push({contactLegacyHistorySurvivesUnavailableInvitationSource:true});

  const editorPerson=await fixture({role:'editor'});await editorPerson.page.goto(SITE+'/admin/person/#contact='+CONTACT,{waitUntil:'networkidle'});assert.equal(editorPerson.reads.some(path=>path.startsWith('/api/admin/people/')),false);assert.equal(await editorPerson.page.locator('[data-person-record]').isVisible(),false);await editorPerson.context.close();reports.push({editorCannotReadPrivatePersonSources:true});

  for(const mode of ['restricted','unlinked','unavailable']){
    const f=await fixture({mode,role:mode==='restricted'?'outreach':'superadmin',width:390});await openPerson(f);
    const text=await f.page.locator('[data-person-record]').textContent();
    assert.match(text,mode==='restricted'?/权限|受限/u:mode==='unlinked'?/未关联|尚未关联/u:/暂时|无法|未能/u,mode+' must be distinct from empty successful data');assert.deepEqual(f.writes,[]);if(mode==='unavailable')assert.notEqual(await f.page.locator('[data-person-step=arrangements]').getAttribute('data-step-state'),'complete');await noOverflow(f.page);await f.context.close();reports.push({mode,partialSourcesHonest:true});
  }

  const invalid=await fixture();await invalid.page.goto(SITE+'/admin/person/#contact=%ZZ',{waitUntil:'networkidle'});assert.equal(invalid.reads.some(path=>path.startsWith('/api/admin/people/')),false);assert.equal(await invalid.page.locator('[data-person-record]').isVisible(),false);await invalid.context.close();reports.push({invalidFragmentNeverReadsPerson:true});

  const expired=await fixture({mode:'person-expired'});await expired.page.goto(SITE+'/admin/person/#contact='+CONTACT,{waitUntil:'networkidle'});await expired.page.locator('[data-person-login-panel]:visible').waitFor();assert.equal(await expired.page.locator('[data-person-record]').isVisible(),false);assert.doesNotMatch(await expired.page.locator('[data-person-record]').textContent(),/synthetic@example.invalid|合成人员/u);await expired.context.close();reports.push({expiredSessionClearsPerson:true});

  for(const mode of ['late-person','late-401']){
    const f=await fixture({mode});await f.page.goto(SITE+'/admin/person/#contact='+CONTACT,{waitUntil:'domcontentloaded'});await f.waitHeld();
    await f.page.evaluate(()=>{location.hash='contact=contact-next';});await f.page.locator('[data-person-name]').filter({hasText:'合成下一位人员'}).waitFor();await f.release();assert.equal(await f.page.locator('[data-person-name]').evaluate(node=>document.activeElement===node),true);
    assert.match(await f.page.locator('[data-person-name]').textContent(),/合成下一位人员/u);assert.doesNotMatch(await f.page.locator('[data-person-record]').textContent(),/PRIVATE-STALE-PERSON/u);assert.equal(await f.page.locator('[data-person-workspace]').isVisible(),true);await f.context.close();reports.push({mode,latePreviousPersonCannotReplaceCurrent:true});
  }
  const personRace=await fixture({mode:'person-account-late-401'});await personRace.page.goto(SITE+'/admin/person/#contact='+CONTACT,{waitUntil:'domcontentloaded'});await personRace.waitHeld();
  await personRace.page.locator('[data-person-logout]').click();await personRace.page.locator('[data-person-login-panel]:visible').waitFor();assert.equal(await personRace.page.locator('[data-person-record]').isVisible(),false);assert.equal(await personRace.page.locator('[data-person-profile]').textContent(),'');
  await login(personRace.page,'person');await personRace.page.locator('[data-person-name]').filter({hasText:'合成新账号人员'}).waitFor();await personRace.release();assert.match(await personRace.page.locator('[data-person-name]').textContent(),/合成新账号人员/u);assert.equal(await personRace.page.locator('[data-person-workspace]').isVisible(),true);
  await personRace.page.locator('[data-person-refresh]').click();await personRace.page.locator('[data-person-record]:visible').waitFor();assert.equal(personRace.writes.length,2,'refresh never writes or sends');await personRace.page.locator('[data-person-logout]').click();await personRace.page.locator('[data-person-login-panel]:visible').waitFor();assert.equal(await personRace.page.locator('[data-person-profile]').textContent(),'');assert.equal(await personRace.page.locator('[data-person-communications]').textContent(),'');await personRace.context.close();reports.push({logoutClearsPerson:true,oldPerson401CannotClearNewAccount:true,personRefreshReadOnly:true});

  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
