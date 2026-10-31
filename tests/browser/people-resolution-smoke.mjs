// Actual runtime, synthetic identities, memory OSS; all requests intercepted.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const dist=fileURLToPath(new URL('../../dist/',import.meta.url)),evidence=fileURLToPath(new URL('../../.local-data/browser-evidence/',import.meta.url)),aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES);
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']}),errors=[],reports=[];
async function fixture(width){
 const f=await peopleRuntimeFixture({capacity:4,mail:true}),a=(await f.createContact({name:'合成重复甲',email:'duplicate@example.invalid'})).contact,b=(await f.createContact({name:'合成重复乙',email:'duplicate@example.invalid'})).contact,c=(await f.createContact({name:'合成网站同一人',email:'public.same@example.invalid'})).contact,d=(await f.createContact({name:'合成待整合'})).contact;
 await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[a.id,b.id],expectedContactRevision:4,permissionReference:'合成人员确认'});
 const pub=await f.seedPublic({name:c.profile.name,email:c.profile.email}),headers=await f.login(),context=await browser.newContext({viewport:{width,height:980}}),page=await context.newPage();page.setDefaultTimeout(15000);
 const [name,...value]=headers.Cookie.split('=');await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
 let dropped=false;const writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,SITE);
  if(url.pathname.startsWith('/api/')){const payload=request.postData();if(url.pathname.endsWith('/people/resolve')&&payload&&JSON.parse(payload).action!=='preview')writes.push(payload);
   const response=await f.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:payload})}));
   if(width===390&&!dropped&&url.pathname.endsWith('/people/resolve')&&payload&&JSON.parse(payload).action==='merge'){dropped=true;return route.abort('failed');}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist));return route.fulfill({body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2',webp:'image/webp'})[extname(file).slice(1)]||'application/octet-stream'});
 });return{...f,page,context,a,b,c,d,pub,writes};
}
const rows=p=>p.locator('[data-directory-rows] tr');
async function noOverflow(p){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await p.locator('[data-resolution-dialog]').evaluate(d=>d.scrollWidth<=d.clientWidth+1),true);}
async function merger(f,text,primaryKey){const p=f.page;await p.locator('[data-resolution-candidates] article').filter({hasText:text}).getByRole('button').click();await p.locator('[data-resolution-status]').filter({hasText:'请逐项核对'}).waitFor();if(primaryKey)await p.locator('[name=primaryKey][value="'+primaryKey+'"]').check();await p.locator('[name=confirmSamePerson]').check();await noOverflow(p);const attemptsBefore=f.writes.length;await p.locator('[data-resolution-save]').click();if(attemptsBefore===0&&f.page.viewportSize().width===390){await p.locator('[data-resolution-reload]').filter({hasText:'核对原整合操作'}).click();}await p.locator('[data-resolution-dialog]').waitFor({state:'hidden'});}
try{
 await mkdir(evidence,{recursive:true});
 for(const width of [320,390,1440]){
  const f=await fixture(width),p=f.page;await p.goto(SITE+'/admin/contacts/');await p.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();assert.equal(await rows(p).count(),5);assert.equal(f.messages.length,0);
  await p.locator('[data-people-resolution] summary').click();await p.locator('[data-resolution-scan]').click();await p.locator('[data-resolution-scan-status]').filter({hasText:'发现'}).waitFor();assert.equal((await f.app.contactsStore.read()).contacts.length,4);
  await merger(f,'合成重复甲','contact:'+f.a.id);await p.waitForFunction(()=>document.querySelectorAll('[data-directory-rows] tr').length===4);assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,1);assert.equal(f.messages.length,0);
  if(width===390){assert.equal(f.writes[0],f.writes[1],'lost ACK reuses exact body and operation');}
  await merger(f,'合成网站同一人');await p.waitForFunction(()=>document.querySelectorAll('[data-directory-rows] tr').length===3);assert.equal((await f.app.registrationService.getAdmissionStatus(f.pub.reference_code)).status,'pending_review');
  const canonical=rows(p).filter({hasText:'合成重复甲'});await canonical.getByRole('button',{name:'身份／报名'}).click();await p.locator('[data-resolution-status]').filter({hasText:'身份分流不等于'}).waitFor();await p.locator('[name=roles][value=attendee]').uncheck();await p.locator('[name=roles][value=speaker]').check();await p.locator('[name=roles][value=guest]').check();await p.locator('[data-resolution-save]').click();await p.locator('[data-resolution-status]').filter({hasText:'身份已保存'}).waitFor();await noOverflow(p);await p.screenshot({path:evidence+'person-resolution-'+width+'.png'});await p.locator('[data-resolution-close]').click();
  for(const view of ['speakers','guests']){await p.locator('[data-people-view='+view+']').click();await p.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();assert.equal(await rows(p).count(),1);assert.match(await rows(p).textContent(),/合成重复甲/u);}
  await p.locator('[data-people-view=unassigned]').click();await p.locator('[data-directory-title]').filter({hasText:'待分流'}).waitFor();assert.equal(await rows(p).count(),1);
  await rows(p).getByRole('button',{name:'身份／报名'}).click();await p.locator('[data-resolution-status]').filter({hasText:'身份分流不等于'}).waitFor();await p.locator('[name=roles][value=attendee]').check();await p.locator('[data-resolution-save]').click();await p.locator('[data-resolution-status]').filter({hasText:'身份已保存'}).waitFor();await p.locator('[data-resolution-integrate]').click();await p.locator('[data-resolution-registration-status]').filter({hasText:'已确认名额'}).waitFor();assert.equal(f.messages.length,1);assert.match(f.messages[0].template_params.invitation_text,/Apple Wallet/u);await noOverflow(p);await p.locator('[data-resolution-close]').click();
  await p.locator('[data-people-view=attendees]').click();await p.locator('[data-directory-title]').filter({hasText:'一般参会者'}).waitFor();assert.equal(await rows(p).count(),2);
  await rows(p).filter({hasText:'合成待整合'}).getByRole('button',{name:'身份／报名'}).click();await p.locator('[data-resolution-status]').filter({hasText:'身份分流不等于'}).waitFor();await p.locator('[data-contacts-logout]').evaluate(button=>button.click());await p.locator('[data-resolution-dialog]').waitFor({state:'hidden'});assert.equal(await p.locator('[data-resolution-source-list]').textContent(),'');assert.equal(await p.locator('[data-resolution-candidates]').textContent(),'');
  reports.push({width,explicitMerge:true,singleSeat:true,publicPendingPreserved:true,multiRoleViews:true,generalParticipants:true,oneConfirmationMail:true,noOverflow:true,logoutClearsPrivateSources:true,...(width===390?{lostAckSameOperation:true}:{})});await f.context.close();
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,reports}));
}finally{await browser.close();}
