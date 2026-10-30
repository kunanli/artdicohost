// Actual application over memory OSS; every HTTP request is intercepted. No real mail or people.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist'),evidence=resolve(project,'.local-data/browser-evidence');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture(width,username='owner',loseManualAck=false){
 const f=await peopleRuntimeFixture({mail:true}),contact=(await f.createContact({name:'合成讲者甲'})).contact,other=(await f.createContact({name:'合成邀约乙'})).contact;
 const snapshot=await f.app.store.read(),content=structuredClone(snapshot.draft.content);
 content.organizations=[{id:'synthetic-exhibitor',name:'合成参展公司',logoId:'',website:'',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:'PRIVATE_COMPANY_NOTE'}];
 content.guests=[{id:'synthetic-speaker',contactId:contact.id,name:contact.profile.name,company:'合成单位',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,internalNotes:'PRIVATE_PROFILE_NOTE',publicRoles:['speaker','guest']}];
 content.booths=[{id:'synthetic-booth',code:'C-01',slotNumber:1,organization:'原展位文字',organizationId:'synthetic-exhibitor',project:'合成项目',zone:'C',status:'confirmed',internalNotes:''},
 {id:'synthetic-legacy',code:'C-02',slotNumber:2,organization:'合成旧团队文字',project:'合成旧项目',zone:'C',status:'pending',internalNotes:''}];
 await f.app.store.save(snapshot.draft.revision,content,f.users[0].id);
 await f.app.contactsStore.saveOperations(contact.id,2,{...contact.operations,responseStatus:width===320?'pending':'attending',organizationMemberships:[{organizationId:'synthetic-exhibitor',role:'lead',title:'合成联络人'}]},f.users[0].id);
 const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:3,permissionReference:'合成历史本人授权确认'});
 const pending=await f.seedPublic({name:'合成申请丙'});assert.equal(f.messages.length,0);
 const headers=await f.login(username),context=await browser.newContext({viewport:{width,height:980}}),page=await context.newPage();page.setDefaultTimeout(12000);
 const [name,...value]=headers.Cookie.split('=');await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
 const requests=[];let dropped=false;page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());assert.equal(url.origin,SITE,'no unmocked outbound request');
  if(url.pathname.startsWith('/api/')){requests.push({path:url.pathname,method:request.method(),body:request.postData()});
   const response=await f.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:request.postData()})}));
   if(loseManualAck&&url.pathname.includes('/registration-confirmation/send/')&&!dropped){dropped=true;return route.abort('failed');}
   return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});}
  const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
  return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',webp:'image/webp',svg:'image/svg+xml'})[extname(file).slice(1)]||'application/octet-stream'});
 });
 return{...f,context,page,contact,other,registrationId:converted.registrations[0].registrationId,pending,requests};
}
async function ready(f){await f.page.goto(SITE+'/admin/contacts/');await f.page.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
try{
 await mkdir(evidence,{recursive:true});
 for(const width of [320,390,1440]){
  const f=await fixture(width);await ready(f);const p=f.page;
  assert.equal(await p.locator('[data-directory-rows] tr').count(),3,'linked contact is shown only once alongside the public applicant');
  assert.equal(await p.locator('[data-contacts-legacy-tools]').getAttribute('open'),null);assert.equal(await p.locator('[data-contacts-rows] tr').count(),0,'legacy action grid stays unrendered while collapsed');
  assert.match(await p.locator('[data-directory-metrics]').textContent(),/名单记录3.*已确认名额1.*待审核申请1/u);await noOverflow(p);
  await p.screenshot({path:evidence+'/unified-people-'+width+'.png',fullPage:true});
  await p.locator('[data-people-view=speakers]').click();await p.locator('[data-directory-title]').filter({hasText:'讲者名单'}).waitFor();assert.equal(await p.locator('[data-directory-rows] tr').count(),1);
  await p.locator('[data-people-view=guests]').click();await p.locator('[data-directory-title]').filter({hasText:'嘉宾名单'}).waitFor();assert.equal(await p.locator('[data-directory-rows] tr').count(),1);
  await p.locator('[data-people-view=exhibitors]').click();await p.locator('[data-directory-title]').filter({hasText:'参展商名单'}).waitFor();assert.equal(await p.locator('[data-directory-rows] tr').count(),2);
  assert.match(await p.locator('[data-directory-rows]').textContent(),/合成参展公司.*合成讲者甲.*C-01/u);assert.match(await p.locator('[data-directory-rows]').textContent(),/合成旧团队文字.*组织关系待关联/u);await noOverflow(p);
  await p.screenshot({path:evidence+'/unified-exhibitors-'+width+'.png',fullPage:true});
  await p.locator('[data-people-view=speakers]').click();await p.locator('[data-directory-title]').filter({hasText:'讲者名单'}).waitFor();await p.locator('[data-directory-rows]').getByRole('button',{name:'查看与管理'}).click();
  await p.locator('[data-contact-dialog][open]').waitFor();await p.locator('[data-person-confirmation-status]').filter({hasText:'可以寄送'}).waitFor().catch(async error=>{console.log(JSON.stringify({status:await p.locator('[data-person-confirmation-status]').textContent(),hidden:await p.locator('[data-person-confirmation]').isHidden(),requests:f.requests.slice(-8),errors}));throw error;});
  assert.equal(await p.locator('[data-contact-profile] details').first().getAttribute('open'),null);await noOverflow(p);
  if(width===320){await p.locator('[data-contact-form] [name=responseStatus]').selectOption('attending');await p.locator('[data-contact-save]').click();await p.locator('[data-person-confirmation-status]').filter({hasText:'服务商已接受'}).waitFor();assert.equal(f.messages.length,1);assert.doesNotMatch(await p.locator('[data-contacts-status]').textContent(),/没有发送/u);}
  if(width===390){await p.locator('[data-person-confirmation-send]').click();await p.locator('[data-person-confirmation-status]').filter({hasText:'服务商已接受'}).waitFor();assert.equal(f.messages.length,1);
   assert.match(f.messages[0].template_params.invitation_text,/Apple Wallet/u);assert.equal(await p.locator('[data-person-confirmation-send]').isDisabled(),true);
   await p.screenshot({path:evidence+'/unified-person-confirmation-mobile.png',fullPage:true});
  }
  await p.locator('[data-contact-close]').first().click();await p.locator('[data-contacts-refresh]').click();await p.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();assert.equal(f.messages.length,width===320||width===390?1:0);
  assert.equal(f.requests.some(row=>/publish|approve/u.test(row.path)),false);await f.context.close();reports.push({width,unifiedRows:true,multiRoleViews:true,companyRoster:true,collapsedSource:true,noOverflow:true,explicitMailOnly:true});
 }
 const recovery=await fixture(390,'owner',true);await ready(recovery);await recovery.page.locator('[data-people-view=speakers]').click();await recovery.page.locator('[data-directory-title]').filter({hasText:'讲者名单'}).waitFor();await recovery.page.locator('[data-directory-rows]').getByRole('button',{name:'查看与管理'}).click();await recovery.page.locator('[data-person-confirmation-status]').filter({hasText:'可以寄送'}).waitFor();await recovery.page.locator('[data-person-confirmation-send]').click();await recovery.page.locator('[data-person-confirmation-status]').filter({hasText:'结果待核对'}).waitFor();assert.equal(recovery.messages.length,1);await recovery.page.locator('[data-person-confirmation-check]').click();await recovery.page.locator('[data-person-confirmation-status]').filter({hasText:'服务商已接受'}).waitFor();const attempts=recovery.requests.filter(row=>row.path.includes('/registration-confirmation/send/'));assert.equal(attempts.length,2);assert.equal(attempts[0].body,attempts[1].body);assert.equal(recovery.messages.length,1);await recovery.context.close();reports.push({lostManualAckReplaysSameOperation:true,oneMailAfterExplicitVerification:true});
 const conflict=await fixture(390);const roster=await conflict.app.contactsStore.read(),savedContact=roster.contacts.find(item=>item.id===conflict.contact.id);await conflict.app.contactsStore.saveOperations(savedContact.id,roster.revision,{...savedContact.operations,responseStatus:'declined'},conflict.users[0].id);await ready(conflict);await conflict.page.getByText('本人不出席，原名额仍在；请核对撤回。').waitFor();assert.equal(await conflict.page.getByRole('link',{name:'核对原名额'}).getAttribute('href'),'/admin/registrations/#registration='+conflict.registrationId);assert.equal(conflict.messages.length,0);await noOverflow(conflict.page);await conflict.context.close();reports.push({declinedConfirmedConflictVisible:true,noAutomaticWithdrawalOrMail:true});
 const reviewer=await fixture(390,'reviewer');await ready(reviewer);assert.equal(await reviewer.page.locator('[data-directory-rows] tr').count(),2);
 assert.equal(await reviewer.page.locator('[data-contacts-legacy-tools]').isVisible(),false);assert.equal(await reviewer.page.locator('[data-people-view=exhibitors]').isVisible(),false);
 assert.equal(reviewer.requests.some(row=>row.path==='/api/admin/contacts'||row.path==='/api/admin/intent-invitations'||row.path==='/api/admin/people/relationships'),false);
 assert.doesNotMatch(await reviewer.page.locator('[data-directory-rows]').textContent(),/合成邀约乙/u);await noOverflow(reviewer.page);await reviewer.context.close();reports.push({reviewerSourceIsolation:true});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,reports}));
}finally{await browser.close();}
