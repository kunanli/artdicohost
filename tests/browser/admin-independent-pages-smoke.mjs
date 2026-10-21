// Canonical Chromium acceptance over the actual isolated cloud runtime and native IndexedDB.
// Every HTTP request is intercepted. No production data, credentials or mail are used.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/admin-independent-pages');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:SITE,PEOPLE_FIXTURE_PASSWORD}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const KEYS=['overview','event','arrangements','guests','organizations','showcases','sessions','booths','publish'];
const routeFor=key=>'/admin/content/'+key+'/';
const BOOTH='synthetic-pages-booth',GUEST='synthetic-pages-guest',ORG='synthetic-pages-organization',SHOWCASE='synthetic-pages-showcase';
const UPDATED='PRIVATE-SYNTHETIC-UPDATED-PROJECT',EVENT='合成修改后的活动名称';
const AT='2026-10-21T09:00:00.000Z';
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const clone=value=>structuredClone(value);

async function seedContent(runtime){
  const content=(await runtime.app.store.read()).draft.content;
  content.organizations=[{id:ORG,name:'合成参与组织',logoId:'',website:'https://example.invalid/organization',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:'PRIVATE-SYNTHETIC-ORGANIZATION'}];
  content.guests=[{id:GUEST,name:'合成嘉宾',company:'合成机构',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,publicRoles:['guest'],internalNotes:'PRIVATE-SYNTHETIC-GUEST'}];
  content.booths=[{id:BOOTH,code:'C-01',slotNumber:1,zone:'C',organization:'合成参展组织',organizationId:ORG,project:'合成原展示项目',website:'',description:'合成展示说明',contactName:'合成负责人',contactMethods:'synthetic@example.invalid',status:'confirmed',internalNotes:''}];
  content.showcases=[{id:SHOWCASE,title:'合成学生作品',teamName:'合成团队',school:'合成学校',contactName:'合成学生',email:'synthetic.student@example.invalid',wechat:'',memberCount:2,participationForms:['booth'],responseStatus:'pending',materialLinks:'',summary:'合成作品说明',coverId:'',status:'pending',publicConsent:false,sessionId:'',boothId:'',internalNotes:''}];
  const checked=validateContent(content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  await runtime.app.store.save(0,checked.value,runtime.users[0].id);
  await runtime.app.store.publish(1,runtime.users[0].id);
  return clone(checked.value);
}

async function fixture(browser,errors,{width=1440,mode='normal',username='owner'}={}){
  const runtime=await peopleRuntimeFixture({capacity:3,mail:false}),initial=await seedContent(runtime);
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date(AT));
  const calls=[],dialogs=[],held=deferred(),holdReady=deferred();let fault=mode,used=false,holdSave=false,activeUser=username,logoutMode='normal',expirePath=null;
  // The late-response case deliberately delivers an old reply despite abort, proving epoch guards.
  if(mode==='late-save')await context.addInitScript(()=>{const original=fetch.bind(window);window.fetch=(input,options={})=>{const url=new URL(typeof input==='string'?input:input.url,location.href);return original(input,url.pathname==='/api/admin/content'&&options.method==='PUT'?{...options,signal:undefined}:options);};});
  page.on('pageerror',error=>errors.push(mode+': '+error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.accept();});
  async function setActor(name){activeUser=name;const auth=await runtime.login(name),[cookieName,...cookieValue]=auth.Cookie.split('=');await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name:cookieName,value:cookieValue.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);return auth;}
  await setActor(username);
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'all browser traffic stays intercepted');
    if(path.startsWith('/api/')){
      const body=req.postData()?JSON.parse(req.postData()):null,entry={path,method:req.method(),body};calls.push(entry);
      assert.equal(/\/(?:dispatch|send|sent|manual-sent)$/u.test(path),false,'editing/navigation must never send');
      assert.equal(path.endsWith('/publish'),false,'publication is outside these save scenarios');
      if(expirePath===path){expirePath=null;return route.fulfill(json({},401));}
      if(path==='/api/admin/logout'&&logoutMode!=='normal'){if(logoutMode==='network')return route.abort('failed');return route.fulfill(json({},401));}
      const isSave=path==='/api/admin/content'&&req.method()==='PUT';
      if(isSave&&!used){used=true;
        if(['first422','historical422','historical409'].includes(fault))return route.fulfill(json({error:{code:fault==='first422'?'VALIDATION_ERROR':'STORAGE_UNAVAILABLE',message:'合成明确拒绝或未确认回执'}},fault==='first422'?422:503));
        if(fault==='conflict')return route.fulfill(json({error:{code:'CONTENT_CONFLICT',message:'合成其他页面已更新'}},409));
        if(fault==='unknown-uncommitted')return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
      }else if(isSave&&['historical422','historical409'].includes(fault))return route.fulfill(json({error:{code:fault==='historical422'?'VALIDATION_ERROR':'CONTENT_CONFLICT',message:'合成原提交重试被拒绝'}},fault==='historical422'?422:409));
      const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));entry.status=response.status;
      if(isSave&&fault==='late-save'){holdSave=true;holdReady.resolve();await held.promise;holdSave=false;}
      if(isSave&&['unknown-committed','malformed','wrong-ack'].includes(fault)){
        fault='normal';if(mode==='unknown-committed')return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
        if(mode==='malformed')return route.fulfill(json({ok:true}));
        const value=await response.json();value.draft.content=clone(initial);return route.fulfill(json(value));
      }
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    const fromSource=path.startsWith('/__test_source__/'),base=fromSource?source:dist;
    const pathname=fromSource?path.slice('/__test_source__'.length):path.endsWith('/')?path+'index.html':path;
    const file=resolve(base,'.'+pathname);assert.ok(file.startsWith(base+'/'));
    try{return await route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  return{runtime,initial,page,context,calls,dialogs,mode,actor:()=>activeUser,setActor,setFault:value=>{fault=value;used=false;},setLogoutMode:value=>{logoutMode=value;},expireNext:path=>{expirePath=path;},waitHeld:()=>holdReady.promise,release:()=>held.resolve(),held:()=>holdSave,async close(){held.resolve();await context.close();}};
}
const saves=f=>f.calls.filter(call=>call.path==='/api/admin/content'&&call.method==='PUT');
const workspace=f=>f.page.locator('[data-admin-workspace]');
const savebar=f=>f.page.locator('[data-admin-savebar]');
async function waitState(f,state){await f.page.locator('[data-admin-savebar][data-save-state='+state+']').waitFor({state:'attached'});}
async function open(f,key='booths',fragment=''){await f.page.goto(SITE+routeFor(key)+fragment,{waitUntil:'networkidle'});await workspace(f).waitFor({state:'visible'});await f.page.locator('[data-content-panel='+key+']:visible').waitFor();await waitState(f,'loaded');}
async function reload(f){await f.page.reload({waitUntil:'networkidle'});await workspace(f).waitFor({state:'visible'});}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'page has no horizontal overflow');}
async function unchangedOthers(before,after,changed){for(const key of Object.keys(before))if(key!==changed)assert.deepEqual(after[key],before[key],'unrelated '+key+' remains unchanged');}
async function noSideEffects(f){assert.equal(f.runtime.messages.length,0);assert.equal(f.calls.some(call=>call.path.endsWith('/publish')),false);}
async function editBooth(f,value=UPDATED){await f.page.locator('[data-admin-booths] tr').first().getByRole('button',{name:'编辑',exact:true}).click();await f.page.locator('[data-booth-dialog][open]').waitFor();await f.page.locator('[data-booth-form] [name=project]').fill(value);}
async function submitBooth(f){await f.page.locator('[data-booth-submit]').click();}
async function savedBooth(f){await waitState(f,'saved');await f.page.locator('[data-booth-dialog]').waitFor({state:'hidden'});assert.equal((await f.runtime.app.store.read()).draft.content.booths[0].project,UPDATED);}
async function footerSave(f){await f.page.locator('[data-admin-save]').click();}
async function draftRows(page){return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('artdico-browser-drafts-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const req=db.transaction('drafts').objectStore('drafts').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}});}
async function waitLocal(f){await f.page.locator('[data-admin-local-status]').filter({hasText:/已暂存本机|本机已暂存/u}).waitFor();}
async function restore(f){await f.page.locator('[data-admin-local-restore]:visible').click();await f.page.locator('[data-admin-local-restore]').waitFor({state:'hidden'});}
async function navigate(f,key){const menu=f.page.locator('[data-staff-navigation-menu]');if(!await menu.evaluate(node=>node.open))await menu.locator('summary').click();await f.page.locator('[data-staff-section-link][href="'+routeFor(key)+'"]').click();}
async function hitTest(locator){await locator.scrollIntoViewIfNeeded();assert.equal(await locator.evaluate(node=>{const b=node.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.width>0&&b.height>0&&b.top>=0&&b.bottom<=innerHeight+1&&(hit===node||node.contains(hit));}),true,'bottom save remains visible and clickable');}
async function login(f,username='owner'){const form=f.page.locator('[data-admin-login]');await form.locator('[name=username]').fill(username);await form.locator('[name=password]').fill(PEOPLE_FIXTURE_PASSWORD);await form.locator('[data-admin-login-submit]').click();await workspace(f).waitFor({state:'visible'});}
async function assertPrivateCleared(f){await f.page.locator('[data-admin-login-panel]:visible').waitFor();const body=await f.page.evaluate(()=>document.body.textContent+' '+[...document.querySelectorAll('input,textarea')].map(node=>node.value).join(' '));assert.equal(body.includes(UPDATED),false);assert.equal(await f.page.locator('[data-admin-login-submit]').isEnabled(),true);}
async function seedLegacy(f){
  const content=clone(f.initial);content.event.title='PRIVATE-SYNTHETIC-LEGACY-EVENT';content.booths[0].project='PRIVATE-SYNTHETIC-LEGACY-BOOTH';
  await f.page.evaluate(async({actorId,eventId,roleKey,content})=>{const{createBrowserDraftStore}=await import('/__test_source__/src/lib/browser-drafts.mjs'),{CONTENT_DRAFT_POLICY}=await import('/__test_source__/src/lib/content-local-drafts.mjs');const store=createBrowserDraftStore(),scope={actorId,eventId,page:'content',entityId:'workspace'},head=await store.read(scope,CONTENT_DRAFT_POLICY);await store.write(scope,{expectedRevision:head.revision,actorEpoch:head.actorEpoch,kind:'editing',baseRevision:1,value:{schemaVersion:1,roleKey,content,forms:{},pendingSave:null}},CONTENT_DRAFT_POLICY);store.close();},{actorId:f.runtime.users[0].id,eventId:f.initial.eventId,roleKey:[...f.runtime.users[0].roles].sort().join(','),content});
}

async function navigationCases(browser,errors,reports){
  {
    const f=await fixture(browser,errors);
    for(const key of KEYS){await open(f,key);assert.equal(new URL(f.page.url()).pathname,routeFor(key));assert.equal(await f.page.locator('#artdico-admin').getAttribute('data-content-page'),key);assert.equal(await f.page.locator('[data-content-panel]').count(),9);assert.equal(await f.page.locator('[data-content-panel]:visible').count(),1);assert.equal(await f.page.locator('[data-staff-section-link][aria-current=page]').getAttribute('href'),routeFor(key));assert.ok((await f.page.locator('[data-content-page-title]').textContent()).trim());await reload(f);assert.equal(await f.page.locator('[data-content-panel='+key+']').isVisible(),true);}
    assert.deepEqual(saves(f),[]);await noSideEffects(f);await f.close();reports.push({group:'navigation',nineContentDirectUrlsReloadAndOneVisiblePanel:true,noNavigationWrites:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'event');await navigate(f,'booths');await f.page.waitForURL(SITE+routeFor('booths'));await f.page.goBack({waitUntil:'networkidle'});await f.page.locator('[data-content-panel=event]:visible').waitFor();await f.page.goForward({waitUntil:'networkidle'});await f.page.locator('[data-content-panel=booths]:visible').waitFor();assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'navigation',realPathHistoryBackAndForward:true});
  }
  {
    const f=await fixture(browser,errors);for(const[key,hash]of[['event','event-editor-title'],['arrangements','arrangements-title'],['guests','guests-title'],['organizations','organizations-title'],['showcases','showcases-title'],['sessions','sessions-title'],['booths','booths-title']]){await f.page.goto(SITE+'/admin/#'+hash,{waitUntil:'networkidle'});await f.page.locator('[data-content-panel='+key+']:visible').waitFor();assert.equal(new URL(f.page.url()).pathname,routeFor(key));}
    for(const[key,hash,form,id]of[['booths','booth='+BOOTH,'booth',BOOTH],['organizations','organization='+ORG,'organization',ORG]]){await f.page.goto(SITE+'/admin/#'+hash,{waitUntil:'networkidle'});await f.page.locator('[data-'+form+'-dialog][open]').waitFor();assert.equal(new URL(f.page.url()).pathname,routeFor(key));assert.equal(await f.page.locator('[data-'+form+'-form] [name=id]').inputValue(),id);await f.page.locator(form==='booth'?'[data-close-dialog=booth]':'[data-organization-close]').first().click();}
    assert.deepEqual(saves(f),[]);await noSideEffects(f);await f.close();reports.push({group:'navigation',legacySectionAndEntityLinksCanonicalAndReadOnly:true});
  }
  {
    const f=await fixture(browser,errors);for(const key of['delivery','group','invitations','accounts']){const checkpoint=f.calls.length;await f.page.goto(SITE+'/admin/settings/'+key+'/',{waitUntil:'networkidle'});await f.page.locator('[data-settings-workspace]:visible').waitFor();await f.page.locator('[data-settings-panel='+key+']:visible').waitFor();assert.equal(await f.page.locator('[data-settings-admin]').getAttribute('data-settings-section'),key);assert.equal(await f.page.locator('[data-settings-panel]:visible').count(),1);assert.equal(await f.page.locator('[data-staff-section-link][aria-current=page]').getAttribute('href'),'/admin/settings/'+key+'/');const reads=f.calls.slice(checkpoint).filter(call=>call.method==='GET').map(call=>call.path);if(key!=='accounts')assert.equal(reads.some(path=>path==='/api/admin/users'||path.startsWith('/api/admin/maintenance')),false);if(key==='invitations')assert.deepEqual(reads,['/api/admin/session']);await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-settings-panel='+key+']:visible').waitFor();}
    const auth=await f.runtime.login(),response=await f.runtime.app.handle(f.runtime.request('/api/admin/users',{method:'POST',headers:auth,body:{expectedRevision:0,username:'synthetic-collaborator',label:'合成完整协作者',roles:['editor','publisher','outreach','reviewer'],active:true,password:PEOPLE_FIXTURE_PASSWORD}}));assert.equal(response.status,200);await f.setActor('synthetic-collaborator');const checkpoint=f.calls.length;await f.page.goto(SITE+'/admin/settings/accounts/',{waitUntil:'networkidle'});await f.page.locator('[data-settings-access-denied]:visible').waitFor();assert.equal(f.calls.slice(checkpoint).some(call=>call.path==='/api/admin/users'||call.path.startsWith('/api/admin/maintenance')),false);assert.equal(await f.page.locator('[data-settings-accounts]').isVisible(),false);assert.deepEqual(saves(f),[]);await noSideEffects(f);await f.close();reports.push({group:'navigation',fourSettingsDirectPagesWithScopedReads:true,fullCollaboratorAccountsDeniedBeforePrivateReads:true});
  }
  for(const width of[320,390,1440]){
    const f=await fixture(browser,errors,{width});await open(f,'event');await f.page.locator('[data-event-form] [name=title]').fill(EVENT);await hitTest(f.page.locator('[data-admin-save]'));await noOverflow(f.page);await f.page.screenshot({path:resolve(evidence,'event-footer-'+width+'.png'),fullPage:true});await footerSave(f);await waitState(f,'saved');assert.equal(saves(f).length,1);
    await navigate(f,'booths');await f.page.waitForURL(SITE+routeFor('booths'));await editBooth(f);await hitTest(f.page.locator('[data-booth-submit]'));await noOverflow(f.page);await f.page.screenshot({path:resolve(evidence,'booth-editor-'+width+'.png')});await submitBooth(f);await savedBooth(f);assert.equal(saves(f).length,2);await noSideEffects(f);await f.close();reports.push({group:'navigation',width,bottomFooterAndModalSaveActuallyHitTested:true,noPageOverflow:true});
  }
}

async function saveCases(browser,errors,reports){
  for(const{key,type,field,value,contentKey}of[
    {key:'event',type:'event',field:'title',value:EVENT,contentKey:'event'},
    {key:'guests',type:'guest',field:'name',value:'合成更新嘉宾',contentKey:'guests'},
    {key:'organizations',type:'organization',field:'name',value:'合成更新组织',contentKey:'organizations'},
    {key:'showcases',type:'showcase',field:'title',value:'合成更新学生作品',contentKey:'showcases'},
    {key:'sessions',type:'session',field:'title',value:'合成更新场次',contentKey:'sessions'},
    {key:'booths',type:'booth',field:'project',value:UPDATED,contentKey:'booths'}]){
    const f=await fixture(browser,errors);await open(f,key);
    if(type!=='event'){const container=f.page.locator(type==='organization'?'[data-organization-list]':type==='showcase'?'[data-admin-showcases]':'[data-admin-'+contentKey+']');await container.getByRole('button',{name:'编辑',exact:true}).first().click();await f.page.locator('[data-'+type+'-dialog][open]').waitFor();}
    const form=f.page.locator('[data-'+type+'-form]');await form.locator('[name='+field+']').fill(value);const id=type==='event'?null:await form.locator('[name=id]').inputValue();
    await(type==='event'?footerSave(f):form.locator('button[type=submit]').click());await waitState(f,'saved');if(type!=='event')await f.page.locator('[data-'+type+'-dialog]').waitFor({state:'hidden'});
    assert.equal(saves(f).length,1,'one final save gesture sends one actual CAS');const saved=await f.runtime.app.store.read();assert.equal(saved.draft.revision,2);assert.equal(saved.published.revision,1);await unchangedOthers(f.initial,saved.draft.content,contentKey);assert.equal(type==='event'?saved.draft.content.event[field]:saved.draft.content[contentKey].find(item=>item.id===id)[field],value);
    await reload(f);await waitState(f,'loaded');if(type==='event')assert.equal(await form.locator('[name='+field+']').inputValue(),value);else assert.match(await f.page.locator('[data-content-panel='+key+']').textContent(),new RegExp(value,'u'));await noSideEffects(f);await f.close();reports.push({group:'save',type,oneGestureActualCasExactAckAndRefresh:true,unrelatedSectionsUnchanged:true,noAutomaticPublication:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'arrangements');await f.page.locator('[data-arrangements-slots] [data-slot-number="2"] [data-arrangements-plan=booth]').click();await f.page.locator('[data-planner-booth] [name=project]').fill('合成直接保存规划展位');await f.page.locator('[data-planner-apply]').click();await waitState(f,'saved');assert.equal(saves(f).length,1);const current=(await f.runtime.app.store.read()).draft.content;assert.equal(current.booths.find(item=>item.slotNumber===2).project,'合成直接保存规划展位');assert.deepEqual(current.booths.find(item=>item.id===BOOTH),f.initial.booths[0]);await unchangedOthers(f.initial,current,'booths');await reload(f);await f.page.locator('[data-arrangements-slots] [data-slot-number="2"]').filter({hasText:'合成直接保存规划展位'}).waitFor();await noSideEffects(f);await f.close();reports.push({group:'save',arrangementPlannerOneGestureCloudSave:true,existingBoothAndOtherSectionsPreserved:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'guests');await f.page.locator('[data-admin-guests]').getByRole('button',{name:'编辑',exact:true}).first().click();const image=await f.page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=960;canvas.height=960;const context=canvas.getContext('2d');context.fillStyle='#2761aa';context.fillRect(0,0,960,960);context.fillStyle='#fff';context.fillRect(250,180,420,650);return canvas.toDataURL('image/png').split(',')[1];});await f.page.locator('[data-guest-portrait-file]').setInputFiles({name:'synthetic-portrait.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await f.page.locator('[data-guest-image-editor] [data-image-editor]:visible').waitFor();assert.equal(await f.page.locator('[data-guest-submit]').isDisabled(),true);assert.deepEqual(saves(f),[]);await f.page.locator('[data-guest-image-editor] [data-image-editor-apply]').click();await f.page.waitForFunction(()=>/^[a-f0-9]{64}\.(?:png|jpg|webp)$/u.test(document.querySelector('[data-guest-form] [name=portraitId]').value));const portraitId=await f.page.locator('[data-guest-form] [name=portraitId]').inputValue();assert.deepEqual(saves(f),[]);await f.page.locator('[data-guest-submit]').click();await waitState(f,'saved');assert.equal(saves(f).length,1);assert.equal((await f.runtime.app.store.read()).draft.content.guests[0].portraitId,portraitId);await reload(f);await f.page.locator('[data-admin-guests] img').evaluate(image=>image.decode());await noSideEffects(f);await f.close();reports.push({group:'save',uploadBlocksSubmitUntilReady:true,uploadedPortraitSingleSaveAndRefresh:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'sessions');await f.page.locator('[data-admin-sessions]').getByRole('button',{name:'编辑',exact:true}).first().click();const form=f.page.locator('[data-session-form]');await form.locator('[name=start]').fill('18:00');await form.locator('[name=end]').fill('10:00');await form.locator('button[type=submit]').click();await f.page.locator('[data-session-error]:visible').waitFor();assert.equal(await f.page.locator('[data-session-dialog]').isVisible(),true);assert.equal(await form.locator('[name=start]').inputValue(),'18:00');assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'save',crossFieldValidationKeepsFormAndDoesNotPut:true});
  }
  for(const mode of['conflict','unknown-uncommitted','unknown-committed','malformed','wrong-ack']){
    const f=await fixture(browser,errors,{mode});await open(f);if(mode==='conflict'){f.setFault('normal');const other=clone((await f.runtime.app.store.read()).draft.content);other.event.title='合成其他同事已保存';await f.runtime.app.store.save(1,other,f.runtime.users[0].id);}await editBooth(f);await submitBooth(f);await waitState(f,mode==='conflict'?'conflict':'unknown');assert.equal(await f.page.locator('[data-booth-dialog]').isVisible(),true);assert.equal(await f.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.equal(saves(f).length,1);assert.doesNotMatch(await f.page.locator('[data-admin-status]').textContent(),/已确认保存|草稿已保存/u);
    if(mode.startsWith('unknown-')){const original=clone(saves(f)[0]);await f.page.locator('[data-admin-check-save]:visible').click();if(mode==='unknown-committed')await savedBooth(f);else{await f.page.locator('[data-admin-retry-save]:visible').waitFor();await f.page.locator('[data-admin-retry-save]').click();await savedBooth(f);assert.deepEqual(saves(f)[1],original);}assert.equal(saves(f).length,mode==='unknown-committed'?1:2);}
    await noSideEffects(f);await f.close();reports.push({group:'save',mode,noFalseSuccessOrAutomaticRetry:true,failedFormRetained:true,exactOriginalRetryOrReadOnlyProof:mode.startsWith('unknown-')});
  }
  for(const mode of['historical422','historical409']){
    const f=await fixture(browser,errors,{mode});await open(f);await editBooth(f);await submitBooth(f);await waitState(f,'unknown');const original=clone(saves(f)[0]);await f.page.locator('[data-admin-check-save]:visible').click();await f.page.locator('[data-admin-retry-save]:visible').waitFor();await f.page.locator('[data-admin-retry-save]').click();await waitState(f,mode==='historical409'?'conflict':'unknown');assert.deepEqual(saves(f)[1],original);const row=(await draftRows(f.page)).find(row=>row.scope.page==='content');assert.equal(row.kind,'pending_submission');assert.deepEqual(row.value.pendingSave,original.body);await reload(f);await f.page.locator('[data-admin-local-restore]:visible').waitFor();assert.equal(saves(f).length,2);await restore(f);await f.page.locator('[data-admin-check-save]:visible').waitFor();assert.equal(saves(f).length,2);await f.close();reports.push({group:'save',mode,historicalUnknownNotDowngradedByLaterRejection:true,pendingBodyPreservedAcrossRefresh:true});
  }
}

async function draftCases(browser,errors,reports){
  {
    const f=await fixture(browser,errors);await open(f);await editBooth(f);await waitLocal(f);const id=await f.page.locator('[data-booth-form] [name=id]').inputValue();await reload(f);await f.page.locator('[data-admin-local-restore]:visible').waitFor();assert.deepEqual(saves(f),[]);await restore(f);await f.page.locator('[data-booth-dialog][open]').waitFor();assert.equal(await f.page.locator('[data-booth-form] [name=id]').inputValue(),id);assert.equal(await f.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.deepEqual(saves(f),[]);await submitBooth(f);await savedBooth(f);assert.equal(saves(f).length,1);await f.close();reports.push({group:'drafts',rawInputNativeIdbRefreshExplicitRestoreAndOneSave:true,stableEntityId:true});
  }
  for(const action of['cancel','discard','save']){
    const f=await fixture(browser,errors);await open(f,'event');await f.page.locator('[data-event-form] [name=title]').fill(EVENT);await waitLocal(f);await navigate(f,'booths');await f.page.locator('[data-admin-navigation-dialog][open]').waitFor();assert.equal(new URL(f.page.url()).pathname,routeFor('event'));await f.page.locator('[data-admin-navigation-'+action+']').click();
    if(action==='cancel'){await f.page.locator('[data-admin-navigation-dialog]').waitFor({state:'hidden'});assert.equal(new URL(f.page.url()).pathname,routeFor('event'));assert.equal(await f.page.locator('[data-event-form] [name=title]').inputValue(),EVENT);assert.deepEqual(saves(f),[]);}
    else{await f.page.waitForURL(SITE+routeFor('booths'));await workspace(f).waitFor({state:'visible'});assert.equal(saves(f).length,action==='save'?1:0);const current=await f.runtime.app.store.read();assert.equal(current.draft.content.event.title,action==='save'?EVENT:f.initial.event.title);assert.equal(await f.page.locator('[data-admin-local-recovery]').isVisible(),false);}
    await noSideEffects(f);await f.close();reports.push({group:'drafts',action,unsavedCrossPageChoiceExplicitAndHonest:true});
  }
  {
    const f=await fixture(browser,errors,{mode:'unknown-uncommitted'});await open(f,'event');await f.page.locator('[data-event-form] [name=title]').fill(EVENT);await navigate(f,'booths');await f.page.locator('[data-admin-navigation-save]').click();await waitState(f,'unknown');assert.equal(new URL(f.page.url()).pathname,routeFor('event'));assert.equal(await f.page.locator('[data-admin-navigation-dialog]').isVisible(),true);assert.equal(saves(f).length,1);await f.close();reports.push({group:'drafts',saveAndGoWaitsForConfirmedCloudAck:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'booths');await editBooth(f);await waitLocal(f);await f.page.goto(SITE+routeFor('event'),{waitUntil:'networkidle'});await f.page.locator('[data-admin-local-restore]:visible').waitFor();await restore(f);await f.page.locator('[data-content-panel=booths]:visible').waitFor();await f.page.locator('[data-booth-dialog][open]').waitFor();assert.equal(new URL(f.page.url()).pathname,routeFor('booths'));assert.equal(await f.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'drafts',directPageRecoveryReturnsToOwningSectionWithoutAutosave:true});
  }
  {
    const f=await fixture(browser,errors);await open(f);await editBooth(f);await waitLocal(f);const other=clone((await f.runtime.app.store.read()).draft.content);other.event.title='合成其他页最新活动';await f.runtime.app.store.save(1,other,f.runtime.users[0].id);await reload(f);await f.page.locator('[data-admin-local-recovery]:visible').waitFor();assert.equal(await f.page.locator('[data-admin-local-restore]').isVisible(),false);assert.match(await f.page.locator('[data-admin-local-message]').textContent(),/更新|变化/u);assert.deepEqual(saves(f),[]);assert.equal((await f.runtime.app.store.read()).draft.content.event.title,'合成其他页最新活动');await f.close();reports.push({group:'drafts',staleWorkspaceDraftNeverOverwritesAnotherPageSave:true,readOnlyRecoveryUntilExplicitReconciliation:true});
  }
  {
    const f=await fixture(browser,errors);await open(f,'event');await seedLegacy(f);await reload(f);await f.page.locator('[data-admin-local-restore]:visible').waitFor();await restore(f);await f.page.locator('[data-admin-legacy-warning]:visible').waitFor();assert.match(await f.page.locator('[data-admin-legacy-warning]').textContent(),/整份|全部|其他区块/u);assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'drafts',oldWholeWorkspaceDraftExplicitRecoveryWarning:true,noSilentHiddenSectionSave:true});
  }
  for(const quota of[false,true]){
    const f=await fixture(browser,errors,{mode:'first422'});await open(f);await editBooth(f);await waitLocal(f);if(quota)await f.page.evaluate(()=>{const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='drafts'&&value?.kind==='editing'&&value.scope?.page==='content')throw new DOMException('SYNTHETIC_QUOTA','QuotaExceededError');return original.call(this,value,...args);};});await submitBooth(f);await f.page.waitForFunction(()=>{const state=document.querySelector('[data-admin-savebar]')?.dataset.saveState;return ['unknown','unapplied','dirty','conflict'].includes(state);});const row=(await draftRows(f.page)).find(row=>row.scope.page==='content');assert.equal(row.kind,quota?'pending_submission':'editing');assert.equal((await f.runtime.app.store.read()).draft.revision,1);assert.equal(await f.page.locator('[data-booth-form] [name=project]').inputValue(),UPDATED);assert.equal(saves(f).length,1);await f.close();reports.push({group:'drafts',quota,firstKnown422AtomicEditingOrIntactPendingRollback:true,inputsRetained:true});
  }
  for(const logoutMode of['expired','network']){
    const f=await fixture(browser,errors);await open(f);await editBooth(f);await waitLocal(f);f.setLogoutMode(logoutMode);await f.page.locator('[data-admin-logout]').evaluate(node=>node.click());await assertPrivateCleared(f);assert.equal((await draftRows(f.page)).some(row=>row.scope.actorId===f.runtime.users[0].id),false);assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'drafts',logoutMode,explicitLogoutClearsPrivateDomAndActorCacheEvenWithoutAck:true});
  }
  {
    const f=await fixture(browser,errors);await open(f);await editBooth(f);await waitLocal(f);f.expireNext('/api/admin/content');await submitBooth(f);await assertPrivateCleared(f);await login(f,'editoroutreach');assert.equal(await f.page.locator('[data-admin-local-recovery]').isVisible(),false);assert.equal((await f.page.locator('[data-booth-form] [name=project]').inputValue()).includes(UPDATED),false);await f.page.locator('[data-admin-logout]').click();await login(f,'owner');await f.page.locator('[data-admin-local-restore]:visible').waitFor();assert.deepEqual(saves(f),[]);await f.close();reports.push({group:'drafts',expiryRetainsOnlySameActorRecovery:true,otherActorNeverSeesOrRestoresPriorFields:true});
  }
  {
    const f=await fixture(browser,errors,{mode:'late-save'});await open(f);await editBooth(f);await submitBooth(f);await f.waitHeld();const sibling=await f.context.newPage();sibling.on('pageerror',error=>errors.push('late-save-sibling: '+error.message));sibling.on('dialog',dialog=>dialog.accept());await sibling.goto(SITE+routeFor('event'),{waitUntil:'networkidle'});await sibling.locator('[data-admin-workspace]:visible').waitFor();await sibling.locator('[data-admin-logout]').click();await sibling.locator('[data-admin-login-panel]:visible').waitFor();await assertPrivateCleared(f);await login(f,'editoroutreach');f.release();await f.page.waitForLoadState('networkidle');assert.equal(await workspace(f).isVisible(),true);assert.match(await f.page.locator('[data-admin-user]').textContent(),/editoroutreach/u);assert.doesNotMatch(await f.page.locator('[data-admin-status]').textContent(),/已确认保存|草稿已保存/u);assert.equal((await draftRows(f.page)).some(row=>row.scope.actorId===f.runtime.users[0].id),false);assert.equal(saves(f).length,1);await f.close();reports.push({group:'drafts',lateOldSaveDoesNotMutateNewActorSessionOrShowOldSuccess:true});
  }
}

export async function runAdminIndependentBrowser({groups=['navigation','save','drafts']}={}){
  await mkdir(evidence,{recursive:true});const errors=[],reports=[];
  const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try{if(groups.includes('navigation'))await navigationCases(browser,errors,reports);if(groups.includes('save'))await saveCases(browser,errors,reports);if(groups.includes('drafts'))await draftCases(browser,errors,reports);assert.deepEqual(errors,[]);console.log(JSON.stringify({groups,cases:reports.length,reports,pageErrors:errors,syntheticOnly:true,actualRuntime:true,nativeIndexedDB:true},null,2));return reports;}finally{await browser.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await runAdminIndependentBrowser();
