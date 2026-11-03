// Actual built directory over isolated runtime; every request is intercepted.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/p2-directory'));
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const {eventConfig}=await import(pathToFileURL(resolve(source,'src/config/event.mjs')));
const {buildPosterInvitationSettings}=await import(pathToFileURL(resolve(source,'shared/organizer-progress.mjs')));
const {createConfirmationRepository,confirmationRequestHash}=await import(pathToFileURL(resolve(source,'functions/registration-confirmation/repository.mjs')));
const {createObjectJournal}=await import(pathToFileURL(resolve(source,'functions/cloud-content/object-journal.mjs')));
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[],assets=new Map();
const hash=value=>createHash('sha256').update(value).digest('hex'),operation=()=>randomBytes(32).toString('base64url');
const sourceCommit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8',env:{PATH:process.env.PATH??'',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}}).trim();assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
const publicHtmlSha256=hash(await readFile(resolve(dist,'index.html'))),adminHtmlSha256=hash(await readFile(resolve(dist,'admin/contacts/index.html'))),personHtmlSha256=hash(await readFile(resolve(dist,'admin/person/index.html'))),scriptSha256=hash(await readFile(fileURLToPath(import.meta.url)));
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';

async function seed(){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false});
  for(let index=0;index<55;index++){
    const saved=await runtime.createContact({name:'合成已处理 '+String(index).padStart(2,'0')});
    await runtime.app.contactsStore.saveOperations(saved.contact.id,saved.revision,{...saved.contact.operations,responseStatus:'declined'},runtime.users[0].id);
  }
  const reply=(await runtime.createContact({name:'合成最后待回复',organization:'合成机构'})).contact;
  const integrationSaved=await runtime.createContact({name:'合成等待整合',organization:'合成机构'});
  await runtime.app.contactsStore.saveOperations(integrationSaved.contact.id,integrationSaved.revision,{...integrationSaved.contact.operations,responseStatus:'attending'},runtime.users[0].id);
  return {runtime,reply,integration:integrationSaved.contact};
}
async function stageSeed(){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false,attendeeReviewRequired:false}),actor=runtime.users[0].id;
  const manual=async(name,responseStatus)=>{let saved=await runtime.createContact({name});saved=await runtime.app.contactsStore.saveOperations(saved.contact.id,saved.revision,{...saved.contact.operations,responseStatus},actor);
    const settings=buildPosterInvitationSettings(name,eventConfig);saved=await runtime.app.contactsStore.recordGenerated(saved.contact.id,saved.revision,settings,actor);saved=await runtime.app.contactsStore.recordSent(saved.contact.id,saved.revision,'wechat',saved.contact.invitation.generatedAt,settings,actor);return saved.contact;};
  const manualSent=await manual('合成目前人工已发','attending'),pendingSent=await manual('合成已寄仍待回复','pending');
  const confirmed=await runtime.seedPublic({intake:'general-v2',name:'合成本人报名已确认',email:'synthetic.stage.confirmed@example.invalid'});
  const accepted=await runtime.seedPublic({intake:'general-v2',name:'合成邮件已接受',email:'synthetic.stage.accepted@example.invalid'});
  const journal=createConfirmationRepository({eventId:eventConfig.id,journal:createObjectJournal({objects:runtime.objects,prefix:runtime.app.confirmationService.prefix}),clock:()=>Date.parse('2026-10-21T09:00:00Z')});
  async function notice(id,status,scope={}){let state=await journal.read();state=await journal.append(state,'reserve',{registrationId:id,kind:'registration',admissionStatus:'confirmed',admissionRevision:0,retryRejected:false,...scope},actor);const row=state.value.notices.find(item=>item.registrationId===id&&(item.accessRevision??0)===(scope.accessRevision??0));await journal.append(state,'result',{noticeId:row.id,status},actor);}
  await notice(accepted.reference_code,'provider_accepted');
  const unknown=[];
  for(const currentAccepted of[false,true]){
    const saved=await runtime.seedPublic({intake:'general-v2',name:currentAccepted?'合成历史未知目前已寄':'合成历史未知目前未寄',email:'synthetic.stage.old.'+currentAccepted+'@example.invalid'}),id=saved.reference_code;
    await notice(id,'unknown');const detail=await runtime.app.reviewStore.detail(id),email='synthetic.stage.current.'+currentAccepted+'@example.invalid';
    const fields={...Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??''])),email};
    await runtime.app.reviewStore.saveProfile(id,detail.revision,operation(),fields,actor);
    if(currentAccepted)await notice(id,'provider_accepted',{accessRevision:1,recipientDigest:confirmationRequestHash(email)});
    unknown.push({id,currentAccepted});
  }
  return{runtime,manualSent,pendingSent,confirmed,accepted,unknown};
}
async function fixture(browser,width,username='owner',{stages=false}={}){
  const seeded=await(stages?stageSeed():seed()),{runtime}=seeded,context=await browser.newContext({viewport:{width,height:960}}),calls=[];
  const auth=await runtime.login(username),[name,...value]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  const controls={directoryFailure:false,contactsFailure:false,holdHealth:false,releaseHealth:null};
  const get=runtime.objects.get.bind(runtime.objects);
  runtime.objects.get=async(key,options)=>{if(controls.contactsFailure&&key.startsWith('cms/v1/contacts/'))throw new Error('SYNTHETIC_PRIVATE_SOURCE_FAILURE');return get(key,options);};
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,API);
    if(url.pathname.startsWith('/api/')){
      const entry={path:url.pathname,search:url.search,method:request.method()};calls.push(entry);
      assert.ok(request.method()==='GET'||url.pathname==='/api/admin/logout','directory never mutates a business record');
      if(controls.directoryFailure&&url.pathname==='/api/admin/people/directory')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'PERSON_UNAVAILABLE',message:'名单暂时无法核对。'}})});
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:request.postData()})}));
      entry.status=response.status;
      if(controls.holdHealth&&url.pathname==='/api/admin/people/health')await new Promise(resolve=>{controls.releaseHealth=resolve;});
      const headers=Object.fromEntries(response.headers);delete headers['content-length'];
      return route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    }
    const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));
    assert.ok(file.startsWith(dist+'/'));
    const bytes=await readFile(file);assets.set(url.pathname,{path:url.pathname,sha256:hash(bytes),bytes:bytes.length});
    return route.fulfill({status:200,contentType:mime(file),body:bytes});
  });
  const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.dismiss());
  const before={contacts:await runtime.app.contactsStore.read(),admissions:await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]}),content:await runtime.app.store.read(),businessWrites:runtime.objects.calls.filter(call=>call.operation!=='get').length};
  return {...seeded,context,page,calls,controls,before,width};
}
const rows=page=>page.locator('[data-directory-rows] tr');
async function loaded(page,text='符合筛选'){await page.locator('[data-directory-status]').filter({hasText:text}).waitFor();await page.locator('[data-directory-search] [type=submit]:enabled').waitFor();}
async function choose(page,work){const advanced=page.locator('[data-directory-advanced]');if(!await advanced.evaluate(node=>node.open))await advanced.locator('summary').click();await page.locator('[data-directory-work]').selectOption(work);await loaded(page);}
async function chooseAttendance(page,value){await page.locator('[data-directory-attendance]').focus();await page.locator('[data-directory-attendance]').selectOption(value);await loaded(page);assert.equal(await page.locator('[data-directory-attendance]').evaluate(node=>node===document.activeElement),true,'filter updates preserve the active control');}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
async function unchanged(f){assert.deepEqual(await f.runtime.app.contactsStore.read(),f.before.contacts);assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.before.admissions);assert.deepEqual(await f.runtime.app.store.read(),f.before.content);assert.equal(f.runtime.objects.calls.filter(call=>call.operation!=='get').length,f.before.businessWrites);assert.equal(f.runtime.messages.length,0);}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width),{page,calls,controls}=f;
    try{
      await page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(page);
      assert.equal(await page.locator('[data-directory-work]').inputValue(),'all');assert.equal(await page.locator('[data-directory-attendance]').inputValue(),'all');assert.equal(await page.locator('[data-directory-advanced]').getAttribute('open'),null);assert.equal(await rows(page).count(),50);
      await chooseAttendance(page,'awaiting');assert.equal(await rows(page).count(),1);assert.equal(await page.locator('[data-directory-attendance-stage]').textContent(),'待确认是否出席');
      await chooseAttendance(page,'confirmed');assert.equal(await rows(page).count(),1);assert.equal(await page.locator('[data-directory-attendance-stage]').textContent(),'已确认出席');
      await chooseAttendance(page,'all');await choose(page,'pending');
      assert.equal(await rows(page).count(),2,'pending is filtered before the first fifty rows');
      assert.match(await page.locator('[data-directory-rows]').textContent(),/合成最后待回复/u);
      assert.equal(await page.locator('[data-directory-head] th').count(),3);
      assert.equal(await page.locator('[data-directory-rows] [data-directory-primary]').count(),2);
      assert.equal(await page.locator('[data-directory-rows] button:visible').count(),0,'secondary actions remain in More');
      assert.equal(await page.locator('[data-contacts-legacy-tools]').getAttribute('open'),null);
      assert.doesNotMatch(await page.locator('[data-people-directory]').textContent(),/@example\.invalid|SYNTHETIC_ORIGINAL|receiptToken/u);
      const primary=rows(page).filter({hasText:'合成最后待回复'}).locator('[data-directory-primary]');
      assert.equal(await primary.getAttribute('href'),'/admin/person/#contact='+f.reply.id);
      await choose(page,'all');assert.equal(await rows(page).count(),50);assert.equal(await page.locator('[data-directory-next]').isVisible(),true);
      await page.locator('[data-directory-next]').click();await loaded(page);assert.equal(await rows(page).count(),7);
      await choose(page,'reply');assert.equal(await rows(page).count(),1);assert.match(await rows(page).textContent(),/合成最后待回复/u);
      await page.locator('[name=query]').fill('合成不存在');await page.locator('[data-directory-search] [type=submit]').click();await loaded(page);
      assert.equal(await rows(page).count(),0);assert.equal(await page.locator('[data-directory-empty]').isVisible(),true);
      await page.locator('[data-directory-search] [type=reset]').click();await loaded(page);assert.equal(await page.locator('[data-directory-work]').inputValue(),'all');assert.equal(await page.locator('[data-directory-attendance]').inputValue(),'all');
      controls.directoryFailure=true;await page.locator('[data-directory-search] [type=submit]').click();await page.locator('[data-directory-error]:visible').waitFor();
      assert.equal(await rows(page).count(),0,'failed read clears stale actionable rows');assert.match(await page.locator('[data-directory-status]').textContent(),/不能据此判断为零/u);
      assert.equal(await page.locator('[data-directory-empty]').isVisible(),false);assert.equal(await page.locator('[data-contacts-legacy-tools]').getAttribute('open'),null);
      controls.directoryFailure=false;await page.locator('[data-directory-search] [type=submit]').click();await loaded(page);
      const health=page.locator('[data-directory-health]');await health.locator('summary').click();await page.locator('[data-directory-health-items] li').filter({hasText:'合成等待整合'}).waitFor();
      assert.match(await page.locator('[data-directory-health-items]').textContent(),/合成等待整合/u);
      assert.equal(calls.filter(call=>call.path==='/api/admin/people/health').length,1);
      controls.contactsFailure=true;await page.locator('[data-directory-health-refresh]').click();await page.locator('[data-directory-health-status]').filter({hasText:'部分资料暂时无法核对'}).waitFor();
      assert.equal(await page.locator('[data-directory-health-empty]').isVisible(),false,'unavailable source never becomes zero issues');
      controls.contactsFailure=false;await page.locator('[data-directory-health-refresh]').click();await page.locator('[data-directory-health-status]').filter({hasText:'需核对'}).waitFor();
      await noOverflow(page);const screenshot=resolve(evidence,'directory-'+width+'.png');await page.screenshot({path:screenshot,fullPage:false});
      assert.ok(calls.filter(call=>call.path==='/api/admin/people/directory').every(call=>new URLSearchParams(call.search).has('work')));
      assert.ok(calls.some(call=>call.path==='/api/admin/people/directory'&&new URLSearchParams(call.search).get('work')==='reply'));
      await unchanged(f);
      controls.holdHealth=true;await page.locator('[data-directory-health-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-directory-health-status]')?.textContent==='正在核对…');
      for(let attempt=0;!controls.releaseHealth&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(typeof controls.releaseHealth,'function','delayed health read reached the intercepted completion');
      await page.locator('[data-contacts-logout]').click();await page.locator('[data-contacts-login-panel]:visible').waitFor();
      const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/people/health');controls.releaseHealth();await lateResponse;
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('[data-directory-health-items]').textContent(),'');assert.equal(await rows(page).count(),0);
      reports.push({width,pendingBeforePagination:true,allPageSizes:[50,7],threeColumns:true,onePrimaryPerPerson:true,sourceFailureClearsActions:true,partialHealthNotZero:true,logoutClearsLateHealth:true,requests:calls.length,screenshot});
    }finally{await f.context.close();}
  }
  for(const width of[320,390,1440]){
    const f=await fixture(browser,width,'owner',{stages:true}),{page}=f,screenshots=[];
    try{
      await page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(page);assert.equal(await rows(page).count(),6);
      for(const[value,count,label]of[['awaiting',1,'待确认是否出席'],['confirmed',2,'已确认出席'],['invited',3,'已确认出席并发送邀请函']]){
        await chooseAttendance(page,value);assert.equal(await rows(page).count(),count);
        assert.deepEqual(await page.locator('[data-directory-attendance-stage]').allTextContents(),Array(count).fill(label));
        if(value==='awaiting'){assert.match(await rows(page).textContent(),/合成已寄仍待回复/u);assert.match(await rows(page).textContent(),/人工已记录发出/u);}
        if(value==='invited'){const text=(await rows(page).allTextContents()).join('\n');assert.match(text,/合成目前人工已发/u);assert.match(text,/邮件服务已接收，未证明送达/u);}
        await noOverflow(page);assert.equal(await page.locator('[data-directory-rows] [data-directory-primary]').count(),count);
        const screenshot=resolve(evidence,'attendance-'+value+'-'+width+'.png');await page.locator('[data-people-directory]').screenshot({path:screenshot});screenshots.push(screenshot);
      }
      const knownKey='registration:'+f.accepted.reference_code;
      await page.locator('[data-directory-person="'+knownKey+'"] [data-directory-primary]').click();await page.locator('[data-person-attendance-stage=invited]').waitFor();
      await page.locator('[data-person-list-context] [data-person-list-return]:enabled').waitFor();await page.locator('[data-person-list-context] [data-person-list-return]').click();await loaded(page);
      assert.equal(await page.locator('[data-directory-attendance]').inputValue(),'invited');assert.equal(await page.locator('[data-directory-person="'+knownKey+'"] [data-directory-primary]').evaluate(node=>node===document.activeElement),true,'known results preserve the selected attendance filter and return focus');
      for(const entry of f.unknown){
        const stage=entry.currentAccepted?'invited':'confirmed';await chooseAttendance(page,stage);
        const row=page.locator('[data-directory-person="registration:'+entry.id+'"]');await row.waitFor();
        assert.match(await row.locator('.people-directory-warning').textContent(),/待核对.*勿重寄/u);assert.equal(await row.locator('[data-directory-primary]').textContent(),'核对结果');
        if(entry.currentAccepted)assert.match(await row.textContent(),/邮件服务已接收，未证明送达/u);else assert.doesNotMatch(await row.textContent(),/邮件服务已接收/u);
        await row.locator('[data-directory-primary]').click();await page.locator('[data-person-workspace]:visible').waitFor();
        assert.equal(await page.locator('[data-person-attendance-stage]').getAttribute('data-person-attendance-stage'),stage);
        assert.match(await page.locator('[data-person-summary]').textContent(),/待核对.*勿重寄/u);assert.equal(await page.locator('[data-person-primary]').textContent(),'核对结果');
        assert.equal(await page.locator('[data-person-confirmation-send]').isDisabled(),true);
        const before=f.calls.length;await page.locator('[data-person-primary]').click();assert.equal(await page.locator('[data-person-communications]').evaluate(node=>node.closest('details').open),true);
        assert.equal(f.calls.slice(before).every(call=>call.method==='GET'),true);await noOverflow(page);
        const screenshot=resolve(evidence,'historical-unknown-'+entry.currentAccepted+'-'+width+'.png');await page.screenshot({path:screenshot,fullPage:true});screenshots.push(screenshot);
        assert.equal(await page.locator('[data-person-list-context] [data-person-list-return]').isDisabled(),true,'unknown history retains the existing navigation lock');
        assert.equal(await page.locator('[data-person-next]').isDisabled(),true);
        await page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(page);
        assert.equal(await page.locator('[data-directory-attendance]').inputValue(),stage);assert.equal(await page.locator('[data-directory-work]').inputValue(),'all');
        assert.equal(await page.locator('[data-directory-person="registration:'+entry.id+'"] [data-directory-primary]').evaluate(node=>node===document.activeElement),true,'return restores the selected person and attendance filter focus');
      }
      assert.equal(f.calls.every(call=>call.method==='GET'),true);await unchanged(f);
      reports.push({width,attendanceStageCounts:{awaiting:1,confirmed:2,invited:3},manualAndEmailEvidenceSeparate:true,alreadySentWithoutReplyStillAwaiting:true,historicalUnknownCurrentNotSentAndAccepted:true,unknownOnlyChecksNeverSends:true,unknownNavigationRemainsBlocked:true,phoneLayoutNoOverflow:true,filterAndReturnFocus:true,requests:f.calls.length,screenshots});
    }finally{await f.context.close();}
  }
  const restricted=await fixture(browser,390,'outreach');
  try{
    await restricted.page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(restricted.page);
    assert.equal(await restricted.page.locator('[data-directory-health]').isVisible(),false);
    await restricted.page.locator('[data-directory-health]').evaluate(element=>{element.open=true;});await restricted.page.waitForTimeout(30);
    assert.equal(restricted.calls.filter(call=>call.path==='/api/admin/people/health').length,0,'restricted role never asks for cross-source health');
    await unchanged(restricted);reports.push({width:390,role:'outreach',healthRequests:0});
  }finally{await restricted.context.close();}
  assert.deepEqual(errors,[]);
  assert.equal(reports.length,7,'all four original directory cases and three attendance cases must complete');
  const proof={ok:true,cases:reports.length,expectedCaseCount:7,sourceCommit,publicHtmlSha256,adminHtmlSha256,personHtmlSha256,scriptSha256,pageErrorCount:errors.length,realBusinessWrites:0,realMail:0,realNetwork:0};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify({...proof,source,dist,reports,pageErrors:errors,servedAssets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');console.log('People attendance directory browser verified: '+JSON.stringify(proof));
}finally{await browser.close();}
