// Real Chromium and real volunteer API/service/repository over synthetic memory storage.
// Every HTTP request is intercepted. This script never contacts a cloud or mail provider.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {extname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readSheet} from 'read-excel-file/node';
import {volunteerFixture,VOLUNTEER_FIXTURE_SECRET} from '../volunteer-api-fixture.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),SITE='https://api.artdico.host';
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const errors=[],reports=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const staff=roles=>({id:'synthetic-volunteer-staff',label:'合成志愿工作同事',roles});
const selectors=kind=>({dialog:`[data-volunteer-${kind}-dialog]`,form:`[data-volunteer-${kind}-form]`,error:`[data-volunteer-${kind}-error]`});

async function fixture({width=1280,roles=['superadmin'],mode='normal',seed=true,hash='',manySources=false}={}){
  const context=await browser.newContext({viewport:{width,height:950},acceptDownloads:true}),page=await context.newPage();page.setDefaultTimeout(10000);
  let authenticated=true,account=0,held=null,finishHeld=null,markHeld=null,intercepted=false,denyNext=false,mainReads=0;
  const heldStarted=new Promise(resolve=>{markHeld=resolve;}),heldDone=new Promise(resolve=>{finishHeld=resolve;});
  const user=()=>({...staff(roles),id:'synthetic-volunteer-staff-'+account}),csrfToken='s'.repeat(43);
  const backend=await volunteerFixture({authenticate:async()=>authenticated?{user:user(),csrfToken}:null});
  if(manySources)for(let index=0;index<140;index++){const record=structuredClone(backend.sources.contacts.contacts[1]);record.id='synthetic_page_'+String(index).padStart(3,'0');record.profile.name='合成分页人员 '+String(index).padStart(3,'0');backend.sources.contacts.contacts.push(record);}
  const writes=[],reads=[],dialogs=[],downloads=[];
  const seeded={};
  if(seed){
    const candidates=(await backend.service.sources({actor:staff(['superadmin'])})).candidates;
    const admitted=candidates.find(row=>row.eligible&&row.admissionStatus==='confirmed');
    assert.ok(admitted,'synthetic fixture supplies an eligible, admitted existing person');
    seeded.source=admitted.source;seeded.name=admitted.name;
    const operate=async(action,payload)=>backend.service.operate({actor:staff(['superadmin']),expectedRevision:(await backend.repository.read()).revision,operationId:randomUUID(),action,payload});
    await operate('volunteer_upsert',{id:'synthetic-volunteer-one',source:admitted.source,workflowStatus:'confirmed',owner:'合成排班同事',followUpAt:'2026-11-25',lastContactAt:'2026-10-20',notes:'合成沟通备注',availability:[{start:'09:00',end:'12:00'}]});
    await operate('position_upsert',{id:'synthetic-position-one',name:'合成签到岗位',zone:'A',location:'合成签到处',lead:'合成组长',description:'核对合成入场资料',status:'active'});
    for(const [id,start,end,required,status] of [['synthetic-shift-one','09:00','10:00',2,'active'],['synthetic-shift-two','10:00','11:00',1,'active'],['synthetic-shift-overlap','09:30','10:30',1,'active'],['synthetic-shift-outside','12:00','13:00',1,'active'],['synthetic-shift-cancelled','11:00','12:00',1,'cancelled']])await operate('shift_upsert',{id,positionId:'synthetic-position-one',start,end,required,status,sessionId:'',boothId:''});
    await operate('assignment_upsert',{id:'synthetic-assignment-one',volunteerId:'synthetic-volunteer-one',shiftId:'synthetic-shift-one',status:'confirmed'});
  }
  page.on('pageerror',error=>errors.push(mode+': '+error.message));page.on('download',download=>downloads.push(download));
  page.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message()});if(mode==='dirty' || mode==='pending-dirty')await dialog.dismiss();else await dialog.accept();});
  await context.addInitScript(()=>{window.privateVolunteerUrls={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=value=>{const url=create(value);window.privateVolunteerUrls.created.push(url);return url;};URL.revokeObjectURL=url=>{window.privateVolunteerUrls.revoked.push(url);return revoke(url);};});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.equal(url.origin,SITE,'all browser network must be intercepted at the synthetic origin');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      (request.method()==='GET'?reads:writes).push(request.method()==='GET'?url.pathname+url.search:{path,method:request.method(),body,raw:request.postData()});
      if(path==='/api/admin/session')return route.fulfill(authenticated?json({user:user(),csrfToken}):json({},401));
      if(path==='/api/admin/login'){authenticated=true;account++;return route.fulfill(json({user:user(),csrfToken}));}
      if(path==='/api/admin/logout'){authenticated=false;return route.fulfill(json({loggedOut:true}));}
      assert.ok(path.startsWith('/api/admin/volunteers'),'the volunteer module must not write other profiles, admission, publication or mail');
      const isMain=request.method()==='GET'&&path==='/api/admin/volunteers';if(isMain)mainReads++;
      if(denyNext&&isMain){denyNext=false;authenticated=false;return route.fulfill(json({},401));}
      const apiRequest=new Request(request.url(),{method:request.method(),headers:request.headers(),...(request.method()==='GET'?{}:{body:request.postData()})});
      if(!intercepted&&((mode==='unknown-committed'||mode==='unknown-uncommitted')&&request.method()!=='GET')){
        intercepted=true;if(mode==='unknown-committed')assert.equal((await backend.api(apiRequest)).status,200);
        return route.fulfill(json({error:{code:'UNAVAILABLE',message:'合成保存回执未确认。'}},503));
      }
      const heldSource=path==='/api/admin/volunteers/sources'&&url.searchParams.get('kind')==='contact'&&url.searchParams.get('id')==='contact_01';
      if(!intercepted&&((isMain&&mainReads===2&&['late-200','late-401'].includes(mode))||(heldSource&&['source-late-200','source-late-401'].includes(mode)))){
        intercepted=true;const response=await backend.api(apiRequest);await new Promise(resolve=>{held=resolve;markHeld();});
        try{return await route.fulfill(mode.endsWith('late-401')?json({},401):{status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}finally{finishHeld();}
      }
      const response=await backend.api(apiRequest);
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});
  });
  return {context,page,backend,writes,reads,dialogs,downloads,seeded,hash,setAuthenticated:value=>{authenticated=value;},setRoles:value=>{roles.splice(0,roles.length,...value);},expireNext:()=>{denyNext=true;},async waitHeld(){let timer;try{await Promise.race([heldStarted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Synthetic delayed response was not requested: '+mode)),10000);timer.unref();})]);assert.ok(held);}finally{clearTimeout(timer);}},async release(){assert.ok(held);held();await heldDone;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}};
}
async function open(f){try{await f.page.goto(SITE+'/admin/volunteers/'+f.hash,{waitUntil:'domcontentloaded'});}catch(error){throw new Error('Volunteer page loading: '+JSON.stringify({reads:f.reads,pageErrors:errors,state:await f.page.evaluate(()=>({status:document.querySelector('[data-volunteer-status]')?.textContent,error:document.querySelector('[data-volunteer-error]')?.textContent,source:document.querySelector('[data-volunteer-source-status]')?.textContent}))}),{cause:error});}await f.page.locator('[data-volunteer-authorized]:visible').waitFor();await f.page.locator('[data-volunteer-revision]').filter({hasText:/\d/u}).waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no full-page horizontal overflow');}
async function login(f){const form=f.page.locator('[data-volunteer-login]');await form.locator('[name=username]').fill('synthetic.volunteer');await form.locator('[name=password]').fill('synthetic-password-123');await form.locator('button[type=submit]').click();await f.page.locator('[data-volunteer-authorized]:visible').waitFor();}
async function begin(f,kind){await f.page.locator(`[data-volunteer-${kind==='person'?'add':'add-'+kind}]`).click();await f.page.locator(selectors(kind).dialog+'[open]').waitFor();return f.page.locator(selectors(kind).form);}
async function save(f,kind){const form=f.page.locator(selectors(kind).form);await form.locator('button[type=submit]').click();}
async function saved(f,kind){await f.page.locator(selectors(kind).dialog).waitFor({state:'hidden'});assert.equal(await f.page.locator('[data-volunteer-pending]').isVisible(),false);}
async function addAssignment(f,shiftId,status='confirmed'){const form=await begin(f,'assignment');await form.locator('[name=volunteerId]').selectOption('synthetic-volunteer-one');await form.locator('[name=shiftId]').selectOption(shiftId);await form.locator('[name=status]').selectOption(status);return form;}
async function dismiss(f,kind){await f.page.locator(`[data-volunteer-close=${kind}]`).first().click();await f.page.locator(selectors(kind).dialog).waitFor({state:'hidden'});}
async function metric(page,label,value){assert.equal(await page.locator('[data-volunteer-metrics] > *').filter({hasText:label}).locator('strong').textContent(),value);}

try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture({width});await open(f);
    assert.match(await f.page.locator('[data-volunteer-roster]').textContent(),/合成沟通备注|合成排班同事/u);assert.match(await f.page.locator('[data-volunteer-shifts]').textContent(),/09:00.*10:00/u);
    const view=await f.backend.service.read({actor:staff(['superadmin'])});assert.equal(view.summary.activePeopleCount,1);assert.equal(view.summary.confirmedSlots,1);assert.equal(view.summary.requiredSlots,5);assert.equal(view.summary.gapSlots,4);
    await metric(f.page,'有效志愿者','1 人');await metric(f.page,'班次总需求','5 人次');await metric(f.page,'已确认覆盖','1 人次');await metric(f.page,'尚缺人手','4 人次');assert.equal((await f.page.locator('body').textContent()).includes(VOLUNTEER_FIXTURE_SECRET),false);assert.deepEqual(f.writes,[],'opening the roster never writes or sends');
    const form=await begin(f,'person');assert.equal(await form.locator('[name=source]').inputValue(),'');await dismiss(f,'person');assert.deepEqual(f.writes,[],'opening an existing-person picker never creates a roster or duplicate profile');
    await noOverflow(f.page);if(width===390)await f.page.screenshot({path:resolve(evidence,'volunteers-mobile.png'),fullPage:true});if(width===1440)await f.page.screenshot({path:resolve(evidence,'volunteers-desktop.png'),fullPage:true});
    await f.context.close();reports.push({width,rosterAndCommunicationsReadable:true,peopleAndShiftSlotsDistinct:true,openingSourcePickerReadOnly:true,noPageOverflow:true});
  }
  const combined=await fixture({roles:['outreach','reviewer']});await open(combined);assert.deepEqual(combined.writes,[]);await combined.context.close();reports.push({combinedOutreachReviewerAllowed:true});
  for(const roles of [['outreach'],['reviewer'],['editor']]){
    const f=await fixture({roles,seed:false});await f.page.goto(SITE+'/admin/volunteers/',{waitUntil:'networkidle'});await f.page.locator('[data-volunteer-denied]:visible').waitFor();
    assert.deepEqual(f.reads,['/api/admin/session'],'partial roles do not read volunteer or private source APIs');assert.equal(f.backend.sourceReads,0);assert.equal(f.backend.objects.calls.length,0);assert.deepEqual(f.writes,[]);assert.equal(await f.page.locator('[data-volunteer-authorized]').isVisible(),false);await f.context.close();reports.push({roles,deniedBeforePrivateSources:true});
  }

  const create=await fixture({seed:false});await open(create);const person=await begin(create,'person');
  const candidates=(await create.backend.service.sources({actor:staff(['superadmin'])})).candidates,source=candidates.find(row=>row.eligible);
  await person.locator('[name=source]').selectOption(source.source.kind+':'+source.source.id);await person.locator('[name=owner]').fill('合成新增负责同事');await person.locator('[name=notes]').fill('合成待联络，不创建报名');
  await create.page.locator('[data-volunteer-add-availability]').click();await person.locator('[data-volunteer-availability-row] [name=start]').fill('09:00');await person.locator('[data-volunteer-availability-row] [name=end]').fill('12:00');
  assert.deepEqual(create.writes,[],'filling source relation is local until explicit save');await save(create,'person');await saved(create,'person');
  let state=await create.backend.repository.read();assert.equal(state.volunteers.length,1);assert.deepEqual(state.volunteers[0].source,source.source);assert.equal(state.volunteers[0].workflowStatus,'pending');assert.equal(state.audit.length,1);
  assert.equal(create.writes.length,1);await create.page.reload({waitUntil:'networkidle'});await create.page.locator('[data-volunteer-roster]').filter({hasText:source.name}).waitFor();assert.equal((await create.backend.repository.read()).volunteers.length,1);await create.context.close();reports.push({explicitSaveCreatesStableSourceRelation:true,refreshReadsSavedRoster:true,noDuplicateProfilesOrAutomaticAdmission:true});

  const filtering=await fixture();await open(filtering);const filters=filtering.page.locator('[data-volunteer-filters]');await filters.locator('[name=assignment]').selectOption('unassigned');await filters.locator('button[type=submit]').click();await filtering.page.locator('[data-volunteer-roster-empty]:visible').waitFor();assert.equal(await filtering.page.locator('[data-volunteer-export]').isDisabled(),true);await filters.locator('[name=assignment]').selectOption('assigned');await filters.locator('button[type=submit]').click();await filtering.page.locator('[data-volunteer-roster]').filter({hasText:filtering.seeded.name}).waitFor();await filters.locator('[name=status]').selectOption('pending');await filters.locator('button[type=submit]').click();await filtering.page.locator('[data-volunteer-roster-empty]:visible').waitFor();await filters.locator('button[type=reset]').click();try{await filtering.page.locator('[data-volunteer-roster]').filter({hasText:filtering.seeded.name}).waitFor({timeout:2000});}catch(error){throw new Error('Reset filter regression: '+JSON.stringify(await filtering.page.evaluate(()=>({fields:Object.fromEntries(new FormData(document.querySelector('[data-volunteer-filters]'))),roster:document.querySelector('[data-volunteer-roster]').textContent,result:document.querySelector('[data-volunteer-result-count]').textContent}))),{cause:error});}assert.deepEqual(filtering.writes,[]);await filtering.context.close();reports.push({filtersUseWorkflowAndSavedAssignments:true,emptyFilterCannotExport:true,filteringNeverWrites:true});

  const deep=await fixture({seed:false});const deepCandidates=(await deep.backend.service.sources({actor:staff(['superadmin'])})).candidates;const deepSource=deepCandidates.find(row=>row.eligible);deep.hash='#'+deepSource.source.kind+'='+encodeURIComponent(deepSource.source.id);await open(deep);await deep.page.locator('[data-volunteer-person-dialog][open]').waitFor();assert.equal(await deep.page.locator('[data-volunteer-person-form] [name=source]').inputValue(),deepSource.source.kind+':'+deepSource.source.id);assert.deepEqual(deep.writes,[],'person deep link never enrolls or copies a profile');await deep.context.close();reports.push({personDeepLinkSelectsStableSource:true,noAutomaticDeepLinkWrite:true});
  const invalid=await fixture({seed:false,hash:'#contact=%ZZ'});await open(invalid);assert.equal(invalid.reads.some(path=>path.includes('/sources')),false,'malformed fragments never read private source details');assert.deepEqual(invalid.writes,[]);await invalid.context.close();reports.push({invalidFragmentNeverReadsPersonSources:true});

  const paged=await fixture({seed:false,manySources:true});await open(paged);await begin(paged,'person');await paged.page.locator('[data-volunteer-source-status]').filter({hasText:'100 / 142'}).waitFor();assert.equal(await paged.page.locator('[data-volunteer-person-form] [name=source] option').count(),101);await paged.page.locator('[data-volunteer-source-next]').click();await paged.page.locator('[data-volunteer-source-status]').filter({hasText:'142 / 142'}).waitFor();assert.equal(await paged.page.locator('[data-volunteer-source-next]').isVisible(),false);await paged.page.locator('[data-volunteer-source-search] [name=query]').fill('合成分页人员 139');await paged.page.locator('[data-volunteer-source-search] button[type=submit]').click();await paged.page.locator('[data-volunteer-source-status]').filter({hasText:'1 / 1'}).waitFor();assert.equal(await paged.page.locator('[data-volunteer-person-form] [name=source] option').count(),2);assert.deepEqual(paged.writes,[]);await paged.context.close();reports.push({sourcePaginationAndSearchReadOnly:true,noSilentFirstPageTruncation:true});
  for(const mode of ['source-late-200','source-late-401']){
    const f=await fixture({mode,seed:false,hash:'#contact=contact_01'});await f.page.goto(SITE+'/admin/volunteers/'+f.hash,{waitUntil:'domcontentloaded'});await f.waitHeld();await f.page.evaluate(()=>{location.hash='contact=contact_02';});await f.page.waitForFunction(()=>document.querySelector('[data-volunteer-person-form] [name=source]')?.value==='contact:contact_02');await f.release();assert.equal(await f.page.locator('[data-volunteer-person-form] [name=source]').inputValue(),'contact:contact_02');assert.match(await f.page.locator('[data-volunteer-person-source]').textContent(),/合成人员二/u);assert.equal(await f.page.locator('[data-volunteer-authorized]').isVisible(),true);assert.deepEqual(f.writes,[]);await f.context.close();reports.push({mode,lateSourceCannotReplaceSelectionOrClearSession:true});
  }

  const arrange=await fixture();await open(arrange);await addAssignment(arrange,'synthetic-shift-two');await save(arrange,'assignment');await saved(arrange,'assignment');
  await metric(arrange.page,'有效志愿者','1 人');await metric(arrange.page,'已确认覆盖','2 人次');await metric(arrange.page,'尚缺人手','3 人次');
  const coverage=await arrange.backend.service.read({actor:staff(['superadmin'])});assert.equal(coverage.summary.activePeopleCount,1);assert.equal(coverage.summary.confirmedSlots,2);assert.equal(coverage.summary.gapSlots,3);
  for(const [shiftId,why] of [['synthetic-shift-overlap','overlap'],['synthetic-shift-outside','availability'],['synthetic-shift-cancelled','cancelled']]){
    const form=await addAssignment(arrange,shiftId);const before=(await arrange.backend.repository.read()).revision;await save(arrange,'assignment');await arrange.page.locator('[data-volunteer-assignment-error]:visible').waitFor();assert.equal(await form.locator('[name=shiftId]').inputValue(),shiftId,'validation preserves selected shift');assert.equal(await form.locator('[name=volunteerId]').inputValue(),'synthetic-volunteer-one');assert.equal((await arrange.backend.repository.read()).revision,before,why+' conflict never mutates');await dismiss(arrange,'assignment');reports.push({rejected:why,formPreserved:true});
  }
  const positionForm=await begin(arrange,'position');await positionForm.locator('[name=name]').fill('合成展区岗位');await positionForm.locator('[name=zone]').selectOption('C');await positionForm.locator('[name=location]').fill('合成展示区');await positionForm.locator('[name=lead]').fill('合成展区组长');await save(arrange,'position');await saved(arrange,'position');
  const newPosition=(await arrange.backend.repository.read()).positions.find(row=>row.name==='合成展区岗位');assert.ok(newPosition);const shiftForm=await begin(arrange,'shift');await shiftForm.locator('[name=positionId]').selectOption(newPosition.id);await shiftForm.locator('[name=start]').fill('11:00');await shiftForm.locator('[name=end]').fill('12:00');await shiftForm.locator('[name=required]').fill('2');await save(arrange,'shift');await saved(arrange,'shift');const newShift=(await arrange.backend.repository.read()).shifts.find(row=>row.positionId===newPosition.id);assert.equal(newShift.required,2);assert.match(await arrange.page.locator('[data-volunteer-shifts]').textContent(),/合成展区岗位/u);
  assert.equal(coverage.summary.rosterCount,1);assert.equal(arrange.writes.every(item=>item.path.startsWith('/api/admin/volunteers')),true);await arrange.context.close();reports.push({adjacentShiftsAllowed:true,samePersonNotDoubleCounted:true,coverageChangesOnlyAfterAcknowledgedSave:true,positionAndShiftFormsPersist:true});

  const conflict=await fixture();await open(conflict);const conflictForm=await begin(conflict,'position');await conflictForm.locator('[name=name]').fill('合成版本冲突仍保留');await conflict.backend.operate('position_upsert',{id:'synthetic-concurrent-position',name:'合成另一个同事已保存',zone:'B',location:'',lead:'',description:'',status:'active'});const conflictBefore=(await conflict.backend.repository.read()).revision;await save(conflict,'position');await conflict.page.locator('[data-volunteer-position-error]:visible').waitFor();assert.equal(await conflictForm.locator('[name=name]').inputValue(),'合成版本冲突仍保留');assert.equal(await conflict.page.locator('[data-volunteer-pending]').isVisible(),false);assert.equal((await conflict.backend.repository.read()).revision,conflictBefore);await dismiss(conflict,'position');await conflict.page.locator('[data-volunteer-refresh]').click();await conflict.page.locator('[data-volunteer-positions]').filter({hasText:'合成另一个同事已保存'}).waitFor();assert.equal(conflict.writes.length,1);await conflict.context.close();reports.push({revision409PreservesDraft:true,conflictNeverAutoRetriesOrOverwrites:true,explicitReloadAfterDiscard:true});

  for(const mode of ['unknown-uncommitted','unknown-committed']){
    const f=await fixture({mode});await open(f);const form=await begin(f,'position');await form.locator('[name=name]').fill('合成回执待确认岗位');await form.locator('[name=description]').fill('原内容必须保留');const before=await f.backend.repository.read();await save(f,'position');
    await f.page.locator('[data-volunteer-pending]:visible').waitFor();assert.equal(await f.page.locator('[data-volunteer-position-dialog]').isVisible(),true);assert.equal(await form.locator('[name=name]').inputValue(),'合成回执待确认岗位');assert.equal(f.writes.length,1);await f.page.waitForTimeout(100);assert.equal(f.writes.length,1,'unknown acknowledgement never automatically retries');
    assert.equal(await f.page.locator('[data-volunteer-add]').isDisabled(),true);await f.page.locator('[data-volunteer-dialog-retry]:visible').click();await saved(f,'position');assert.equal(f.writes.length,2);assert.deepEqual(f.writes[1],f.writes[0],'explicit retry keeps original raw body, revision, id and operationId');
    state=await f.backend.repository.read();assert.equal(state.revision,before.revision+1);assert.equal(state.positions.filter(row=>row.name==='合成回执待确认岗位').length,1);assert.equal(state.audit.length,before.audit.length+1);await f.context.close();reports.push({mode,unknownResultFreezesNewWrites:true,explicitRetryExactOperation:true,noDuplicateWriteOrAudit:true});
  }

  const dirty=await fixture({mode:'dirty'});await open(dirty);const dirtyForm=await begin(dirty,'position');await dirtyForm.locator('[name=name]').fill('合成尚未保存岗位');
  await dirty.page.locator('[data-volunteer-close=position]').first().click();assert.equal(await dirty.page.locator('[data-volunteer-position-dialog]').isVisible(),true);assert.equal(dirty.dialogs.at(-1).type,'confirm');
  await dirty.page.keyboard.press('Escape');assert.equal(await dirty.page.locator('[data-volunteer-position-dialog]').isVisible(),true);assert.equal(dirty.dialogs.at(-1).type,'confirm');
  await dirty.page.locator('[data-volunteer-logout]').evaluate(node=>node.click());assert.equal(await dirty.page.locator('[data-volunteer-workspace]').isVisible(),true);assert.equal(await dirtyForm.locator('[name=name]').inputValue(),'合成尚未保存岗位');assert.equal(dirty.writes.length,0);
  await dirty.page.reload({waitUntil:'domcontentloaded',timeout:1500}).catch(error=>assert.ok(error.name==='TimeoutError'||/ERR_ABORTED|interrupted|cancel/iu.test(error.message)));
  assert.equal(dirty.dialogs.at(-1).type,'beforeunload');assert.equal(await dirtyForm.locator('[name=name]').inputValue(),'合成尚未保存岗位');assert.deepEqual(dirty.writes,[]);await dirty.context.close();reports.push({closeEscapeLogoutAndReloadProtectUnsavedInput:true,noGuardAutoSave:true});

  const excel=await fixture();await open(excel);let downloadWait=excel.page.waitForEvent('download');await excel.page.locator('[data-volunteer-export]').click();let download=await downloadWait;
  let workbook=await readFile(await download.path());assert.equal(workbook.subarray(0,2).toString(),'PK','export is actual OOXML');let rows=await readSheet(workbook,1);assert.ok(rows.length>1);assert.doesNotMatch(JSON.stringify(rows),/SYNTHETIC_RAW_QUESTION_AND_PROVIDER_SECRET_NEVER_EXPOSE|@example\.invalid/u,'default spreadsheet excludes private questionnaire and contact channels');
  await excel.page.locator('[data-volunteer-refresh]').click();await excel.page.locator('[data-volunteer-roster]').filter({hasText:excel.seeded.name}).waitFor();await excel.page.locator('[data-volunteer-export-contact]').check();downloadWait=excel.page.waitForEvent('download');await excel.page.locator('[data-volunteer-export]').click();download=await downloadWait;workbook=await readFile(await download.path());rows=await readSheet(workbook,1);assert.match(JSON.stringify(rows),/@example\.invalid/u);assert.doesNotMatch(JSON.stringify(rows),/SYNTHETIC_RAW_QUESTION_AND_PROVIDER_SECRET_NEVER_EXPOSE/u);
  const exports=(await excel.backend.repository.read()).audit.filter(row=>row.action==='export');assert.equal(exports.length,2);assert.equal(exports[0].details.includeContact,false);assert.equal(exports[1].details.includeContact,true);assert.match(exports[1].details.sha256,/^[a-f0-9]{64}$/u);
  await excel.page.locator('[data-volunteer-logout]').click();await excel.page.locator('[data-volunteer-login-panel]:visible').waitFor();const urls=await excel.page.evaluate(()=>window.privateVolunteerUrls);assert.ok(urls.created.length>=2);assert.ok(urls.created.every(url=>urls.revoked.includes(url)));assert.equal(await excel.page.locator('[data-volunteer-roster]').textContent(),'');assert.equal(await excel.page.locator('[data-volunteer-export-contact]').isChecked(),false);await excel.context.close();reports.push({realOoxmlReadBack:true,contactFieldsExplicitAndAudited:true,rawAnswersExcluded:true,logoutClearsPrivateRosterAndBlobUrls:true});

  const unavailable=await fixture();await open(unavailable);unavailable.backend.setSourceFailure(true);await unavailable.page.locator('[data-volunteer-refresh]').click();await unavailable.page.locator('[data-volunteer-error]:visible').waitFor();assert.match(await unavailable.page.locator('[data-volunteer-error]').textContent(),/无法核对|暂时/u);assert.equal(await unavailable.page.locator('[data-volunteer-metrics]').textContent(),'','source failure never becomes a successful zero count');assert.equal(await unavailable.page.locator('[data-volunteer-add]').isDisabled(),true);assert.deepEqual(unavailable.writes,[]);assert.equal((await unavailable.page.locator('body').textContent()).includes(VOLUNTEER_FIXTURE_SECRET),false);await unavailable.context.close();reports.push({sourceUnavailableIsNotEmptySuccess:true,sourceErrorNeverExposesProviderDetails:true});

  const expired=await fixture();await open(expired);expired.expireNext();await expired.page.locator('[data-volunteer-refresh]').click();await expired.page.locator('[data-volunteer-login-panel]:visible').waitFor();assert.equal(await expired.page.locator('[data-volunteer-roster]').textContent(),'');assert.equal(await expired.page.locator('[data-volunteer-workspace]').isVisible(),false);await expired.context.close();reports.push({current401ClearsPrivateVolunteerData:true});
  const revoked=await fixture();await open(revoked);revoked.setRoles(['editor']);await revoked.page.locator('[data-volunteer-refresh]').click();await revoked.page.locator('[data-volunteer-login-panel]:visible').waitFor();assert.equal(await revoked.page.locator('[data-volunteer-roster]').textContent(),'');assert.equal(await revoked.page.locator('[data-volunteer-workspace]').isVisible(),false);assert.deepEqual(revoked.writes,[]);await revoked.context.close();reports.push({current403FromRevokedRoleClearsPrivateVolunteerData:true});
  for(const mode of ['late-200','late-401']){
    const f=await fixture({mode});await open(f);await f.page.locator('[data-volunteer-refresh]').click();await f.waitHeld();await f.page.locator('[data-volunteer-logout]').click();await f.page.locator('[data-volunteer-login-panel]:visible').waitFor();f.backend.sources.contacts.contacts[0].profile.name='合成新账号人员';await login(f);await f.page.locator('[data-volunteer-roster]').filter({hasText:'合成新账号人员'}).waitFor();await f.release();assert.equal(await f.page.locator('[data-volunteer-authorized]').isVisible(),true);assert.match(await f.page.locator('[data-volunteer-roster]').textContent(),/合成新账号人员/u);assert.doesNotMatch(await f.page.locator('[data-volunteer-roster]').textContent(),/=合成人员一/u);assert.equal(f.writes.length,2);await f.context.close();reports.push({mode,oldResponseCannotPopulateOrClearNewAccount:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
