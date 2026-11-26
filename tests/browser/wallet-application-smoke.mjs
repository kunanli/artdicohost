// Actual built pages and isolated service over synthetic memory OSS. All requests intercepted.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const project=fileURLToPath(new URL('../../',import.meta.url)),source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(source,'.local-data/browser-evidence/wallet-application'));
const{peopleRuntimeFixture}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const{chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const SITE='https://artdico.host',API='https://api.artdico.host',NOW='2026-10-21T09:00:00Z',errors=[],routeErrors=[],reports=[],served=new Map();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),htmlSha256=sha(await readFile(resolve(dist,'index.html'))),scriptSha256=sha(await readFile(fileURLToPath(import.meta.url)));
const sourceCommit=execFileSync('git',['-C',source,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceTreeClean=!execFileSync('git',['-C',source,'status','--porcelain','--untracked-files=normal'],{encoding:'utf8'}).trim();
const mime=path=>({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.svg':'image/svg+xml','.ico':'image/x-icon'})[extname(path)]||'application/octet-stream';
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
await mkdir(evidence,{recursive:true});
const form=page=>page.locator('[data-wallet-form]');
const chineseJammer=page=>form(page).getByRole('checkbox',{name:'Jammer（参加过 Game Jam）',exact:true});
const involvement='导师 · 2024',involvementWithJammer=involvement+' · Jammer';
async function fixture(width,{lost=false,closed=false,speakerClosed=false,configOutage=false}={}){
 const runtime=await peopleRuntimeFixture({mail:false,attendeeReviewRequired:false});let disabled=closed,lose=lost,unavailable=configOutage;
 let releaseConfig=()=>{};
 const configGate=configOutage?new Promise(resolve=>{releaseConfig=resolve;}):null;
 const app=()=>runtime.make({policyOverride:{publicRegistrationMode:'speaker_only',speakerApplicationsEnabled:!speakerClosed,...(disabled?{closesAt:'2026-10-21T08:59:00Z'}:{})}});
 let current=app();const calls=[],context=await browser.newContext({locale:'zh-CN',viewport:{width,height:940},reducedMotion:'reduce'});
 await context.route('**/*',async route=>{
  try{
   const request=route.request(),url=new URL(request.url());assert.ok([SITE,API].includes(url.origin),'no unapproved network origin');
   if(url.origin===API&&url.pathname.startsWith('/api/')){
    const headers=await request.allHeaders();const call={path:url.pathname,method:request.method(),body:request.postData(),key:headers['idempotency-key']};calls.push(call);
    if(url.pathname==='/api/admin/registration/config'){
     await configGate;
     if(unavailable){call.status=503;return route.fulfill({status:503,headers:{'access-control-allow-origin':SITE},json:{error:{code:'SYNTHETIC_OUTAGE'}}});}
    }
    const response=await current.handle(new Request(request.url(),{method:request.method(),headers,...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
    call.status=response.status;const bytes=Buffer.from(await response.arrayBuffer()),responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-length'];
    if(lose&&url.pathname==='/api/admin/registration/submit'){lose=false;return route.fulfill({status:503,headers:responseHeaders,contentType:'application/json',body:JSON.stringify({error:{code:'UNAVAILABLE'}})});}
    return route.fulfill({status:response.status,headers:responseHeaders,body:bytes});
   }
   assert.equal(request.method(),'GET');const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
   try{const bytes=await readFile(file);served.set(url.pathname,{path:url.pathname,sha256:sha(bytes),bytes:bytes.length});return route.fulfill({status:200,contentType:mime(file),body:bytes});}catch{return route.fulfill({status:404,body:''});}
  }catch(error){routeErrors.push(error.message);return route.fulfill({status:503,contentType:'application/json',body:'{"error":{"code":"SYNTHETIC_ROUTE_FAILURE"}}'});}
 });
 const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date(NOW));page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
 await page.goto(SITE+'/#wallet-card-application',{waitUntil:configOutage?'domcontentloaded':'networkidle'});await page.evaluate(()=>document.fonts.ready);
 if(!closed&&!configOutage)await page.locator('[data-wallet-submit]:enabled').waitFor();
 return{page,context,calls,runtime,releaseConfig,restoreConfig(){unavailable=false;},disconnectConfig(){unavailable=true;},get app(){return current;},closeIntake(){disabled=true;current=app();}};
}
async function fill(page){
 for(const[name,value]of Object.entries({huodongxingReference:'000012345678901234567890',name:'合成纪念卡申请人',email:'synthetic.card@example.invalid',wechat:'synthetic_wechat_001'}))await form(page).locator('[name="wallet.'+name+'"]').fill(value);
 await form(page).locator('[name="wallet.requestedWalletIdentity"]').selectOption('staff');
 const site=form(page).locator('[name="wallet.ggjSite"]'),role=form(page).locator('[name="wallet.ggjRole"]');
 assert.equal(await site.isVisible(),true);
 assert.equal(await role.isVisible(),true);
 const suggestions=await role.evaluate(input=>Array.from(input.list.options,option=>option.value));
 for(const value of ['站点组织者','Jammer','导师','志愿者','评审','教育工作者','社群伙伴','活动运营','程序','美术','策划']) assert.ok(suggestions.includes(value));
 await site.fill('GGJ 合成站');
 await role.fill(involvement);
 const jammer=chineseJammer(page);
 assert.equal(await jammer.isChecked(),false);
 assert.equal(await jammer.getAttribute('required'),null);
 await jammer.check();
 assert.equal(await role.inputValue(),involvementWithJammer);
}
async function drafts(page){return page.evaluate(()=>new Promise((yes,no)=>{const request=indexedDB.open('artdico-browser-drafts-v1',1);request.onerror=()=>no(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('drafts','readonly'),query=tx.objectStore('drafts').getAll();query.onsuccess=()=>yes(query.result);query.onerror=()=>no(query.error);tx.oncomplete=()=>db.close();};}));}
async function screenshot(page,name){await page.screenshot({path:resolve(evidence,name+'.png'),fullPage:false,animations:'disabled'});}
async function verifyHeader(page,width){
 await page.evaluate(()=>{location.hash='top';});
 const menu=page.locator('[data-site-menu]'),mobile=width<=960;
 if(mobile)await menu.locator('summary').click();
 const nav=mobile?menu:page.locator('.ah-home-desktop-nav');
 const cardLink=nav.getByRole('link',{name:'电子纪念卡',exact:true});
 assert.equal(await cardLink.evaluate(node=>node.previousElementSibling?.hasAttribute('data-general-registration')),true);
 const box=await cardLink.boundingBox();
 assert.ok(box&&box.x>=0&&box.x+box.width<=width+1&&box.height>=44);
 await cardLink.press('Enter');
 await page.waitForURL(SITE+'/#wallet-card-application');
 if(mobile)assert.equal(await menu.getAttribute('open'),null);
}
async function receipt(f){try{await f.page.locator('[data-wallet-result]:not([hidden])').waitFor();}catch(error){console.log('Synthetic wallet failure: '+JSON.stringify({error:await f.page.locator('[data-wallet-error]').textContent(),status:await f.page.locator('[data-wallet-draft-status]').textContent(),calls:f.calls.filter(call=>/registration\/(token|submit)$/.test(call.path)).map(({path,method,status})=>({path,method,status}))}));await screenshot(f.page,'failure');throw error;}assert.equal(await form(f.page).isVisible(),false);const records=(await f.app.registrationService.repository.list()).registrations;assert.equal(records.length,1);assert.equal(records[0].fields.intake,'wallet-v1');assert.equal(records[0].fields.huodongxingReference,'000012345678901234567890');assert.equal((await f.app.registrationService.getAdmissionStatus(records[0].id)).status,'pending_review');assert.equal(f.runtime.messages.length,0);return records[0].id;}
async function staffIdentity(f,id){
 const headers=await f.runtime.login('owner'),[name,...rest]=headers.Cookie.split('=');await f.context.addCookies([{name,value:rest.join('='),domain:'api.artdico.host',path:'/',secure:true,httpOnly:true}]);
 await f.page.goto(API+'/admin/registrations/#registration='+id,{waitUntil:'networkidle'});await f.page.locator('[data-review-dialog][open]').waitFor();
 assert.match(await f.page.locator('[data-review-summary]').innerText(),/000012345678901234567890/u);
 assert.doesNotMatch(await f.page.locator('[data-review-summary]').innerText(),/其他来宾/u);assert.equal(await f.page.locator('[data-review-accommodation]').isVisible(),false);assert.equal(await f.page.locator('[data-review-legacy-records]').isVisible(),false);
 async function saveIdentity(value){await f.page.locator('[name=walletIdentity]').selectOption(value);await f.page.locator('[data-review-save]:enabled').waitFor();const response=f.page.waitForResponse(r=>r.url().endsWith('/'+id+'/review')&&r.request().method()==='PATCH');await f.page.locator('[data-review-save]').click();assert.equal((await response).status(),200);await f.page.locator('[data-review-form] [data-save-state=saved]').waitFor();assert.equal((await f.app.reviewStore.detail(id)).review.walletIdentity,value);}
 await f.page.locator('[name=walletIdentity]').selectOption('guest');await f.page.locator('[data-review-save]:enabled').waitFor();
 const response=f.page.waitForResponse(r=>r.url().endsWith('/'+id+'/review')&&r.request().method()==='PATCH');await f.page.locator('[data-review-save]').click();assert.equal((await response).status(),200);
 await f.page.locator('[data-review-save]:disabled').waitFor();const detail=await f.app.reviewStore.detail(id);assert.equal(detail.review.walletIdentity,'guest');
 assert.equal((await f.app.registrationService.getAdmissionStatus(id)).status,'pending_review');
 await screenshot(f.page,'staff-identity-'+f.page.viewportSize().width);
 {
  await f.page.locator('[data-review-approve]:enabled').waitFor();const approved=f.page.waitForResponse(r=>r.url().endsWith('/api/admin/admissions/approve')&&r.request().method()==='POST');await f.page.locator('[data-review-approve]').click();assert.equal((await approved).status(),200);
  const trusted=await f.app.confirmationService.authorizedRegistration(id);assert.equal(trusted.admissionStatus,'confirmed');assert.equal(trusted.walletRequested,true);assert.equal(trusted.walletIdentity,'guest');
  // Identity can be filled after admission: the actual private page explains
  // that state instead of offering a Wallet download or changing the seat.
  await saveIdentity('');
  await f.page.locator('[data-review-confirmation-prepare]:enabled').click();await f.page.locator('[data-review-confirmation-result]:not([hidden])').waitFor();
  const privateUrl=await f.page.locator('[data-review-confirmation-open]').getAttribute('href');await f.page.goto(privateUrl,{waitUntil:'networkidle'});
  await f.page.locator('[data-confirmation-content]:not([hidden])').waitFor();assert.equal(await f.page.locator('[data-confirmation-heading]').innerText(),'纪念卡待发放');assert.equal(await f.page.locator('[data-confirmation-wallet]').isVisible(),false);
  for(const name of ['group','registration','notice-records','save'])assert.equal(await f.page.locator('[data-confirmation-'+name+']').isVisible(),false);
  assert.equal((await f.app.registrationService.getAdmissionStatus(id)).status,'confirmed');assert.equal(f.calls.some(call=>call.path.endsWith('/registration/wallet')),false,'pending identity never downloads a pass');await screenshot(f.page,'identity-pending-private-page-'+f.page.viewportSize().width);
  await f.page.goto(API+'/admin/registrations/#registration='+id,{waitUntil:'networkidle'});await f.page.locator('[data-review-dialog][open]').waitFor();await saveIdentity('guest');
  await f.page.goto(privateUrl,{waitUntil:'networkidle'});
  await f.page.locator('#confirmation-card-claim-button').click();
  await f.page.locator('[data-confirmation-jpeg-download]').waitFor();
  assert.equal(await f.page.locator('#confirmation-card-collector-number').innerText(),'GGJ26-HOST-0001');
  assert.equal(await f.page.locator('[data-confirmation-heading]').innerText(),'电子纪念卡');
  assert.equal(f.runtime.messages.length,0,'identity update and explicit claim never send a new notice');
 }
 assert.equal(f.runtime.messages.length,0,'staff review never sends without a separate explicit send');
}
try{
 for(const width of [320,390,1440,1920]){
  const f=await fixture(width);
  try{
   assert.equal(await f.page.locator('#wallet-card-application').evaluate(node=>{let previous=node.previousElementSibling;while(previous&&!previous.matches('section.ah-section'))previous=previous.previousElementSibling;return previous?.id;}),'registration');
   assert.equal(await f.page.locator('#faq-wallet-card a[href="#wallet-card-application"]').count(),1);
   await verifyHeader(f.page,width);
   assert.equal(await form(f.page).locator('[name="wallet.requestedWalletIdentity"]').inputValue(),'');
   await f.page.locator('[data-registration-form] [name=name]').fill('独立合成讲者草稿');await fill(f.page);
   await f.page.waitForFunction(()=>document.querySelector('[data-wallet-draft-status]').textContent==='纪念卡申请已暂存于本机。');
   const before=await drafts(f.page);assert.equal(before.filter(row=>row.kind==='editing'&&row.value?.intake==='wallet-v1').length,1);assert.equal(before.filter(row=>row.kind==='editing'&&row.value?.intake==='general-v2').length,1);
   const role=form(f.page).locator('[name="wallet.ggjRole"]');
   if(width===390){
    f.disconnectConfig();
    await f.page.reload({waitUntil:'networkidle'});
    await f.page.locator('[data-wallet-config-retry]:visible').waitFor();
    assert.equal(await role.inputValue(),involvementWithJammer,'the outage preserves the restored draft');
    assert.equal(await f.page.locator('#wallet-consent').isChecked(),false);
    f.restoreConfig();
    await f.page.locator('[data-wallet-config-retry]').click();
    await f.page.locator('[data-wallet-submit]:enabled').waitFor();
    assert.equal(await role.inputValue(),involvementWithJammer);
    assert.equal(await chineseJammer(f.page).isChecked(),true);
   }
   await f.page.locator('[data-wallet-submit]').click();assert.equal(f.calls.filter(call=>call.path.endsWith('/registration/submit')).length,0,'unchecked consent sends nothing');
   const walletNotice=form(f.page).locator('a[href="#privacy"]');await walletNotice.click();await f.page.locator('[data-privacy-dialog][open]').waitFor();assert.equal(await f.page.locator('#wallet-consent').isChecked(),false);await f.page.locator('[data-privacy-close]').click();assert.equal(await walletNotice.evaluate(node=>document.activeElement===node),true);
   await f.page.locator('#wallet-consent').check();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
   await f.page.waitForTimeout(250);await screenshot(f.page,'form-'+width);
   await f.page.locator('[data-language=en]').click();await f.page.waitForFunction(()=>document.querySelector('#wallet-card-heading').textContent==='Commemorative card application');
   assert.equal(await form(f.page).locator('[name="wallet.name"]').inputValue(),'合成纪念卡申请人');
   assert.equal(await form(f.page).locator('[name="wallet.huodongxingReference"]').inputValue(),'000012345678901234567890');
   assert.equal(await form(f.page).locator('[name="wallet.requestedWalletIdentity"]').inputValue(),'staff');
   assert.match(await form(f.page).locator('[data-field="wallet.ggjSite"] label').innerText(),/^GGJ site or community/u);
   assert.match(await form(f.page).locator('[data-field="wallet.ggjRole"] label').innerText(),/^GGJ involvement/u);
   const englishJammer=form(f.page).getByRole('checkbox',{name:'Jammer (participated in a Game Jam)',exact:true});
   assert.equal(await englishJammer.isChecked(),true);
   await englishJammer.uncheck();
   assert.equal(await role.inputValue(),involvement);
   await englishJammer.check();
   assert.equal(await role.inputValue(),involvementWithJammer);
   const suggestions=await role.evaluate(input=>Array.from(input.list.options,option=>option.value));
   for(const value of ['Site Organizer','Jammer','Mentor','Volunteer','Jury Member','Educator','Community partner','Event Operations','Programmer','Artist','Game Designer']) assert.ok(suggestions.includes(value));
   const contactDetails=form(f.page).locator('summary').filter({hasText:'Phone and school / organization (optional)'});
   await contactDetails.click();
   assert.match(await f.page.locator('#field-wallet-phone-hint').innerText(),/Wallet pass details and the shareable JPEG/u);
   assert.match(await f.page.locator('#field-wallet-organization-hint').innerText(),/before it appears on your card/u);
   await contactDetails.click();
   const readable=await form(f.page).evaluate(node=>[...node.querySelectorAll('.ah-field>label,input:not([type=checkbox]),[data-wallet-submit]')].every(field=>parseFloat(getComputedStyle(field).fontSize)>=16)&&[...node.querySelectorAll('.ah-field-hint,.ah-form-hint,.ah-form-disclaimer')].every(field=>parseFloat(getComputedStyle(field).fontSize)>=14));assert.equal(readable,true);
   await screenshot(f.page,'form-en-'+width);await f.page.locator('[data-language="zh-CN"]').click();await f.page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
   assert.equal(await role.inputValue(),involvementWithJammer);
   assert.equal(await chineseJammer(f.page).isChecked(),true);
   assert.equal(await role.evaluate(input=>input.list.options[2].value),'导师');
   await f.page.locator('[data-wallet-submit]').click();const id=await receipt(f);
   const [{fields}]=(await f.app.registrationService.repository.list()).registrations;
   assert.equal(fields.requestedWalletIdentity,'staff');
   assert.equal(fields.ggjSite,'GGJ 合成站');
   assert.equal(fields.ggjRole,involvementWithJammer);
   assert.equal(fields.walletIdentity,undefined);
   assert.equal(f.calls.filter(call=>call.path.endsWith('/registration/submit')).length,1);assert.equal((await drafts(f.page)).some(row=>row.kind==='pending_submission'&&JSON.parse(row.value.payloadJson).fields.intake==='wallet-v1'),false);
   await staffIdentity(f,id);reports.push({width,normal:true,independentDrafts:true,bilingualValuesAndTypography:true,consent:true,staffIdentity:true,privateIdentityPendingGuidance:true,pendingBeforeApproval:true,noRealMail:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{lost:true});try{
   await fill(f.page);await f.page.locator('#wallet-consent').check();await f.page.locator('[data-wallet-submit]').click();await f.page.locator('[data-wallet-error]:not([hidden])').waitFor();
   const original=f.calls.find(call=>call.path.endsWith('/registration/submit'));assert.equal((await f.app.registrationService.repository.list()).registrations.length,1);
   f.closeIntake();await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-wallet-submit]:enabled').waitFor();assert.equal(f.calls.filter(call=>call.path.endsWith('/registration/submit')).length,1,'reloading never automatically POSTs a pending request');
   assert.equal(await form(f.page).locator('[name="wallet.huodongxingReference"]').inputValue(),'000012345678901234567890');assert.equal(await form(f.page).locator('[name="wallet.huodongxingReference"]').isDisabled(),true);
   assert.equal(await form(f.page).locator('[name="wallet.requestedWalletIdentity"]').inputValue(),'staff');
   assert.equal(await form(f.page).locator('[name="wallet.ggjRole"]').inputValue(),involvementWithJammer);
   assert.equal(await chineseJammer(f.page).isChecked(),true);
   assert.equal(await chineseJammer(f.page).isDisabled(),true);
   await f.page.locator('[data-wallet-submit]').click();await receipt(f);const retry=f.calls.filter(call=>call.path.endsWith('/registration/submit')).at(-1);assert.equal(retry.body,original.body);assert.equal(retry.key,original.key);
   reports.push({width:390,lostResponse:true,originalBodyAndKey:true,recoveryAfterClosure:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{speakerClosed:true});try{
   assert.equal(await f.page.locator('#registration').isVisible(),false);
   assert.equal(await f.page.locator('#speaker-recruitment').isVisible(),false);
   assert.equal(await f.page.locator('#site-guidance').isVisible(),true);
   assert.equal(await f.page.locator('[data-speaker-recruitment]:visible').count(),0);
   await verifyHeader(f.page,390);
   await fill(f.page);await f.page.locator('#wallet-consent').check();await f.page.locator('[data-wallet-submit]').click();
   await receipt(f);
   reports.push({width:390,speakerHiddenAndCardIntakeOpen:true,noRealMail:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(320,{configOutage:true});try{
   const submit=f.page.locator('[data-wallet-submit]'),retry=f.page.locator('[data-wallet-config-retry]');
   await f.page.getByRole('button',{name:'正在确认申请服务…',exact:true}).waitFor();
   assert.equal(await submit.isDisabled(),true);
   assert.equal(await retry.isVisible(),false);
   f.releaseConfig();
   await retry.waitFor();
   assert.equal(await submit.textContent(),'申请服务暂时不可用');
   assert.equal(await f.page.locator('[data-wallet-config-status]').innerText(),'请重试连接申请服务。已保存的本机资料会保留。');
   f.restoreConfig();
   await retry.click();
   await f.page.locator('[data-wallet-submit]:enabled').waitFor();
   assert.equal(await retry.isVisible(),false);
   f.closeIntake();
   await f.page.reload({waitUntil:'networkidle'});
   assert.equal(await submit.textContent(),'纪念卡申请已关闭');
   assert.equal(await retry.isVisible(),false);
   assert.equal(await form(f.page).locator('[name="wallet.email"]').isDisabled(),true);assert.equal(await submit.isDisabled(),true);assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
   assert.equal(await f.page.locator('#faq-wallet-card a').getAttribute('href'),'#wallet-card-application');reports.push({width:320,loadingOutageRetryAndClosure:true,noPublicWrite:true});
  }finally{f.releaseConfig();await f.context.close();}
 }
 assert.equal(reports.length,7);assert.deepEqual(errors,[]);assert.deepEqual(routeErrors,[]);
 const result={ok:true,cases:reports.length,expectedCases:7,sourceCommit,sourceTreeClean,sourceQualification:sourceTreeClean?'clean-checkout':'local-working-tree-not-exact-commit-proof',publicHtmlSha256:htmlSha256,scriptSha256,reports,pageErrors:errors,routeErrors,realBusinessWrites:0,realMail:0,uninterceptedNetwork:0};
 await writeFile(resolve(evidence,'result.json'),JSON.stringify({...result,assets:[...served.values()]},null,2));console.log('Wallet application browser verified: '+JSON.stringify(result));
}finally{await browser.close();}
