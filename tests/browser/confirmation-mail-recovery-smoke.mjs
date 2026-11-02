// Canonical compiled person page over real auth, registrations, confirmation
// service/HTTP, journal and native IDB. Provider transport is synthetic only.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_MAIL_EVIDENCE_DIRECTORY||process.env.ARTDICO_MAIL_RECOVERY_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/confirmation-mail-recovery'));
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE,PEOPLE_FIXTURE_EVENT:EVENT}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {createRegistrationConfirmationService}=await import(pathToFileURL(resolve(source,'functions/registration-confirmation/service.mjs')));
const {createRegistrationConfirmationApi}=await import(pathToFileURL(resolve(source,'functions/registration-confirmation/handler.mjs')));
const {createObjectJournal}=await import(pathToFileURL(resolve(source,'functions/cloud-content/object-journal.mjs')));
const {createConfirmationRepository}=await import(pathToFileURL(resolve(source,'functions/registration-confirmation/repository.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),PERSON='/admin/person/',EXPECTED_CASE_COUNT=8;
const SUCCESS_PREFIX='Confirmation mail recovery browser verified: ';
const AT='2026-10-21T09:00:00.000Z',SECRET='synthetic-people-registration-token-secret-123456';
const RAW_MARKER='SYNTHETIC_PROVIDER_RAW_NEVER_RENDER',REPAIR='修复后重试一次';
const digest=value=>createHash('sha256').update(value).digest('hex'),operation=()=>randomBytes(32).toString('base64url');
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
const counts={seedRegistrations:0,seedApprovals:0,seedDispatches:0,browserSendPosts:0,providerAttempts:0,serverPermissionProbes:0,profileCorrections:0};

async function isolated({history='cap',legacy=false,username='owner',width=390}={}){
 const runtime=await peopleRuntimeFixture({capacity:100,mail:false}),owner=runtime.users[0];
 const provider={mode:'rejected',ready:true,legacy,identity:'a'.repeat(64),attempts:[],readinessReads:0};
 const service=createRegistrationConfirmationService({registrationService:runtime.app.registrationService,journalFor:prefix=>createObjectJournal({objects:runtime.objects,prefix}),tokenSecret:SECRET,clock:()=>Date.parse(AT),
  currentRegistration:record=>runtime.app.reviewStore.projectRegistration(record,record.id,[record.id]),
  emailProvider:{
   readiness:async()=>{provider.readinessReads++;return{ready:provider.ready,enabled:true,reason:provider.ready?'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF':'EMAIL_CONFIGURATION_INVALID',missing:[],invalid:provider.ready?[]:['EMAIL_FROM_ADDRESS'],template:'confirmation',deliveryProof:false};},
   configurationIdentity:async()=>provider.ready?provider.identity:null,
   send:async input=>{
    if(input.expectedConfigurationIdentity!==undefined)assert.equal(input.expectedConfigurationIdentity,provider.identity,'recovery binds the internal synthetic configuration identity');
    if(input.canStart&&!await input.canStart())return{status:'rejected',diagnostic:{code:'DELIVERY_GUARD_BLOCKED',transportStarted:false}};
    const id=input.templateVariables.reference_code;provider.attempts.push({id,status:provider.mode});counts.providerAttempts++;
    if(provider.mode==='provider_accepted')return{status:'provider_accepted'};
    return{status:provider.mode,...(provider.legacy?{}:{diagnostic:provider.mode==='unknown'?{code:'DELIVERY_UNKNOWN',transportStarted:true}:{code:'PROVIDER_REJECTED',transportStarted:true,httpStatus:403}})};
   }
  }});
 const handler=createRegistrationConfirmationApi({service,auth:runtime.app.auth,apiOrigin:API,publicOrigins:[SITE]});
 await service.setSettings({actor:owner,expectedRevision:(await service.settings({actor:owner})).revision,operationId:operation(),enabled:true});
 const registration=await runtime.seedPublic({intake:'general-v2',name:'合成修复参加人甲',email:'synthetic.recovery.a@example.invalid'});counts.seedRegistrations++;
 await runtime.approvePublic(registration.reference_code);counts.seedApprovals++;
 const id=registration.reference_code;
 async function state(actor=owner,selected=id){return service.staffDeliveryState({actor,registrationId:selected});}
 const attempts=history==='cap'?5:history==='none'?0:1;provider.mode=history==='unknown'?'unknown':history==='accepted'?'provider_accepted':'rejected';
 for(let index=0;index<attempts;index++){
  const current=await state(),sent=await service.dispatch({actor:owner,expectedRevision:current.revision,operationId:operation(),registrationIds:[id],retryRejected:index>0,expectedAccessRevisions:{[id]:current.accessRevision}});
  assert.equal(sent.results.length,1);assert.equal(sent.results[0].status,provider.mode);counts.seedDispatches++;
 }
 if(history==='cap'){const current=await state();assert.equal(current.reason,'RETRY_LIMIT');assert.equal(current.ready,false);assert.equal(current.canRecover,true);}
 if(history==='none')provider.ready=false;
 const auth=await runtime.login(username),actor=runtime.users.find(user=>user.username===username);
 const repository=createConfirmationRepository({journal:createObjectJournal({objects:runtime.objects,prefix:service.prefix}),eventId:EVENT,clock:()=>Date.parse(AT)});
 return{runtime,service,handler,repository,provider,registration,id,owner,actor,auth,width,state,seedAttempts:provider.attempts.length};
}
async function draftRows(page){return page.evaluate(()=>new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result;if(!db.objectStoreNames.contains('drafts')){db.close();resolve([]);return;}const tx=db.transaction('drafts','readonly'),read=tx.objectStore('drafts').getAll();read.onsuccess=()=>resolve(read.result);read.onerror=()=>reject(read.error);tx.oncomplete=()=>db.close();};}));}
const pendingRows=async f=>(await draftRows(f.page)).filter(row=>row.scope.page.startsWith('person-confirmation:roles='));
const sends=f=>f.calls.filter(call=>call.method==='POST'&&call.path.startsWith('/api/admin/registration-confirmation/send/'));
async function fixture(browser,errors,options={}){
 const f=await isolated(options),context=await browser.newContext({viewport:{width:f.width,height:940}}),[name,...value]=f.auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 await context.addInitScript(()=>{window.__mailRecoveryDurability={acked:[]};const original=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(value,...args){if(this.name==='drafts'&&value?.kind==='pending_submission'&&value.scope?.page?.startsWith('person-confirmation:roles=')){const raw=value.value.payloadJson;this.transaction.addEventListener('complete',()=>window.__mailRecoveryDurability.acked.push(raw),{once:true});}return original.call(this,value,...args);};});
 const page=await context.newPage(),calls=[],assets=new Map(),dialogs=[],decisions=[];
 const controls={lostAck:false,lookupStatus:0,malformedDiagnostic:false,holdSend:false,releaseSend:null,enteredSend:null};
 page.setDefaultTimeout(15000);await page.clock.setFixedTime(new Date(AT));page.on('pageerror',error=>errors.push(error.message));
 page.on('dialog',async dialog=>{const accepted=decisions.shift();dialogs.push({type:dialog.type(),accepted,message:dialog.message()});if(dialog.type()!=='confirm'||typeof accepted!=='boolean'){errors.push('UNEXPECTED_NATIVE_DIALOG');await dialog.dismiss();return;}if(accepted)await dialog.accept();else await dialog.dismiss();});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;assert.ok([API,SITE].includes(url.origin),'every browser request remains fully intercepted');
  if(path.startsWith('/api/')){
   assert.equal(url.origin,API,'staff operations remain on the canonical API origin');
   const raw=request.postData(),call={path,method:request.method(),raw};calls.push(call);
   const send=path.startsWith('/api/admin/registration-confirmation/send/');
   assert.ok(request.method()==='GET'||request.method()==='POST'&&(send||['/api/admin/login','/api/admin/logout'].includes(path)),'only explicit single-person mail or session actions may write');
   if(path.startsWith('/api/admin/registration-confirmation/operation/')&&controls.lookupStatus){call.status=controls.lookupStatus;return route.fulfill(json({error:{code:'SYNTHETIC_LOOKUP_UNAVAILABLE'}},controls.lookupStatus));}
   if(send){
    counts.browserSendPosts++;const body=JSON.parse(raw),pending=(await pendingRows({page})).find(row=>row.value.payloadJson===raw);
    assert.ok(pending,'the exact original request is durable before its POST');assert.equal(pending.scope.actorId,f.actor.id);assert.equal(pending.scope.entityId,'registration:'+path.split('/').at(-1));
    assert.deepEqual(Object.keys(body).sort(),['expectedAccessRevision','expectedRevision','operationId','recoverRejected','retryRejected']);assert.equal(body.recoverRejected,true);assert.equal(body.retryRejected,true);
    assert.equal(await page.evaluate(raw=>window.__mailRecoveryDurability.acked.includes(raw),raw),true,'native IDB transaction completion precedes transport');
    assert.doesNotMatch(JSON.stringify(pending),/example\.invalid|合成修复|receiptToken|confirmationUrl/u);
    if(controls.holdSend){controls.enteredSend?.();await new Promise(resolve=>{controls.releaseSend=resolve;});}
   }
   const incoming=new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(['GET','HEAD'].includes(request.method())?{}:{body:raw})});
   const response=path.startsWith('/api/admin/registration-confirmation/')?await f.handler(incoming):await f.runtime.app.handle(incoming);call.actualStatus=response.status;
   let body=Buffer.from(await response.arrayBuffer());
   if(controls.malformedDiagnostic&&path.startsWith('/api/admin/registration-confirmation/delivery/')&&response.ok){const changed=JSON.parse(body);changed.diagnostic={code:'<img src=x onerror="window.__unsafeDiagnostic=1">',transportStarted:false,raw:RAW_MARKER};body=Buffer.from(JSON.stringify(changed));}
   if(send&&controls.lostAck){controls.lostAck=false;assert.equal(response.status,200);call.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_COMMITTED_ACK_LOST'}},503));}
   call.status=response.status;const headers=Object.fromEntries(response.headers);delete headers['content-length'];return route.fulfill({status:response.status,headers,body});
  }
  const canonical=url.origin===API?aliases.get(path)||path:path,file=resolve(dist,'.'+(canonical.endsWith('/')?canonical+'index.html':canonical));assert.ok(file.startsWith(dist+'/'));
  try{const body=await readFile(file);assets.set(path,{canonicalPath:canonical,bytes:body.length,sha256:digest(body)});return route.fulfill({status:200,contentType:mime(file),body});}catch{return route.fulfill({status:404,body:''});}
 });
 return{...f,context,page,calls,assets,dialogs,decisions,controls,close:async()=>{controls.releaseSend?.();await context.close();}};
}
async function person(f,id=f.id){await f.page.goto(API+PERSON+'#registration='+id,{waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-refresh]:enabled').waitFor();}
async function services(f){const more=f.page.locator('[data-person-more]');if(!await more.evaluate(node=>node.open))await more.locator(':scope>summary').click();await f.page.locator('[data-person-service-open]:enabled').waitFor();await f.page.locator('[data-person-service-open]').click();}
async function cap(f){await person(f);await services(f);await f.page.locator('[data-person-confirmation-send]:enabled').waitFor();assert.equal((await f.page.locator('[data-person-confirmation-send]').innerText()).trim(),REPAIR);assert.match(await f.page.locator('[data-person-confirmation-status]').innerText(),/重试次数上限/u);assert.equal(await f.page.locator('[data-person-confirmation-settings]').getAttribute('href'),'/admin/settings/delivery/');}
async function confirm(f,accepted){f.decisions.push(accepted);const [dialog]=await Promise.all([f.page.waitForEvent('dialog',{predicate:dialog=>dialog.type()==='confirm'}),f.page.locator('[data-person-confirmation-send]').click()]);assert.match(dialog.message(),/EmailJS.*已修复.*这位.*一次/u);return dialog;}
async function status(f,pattern){await f.page.waitForFunction(source=>new RegExp(source,'u').test(document.querySelector('[data-person-confirmation-status]')?.textContent||''),pattern.source);}
async function sent(f,result='邮件服务已接收'){await status(f,new RegExp(result,'u'));await f.page.locator('[data-person-confirmation-check]:enabled').waitFor({state:'attached'});}
async function noReal(f){assert.equal(f.runtime.messages.length,0,'the underlying runtime never starts another mail provider');assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.doesNotMatch(await f.page.locator('body').textContent(),new RegExp(RAW_MARKER+'|'+f.provider.identity));}
async function blocked(f){assert.equal(await f.page.locator('[data-person-confirmation-send]').isDisabled(),true);assert.notEqual((await f.page.locator('[data-person-confirmation-send]').textContent()).trim(),REPAIR);}
async function serverRecovery(f,{actor=f.actor,headers=f.auth,id=f.id}={}){const current=await f.state(actor,id);counts.serverPermissionProbes++;return f.handler(f.runtime.request('/api/admin/registration-confirmation/send/'+id,{method:'POST',headers,body:{operationId:operation(),expectedRevision:current.revision,expectedAccessRevision:current.accessRevision,retryRejected:true,recoverRejected:true}}));}
async function correctAccess(f){const detail=await f.runtime.app.reviewStore.detail(f.id),fields={...Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??''])),email:'synthetic.corrected@example.invalid'};const response=await f.runtime.app.handle(f.runtime.request('/api/admin/registrations/'+f.id+'/profile',{method:'PATCH',headers:await f.runtime.login(),body:{expectedRevision:detail.revision,operationId:operation(),fields}}));assert.equal(response.status,200);counts.profileCorrections++;}

