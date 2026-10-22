// Real DOM with current source modules and canonical synthetic publications.
// Every HTTP request is intercepted; this never accesses or publishes real data.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInitialContent} from '../../src/config/content.mjs';
import {toPublicContent,validateContent} from '../../shared/content-schema.mjs';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),SITE='https://public.synthetic.invalid';
const value=createInitialContent();value.sessions=[];
const guest=(id,extra={})=>({id,name:'合成待确认嘉宾',company:'',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,contactId:'PRIVATE_CONTACT_'+id,internalNotes:'PRIVATE_GUEST',...extra});
const org=(id,extra={})=>({id,name:'合成待确认组织',logoId:'',website:'',participation:'undecided',status:'pending',publicConsent:false,internalNotes:'PRIVATE_ORG',...extra});
const booth=(id,code,extra={})=>({id,code,organization:'',project:'',zone:'C',status:'pending',slotNumber:0,contactName:'PRIVATE_BOOTH_PERSON',contactMethods:'private@example.invalid',internalNotes:'PRIVATE_BOOTH',...extra});
const work=(id,extra={})=>({id,title:'合成未排作品',teamName:'',summary:'合成作品介绍',coverId:'',status:'pending',responseStatus:'pending',publicConsent:false,participationForms:[],boothId:'',sessionId:'',kind:'indie',organizationId:'private-org',school:'PRIVATE_SCHOOL',email:'private@example.invalid',wechat:'PRIVATE_WECHAT',contactName:'PRIVATE_NAME',memberCount:2,materialLinks:'https://private.invalid/material',internalNotes:'PRIVATE_WORK',...extra});
value.guests=[guest('default-guest'),guest('fallback-guest',{name:''}),guest('private-guest',{visibility:'private',name:'PRIVATE_HIDDEN_GUEST'})];
value.organizations=[org('default-org'),org('withdrawn-org',{status:'withdrawn',name:'合成已退出组织'}),org('private-org',{visibility:'private',name:'PRIVATE_HIDDEN_ORG'})];
value.booths=[booth('default-booth','C-01'),booth('cancelled-booth','C-02',{status:'cancelled',organization:'合成取消展位'}),booth('private-booth','C-03',{visibility:'private',organization:'PRIVATE_HIDDEN_BOOTH'})];
value.showcases=[work('default-work'),work('declined-work',{title:'合成婉拒作品',responseStatus:'declined'}),work('private-work',{visibility:'private',title:'PRIVATE_HIDDEN_WORK'})];
assert.equal(validateContent(value).valid,true,JSON.stringify(validateContent(value).errors));
const original=JSON.stringify(value),initial=toPublicContent(value),hidden=structuredClone(value);
for(const collection of ['guests','organizations','booths','showcases'])for(const item of hidden[collection])item.visibility='private';
const withdrawn=toPublicContent(hidden);
assert.equal(JSON.stringify(value),original);
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="artdico-content-api" content="/api/public/content">
<link rel="stylesheet" href="/src/styles/guests.css"><link rel="stylesheet" href="/src/styles/students-showcase.css"><body id="artdico-host" class="ah-festival">
<p data-public-content-status>初始日程</p><section class="ah-guests"><ul class="ah-guest-grid" data-public-guests></ul><p data-public-guests-empty hidden>嘉宾陆续公布</p></section>
<ul data-public-organizations></ul><p data-public-organizations-empty></p><div data-public-booths></div><p data-public-booths-empty></p>
<section class="ah-students-showcase"><figure data-public-showcases-concept>初始概念</figure><div data-public-works-controls hidden><select data-public-works-filter><option value="all">全部</option><option value="indie">独立游戏</option></select><span data-public-works-count></span></div><ul class="ah-showcase-grid" data-public-showcases></ul><p data-public-showcases-empty hidden>游戏与作品陆续公布</p><p data-public-works-filter-empty hidden>此分类暂无作品</p></section>
<script type="module" src="/src/scripts/public-content.mjs"></script>`;
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],requests=[];let phase='initial';
page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());assert.equal(url.origin,SITE);
  requests.push(url.pathname);
  if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:html});
  if(url.pathname==='/api/public/content'){
    assert.equal(request.method(),'GET');assert.equal(request.headers().cookie,undefined);assert.equal(request.headers().authorization,undefined);
    return route.fulfill({contentType:'application/json',body:JSON.stringify({revision:phase==='initial'?1:2,publishedAt:'2026-10-22T02:00:00.000Z',content:phase==='initial'?initial:withdrawn})});
  }
  assert.match(url.pathname,/^\/(?:src|shared)\/.+\.(?:mjs|css)$/u,'no empty image path or private API is requested');
  const file=resolve(root,'.'+url.pathname);assert.ok(file.startsWith(root+'/'));
  return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/javascript',body:await readFile(file,'utf8')});
});
try{
  await page.goto(SITE);await page.locator('#work-default-work').waitFor();
  for(const selector of ['[data-guest-id]','[data-organization-id]','[data-booth-id]','[data-showcase-id]'])assert.equal(await page.locator(selector).count(),2);
  assert.match(await page.locator('#guest-default-guest').textContent(),/资料待确认/u);
  assert.equal(await page.locator('#guest-fallback-guest .ah-guest-name').textContent(),'嘉宾姓名待补');
  assert.match(await page.locator('#organization-default-org').textContent(),/参与待确认/u);
  assert.match(await page.locator('#organization-withdrawn-org').textContent(),/已退出/u);
  assert.match(await page.locator('#booth-default-booth').textContent(),/展位待安排.*展示内容待补.*展位安排待确认/u);
  assert.match(await page.locator('#booth-cancelled-booth').textContent(),/本展位已取消/u);
  assert.match(await page.locator('#work-default-work').textContent(),/资料待确认.*参加待确认.*展示安排陆续公布/u);
  assert.match(await page.locator('#work-declined-work').textContent(),/已回复不参加/u);
  assert.equal(await page.locator('#work-default-work .ah-showcase-cover-empty').isVisible(),true);
  assert.equal(await page.locator('#work-default-work .ah-showcase-organization').count(),0,'a private organization cannot create a dangling public link');
  assert.equal(await page.locator('[data-public-guests] img,[data-public-showcases] img').count(),0);
  assert.doesNotMatch(await page.locator('body').textContent(),/PRIVATE_|private\.invalid|private@example|已确认参加/u);
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:940});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.locator('#work-default-work h3').isVisible(),true);
  }
  phase='hidden';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('[data-public-showcases-empty]:visible').waitFor();
  assert.equal(await page.locator('[data-guest-id],[data-organization-id],[data-booth-id],[data-showcase-id]').count(),0);
  assert.equal(requests.some(path=>path.includes('/portraits/')||path.startsWith('/api/admin/')),false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({defaultPublicWithoutLegacyGates:true,pendingFactsPreserved:true,emptyImagesRequestNothing:true,manualPrivateWithdrawsAllKinds:true,privateFieldsAndPrivateOrganizationLinksExcluded:true,widths:[320,390,1440],pageErrors:errors,syntheticOnly:true},null,2));
}finally{await context.close();await browser.close();}
