// Actual Chromium, with every request intercepted and purely synthetic organization projections.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createInitialContent} from '../../src/config/content.mjs';
import {toPublicContent} from '../../shared/content-schema.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),evidence=resolve(project,'.local-data/browser-evidence');
await mkdir(evidence,{recursive:true});
const SITE='https://artdico.host',API='https://api.artdico.host',errors=[],unexpected=[],reports=[];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=','base64');
const logoId=createHash('sha256').update(png).digest('hex')+'.png',missingId='b'.repeat(64)+'.png';
const organization=(id,name,participation,fields={})=>({id,name,participation,status:'confirmed',publicConsent:true,website:'',logoId:'',logoUrl:'',...fields});
const organizations=[
 organization('synthetic-exhibitor','合成参展组织','exhibitor',{website:'https://example.invalid/exhibitor',logoId,logoUrl:'/api/public/portraits/'+logoId}),
 organization('synthetic-attendee','合成一般参与组织','attendee',{website:'https://example.invalid/attendee'}),
 organization('synthetic-name','合成名称 <script>','undecided'),
 organization('synthetic-broken-logo','合成图片失效组织','attendee',{logoId:missingId,logoUrl:'/api/public/portraits/'+missingId}),
 organization('synthetic-hidden','PRIVATE-HIDDEN','attendee',{status:'pending',visibility:'private'}),
];
const base=toPublicContent(createInitialContent());
base.booths=[{id:'synthetic-booth',organization:'合成独立展位',project:'合成试玩作品',code:'C01',zone:'C',status:'confirmed'}];
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value),headers:{'access-control-allow-origin':SITE}});

