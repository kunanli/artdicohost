// Actual Chromium + isolated runtime. All identities, capabilities, mail and OSS are synthetic.
// Execute only after the parent freezes the matching source and dist; never contacts production.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/invitation-v2');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {eventConfig}=await import(pathToFileURL(resolve(source,'src/config/event.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const VERSION='ggj2026-poster-v2',AT='2026-10-21T09:00:00.000Z',reports=[],errors=[];
const MIXED_NAME='合成Name'.repeat(20),PUBLIC_NAME='合成Name'.repeat(13),LONG_VENUE='合成完整场地'.repeat(50);
assert.equal(MIXED_NAME.length,120);assert.equal(LONG_VENUE.length,300);
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
const operationId=()=>randomBytes(32).toString('base64url');
const mime=file=>({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',ttf:'font/ttf'})[extname(file).slice(1)]||'application/octet-stream';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};

async function fixture({width=390,capacity=3,mode='normal',staff=false}={}){
  const runtime=await peopleRuntimeFixture({capacity,mail:false}),session=await runtime.login();
  const context=await browser.newContext({viewport:{width,height:900},acceptDownloads:true});
  // Deliberately install a staff cookie even on public cases to prove credential omission.
  const[name,...value]=session.Cookie.split('=');await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(15000);await page.clock.setFixedTime(new Date(AT));
  const calls=[],assets=[],downloads=[],fontHolds=[],assetHolds=[];let fontMode=mode,holdAsset=false,expireNextStaff=false;
  await context.addInitScript(()=>{
    const records=[],created=new Set(),revoked=new Set(),originalFill=CanvasRenderingContext2D.prototype.fillText,originalBlob=HTMLCanvasElement.prototype.toBlob;
    const originalCreate=URL.createObjectURL.bind(URL),originalRevoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=value=>{const url=originalCreate(value);created.add(url);return url;};URL.revokeObjectURL=url=>{revoked.add(url);return originalRevoke(url);};
    CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){const box=this.measureText(String(text));records.push({text:String(text),font:this.font,x,y,left:x-box.actualBoundingBoxLeft,right:x+box.actualBoundingBoxRight,top:y-box.actualBoundingBoxAscent,bottom:y+box.actualBoundingBoxDescent});return originalFill.call(this,text,x,y,...rest);};
    const blob={arm:false,held:false,releases:[],calls:0,completed:0};
    HTMLCanvasElement.prototype.toBlob=function(callback,...options){blob.calls++;const done=value=>{blob.completed++;callback(value);};if(blob.arm){blob.arm=false;blob.held=true;blob.releases.push(()=>originalBlob.call(this,done,...options));return;}return originalBlob.call(this,done,...options);};
    globalThis.__posterProbe={records,created,revoked,blob,releaseBlobs(){const all=blob.releases.splice(0);blob.held=false;for(const release of all)release();},reset(){records.length=0;}};
  });
  page.on('pageerror',error=>errors.push(mode+': '+error.message));page.on('dialog',dialog=>dialog.accept());page.on('download',download=>downloads.push(download));
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;assert.ok([SITE,API].includes(url.origin),'every browser origin must be intercepted');
    if(url.origin===API&&path.startsWith('/api/')){
      const headers=await req.allHeaders(),body=req.postData()?JSON.parse(req.postData()):null,entry={path,method:req.method(),body,headers};calls.push(entry);
      if(path==='/api/admin/registration/confirmation'){
        assert.equal(headers.cookie,undefined,'private receipt requests omit the staff cookie');assert.equal(headers.referer,undefined,'capability must not become a Referer');
        assert.deepEqual(Object.keys(body),['receiptToken']);assert.equal(url.search,'');
      }else if(!staff)assert.equal(/\/api\/admin\/(?:contacts|intent-invitations|registration-confirmation|admissions)/u.test(path),false,'public PNG cannot write staff invitation or dispatch history');
      if(expireNextStaff&&path==='/api/admin/contacts'){expireNextStaff=false;return route.fulfill(json({},401));}
      const response=await runtime.app.handle(new Request(req.url(),{method:req.method(),headers,...(['GET','HEAD'].includes(req.method())?{}:{body:req.postData()})}));entry.status=response.status;
      return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
    }
    if(path==='/__test__/invitation-harness/')return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><canvas data-native-canvas></canvas><script type="module">import * as renderer from "/__test_source__/src/lib/invitation-renderer.mjs";globalThis.__posterNative={renderer,canvas:document.querySelector("canvas")};</script>'});
    const isSource=path.startsWith('/__test_source__/'),base=isSource?source:dist;
    const pathname=isSource?path.slice('/__test_source__'.length):(path.endsWith('/')?path+'index.html':path),file=resolve(base,'.'+pathname);assert.ok(file.startsWith(base+'/'));
    if(/\.(?:woff2|ttf)$/u.test(path)){
      assets.push({path,kind:'font'});
      if(fontMode==='font-slow'){const gate=deferred();fontHolds.push(gate);await gate.promise;}
      if(fontMode==='font-missing')return route.fulfill({status:404,body:''});
      if(fontMode==='font-bad')return route.fulfill({status:200,contentType:mime(file),body:'SYNTHETIC_INVALID_FONT'});
    }else if(/\/invitations\/.+\.(?:png|webp)$/u.test(path)){
      assets.push({path,kind:'poster'});if(holdAsset){holdAsset=false;const gate=deferred();assetHolds.push(gate);await gate.promise;}
    }
    try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  async function api(path,{method='GET',body}={}){const response=await runtime.app.handle(runtime.request(path,{method,body,headers:session}));const value=await response.json();assert.equal(response.status,200);return value;}
  async function admission(method,registrationId,extra={}){const current=await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]});const result=await runtime.app.registrationService[method]({actor:runtime.users[0],expectedRevision:current.revision,operationId:operationId(),registrationId,...extra});assert.ok(['updated','replayed'].includes(result.outcome),method);return result;}
  return{runtime,session,context,page,calls,assets,downloads,api,admission,fontHolds,assetHolds,
    setFontMode:value=>{fontMode=value;},holdNextPoster:()=>{holdAsset=true;},releaseFonts:()=>{for(const hold of fontHolds.splice(0))hold.resolve();},releasePosters:()=>{for(const hold of assetHolds.splice(0))hold.resolve();},expireNextStaff:()=>{expireNextStaff=true;},
    async close(){for(const hold of[...fontHolds,...assetHolds])hold.resolve();await context.close();}};
}
async function harness(f){await f.page.goto(SITE+'/__test__/invitation-harness/',{waitUntil:'networkidle'});await f.page.waitForFunction(()=>Boolean(globalThis.__posterNative));}
const settings=(name=MIXED_NAME,venue='深圳前海5号楼3F')=>({recipientName:name,date:'2026-12-05',time:'10:00–18:00',venue,confirmed:true,renderVersion:VERSION});
async function renderNative(f,input=settings()){
  return f.page.evaluate(async input=>{const{renderer,canvas}=globalThis.__posterNative;globalThis.__posterProbe.reset();const metadata=await renderer.renderInvitation(canvas,input),png=await renderer.invitationPngBlob(canvas);globalThis.__posterNative.png=png;const bitmap=await createImageBitmap(png),dimensions=[bitmap.width,bitmap.height];bitmap.close();return{metadata,dimensions,size:png.size,type:png.type,records:globalThis.__posterProbe.records,faces:[...document.fonts].map(face=>({family:face.family,weight:face.weight,status:face.status}))};},input);
}
async function seedPublic(f,name=PUBLIC_NAME,status='confirmed'){
  if(status==='waitlisted'){const first=await f.runtime.seedPublic({intake:'general-v2',name:'合成占位申请人',email:'synthetic.occupied@example.invalid'});await f.runtime.approvePublic(first.reference_code);}
  const result=await f.runtime.seedPublic({intake:'general-v2',name,email:'synthetic.poster@example.invalid'});assert.ok(result.confirmation?.confirmationUrl);
  if(['confirmed','waitlisted','withdrawn','crew'].includes(status))await f.runtime.approvePublic(result.reference_code);
  if(status==='rejected'){const current=await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]});await f.api('/api/admin/admissions/reject',{method:'POST',body:{registrationId:result.reference_code,expectedRevision:current.revision,operationId:operationId()}});}
  if(status==='withdrawn')await f.admission('withdrawAdmission',result.reference_code);
  if(status==='crew')await f.admission('setAdmissionKind',result.reference_code,{kind:'crew'});
  return result;
}
async function openReceipt(f,receipt){await f.page.goto(receipt.confirmation?.confirmationUrl||receipt.confirmationUrl,{waitUntil:'networkidle'});await f.page.locator('[data-confirmation-content]:visible').waitFor();}
async function generatePrivate(f){await f.page.locator('[data-confirmation-invitation]').click();await f.page.locator('[data-confirmation-invitation-download]:visible').waitFor();await f.page.locator('[data-confirmation-invitation-image]').evaluate(image=>image.decode());}
async function assertNoPrivatePng(f){assert.equal(await f.page.locator('[data-confirmation-invitation-preview]').isVisible(),false);assert.equal(await f.page.locator('[data-confirmation-invitation-download]').getAttribute('href'),null);}
async function checkPng(bytes){assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(bytes.readUInt32BE(16),1080);assert.equal(bytes.readUInt32BE(20),1920);}
async function privateBytes(f){const pending=f.page.waitForEvent('download');await f.page.locator('[data-confirmation-invitation-download]').click();const download=await pending;assert.equal(download.suggestedFilename(),'artdico-host-invitation.png');const bytes=await readFile(await download.path());await checkPng(bytes);return bytes;}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
async function assertNoSending(f){assert.equal(f.runtime.messages.length,0);assert.equal(f.calls.some(call=>/\/(?:generated|sent|manual-sent|dispatch)$/u.test(call.path)),false);}
async function waitHeld(f,key){for(let index=0;index<500&&!f[key].length;index++)await f.page.waitForTimeout(20);assert.ok(f[key].length,'synthetic '+key+' must be held');}
async function holdPrivateBlob(f){await f.page.evaluate(()=>{globalThis.__posterProbe.blob.arm=true;});await f.page.locator('[data-confirmation-invitation]').click();await f.page.waitForFunction(()=>globalThis.__posterProbe.blob.held);}
async function releasePrivateBlob(f){const previous=await f.page.evaluate(()=>globalThis.__posterProbe.blob.completed);await f.page.evaluate(()=>globalThis.__posterProbe.releaseBlobs());await f.page.waitForFunction(previous=>globalThis.__posterProbe.blob.completed>previous,previous);await f.page.waitForLoadState('networkidle');}
async function seedContact(f,name,{legacy=false}={}){
  const actor=f.runtime.users[0];let contact=(await f.runtime.createContact({name,displayName:name})).contact;
  if(legacy){const old={recipientName:name,date:eventConfig.date.value,time:eventConfig.time.start+'–'+eventConfig.time.end,venue:eventConfig.venue.address,confirmed:true};let roster=await f.runtime.app.contactsStore.read();let generated=await f.runtime.app.contactsStore.recordGenerated(contact.id,roster.revision,old,actor.id);const sent=await f.runtime.app.contactsStore.recordSent(contact.id,generated.revision,'wechat',generated.contact.invitation.generatedAt,old,actor.id);contact=sent.contact;}
  const roster=await f.runtime.app.contactsStore.read();await f.runtime.app.intentService.convertContacts({contactIds:[contact.id],expectedContactRevision:roster.revision,actor,permissionReference:'合成明确许可代登记，不使用真实名单'});
  return contact;
}
function contactRow(f,id){return f.page.locator('[data-contacts-rows] tr').filter({has:f.page.locator('[data-contact-selection="'+id+'"]')});}
async function openContacts(f,id){await f.page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await f.page.locator('[data-contacts-workspace]:visible').waitFor();await contactRow(f,id).waitFor();}
async function previewPoster(f,id){await contactRow(f,id).getByRole('button',{name:'邀请函',exact:true}).click();await f.page.locator('[data-invitation-use-poster]').click();await f.page.locator('[data-invitation-form] [name=confirmed]').check();await f.page.locator('[data-invitation-preview]').click();await f.page.locator('[data-invitation-image]:visible').waitFor();}