if(process.argv.includes('--fixture-only')){
 const f=await isolated({legacy:true});assert.equal(f.provider.attempts.length,5);assert.equal((await f.state()).canRecover,true);f.provider.mode='provider_accepted';const current=await f.state();const response=await serverRecovery(f);assert.equal(response.status,200);assert.equal((await response.json()).results[0].status,'provider_accepted');assert.equal(f.provider.attempts.length,6);assert.equal((await f.state()).reason,'ALREADY_ACCEPTED');assert.equal(f.runtime.messages.length,0);console.log(JSON.stringify({syntheticFixtureOnly:true,legacyCap:5,oneRecoveryAccepted:true,normalReadyAtCap:current.ready,realNetworkRequests:0,realMail:0}));
}else{
 const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
 const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 const errors=[],reports=[],bindings=[];let activeCase='setup',failure=null;
 await mkdir(evidence,{recursive:true});
 const sourceCommit=process.env.ARTDICO_SOURCE_COMMIT||execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',maxBuffer:4096}).trim();assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
 const canonicalPersonPath=aliases.get(PERSON)||PERSON,canonicalPersonFile=resolve(dist,'.'+(canonicalPersonPath.endsWith('/')?canonicalPersonPath+'index.html':canonicalPersonPath));assert.ok(canonicalPersonFile.startsWith(dist+'/'));
 const artifactBindings={sourceCommit,scriptSHA256:digest(await readFile(fileURLToPath(import.meta.url))),publicIndexHTMLSHA256:digest(await readFile(resolve(dist,'index.html'))),adminPersonHTML:{requestedPath:PERSON,canonicalPath:canonicalPersonPath,sha256:digest(await readFile(canonicalPersonFile))}};
 async function run(name,options,check){activeCase=name;const f=await fixture(browser,errors,options);try{const proof=await check(f);await noReal(f);await f.page.screenshot({path:resolve(evidence,name+'.png'),fullPage:true});reports.push({name,width:f.width,...proof,syntheticProviderAttempts:f.provider.attempts.length,syntheticBrowserSendPosts:sends(f).length,realMail:0,realBusinessWrites:0,uninterceptedNetwork:0});bindings.push({name,assets:Object.fromEntries(f.assets)});}finally{await f.close();}}
 try{
  await run('legacy-cap-cancel-and-one-accepted-recovery',{legacy:true,width:390},async f=>{
   await cap(f);assert.equal((await f.state()).diagnostic,undefined,'legacy notices stay readable without an invented diagnosis');await confirm(f,false);await f.page.locator('[data-person-confirmation-send]:enabled').waitFor();assert.equal(sends(f).length,0);assert.equal(f.provider.attempts.length,5);
   f.provider.mode='provider_accepted';f.provider.identity='b'.repeat(64);await confirm(f,true);await sent(f);await blocked(f);assert.equal(sends(f).length,1);assert.equal(f.provider.attempts.length,6);assert.equal((await f.state()).reason,'ALREADY_ACCEPTED');assert.equal((await pendingRows(f)).length,0);assert.equal((await serverRecovery(f)).status,409);assert.equal(f.provider.attempts.length,6);
   return{legacyDiagnosticAbsentReadable:true,cancelStartsNoPost:true,oneExplicitRecoveryAccepted:true,secondRecoveryForbidden:true};
  });
  await run('rejected-recovery-is-spent',{width:320},async f=>{
   await cap(f);assert.match(await f.page.locator('[data-person-confirmation-status]').innerText(),/EmailJS拒绝请求（HTTP 403）/u);await confirm(f,true);await sent(f,'单次重试已使用');await blocked(f);const current=await f.state();assert.equal(current.reason,'RECOVERY_USED');assert.equal(current.canRecover,undefined);assert.equal(f.provider.attempts.length,6);assert.equal((await serverRecovery(f)).status,409);assert.equal(f.provider.attempts.length,6);return{safeProvider403Visible:true,oneRejectedRecoveryConsumesAllowance:true,noSeventhAttempt:true};
  });
  await run('lost-ack-idb-original-operation-get-only',{width:390},async f=>{
   await cap(f);f.provider.mode='provider_accepted';f.controls.lostAck=true;await confirm(f,true);await status(f,/待核对/u);await f.page.locator('[data-person-confirmation-check]:enabled').waitFor();const original=sends(f)[0],operationId=JSON.parse(original.raw).operationId;assert.equal((await pendingRows(f))[0].value.payloadJson,original.raw);
   f.controls.lookupStatus=503;await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-person-record]:visible').waitFor();await f.page.locator('[data-person-confirmation-check]:enabled').waitFor();assert.equal((await pendingRows(f))[0].value.payloadJson,original.raw);assert.equal(sends(f).length,1);
   f.controls.lookupStatus=0;await f.page.locator('[data-person-confirmation-check]').click();await f.page.locator('[data-person-last-check]:visible').waitFor();assert.equal((await pendingRows(f)).length,0);assert.equal(sends(f).length,1);assert.equal(f.provider.attempts.length,6);const reads=f.calls.filter(call=>call.path.endsWith('/operation/'+operationId));assert.ok(reads.length>=2);assert.ok(reads.every(call=>call.method==='GET'&&call.raw===null));return{nativeIDBOriginalBodyPreserved:true,lostAckAndReloadNoResend:true,originalOperationGetsOnly:true,bodySHA256:digest(original.raw)};
  });
  await run('unknown-history-never-recovers',{history:'unknown',width:1440},async f=>{await person(f);await services(f);await blocked(f);const current=await f.state();assert.equal(current.reason,'DELIVERY_UNKNOWN');assert.equal(current.canRecover,undefined);assert.equal((await serverRecovery(f)).status,409);assert.equal(sends(f).length,0);assert.equal(f.provider.attempts.length,1);assert.match(await f.page.locator('[data-person-communications]').textContent(),/未知|不明|待核对/u);return{unknownRemainsLocked:true,forgedRecoveryRejected:true};});
  await run('accepted-history-never-recovers',{history:'accepted',width:390},async f=>{await person(f);await services(f);await sent(f);await blocked(f);assert.equal((await f.state()).reason,'ALREADY_ACCEPTED');assert.equal((await serverRecovery(f)).status,409);assert.equal(sends(f).length,0);assert.equal(f.provider.attempts.length,1);return{acceptedReadOnly:true,forgedRecoveryRejected:true};});
  await run('reviewer-read-only-and-server-forbidden',{username:'reviewer',width:1440},async f=>{await person(f);await services(f);await status(f,/此账号可核对通知记录|当前账号可查看/u);await blocked(f);assert.equal((await f.state(f.actor)).canSend,false);assert.equal((await serverRecovery(f)).status,403);assert.equal(sends(f).length,0);assert.equal(f.provider.attempts.length,5);return{reviewerCannotRecover:true,realAuthAndServer403:true};});
  await run('invalid-readiness-and-malformed-diagnostic-safe',{history:'none',width:390},async f=>{
   await person(f);await services(f);await status(f,/邮件配置格式需核对|邮件.*设置|邮件.*配置/u);await blocked(f);assert.equal((await f.state()).reason,'EMAIL_CONFIGURATION_INVALID');assert.equal(await f.page.locator('[data-person-confirmation-settings]').getAttribute('href'),'/admin/settings/delivery/');assert.equal(f.provider.attempts.length,0);
   f.controls.malformedDiagnostic=true;await f.page.locator('[data-person-confirmation-check]').click();await status(f,/暂时无法核对/u);await blocked(f);assert.equal(await f.page.locator('img[src="x"]').count(),0);assert.equal(await f.page.evaluate(()=>window.__unsafeDiagnostic),undefined);assert.doesNotMatch(await f.page.locator('body').textContent(),new RegExp(RAW_MARKER));assert.equal(sends(f).length,0);return{safeInvalidConfigurationReasonAndSettingsLink:true,zeroProviderAttempts:true,malformedIncomingDiagnosticRejectedWithoutHTML:true};
  });
  await run('inflight-person-and-access-switch-never-misdelivers',{width:390},async f=>{
   const second=await f.runtime.seedPublic({intake:'general-v2',name:'合成修复参加人乙',email:'synthetic.recovery.b@example.invalid'});counts.seedRegistrations++;await f.runtime.approvePublic(second.reference_code);counts.seedApprovals++;
   await cap(f);f.controls.holdSend=true;const entered=new Promise(resolve=>{f.controls.enteredSend=resolve;});await confirm(f,true);await entered;assert.equal(sends(f).length,1);await correctAccess(f);
   await f.page.evaluate(id=>{location.hash='registration='+id;},second.reference_code);await f.page.locator('[data-person-name]').filter({hasText:'合成修复参加人乙'}).waitFor();
   const staleReceipt=f.page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/send/'+f.id)&&response.status()===409);f.controls.releaseSend();f.controls.holdSend=false;await staleReceipt;
   assert.equal(sends(f).length,1);assert.ok(sends(f).every(call=>call.path.endsWith('/'+f.id)));assert.equal(f.provider.attempts.length,5);assert.equal((await f.state(f.owner,second.reference_code)).status,'not_sent');assert.equal(await f.page.locator('[data-person-name]').textContent(),'合成修复参加人乙');return{durableOriginalPersonOnly:true,staleAccessRevision409BeforeProvider:true,secondPersonNeverSent:true};
  });
  assert.equal(reports.length,EXPECTED_CASE_COUNT);assert.deepEqual(errors,[]);
 }catch(error){failure={code:'CONFIRMATION_MAIL_RECOVERY_ASSERTION_FAILED',case:activeCase,type:error.name,location:/confirmation-mail-recovery-smoke\.mjs:\d+:\d+/u.exec(error.stack||'')?.[0]??null};}
 finally{await browser.close();}
 const report={ok:!failure,passedCases:reports.length,expectedCases:EXPECTED_CASE_COUNT,syntheticOnly:true,realMail:0,realBusinessWrites:0,uninterceptedNetwork:0,syntheticCounts:counts,...artifactBindings,reports,bindings,pageErrors:errors,...(failure?{failure}:{})};
 await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');
 const summary={ok:report.ok,cases:reports.length,expectedCases:EXPECTED_CASE_COUNT,sourceCommit,scriptSHA256:artifactBindings.scriptSHA256,publicIndexHTMLSHA256:artifactBindings.publicIndexHTMLSHA256,adminPersonHTML:artifactBindings.adminPersonHTML,syntheticCounts:counts,realMail:0,realBusinessWrites:0,uninterceptedNetwork:0,pageErrorCount:errors.length,...(failure?{failure}:{})};
 process.stdout.write((report.ok?SUCCESS_PREFIX:'Confirmation mail recovery browser failed: ')+JSON.stringify(summary)+'\n');if(failure)process.exitCode=1;
}
