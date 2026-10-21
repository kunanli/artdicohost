// Actual Chromium profile editing/public rendering with intercepted synthetic APIs only.
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
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(project,'dist'),evidence=resolve(project,'.local-data/browser-evidence');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1360,height:1000}}),page=await context.newPage();
const errors=[],uploads=[],unexpected=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
const user={id:'synthetic-editor',label:'合成编辑',roles:['editor','publisher','outreach','superadmin']},images=new Map();
let content=createInitialContent(),revision=0,published=null;
content.guests=[{id:'synthetic-person',name:'合成讲者',company:'合成组织',ggjRole:'',portraitId:'',contactId:'',status:'pending',publicConsent:false,internalNotes:'PRIVATE-ORIGINAL-NOTE'}];
const session=content.sessions.find(item=>item.zone==='B'&&item.status==='scheduled');assert.ok(session);session.guestId='synthetic-person';
content.booths=[{id:'synthetic-booth',code:'C01',zone:'C',slotNumber:1,organization:'合成参展组织',project:'合成展示项目',description:'已确认公开的合成展示内容。',website:'https://example.invalid/organization',contactName:'PRIVATE-CONTACT',contactMethods:'PRIVATE-METHOD',status:'confirmed',internalNotes:''}];
const json=body=>({status:200,contentType:'application/json',body:JSON.stringify(body)});
await context.route('**/*',async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 if(!['https://api.artdico.host','https://artdico.host'].includes(url.origin)){unexpected.push(url.origin);return route.abort();}
 if(path==='/__fixture/profile-image.mjs')return route.fulfill({status:200,contentType:'text/javascript',body:await readFile(resolve(project,'src/lib/profile-image.mjs'))});
 if(path.startsWith('/api/')){
  const body=request.postData()?JSON.parse(request.postData()):null;
  if(path==='/api/admin/session')return route.fulfill(json({user,csrfToken:'s'.repeat(43)}));
  if(path==='/api/admin/content'){
   if(request.method()==='PUT'){assert.equal(body.expectedRevision,revision);const checked=validateContent(body.content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));content=checked.value;revision++;}
   return route.fulfill(json({draft:{revision,content},published}));
  }
  if(path==='/api/admin/content/publish'){assert.equal(body.expectedRevision,revision);published={revision,publishedAt:'2026-10-21T00:00:00Z',content:toPublicContent(content)};return route.fulfill(json({published}));}
  if(path==='/api/admin/portraits'&&request.method()==='POST'){
   const input=Buffer.from(body.dataBase64,'base64');assert.equal(body.contentType,'image/jpeg');assert.ok(input.length<=512*1024);assert.equal(input.includes(Buffer.from('Exif')),false);
   const data=normalizePortraitBytes(input,body.contentType),id=createHash('sha256').update(data).digest('hex')+'.jpg';images.set(id,data);uploads.push({bytes:data.length,...profileImageDimensions(data,'image/jpeg')});
   return route.fulfill(json({portrait:{id,bytes:data.length,contentType:'image/jpeg'}}));
  }
  if(/^\/api\/(?:admin|public)\/portraits\//u.test(path)){const data=images.get(path.split('/').at(-1));return route.fulfill(data?{status:200,contentType:'image/jpeg',body:data}:{status:404,body:''});}
  if(path==='/api/public/content')return route.fulfill(published?json(published):{status:404,contentType:'application/json',body:'{}'});
  if(path==='/api/admin/contacts')return route.fulfill(json({contacts:[],revision:0}));
  if(path==='/api/admin/planning')return route.fulfill(json({sessions:[],booths:[],features:{intentInvitations:false}}));
  return route.fulfill({status:404,contentType:'application/json',body:'{}'});
 }
 const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
 try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
 catch{return route.fulfill({status:404,body:''});}
});
try{
 await page.goto('https://api.artdico.host/admin/',{waitUntil:'networkidle'});
 await page.locator('[data-admin-guests] tr').first().locator('button').first().click();
 const form=page.locator('[data-guest-form]');
 await page.evaluate(()=>{
  const bytes=new Uint8Array(33),view=new DataView(bytes.buffer);bytes.set([137,80,78,71,13,10,26,10]);view.setUint32(8,13);bytes.set([73,72,68,82],12);view.setUint32(16,10000);view.setUint32(20,10000);
  const data=new DataTransfer();data.items.add(new File([bytes],'synthetic-unsafe.png',{type:'image/png'}));const input=document.querySelector('[data-guest-portrait-file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.locator('[data-guest-error]').filter({hasText:'像素'}).waitFor();assert.equal(uploads.length,0);
 await page.evaluate(async()=>{
  const canvas=document.createElement('canvas');canvas.width=3200;canvas.height=2400;const context=canvas.getContext('2d'),pixels=context.createImageData(canvas.width,canvas.height);let seed=42;
  for(let index=0;index<pixels.data.length;index+=4){seed=(seed*1664525+1013904223)>>>0;pixels.data[index]=seed&255;pixels.data[index+1]=seed>>>8&255;pixels.data[index+2]=seed>>>16&255;pixels.data[index+3]=255;}
  context.putImageData(pixels,0,0);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.93));if(blob.size<=512*1024||blob.size>12*1024*1024)throw new Error('Synthetic original fixture bounds failed');
  const data=new DataTransfer();data.items.add(new File([blob],'synthetic-large.jpg',{type:'image/jpeg'}));const input=document.querySelector('[data-guest-portrait-file]');input.files=data.files;input.dispatchEvent(new Event('change',{bubbles:true}));
 });
 await page.locator('[data-guest-portrait-status]').filter({hasText:'800 × 600'}).waitFor();assert.equal(uploads.length,1);assert.deepEqual({width:uploads[0].width,height:uploads[0].height},{width:800,height:600});
 await form.locator('[name=title]').fill('合成策展人');await form.locator('[name=bio]').fill('合成嘉宾的经验与分享方向。');await form.locator('[name=website]').fill('https://example.invalid/person');
 await form.locator('[name=publicRoles][value=speaker]').check();await form.locator('[name=publicRoles][value=organizer]').check();await form.locator('[name=status]').selectOption('confirmed');
 await form.locator('[name=publicConsent]').check();await form.locator('[name=title]').fill('合成研究员');assert.equal(await form.locator('[name=publicConsent]').isChecked(),false);await form.locator('[name=publicConsent]').check();
 await page.locator('[data-guest-submit]').click();await page.locator('[data-admin-save]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();
 assert.equal(content.guests[0].internalNotes,'PRIVATE-ORIGINAL-NOTE');assert.deepEqual(content.guests[0].publicRoles,['speaker','organizer']);await page.locator('[data-admin-publish]').click();await page.locator('[data-admin-status]').filter({hasText:'发布成功'}).waitFor();
 assert.doesNotMatch(JSON.stringify(published),/PRIVATE-/u);
 const oriented=await page.evaluate(async()=>{
  const {prepareProfileImage}=await import('/__fixture/profile-image.mjs');const canvas=document.createElement('canvas');canvas.width=80;canvas.height=40;const context=canvas.getContext('2d');context.fillStyle='#f00';context.fillRect(0,0,40,40);context.fillStyle='#00f';context.fillRect(40,0,40,40);
  const original=new Uint8Array(await(await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',1))).arrayBuffer());
  const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);const bytes=new Uint8Array(original.length+exif.length);bytes.set(original.subarray(0,2));bytes.set(exif,2);bytes.set(original.subarray(2),2+exif.length);
  const file=new File([bytes],'synthetic-orientation.jpg',{type:'image/jpeg'}),result=await prepareProfileImage(file);
  const blob=new Blob([Uint8Array.from(atob(result.payload.dataBase64),character=>character.charCodeAt(0))],{type:'image/jpeg'}),bitmap=await createImageBitmap(blob);canvas.width=bitmap.width;canvas.height=bitmap.height;context.drawImage(bitmap,0,0);const top=[...context.getImageData(20,10,1,1).data],bottom=[...context.getImageData(20,70,1,1).data];bitmap.close();
  const originalDecoder=window.createImageBitmap;window.createImageBitmap=undefined;let fallback;try{fallback=await prepareProfileImage(file);}finally{window.createImageBitmap=originalDecoder;}
  return {width:result.processed.width,height:result.processed.height,top,bottom,fallback:{width:fallback.processed.width,height:fallback.processed.height}};
 });
 assert.equal(oriented.width,40);assert.equal(oriented.height,80);assert.ok(oriented.top[0]>oriented.top[2]);assert.ok(oriented.bottom[2]>oriented.bottom[0]);assert.deepEqual(oriented.fallback,{width:40,height:80});
 await page.setViewportSize({width:390,height:844});await page.goto('https://artdico.host/',{waitUntil:'networkidle'});
 const card=page.locator('[data-public-guests] .ah-guest-card');await card.filter({hasText:'合成讲者'}).waitFor();assert.match(await card.textContent(),/讲者 · 研讨会组织者/u);assert.match(await card.textContent(),/合成研究员 · 合成组织/u);
 await card.locator('summary').click();await card.locator('a[href="#program-'+session.id+'"]').click();assert.equal(await page.locator('#tab-B').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-program-period]').inputValue(),'all');assert.equal(await page.locator('#program-'+session.id).isVisible(),true);
 assert.equal(await card.locator('a[href="https://example.invalid/person"]').getAttribute('rel'),'noopener noreferrer');assert.equal(await page.locator('[data-public-booths] a').getAttribute('href'),'https://example.invalid/organization');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
 await page.screenshot({path:resolve(evidence,'profile-media-mobile.png'),fullPage:true});
 await page.locator('[data-public-guests]').screenshot({path:resolve(evidence,'profile-media-card-mobile.png')});
 await page.goto('https://api.artdico.host/admin/',{waitUntil:'networkidle'});
 await page.locator('[data-admin-guests] button').filter({hasText:'停止公开'}).click();
 await page.locator('[data-admin-save]').click();await page.locator('[data-admin-status]').filter({hasText:'草稿已保存'}).waitFor();
 assert.equal(content.guests.length,1);assert.equal(content.guests[0].bio,'合成嘉宾的经验与分享方向。');assert.equal(content.guests[0].internalNotes,'PRIVATE-ORIGINAL-NOTE');assert.equal(content.sessions.find(item=>item.id===session.id).guestId,'synthetic-person');assert.equal(content.guests[0].publicConsent,false);
 await page.locator('[data-admin-publish]').click();await page.locator('[data-admin-status]').filter({hasText:'发布成功'}).waitFor();assert.equal(published.content.guests.length,0);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({largeOriginalResized:uploads[0],metadataRemoved:true,orientationAndFallback:true,publicConsentRechecked:true,optionalProfilePublished:true,scheduledSessionLink:true,organizationWebsite:true,mobileNoOverflow:true,unpublishRetainsInformation:true,pageErrors:errors},null,2));
}finally{await context.close();await browser.close();}
