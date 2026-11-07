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
const evidence=resolve(process.env.ARTDICO_GALLERY_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/homepage-gallery'));
const {createInitialContent}=await import(pathToFileURL(resolve(source,'src/config/content.mjs')));
const {toPublicContent,validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {publicContentEnvelope}=await import(pathToFileURL(resolve(source,'src/lib/public-content-refresh.mjs')));
const {publicGuestCards}=await import(pathToFileURL(resolve(source,'shared/guest-display.mjs')));
const SITE='https://artdico.host',API='https://api.artdico.host';
const PRIVATE='SYNTHETIC_P5_PRIVATE_NEVER_PUBLIC';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const coverId=createHash('sha256').update(png).digest('hex')+'.png',missingId='b'.repeat(64)+'.png';
const IDs={guest:'synthetic-guest-alpha',secondGuest:'synthetic-guest-beta',unproved:'synthetic-guest-unproved',student:'synthetic-work-student',indie:'synthetic-work-indie',legacy:'synthetic-work-team',organization:'synthetic-org',booth:'synthetic-booth',morning:'synthetic-program-a',afternoon:'synthetic-program-b',share:'synthetic-program-c'};
const longName='合成跨领域创作者与青年游戏社区分享嘉宾'.repeat(3);
const guest=(id,extra={})=>({id,name:'合成嘉宾 '+id,company:'合成创意机构',ggjRole:'合成GGJ站点组织者',portraitId:'',status:'confirmed',publicConsent:false,contactId:PRIVATE+'-'+id,internalNotes:PRIVATE,title:'合成创作者',bio:'合成嘉宾介绍。\n作品与创作经验将在现场交流。',website:'',publicRoles:['guest'],...extra});
const session=(id,zone,start,end,extra={})=>({id,zone,start,end,title:'合成 '+zone+' 区交流',format:'talk',guestId:'',speakerName:'',speakerStatus:'pending',status:'scheduled',internalNotes:PRIVATE,...extra});
const work=(id,kind,extra={})=>({id,kind,title:'合成'+(kind==='student'?'学生美术与三维创作':kind==='indie'?'独立游戏':'历史团队作品'),teamName:'合成创作团队与作者'.repeat(4),summary:'合成创作说明；展示形式以现场安排为准。',coverId:'',status:'confirmed',responseStatus:'attending',publicConsent:false,participationForms:['booth'],boothId:IDs.booth,sessionId:'',organizationId:IDs.organization,school:PRIVATE,email:'private@example.invalid',wechat:PRIVATE,contactName:PRIVATE,memberCount:3,materialLinks:'https://private.invalid/'+PRIVATE,internalNotes:PRIVATE,...extra});
function rawFixture(){
 const content=createInitialContent();
 content.guests=[guest(IDs.guest,{name:longName,portraitId:coverId,publicRoles:['speaker','moderator']}),guest(IDs.secondGuest,{portraitId:missingId}),guest(IDs.unproved,{name:'合成未确认出席讲者'}),guest('synthetic-private-guest',{name:PRIVATE,visibility:'private'})];
 content.organizations=[{id:IDs.organization,name:'合成参与组织与跨地域青年创作交流网络'.repeat(3),logoId:coverId,website:'https://example.invalid/synthetic-organization',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:PRIVATE},{id:'synthetic-org-broken',name:'合成缺图组织',logoId:missingId,website:'',participation:'attendee',status:'confirmed',publicConsent:false,internalNotes:PRIVATE}];
 content.booths=[{id:IDs.booth,code:'C-32',zone:'C',slotNumber:32,organization:'合成已安排展位组织',project:'合成艺术与三维作品展示',status:'confirmed',contactName:PRIVATE,contactMethods:'private@example.invalid',internalNotes:PRIVATE,description:'合成展位说明',website:''}];
 content.sessions=[session(IDs.morning,'A','10:00','11:00',{guestId:IDs.unproved}),session(IDs.afternoon,'B','14:00','15:00',{guestId:IDs.guest,participants:[{guestId:IDs.secondGuest,roles:['moderator']}]}),session(IDs.share,'C','16:00','17:00',{format:'showcase',title:'合成作品分享与交流'}),session('synthetic-cancelled','C','17:00','17:30',{title:'合成已取消场次',status:'cancelled'})];
 content.showcases=[work(IDs.student,'student',{coverId,participationForms:['booth','share'],sessionId:IDs.share}),work(IDs.indie,'indie',{coverId:missingId,status:'pending',responseStatus:'pending'}),work(IDs.legacy,'team')];
 content.organizations=Array.from({length:13},(_,index)=>({id:'synthetic-gallery-org-'+index,name:'合成组织 '+index,logoId:coverId,website:'https://example.invalid/organization-'+index,participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:PRIVATE}));
 content.faqs=[{id:'site-official',question:'新站点现场咨询代表已通过申请吗？',answer:'合成旧咨询说明'}];
 return content;
}
function projected(raw){
 const checked=validateContent(raw);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
 const publicIds=new Set(raw.guests.filter(item=>item.visibility!=='private').map(item=>item.id));
 const value=toPublicContent(raw,{guestAttendance:{schemaVersion:1,sourceRevision:12,confirmedGuestIds:[IDs.guest,IDs.secondGuest].filter(id=>publicIds.has(id))}});
 assert.doesNotMatch(JSON.stringify(value),/SYNTHETIC_P5_PRIVATE|private\.invalid|private@example/u,'private source fields never enter the intercepted public response');
 assert.ok(publicContentEnvelope({revision:1,publishedAt:'2026-11-01T09:00:00.000Z',content:value}),'fixture must pass the actual public envelope validator');
 const cards=publicGuestCards(value.guests,value.guestAttendance),confirmed=new Set(value.guestAttendance.confirmedGuestIds);
 assert.deepEqual(cards.map(item=>item.id),value.guests.map(item=>item.id),'every safe public profile remains displayed independently of attendance proof');
 for(const card of cards)assert.equal(card.attendance,confirmed.has(card.id)?'attending':'pending','each displayed profile retains only its actual fixture attendance proof');
 return value;
}
projected(rawFixture());
const mime=file=>({html:'text/html; charset=utf-8',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const pageErrors=[],reports=[];
async function fixture(width,{javascript=true,reducedMotion='no-preference',deferContent=false}={}){
 const context=await browser.newContext({locale:'zh-CN',viewport:{width,height:960},isMobile:width<600,hasTouch:width<600,javaScriptEnabled:javascript,reducedMotion});
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

await mkdir(evidence,{recursive:true});
try {
 for(const width of [320,390,1440,1920]) {
  const f=await fixture(width,{reducedMotion:'reduce'}),{page}=f;
  try {
   await page.goto(SITE+'/',{waitUntil:'networkidle'});
   await page.locator('[data-showcase-id]').first().waitFor();
   assert.equal(await page.locator('[data-organizations-pagination],[data-public-work-prev],[data-public-work-next],[data-work-navigation],[data-work-peek],[data-program-period],[data-public-program-timezone]').count(),0);
   assert.equal(await page.locator('[data-organization-id]:visible').count(),13);
   const boxes=await page.locator('[data-organization-id]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
   const circle=await page.locator('[data-organizations-planet]').boundingBox();
   for(const b of boxes){assert.ok(b.width>=44&&b.height>=44);for(const x of[b.x,b.x+b.width])for(const y of[b.y,b.y+b.height])assert.ok(Math.hypot(x-circle.x-circle.width/2,y-circle.y-circle.height/2)<circle.width/2);}
   for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert.ok(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)<=1||Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)<=1);}
   if(width===320){
   const identityOverflow=await page.locator('.ah-guest-subtitle').first().evaluate(node=>{
    const original=node.textContent;let max=0,cases=0;
    for(const token of ['GGJ','GlobalGameJam','区域负责人','站点负责人','中国区组织者','Global Game Jam Site Organizer'])for(let length=1;length<=30;length++){
     node.textContent=(token+' ').repeat(length);max=Math.max(max,node.scrollWidth-node.clientWidth);cases++;
    }
    node.textContent=original;return{cases,max};
   });
   assert.equal(identityOverflow.cases,180);assert.ok(identityOverflow.max<=1,'long centred guest identities do not overflow while clamped at '+width+' overflow '+identityOverflow.max);
   }
   const rail=page.locator('[data-public-showcases]');
   assert.equal(await page.locator('[data-showcase-id]:visible').count(),3,'every work is in the native scroll rail');
   const first=page.locator('#work-'+IDs.student);await first.scrollIntoViewIfNeeded();
   await first.locator('img').evaluate(image=>image.decode());
   const geometry=await first.evaluate(node=>{const image=node.querySelector('img').getBoundingClientRect(),caption=node.querySelector('.ah-showcase-caption');return{imageBottom:image.bottom,captionTop:caption.getBoundingClientRect().top,background:getComputedStyle(caption).backgroundColor};});
   assert.ok(geometry.captionTop>=geometry.imageBottom);assert.equal(geometry.background,'rgba(0, 0, 0, 0)');
   assert.equal(await first.locator('[data-work-preview] span').count(),0,'no small overlay icon');
   await first.evaluate(node=>window.scrollTo({top:node.getBoundingClientRect().top+scrollY-180,behavior:'instant'}));
   if(width<600){
    const box=await first.locator('[data-work-preview]').boundingBox(),cdp=await f.context.newCDPSession(page),y=box.y+Math.min(60,box.height/2);
    try{
     await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.95,y}]});
     for(let step=1;step<=8;step++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*(.95-step*.11),y}]});
     await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }finally{await cdp.detach();}
   }else{await rail.hover();await page.mouse.wheel(await rail.evaluate(node=>node.clientWidth),0);}
   await page.waitForTimeout(350);
   assert.ok(await rail.evaluate(node=>node.scrollLeft>0),'native touch or horizontal wheel scrolls the gallery at '+width);
   await rail.evaluate(node=>node.scrollTo({left:0,behavior:'instant'}));
   await rail.focus();await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);
   assert.ok(await rail.evaluate(node=>node.scrollLeft>0),'the rail supports native keyboard scrolling');
   const target=page.locator('#work-'+IDs.legacy);
   await target.evaluate(node=>node.scrollIntoView({inline:'start',block:'nearest',behavior:'instant'}));
   assert.ok(await rail.evaluate(node=>node.scrollLeft>node.clientWidth*.5));
   await f.refresh(raw=>{raw.showcases.find(item=>item.id===IDs.legacy).title='合成更新后的作品';});
   assert.ok(await rail.evaluate(node=>node.scrollLeft>node.clientWidth*.5),'public refresh preserves the horizontal reading position');
   await first.evaluate(node=>node.scrollIntoView({inline:'start',block:'nearest',behavior:'instant'}));
   await first.locator('[data-work-preview]').focus();await page.keyboard.press('Enter');
   assert.equal(await page.locator('[data-work-lightbox]').evaluate(node=>node.open),true);await page.keyboard.press('Escape');
   assert.equal(await first.locator('[data-work-preview]').evaluate(node=>document.activeElement===node),true);
   assert.equal(await page.locator('[data-public-content-status]').textContent(),'');
   assert.doesNotMatch(await page.locator('#agenda').innerText(),/讲者与.*陆续公布|北京时间|UTC\+8|浏览时段/u);
   assert.match(await page.locator('#faq-site-official').innerText(),/现场可进行 GGJ 站点审核/u);
   await page.locator('#tab-B').click();assert.equal(await page.locator('[data-agenda-panel=B]').isVisible(),true);
   await page.locator('[data-language=en]').click();
   await page.waitForFunction(()=>document.documentElement.lang==='en');
   assert.match(await page.locator('#faq-site-official').innerText(),/jam-site reviews are available on site/i);
   await page.locator('[data-language=zh-CN]').click();
   await page.waitForFunction(()=>document.documentElement.lang==='zh-CN');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const screenshots=[];
   for(const id of ['booths','students','agenda']){const path=resolve(evidence,id+'-'+width+'.png');await page.locator('#'+id).screenshot({path,animations:'disabled'});screenshots.push(path);}
   reports.push({width,organizations:13,singleComposition:true,unobstructedCaption:true,nativeScroll:true,keyboardPreview:true,refreshPreserved:true,bilingualReviewCopy:true,noBusinessWrites:true,screenshots});
  }finally{await f.context.close();}
 }
 assert.equal(pageErrors.length,0);
 const report={ok:true,syntheticOnly:true,sourceCommit:process.env.GITHUB_SHA||null,htmlSha256:createHash('sha256').update(await readFile(resolve(dist,'index.html'))).digest('hex'),scriptSha256:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex'),cases:reports.length,reports,pageErrors};
 await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2));
 console.log('Homepage gallery browser verified: '+JSON.stringify(report));
}finally{await browser.close();}
