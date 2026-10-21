// Real Chromium with intercepted synthetic receipts, including a real disposable signed pass.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createWalletFixture,passFiles} from '../apple-wallet-fixture.mjs';
import {validateSigningIdentity,buildAppleWalletPass} from '../../functions/apple-wallet/pkpass.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist'),evidence=resolve(project,'.local-data/browser-evidence');
await mkdir(evidence,{recursive:true});
const API='https://api.artdico.host',SITE='https://artdico.host',token='v1.'+'x'.repeat(100)+'.'+'y'.repeat(43),secondToken='v1.'+'b'.repeat(100)+'.'+'c'.repeat(43),id='r'.repeat(43);
const link=SITE+'/registration/confirmation/#r='+token,errors=[],reports=[];
const fixture=await createWalletFixture(),identity=validateSigningIdentity(fixture.fields);
const event={id:'synthetic-event',title:'合成验收活动',date:'2026-12-05',time:'10:00–18:00',venue:'合成场地',timezone:'Asia/Shanghai',checkIn:'09:30'};
const pass=buildAppleWalletPass({identity,attendee:{registrationId:id,referenceCode:id,admissionStatus:'confirmed',name:'合成报名人',event},organizationName:'合成活动团队',verificationUrl:API+'/api/admin/registration/wallet/verify/synthetic.ticket.signature',now:fixture.now});
const response=status=>({event,referenceCode:id,submittedAt:'2026-10-21T00:00:00Z',admission:{status,kind:'attendee',revision:2},attendee:{name:'合成报名人',organization:'合成机构'},email:{status:'not_configured'},wallet:{ready:false},groupInvite:null});
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':SITE}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function serve(route,url){
  const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
  try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
}
async function scenario(mode){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),calls=[];
  await context.addCookies([{name:'synthetic_staff',value:'PRIVATE-STAFF-COOKIE',domain:'api.artdico.host',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  page.on('pageerror',error=>errors.push(mode+':'+error.message));let readCount=0,hold=null;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===SITE)return serve(route,url);
    if(url.origin!==API)return route.abort();
    assert.equal(request.headers().cookie,undefined);if(url.pathname.endsWith('/confirmation')||url.pathname.endsWith('/wallet'))assert.equal(request.headers().referer,undefined,'confirmation capabilities must not leak through Referer');
    calls.push({path:url.pathname,method:request.method(),body:request.postData()});
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':SITE,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Idempotency-Key,X-Registration-Token'}});
    if(url.pathname.endsWith('/confirmation')){
      const received=JSON.parse(request.postData()).receiptToken;readCount++;
      if(mode==='invalid')return route.fulfill(json({error:{code:'CONFIRMATION_NOT_FOUND'}},404));
      if(mode==='refresh-revoked'&&readCount>1)return route.fulfill(json({error:{code:'CONFIRMATION_NOT_FOUND'}},404));
      const value=response(mode==='waitlisted'||mode==='withdrawn'?mode:'confirmed');
      if(mode==='hash-switch'&&received===token){hold=()=>route.fulfill(json({...value,attendee:{name:'PRIVATE-OLD-PERSON',organization:'旧机构'}}));return;}
      if(received===secondToken)value.attendee.name='合成报名人乙';
      if(mode==='wallet')value.wallet.ready=true;
      if(mode==='waitlisted'){value.wallet.ready=true;value.groupInvite={platform:'wechat',qrImageUrl:API+'/api/admin/registration/group-invite/synthetic.token',expiresAt:'2026-12-05T00:00:00Z'};}
      return route.fulfill(json(value));
    }
    if(url.pathname.endsWith('/wallet'))return route.fulfill({status:200,body:pass,contentType:'application/vnd.apple.pkpass',headers:{'access-control-allow-origin':SITE}});
    if(url.pathname.includes('/group-invite/'))return route.fulfill({status:200,body:png,contentType:'image/png',headers:{'access-control-allow-origin':SITE}});
    if(url.pathname.endsWith('/config'))return route.fulfill(json({enabled:true,eventId:'synthetic-event',opensAt:'2026-01-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',capacity:300,privacy:{version:'approved-synthetic-v1',processor:'合成处理者',contactEmail:'privacy@example.invalid',purpose:'合成验收',storageRegion:'合成地区',retention:'合成保留规则',rightsRequest:'联系合成团队更正',sharing:'不分享'}}));
    if(url.pathname.endsWith('/token'))return route.fulfill(json({eventId:'synthetic-event',submissionToken:'synthetic.payload.signature',expiresAt:new Date(Date.now()+300000).toISOString()}));
    if(url.pathname.endsWith('/submit'))return route.fulfill(json({status:'registered',admissionStatus:'confirmed',admissionKind:'attendee',admissionRevision:2,reference_code:id,groupInvite:null,confirmation:{receiptToken:token,confirmationUrl:link,expiresAt:'2027-03-05T00:00:00Z',email:{status:'not_configured'}}},201));
    return route.fulfill(json({error:{code:'NOT_FOUND'}},404));
  });
  if(mode==='redirect'){
    await page.goto(SITE+'/',{waitUntil:'networkidle'});
    await page.locator('[data-registration-preview]>summary').click();const form=page.locator('[data-registration-form]');
    await form.locator('[name=categories][value=other]').check();await page.locator('[data-form-step="0"] [data-next-step]').click();
    for(const[name,value]of Object.entries({name:'合成报名人',city:'合成城市',email:'synthetic@example.invalid'}))await form.locator('[name='+name+']').fill(value);
    await page.locator('[data-form-step="1"] [data-next-step]').click();await form.locator('[name=participationInterests][value=attend]').check();
    for(const[name,value]of Object.entries({attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'}))await form.locator('[name='+name+']').selectOption(value);
    await form.locator('[name=consentAccepted]').check();await form.locator('[data-submit]').click();await page.waitForURL(link);
  }else await page.goto(link,{waitUntil:mode==='hash-switch'?'domcontentloaded':'networkidle'});
  if(mode==='hash-switch'){
    await page.waitForFunction(()=>document.querySelector('[data-confirmation-page]'));
    for(let attempt=0;attempt<100&&!hold;attempt++)await new Promise(resolve=>setTimeout(resolve,20));assert.ok(hold);
    await page.evaluate(value=>location.hash='#r='+value,secondToken);
    await page.locator('[data-confirmation-name]').filter({hasText:'合成报名人乙'}).waitFor();await hold();await page.waitForTimeout(30);
    assert.equal(await page.locator('[data-confirmation-name]').textContent(),'合成报名人乙');assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE-OLD-PERSON/u);
    await page.evaluate(()=>location.hash='#r=invalid');await page.locator('[data-confirmation-error]:visible').waitFor();assert.equal(await page.locator('[data-confirmation-name]').textContent(),'');
  }else if(mode==='invalid'){
    await page.locator('[data-confirmation-error]:visible').waitFor();assert.equal(await page.locator('[data-confirmation-content]').isVisible(),false);
  }else{
    await page.locator('[data-confirmation-content]:visible').waitFor();
    if(mode==='waitlisted'){assert.match(await page.locator('h1').textContent(),/候补/u);assert.equal(await page.locator('[data-confirmation-wallet]').isVisible(),false);assert.equal(calls.some(call=>call.path.includes('/group-invite/')),false);}
    if(mode==='withdrawn'){assert.match(await page.locator('h1').textContent(),/取消/u);assert.equal(await page.locator('[data-confirmation-name]').textContent(),'');}
    if(mode==='refresh-revoked'){await page.locator('[data-confirmation-refresh]').click();await page.locator('[data-confirmation-error]:visible').waitFor();assert.equal(await page.locator('[data-confirmation-name]').textContent(),'');}
    if(mode==='wallet'){
      const downloadPromise=page.waitForEvent('download');await page.locator('[data-confirmation-wallet]').click();const download=await downloadPromise;
      const saved=await readFile(await download.path());assert.ok(passFiles(saved).has('signature'));assert.equal(saved.equals(pass),true);
    }
    if(mode==='confirmed'){
      assert.match(await page.locator('[data-confirmation-email]').textContent(),/暂未启用/u);assert.equal(await page.locator('[data-confirmation-wallet]').isVisible(),false);
      await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));assert.equal(new URL(page.url()).hash,'');
      await page.emulateMedia({media:'print'});assert.equal(await page.locator('[data-confirmation-copy]').isVisible(),false);assert.equal(await page.locator('.confirmation-printed').isVisible(),true);
      const pdf=await page.pdf({path:evidence+'/confirmation-print.pdf',format:'A4'});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
      await page.evaluate(()=>dispatchEvent(new Event('afterprint')));assert.equal(page.url(),link);await page.emulateMedia({media:'screen'});
      await page.screenshot({path:evidence+'/confirmation-mobile.png',fullPage:true});
    }
  }
  assert.equal(calls.some(call=>/dispatch|manual-sent|invitation/u.test(call.path)),false);
  if(mode==='redirect')assert.equal(calls.filter(call=>call.path.endsWith('/submit')).length,1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  reports.push({mode,passed:true,publicCookieOmitted:true,requests:calls.map(call=>call.path)});await context.close();
}
try{for(const mode of ['redirect','confirmed','waitlisted','withdrawn','invalid','refresh-revoked','wallet','hash-switch'])await scenario(mode);assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));}
finally{await browser.close();await fixture.cleanup();}
