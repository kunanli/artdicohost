// Real runtime and Chromium; every request is intercepted and all identities are synthetic.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as SITE,PEOPLE_FIXTURE_PASSWORD} from '../helpers/people-runtime-fixture.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),reports=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
async function fixture({width=1280,role='owner',lostAck=false,badAck=false}={}){
  const runtime=await peopleRuntimeFixture({mail:true}),auth=await runtime.login(role),context=await browser.newContext({viewport:{width,height:900}});
  const [name,...value]=auth.Cookie.split('=');await context.addCookies([{domain:new URL(SITE).hostname,path:'/api/admin',name,value:value.join('='),secure:true,httpOnly:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(10000);await page.clock.setFixedTime(new Date('2026-10-21T09:00:00.000Z'));
  const calls=[];let lose=lostAck,malform=badAck,expire=false;
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.equal(url.origin,SITE,'all requests remain intercepted');
    if(path.startsWith('/api/')){
      const headers=await req.allHeaders(),body=req.postData()?JSON.parse(req.postData()):null,entry={path,method:req.method(),body};calls.push(entry);
      if(expire&&path==='/api/admin/group-invite'){expire=false;return route.fulfill(json({},401));}
      const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers,...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));entry.status=response.status;
      if(path==='/api/admin/users'&&req.method()==='POST'&&response.ok){
        if(lose){lose=false;await response.arrayBuffer();return route.fulfill(json({error:{code:'SYNTHETIC_ACK_LOST'}},503));}
        if(malform){malform=false;const value=await response.json();value.users.at(-1).roles=['reviewer'];return route.fulfill(json(value));}
      }
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  async function api(path,{method='GET',body,headers=auth}={}){const response=await runtime.app.handle(runtime.request(path,{method,body,headers}));assert.equal(response.status,200);return response.json();}
  return{runtime,auth,context,page,calls,api,expire:()=>{expire=true;}};
}
const usersWrites=f=>f.calls.filter(row=>row.path==='/api/admin/users'&&row.method==='POST');
async function open(f,anchor=''){await f.page.goto(SITE+'/admin/settings/'+anchor,{waitUntil:'networkidle'});await f.page.locator('[data-settings-authorized]:visible').waitFor();}
async function prepare(f,name){await f.page.locator('[data-user-prefill="'+name+'"]').click();const form=f.page.locator('[data-user-form]');const password=await form.locator('[name=password]').inputValue();assert.equal(password.length,36);assert.equal(await form.locator('[name=roles]:checked').count(),4);assert.equal(await form.locator('[name=roles][value=superadmin]').isChecked(),false);return{form,password};}
async function create(f,name){const result=await prepare(f,name);await result.form.locator('button[type=submit]').click();await f.page.locator('[data-settings-status]').filter({hasText:'账号已保存'}).waitFor();return result.password;}
async function logIn(f,username,password){const form=f.page.locator('[data-settings-login]');await form.locator('[name=username]').fill(username);await form.locator('[name=password]').fill(password);await form.locator('button[type=submit]').click();await f.page.locator('[data-settings-authorized]:visible').waitFor();await f.page.waitForLoadState('networkidle');}
async function draftRecords(page){return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('artdico-browser-drafts-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const req=db.transaction('drafts').objectStore('drafts').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}});}
async function waitDraft(page,kind='users'){await page.locator('[data-settings-local-draft="'+kind+'"] p').filter({hasText:'已保存在本机'}).waitFor();}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
try{
  await mkdir(evidence,{recursive:true});
  for(const width of[320,390,1440]){
    const f=await fixture({width});await open(f,'#staff-accounts-title');await f.page.locator('[data-settings-accounts]:visible').waitFor();
    assert.equal(await f.page.locator('[data-settings-accounts-link]').isVisible(),true);assert.equal(await f.page.locator('[data-settings-recovery]').getAttribute('open'),null);
    assert.equal(await f.page.locator('[data-user-prefill]').count(),2);assert.equal(usersWrites(f).length,0);await noOverflow(f.page);
    if(width===390)await f.page.screenshot({path:resolve(evidence,'settings-collaborators-mobile.png'),fullPage:true});await f.context.close();reports.push({width,visibleAccountEntry:true,noCreationOnOpen:true,noPageOverflow:true});
  }
  {
    const f=await fixture();await open(f);const first=await create(f,'zhouyufei'),second=await create(f,'wangying');assert.ok(first!==second,'each account receives distinct random credentials');assert.equal(usersWrites(f).length,2);
    const directory=await f.api('/api/admin/users');for(const name of['zhouyufei','wangying']){const row=directory.users.find(user=>user.username===name);assert.deepEqual([...row.roles].sort(),['editor','outreach','publisher','reviewer']);assert.equal(row.active,true);assert.equal(row.protected,false);}
    assert.equal(await f.page.locator('[data-user-credential-list] input').count(),2);assert.equal(await f.page.locator('[data-user-form] [name=password]').inputValue(),'');
    const disk=JSON.stringify(await draftRecords(f.page));assert.equal(disk.includes(first)||disk.includes(second),false);assert.doesNotMatch(disk,/password|encryptionKey|dataBase64/u);
    // Actual auth checks use the newly created account, never a fabricated success mock.
    for(const[username,password]of[['zhouyufei',first],['wangying',second]]){const response=await f.runtime.app.handle(f.runtime.request('/api/admin/login',{method:'POST',body:{username,password}}));assert.equal(response.status,200);const auth=await response.json();assert.equal(auth.user.roles.includes('superadmin'),false);}
    await f.page.locator('[data-settings-logout]').click();await f.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal(await f.page.locator('[data-user-credential-list] input').count(),0);
    const checkpoint=f.calls.length;await logIn(f,'zhouyufei',first);const reads=f.calls.slice(checkpoint).filter(call=>call.method==='GET').map(call=>call.path);
    assert.ok(reads.includes('/api/admin/group-invite'));assert.ok(reads.includes('/api/admin/registration-confirmation/settings'));assert.equal(reads.some(path=>path==='/api/admin/users'||path.startsWith('/api/admin/maintenance')),false);
    for(const selector of['[data-settings-accounts]','[data-settings-recovery]','[data-settings-accounts-link]','[data-staff-admin-link]'])assert.equal(await f.page.locator(selector).isVisible(),false);
    await f.page.locator('[data-delivery-automatic] [name=enabled]').check();await f.page.locator('[data-delivery-automatic] button[type=submit]').click();await f.page.locator('[data-delivery-status]').filter({hasText:'设置已保存'}).waitFor();
    assert.equal(f.runtime.messages.length,0);await f.context.close();reports.push({twoActualAccountsCreated:true,distinctMemoryOnlyPasswords:true,fullCollaboratorLogin:true,settingsLoadNoAccountOrMaintenanceFetch:true,explicitSettingNoMail:true});
  }
  {
    const f=await fixture();await open(f);const{form,password}=await prepare(f,'zhouyufei');await form.locator('[name=label]').fill('合成本机账号填写');await waitDraft(f.page);
    const records=await draftRecords(f.page);assert.equal(JSON.stringify(records).includes(password),false);assert.doesNotMatch(JSON.stringify(records),/password|encryptionKey|dataBase64/u);
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-settings-local-draft=users] p').filter({hasText:'找到本机填写'}).waitFor();assert.equal(await form.locator('[name=password]').inputValue(),'');assert.equal(await form.locator('[name=username]').inputValue(),'');assert.equal(usersWrites(f).length,0);
    await f.page.locator('[data-settings-local-draft=users]').getByRole('button',{name:'恢复本机填写'}).click();assert.equal(await form.locator('[name=username]').inputValue(),'zhouyufei');assert.equal(await form.locator('[name=label]').inputValue(),'合成本机账号填写');assert.equal(await form.locator('[name=password]').inputValue(),'');assert.equal(usersWrites(f).length,0);
    await f.page.locator('[data-settings-logout]').click();await f.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal((await draftRecords(f.page)).filter(row=>row.scope.actorId===f.runtime.users[0].id).length,0);
    await f.context.close();reports.push({refreshOffersExplicitNonsecretRestore:true,noPasswordInIndexedDB:true,restoreNeverCreatesAccount:true,logoutErasesActorDrafts:true});
  }
  for(const mode of['lost','malformed']){
    const f=await fixture({lostAck:mode==='lost',badAck:mode==='malformed'});await open(f);const{form}=await prepare(f,'zhouyufei');await form.locator('button[type=submit]').click();await f.page.locator('[data-user-unknown]:visible').waitFor();
    assert.equal(usersWrites(f).length,1);assert.equal(await f.page.locator('[data-user-credentials]').isVisible(),false);assert.equal(await form.locator('[name=password]').inputValue(),'');
    await f.page.locator('[data-users-refresh]').click();await f.page.locator('[data-settings-error]').filter({hasText:'不能确认'}).waitFor();assert.equal(await form.locator('button[type=submit]').isDisabled(),true);assert.equal(usersWrites(f).length,1);
    await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-settings-local-draft=users] p').filter({hasText:'结果待核对'}).waitFor();assert.equal(await form.locator('button[type=submit]').isDisabled(),true);assert.equal(usersWrites(f).length,1);assert.equal(await form.locator('[name=password]').inputValue(),'');
    await f.page.locator('[data-settings-local-draft=users]').getByRole('button',{name:'已手动核对，解除本机锁定'}).click();await form.locator('button[type=submit]:enabled').waitFor();assert.equal(usersWrites(f).length,1);assert.equal((await f.api('/api/admin/users')).users.filter(row=>row.username==='zhouyufei').length,1);
    await f.context.close();reports.push({mode,actualCommittedUnknownNeverClaimsCreated:true,directoryReadDoesNotProvePassword:true,pendingSurvivesRefreshNoResend:true,explicitManualUnlockOnly:true});
  }
  {
    const f=await fixture();await open(f);await create(f,'zhouyufei');const form=f.page.locator('[data-user-form]');await form.locator('[name=username]').fill('synthetic-draft-after-create');await form.locator('[name=label]').fill('PRIVATE-SYNTHETIC-DRAFT');await waitDraft(f.page);
    f.expire();await f.page.locator('[data-group-refresh]').click();await f.page.locator('[data-settings-login-panel]:visible').waitFor();assert.equal(await f.page.locator('[data-user-credential-list] input').count(),0);assert.equal(await form.locator('[name=password]').inputValue(),'');assert.doesNotMatch(await f.page.locator('body').textContent(),/PRIVATE-SYNTHETIC-DRAFT/u);assert.equal(await f.page.locator('[data-settings-login] button').isEnabled(),true);
    await logIn(f,'owner',PEOPLE_FIXTURE_PASSWORD);await f.page.locator('[data-settings-local-draft=users] p').filter({hasText:'找到本机填写'}).waitFor();await f.page.locator('[data-settings-local-draft=users]').getByRole('button',{name:'恢复本机填写'}).click();assert.equal(await form.locator('[name=label]').inputValue(),'PRIVATE-SYNTHETIC-DRAFT');
    await f.context.close();reports.push({authExpiryClearsAllPrivateDOMAndSecrets:true,loginRemainsEnabled:true,freshSameActorCanRestoreNonsecretDraft:true});
  }
  {
    const f=await fixture({role:'reviewer'});await f.page.goto(SITE+'/admin/settings/',{waitUntil:'networkidle'});await f.page.locator('[data-settings-access-denied]:visible').waitFor();assert.deepEqual(f.calls.map(row=>row.path),['/api/admin/session']);await f.context.close();reports.push({partialRoleNoSettingsOrAccountReads:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({cases:reports.length,reports,pageErrors:errors},null,2));
}finally{await browser.close();}
