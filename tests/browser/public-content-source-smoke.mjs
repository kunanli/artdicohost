// Real DOM against source modules and canonical synthetic public projections.
// No build or real HTTP endpoint is used; the native transport is fully intercepted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInitialContent} from '../../src/config/content.mjs';
import {toPublicContent} from '../../shared/content-schema.mjs';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),SITE='https://public.synthetic.invalid';
const artworkModules=new Set(['gamezone','igda','szdx','bu','pengyou','g4c','teesside'].map(key=>'/src/assets/home/organization-'+key+'.png'));
const coverId='a'.repeat(64)+'.png';
const value=createInitialContent();value.sessions=[];
value.organizations=[{id:'synthetic-org',name:'合成创作者组织',logoId:'',website:'',participation:'attendee',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE_ORG'}];
value.booths=[{id:'synthetic-booth',code:'C01',organization:'合成参展组织',project:'合成游戏展位',zone:'C',status:'confirmed',slotNumber:1,internalNotes:'PRIVATE_BOOTH'}];
value.guests=[{id:'synthetic-guest',name:'合成无照片嘉宾',company:'合成机构',ggjRole:'',portraitId:'',status:'confirmed',publicConsent:true,contactId:'PRIVATE_CONTACT',internalNotes:'PRIVATE_GUEST'}];
value.showcases=['student','indie','team'].map((kind,index)=>({id:'synthetic-'+kind,title:'合成'+kind+'作品',teamName:'合成团队',summary:'合成作品介绍',coverId,status:'confirmed',responseStatus:'attending',publicConsent:true,participationForms:['booth'],boothId:'synthetic-booth',sessionId:'',organizationId:'synthetic-org',...(index?{kind}:{}),school:'PRIVATE_SCHOOL',email:'private@example.invalid',wechat:'PRIVATE_WECHAT',contactName:'PRIVATE_NAME',memberCount:2,materialLinks:'https://private.invalid/material',internalNotes:'PRIVATE_WORK'}));
const initial=toPublicContent(value,{guestAttendance:{schemaVersion:1,sourceRevision:1,confirmedGuestIds:['synthetic-guest']}});
const updated=toPublicContent({...value,guests:[],showcases:value.showcases.filter(work=>work.kind==='indie').map(work=>({...work,title:'合成更新独立游戏'}))},{guestAttendance:{schemaVersion:1,sourceRevision:2,confirmedGuestIds:[]}});
const empty=toPublicContent({...value,guests:[],showcases:[],booths:[],organizations:[]});
assert.equal(initial.booths[0].id,'synthetic-booth','safe public projection still retains backend booth data');
assert.ok(initial.showcases.every(work=>work.boothId==='synthetic-booth'&&work.organizationId==='synthetic-org'),'arrangement and independently authorized creator relations are preserved');
const html=`<!doctype html><meta charset="utf-8"><meta name="artdico-content-api" content="/api/public/content">
<p data-public-content-status>初始日程</p><section data-agenda><div data-agenda-summary></div><details data-full-program><div data-agenda-panel="A"><div class="ah-agenda-list"></div></div></details></section>
<ul data-public-guests></ul><p data-public-guests-empty hidden>嘉宾陆续公布</p>
<section id="booths"><ul data-public-organizations></ul><p data-public-organizations-empty></p></section>
<section id="students" hidden><div data-public-works-controls hidden><select data-public-works-filter><option value="all">全部</option><option value="student">学生作品</option><option value="indie">独立游戏</option></select><span data-public-works-count role="status"></span></div><ul data-public-showcases></ul><p data-public-works-filter-empty hidden role="status">此分类暂无作品</p></section>
<a href="#work-synthetic-student" data-synthetic-work-link>合成作品深链接</a><script type="module" src="/src/scripts/public-content.mjs"></script>`;
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],reads=[];let mode='initial';
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,SITE);
  if(artworkModules.has(url.pathname)&&url.search==='?url')return route.fulfill({contentType:'text/javascript',body:'export default '+JSON.stringify(url.pathname)+';'});
  if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  if(url.pathname==='/api/public/content'){
    reads.push(mode);assert.equal(route.request().method(),'GET');assert.equal(route.request().headers().cookie,undefined);
    if(mode==='failure')return route.fulfill({status:503,contentType:'application/json',body:'{}'});
    if(mode==='missing')return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:{code:'NOT_PUBLISHED'}})});
    const content=structuredClone(mode==='initial'?initial:mode==='empty'?empty:updated);
    if(mode==='conflict')content.showcases[0].title='SYNTHETIC_CONFLICTING_SAME_REV';
    return route.fulfill({contentType:'application/json',body:JSON.stringify({revision:mode==='initial'?1:mode==='empty'?3:2,publishedAt:'2026-10-21T10:00:00.000Z',content})});
  }
  if(url.pathname==='/api/public/portraits/'+coverId)return route.fulfill({status:404,body:''});
  assert.match(url.pathname,/^\/(?:src|shared)\/.+\.mjs$/u,'only public content, canonical artwork, or source module reads');
  const file=resolve(root,'.'+url.pathname);assert.ok(file.startsWith(root+'/'));return route.fulfill({contentType:'text/javascript',body:await readFile(file,'utf8')});
});
async function refresh(next){const count=reads.length;mode=next;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('[data-public-content-status]')?.textContent!=='');for(let index=0;index<150&&reads.length===count;index++)await page.waitForTimeout(10);assert.equal(reads.length,count+1);}
try{
  await page.goto(SITE);await page.locator('[data-showcase-id=synthetic-student]').waitFor();
  assert.equal(await page.locator('[data-showcase-id]').count(),3);assert.equal(await page.locator('[data-guest-id=synthetic-guest] img').count(),0);
  assert.equal(await page.locator('[data-guest-id=synthetic-guest] .ah-guest-initial').textContent(),'合');
  assert.equal(await page.locator('[data-public-works-controls]').isVisible(),true);assert.equal(await page.locator('[data-public-works-count]').textContent(),'1 / 3 件作品');
  assert.equal(await page.locator('#work-synthetic-student .ah-showcase-category').textContent(),'学生作品');
  assert.equal(await page.locator('#work-synthetic-indie .ah-showcase-organization').getAttribute('href'),'#organization-synthetic-org');
  assert.equal(await page.locator('#organization-synthetic-org').textContent(),'合成创作者组织','organization cards contain the public name without booth or work details');
  assert.equal(await page.locator('#organization-synthetic-org .ah-showcase-related').count(),0);
  assert.equal(await page.locator('[data-public-booths],[data-booth-id],[data-booth-dialog],#exhibition-details,a[href^="#booth-"]').count(),0,'backend booth records never create public booth UI or work-to-booth links');
  await page.locator('[data-public-works-filter]').selectOption('indie');assert.equal(await page.locator('[data-showcase-id]:visible').count(),1);assert.equal(await page.locator('[data-public-works-count]').textContent(),'1 / 1 件作品');
  assert.equal(await page.locator('#work-synthetic-indie .ah-showcase-arrangement').count(),0,'booth-only assignment is not shown as a public arrangement');
  await page.locator('#work-synthetic-indie .ah-showcase-organization').click();assert.equal(new URL(page.url()).hash,'#organization-synthetic-org');
  await page.locator('[data-synthetic-work-link]').click();await page.waitForFunction(()=>document.querySelector('[data-public-works-filter]').value==='all');assert.equal(await page.locator('[data-public-works-filter]').inputValue(),'all');assert.equal(await page.locator('#work-synthetic-student').isVisible(),true,'an independent native work deep link still reveals filtered content');
  assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE_|private\.invalid|private@example/u);
  await refresh('updated');await page.locator('#work-synthetic-indie h3').filter({hasText:'合成更新独立游戏'}).waitFor();assert.equal(await page.locator('[data-showcase-id]').count(),1);assert.equal(await page.locator('[data-guest-id]').count(),0);
  await page.locator('[data-public-works-filter]').selectOption('student');assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),true);assert.equal(await page.locator('[data-showcase-id]:visible').count(),0);
  for(const mode of ['failure','missing','conflict']){await refresh(mode);await page.locator('[data-public-content-status]').filter({hasText:'仍显示上次核对的发布版本'}).waitFor();assert.equal(await page.locator('#work-synthetic-indie h3').textContent(),'合成更新独立游戏');}
  await refresh('empty');await page.waitForFunction(()=>document.querySelector('#students')?.hidden===true);assert.equal(await page.locator('#students').isVisible(),false);assert.equal(await page.locator('[data-public-showcases-empty]').isVisible(),false);assert.equal(await page.locator('[data-showcase-id],[data-guest-id],[data-organization-id],[data-booth-id]').count(),0);
  assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),false);assert.equal(await page.locator('[data-public-showcases-concept]').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({categoryFilterAndLegacyDisplay:true,sameSnapshotCreatorOrganization:true,safeBackendArrangementsRetainedWithoutPublicBoothDetails:true,stableNativeAnchorsRevealFilteredWorksAndOrganizations:true,emptyPhotoRequestsNone:true,returnRefreshReplacesPublishedData:true,laterErrors404AndSameRevisionConflictPreserveLastVerified:true,explicitEmptyPublicationWithdraws:true,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await context.close();await browser.close();}
