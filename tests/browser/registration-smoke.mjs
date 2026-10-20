// Optional real-browser regression. Build with PUBLIC_API_BASE=https://api.artdico.host first.
// All page requests are intercepted synthetic fixtures; this never submits to the live service.
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(project,'dist');
const evidence=resolve(project,'.local-data/browser-evidence');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[];const reports=[];
const notice={version:'approved-synthetic-v1',processor:'合成验收处理者',contactEmail:'privacy@example.invalid',purpose:'合成浏览器验收',storageRegion:'合成地区',retention:'合成保留规则',rightsRequest:'请联络合成邮箱申请查阅、更正、撤回及删除',sharing:'合成测试不对外分享'};
const json=body=>({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'https://artdico.host'}});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
async function serve(route){const url=new URL(route.request().url());let path=url.pathname;if(path.endsWith('/'))path+='index.html';try{const file=resolve(dist,'.'+path);assert.ok(file.startsWith(dist+'/'));const body=await readFile(file);await route.fulfill({status:200,body,contentType:({'html':'text/html','js':'text/javascript','css':'text/css','png':'image/png','webp':'image/webp','woff2':'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:''});}}
async function publicScenario(mode){
 console.log('scenario '+mode);const context=await browser.newContext({viewport:{width:390,height:844}});
 await context.addCookies([{name:'synthetic_staff',value:'PRIVATE-SYNTHETIC-COOKIE',domain:'api.artdico.host',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.on('pageerror',error=>errors.push(mode+':'+error.message));const calls=[];
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin==='https://artdico.host')return serve(route);
  if(url.origin!=='https://api.artdico.host')return route.abort();
  calls.push({path:url.pathname,method:req.method(),body:req.postData(),cookie:req.headers().cookie||''});
  assert.equal(req.headers().cookie,undefined,'public request must omit staff cookie');
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://artdico.host','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'Content-Type,Idempotency-Key,X-Registration-Token'}});
  if(url.pathname.endsWith('/config'))return route.fulfill(json({enabled:mode!=='closed',...(mode==='closed'?{reason:'closed'}:{}),eventId:'synthetic-event',opensAt:'2026-01-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',capacity:300,privacy:notice}));
  if(url.pathname.endsWith('/token'))return route.fulfill(json({eventId:'synthetic-event',submissionToken:'synthetic.payload.signature',expiresAt:new Date(Date.now()+300000).toISOString()}));
  if(url.pathname.endsWith('/submit')){
   const sent=calls.filter(item=>item.path.endsWith('/submit'));
   if(mode==='retry'&&sent.length===1)return route.fulfill({...json({error:{code:'UNAVAILABLE'}}),status:503});
   return route.fulfill({...json({status:'registered',reference_code:'r'.repeat(43),groupInvite:{platform:'wechat',qrImageUrl:'https://api.artdico.host/api/admin/registration/group-invite/synthetic-token',expiresAt:new Date(Date.now()+300000).toISOString()}}),status:201});
  }
  if(url.pathname.includes('/group-invite/'))return route.fulfill({status:200,contentType:'image/png',body:png,headers:{'access-control-allow-origin':'https://artdico.host'}});
  return route.fulfill({status:404,body:''});
 });
 await page.goto('https://artdico.host/',{waitUntil:'networkidle'});
 const form=page.locator('[data-registration-form]');
 if(mode==='closed'){
  await assert.equal(await form.getAttribute('data-registration-mode'),'closed');
  assert.equal(await page.locator('[data-submit]').isDisabled(),true);
  assert.match(await page.locator('[data-registration-notice]').textContent(),/已关闭/u);
  assert.match(await page.locator('[data-public-privacy]').textContent(),/合成验收处理者/u);
  assert.equal(calls.filter(item=>item.method==='POST').length,0);
  reports.push({scenario:mode,passed:true,requests:calls.length});
 }else{
  await page.locator('[data-registration-preview]>summary').click();
  await page.locator('input[name=categories][value=other]').check();
  await page.locator('[data-form-step="0"] [data-next-step]').click();
  for(const[name,value]of Object.entries({name:'合成访客',city:'合成城市',organization:'合成机构',position:'合成角色',email:'guest@example.invalid',background:'这是一段仅用于浏览器验收的合成资料。'}))await form.locator(`[name="${name}"]`).fill(value);
  await page.locator('[data-form-step="1"] [data-next-step]').click();
  await form.locator('input[name=participationInterests][value=attend]').check();
  for(const[name,value]of Object.entries({attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'}))await form.locator(`[name="${name}"]`).selectOption(value);
  await form.locator('[name=consentAccepted]').check();
  await page.locator('[data-submit]').click();
  if(mode==='retry'){
   await page.locator('[data-submit]').filter({hasText:'再次确认报名结果'}).waitFor();
   assert.equal(await form.locator('[name=name]').isDisabled(),true);
   await page.locator('[data-submit]').click();
  }
  try{await page.locator('[data-registration-success]:visible').waitFor({timeout:8000});}catch(error){console.log(JSON.stringify({scenario:mode,mode:await form.getAttribute('data-registration-mode'),summary:await form.locator('[data-form-error]').textContent(),errors:await form.locator('[data-error-for]:visible').allTextContents(),calls:calls.map(({path,method})=>({path,method})),pageErrors:errors}));await page.screenshot({path:evidence+'/failed-'+mode+'.png',fullPage:true});throw error;}
  assert.equal(await page.locator('[data-registration-reference]').textContent(),'r'.repeat(43));
  assert.equal(await form.isVisible(),false);
  const writes=calls.filter(item=>item.path.endsWith('/submit'));
  if(mode==='retry'){assert.equal(writes.length,2);assert.equal(writes[0].body,writes[1].body);}
  await page.locator('#registration').screenshot({path:evidence+'/'+mode+'-mobile.png'});
  reports.push({scenario:mode,passed:true,writes:writes.length,publicCookieOmitted:true});
 }
 await context.close();
}
try{await publicScenario('closed');await publicScenario('success');await publicScenario('retry');assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors},null,2));}
finally{await browser.close();}
