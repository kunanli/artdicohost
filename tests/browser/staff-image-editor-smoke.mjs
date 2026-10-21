// Actual Chromium canvas/pointer editing. Every HTTP request is intercepted;
// fixtures contain generated gradients and geometric shapes, never real photos.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInitialContent} from '../../src/config/content.mjs';
import {normalizePortraitBytes} from '../../shared/portrait-codec.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence'),SITE='https://api.artdico.host';
const seed=normalizePortraitBytes(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64'),'image/png');
const seedId=createHash('sha256').update(seed).digest('hex')+'.png';
const errors=[],reports=[];
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});

async function fixture({width=1280,mode='normal'}={}){
  const context=await browser.newContext({viewport:{width,height:900},hasTouch:width<600,isMobile:width<600});
  const page=await context.newPage(),uploads=[],writes=[],images=new Map([[seedId,{bytes:seed,type:'image/png'}]]);
  page.setDefaultTimeout(10000);
  const content=createInitialContent();
  content.guests=[{id:'synthetic-image-guest',name:'合成图片嘉宾',company:'合成组织',ggjRole:'',portraitId:seedId,contactId:'',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE-ORIGINAL-NOTE'}];
  content.organizations=[{id:'synthetic-image-organization',name:'合成图片组织',logoId:seedId,website:'https://example.invalid/organization',participation:'attendee',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE-ORGANIZATION-NOTE'}];
  let account=0,authenticated=true,releaseUpload=null,settleLate,dismissConfirm=false;
  const dialogEvents=[];
  const lateDone=new Promise(resolve=>{settleLate=resolve;});
  if(mode==='delayed-encode')await context.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.toBlob;
    window.syntheticImageEncode={ready:false,release:null};
    HTMLCanvasElement.prototype.toBlob=function(callback,...options){
      const held=this.matches('[data-image-editor-canvas]');
      return original.call(this,blob=>{
        if(!held)return callback(blob);
        window.syntheticImageEncode.ready=true;
        window.syntheticImageEncode.release=()=>{window.syntheticImageEncode.release=null;callback(blob);};
      },...options);
    };
  });
  page.on('pageerror',error=>errors.push(mode+':'+error.message));page.on('dialog',dialog=>{dialogEvents.push(dialog.type());return dismissConfirm&&dialog.type()==='confirm'?dialog.dismiss():dialog.accept();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.equal(url.origin,SITE,'all HTTP requests must stay on the intercepted origin');
    if(path.startsWith('/api/')){
      const body=request.postData()?JSON.parse(request.postData()):null;
      if(request.method()!=='GET')writes.push(path);
      const user={id:'synthetic-image-editor-'+account,label:'合成图片编辑',roles:['editor','publisher']};
      if(path==='/api/admin/session')return route.fulfill(authenticated?json({user,csrfToken:'s'.repeat(43)}):json({},401));
      if(path==='/api/admin/login'){account++;authenticated=true;return route.fulfill(json({user:{...user,id:'synthetic-image-editor-'+account},csrfToken:'t'.repeat(43)}));}
      if(path==='/api/admin/logout'){authenticated=false;return route.fulfill(json({ok:true}));}
      if(path==='/api/admin/content'){assert.equal(request.method(),'GET','editing images must not automatically save content');return route.fulfill(json({draft:{revision:0,content},published:null}));}
      if(path==='/api/admin/portraits'&&request.method()==='POST'){
        assert.ok(request.headers()['x-csrf-token'],'image writes retain the authenticated request flow');
        const raw=Buffer.from(body.dataBase64,'base64');
        assert.ok(raw.length>0&&raw.length<=512*1024);assert.ok(['image/png','image/jpeg'].includes(body.contentType));
        assert.equal(raw.includes(Buffer.from('Exif')),false);
        const data=normalizePortraitBytes(raw,body.contentType),id=createHash('sha256').update(data).digest('hex')+(body.contentType==='image/png'?'.png':'.jpg');
        const entry={bytes:data,type:body.contentType,payload:body,id};uploads.push(entry);images.set(id,entry);
        if(mode==='503-once'&&uploads.length===1)return route.fulfill(json({error:{code:'CONTENT_NOT_READY',message:'云端内容后台尚未开放。'}},503));
        if(mode==='401-once'&&uploads.length===1){authenticated=false;return route.fulfill(json({error:{code:'AUTH_REQUIRED',message:'会话已结束。'}},401));}
        const held=['late-first','late-401-ignore-abort'].includes(mode)&&uploads.length===1;
        if(held)await new Promise(accept=>{releaseUpload=accept;});
        try{return await route.fulfill(held&&mode==='late-401-ignore-abort'?json({error:{code:'AUTH_REQUIRED',message:'合成旧会话失效'}},401):json({portrait:{id,bytes:data.length,contentType:body.contentType}}));}catch(error){if(!held)throw error;}finally{if(held)settleLate();}
        return;
      }
      if(path.startsWith('/api/admin/portraits/')){const image=images.get(path.split('/').at(-1));return route.fulfill(image?{status:200,contentType:image.type,body:image.bytes}:{status:404,body:''});}
      throw new Error('Unimplemented synthetic API: '+path);
    }
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});
  });
  if(mode==='late-401-ignore-abort')await context.addInitScript(()=>{
    const original=window.fetch.bind(window);let first=true;
    window.fetch=(input,options={})=>{
      if(first&&String(input).endsWith('/api/admin/portraits')&&options.method==='POST'){
        first=false;const next={...options};delete next.signal;return original(input,next);
      }
      return original(input,options);
    };
  });
  await page.goto(SITE+'/admin/content/guests/',{waitUntil:'networkidle'});await page.locator('[data-admin-workspace]:visible').waitFor();
  return {page,context,uploads,writes,content,dialogEvents,setDismissConfirm:value=>{dismissConfirm=value;},release:async()=>{assert.ok(releaseUpload,'the held upload must exist');releaseUpload();await lateDone;}};
}