try{
  await mkdir(evidence,{recursive:true});
  {
    const f=await fixture();await harness(f);const value=await renderNative(f);
    const png120=await f.page.evaluate(async()=>{const bytes=new Uint8Array(await globalThis.__posterNative.png.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return btoa(binary);});await writeFile(resolve(evidence,'native-full120-name.png'),Buffer.from(png120,'base64'));
    assert.deepEqual(value.dimensions,[1080,1920]);assert.equal(value.type,'image/png');assert.ok(value.size>10000);assert.equal(value.metadata.layouts.recipientName.lines.join(''),MIXED_NAME);
    assert.ok(value.records.some(call=>call.font.includes('ARTDiCOInvitationMediumV2')));assert.ok(value.faces.some(face=>face.family.includes('ARTDiCOInvitationMediumV2')&&face.status==='loaded'));assert.ok(value.faces.some(face=>face.family.includes('ARTDiCOInvitationRegularV2')&&face.status==='loaded'));
    for(const line of value.records)assert.ok(line.left>=-1&&line.right<=1081&&line.top>=-1&&line.bottom<=1921,'real text ink must remain on the PNG canvas');
    const coldFonts=f.assets.filter(asset=>asset.kind==='font').length;assert.ok(coldFonts>=2);await renderNative(f,settings('合成WarmName'));assert.equal(f.assets.filter(asset=>asset.kind==='font').length,coldFonts,'warm renders reuse actual loaded fonts');
    const manifest=JSON.parse(await readFile(resolve(source,'docs/invitation-font-manifest.json'),'utf8')),parts=manifest.parts.filter(part=>part.id.startsWith('medium-'));
    const samples=parts.map(part=>String.fromCodePoint(part.codePointRanges.find(([start])=>start>=0x4e00)?.[0]??part.codePointRanges.find(([start])=>start>0x20)[0]));assert.equal(samples.length,3);const allParts=await renderNative(f,settings('合成'+samples.join('')));assert.equal(allParts.faces.filter(face=>face.family.includes('ARTDiCOInvitationMediumV2')&&face.status==='loaded').length,3);
    const venue=await renderNative(f,settings(MIXED_NAME,LONG_VENUE));assert.equal(venue.metadata.layouts.venue.lines.join(''),LONG_VENUE);assert.equal(venue.metadata.layouts.recipientName.lines.join(''),MIXED_NAME);
    await f.close();reports.push({realFontFaceColdAndWarm:true,full120MixedName:true,full300Venue:true,realPng1080x1920:true,noCanvasClipping:true});
  }
  for(const mode of['font-missing','font-bad']){
    const f=await fixture({mode});await harness(f);const failure=await f.page.evaluate(async input=>{const{renderer,canvas}=globalThis.__posterNative;try{await renderer.renderInvitation(canvas,input);return{failed:false};}catch(error){return{failed:true,message:error.message,alpha:canvas.getContext('2d').getImageData(0,0,1,1).data[3],textCount:globalThis.__posterProbe.records.length};}},settings());
    assert.equal(failure.failed,true);assert.match(failure.message,/字体|字形|加载|完整/u);assert.equal(failure.alpha,0);assert.equal(failure.textCount,0);await f.close();reports.push({mode,failedWithoutFallbackOrPartialPng:true});
  }
  {
    const f=await fixture({mode:'font-slow'});await harness(f);await f.page.evaluate(input=>{globalThis.__nativeCompleted=false;globalThis.__nativeWork=globalThis.__posterNative.renderer.renderInvitation(globalThis.__posterNative.canvas,input).then(value=>{globalThis.__nativeCompleted=true;return value;});},settings());await waitHeld(f,'fontHolds');
    assert.equal(await f.page.evaluate(()=>globalThis.__nativeCompleted),false);assert.equal(await f.page.evaluate(()=>globalThis.__posterProbe.records.length),0,'no text is measured/drawn using a fallback during slow font loading');f.setFontMode('normal');f.releaseFonts();const metadata=await f.page.evaluate(()=>globalThis.__nativeWork);assert.equal(metadata.layouts.recipientName.lines.join(''),MIXED_NAME);await f.close();reports.push({slowFontBlocksDrawingUntilActualLoad:true});
  }
  {
    const f=await fixture();await harness(f);await renderNative(f,settings('合成先前预览'));const result=await f.page.evaluate(async input=>{const{renderer,canvas}=globalThis.__posterNative;try{await renderer.renderInvitation(canvas,input);return{failed:false};}catch(error){return{failed:true,message:error.message,alpha:canvas.getContext('2d').getImageData(0,0,1,1).data[3]};}},settings('合成\u0378Name'));
    assert.equal(result.failed,true);assert.match(result.message,/字体|字形|支持|完整/u);assert.equal(result.alpha,0);await f.close();reports.push({missingGlyphCoverageRejected:true,previousPreviewCanvasCleared:true});
  }
  for(const width of[320,390,1440]){
    const f=await fixture({width}),receipt=await seedPublic(f);await openReceipt(f,receipt);await assertNoPrivatePng(f);const before=f.calls.filter(call=>call.path==='/api/admin/registration/confirmation').length;
    await generatePrivate(f);const after=f.calls.filter(call=>call.path==='/api/admin/registration/confirmation').length;assert.equal(after-before,2,'private PNG rechecks before and after encoding');assert.equal(f.downloads.length,0,'generation exposes a real user-gesture download link');
    const bytes=await privateBytes(f);assert.equal(await f.page.locator('[data-confirmation-invitation-image]').evaluate(image=>image.naturalWidth),1080);await noOverflow(f.page);await assertNoSending(f);
    await writeFile(resolve(evidence,'private-poster-'+width+'.png'),bytes);await f.page.screenshot({path:resolve(evidence,'private-confirmation-'+width+'.png'),fullPage:true});await f.close();reports.push({width,confirmedPrivatePng:true,twoFreshReads:true,gestureDownloadGenericFilename:true,privateCookieAndRefererOmitted:true,noSendingOrHistoryMutation:true,noPageOverflow:true});
  }
  for(const status of['pending_review','waitlisted','rejected','withdrawn']){
    const f=await fixture({capacity:status==='waitlisted'?1:3}),receipt=await seedPublic(f,'合成资格检查',status);await openReceipt(f,receipt);assert.equal(await f.page.locator('[data-confirmation-invitation]').isVisible(),false);await assertNoPrivatePng(f);assert.equal(f.assets.some(asset=>asset.kind==='font'),false);await assertNoSending(f);await f.close();reports.push({status,formalPrivatePngNotOffered:true});
  }
  {
    const f=await fixture(),receipt=await seedPublic(f,'合成公开来源工作人员','crew');await openReceipt(f,receipt);await generatePrivate(f);await privateBytes(f);await assertNoSending(f);await f.close();reports.push({publicSourceConfirmedCrewStillEligible:true});
  }
  {
    const f=await fixture();const saved=await f.runtime.app.registrationService.submitStaffRegistration({sourceContactId:'synthetic-poster-staff-assisted',actor:f.runtime.users[0],input:{fields:{name:'合成人工代录',email:'synthetic.staff@example.invalid'},permissionReference:'合成明确登记授权'}});assert.ok(saved.receipt);const receipt=await f.runtime.app.confirmationService.forSavedReceipt({receipt:saved.receipt,notify:false});await openReceipt(f,receipt);assert.equal(await f.page.locator('[data-confirmation-invitation]').isVisible(),false);await assertNoPrivatePng(f);await assertNoSending(f);await f.close();reports.push({staffAssistedSourceCannotUsePublicPng:true});
  }
  {
    const f=await fixture(),first=await seedPublic(f,'合成旧私人身份'),second=await seedPublic(f,'合成新私人身份');await openReceipt(f,first);await holdPrivateBlob(f);await f.page.evaluate(url=>{location.hash=new URL(url).hash;},second.confirmation.confirmationUrl);await f.page.locator('[data-confirmation-name]').filter({hasText:'合成新私人身份'}).waitFor();await releasePrivateBlob(f);await assertNoPrivatePng(f);assert.equal(f.downloads.length,0);await generatePrivate(f);await privateBytes(f);await assertNoSending(f);await f.close();reports.push({hashIdentityChangeCancelsOldEncodedPng:true,newIdentityCanGenerateAfterCancellation:true});
  }
  {
    const f=await fixture(),receipt=await seedPublic(f,'合成离页私人身份');await openReceipt(f,receipt);await holdPrivateBlob(f);await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));await releasePrivateBlob(f);await assertNoPrivatePng(f);assert.equal(f.downloads.length,0);assert.equal(await f.page.locator('[data-confirmation-name]').textContent(),'');await f.page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await f.page.locator('[data-confirmation-name]').filter({hasText:'合成离页私人身份'}).waitFor();await generatePrivate(f);await privateBytes(f);await f.close();reports.push({pagehideClearsPrivatePngAndName:true,bfcacheRechecksBeforeNewPng:true});
  }
  {
    const f=await fixture(),receipt=await seedPublic(f,'合成生成途中撤回');await openReceipt(f,receipt);await holdPrivateBlob(f);await f.admission('withdrawAdmission',receipt.reference_code);await releasePrivateBlob(f);await f.page.locator('[data-confirmation-action-status]').filter({hasText:/更新|重新核对/u}).waitFor();await assertNoPrivatePng(f);assert.equal(f.downloads.length,0);await assertNoSending(f);await f.close();reports.push({withdrawalDuringEncodingRejectedBySecondFreshRead:true});
  }
  {
    const f=await fixture(),receipt=await seedPublic(f,'合成不受他人修订影响');await openReceipt(f,receipt);await holdPrivateBlob(f);await seedPublic(f,'合成另一位新核准人员');await releasePrivateBlob(f);await f.page.locator('[data-confirmation-invitation-download]:visible').waitFor();await privateBytes(f);await assertNoSending(f);await f.close();reports.push({unrelatedGlobalRevisionDoesNotCancelEligibleOwnPng:true});
  }
  {
    const f=await fixture({mode:'font-slow'}),first=await seedPublic(f,'合成慢字体旧身份'),second=await seedPublic(f,'合成慢字体新身份');await openReceipt(f,first);await f.page.locator('[data-confirmation-invitation]').click();await waitHeld(f,'fontHolds');await f.page.evaluate(url=>{location.hash=new URL(url).hash;},second.confirmation.confirmationUrl);await f.page.locator('[data-confirmation-name]').filter({hasText:'合成慢字体新身份'}).waitFor();f.setFontMode('normal');f.releaseFonts();await f.page.waitForLoadState('networkidle');await assertNoPrivatePng(f);assert.equal(f.downloads.length,0);await generatePrivate(f);await privateBytes(f);await f.close();reports.push({identityChangeDuringFontLoadNeverExposesOldPng:true});
  }
  {
    const f=await fixture(),first=await seedPublic(f,'合成慢海报旧身份'),second=await seedPublic(f,'合成慢海报新身份');await openReceipt(f,first);f.holdNextPoster();await f.page.locator('[data-confirmation-invitation]').click();await waitHeld(f,'assetHolds');
    await f.page.evaluate(url=>{location.hash=new URL(url).hash;},second.confirmation.confirmationUrl);await f.page.locator('[data-confirmation-name]').filter({hasText:'合成慢海报新身份'}).waitFor();f.releasePosters();await f.page.waitForLoadState('networkidle');await assertNoPrivatePng(f);assert.equal(f.downloads.length,0);await generatePrivate(f);await privateBytes(f);await assertNoSending(f);await f.close();reports.push({identityChangeDuringPosterLoadNeverExposesOldPng:true});
  }
  {
    const f=await fixture(),first=await seedPublic(f,'合成已生成私人身份'),second=await seedPublic(f,'合成替代私人身份');await openReceipt(f,first);await generatePrivate(f);const previous=await f.page.locator('[data-confirmation-invitation-download]').getAttribute('href');assert.match(previous,/^blob:/u);
    await f.page.evaluate(url=>{location.hash=new URL(url).hash;},second.confirmation.confirmationUrl);await f.page.locator('[data-confirmation-name]').filter({hasText:'合成替代私人身份'}).waitFor();await assertNoPrivatePng(f);assert.equal(await f.page.locator('[data-confirmation-invitation-image]').getAttribute('src'),null);assert.equal(await f.page.evaluate(url=>globalThis.__posterProbe.revoked.has(url),previous),true);await assertNoSending(f);await f.close();reports.push({identityChangeRevokesAlreadyPreparedPrivateBlob:true});
  }
  {
    const f=await fixture({staff:true}),person=await seedContact(f,'合成历史邀约人',{legacy:true}),legacy=structuredClone(person.invitation);await openContacts(f,person.id);
    await contactRow(f,person.id).getByRole('button',{name:'邀请函',exact:true}).click();assert.equal(await f.page.locator('[data-invitation-form] [name=time]').inputValue(),legacy.settings.time);assert.equal(await f.page.locator('[data-invitation-form] [name=venue]').inputValue(),legacy.settings.venue);assert.match(await f.page.locator('[data-invitation-version]').textContent(),/旧|历史/u);
    await f.page.locator('[data-invitation-use-poster]').click();assert.equal(await f.page.locator('[data-invitation-form] [name=confirmed]').isChecked(),false);assert.equal(await f.page.locator('[data-invitation-form] [name=time]').inputValue(),'10:00–18:00');assert.equal(await f.page.locator('[data-invitation-form] [name=venue]').inputValue(),'深圳前海5号楼3F');assert.deepEqual(f.calls.filter(call=>call.method!=='GET'),[],'opening history or selecting a version does not write');
    const pending=f.page.waitForEvent('download');await f.page.locator('[data-registration-invitation-poster="'+person.id+'"]').click();const download=await pending;await checkPng(await readFile(await download.path()));
    const roster=await f.runtime.app.contactsStore.read(),current=roster.contacts.find(item=>item.id===person.id);assert.deepEqual(current.invitation,legacy,'new ledger preparation keeps the original five-field manual history unchanged');
    const intent=await f.runtime.app.intentService.read({actor:f.runtime.users[0]}),newManual=intent.invitations.find(item=>item.channel==='manual'&&item.content?.settings?.renderVersion===VERSION);assert.ok(newManual);assert.equal(newManual.status,'prepared');
    const{contactProgress}=await import(pathToFileURL(resolve(source,'shared/organizer-progress.mjs')));const progress=contactProgress(current,{intent,event:eventConfig,now:Date.parse(AT)});assert.equal(progress.historyManuallySent,true);assert.equal(progress.manuallySent,false);assert.equal(progress.contacted,true);assert.equal(f.calls.some(call=>/\/(?:sent|manual-sent|dispatch)$/u.test(call.path)),false);assert.equal(f.runtime.messages.length,0);
    await f.page.screenshot({path:resolve(evidence,'staff-legacy-and-poster.png'),fullPage:true});await f.close();reports.push({legacyHistoryKeptUnchanged:true,explicitVersionSwitchOnly:true,newPreparedIsNotCurrentSent:true,historicalContactStillCounted:true,manualV2ActualPngDownload:true});
  }
  {
    const f=await fixture({staff:true}),person=await seedContact(f,MIXED_NAME);await openContacts(f,person.id);await previewPoster(f,person.id);await f.page.locator('[data-invitation-image]').evaluate(image=>image.decode());assert.equal(await f.page.locator('[data-invitation-image]').evaluate(image=>image.naturalWidth),1080);
    assert.equal((await f.page.evaluate(()=>globalThis.__posterProbe.records.filter(record=>record.y>=735&&record.y<873).map(record=>record.text))).join(''),MIXED_NAME);const pending=f.page.waitForEvent('download');await f.page.locator('[data-invitation-download]').click();await checkPng(await readFile(await(await pending).path()));await f.page.locator('[data-contacts-status]').filter({hasText:'已记录生成时间'}).waitFor();const saved=(await f.runtime.app.contactsStore.read()).contacts.find(item=>item.id===person.id);assert.equal(saved.invitation.settings.recipientName,MIXED_NAME);assert.equal(saved.invitation.settings.renderVersion,VERSION);assert.equal(saved.invitation.sentAt,null);assert.equal(f.runtime.messages.length,0);await f.close();reports.push({staffPreviewAndExplicitDownloadKeepFull120Name:true,generationNotActualDispatch:true});
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({cases:reports.length,reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await browser.close();}
