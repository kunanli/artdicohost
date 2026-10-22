// Frozen built pages with the actual isolated API runtime; no live services or records.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
const{chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),evidence=resolve(project,'.local-data/browser-evidence');
const digest=value=>createHash('sha256').update(value).digest('hex'),reports=[],errors=[],assets=new Map();
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture({width=390,loseGroup=false}={}){
 const runtime=await peopleRuntimeFixture({mail:true}),auth=await runtime.login('owner'),context=await browser.newContext({viewport:{width,height:900}}),[name,...value]=auth.Cookie.split('=');
 await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());const calls=[];
 await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE);
  if(path.startsWith('/api/')){const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers:await req.allHeaders(),...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));calls.push({path,method:req.method(),status:response.status});
   if(loseGroup&&path==='/api/admin/group-invite'&&req.method()==='POST'&&response.ok){loseGroup=false;await response.arrayBuffer();return route.fulfill(json({error:{code:'SYNTHETIC_ACK_LOST'}},503));}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));try{const body=await readFile(file);assets.set(path,{path,sha256:digest(body),bytes:body.length});return route.fulfill({status:200,body,contentType:({html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',svg:'image/svg+xml'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 const api=async path=>{const response=await runtime.app.handle(runtime.request(path,{headers:auth}));assert.equal(response.status,200);return response.json();};
 return{runtime,auth,context,page,calls,api};
}
try{
 await mkdir(evidence,{recursive:true});
 for(const width of[390,1440]){
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
 {
  const f=await fixture({loseGroup:true}),page=f.page;await page.goto(SITE+'/admin/settings/group/',{waitUntil:'domcontentloaded'});await page.locator('[data-group-refresh]:enabled').waitFor();const form=page.locator('[data-group-form]');await form.locator('[name=image]').setInputFiles({name:'synthetic-unknown-qr.png',mimeType:'image/png',buffer:PNG});await form.locator('[data-group-expiry-days="1"]').click();await form.locator('[data-settings-save-button=group]').click();await form.locator('[data-settings-form-state=group][data-save-state=unknown]').waitFor();assert.equal(await form.locator('[name=image]').evaluate(node=>node.files.length),1);assert.equal((await f.api('/api/admin/group-invite')).configured,true);const writes=f.calls.filter(row=>row.path==='/api/admin/group-invite'&&row.method==='POST').length;await page.locator('[data-group-refresh]').click();await page.locator('[data-settings-error]').filter({hasText:'不能证明'}).waitFor();assert.equal(f.calls.filter(row=>row.path==='/api/admin/group-invite'&&row.method==='POST').length,writes);assert.equal(await form.locator('[data-settings-save-button=group]').isDisabled(),true);assert.equal(await form.locator('[data-settings-form-state=group]').getAttribute('data-save-state'),'unknown');assert.equal(f.runtime.messages.length,0);reports.push({actualCommittedGroupLostAckNeverClaimsSaved:true,refreshNeverRetriesQrWrite:true,unknownFileAndReconciliationLockRetained:true});await f.context.close();
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
const html=resolve(dist,'admin/settings/group/index.html'),info=await stat(html),result={cases:reports.length,reports,pageErrors:errors,syntheticOnly:true,browserClosed:true,provenance:{dist,groupHtmlMtime:info.mtime.toISOString(),groupHtmlSha256:digest(await readFile(html)),assets:[...assets.values()].sort((left,right)=>left.path.localeCompare(right.path))}};
await writeFile(resolve(evidence,'settings-group-runtime-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
