// Actual candidate homepage, synthetic publications and fully intercepted network.
// No application, approval, mail, account or publication write is permitted here.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/p5-collections');
const {createInitialContent}=await import(pathToFileURL(resolve(source,'src/config/content.mjs')));
const {toPublicContent,validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {publicContentEnvelope}=await import(pathToFileURL(resolve(source,'src/lib/public-content-refresh.mjs')));
const SITE='https://artdico.host',API='https://api.artdico.host';
const PRIVATE='SYNTHETIC_P5_PRIVATE_NEVER_PUBLIC';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const coverId=createHash('sha256').update(png).digest('hex')+'.png',missingId='b'.repeat(64)+'.png';
const IDs={guest:'synthetic-guest-alpha',secondGuest:'synthetic-guest-beta',unproved:'synthetic-guest-unproved',student:'synthetic-work-student',indie:'synthetic-work-indie',legacy:'synthetic-work-team',organization:'synthetic-org',booth:'synthetic-booth',morning:'synthetic-program-a',afternoon:'synthetic-program-b',share:'synthetic-program-c'};
const longName='合成跨领域创作者与青年游戏社区分享嘉宾'.repeat(3);
const guest=(id,extra={})=>({id,name:'合成嘉宾 '+id,company:'合成创意机构',ggjRole:'',portraitId:'',status:'confirmed',publicConsent:false,contactId:PRIVATE+'-'+id,internalNotes:PRIVATE,title:'合成创作者',bio:'合成嘉宾介绍。\n作品与创作经验将在现场交流。',website:'',publicRoles:['guest'],...extra});
const session=(id,zone,start,end,extra={})=>({id,zone,start,end,title:'合成 '+zone+' 区交流',format:'talk',guestId:'',speakerName:'',speakerStatus:'pending',status:'scheduled',internalNotes:PRIVATE,...extra});
const work=(id,kind,extra={})=>({id,kind,title:'合成'+(kind==='student'?'学生美术与三维创作':kind==='indie'?'独立游戏':'历史团队作品'),teamName:'合成创作团队与作者'.repeat(4),summary:'合成创作说明；展示形式以现场安排为准。',coverId:'',status:'confirmed',responseStatus:'attending',publicConsent:false,participationForms:['booth'],boothId:IDs.booth,sessionId:'',organizationId:IDs.organization,school:PRIVATE,email:'private@example.invalid',wechat:PRIVATE,contactName:PRIVATE,memberCount:3,materialLinks:'https://private.invalid/'+PRIVATE,internalNotes:PRIVATE,...extra});
function rawFixture(){
 const content=createInitialContent();
 content.guests=[guest(IDs.guest,{name:longName,portraitId:coverId,publicRoles:['speaker','moderator']}),guest(IDs.secondGuest,{portraitId:missingId}),guest(IDs.unproved,{name:'合成未确认出席讲者'}),guest('synthetic-private-guest',{name:PRIVATE,visibility:'private'})];
 content.organizations=[{id:IDs.organization,name:'合成参与组织与跨地域青年创作交流网络'.repeat(3),logoId:coverId,website:'https://example.invalid/synthetic-organization',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:PRIVATE},{id:'synthetic-org-broken',name:'合成缺图组织',logoId:missingId,website:'',participation:'attendee',status:'confirmed',publicConsent:false,internalNotes:PRIVATE}];
 content.booths=[{id:IDs.booth,code:'C-32',zone:'C',slotNumber:32,organization:'合成已安排展位组织',project:'合成艺术与三维作品展示',status:'confirmed',contactName:PRIVATE,contactMethods:'private@example.invalid',internalNotes:PRIVATE,description:'合成展位说明',website:''}];
 content.sessions=[session(IDs.morning,'A','10:00','11:00',{guestId:IDs.unproved}),session(IDs.afternoon,'B','14:00','15:00',{guestId:IDs.guest,participants:[{guestId:IDs.secondGuest,roles:['moderator']}]}),session(IDs.share,'C','16:00','17:00',{format:'showcase',title:'合成作品分享与交流'}),session('synthetic-cancelled','C','17:00','17:30',{title:'合成已取消场次',status:'cancelled'})];
 content.showcases=[work(IDs.student,'student',{coverId,participationForms:['booth','share'],sessionId:IDs.share}),work(IDs.indie,'indie',{coverId:missingId}),work(IDs.legacy,'team')];
 return content;
}
function projected(raw){
 const checked=validateContent(raw);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
 const publicIds=new Set(raw.guests.filter(item=>item.visibility!=='private').map(item=>item.id));
 const value=toPublicContent(raw,{guestAttendance:{schemaVersion:1,sourceRevision:12,confirmedGuestIds:[IDs.guest,IDs.secondGuest].filter(id=>publicIds.has(id))}});
 assert.doesNotMatch(JSON.stringify(value),/SYNTHETIC_P5_PRIVATE|private\.invalid|private@example/u,'private source fields never enter the intercepted public response');
 assert.ok(publicContentEnvelope({revision:1,publishedAt:'2026-11-01T09:00:00.000Z',content:value}),'fixture must pass the actual public envelope validator');
 return value;
}
projected(rawFixture());
const mime=file=>({html:'text/html; charset=utf-8',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const pageErrors=[],reports=[];
async function fixture(width,{javascript=true,reducedMotion='no-preference',deferContent=false}={}){
 const context=await browser.newContext({viewport:{width,height:960},isMobile:width<600,hasTouch:width<600,javaScriptEnabled:javascript,reducedMotion});
 const page=await context.newPage(),calls=[];let raw=rawFixture(),revision=1,content=projected(raw),failure=false;
 let releaseInitialContent;const initialContentGate=new Promise(resolve=>{releaseInitialContent=resolve;});
 page.setDefaultTimeout(10000);page.on('pageerror',error=>pageErrors.push({width,message:error.message}));
 await context.addCookies([{name:'synthetic_staff',value:PRIVATE,domain:new URL(API).hostname,path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  assert.ok([SITE,API].includes(url.origin),'every network request stays inside intercepted origins: '+url.origin);
  assert.equal(request.method(),'GET','homepage collection browsing never performs a business write');
  calls.push({origin:url.origin,path:url.pathname,method:request.method()});
  if(url.origin===API){
   assert.equal(request.headers().cookie,undefined,'public reads omit even an available staff cookie');
   assert.equal(request.headers().authorization,undefined);
   if(url.pathname==='/api/public/content'){
    if(deferContent){deferContent=false;await initialContentGate;}
    return route.fulfill({status:failure?503:200,contentType:'application/json',headers:{'access-control-allow-origin':SITE},body:failure?'{}':JSON.stringify({revision,publishedAt:new Date(Date.UTC(2026,10,1,9,0,revision)).toISOString(),content})});
   }
   if(url.pathname.startsWith('/api/public/portraits/')){
    assert.ok([coverId,missingId].includes(url.pathname.split('/').at(-1)),'only canonical public cover/portrait resources');
    assert.equal(request.headers().referer,undefined);
    return route.fulfill(url.pathname.endsWith(coverId)?{status:200,contentType:'image/png',headers:{'access-control-allow-origin':SITE},body:png}:{status:404,body:''});
   }
   assert.equal(url.pathname,'/api/admin/registration/config','only the existing public registration configuration path is allowed');
   return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':SITE},body:JSON.stringify({enabled:false,reason:'closed'})});
  }
  assert.equal(url.pathname.startsWith('/api/'),false,'same-origin fallback must not bypass the canonical API origin');
  const path=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname;
  const file=resolve(dist,'.'+path);assert.ok(file.startsWith(dist+'/'));
  try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 async function refresh(change,{unavailable=false}={}){
  const before=calls.filter(call=>call.path==='/api/public/content').length;
  if(change){change(raw);revision++;content=projected(raw);}
  failure=unavailable;
  await page.waitForTimeout(1100);
  const response=page.waitForResponse(response=>response.url()===API+'/api/public/content');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await response;
  await page.waitForFunction(()=>!document.querySelector('[data-public-content-status]')?.textContent?.includes('正在读取'));
  await page.waitForTimeout(80);
  assert.equal(calls.filter(call=>call.path==='/api/public/content').length,before+1,'one bounded public refresh');
 }
 return {context,page,width,calls,refresh,releaseInitialContent,get raw(){return raw;}};
}
async function noOverflow(f){assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal overflow at '+f.width+'px');}
async function settledScroll(f){
 return f.page.evaluate(()=>new Promise((resolve,reject)=>{
  const started=performance.now();let previousX=scrollX,previousY=scrollY,stableFrames=0;
  function sample(now){
   const currentX=scrollX,currentY=scrollY;
   stableFrames=Math.abs(currentX-previousX)<.5&&Math.abs(currentY-previousY)<.5?stableFrames+1:0;
   previousX=currentX;previousY=currentY;
   if(stableFrames>=6){resolve({x:currentX,y:currentY});return;}
   if(now-started>=3000){reject(new Error('Scrolling did not settle within 3 seconds'));return;}
   requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
 }));
}
const visibleWork=f=>f.page.locator('[data-showcase-id]:visible');
async function selected(f,id){await f.page.locator('#work-'+id+':visible').waitFor();assert.equal(await visibleWork(f).count(),1,'a manual carousel displays one selected item');}
async function activeZone(f,zone){assert.equal(await f.page.locator('[data-zone="'+zone+'"]').getAttribute('aria-selected'),'true');assert.equal(await f.page.locator('[data-agenda-panel="'+zone+'"]').isVisible(),true);}
async function screenshot(f,name){await noOverflow(f);const path=resolve(evidence,name+'-'+f.width+'.png');await f.page.screenshot({path,fullPage:true});return path;}
async function swipe(f,direction){
 const card=visibleWork(f);await card.scrollIntoViewIfNeeded();const box=await card.boundingBox();assert.ok(box);
 const middle=box.x+box.width/2,y=Math.min(box.y+80,800),offset=Math.min(85,box.width/3);
 const cdp=await f.context.newCDPSession(f.page);
 try{await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:middle-direction*offset,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:middle+direction*offset,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}finally{await cdp.detach();}
}
await mkdir(evidence,{recursive:true});
try{
 for(const width of [320,390,1440]){
  const f=await fixture(width),{page}=f;
  try{
   await page.goto(SITE+'/#program-'+IDs.afternoon,{waitUntil:'networkidle'});
   await page.locator('#guest-'+IDs.guest).waitFor();await selected(f,IDs.student);await activeZone(f,'B');
   assert.equal(await page.locator('[data-guest-id]').count(),2,'only guest cards backed by server attendance proof');
   assert.equal(await page.locator('#guest-'+IDs.unproved).count(),0,'a scheduled profile does not prove attendance');
   assert.match(await page.locator('#program-'+IDs.morning).textContent(),/合成未确认出席讲者.*安排待确认/u,'unconfirmed schedule associations remain readable');
   assert.match(await page.locator('#program-synthetic-cancelled').textContent(),/已取消/u);
   assert.deepEqual(await page.locator('[data-public-works-filter] option').evaluateAll(options=>options.map(option=>option.value)),['all','student','indie'],'legacy team is readable without a new classification option');
   assert.equal(await page.locator('[data-showcase-id]').count(),3);
   assert.match(await page.locator('[data-public-works-count]').textContent(),/1\s*\/\s*3/u);
   assert.doesNotMatch(await page.locator('#students').textContent(),/我有作品想展示|展位申请|下一个被玩到|展位试玩/u,'art and 3D works are not all labelled playable');
   assert.equal(await page.locator('#booths-heading').textContent(),'参与组织');
   await page.locator('#organization-'+IDs.organization).scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('[data-organization-id="synthetic-org"] img')?.naturalWidth>0);
   assert.equal(await page.locator('#organization-'+IDs.organization+' img').evaluate(image=>getComputedStyle(image).objectFit),'contain');
   await page.waitForFunction(()=>document.querySelector('[data-organization-id="synthetic-org-broken"] .ah-organization-image')?.hidden===true);
   await noOverflow(f);

   const alpha=page.locator('#guest-'+IDs.guest+' details'),alphaToggle=alpha.locator('[data-guest-toggle]'),beta=page.locator('#guest-'+IDs.secondGuest+' details');
   await alphaToggle.scrollIntoViewIfNeeded();
   if(width===1440){
    await alphaToggle.hover();await page.waitForFunction(id=>document.querySelector('#guest-'+id+' details')?.open,IDs.guest);
    await alpha.locator('.ah-guest-detail-body').hover();await page.waitForTimeout(200);assert.equal(await alpha.evaluate(node=>node.open),true,'moving from bubble into its own detail body keeps the card open');
    await page.mouse.move(0,0);await page.waitForTimeout(60);assert.equal(await alpha.evaluate(node=>node.open),true,'desktop close has a grace interval');
    await alphaToggle.hover();await page.waitForTimeout(200);assert.equal(await alpha.evaluate(node=>node.open),true,'re-entering during the grace interval cancels the pending close');
    await page.mouse.move(0,0);
    await page.waitForFunction(id=>!document.querySelector('#guest-'+id+' details')?.open,IDs.guest);
   }
   await alphaToggle.focus();await page.keyboard.press('Enter');assert.equal(await alpha.evaluate(node=>node.open),true,'keyboard opens the same guest bubble');
   assert.match(await alpha.textContent(),/讲者.*主持人/u);assert.match(await alpha.textContent(),/合成创意机构.*合成嘉宾介绍/su);
   if(width===1440){
    const focusedLink=alpha.locator('a[href="#program-'+IDs.afternoon+'"]');
    await focusedLink.focus();await beta.locator('[data-guest-toggle]').hover();await page.waitForTimeout(200);
    assert.equal(await alpha.evaluate(node=>node.open),true,'hovering a different guest does not close the guest being used by keyboard');
    assert.equal(await beta.evaluate(node=>node.open),false,'passive hover cannot replace a guest that contains keyboard focus');
    assert.equal(await focusedLink.evaluate(node=>document.activeElement===node),true,'mixed pointer use does not hide or move the focused guest link');
   }
   await beta.locator('[data-guest-toggle]').click();assert.equal(await beta.evaluate(node=>node.open),true);assert.equal(await alpha.evaluate(node=>node.open),false,'only one guest disclosure stays open');
   if(width===1440)assert.equal(await beta.locator('[data-guest-toggle]').evaluate(node=>document.activeElement===node),true,'an explicit click still switches guest and focus');
   await beta.locator('[data-guest-toggle]').click();assert.equal(await beta.evaluate(node=>node.open),false,'a mobile click can close its bubble');
   await alphaToggle.click();await alpha.locator('a[href="#program-'+IDs.afternoon+'"]').click();await activeZone(f,'B');assert.equal(await page.locator('#program-'+IDs.afternoon).isVisible(),true);

   await page.locator('[data-public-work-next]').click();await selected(f,IDs.indie);
   await page.waitForFunction(id=>document.querySelector('#work-'+id+' .ah-showcase-cover-empty')?.hidden===false,IDs.indie);
   await page.locator('[data-public-work-next]').click();await selected(f,IDs.legacy);assert.equal(await page.locator('#work-'+IDs.legacy+' .ah-showcase-category').textContent(),'待分类');
   await page.locator('[data-public-work-prev]').focus();await page.keyboard.press('Enter');await selected(f,IDs.indie);
   await page.locator('[data-public-works-filter]').selectOption('student');await selected(f,IDs.student);
   assert.equal(await page.locator('[data-public-work-next]').isDisabled(),true);assert.equal(await page.locator('[data-public-work-prev]').isDisabled(),true,'a single-item subset has no fictitious next item');
   await page.locator('[data-public-works-filter]').selectOption('all');await selected(f,IDs.student);
   if(width<600){await swipe(f,-1);await selected(f,IDs.indie);await swipe(f,1);await selected(f,IDs.student);}
   await page.locator('[data-public-works-filter]').selectOption('student');
   const preview=page.locator('#work-'+IDs.student+' [data-work-preview]'),lightbox=page.locator('[data-work-lightbox]');
   const sourceCover=await page.locator('#work-'+IDs.student+' img').getAttribute('src');
   await preview.click();await lightbox.waitFor({state:'visible'});assert.equal(await lightbox.locator('img').getAttribute('src'),sourceCover,'preview reuses the same public cover');
   await page.keyboard.press('Escape');await lightbox.waitFor({state:'hidden'});assert.equal(await preview.evaluate(node=>document.activeElement===node),true,'Escape returns focus to the opening cover');
   await preview.click();await lightbox.locator('[data-work-lightbox-close]').focus();
   await f.refresh(raw=>{raw.showcases.reverse();raw.showcases.find(work=>work.id===IDs.student).title='合成刷新后的学生作品';});
   await lightbox.waitFor({state:'visible'});assert.equal(await lightbox.locator('[data-work-lightbox-close]').evaluate(node=>document.activeElement===node),true,'refresh preserves preview focus');
   assert.equal(await page.locator('[data-public-works-filter]').inputValue(),'student');await selected(f,IDs.student);
   await lightbox.locator('[data-work-lightbox-close]').click();

   await alphaToggle.click();if(!await alpha.evaluate(node=>node.open))await alphaToggle.click();await alphaToggle.focus();
   await f.refresh(raw=>{raw.guests.reverse();raw.guests.find(guest=>guest.id===IDs.guest).bio='合成刷新后的嘉宾介绍';});
   assert.equal(await page.locator('#guest-'+IDs.guest+' details').evaluate(node=>node.open),true);assert.equal(await page.locator('#guest-'+IDs.guest+' [data-guest-toggle]').evaluate(node=>document.activeElement===node),true,'refresh restores the same guest and keyboard focus after reorder');
   await page.locator('#guest-'+IDs.guest+' a[href="#program-'+IDs.afternoon+'"]').click();await activeZone(f,'B');
   await page.locator('[data-program-period]').selectOption('afternoon');await page.locator('[data-program-period]').focus();
   const beforeRefreshScroll=(await settledScroll(f)).y;
   await f.refresh(raw=>{raw.sessions.find(session=>session.id===IDs.afternoon).title='合成刷新后的 B 区交流';});
   await activeZone(f,'B');assert.equal(await page.locator('[data-program-period]').inputValue(),'afternoon');assert.equal(await page.locator('[data-program-period]').evaluate(node=>document.activeElement===node),true);
   assert.ok(Math.abs(await page.evaluate(()=>scrollY)-beforeRefreshScroll)<=32,'content refresh does not jump the current timetable position');
   await page.locator('[data-zone="B"]').focus();const beforeKeyboardScroll=(await settledScroll(f)).y;
   await page.keyboard.press('ArrowRight');await activeZone(f,'C');assert.equal(await page.locator('[data-zone="C"]').evaluate(node=>document.activeElement===node),true);
   await page.keyboard.press('Home');await activeZone(f,'A');await page.keyboard.press('End');await activeZone(f,'C');
   assert.ok(Math.abs(await page.evaluate(()=>scrollY)-beforeKeyboardScroll)<=8,'keyboard tab changes preserve scroll position');
   assert.equal(await page.locator('[data-zone][aria-selected="true"]').count(),1,'the timetable has one selected area');
   for(const[zone,color]of[['A','#8655ff'],['B','#ff7913'],['C','#54c7ef']]){
    assert.equal((await page.locator('[data-zone="'+zone+'"]').evaluate(node=>getComputedStyle(node).getPropertyValue('--ah-zone-color'))).trim().toLowerCase(),color,'each area has its documented theme color');
   }
   await page.evaluate(id=>{location.hash='#program-'+id;},IDs.morning);await activeZone(f,'A');assert.equal(await page.locator('[data-program-period]').inputValue(),'all','deep links reveal sessions hidden by a time filter');
   assert.equal(await page.locator('#program-'+IDs.morning).isVisible(),true);
   await page.locator('[data-public-works-filter]').selectOption('student');await page.locator('#work-'+IDs.student+' a[href="#program-'+IDs.share+'"]').click();await activeZone(f,'C');assert.equal(await page.locator('#program-'+IDs.share).isVisible(),true);
   await page.locator('#work-'+IDs.student+' a[href="#booth-'+IDs.booth+'"]').click();assert.equal(await page.locator('.ah-exhibition-details').evaluate(node=>node.open),true);
   await page.locator('#booth-'+IDs.booth+' a[href="#work-'+IDs.indie+'"]').click();await selected(f,IDs.indie);assert.equal(await page.locator('[data-public-works-filter]').inputValue(),'all','reverse booth link reveals a work excluded by the current filter');
   const screenshots=[await screenshot(f,'collections')];

   // A failed public read preserves the most recently verified cards and selection.
   await f.refresh(null,{unavailable:true});await selected(f,IDs.indie);assert.match(await page.locator('[data-public-content-status]').textContent(),/仍显示上次核对/u);
   await page.locator('#guest-'+IDs.guest+' [data-guest-toggle]').focus();
   await f.refresh(raw=>{raw.guests=raw.guests.filter(guest=>guest.id!==IDs.guest);raw.sessions.forEach(session=>{if(session.guestId===IDs.guest)session.guestId='';});});
   assert.equal(await page.locator('#guest-'+IDs.guest).count(),0);assert.equal(await page.locator('#guests-heading').evaluate(node=>document.activeElement===node),true,'removing the focused guest lands on the guest heading');
   await page.locator('[data-public-works-filter]').selectOption('student');await page.locator('#work-'+IDs.student+' [data-work-preview]').click();
   await f.refresh(raw=>{raw.showcases=raw.showcases.filter(work=>work.id!==IDs.student);});
   assert.equal(await lightbox.isVisible(),false,'withdrawing the previewed work closes the dialog');assert.equal(await page.locator('#students-heading').evaluate(node=>document.activeElement===node),true,'withdrawn work does not strand focus in a removed dialog');
   assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),true);
   await page.locator('#organization-'+IDs.organization+' a.ah-organization-card').focus();
   await f.refresh(raw=>{raw.organizations=raw.organizations.filter(organization=>organization.id!==IDs.organization);raw.showcases.forEach(work=>{delete work.organizationId;});});
   assert.equal(await page.locator('#booths-heading').evaluate(node=>document.activeElement===node),true,'withdrawn organization returns focus to its section heading');
   await f.refresh(raw=>{raw.showcases=[];raw.guests=[];raw.organizations=[];raw.booths=[];raw.sessions=[];});
   assert.equal(await page.locator('[data-showcase-id],[data-guest-id],[data-organization-id],[data-booth-id]').count(),0);assert.equal(await page.locator('[data-public-showcases-empty]').isVisible(),true);assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),false);
   await noOverflow(f);
   await f.refresh(raw=>{raw.showcases=[work('synthetic-only','indie',{participationForms:[],boothId:'',organizationId:''})];});
   await page.locator('[data-public-works-filter]').selectOption('all');await selected(f,'synthetic-only');assert.equal(await page.locator('[data-public-work-prev]').isDisabled(),true);assert.equal(await page.locator('[data-public-work-next]').isDisabled(),true);
   screenshots.push(await screenshot(f,'single-work'));
   assert.doesNotMatch(await page.locator('body').textContent(),/SYNTHETIC_P5_PRIVATE|private\.invalid|private@example/u);
   assert.equal(f.calls.some(call=>/\/(?:submit|send|publish|approve|dispatch|token)(?:\/|$)/u.test(call.path)),false);
   reports.push({width,proofOnlyGuestCards:true,manualCarousel:'zero/single/many; filters and legacy retained',touch:width<600,preview:'same public image; Escape/focus; refresh retained; removal closed',refresh:'stable IDs, open disclosure, carousel/filter, time/area and focus',agenda:'initial hash, cross-area links, keyboard and no jump',publicContentReads:f.calls.filter(call=>call.path==='/api/public/content').length,allRequests:f.calls.length,screenshots});
  }finally{await f.context.close();}
 }
 const reclassified=await fixture(390);
 try{
  const {page}=reclassified;
  await page.goto(SITE+'/',{waitUntil:'networkidle'});await selected(reclassified,IDs.student);
  await page.locator('[data-public-works-filter]').selectOption('student');
  await page.locator('#work-'+IDs.student+' [data-work-preview]').click();
  const lightbox=page.locator('[data-work-lightbox]');await lightbox.waitFor({state:'visible'});
  await reclassified.refresh(raw=>{
   raw.showcases.find(work=>work.id===IDs.student).kind='indie';
   raw.showcases.push(work('synthetic-second-student','student'));
  });
  assert.equal(await page.locator('[data-public-works-filter]').inputValue(),'student');
  assert.equal(await page.locator('#work-'+IDs.student).isVisible(),false,'reclassification removes the previously viewed work from the current subset');
  await selected(reclassified,'synthetic-second-student');
  const previewRetained=await lightbox.isVisible();
  if(previewRetained)await page.keyboard.press('Escape');
  assert.equal(await lightbox.isVisible(),false);
  assert.equal(await page.locator('#students-heading').evaluate(node=>document.activeElement===node),true,'closing a reclassified preview focuses the visible works heading instead of its now-hidden opening card');
  assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[hidden],[inert],dialog:not([open])'))),false,'focus never remains in hidden content or a closed dialog');
  await noOverflow(reclassified);
  reports.push({width:390,previewReclassifiedOutOfFilter:true,previewRetainedUntilClose:previewRetained,closeFocus:'visible works heading'});
 }finally{await reclassified.context.close();}
 for(const[kind,id]of[['work',IDs.indie],['guest',IDs.guest],['booth',IDs.booth]]){
  const f=await fixture(390,{deferContent:true});
  try{
   const anchor=kind+'-'+id;
   await f.page.goto(SITE+'/#'+anchor,{waitUntil:'domcontentloaded'});
   assert.equal(await f.page.locator('#'+anchor).count(),0,'late public target is absent before its initial publication arrives');
   f.releaseInitialContent();
   await f.page.locator('#'+anchor).waitFor({state:'visible'});
   if(kind==='work')await selected(f,id);
   if(kind==='guest')assert.equal(await f.page.locator('#'+anchor+' details').evaluate(node=>node.open),true,'initial guest hash opens its disclosure');
   if(kind==='booth')assert.equal(await f.page.locator('.ah-exhibition-details').evaluate(node=>node.open),true,'initial booth hash opens its enclosing disclosure');
   await f.page.waitForFunction(target=>{const rect=document.getElementById(target)?.getBoundingClientRect();return rect&&rect.top>=-1&&rect.top<=250;},anchor);
   assert.equal(f.calls.filter(call=>call.path==='/api/public/content').length,1,'late hash is resolved from the initial publication, without an extra refresh');
   await noOverflow(f);
   reports.push({width:390,initialDelayedHash:kind,stableId:id,targetRevealedAndScrolled:true,publicContentReads:1});
  }finally{f.releaseInitialContent();await f.context.close();}
 }
 const reduced=await fixture(390,{reducedMotion:'reduce'});
 try{await reduced.page.goto(SITE+'/',{waitUntil:'networkidle'});await selected(reduced,IDs.student);assert.equal(await reduced.page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);await reduced.page.locator('[data-public-work-next]').click();await selected(reduced,IDs.indie);await noOverflow(reduced);reports.push({width:390,reducedMotion:true,coreContentAndManualNavigation:true});}finally{await reduced.context.close();}
 const noJs=await fixture(320,{javascript:false});
 try{await noJs.page.goto(SITE+'/',{waitUntil:'networkidle'});for(const id of['guests-heading','booths-heading','students-heading','agenda-heading'])assert.equal(await noJs.page.locator('#'+id).isVisible(),true,'core section readable without JavaScript: '+id);assert.equal(await noJs.page.locator('[data-agenda-panel]:visible').count(),3,'the static timetable retains every area without JavaScript');assert.equal(await noJs.page.locator('[data-zone]:visible').count(),0,'inactive JS controls are not presented');assert.equal(await noJs.page.locator('[data-guest-id]').count(),0,'no scripted or invented attendance cards appear');await noOverflow(noJs);reports.push({width:320,javascript:false,coreSectionsAndFullTimetableReadable:true,requests:noJs.calls.length});}finally{await noJs.context.close();}
 assert.deepEqual(pageErrors,[]);
 const html=await readFile(resolve(dist,'index.html'));
 const result={ok:true,syntheticOnly:true,noBusinessWrites:true,source,dist,publicHtmlSha256:createHash('sha256').update(html).digest('hex'),reports,pageErrors};
 await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
