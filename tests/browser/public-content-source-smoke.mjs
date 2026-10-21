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
const coverId='a'.repeat(64)+'.png';
const value=createInitialContent();value.sessions=[];
value.organizations=[{id:'synthetic-org',name:'合成创作者组织',logoId:'',website:'',participation:'attendee',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE_ORG'}];
value.booths=[{id:'synthetic-booth',code:'C01',organization:'合成参展组织',project:'合成游戏展位',zone:'C',status:'confirmed',slotNumber:1,internalNotes:'PRIVATE_BOOTH'}];
value.guests=[{id:'synthetic-guest',name:'合成无照片嘉宾',company:'合成机构',ggjRole:'',portraitId:'',status:'confirmed',publicConsent:true,contactId:'PRIVATE_CONTACT',internalNotes:'PRIVATE_GUEST'}];
value.showcases=['student','indie','team'].map((kind,index)=>({id:'synthetic-'+kind,title:'合成'+kind+'作品',teamName:'合成团队',summary:'合成作品介绍',coverId,status:'confirmed',responseStatus:'attending',publicConsent:true,participationForms:['booth'],boothId:'synthetic-booth',sessionId:'',organizationId:'synthetic-org',...(index?{kind}:{}),school:'PRIVATE_SCHOOL',email:'private@example.invalid',wechat:'PRIVATE_WECHAT',contactName:'PRIVATE_NAME',memberCount:2,materialLinks:'https://private.invalid/material',internalNotes:'PRIVATE_WORK'}));
const initial=toPublicContent(value),updated=structuredClone(initial);updated.guests=[];updated.showcases=updated.showcases.filter(work=>work.kind==='indie');updated.showcases[0].title='合成更新独立游戏';
const empty=toPublicContent({...value,guests:[],showcases:[],booths:[],organizations:[]});
const html=`<!doctype html><meta charset="utf-8"><meta name="artdico-content-api" content="/api/public/content">
<p data-public-content-status>初始日程</p><section data-agenda><div data-agenda-summary></div><details data-full-program><div data-agenda-panel="A"><div class="ah-agenda-list"></div></div></details></section>
<ul data-public-guests></ul><p data-public-guests-empty hidden>嘉宾陆续公布</p>
<section id="booths"><ul data-public-organizations></ul><p data-public-organizations-empty></p><details id="booth-details"><summary>展位与作品</summary><div data-public-booths></div><p data-public-booths-empty></p></details></section>
<section id="students"><figure data-public-showcases-concept>初始作品概念</figure><div data-public-works-controls hidden><select data-public-works-filter><option value="all">全部</option><option value="student">学生作品</option><option value="indie">独立游戏</option><option value="team">团队作品</option></select><span data-public-works-count role="status"></span></div><ul data-public-showcases></ul><p data-public-showcases-empty hidden>游戏与作品陆续公布</p><p data-public-works-filter-empty hidden role="status">此分类暂无作品</p></section>
<script type="module" src="/src/scripts/public-content.mjs"></script>`;
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],reads=[];let mode='initial';
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(5000);
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,SITE);
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
  await page.goto(SITE);await page.locator('[data-showcase-id=synthetic-team]').waitFor();
  assert.equal(await page.locator('[data-showcase-id]').count(),3);assert.equal(await page.locator('[data-guest-id=synthetic-guest] img').count(),0);
  assert.equal(await page.locator('[data-guest-id=synthetic-guest] .ah-guest-initial').textContent(),'合');
  assert.equal(await page.locator('[data-public-works-controls]').isVisible(),true);assert.equal(await page.locator('[data-public-works-count]').textContent(),'3 件作品');
  assert.equal(await page.locator('#work-synthetic-student .ah-showcase-category').textContent(),'学生作品');
  assert.equal(await page.locator('#work-synthetic-indie .ah-showcase-organization').getAttribute('href'),'#organization-synthetic-org');
  assert.equal(await page.locator('#organization-synthetic-org .ah-showcase-related a').count(),3);
  assert.equal(await page.locator('#booth-synthetic-booth .ah-showcase-related a').count(),3);
  await page.locator('[data-public-works-filter]').selectOption('indie');assert.equal(await page.locator('[data-showcase-id]:visible').count(),1);assert.equal(await page.locator('[data-public-works-count]').textContent(),'1 / 3 件作品');
  await page.locator('#work-synthetic-indie .ah-showcase-arrangement a').click();assert.equal(await page.locator('#booth-details').evaluate(node=>node.open),true);
  await page.locator('#booth-synthetic-booth .ah-showcase-related a[href="#work-synthetic-student"]').click();assert.equal(await page.locator('[data-public-works-filter]').inputValue(),'all');assert.equal(await page.locator('#work-synthetic-student').isVisible(),true);
  assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE_|private\.invalid|private@example/u);
  await refresh('updated');await page.locator('#work-synthetic-indie h3').filter({hasText:'合成更新独立游戏'}).waitFor();assert.equal(await page.locator('[data-showcase-id]').count(),1);assert.equal(await page.locator('[data-guest-id]').count(),0);
  await page.locator('[data-public-works-filter]').selectOption('student');assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),true);assert.equal(await page.locator('[data-showcase-id]:visible').count(),0);
  for(const mode of ['failure','missing','conflict']){await refresh(mode);await page.locator('[data-public-content-status]').filter({hasText:'仍显示上次核对的发布版本'}).waitFor();assert.equal(await page.locator('#work-synthetic-indie h3').textContent(),'合成更新独立游戏');}
  await refresh('empty');await page.locator('[data-public-showcases-empty]:visible').waitFor();assert.equal(await page.locator('[data-showcase-id],[data-guest-id],[data-organization-id],[data-booth-id]').count(),0);
  assert.equal(await page.locator('[data-public-works-filter-empty]').isVisible(),false);assert.equal(await page.locator('[data-public-showcases-concept]').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({categoryFilterAndLegacyDisplay:true,sameSnapshotCreatorOrganization:true,manyWorksOneBoothReverseLinks:true,stableAnchorsRevealFilteredWorksAndBooths:true,emptyPhotoRequestsNone:true,returnRefreshReplacesPublishedData:true,laterErrors404AndSameRevisionConflictPreserveLastVerified:true,explicitEmptyPublicationWithdraws:true,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await context.close();await browser.close();}
