// Frozen built pages with the actual isolated API runtime; no live services or records.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const{chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence'));
const digest=value=>createHash('sha256').update(value).digest('hex'),reports=[],errors=[],assets=new Map();
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES);
// Public builds contain each page; exact FC packages contain only canonical
// HTML and serve the exported aliases. Preserve that distinction in evidence.
async function staticFile(requestedPath){
 const fileFor=path=>resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path)),direct=fileFor(requestedPath);
 assert.ok(direct.startsWith(dist+'/'));
 if(aliases.has(requestedPath)){try{await stat(direct);}catch(error){if(error.code!=='ENOENT')throw error;const path=aliases.get(requestedPath);return{path,file:fileFor(path)};}}
 return{path:requestedPath,file:direct};
}
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture({width=390,loseGroup=false}={}){
 const runtime=await peopleRuntimeFixture({mail:true}),auth=await runtime.login('owner'),context=await browser.newContext({viewport:{width,height:900}}),[name,...value]=auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());const calls=[];let failGroupRead=false,failGroupImage=false;
 await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE);
  if(path.startsWith('/api/')){
   if(failGroupRead&&path==='/api/admin/group-invite'&&req.method()==='GET'){calls.push({path,method:req.method(),status:503});return route.fulfill(json({error:{code:'SYNTHETIC_UNAVAILABLE'}},503));}
   if(failGroupImage&&path==='/api/admin/group-invite/image'){calls.push({path,method:req.method(),status:503});return route.fulfill({status:503,body:''});}
   const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));calls.push({path,method:req.method(),status:response.status});
   if(loseGroup&&path==='/api/admin/group-invite'&&req.method()==='POST'&&response.ok){loseGroup=false;await response.arrayBuffer();return route.fulfill(json({error:{code:'SYNTHETIC_ACK_LOST'}},503));}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  try{const served=await staticFile(path),body=await readFile(served.file);assets.set(path,{path,servedPath:served.path,sha256:digest(body),bytes:body.length});return route.fulfill({status:200,body,contentType:({html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',svg:'image/svg+xml'})[extname(served.file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const api=async path=>{const response=await runtime.app.handle(runtime.request(path,{headers:auth}));assert.equal(response.status,200);return response.json();};
 return{runtime,auth,context,page,calls,api,failGroupRead(){failGroupRead=true;},failGroupImage(){failGroupImage=true;}};
}
try{
 await mkdir(evidence,{recursive:true});
 for(const width of[320,390,1440]){
  const f=await fixture({width}),page=f.page;await page.goto(SITE+'/admin/settings/group/',{waitUntil:'domcontentloaded'});await page.locator('[data-group-refresh]:enabled').waitFor();
  const form=page.locator('[data-group-form]'),input=form.locator('[name=image]'),expiry=form.locator('[name=expiresAt]'),save=form.locator('[data-settings-save-button=group]'),state=form.locator('[data-settings-form-state=group]');
  assert.equal(await save.textContent(),'保存');const before=await f.api('/api/admin/group-invite');assert.equal(Date.parse(before.maxExpiresAt)-Date.parse(before.serverTime),7*86400000);
  const expectedMax=new Date(Date.parse(before.maxExpiresAt)+8*3600000).toISOString().slice(0,16);assert.equal(await expiry.getAttribute('max'),expectedMax);assert.equal(await expiry.inputValue(),expectedMax);
  await input.setInputFiles({name:'synthetic-only-qr.png',mimeType:'image/png',buffer:PNG});await expiry.fill(expectedMax.slice(0,10)+'T23:59');await save.click();assert.equal(await state.getAttribute('data-save-state'),'error');assert.match(await form.locator('[data-group-expiry-error]').textContent(),/最晚可选/u);assert.equal(await input.evaluate(node=>node.files.length),1);assert.equal(f.calls.filter(row=>row.method==='POST'&&row.path==='/api/admin/group-invite').length,0);
  await form.locator('[data-group-expiry-days="7"]').click();const selected=await expiry.inputValue();const written=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/group-invite'&&response.request().method()==='POST');await save.click();const response=await written;assert.equal(response.status(),200);const ack=await response.json();assert.equal(ack.sourceSha256,digest(PNG));assert.equal(ack.expiresAt,new Date(selected+':00+08:00').toISOString());await page.locator('[data-settings-form-state=group][data-save-state=saved]').waitFor();assert.equal(await input.evaluate(node=>node.files.length),0);assert.equal(await save.isDisabled(),true);const current=await f.api('/api/admin/group-invite');assert.equal(current.configured,true);assert.equal(current.expiresAt,ack.expiresAt);assert.equal(Object.hasOwn(current,'sourceSha256'),false);assert.equal(f.runtime.messages.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:resolve(evidence,'settings-group-saved-'+width+'.png'),fullPage:true});
  await page.goto(SITE+'/admin/settings/delivery/',{waitUntil:'domcontentloaded'});await page.locator('[data-delivery-automatic] [name=enabled]:enabled').waitFor();const mail=page.locator('[data-delivery-automatic]'),enabled=await mail.locator('[name=enabled]').isChecked();await mail.locator('[name=enabled]').setChecked(!enabled);const changed=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/registration-confirmation/settings'&&response.request().method()==='PUT');await mail.locator('[data-delivery-save-button]').click();const mailAck=await(await changed).json();assert.equal(mailAck.enabled,!enabled);assert.equal(typeof mailAck.operationId,'string');await mail.locator('[data-delivery-save-state][data-save-state=saved]').waitFor();assert.equal((await f.api('/api/admin/registration-confirmation/settings')).automaticEnabled,!enabled);assert.equal(f.runtime.messages.length,0);
  reports.push({width,rollingServerWindow:true,calendarEndRejectedInline:true,selectedFilePreservedUntilExactAck:true,actualQrReplacementAcknowledgedByRawDigest:true,actualMailSettingSavedWithoutSending:true,noPageOverflow:true});await f.context.close();
 }
 for(const width of[320,390,1440]){
  const f=await fixture({width}),page=f.page;await page.goto(SITE+'/admin/settings/group/',{waitUntil:'domcontentloaded'});await page.locator('[data-group-refresh]:enabled').waitFor();
  const form=page.locator('[data-group-form]'),input=form.locator('[name=image]'),expiry=form.locator('[name=expiresAt]'),save=form.locator('[data-settings-save-button=group]'),status=page.locator('[data-group-status]');
  await input.setInputFiles({name:'synthetic-expiring-qr.png',mimeType:'image/png',buffer:PNG});await form.locator('[data-group-expiry-days="1"]').click();await save.click();await form.locator('[data-settings-form-state=group][data-save-state=saved]').waitFor();await page.locator('[data-group-status][data-group-health=expiring]').waitFor();
  assert.equal(await status.getAttribute('data-group-health'),'expiring');assert.match(await status.textContent(),/24 小时内到期/u);assert.equal(await page.locator('[data-group-image]').isVisible(),true);
  const panel=page.locator('[data-staff-settings] [data-settings-panel=group]');assert.match(await panel.textContent(),/取得新群码.*上传原图.*核对真实到期时间.*保存/u);assert.match(await panel.locator('details').textContent(),/图片访问链接最多有效 10 分钟/u);assert.match(await panel.locator('details').textContent(),/群码本身最多设置 7 天/u);
  const writes=f.calls.filter(row=>['POST','PUT','DELETE'].includes(row.method)).length;
  f.failGroupImage();await page.locator('[data-group-refresh]').click();await page.locator('[data-group-status][data-group-health=image-unavailable]').waitFor();assert.equal(await page.locator('[data-group-image]').isVisible(),false);assert.match(await status.textContent(),/刷新状态或替换原图/u);
  await input.setInputFiles({name:'synthetic-draft-qr.png',mimeType:'image/png',buffer:PNG});await form.locator('[data-group-expiry-days="3"]').click();const selected=await expiry.inputValue();
  f.failGroupRead();await page.locator('[data-group-refresh]').click();await page.locator('[data-settings-error]').filter({hasText:'设置服务暂时不可用'}).waitFor();
  assert.equal(await status.getAttribute('data-group-health'),'unavailable');assert.match(await status.textContent(),/待核对/u);assert.equal(await page.locator('[data-group-image]').isVisible(),false);assert.equal(await page.locator('[data-group-image]').getAttribute('src'),null);
  assert.equal(await input.evaluate(node=>node.files.length),1);assert.equal(await expiry.inputValue(),selected);assert.equal(await save.isDisabled(),true);assert.equal(await form.locator('[data-group-disable]').isDisabled(),true);
  assert.equal(f.calls.filter(row=>['POST','PUT','DELETE'].includes(row.method)).length,writes);assert.equal(f.runtime.messages.length,0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:resolve(evidence,'settings-group-unavailable-'+width+'.png'),fullPage:true});
  reports.push({width,expiringWithin24Hours:true,tenMinuteImageAndSevenDayQrSeparated:true,failedImageHasRecovery:true,failedReadClearsOldImageAndRevision:true,selectedFileAndExpiryPreserved:true,failedReadNeverRetriesWrite:true,noMessages:true,noPageOverflow:true});await f.context.close();
 }
 {
  const f=await fixture({loseGroup:true}),page=f.page;await page.goto(SITE+'/admin/settings/group/',{waitUntil:'domcontentloaded'});await page.locator('[data-group-refresh]:enabled').waitFor();const form=page.locator('[data-group-form]');await form.locator('[name=image]').setInputFiles({name:'synthetic-unknown-qr.png',mimeType:'image/png',buffer:PNG});await form.locator('[data-group-expiry-days="1"]').click();await form.locator('[data-settings-save-button=group]').click();await form.locator('[data-settings-form-state=group][data-save-state=unknown]').waitFor();assert.equal(await form.locator('[name=image]').evaluate(node=>node.files.length),1);assert.equal((await f.api('/api/admin/group-invite')).configured,true);const writes=f.calls.filter(row=>row.path==='/api/admin/group-invite'&&row.method==='POST').length;await page.locator('[data-group-refresh]').click();await page.locator('[data-settings-error]').filter({hasText:'不能证明'}).waitFor();assert.equal(f.calls.filter(row=>row.path==='/api/admin/group-invite'&&row.method==='POST').length,writes);assert.equal(await form.locator('[data-settings-save-button=group]').isDisabled(),true);assert.equal(await form.locator('[data-settings-form-state=group]').getAttribute('data-save-state'),'unknown');assert.equal(f.runtime.messages.length,0);reports.push({actualCommittedGroupLostAckNeverClaimsSaved:true,refreshNeverRetriesQrWrite:true,unknownFileAndReconciliationLockRetained:true});await f.context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
const groupHtml=await staticFile('/admin/settings/group/'),info=await stat(groupHtml.file),result={cases:reports.length,reports,pageErrors:errors,syntheticOnly:true,browserClosed:true,provenance:{dist,groupHtmlRequestedPath:'/admin/settings/group/',groupHtmlServedPath:groupHtml.path,groupHtmlMtime:info.mtime.toISOString(),groupHtmlSha256:digest(await readFile(groupHtml.file)),assets:[...assets.values()].sort((left,right)=>left.path.localeCompare(right.path))}};
await writeFile(resolve(evidence,'settings-group-runtime-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
