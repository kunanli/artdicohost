// Built staff notification page over the isolated runtime. Every request is
// intercepted; registrations, provider calls and browser recovery are synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/p4-notifications'));
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),assets=new Map(),reports=[],errors=[];
const hash=value=>createHash('sha256').update(value).digest('hex');
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
async function staticFile(requestedPath){
 const fileFor=path=>resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path)),direct=fileFor(requestedPath);assert.ok(direct.startsWith(dist+'/'));
 if(aliases.has(requestedPath)){try{await stat(direct);}catch(error){if(error.code!=='ENOENT')throw error;const path=aliases.get(requestedPath);return{path,file:fileFor(path)};}}
 return{path:requestedPath,file:direct};
}
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture(width,{loseAck=false,providerUnknown=false}={}){
 const runtime=await peopleRuntimeFixture({capacity:4,mail:true,mailResult:providerUnknown?'unknown':'accepted'}),auth=await runtime.login('owner');
 const a=await runtime.seedPublic({name:'合成提醒甲',email:'synthetic.reminder.a@example.invalid'});await runtime.approvePublic(a.reference_code,{headers:auth});
 const b=await runtime.seedPublic({name:'合成提醒乙',email:'synthetic.reminder.b@example.invalid'});await runtime.approvePublic(b.reference_code,{headers:auth});
 await runtime.seedPublic({name:'合成待审人员',email:'synthetic.pending@example.invalid'});
 const context=await browser.newContext({viewport:{width,height:900}}),[name,...cookie]=auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:cookie.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage(),calls=[],controls={failPreview:false,failSelectedPreview:false,expirePreview:false,definiteConflict:false};page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
 await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'all requests stay inside the intercepted fixture');
  if(path.startsWith('/api/')){
   const entry={path,method:req.method(),body:req.postData()};calls.push(entry);
   if(path==='/api/admin/registration-confirmation/reminder-preview'&&(controls.failPreview||controls.expirePreview)){entry.status=controls.expirePreview?401:503;return route.fulfill(json({error:{code:'SYNTHETIC_UNAVAILABLE'}},entry.status));}
   if(path==='/api/admin/registration-confirmation/reminder-preview'&&controls.failSelectedPreview&&JSON.parse(req.postData()||'{}').registrationIds){entry.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_IDENTITY_UNAVAILABLE'}},503));}
   if(path==='/api/admin/registration-confirmation/reminder-dispatch'&&controls.definiteConflict){entry.status=409;return route.fulfill(json({error:{code:'SYNTHETIC_REVISION_CONFLICT'}},409));}
   const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));entry.status=response.status;
   if(loseAck&&path==='/api/admin/registration-confirmation/reminder-dispatch'&&req.method()==='POST'&&response.ok){loseAck=false;await response.arrayBuffer();return route.fulfill(json({error:{code:'SYNTHETIC_ACK_LOST'}},503));}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  }
  const served=await staticFile(path),body=await readFile(served.file);assets.set(path,{path,servedPath:served.path,sha256:hash(body),bytes:body.length});
  return route.fulfill({status:200,body,contentType:({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',woff2:'font/woff2',svg:'image/svg+xml'})[extname(served.file).slice(1)]||'application/octet-stream'});
 });
 return{runtime,auth,context,page,calls,controls,baselineMessages:runtime.messages.length,a,b};
}
async function open(f){await f.page.goto(SITE+'/admin/settings/delivery/',{waitUntil:'domcontentloaded'});await f.page.locator('[data-reminder-refresh]:enabled').waitFor();}
async function preview(f){await f.page.locator('[data-reminder-refresh]').click();await f.page.locator('[data-reminder-status]').filter({hasText:'当前已确认'}).waitFor();await f.page.locator('[data-reminder-select-all]:enabled').waitFor();}
const dispatches=f=>f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/reminder-dispatch');
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
try{
 await mkdir(evidence,{recursive:true});
 for(const width of[320,390,1440]){
  const f=await fixture(width),{page}=f;try{
   await open(f);assert.match(await page.locator('[data-delivery-automatic]').textContent(),/启用报名通知/u);assert.equal(await page.locator('[data-reminder-rows] li').count(),0);assert.equal(f.runtime.messages.length,f.baselineMessages);
   await preview(f);assert.equal(await page.locator('[data-reminder-rows] li').count(),2);assert.doesNotMatch(await page.locator('[data-reminder-rows]').textContent(),/合成待审人员/u);
   await page.locator('[data-reminder-preview] details summary').click();assert.match(await page.locator('[data-reminder-message]').textContent(),/\[私人参会页链接\]/u);assert.doesNotMatch(await page.locator('[data-reminder-message]').textContent(),/#(?:token|receipt)|qrImageUrl|pkpass/u);
   assert.equal(f.runtime.messages.length,f.baselineMessages);await page.locator('[data-reminder-select-all]').check();assert.equal(await page.locator('[data-reminder-send]').textContent(),'发送提醒（2 人）');
   await page.locator('[data-reminder-send]').click();await page.locator('[data-reminder-results]').filter({hasText:'合成提醒甲 · 邮件服务已接收'}).waitFor();await page.locator('[data-reminder-refresh]:enabled').waitFor();
   assert.equal(dispatches(f).length,1);assert.equal(f.runtime.messages.length,f.baselineMessages+2);assert.equal(await page.locator('[data-reminder-registration]:enabled').count(),0);assert.equal(await page.locator('[data-reminder-send]').isDisabled(),true);
   f.controls.failPreview=true;await page.locator('[data-reminder-refresh]').click();await page.locator('[data-reminder-status]').filter({hasText:'名单暂无法核对'}).waitFor();
   assert.equal(await page.locator('[data-reminder-rows] li').count(),0);assert.equal(await page.locator('[data-reminder-results]').textContent(),'');assert.equal(await page.locator('[data-reminder-message]').textContent(),'');assert.equal(await page.locator('[data-reminder-send]').isDisabled(),true);assert.equal(dispatches(f).length,1);
   f.controls.failPreview=false;f.controls.expirePreview=true;await page.locator('[data-reminder-refresh]').click();await page.locator('[data-settings-login-panel]').waitFor();assert.equal(await page.locator('[data-settings-workspace]').isVisible(),false);assert.equal(await page.locator('[data-reminder-rows]').textContent(),'');assert.equal(await page.locator('[data-reminder-results]').textContent(),'');
   assert.equal(f.runtime.messages.length,f.baselineMessages+2);await noOverflow(page);await page.screenshot({path:resolve(evidence,'reminder-cleared-'+width+'.png'),fullPage:true});
   reports.push({width,confirmedCanonicalPreviewOnly:true,previewNeverSends:true,explicitSelectedCount:true,oneReminderEach:true,acceptedNotSelectable:true,failedSourceClearsNamesAndMessage:true,expiredSessionClearsPrivatePreview:true,noOverflow:true});
  }finally{await f.context.close();}
 }
 for(const width of[320,390,1440]){
  const f=await fixture(width,{loseAck:true}),{page}=f;try{
   await open(f);await preview(f);await page.getByLabel('选择 合成提醒甲',{exact:true}).check();const lost=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/registration-confirmation/reminder-dispatch'&&response.status()===503);await page.locator('[data-reminder-send]').click();await lost;await page.locator('[data-reminder-lookup]:enabled').waitFor();assert.equal(dispatches(f).length,1);assert.equal(f.runtime.messages.length,f.baselineMessages+1);
   const originalBody=dispatches(f)[0].body,originalId=JSON.parse(originalBody).operationId;await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-reminder-lookup]:enabled').waitFor();assert.equal(await page.locator('[data-reminder-rows] li').count(),0);assert.equal(dispatches(f).length,1);
   await page.locator('[data-reminder-lookup]').click();await page.locator('[data-reminder-pending]').waitFor({state:'hidden'});await page.locator('[data-reminder-status]').filter({hasText:'当前已确认'}).waitFor();
   const lookups=f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/reminder-operation/'+originalId);assert.equal(lookups.length,1);assert.equal(lookups[0].method,'GET');assert.equal(lookups[0].body,null);assert.equal(dispatches(f).length,1);assert.equal(f.runtime.messages.length,f.baselineMessages+1);
   await page.locator('[data-reminder-results]').filter({hasText:'合成提醒甲 · 邮件服务已接收'}).waitFor();assert.match(await page.locator('[data-reminder-results]').textContent(),/合成组织文字/u);const identities=f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/reminder-preview'&&JSON.parse(call.body).registrationIds);assert.equal(identities.length,1);assert.deepEqual(JSON.parse(identities[0].body).registrationIds,JSON.parse(originalBody).registrationIds);
   assert.equal(await page.getByLabel('选择 合成提醒甲',{exact:true}).isDisabled(),true);assert.equal(await page.getByLabel('选择 合成提醒乙',{exact:true}).isEnabled(),true);await noOverflow(page);
   await page.screenshot({path:resolve(evidence,'reminder-reconciled-'+width+'.png'),fullPage:true});reports.push({width,lostAckPersistedBeforeReload:true,originalOperationLookedUpByGet:true,namesAndOrganizationsReadForExactOriginalIds:true,noSecondPostOrNewId:true,acceptedDisabledAfterRecovery:true,otherEligiblePersonStillSelectable:true,originalBodySha256:hash(originalBody),noOverflow:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{loseAck:true}),{page}=f;try{
   await open(f);await preview(f);await page.getByLabel('选择 合成提醒甲',{exact:true}).check();const lost=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/registration-confirmation/reminder-dispatch'&&response.status()===503);await page.locator('[data-reminder-send]').click();await lost;await page.locator('[data-reminder-lookup]:enabled').waitFor();
   const originalBody=dispatches(f)[0].body,originalId=JSON.parse(originalBody).operationId;await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-reminder-lookup]:enabled').waitFor();f.controls.failSelectedPreview=true;await page.locator('[data-reminder-lookup]').click();await page.locator('[data-reminder-status]').filter({hasText:'人员信息暂无法核对'}).waitFor();await page.locator('[data-reminder-lookup]:enabled').waitFor();
   assert.equal(await page.locator('[data-reminder-results]').textContent(),'');assert.equal(await page.locator('[data-reminder-rows]').textContent(),'');assert.equal(await page.locator('[data-reminder-pending]').isVisible(),true);assert.equal(f.runtime.messages.length,f.baselineMessages+1);assert.equal(dispatches(f).length,1);
   f.controls.failSelectedPreview=false;await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-reminder-lookup]:enabled').waitFor();await page.locator('[data-reminder-lookup]').click();await page.locator('[data-reminder-results]').filter({hasText:'合成提醒甲 · 邮件服务已接收'}).waitFor();await page.locator('[data-reminder-refresh]:enabled').waitFor();
   const lookups=f.calls.filter(call=>call.path==='/api/admin/registration-confirmation/reminder-operation/'+originalId);assert.equal(lookups.length,2);assert.ok(lookups.every(call=>call.method==='GET'));assert.equal(dispatches(f).length,1);assert.equal(f.runtime.messages.length,f.baselineMessages+1);
   reports.push({width:390,failedIdentityReadClearsNamesAndKeepsOriginalPending:true,secondReloadRecoversSameOriginalOperation:true,readOnlyIdentityRecoveryNeverDispatches:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{loseAck:true}),{page}=f;try{
   await open(f);await preview(f);await page.getByLabel('选择 合成提醒甲',{exact:true}).check();const lost=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/registration-confirmation/reminder-dispatch'&&response.status()===503);await page.locator('[data-reminder-send]').click();await lost;await page.locator('[data-reminder-lookup]:enabled').waitFor();
   const current=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),withdraw=await f.runtime.app.handle(f.runtime.request('/api/admin/admissions/withdraw',{method:'POST',headers:f.auth,body:{registrationId:f.a.reference_code,expectedRevision:current.revision,operationId:'w'.repeat(43)}}));assert.equal(withdraw.status,200);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('[data-reminder-lookup]:enabled').waitFor();await page.locator('[data-reminder-lookup]').click();await page.locator('[data-reminder-results]').filter({hasText:'人员信息待核对 · 邮件服务已接收'}).waitFor();await page.locator('[data-reminder-refresh]:enabled').waitFor();assert.doesNotMatch(await page.locator('[data-reminder-results]').textContent(),/合成提醒甲|合成提醒乙/u);assert.equal(dispatches(f).length,1);assert.equal(f.runtime.messages.length,f.baselineMessages+1);
   reports.push({width:390,withdrawnOriginalRecipientNeverMappedToAnotherName:true,missingCurrentIdentityShownHonestly:true,noReminderResendAfterWithdrawal:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390),{page}=f;try{
   await open(f);await preview(f);f.controls.definiteConflict=true;await page.getByLabel('选择 合成提醒甲',{exact:true}).check();await page.locator('[data-reminder-send]').click();await page.locator('[data-reminder-status]').filter({hasText:'名单或设置已有更新'}).waitFor();
   assert.equal(f.runtime.messages.length,f.baselineMessages);assert.equal(dispatches(f).length,1);assert.equal(dispatches(f)[0].status,409);assert.equal(await page.locator('[data-reminder-pending]').isVisible(),false);assert.equal(await page.locator('[data-reminder-refresh]').isEnabled(),true);assert.equal(await page.locator('[data-reminder-rows] li').count(),0);
   f.controls.definiteConflict=false;await preview(f);await page.getByLabel('选择 合成提醒甲',{exact:true}).check();await page.locator('[data-reminder-send]').click();await page.locator('[data-reminder-results]').filter({hasText:'合成提醒甲 · 邮件服务已接收'}).waitFor();assert.equal(dispatches(f).length,2);assert.equal(f.runtime.messages.length,f.baselineMessages+1);
   reports.push({width:390,definiteConflictNeverSends:true,definiteRejectionClearsLocalPending:true,freshPreviewAllowsExplicitNewAttempt:true});
  }finally{await f.context.close();}
 }
 {
  const f=await fixture(390,{providerUnknown:true}),{page}=f;try{
   await open(f);await preview(f);await page.getByLabel('选择 合成提醒甲',{exact:true}).check();await page.locator('[data-reminder-send]').click();await page.locator('[data-reminder-pending]').waitFor();await page.locator('[data-reminder-results]').filter({hasText:'结果待核对，不重寄'}).waitFor();
   const count=f.runtime.messages.length;assert.equal(count,f.baselineMessages+1);await page.locator('[data-reminder-lookup]').click();await page.locator('[data-reminder-lookup]:enabled').waitFor();assert.equal(f.runtime.messages.length,count);assert.equal(dispatches(f).length,1);assert.equal(await page.locator('[data-reminder-send]').isDisabled(),true);assert.equal(await page.locator('[data-reminder-pending]').isVisible(),true);
   reports.push({width:390,providerUnknownKeepsOriginalRecovery:true,lookupNeverResends:true,unknownNeverSelectable:true});
  }finally{await f.context.close();}
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
const served=await staticFile('/admin/settings/delivery/'),html=await readFile(served.file),result={cases:reports.length,reports,pageErrors:errors,syntheticOnly:true,browserClosed:true,provenance:{dist,htmlRequestedPath:'/admin/settings/delivery/',htmlServedPath:served.path,htmlSha256:hash(html),assets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path))}};
await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