const config={
  guest:{open:'[data-admin-guests] tr:first-child button:first-child',form:'[data-guest-form]',file:'[data-guest-portrait-file]',host:'[data-guest-image-editor]',id:'portraitId',status:'[data-guest-portrait-status]',error:'[data-guest-error]',retry:'[data-guest-portrait-retry]',close:'[data-guest-dialog] [data-close-dialog=guest]'},
  organization:{open:'[data-organization-action=edit]',form:'[data-organization-form]',file:'[data-organization-image]',host:'[data-organization-image-editor]',id:'logoId',status:'[data-organization-image-status]',error:'[data-organization-error]',retry:'[data-organization-image-retry]',close:'[data-organization-dialog] [data-organization-close]'},
};
async function open(f,kind){const target='/admin/content/'+(kind==='guest'?'guests':'organizations')+'/';if(new URL(f.page.url()).pathname!==target){await f.page.goto(SITE+target,{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();}const c=config[kind];await f.page.locator(c.open).first().click();await f.page.locator(c.form).waitFor({state:'visible'});return f.page.locator(c.form);}
async function choose(f,kind,pattern='gradient'){
  const selector=config[kind].file;
  await f.page.evaluate(async({selector,pattern})=>{
    const canvas=document.createElement('canvas');canvas.width=pattern==='gradient'?1200:800;canvas.height=800;
    const ctx=canvas.getContext('2d');
    if(pattern==='gradient'){
      const gradient=ctx.createLinearGradient(0,0,1200,0);gradient.addColorStop(0,'#ff0000');gradient.addColorStop(.5,'#0000ff');gradient.addColorStop(1,'#00ff00');ctx.fillStyle=gradient;ctx.fillRect(0,0,1200,800);
      ctx.fillStyle='#ffff00';ctx.fillRect(100,200,100,400);
    }else{
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,800,800);ctx.fillStyle='#0044ff';ctx.fillRect(200,200,400,400);ctx.fillStyle='#ff4400';ctx.fillRect(300,260,70,70);
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic-'+pattern+'.png',{type:'image/png'}));
    const input=document.querySelector(selector);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  },{selector,pattern});
  const editor=f.page.locator(config[kind].host).locator('[data-image-editor]');await editor.waitFor({state:'visible'});
  await editor.locator('[data-image-editor-apply]').waitFor();return editor;
}
async function canvasState(editor){return editor.locator('[data-image-editor-canvas]').evaluate(async canvas=>{
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const ctx=canvas.getContext('2d'),data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const digest=await crypto.subtle.digest('SHA-256',data);
  return {width:canvas.width,height:canvas.height,center:[...ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data],corner:[...ctx.getImageData(2,2,1,1).data],digest:[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')};
});}
async function decoded(page,image){return page.evaluate(async({data,type})=>{
  const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(data),value=>value.charCodeAt(0))],{type}));
  const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
  const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
  return {width:canvas.width,height:canvas.height,center:[...ctx.getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data],corner:[...ctx.getImageData(2,2,1,1).data]};
},{data:image.bytes.toString('base64'),type:image.type});}
async function drag(page,editor,{touch=false,from=.5,to=.25}={}){
  const canvas=editor.locator('[data-image-editor-canvas]');await canvas.scrollIntoViewIfNeeded();const box=await canvas.boundingBox();assert.ok(box);
  const start={x:box.x+box.width*from,y:box.y+box.height*.5},end={x:box.x+box.width*to,y:start.y};
  if(touch){const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[start]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[end]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}
  else{await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:5});await page.mouse.up();}
}
async function login(page){await page.locator('[data-admin-login] [name=username]').fill('synthetic-image-second');await page.locator('[data-admin-login] [name=password]').fill('synthetic-image-password');await page.locator('[data-admin-login-submit]').click();await page.locator('[data-admin-workspace]:visible').waitFor();}
async function waitUploads(f,count){for(let attempt=0;attempt<100&&f.uploads.length<count;attempt++)await f.page.waitForTimeout(20);assert.equal(f.uploads.length,count);}
async function waitUploaded(f,kind){await f.page.waitForFunction(({selector,field,id})=>document.querySelector(selector)?.elements.namedItem(field)?.value===id,{selector:config[kind].form,field:config[kind].id,id:f.uploads.at(-1).id});}

