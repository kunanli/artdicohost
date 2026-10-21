// Real Chromium; all API/storage/image requests intercepted with synthetic data.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInitialContent} from '../../src/config/content.mjs';
import {validateContent,toPublicContent} from '../../shared/content-schema.mjs';
import {normalizePortraitBytes} from '../../shared/portrait-codec.mjs';
import {profileImageDimensions} from '../../src/lib/profile-image.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const SITE='https://api.artdico.host',errors=[],reports=[];
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
async function imageInput(page){await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=3200;canvas.height=1200;const ctx=canvas.getContext('2d'),pixels=ctx.createImageData(canvas.width,canvas.height);let seed=42;
  for(let i=0;i<pixels.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=seed>>>8&255;pixels.data[i+2]=seed>>>16&255;pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.93)),transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic-organization.jpg',{type:'image/jpeg'}));const input=document.querySelector('[data-organization-image]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
});await page.locator('[data-organization-image-editor] [data-image-editor-apply]').click();}
async function scenario(mode){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),images=new Map(),uploads=[];
  let content=createInitialContent(),revision=0,published=null,saveCount=0,publishCount=0,loggedOut=false,unknownSaved=false,prefillCount=0;
  const user={id:'synthetic-editor',label:'合成组织编辑',roles:mode==='readonly'?['publisher']:['editor','publisher','outreach']};
  page.on('pageerror',error=>errors.push(mode+':'+error.message));page.on('dialog',dialog=>dialog.accept());
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;assert.equal(url.origin,SITE,'all requests must stay intercepted');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      if(path==='/api/admin/session')return route.fulfill(loggedOut?json({},401):json({user,csrfToken:'s'.repeat(43)}));
      if(path==='/api/admin/login'){loggedOut=false;return route.fulfill(json({user:{...user,id:'synthetic-new-account'},csrfToken:'t'.repeat(43)}));}
      if(path==='/api/admin/logout'){loggedOut=true;return route.fulfill(json({}));}
      if(path==='/api/admin/content'){
        if(request.method()==='PUT'){
          saveCount++;assert.ok(request.headers()['x-csrf-token']);
          if(body.expectedRevision!==revision)return route.fulfill(json({error:{message:'synthetic conflict'}},409));
          const checked=validateContent(body.content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));content=checked.value;revision++;
          if(mode==='unknown'&&!unknownSaved){unknownSaved=true;return route.fulfill(json({error:{message:'合成未知回执'}},503));}
        }
        return route.fulfill(json({draft:{revision,content},published}));
      }
      if(path==='/api/admin/content/publish'){publishCount++;assert.equal(body.expectedRevision,revision);published={revision,publishedAt:'2026-10-21T01:00:00Z',content:toPublicContent(content)};return route.fulfill(json({published}));}
      if(path==='/api/admin/portraits'&&request.method()==='POST'){
        if(mode==='expired-upload'){loggedOut=true;return route.fulfill(json({error:{message:'会话已结束'}},401));}
        assert.ok(request.headers()['x-csrf-token']);assert.equal(body.contentType,'image/jpeg');const raw=Buffer.from(body.dataBase64,'base64');assert.ok(raw.length<=512*1024);assert.equal(raw.includes(Buffer.from('Exif')),false);
        const data=normalizePortraitBytes(raw,'image/jpeg'),id=createHash('sha256').update(data).digest('hex')+'.jpg';images.set(id,data);uploads.push({bytes:data.length,...profileImageDimensions(data,'image/jpeg')});return route.fulfill(json({portrait:{id,bytes:data.length,contentType:'image/jpeg'}}));
      }
      if(path.startsWith('/api/admin/portraits/')){const data=images.get(path.split('/').at(-1));return route.fulfill(data?{status:200,contentType:'image/jpeg',body:data}:{status:404,body:''});}
      if(path==='/api/admin/contacts/synthetic-invitee/guest-prefill'){prefillCount++;return route.fulfill(json({prefill:{name:'合成邀约人',company:'合成机构',ggjRole:'',contactId:'synthetic-invitee'},responseStatus:'pending'}));}
      if(path==='/api/admin/contacts')return route.fulfill(json({contacts:[],revision:0}));
      if(path==='/api/admin/planning')return route.fulfill(json({sessions:[],booths:[],features:{intentInvitations:false}}));
      return route.fulfill(json({},404));
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto(SITE+'/admin/',{waitUntil:'networkidle'});
  assert.equal(await page.locator('[data-organization-list] article').count(),4);assert.equal(await page.locator('[data-organizations-legacy]').isVisible(),true);assert.equal(Object.hasOwn(content,'organizations'),false);assert.equal(saveCount,0);
  if(mode==='readonly'){
    assert.equal(await page.locator('[data-organization-add]').isDisabled(),true);assert.equal(await page.locator('[data-organization-action=edit]').first().isDisabled(),true);reports.push({mode,passed:true,noWrites:true});await context.close();return;
  }
  await page.locator('[data-organization-action=edit]').first().click();const form=page.locator('[data-organization-form]');
  assert.equal(await page.locator('[data-admin-save]').isDisabled(),true);assert.equal(await page.locator('[data-admin-publish]').isDisabled(),true);
  if(mode==='expired-upload'){
    await form.locator('[name=name]').fill('PRIVATE-OLD-ORGANIZATION');await imageInput(page);await page.locator('[data-admin-login-panel]:visible').waitFor();
    assert.equal(await page.locator('[data-organization-list] article').count(),0);assert.equal(await form.locator('[name=logoId]').inputValue(),'');assert.equal(await form.locator('[name=name]').inputValue(),'');assert.equal(await page.locator('[data-organization-dialog]').evaluate(dialog=>dialog.open),false);
    await page.locator('[data-admin-login] [name=username]').fill('synthetic-second');await page.locator('[data-admin-login] [name=password]').fill('synthetic-password');await page.locator('[data-admin-login-submit]').click();await page.locator('[data-admin-workspace]:visible').waitFor();
    assert.equal(await page.locator('[data-organization-list] article').count(),4);assert.doesNotMatch(await page.locator('[data-organizations]').textContent(),/PRIVATE-OLD/u);assert.equal(saveCount,0);reports.push({mode,passed:true,privateUploadCleared:true});await context.close();return;
  }
  await form.locator('[name=name]').fill('合成一般参与组织');await form.locator('[name=website]').fill('javascript:alert(1)');await page.locator('[data-organization-submit]').click();await page.locator('[data-organization-error]:visible').waitFor();assert.equal(saveCount,0);
  await form.locator('[name=website]').fill('https://example.invalid/organization');await form.locator('[name=participation]').selectOption('attendee');await form.locator('[name=internalNotes]').fill('PRIVATE-ORGANIZATION-NOTE');
  await form.locator('[name=publicConsent]').check();await form.locator('[name=name]').fill('合成一般参与组织（已核对）');assert.equal(await form.locator('[name=publicConsent]').isChecked(),false);
  if(mode==='complete'){await imageInput(page);await page.locator('[data-organization-image-status]').filter({hasText:'800 × 300'}).waitFor();assert.deepEqual({width:uploads[0].width,height:uploads[0].height},{width:800,height:300});}
  await form.locator('[name=publicConsent]').check();await page.locator('[data-organization-submit]').click();assert.equal(await page.locator('[data-organization-dialog]').evaluate(dialog=>dialog.open),false);assert.equal(Object.hasOwn(content,'organizations'),false);assert.equal(saveCount,0);
  if(mode==='unknown'){
    await page.locator('[data-admin-save]').click();await page.locator('[data-admin-error]').filter({hasText:'合成未知回执'}).waitFor();assert.equal(await page.locator('[data-admin-unsaved]').textContent(),'有尚未保存的修改');assert.equal(content.organizations.length,4);assert.equal(published,null);assert.equal(publishCount,0);
    await page.locator('[data-admin-save]').click();await page.locator('[data-admin-error]').filter({hasText:'其他工作人员'}).waitFor();assert.equal(content.organizations.length,4);assert.equal(revision,1);assert.equal(saveCount,2);assert.equal(publishCount,0);reports.push({mode,passed:true,noFalseSaveOrPublication:true});await context.close();return;
  }
  await page.locator('[data-organization-add]').click();await form.locator('[name=name]').fill('合成参展组织');await form.locator('[name=participation]').selectOption('exhibitor');await form.locator('[name=status]').selectOption('confirmed');await form.locator('[name=publicConsent]').check();await page.locator('[data-organization-submit]').click();
  await page.locator('[data-admin-save]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();assert.equal(content.organizations.length,5);assert.equal(content.organizations[0].participation,'attendee');assert.equal(content.organizations[4].participation,'exhibitor');assert.equal(content.booths.length,0);assert.equal(content.organizations[0].internalNotes,'PRIVATE-ORGANIZATION-NOTE');
  await page.locator('[data-admin-publish]').click();await page.locator('[data-admin-status]').filter({hasText:'发布成功'}).waitFor();assert.equal(published.content.organizations.length,5);assert.doesNotMatch(JSON.stringify(published),/PRIVATE-/u);assert.equal(published.content.organizations[0].website,'https://example.invalid/organization');assert.ok(published.content.organizations[0].logoUrl);
  const firstId=content.organizations[0].id,original=structuredClone(content.organizations[0]);await page.locator('[data-organization-id="'+firstId+'"] [data-organization-action=withdraw]').click();await page.locator('[data-admin-save]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();
  assert.deepEqual(content.organizations[0],{...original,publicConsent:false});assert.equal(content.organizations[0].status,'confirmed');await page.locator('[data-admin-publish]').click();await page.locator('[data-admin-status]').filter({hasText:'发布成功'}).waitFor();assert.equal(published.content.organizations.some(item=>item.id===firstId),false);
  await page.locator('[data-organization-id="'+firstId+'"] [data-organization-action=down]').click();await page.locator('[data-admin-save]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();assert.equal(content.organizations[1].id,firstId);assert.equal(content.organizations[1].internalNotes,'PRIVATE-ORGANIZATION-NOTE');
  await page.locator('[data-admin-preview]').click();assert.doesNotMatch(await page.locator('[data-admin-public-preview]').textContent(),/PRIVATE-/u);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await mkdir(resolve(project,'.local-data/browser-evidence'),{recursive:true});await page.locator('[data-organizations]').screenshot({path:resolve(project,'.local-data/browser-evidence/organizations-admin-mobile.png')});
  await page.locator('[data-organization-id="'+firstId+'"] [data-organization-action=edit]').click();await page.evaluate(()=>location.hash='#invitee=synthetic-invitee');await page.waitForTimeout(50);assert.equal(prefillCount,0);assert.equal(await page.locator('[data-guest-dialog]').evaluate(dialog=>dialog.open),false);
  await page.locator('[data-organization-dialog] [data-organization-close]').first().click();await page.locator('[data-guest-dialog][open]').waitFor();assert.equal(prefillCount,1);assert.equal(await page.locator('[data-guest-form] [name=name]').inputValue(),'合成邀约人');await page.locator('[data-guest-dialog] [data-close-dialog=guest]').first().click();
  await page.locator('[data-admin-logout]').click();await page.locator('[data-admin-login-panel]:visible').waitFor();assert.equal(await page.locator('[data-organization-list] article').count(),0);assert.equal(await form.locator('[name=internalNotes]').inputValue(),'');
  reports.push({mode,passed:true,defaultNamesNotWrittenOnRead:true,resize:uploads[0],independentParticipation:true,saveAndPublishSeparated:true,stopPublicationRetainsAttendanceAndData:true,orderStable:true,pendingNavigationDeferred:true,mobileNoOverflow:true,logoutClearsPrivateData:true});await context.close();
}
try{for(const mode of ['complete','readonly','unknown','expired-upload'])await scenario(mode);assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));}
finally{await browser.close();}
