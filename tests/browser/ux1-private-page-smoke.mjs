// Compiled private page over strictly intercepted synthetic capability reads.
// No registration, notification, real Wallet installation or business write.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/ux1-private-page'));
const SITE='https://artdico.host',API='https://api.artdico.host';
const token='v1.'+'x'.repeat(100)+'.'+'y'.repeat(43),second='v1.'+'b'.repeat(100)+'.'+'c'.repeat(43);
const ios='Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
const agents={wechat:ios+' MicroMessenger/8.0',safari:ios,chromeios:ios+' CriOS/133.0',desktop:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/133.0 Safari/537.36',android:'Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/133.0 MicroMessenger/8.0'};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=','base64');
const errors=[],reports=[],assets=new Map();
const sha=value=>createHash('sha256').update(value).digest('hex');
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
async function fixture(width,device='wechat'){
  const context=await browser.newContext({viewport:{width,height:844},userAgent:agents[device],reducedMotion:'reduce'});
  await context.addCookies([{name:'synthetic_staff',value:'PRIVATE_STAFF_COOKIE',domain:new URL(API).hostname,path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);
  await context.addInitScript(()=>{
    globalThis.__ux={copied:[],failClipboard:false,delayClipboard:false,pendingCopies:[],downloads:0};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{if(globalThis.__ux.delayClipboard)await new Promise(resolve=>globalThis.__ux.pendingCopies.push(resolve));if(globalThis.__ux.failClipboard)throw Error('synthetic clipboard denial');globalThis.__ux.copied.push(text);}}});
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download==='artdico-host.pkpass'&&this.href.startsWith('blob:')){globalThis.__ux.downloads++;return;}return click.apply(this,arguments);};
  });
  const page=await context.newPage(),calls=[],memory={status:200,name:'合成参会者',long:false,group:true};page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push({width,device,name:error.name}));
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.ok([SITE,API].includes(url.origin),'every request is intercepted inside the synthetic origins');
    if(url.origin===SITE){
      assert.equal(request.method(),'GET');assert.ok(path==='/registration/confirmation/'||path.startsWith('/_astro/')||path==='/favicon.ico');
      const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
      try{const bytes=await readFile(file);assets.set(path,{path,sha256:sha(bytes),bytes:bytes.length});return route.fulfill({status:200,body:bytes,contentType:({html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2',png:'image/png',webp:'image/webp'})[extname(file).slice(1)]||'application/octet-stream'});}catch(error){if(error.code!=='ENOENT')throw error;return route.fulfill({status:404,body:''});}
    }
    assert.equal(request.headers().cookie,undefined);assert.equal(request.headers().referer,undefined);
    assert.ok(['/api/admin/registration/confirmation','/api/admin/registration/wallet','/api/registration/group-invite/synthetic-ux'].includes(path),'no business write endpoint is available');
    calls.push({path,method:request.method()});
    const cors={'access-control-allow-origin':SITE};
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{...cors,'access-control-allow-methods':'GET, POST, OPTIONS','access-control-allow-headers':'Content-Type'}});
    if(path==='/api/registration/group-invite/synthetic-ux'){assert.equal(request.method(),'GET');return route.fulfill({status:200,contentType:'image/png',headers:cors,body:png});}
    assert.equal(request.method(),'POST');const body=JSON.parse(request.postData());assert.deepEqual(Object.keys(body),['receiptToken']);assert.ok([token,second].includes(body.receiptToken));
    if(path.endsWith('/wallet'))return route.fulfill({status:200,contentType:'application/vnd.apple.pkpass',headers:cors,body:Buffer.from([80,75,3,4,1])});
    const other=body.receiptToken===second;
    const view={referenceCode:(other?'s':'r').repeat(43),submittedAt:'2026-10-21T00:00:00Z',
      event:{id:'synthetic-ux1',title:'合成活动完整名称与跨领域交流'.repeat(memory.long?10:1),date:'2026-12-05',time:'10:00–18:00',checkIn:'09:30',timezone:'Asia/Shanghai',venue:memory.long?'合成场地与楼层位置说明'.repeat(18):'合成活动场地'},
      attendee:{name:other?'合成另一人':memory.long?'合成长姓名'.repeat(20):memory.name,organization:'合成机构'},
      admission:{status:'confirmed',kind:'attendee',revision:2},email:{status:'provider_accepted'},wallet:{ready:true},
      notifications:{applicationReceived:{status:other?'rejected':'provider_accepted'},preEventReminder:{status:'unknown'}},
      groupInvite:memory.group?{platform:'wechat',qrImageUrl:API+'/api/registration/group-invite/synthetic-ux',expiresAt:new Date(Date.now()+600000).toISOString()}:null};
    return route.fulfill({status:memory.status,contentType:'application/json',headers:cors,body:JSON.stringify(memory.status===200?view:{error:{code:'SYNTHETIC_UNAVAILABLE'}})});
  });
  const open=async()=>{await page.goto(SITE+'/registration/confirmation/#r='+token,{waitUntil:'networkidle'});await page.locator('[data-confirmation-content]:visible').waitFor();};
  const close=async()=>{
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    assert.deepEqual(await page.evaluate(()=>({local:Object.entries(localStorage),session:Object.entries(sessionStorage)})),{local:[],session:[]});
    assert.equal(calls.some(call=>/submit|send|dispatch|approve|publish/u.test(call.path)),false);await context.close();
  };
  return {page,calls,memory,open,close};
}
async function cleared(page){
  for(const field of ['name','organization','event','date','time','venue','reference','email','application-received','pre-event-reminder'])assert.equal(await page.locator('[data-confirmation-'+field+']').textContent(),'');
  for(const selector of ['registration','notice-records','more','group-help'])assert.equal(await page.locator('[data-confirmation-'+selector+']').evaluate(node=>node.open),false);
  assert.equal(await page.locator('[data-confirmation-safari-guide]').isVisible(),false);assert.equal(await page.locator('[data-confirmation-copy-fallback]').isVisible(),false);
  assert.equal(await page.locator('[data-confirmation-private-link]').inputValue(),'');assert.equal(await page.locator('[data-confirmation-group] img').count(),0);
}
try{
  await mkdir(evidence,{recursive:true});
  for(const width of [320,390,1440]){
    const f=await fixture(width);try{
      await f.open();const {page}=f;
      const placement=await page.evaluate(()=>({copy:document.querySelector('[data-confirmation-copy]').getBoundingClientRect().toJSON(),group:document.querySelector('[data-confirmation-group]').getBoundingClientRect().top,height:innerHeight}));
      assert.ok(placement.copy.top>=0&&placement.copy.bottom<=placement.height,'the main copy action is in the first viewport for an ordinary attendee');assert.ok(placement.copy.bottom<placement.group,'saving precedes the group task');
      await page.screenshot({path:resolve(evidence,'confirmed-'+width+'.png'),fullPage:true});
      assert.equal(await page.locator('[data-confirmation-copy]').textContent(),'复制私人链接');
      assert.equal(await page.locator('[data-confirmation-reference]').isVisible(),false);assert.equal(await page.locator('[data-confirmation-event]').isVisible(),false);
      assert.equal(await page.locator('.confirmation-group-validity').isVisible(),false);
      await page.locator('[data-confirmation-more] summary').click();assert.equal(await page.locator('[data-confirmation-email]').isVisible(),false,'saving tools do not expose notification history');
      await page.locator('[data-confirmation-notice-records] summary').click();assert.equal(await page.locator('[data-confirmation-email]').isVisible(),true);
      assert.match(await page.locator('[data-confirmation-email]').textContent(),/已提交发送/u);assert.match(await page.locator('[data-confirmation-pre-event-reminder]').textContent(),/无法确认/u);
      assert.doesNotMatch(await page.locator('[data-confirmation-notice-records]').textContent(),/服务商|已送达/u);
      await page.locator('[data-confirmation-group-help] summary').click();assert.match(await page.locator('.confirmation-group-validity').textContent(),/10 分钟.*7 天.*不代表微信群码已过期/u);
      await page.locator('[data-confirmation-wallet]').click();await page.locator('[data-confirmation-safari-guide]:visible').waitFor();assert.equal(f.calls.some(call=>call.path.endsWith('/wallet')),false);
      assert.equal(await page.locator('#confirmation-safari-heading').evaluate(node=>document.activeElement===node),true);
      if(width===390)await page.screenshot({path:resolve(evidence,'wechat-safari-guide-390.png'),fullPage:true});
      await page.locator('[data-confirmation-safari-copy]').click();assert.deepEqual(await page.evaluate(()=>globalThis.__ux.copied),[locationFor(token)]);
      await page.locator('[data-confirmation-safari-close]').click();assert.equal(await page.locator('[data-confirmation-wallet]').evaluate(node=>document.activeElement===node),true);
      await page.locator('[data-confirmation-wallet]').click();await page.locator('#confirmation-safari-heading').press('Escape');assert.equal(await page.locator('[data-confirmation-safari-guide]').isVisible(),false);
      await page.evaluate(()=>{globalThis.__ux.failClipboard=true;});await page.locator('[data-confirmation-copy]').click();await page.locator('[data-confirmation-copy-fallback]:visible').waitFor();
      assert.equal(await page.locator('[data-confirmation-private-link]').inputValue(),locationFor(token));
      await page.locator('[data-confirmation-wallet]').click();await page.evaluate(value=>{location.hash='#r='+value;},second);await page.locator('[data-confirmation-name]').filter({hasText:'合成另一人'}).waitFor();
      assert.equal(await page.locator('[data-confirmation-private-link]').inputValue(),'');assert.equal(await page.locator('[data-confirmation-safari-guide]').isVisible(),false);
      for(const selector of ['registration','notice-records','more','group-help'])assert.equal(await page.locator('[data-confirmation-'+selector+']').evaluate(node=>node.open),false);
      await page.evaluate(()=>{globalThis.__ux.failClipboard=false;globalThis.__ux.delayClipboard=true;});
      await page.locator('[data-confirmation-copy]').click();await page.waitForFunction(()=>globalThis.__ux.pendingCopies.length===1);
      f.memory.status=503;await page.locator('[data-confirmation-refresh]').click();await page.locator('[data-confirmation-error]:visible').waitFor();await cleared(page);
      await page.evaluate(()=>{for(const resolve of globalThis.__ux.pendingCopies)resolve();});await page.waitForTimeout(30);
      assert.equal(await page.locator('[data-confirmation-action-status]').textContent(),'','a late copy completion does not repaint cleared feedback');await cleared(page);
      assert.equal(await page.evaluate(()=>globalThis.__ux.downloads),0);
      reports.push({width,copyInFirstViewport:true,saveBeforeGroup:true,registrationAndTechnicalDetailsCollapsed:true,notificationsSeparate:true,wechatGuideCopiesWithoutWalletIO:true,guideCloseAndEscapeReturnFocus:true,hashAndErrorClearAllPanels:true});
    }finally{await f.close();}
  }
  for(const device of ['safari','desktop','android','chromeios']){
    const f=await fixture(device==='desktop'?1440:390,device);try{
      await f.open();const {page}=f,button=page.locator('[data-confirmation-wallet]');
      if(device==='android'){assert.equal(await button.isVisible(),false);assert.match(await page.locator('[data-confirmation-device]').textContent(),/私人链接.*PDF/u);}
      else if(device==='chromeios'){assert.equal(await button.textContent(),'查看 Safari 添加指引');await button.click();assert.equal(await page.locator('[data-confirmation-wechat-step]').isVisible(),false);assert.equal(f.calls.some(call=>call.path.endsWith('/wallet')),false);}
      else{assert.equal(await button.textContent(),device==='safari'?'加入 Apple Wallet':'下载 Wallet 票券');await button.click();await page.locator('[data-confirmation-action-status]').filter({hasText:'票券文件已准备'}).waitFor();assert.equal(f.calls.filter(call=>call.path.endsWith('/wallet')&&call.method==='POST').length,1);assert.equal(await page.evaluate(()=>globalThis.__ux.downloads),1);}
      reports.push({device,correctActionAndLabel:true,noBusinessWrites:true});
    }finally{await f.close();}
  }
  {
    const f=await fixture(390,'safari');try{
      await f.open();const {page}=f;
      await page.evaluate(()=>dispatchEvent(new Event('beforeprint')));assert.equal(new URL(page.url()).hash,'');
      await page.emulateMedia({media:'print'});assert.equal(await page.locator('[data-confirmation-event]').isVisible(),true);assert.equal(await page.locator('[data-confirmation-reference]').isVisible(),true);assert.equal(await page.locator('[data-confirmation-notice-records]').isVisible(),false);
      await page.evaluate(()=>dispatchEvent(new Event('afterprint')));await page.emulateMedia({media:'screen'});assert.equal(await page.locator('[data-confirmation-registration]').evaluate(node=>node.open),false);assert.ok(new URL(page.url()).hash.startsWith('#r='));
      f.memory.long=true;await page.locator('[data-confirmation-refresh]').click();await page.locator('[data-confirmation-name]').filter({hasText:'合成长姓名'}).waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      reports.push({width:390,printRetainsFullRegistrationWithoutCapability:true,printRestoresDisclosure:true,longNamesAndVenueWrap:true});
    }finally{await f.close();}
  }
  assert.deepEqual(errors,[]);
  const html=await readFile(resolve(dist,'registration/confirmation/index.html'));
  const result={ok:true,dist,privateHtmlSha256:sha(html),reports,assets:[...assets.values()],pageErrors:errors,syntheticOnly:true,businessWrites:0,nativeWalletInstallation:false};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
function locationFor(receipt){return SITE+'/registration/confirmation/#r='+receipt;}