try{
  await mkdir(evidence,{recursive:true});
  const crop=await fixture();const guestForm=await open(crop,'guest');
  await crop.page.locator('[data-guest-portrait-edit]').click();let currentEditor=crop.page.locator(config.guest.host).locator('[data-image-editor]');await currentEditor.waitFor({state:'visible'});assert.equal(crop.uploads.length,0);await currentEditor.locator('[data-image-editor-canvas]').focus();await crop.page.keyboard.press('Escape');assert.equal(await crop.page.locator('[data-guest-dialog]').evaluate(dialog=>dialog.open),true);await crop.page.waitForFunction(()=>document.activeElement?.matches('[data-guest-portrait-edit]'));assert.equal(await guestForm.locator('[name=portraitId]').inputValue(),seedId);
  await guestForm.locator('[name=name]').fill('合成未保存嘉宾');
  let editor=await choose(crop,'guest');assert.equal(crop.uploads.length,0);
  await editor.locator('[data-image-editor-cancel]').click();assert.equal(await guestForm.locator('[name=portraitId]').inputValue(),seedId);assert.equal(await guestForm.locator('[name=name]').inputValue(),'合成未保存嘉宾');assert.equal(crop.uploads.length,0);
  editor=await choose(crop,'guest');await editor.locator('[data-image-editor-ratio]').selectOption('square');
  const before=await canvasState(editor),zoom=editor.locator('[data-image-editor-zoom]');await zoom.focus();await crop.page.keyboard.press('End');
  const zoomed=await canvasState(editor);assert.notEqual(zoomed.digest,before.digest,'keyboard zoom changes actual pixels');
  await drag(crop.page,editor);const moved=await canvasState(editor);assert.notEqual(moved.digest,zoomed.digest,'pointer movement changes the crop pixels');
  assert.equal(crop.uploads.length,0);await crop.page.screenshot({path:resolve(evidence,'staff-image-editor-crop-controls.png')});await editor.locator('[data-image-editor-apply]').click();await waitUploads(crop,1);
  await waitUploaded(crop,'guest');const picture=await decoded(crop.page,crop.uploads[0]);
  assert.equal(crop.uploads[0].type,'image/jpeg');assert.equal(picture.width,picture.height);assert.ok(picture.width<=800);
  for(let channel=0;channel<3;channel++)assert.ok(Math.abs(picture.center[channel]-moved.center[channel])<20,'uploaded crop matches the actual preview pixels');
  assert.equal(crop.content.guests[0].portraitId,seedId,'upload does not save the guest');assert.equal(await guestForm.locator('[name=name]').inputValue(),'合成未保存嘉宾');
  await crop.page.screenshot({path:resolve(evidence,'staff-image-editor-desktop.png')});await crop.context.close();reports.push({cropAndKeyboardZoom:true,pointerMovesPixels:true,explicitApplyOnly:true,cancelRetainsPriorImage:true,noAutomaticSave:true});

  const mask=await fixture();await open(mask,'organization');await mask.page.locator('[data-organization-image-edit]').click();currentEditor=mask.page.locator(config.organization.host).locator('[data-image-editor]');await currentEditor.waitFor({state:'visible'});await currentEditor.locator('[data-image-editor-cancel]').click();assert.equal(mask.uploads.length,0);editor=await choose(mask,'organization','shape');
  await editor.locator('[data-image-editor-tool]').selectOption('sample');await editor.locator('[data-image-editor-canvas]').click({position:{x:12,y:12}});
  await editor.locator('[data-image-editor-tolerance]').focus();await mask.page.keyboard.press('Home');await mask.page.keyboard.press('ArrowRight');
  await editor.locator('[data-image-editor-remove-background]').click();await editor.locator('[data-image-editor-status]').filter({hasText:'已去除背景'}).waitFor();let state=await canvasState(editor);assert.equal(state.corner[3],0);assert.equal(state.center[3],255);
  await editor.locator('[data-image-editor-tool]').selectOption('erase');await drag(mask.page,editor,{from:.47,to:.53});state=await canvasState(editor);assert.equal(state.center[3],0);
  await editor.locator('[data-image-editor-tool]').selectOption('restore');await drag(mask.page,editor,{from:.47,to:.53});state=await canvasState(editor);assert.equal(state.center[3],255);
  await editor.locator('[data-image-editor-undo]').click();assert.equal((await canvasState(editor)).center[3],0);await editor.locator('[data-image-editor-undo]').click();assert.equal((await canvasState(editor)).center[3],255);
  await editor.locator('[data-image-editor-reset-mask]').click();assert.equal((await canvasState(editor)).corner[3],255);await editor.locator('[data-image-editor-undo]').click();assert.equal((await canvasState(editor)).corner[3],0);
  assert.equal(mask.uploads.length,0);await editor.locator('[data-image-editor-apply]').click();await waitUploads(mask,1);await waitUploaded(mask,'organization');
  const transparent=await decoded(mask.page,mask.uploads[0]);assert.equal(mask.uploads[0].type,'image/png');assert.equal(transparent.corner[3],0);assert.equal(transparent.center[3],255);assert.ok(transparent.center[2]>200);assert.ok(mask.uploads[0].bytes.length<=512*1024);
  await mask.page.screenshot({path:resolve(evidence,'staff-image-editor-transparent.png')});await mask.context.close();reports.push({backgroundRemoved:true,eraseRestoreAndUndo:true,alphaPreservedInActualUpload:true,transparentPngWithin512KiB:true});

  const mobile=await fixture({width:390});await open(mobile,'guest');editor=await choose(mobile,'guest');const touchBefore=await canvasState(editor);
  await drag(mobile.page,editor,{touch:true});const touchAfter=await canvasState(editor);assert.notEqual(touchAfter.digest,touchBefore.digest,'real touch changes canvas pixels');
  assert.ok(await mobile.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await mobile.page.screenshot({path:resolve(evidence,'staff-image-editor-mobile.png')});
  await editor.locator('[data-image-editor-cancel]').click();assert.equal(mobile.uploads.length,0);await mobile.context.close();reports.push({mobileTouchMovesPixels:true,mobileNoHorizontalOverflow:true,touchCancelDoesNotUpload:true});

  const encoding=await fixture({mode:'delayed-encode'}),encodingForm=await open(encoding,'guest');editor=await choose(encoding,'guest');
  await encodingForm.locator('[name=name]').fill('合成取消编码仍保留');await editor.locator('[data-image-editor-apply]').click();await encoding.page.waitForFunction(()=>window.syntheticImageEncode.ready);
  await editor.locator('[data-image-editor-cancel]').click();await encoding.page.evaluate(()=>window.syntheticImageEncode.release());await encoding.page.waitForTimeout(50);
  assert.equal(encoding.uploads.length,0);assert.equal(await encodingForm.locator('[name=portraitId]').inputValue(),seedId);assert.equal(await encodingForm.locator('[name=name]').inputValue(),'合成取消编码仍保留');await encoding.context.close();reports.push({lateEncodedPixelsDiscardedAfterCancel:true});

  for(const kind of ['guest','organization']){
    const f=await fixture({mode:'503-once'}),form=await open(f,kind);await form.locator('[name=name]').fill('合成更新期间保留资料');editor=await choose(f,kind,'shape');
    await editor.locator('[data-image-editor-apply]').click();await f.page.locator(config[kind].error).filter({hasText:/更新|稍后|暂时/u}).waitFor();await f.page.locator(config[kind].retry).waitFor({state:'visible'});
    assert.match(await f.page.locator(config[kind].error).textContent(),/更新|稍后|暂时/u);assert.equal(await form.locator('[name=name]').inputValue(),'合成更新期间保留资料');assert.equal(await form.locator(`[name=${config[kind].id}]`).inputValue(),seedId);
    assert.equal(await form.locator('button[type=submit]').isDisabled(),true,'pending image bytes cannot be bypassed by saving the form');
    await f.page.waitForTimeout(150);assert.equal(f.uploads.length,1,'503 is never automatically retried');await f.page.locator(config[kind].retry).click();await waitUploads(f,2);assert.deepEqual(f.uploads[1].payload,f.uploads[0].payload,'explicit retry preserves the prepared file');
    await waitUploaded(f,kind);assert.equal(await form.locator('[name=name]').inputValue(),'合成更新期间保留资料');await f.context.close();reports.push({kind,updateHintFriendly:true,formAndPriorImageRetained:true,explicitRetrySamePreparedFile:true,noAutomaticRetry:true});
  }

  for(const kind of ['guest','organization']){
    const f=await fixture({mode:'503-once'}),form=await open(f,kind);
    assert.equal(await form.locator('[name=publicConsent]').isChecked(),true);
    editor=await choose(f,kind,'shape');await editor.locator('[data-image-editor-apply]').click();await f.page.locator(config[kind].retry).waitFor({state:'visible'});
    assert.equal(await form.locator('[name=publicConsent]').isChecked(),true,'the original picture retains its prior authorization before a new picture is linked');
    const confirmations=f.dialogEvents.filter(type=>type==='confirm').length;
    f.setDismissConfirm(true);await f.page.locator(config[kind].close).first().click();f.setDismissConfirm(false);
    assert.equal(f.dialogEvents.filter(type=>type==='confirm').length,confirmations+1,kind+' pending image alone requires a close confirmation');
    assert.equal(await form.isVisible(),true,kind+' dismissing close keeps the image form open');
    assert.equal(await f.page.locator(config[kind].retry).isVisible(),true,kind+' dismissing close retains the prepared image');
    assert.equal(f.uploads.length,1,'dismissing close neither discards nor retries the pending image');
    await f.page.locator(kind==='guest'?'[data-guest-portrait-discard]':'[data-organization-image-discard]').click();
    assert.equal(await form.locator(`[name=${config[kind].id}]`).inputValue(),seedId);
    assert.equal(await form.locator('[name=publicConsent]').isChecked(),true,'discarding the pending photo does not revoke unchanged original data');
    editor=await choose(f,kind,'shape');await editor.locator('[data-image-editor-apply]').click();await waitUploaded(f,kind);
    assert.equal(await form.locator('[name=publicConsent]').isChecked(),false,'a successfully linked new picture requires renewed authorization');
    await f.context.close();reports.push({kind,pendingImageCloseRequiresConfirmation:true,dismissClosePreservesPreparedImage:true,discardPreservesOriginalPhotoAndAuthorization:true,newPhotoRequiresRenewedConsent:true});
  }

  for(const kind of ['guest','organization']){
    const f=await fixture({mode:'401-once'}),form=await open(f,kind);await form.locator('[name=name]').fill('PRIVATE-STALE-IMAGE-FORM');editor=await choose(f,kind,'shape');await editor.locator('[data-image-editor-apply]').click();
    await f.page.locator('[data-admin-login-panel]:visible').waitFor();assert.equal(await f.page.locator('[data-image-editor]').count(),0,kind+' editor canvas removed');assert.equal(await form.locator(`[name=${config[kind].id}]`).inputValue(),'',kind+' private image reference cleared');assert.equal(await form.locator('[name=name]').inputValue(),'',kind+' private form cleared');
    assert.deepEqual(await form.locator('input[type=hidden]').evaluateAll(inputs=>inputs.map(input=>input.value)),Array(await form.locator('input[type=hidden]').count()).fill(''),kind+' hidden record references cleared');
    await login(f.page);await open(f,kind);assert.doesNotMatch(await form.locator('[name=name]').inputValue(),/PRIVATE-STALE/u);assert.equal(await f.page.locator(config[kind].retry).isVisible(),false);assert.equal(f.uploads.length,1);await f.context.close();reports.push({kind,expiredSessionClearsPreparedFileAndCanvas:true,newAccountDoesNotReuseOldForm:true});
  }

  for(const mode of ['late-first','late-401-ignore-abort']){
    const late=await fixture({mode});await open(late,'organization');editor=await choose(late,'organization','shape');await editor.locator('[data-image-editor-apply]').click();await waitUploads(late,1);
    await late.page.locator(config.organization.close).first().click();await late.page.locator('[data-admin-logout]').click();await late.page.locator('[data-admin-login-panel]:visible').waitFor();await login(late.page);
    const current=await open(late,'organization');await current.locator('[name=name]').fill('合成新账号当前编辑');await late.release();await late.page.waitForTimeout(50);
    assert.equal(await late.page.locator('[data-admin-workspace]').isVisible(),true,mode+' must not clear the new session');
    assert.equal(await current.locator('[name=name]').inputValue(),'合成新账号当前编辑');assert.equal(await current.locator('[name=logoId]').inputValue(),seedId);assert.equal(await late.page.locator('[data-image-editor]').count(),0);await late.context.close();reports.push({mode,abortedLateUploadCannotChangeNewAccount:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
