// Optional real-browser smoke using only intercepted synthetic staff API fixtures.
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
import {readFile,mkdir} from 'node:fs/promises';import {resolve,extname} from 'node:path';import assert from 'node:assert/strict';
import {createInitialContent} from '../../src/config/content.mjs';
import {buildArrangementOverview} from '../../shared/arrangement-overview.mjs';
import {toPublicContent} from '../../shared/content-schema.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),evidence=resolve(project,'.local-data/browser-evidence');await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
const staff={id:'synthetic-owner',label:'合成工作人员',roles:['editor','publisher','outreach','reviewer','superadmin']};
let reviewRevision=0,usersRevision=0,groupRevision=0,contentRevision=0,content=createInitialContent(),published=null;
let review={status:'new',accommodationStatus:'requested',recommendation:'',proposedRole:'',internalNotes:'',assignedTo:'',lastContactDate:'',nextStep:'',mariaReviewDate:'',mariaFeedback:'',mariaDecision:'',invitationStatus:'not_sent',deletionRequested:null};
const record={id:'synthetic-record',eventId:'synthetic-event',referenceCode:'r'.repeat(43),submittedAt:'2026-10-20T16:00:00Z',fields:{name:'合成报名人',organization:'合成团队',city:'合成城市',categories:['other'],accommodationChoice:'needed'},provenance:{kind:'public'},consent:{accepted:true,version:'approved-synthetic-v1',acceptedAt:'2026-10-20T16:00:00Z'}};
let users=[{...staff,username:'synthetic.owner',active:true,protected:true}],group={revision:0,configured:false,expired:false,expiresAt:null};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
const json=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)});
await context.route('**/*',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 if(url.origin!=='https://api.artdico.host')return route.abort();
 if(path.startsWith('/api/')){
  const body=req.postData()?JSON.parse(req.postData()):null;if(req.method()!=='GET')writes.push({path,body});
  if(path==='/api/admin/session')return route.fulfill(json({user:staff,csrfToken:'s'.repeat(43)}));
  if(path==='/api/admin/registrations'&&req.method()==='GET')return route.fulfill(json({registrations:[{...record,review}],total:1,overallTotal:1,nextCursor:null,stats:{byStatus:{[review.status]:1},byAccommodation:{[review.accommodationStatus]:1}},revision:reviewRevision}));
  if(path==='/api/admin/registrations/synthetic-record')return route.fulfill(json({registration:{...record,review},review,revision:reviewRevision}));
  if(path==='/api/admin/registrations/synthetic-record/review'){assert.equal(body.expectedRevision,reviewRevision);review=body.review;reviewRevision++;return route.fulfill(json({review,revision:reviewRevision}));}
  if(path==='/api/admin/users'){if(req.method()==='POST'){assert.equal(body.expectedRevision,usersRevision);assert.ok(!Object.hasOwn(body,'email'));usersRevision++;users.push({id:'synthetic-new-user',username:body.username,label:body.label,roles:body.roles,active:body.active,protected:false});}return route.fulfill(json({revision:usersRevision,users}));}
  if(path==='/api/admin/group-invite'){if(req.method()==='POST'){assert.equal(body.expectedRevision,groupRevision);groupRevision++;group={revision:groupRevision,configured:true,expired:false,expiresAt:new Date(body.expiresAt).toISOString()};}return route.fulfill(json(group));}
  if(path==='/api/admin/group-invite/image')return route.fulfill({status:200,contentType:'image/png',body:png});
  if(path==='/api/admin/registration-confirmation/settings')return route.fulfill(json({revision:0,automaticEnabled:false,email:{ready:false,missing:['EMAILJS_CONFIRMATION_TEMPLATE_ID']},wallet:{ready:false},counts:{total:0,providerAccepted:0,rejected:0,unknown:0}}));
  if(path==='/api/admin/intent-invitations')return route.fulfill(json({revision:0,conversions:[],invitations:[],email:{ready:false,reason:'EMAIL_NOT_READY'}}));
  if(path==='/api/admin/maintenance')return route.fulfill(json({enabled:true,backup:{available:true,maxEncryptedBytes:1500000},restore:{isolatedOnly:true},sessionsRestored:false}));
  if(path==='/api/admin/maintenance/backup'){assert.match(body.encryptionKey,/^[A-Za-z0-9_-]{43}$/u);return route.fulfill({status:200,contentType:'application/octet-stream',body:Buffer.from('SYNTHETIC-ENCRYPTED-FIXTURE'),headers:{'x-backup-sha256':'a'.repeat(64)}});}
  if(path==='/api/admin/content'){if(req.method()==='PUT'){assert.equal(body.expectedRevision,contentRevision);content=body.content;contentRevision++;}return route.fulfill(json({draft:{revision:contentRevision,content},published}));}
  if(path==='/api/admin/content/publish'){published={publishedAt:new Date().toISOString(),content:toPublicContent(content)};return route.fulfill(json({published}));}
  if(path==='/api/admin/arrangements')return route.fulfill(json(buildArrangementOverview({content,contacts:[],contentRevision,contactsRevision:0})));
  return route.fulfill({status:404,contentType:'application/json',body:'{}'});
 }
 let pathname=path.endsWith('/')?path+'index.html':path;try{const file=resolve(dist,'.'+pathname);assert.ok(file.startsWith(dist+'/'));await route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}
});
try{
 await page.goto('https://api.artdico.host/admin/registrations/',{waitUntil:'networkidle'});
 await page.locator('[data-review-rows] button').click();
 await page.locator('[data-review-form] [name=status]').selectOption('approved');await page.locator('[data-review-form] [name=accommodationStatus]').selectOption('pending');await page.locator('[data-review-form] [name=internalNotes]').fill('合成核查备注');await page.locator('[data-review-save]').click();
 await page.locator('[data-review-status]').filter({hasText:'已保存'}).waitFor();assert.equal(review.status,'approved');assert.equal(review.accommodationStatus,'pending');
 await page.locator('[data-review-detail-close]').first().click();
 await page.goto('https://api.artdico.host/admin/settings/',{waitUntil:'networkidle'});await page.locator('[data-settings-workspace]:visible').waitFor();
 await page.locator('.settings-workspace-tools > summary').click();
 const form=page.locator('[data-user-form]');await form.locator('[name=username]').fill('synthetic.reviewer');await form.locator('[name=label]').fill('合成审核人员');await form.locator('[name=password]').fill('synthetic-password-123');await form.locator('[name=roles][value=reviewer]').check();await form.locator('button[type=submit]').click();
 await page.locator('[data-settings-status]').filter({hasText:'账号已保存'}).waitFor();assert.equal(await form.locator('[name=password]').inputValue(),'');
 const qr=page.locator('[data-group-form]');await qr.locator('[name=image]').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:png});await qr.locator('[name=expiresAt]').fill(new Date(Date.now()+32*3600000).toISOString().slice(0,16));await qr.locator('button[type=submit]').click();await page.locator('[data-settings-status]').filter({hasText:'入群图片已更新'}).waitFor();
 await page.locator('[data-backup-create]').click();await page.locator('[data-backup-result]:visible').waitFor();assert.match(await page.locator('[data-backup-key-download]').getAttribute('href'),/^blob:/u);
 await page.screenshot({path:evidence+'/staff-settings-desktop.png',fullPage:true});
 await page.goto('https://api.artdico.host/admin/',{waitUntil:'networkidle'});await page.locator('[data-admin-fill-booths]').click();assert.equal(await page.locator('[data-admin-booths] tr').count(),15);
 await page.locator('[data-admin-booths] tr').first().locator('button').first().click();const booth=page.locator('[data-booth-form]');for(const[name,value]of Object.entries({organization:'合成参展机构',project:'合成展示项目',description:'合成游戏互动演示',contactName:'合成负责人',contactMethods:'synthetic@example.invalid'}))await booth.locator(`[name=${name}]`).fill(value);await booth.locator('[name=status]').selectOption('confirmed');await page.locator('[data-booth-submit]').click();await page.locator('[data-admin-save-location=header]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();
 assert.equal(content.booths.length,15);assert.equal(content.booths[0].contactName,'合成负责人');await page.locator('[data-admin-publish]').click();await page.locator('[data-admin-status]').filter({hasText:'发布成功'}).waitFor();assert.equal(published.content.booths[0].description,'合成游戏互动演示');assert.equal(Object.hasOwn(published.content.booths[0],'contactName'),false);
 await page.locator('[data-arrangements-slots] [data-arrangements-plan="booth"]').first().click();
 const direct=page.locator('[data-planner-booth]');await direct.locator('[name=description]').fill('合成直接编辑展示内容');
 assert.equal(await page.locator('[data-admin-save-location=header]').isDisabled(),true);
 assert.equal(content.booths[0].description,'合成游戏互动演示');
 await direct.locator('button[type=submit]').click();await page.locator('[data-planner-result]').filter({hasText:'已应用'}).waitFor();
 await page.locator('[data-planner-close]').click();await page.locator('[data-admin-save-location=header]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();
 assert.equal(content.booths[0].description,'合成直接编辑展示内容');assert.equal(content.booths[0].contactName,'合成负责人');
 assert.equal(published.content.booths[0].description,'合成游戏互动演示');
 await page.screenshot({path:evidence+'/booth-management-desktop.png',fullPage:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({reviewAndAccommodationSeparate:true,userAccountSaved:true,qrRotation:true,encryptedBackupDownload:true,fifteenBooths:true,directBoothDraftEditing:true,unappliedChangesProtected:true,privateBoothContactsNotPublished:true,mutations:writes.map(item=>item.path),pageErrors:errors},null,2));
}finally{await context.close();await browser.close();}
