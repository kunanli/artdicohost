// Real Chromium, all requests intercepted; only synthetic participant data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname} from 'node:path';
import {readSheet} from 'read-excel-file/node';
import {createRegistrationReviewStore} from '../../functions/registration-admin/store.mjs';
import {createRegistrationXlsxApi} from '../../functions/registration-admin/xlsx-handler.mjs';
import {createObjectJournal} from '../../functions/cloud-content/object-journal.mjs';
import {memoryObjects} from '../helpers/cloud-memory-objects.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),ID='A'.repeat(43),AT='2026-10-21T00:00:00.000Z';
const record={id:ID,referenceCode:ID,eventId:'ggj-cn-2026',submittedAt:AT,fields:{name:'合成报名者',organization:'合成机构',position:'合成职位',city:'深圳',email:'synthetic@example.invalid',wechat:'SYNTHETIC-WECHAT',categories:['industry'],participationInterests:['attend'],attendance:'expected',accommodationChoice:'not_needed',background:'合成原始回答'},provenance:{kind:'public'},consent:{accepted:true,version:'synthetic-notice-v1',acceptedAt:AT}};
const json=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)}),reports=[],errors=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function scenario(role,{unknownAck=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true}),page=await context.newPage(),downloads=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());page.on('download',download=>downloads.push(download));
  await context.addInitScript(()=>{window.privateExportEvidence={created:[],revoked:[]};const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);URL.createObjectURL=blob=>{const url=create(blob);window.privateExportEvidence.created.push(url);return url;};URL.revokeObjectURL=url=>{window.privateExportEvidence.revoked.push(url);return revoke(url);};});
  const user={id:'synthetic-staff',label:'合成工作人员',roles:[role]},objects=memoryObjects(),base=createObjectJournal({objects,prefix:'cms/v1/registration-reviews/ggj-cn-2026'});let writes=0;
  const journal={read:base.read,async commit(...args){writes++;const result=await base.commit(...args);if(unknownAck)throw new Error('SYNTHETIC_PRIVATE_ACK');return result;}};
  const store=createRegistrationReviewStore({journal,eventId:record.eventId,clock:()=>Date.parse(AT),loadRegistrations:async()=>({revision:1,registrations:[structuredClone(record)]})});let deliveryReads=0;
  const admission={revision:1,settings:{capacity:300,staffReserve:0,waitlistEnabled:true},summary:{capacity:300,staffReserve:0,waitlistEnabled:true,confirmedCount:1,attendeeConfirmedCount:1,crewConfirmedCount:0,waitlistCount:0,remainingPublic:299,remainingTotal:299},people:[{registrationId:ID,kind:'attendee',status:'confirmed',queueNumber:1,changedAt:AT,teamId:''}],teams:[],auditCount:1};
  const api=createRegistrationXlsxApi({enabled:true,auth:{authenticate:async()=>({user,csrfToken:'synthetic-csrf'})},store,loadAdmissions:async()=>admission,loadArrangements:async()=>({contactRevision:0,contentRevision:0,contacts:[],conversions:[],content:{sessions:[],booths:[]}})});
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;
    if(url.origin!=='https://api.artdico.host')return route.abort();
    if(path.startsWith('/api/')){
      if(path==='/api/admin/session')return route.fulfill(json({user,csrfToken:'synthetic-csrf'}));
      if(path==='/api/admin/registrations')return route.fulfill(json(await store.list()));
      if(path==='/api/admin/admissions')return route.fulfill(json(admission));
      if(path==='/api/admin/users')return route.fulfill(json({revision:0,users:[{...user,username:'synthetic.staff',active:true,protected:true}]}));
      if(path==='/api/admin/group-invite')return route.fulfill(json({revision:0,configured:false,expired:false,expiresAt:null}));
      if(path==='/api/admin/maintenance')return route.fulfill(json({enabled:false,backup:{available:false}}));
      if(path==='/api/admin/registration-confirmation/settings'){deliveryReads++;return route.fulfill(json({revision:0,automaticEnabled:false,email:{ready:false,missing:['EMAILJS_CONFIRMATION_TEMPLATE_ID']},wallet:{ready:false},counts:{total:0,providerAccepted:0,rejected:0,unknown:0}}));}
      if(path==='/api/admin/logout')return route.fulfill(json({loggedOut:true}));
      if(path==='/api/admin/registrations/export.xlsx'){
        const response=await api(new Request(req.url(),{method:req.method(),headers:req.headers(),body:req.postData()}));
        return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
      }
      return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'NOT_CONFIGURED'}})});
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto('https://api.artdico.host/admin/registrations/',{waitUntil:'networkidle'});await page.locator('[data-review-workspace]:visible').waitFor();
  const button=page.locator('[data-review-export-xlsx]');
  if(role==='reviewer'){
    assert.equal(await button.isDisabled(),true);assert.equal(await page.locator('[data-review-export-contact]').isDisabled(),true);assert.equal(writes,0);assert.equal(deliveryReads,0);assert.equal(await page.locator('[data-delivery-settings]').count(),0);reports.push({role,scopeControlsDisabled:true,deliverySettingsNotRead:true});
  }else if(unknownAck){
    await button.click();await page.locator('[data-review-error]:visible').waitFor();assert.equal(downloads.length,0);assert.equal(writes,1);assert.equal((await base.read()).value.audit.length,1);reports.push({role,unknownAcknowledgementNoDownload:true,noAutomaticRetry:true});
  }else{
    assert.equal(deliveryReads,0,'registration review does not read notification settings');assert.equal(await page.locator('[data-delivery-settings]').count(),0);
    await page.locator('[data-review-export-contact]').check();await page.locator('[data-review-export-answers]').check();await page.locator('[data-review-export-arrangements]').check();
    const waiting=page.waitForEvent('download');await button.click();const download=await waiting;
    const bytes=await readFile(await download.path()),rows=await readSheet(bytes,'报名与参会');assert.equal(download.suggestedFilename(),'artdico-registration-attendance.xlsx');assert.equal(rows[1][rows[0].indexOf('邮箱')],'synthetic@example.invalid');assert.equal((await base.read()).value.audit[0].metadata.answersIncluded,true);
    await page.locator('[data-review-status]').filter({hasText:'Excel 已生成'}).waitFor();await page.locator('[data-review-logout]').click();await page.locator('[data-review-login-panel]:visible').waitFor();
    const evidence=await page.evaluate(()=>window.privateExportEvidence);assert.ok(evidence.created.every(url=>evidence.revoked.includes(url)));assert.equal(await page.locator('[data-review-export-contact]').isChecked(),false);assert.equal(await page.locator('[data-delivery-settings]').count(),0);reports.push({role,realXlsxDownloaded:true,explicitScopesAudited:true,logoutRevokesPrivateUrls:true,settingsMovedOutOfReview:true});
  }
  await context.close();
}
try{await scenario('superadmin');await scenario('superadmin',{unknownAck:true});await scenario('reviewer');assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors},null,2));}finally{await browser.close();}
