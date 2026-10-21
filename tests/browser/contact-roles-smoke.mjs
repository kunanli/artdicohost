// Real Chromium with synthetic intercepted APIs; no production reads, writes or messages.
import {fileURLToPath} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {readSheet} from 'read-excel-file/node';
import {createXlsxWorkbook,XLSX_MIME} from '../../shared/xlsx-workbook.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist'),errors=[],reports=[];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const staff={id:'synthetic-owner',label:'合成工作人员',roles:['editor','outreach','superadmin']},csrf='s'.repeat(43);
const profile={name:'合成参与者',displayName:'合成参与者',city:'合成城市',organization:'合成机构',position:'合成职务',email:'synthetic@example.invalid',wechat:'synthetic-wechat',phone:'',website:'',caseLinks:'',background:'',needs:'',siteName:'',siteRole:'',siteYears:'',categories:['developer'],interests:['talk'],topics:'',submittedAt:'',contactConsent:'consented'};
const make=()=>({id:'synthetic-person',profile:structuredClone(profile),source:{key:'manual',rowId:'synthetic-source',digest:'a'.repeat(64)},operations:{owner:'合成同事',priority:'normal',followUpAt:'',notes:'',responseStatus:'pending',participationForms:[],sessionIds:[],boothIds:[],sessionRoles:[]},invitation:{generatedAt:null,sentAt:null,settings:null}});
const sessions=[{id:'morning',start:'10:00',end:'11:00',zone:'A',title:'合成主题分享',status:'scheduled'},{id:'afternoon',start:'13:00',end:'14:00',zone:'B',title:'合成研讨会',status:'scheduled'}];
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
async function serve(route,path){try{const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}}
async function scenario(expired=false){
 const context=await browser.newContext({viewport:{width:390,height:850}}),page=await context.newPage(),person=make();let revision=1;const writes=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
 await context.addInitScript(()=>{const revoke=URL.revokeObjectURL.bind(URL);window.__revoked=[];URL.revokeObjectURL=url=>{window.__revoked.push(url);return revoke(url);};});
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;if(url.origin!=='https://api.artdico.host')return route.abort();if(!path.startsWith('/api/'))return serve(route,path);
  const body=request.postData()?JSON.parse(request.postData()):null;if(request.method()!=='GET'){assert.equal(request.headers()['x-csrf-token'],csrf);writes.push(path);}
  if(path==='/api/admin/session')return route.fulfill(json({user:staff,csrfToken:csrf}));
  if(path==='/api/admin/contacts')return route.fulfill(json({revision,contacts:[person]}));
  if(path==='/api/admin/planning')return route.fulfill(json({content:{sessions,booths:[]},features:{intentInvitations:expired,contactXlsxExport:true}}));
  if(path==='/api/admin/intent-invitations')return route.fulfill(json({error:{code:'AUTH_REQUIRED'}},401));
  if(path==='/api/admin/contacts/synthetic-person'&&request.method()==='PUT'){
   assert.equal(body.expectedRevision,revision);assert.deepEqual(body.operations.participationForms,['speaker','organizer']);
   assert.deepEqual(body.operations.sessionRoles,[{sessionId:'morning',roles:['speaker']},{sessionId:'afternoon',roles:['host','organizer']}]);
   assert.equal(body.operations.responseStatus,'pending');assert.equal(Object.hasOwn(body,'profile'),false);assert.equal(Object.hasOwn(body.operations,'publicConsent'),false);
   person.operations=body.operations;revision++;return route.fulfill(json({revision,contact:person}));
  }
  if(path==='/api/admin/contacts/export.xlsx'){
   assert.deepEqual(body,{expectedRevision:revision,includeContact:false,includeAnswers:false});
   const bytes=Buffer.from(createXlsxWorkbook([{name:'完整人员名单',headers:['姓名','全活动职责'],rows:[[person.profile.name,person.operations.participationForms.join('、')]]}]));revision++;
   return route.fulfill({status:200,body:bytes,contentType:XLSX_MIME,headers:{'content-length':String(bytes.length),'x-review-revision':String(revision),'x-export-count':'1','x-export-sha256':createHash('sha256').update(bytes).digest('hex')}});
  }
  if(path==='/api/admin/logout')return route.fulfill(json({ok:true}));
  return route.fulfill(json({error:{code:'UNEXPECTED'}},404));
 });
 try{
  await page.goto('https://api.artdico.host/admin/contacts/',{waitUntil:'networkidle'});
  if(expired){assert.equal(await page.locator('[data-contacts-workspace]').isHidden(),true);assert.equal(await page.locator('[data-contacts-account]').isHidden(),true);assert.equal(await page.locator('[data-contacts-rows]').textContent(),'');assert.equal(await page.locator('[data-contacts-metrics]').textContent(),'');assert.equal(await page.locator('[data-contacts-export-panel]').isHidden(),true);reports.push('late ledger401 does not reopen old private workspace');return;}
  await page.locator('[data-contacts-rows] button').filter({hasText:'详情与安排'}).click();
  const form=page.locator('[data-contact-form]');await form.locator('[name=participationForms][value=speaker]').check();await form.locator('[name=participationForms][value=organizer]').check();
  await form.locator('details').first().locator('summary').click();
  for(const id of ['morning','afternoon'])await form.locator('[name=sessionIds][value='+id+']').check();
  await form.locator('[data-session-roles=morning] [value=speaker]').check();await form.locator('[data-session-roles=afternoon] [value=organizer]').check();await form.locator('[data-session-roles=afternoon] [value=host]').check();
  await form.locator('[name=notes]').fill('合成安排备注');await form.locator('[data-contact-save]').click();
  await page.locator('[data-contacts-status]').filter({hasText:'职责、跟进与安排已保存'}).waitFor();assert.deepEqual(person.profile,profile);assert.equal(person.invitation.generatedAt,null);
  assert.match(await page.locator('[data-contacts-rows]').textContent(),/本场：讲者/u);assert.match(await page.locator('[data-contacts-rows]').textContent(),/本场：主持、研讨会组织者/u);
  await page.locator('[data-contacts-search]').fill('不存在的合成筛选');assert.equal(await page.locator('[data-contacts-rows] tr').count(),0);
  const downloaded=page.waitForEvent('download');await page.locator('[data-contacts-export]').click();const download=await downloaded;
  const evidence=resolve(project,'.local-data/browser-evidence');await mkdir(evidence,{recursive:true});const file=resolve(evidence,'synthetic-contact-full-export.xlsx');await download.saveAs(file);
  const rows=await readSheet(file,'完整人员名单');assert.equal(rows[1][0],profile.name);assert.equal(rows[1][1],'speaker、organizer');assert.equal(download.suggestedFilename(),'artdico-all-contacts.xlsx');
  await page.locator('[data-contacts-status]').filter({hasText:'完整人员 Excel 已准备下载'}).waitFor();
  await page.locator('[data-contacts-logout]').click();await page.locator('[data-contacts-login-panel]:visible').waitFor();
  assert.equal(await page.locator('[data-contact-sessions]').textContent(),'');assert.equal(await page.locator('[data-contacts-rows]').textContent(),'');assert.equal(await page.evaluate(()=>window.__revoked.some(url=>url.startsWith('blob:'))),true);
  assert.deepEqual(writes,['/api/admin/contacts/synthetic-person','/api/admin/contacts/export.xlsx','/api/admin/logout']);
  reports.push('independent roles, original record retained, full XLSX despite filter, private download revoked');
 }finally{await context.close();}
}
try{await scenario();await scenario(true);assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));}finally{await browser.close();}