async function scenario(initialMode){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),reads=[],imageReads=[];
 let mode=initialMode,release=null;
 await context.addCookies([{name:'synthetic_staff',value:'PRIVATE-STAFF-COOKIE',domain:'api.artdico.host',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
 page.on('pageerror',error=>errors.push(initialMode+': '+error.message));
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(![SITE,API].includes(url.origin)){unexpected.push(url.origin);return route.abort();}
  if(url.origin===API){
   assert.equal(request.headers().cookie,undefined,'public reads must omit staff cookies');
   reads.push(url.pathname);
   if(url.pathname==='/api/public/content'){
    if(mode==='unavailable')return route.fulfill(json({error:{code:'UNAVAILABLE'}},503));
    if(mode==='nopublication')return route.fulfill(json({error:{code:'NOT_PUBLISHED'}},404));
    const content={...base};
    if(!['legacy','nopublication'].includes(mode))content.organizations=mode==='empty'?[]:mode==='malformed'?{}:organizations;
    const response=json({revision:1,content:mode==='malformed'?content:toPublicContent(content),publishedAt:'2026-10-21T00:00:00Z'});
    if(mode==='loading'){release=()=>route.fulfill(response);return;}
    return route.fulfill(response);
   }
   if(url.pathname.startsWith('/api/public/portraits/')){
    assert.equal(request.headers().referer,undefined);assert.equal(request.headers().origin,SITE);
    imageReads.push(url.pathname);
    return route.fulfill(url.pathname.endsWith(logoId)?{status:200,body:png,contentType:'image/png',headers:{'access-control-allow-origin':SITE}}:{status:404,body:''});
   }
   return route.fulfill(json({},404));
  }
  const path=url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname,file=resolve(dist,'.'+path);assert.ok(file.startsWith(dist+'/'));
  try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(SITE+'/',{waitUntil:mode==='loading'?'domcontentloaded':'networkidle'});
 const list=page.locator('[data-public-organizations]'),message=page.locator('[data-public-organizations-empty]');
 if(mode==='loading'){
  for(let attempt=0;attempt<100&&!release;attempt++)await page.waitForTimeout(10);assert.ok(release);
  assert.equal(await list.isVisible(),false);assert.equal(await list.locator('li').count(),4);assert.match(await message.textContent(),/正在读取/u);
  await release();await list.locator('[data-organization-id=synthetic-exhibitor]').waitFor();
 }
 if(['cards','loading'].includes(mode)){
  await list.scrollIntoViewIfNeeded();await list.locator('li').first().waitFor();assert.equal(await list.locator('li').count(),4);
  assert.doesNotMatch(await list.textContent(),/PRIVATE|G4C HK/u);assert.equal(await page.evaluate(()=>window.PRIVATE_EXECUTED),undefined);
  const exhibitor=list.locator('[data-organization-id=synthetic-exhibitor]'),attendee=list.locator('[data-organization-id=synthetic-attendee]');
  assert.match(await exhibitor.textContent(),/参展/u);assert.match(await attendee.textContent(),/一般参与/u);
  assert.equal(await exhibitor.locator('a').getAttribute('href'),'https://example.invalid/exhibitor');assert.equal(await exhibitor.locator('a').getAttribute('rel'),'noopener noreferrer');assert.equal(await exhibitor.locator('a').getAttribute('target'),'_blank');
  assert.equal(await list.locator('[data-organization-id=synthetic-name] a').count(),0);assert.equal(await list.locator('[data-organization-id=synthetic-name] img').count(),0);
  await exhibitor.locator('a').focus();assert.equal(await exhibitor.locator('a').evaluate(node=>document.activeElement===node),true);
  await page.waitForFunction(()=>{const image=document.querySelector('[data-organization-id=synthetic-exhibitor] img');return image?.complete&&image.naturalWidth>0;});
  await page.waitForFunction(()=>document.querySelector('[data-organization-id=synthetic-broken-logo] .ah-organization-image')?.hidden===true);
  assert.equal(await list.locator('[data-organization-id=synthetic-broken-logo] h3').isVisible(),true);
  assert.equal(await exhibitor.locator('img').evaluate(node=>getComputedStyle(node).objectFit),'contain');
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await list.evaluate(node=>getComputedStyle(node).gridTemplateColumns.split(' ').length),width===320?1:width===390?2:4);}
  assert.equal(await page.locator('[data-public-booths] h3').textContent(),'合成独立展位');
  if(mode==='cards'){await page.setViewportSize({width:390,height:844});await page.locator('#booths').screenshot({path:resolve(evidence,'organizations-mobile.png')});}
  assert.equal(imageReads.length,2);
 }else if(['legacy','nopublication'].includes(mode)){
  assert.equal(await list.isVisible(),true);assert.equal(await list.locator('li').count(),4);assert.match(await list.textContent(),/G4C HK/u);assert.doesNotMatch(await list.textContent(),/现场参展|一般参与/u);assert.equal(await list.locator('img,a').count(),0);
 }else{
  assert.equal(await list.isVisible(),false);assert.equal(await list.locator('li').count(),0);assert.equal(await message.isVisible(),true);assert.doesNotMatch(await list.textContent(),/G4C HK/u);
  if(mode!=='empty')assert.match(await message.textContent(),/暂时无法读取/u);
  if(mode==='empty'){
   mode='unavailable';await page.reload({waitUntil:'networkidle'});assert.equal(await list.isVisible(),false);assert.equal(await list.locator('li').count(),0);assert.match(await message.textContent(),/暂时无法读取/u);
  }
  assert.equal(imageReads.length,0);
 }
 assert.equal(reads.some(path=>path.startsWith('/api/admin/portraits')),false);
 reports.push({scenario:initialMode,passed:true,staffCookieOmitted:true,onlyCanonicalPublicImages:true});await context.close();
}
try{
 for(const mode of ['loading','cards','legacy','nopublication','empty','unavailable','malformed'])await scenario(mode);
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);console.log(JSON.stringify({reports,pageErrors:errors,unexpectedOrigins:unexpected,syntheticOnly:true},null,2));
}finally{await browser.close();}
