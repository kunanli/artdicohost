// One actual application, publication and attendee across compiled pages, real
// notification services and a disposable signed Wallet. Every request is local
// and intercepted. Receipt capabilities and pass bytes stay only in memory.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/p6-event-facts'));
const {p6EventFactsFixture}=await import(pathToFileURL(resolve(source,'tests/helpers/p6-event-facts-fixture.mjs')));
const {passFiles}=await import(pathToFileURL(resolve(source,'tests/apple-wallet-fixture.mjs')));
const {eventConfig}=await import(pathToFileURL(resolve(source,'src/config/event.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const SITE='https://artdico.host',API='https://api.artdico.host',MIME='application/vnd.apple.pkpass';
const sha=value=>createHash('sha256').update(value).digest('hex');
const mime=file=>({html:'text/html; charset=utf-8',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2',ico:'image/x-icon'})[extname(file).slice(1)]||'application/octet-stream';
const expected={id:'ggj-cn-2026',title:eventConfig.title,date:'2026-12-05',time:'10:00–18:00',checkIn:'09:30',venue:eventConfig.venue.address,timezone:'Asia/Shanghai'};
const publicHtml=await readFile(resolve(dist,'index.html')),privateHtml=await readFile(resolve(dist,'registration/confirmation/index.html'));
assert.ok(publicHtml.includes(Buffer.from('https://api.artdico.host')),'test the configured public build');
assert.ok(privateHtml.includes(Buffer.from('https://api.artdico.host')),'test the configured private page build');
const assets=new Map(),reports=[],pageErrors=[];
const f=await p6EventFactsFixture();
let browser,result;

function noticeEvidence(){
  assert.equal(f.runtime.messages.length,3,'application receipt, formal confirmation and reminder are independently issued once');
  return f.runtime.messages.map((message,index)=>{
    const fields=message.template_params;
    for(const [key,value]of Object.entries({event_title:expected.title,event_date:expected.date,event_time:expected.time,event_venue:expected.venue}))assert.equal(fields[key],value,'mock email uses the same checked public '+key);
    const text=fields.invitation_text;
    if(index===0){assert.match(text,/申请已收到/u);assert.match(text,/尚未确认参会名额/u);assert.doesNotMatch(text,/你的参会名额已确认|Apple Wallet/u);}
    else{
      assert.ok(text.includes('日期：'+expected.date));assert.ok(text.includes('活动时间：'+expected.time));
      assert.ok(text.includes('签到：'+expected.checkIn));assert.ok(text.includes('地点：'+expected.venue));
      if(index===1)assert.match(text,/你的参会名额已确认/u);else assert.match(text,/出发前打开私人参会页/u);
    }
    return {kind:['application_received','registration','pre_event_reminder'][index],bodySha256:sha(text),providerAccepted:true};
  });
}
function noBusinessWritesSince(index){
  assert.equal(f.runtime.objects.calls.slice(index).some(call=>call.operation!=='get'),false,'reading pages, signing and checking a pass never writes business journals');
  assert.equal(f.runtime.messages.length,3,'reading pages or a Wallet never sends another email');
}
async function bounded(promise,ms=10000){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Wallet Blob handoff timed out')),ms);})]);}finally{clearTimeout(timer);}
}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'public and private pages fit the viewport');}

async function browserContext(width){
  const context=await browser.newContext({viewport:{width,height:960},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce',acceptDownloads:false});
  await context.addCookies([{name:'synthetic_staff',value:'SYNTHETIC_P6_STAFF_COOKIE',domain:new URL(API).hostname,path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
  const calls=[],walletResponses=[],confirmationViews=[];let resolveBlob,unexpectedDownloads=0;
  await context.exposeBinding('__p6WalletBlob',(_scope,value)=>{
    assert.ok(value?.mime===MIME&&typeof value.base64==='string'&&value.base64.length<=1_400_000,'only a bounded PKPASS Blob may cross the test binding');
    const bytes=Buffer.from(value.base64,'base64');assert.ok(bytes.length>4&&bytes.length<=1024*1024,'the received Wallet Blob is bounded');
    assert.ok(resolveBlob,'a real Wallet button activation must be awaiting its Blob');
    const accept=resolveBlob;resolveBlob=null;accept(bytes);
  });
  await context.addInitScript(()=>{
    const blobs=new Map(),create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),click=HTMLAnchorElement.prototype.click;
    URL.createObjectURL=blob=>{const url=create(blob);blobs.set(url,blob);return url;};
    URL.revokeObjectURL=url=>{blobs.delete(url);return revoke(url);};
    HTMLAnchorElement.prototype.click=function(){
      const blob=blobs.get(this.href);
      if(this.download==='artdico-host.pkpass'&&this.href.startsWith('blob:')&&blob){
        // Preserve the actual fetch, ZIP/MIME validation and Blob construction;
        // skip only the native save, which would persist a private ticket.
        void blob.arrayBuffer().then(buffer=>{
          const bytes=new Uint8Array(buffer);let text='';
          for(let offset=0;offset<bytes.length;offset+=16384)text+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
          return window.__p6WalletBlob({mime:blob.type,base64:btoa(text)});
        });return;
      }
      return click.apply(this,arguments);
    };
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  await page.clock.setSystemTime(new Date(f.walletFixture.now));
  page.on('pageerror',error=>pageErrors.push({width,type:error.name}));
  page.on('download',download=>{unexpectedDownloads++;void download.delete().catch(()=>{});});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.ok([SITE,API].includes(url.origin),'all network requests remain inside intercepted synthetic origins');
    if(url.origin===API){
      const publicRead=path==='/api/public/content'||path==='/api/admin/registration/config';
      const confirmationRead=['/api/admin/registration/confirmation','/api/registration/confirmation'].includes(path);
      const walletRead=['/api/admin/registration/wallet','/api/registration/wallet'].includes(path);
      assert.ok(publicRead||confirmationRead||walletRead,'the browser may call only the existing public/capability read endpoints');
      assert.ok(publicRead?request.method()==='GET':['POST','OPTIONS'].includes(request.method()),'no application, approval, notification or publication write is possible from this browser');
      const headers=await request.allHeaders();assert.equal(headers.cookie,undefined,'public reads omit available staff cookies');assert.equal(headers.authorization,undefined);
      if(confirmationRead||walletRead){
        assert.equal(headers.referer,undefined,'capability reads omit Referer');
        if(request.method()==='POST'){
          const body=JSON.parse(request.postData());assert.deepEqual(Object.keys(body),['receiptToken']);assert.ok(body.receiptToken===f.receiptToken,'all surfaces use the same saved attendee capability');
        }
      }
      const entry={path,method:request.method()};calls.push(entry);
      const actual=new Request(request.url(),{method:request.method(),headers,...(['GET','HEAD','OPTIONS'].includes(request.method())?{}:{body:request.postData()})});
      const response=await (confirmationRead?f.confirmationHandle(actual):walletRead?f.walletHandle(actual):f.runtime.app.handle(actual));
      entry.status=response.status;const body=Buffer.from(await response.arrayBuffer()),responseHeaders=Object.fromEntries(response.headers);
      if(confirmationRead||walletRead){assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('access-control-allow-origin'),SITE);}
      if(request.method()==='POST'&&response.status===200){
        if(confirmationRead)confirmationViews.push(JSON.parse(body.toString('utf8')));
        if(walletRead){assert.equal(response.headers.get('content-type'),MIME);walletResponses.push(body);}
      }
      return route.fulfill({status:response.status,headers:responseHeaders,body});
    }
    assert.equal(request.method(),'GET');assert.ok(path==='/'||path==='/registration/confirmation/'||path.startsWith('/_astro/')||path==='/favicon.ico','only fixed compiled page and asset paths are served');
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{
      const bytes=await readFile(file);assets.set(path,{path,bytes:bytes.length,sha256:sha(bytes)});
      return route.fulfill({status:200,contentType:mime(file),body:bytes});
    }catch(error){if(error.code!=='ENOENT')throw error;return route.fulfill({status:404,body:''});}
  });
  return {context,page,calls,walletResponses,confirmationViews,
    async walletBlob(){const pending=new Promise(resolve=>{assert.ok(resolveBlob==null);resolveBlob=resolve;});await page.locator('[data-confirmation-wallet]').click();const bytes=await bounded(pending);assert.equal(unexpectedDownloads,0,'a private pass is never saved by the test');return bytes;},
    get nativeDownloads(){return unexpectedDownloads;}};
}
async function homeFacts(page,date=expected.date){
  await page.locator('[data-public-date-value]').filter({hasText:date}).first().waitFor();
  assert.equal(await page.locator('h1[data-public-event-title]').getAttribute('aria-label'),expected.title,'visible brand styling retains the canonical public event title');
  assert.equal(await page.locator('[data-public-date-value]').first().getAttribute('datetime'),date);
  assert.equal((await page.locator('[data-home-hours]').textContent()).trim(),expected.time);
  assert.ok((await page.locator('[data-public-static-checkin]').first().textContent()).includes(expected.checkIn));
  assert.equal(await page.locator('[data-public-hero-venue]').textContent(),expected.venue);
  assert.equal(await page.locator('[data-public-event-venue]').first().textContent(),expected.venue);
  await noOverflow(page);
}
async function privateFacts(page,{conflict=false}={}){
  await page.locator('[data-confirmation-content]:visible').waitFor();
  assert.equal(await page.locator('[data-confirmation-event]').textContent(),expected.title);
  assert.equal(await page.locator('[data-confirmation-date]').textContent(),expected.date);
  assert.equal(await page.locator('[data-confirmation-time]').textContent(),expected.time+'（UTC+8），'+expected.checkIn+' 开始签到');
  assert.equal(await page.locator('[data-confirmation-venue]').textContent(),expected.venue);
  assert.equal(await page.locator('[data-confirmation-facts-warning]').isVisible(),conflict);
  assert.equal(await page.locator('[data-confirmation-wallet]').isVisible(),!conflict);
  await noOverflow(page);
}
async function verifyPass(bytes,view){
  const files=passFiles(bytes),manifest=JSON.parse(files.get('manifest.json')),pass=JSON.parse(files.get('pass.json'));
  const fileNames=['icon.png','icon@2x.png','background.png','background@2x.png','artwork.png','artwork@2x.png','manifest.json','pass.json','signature'];
  assert.deepEqual([...files.keys()].sort(),fileNames.sort());
  assert.deepEqual(Object.keys(manifest).sort(),fileNames.filter(name=>!['manifest.json','signature'].includes(name)).sort());
  for(const [name,digest]of Object.entries(manifest))assert.equal(createHash('sha1').update(files.get(name)).digest('hex'),digest,'the signed manifest binds every pass resource');
  assert.ok(pass.serialNumber===expected.id+'-'+f.registrationId,'the signed pass belongs to the same canonical registration');
  assert.ok(pass.eventTicket.secondaryFields.find(field=>field.key==='name')?.value===view.attendee.name,'the pass and private page name the same synthetic attendee');
  const start=expected.date+'T10:00:00+08:00';assert.equal(pass.relevantDate,start);assert.equal(pass.semantics.eventStartDate,start);
  assert.equal(pass.semantics.eventName,expected.title);assert.equal(pass.semantics.venueName,expected.venue);
  assert.equal(pass.eventTicket.auxiliaryFields.find(field=>field.key==='date')?.value,expected.date);
  assert.equal(pass.eventTicket.auxiliaryFields.find(field=>field.key==='time')?.value,expected.time);
  assert.equal(pass.eventTicket.backFields.find(field=>field.key==='venue')?.value,expected.venue);
  assert.equal(Object.hasOwn(pass,'checkIn'),false,'no check-in field is invented in the Wallet contract');
  assert.equal(Object.values(pass.eventTicket).flat().some(field=>/check.?in/iu.test(field.key)),false);
  assert.equal(pass.webServiceURL,undefined,'an already saved pass does not claim automatic updates');assert.equal(pass.authenticationToken,undefined);
  // Only a manifest of hashes and its detached signature reach the disposable
  // fixture directory. Neither pass.json nor a PKPASS archive is written.
  await writeFile(resolve(f.walletFixture.directory,'manifest.json'),files.get('manifest.json'));
  await writeFile(resolve(f.walletFixture.directory,'signature'),files.get('signature'));
  try{f.walletFixture.run(['cms','-verify','-binary','-inform','DER','-in','signature','-content','manifest.json','-CAfile','root.pem','-purpose','any','-out','/dev/null']);}catch{throw new Error('Independent synthetic CMS verification failed');}
  const verification=new URL(pass.barcodes[0].message);assert.equal(verification.origin,API);
  const checked=await f.walletHandle(new Request(verification,{headers:{Origin:SITE}}));assert.equal(checked.status,200);
  const validity=await checked.json();assert.deepEqual(Object.keys(validity).sort(),['valid','eventId','admissionStatus','verifiedAt'].sort());assert.equal(validity.valid,true);assert.equal(validity.eventId,expected.id);
  return {sha256:sha(bytes),bytes:bytes.length,manifestVerified:true,cmsVerified:true,liveAdmissionVerified:true,relevantDate:start,checkInFieldAbsent:true};
}

try{
  const {factsKeySha256,...actualFacts}=f.publicFacts;assert.deepEqual(actualFacts,expected);
  const notices=noticeEvidence(),mailHashes=notices.map(item=>item.bodySha256);
  const admissionHash=sha(JSON.stringify(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]})));
  browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  let priorPass;
  for(const width of [320,390,1440]){
    const c=await browserContext(width),before=f.runtime.objects.calls.length;
    try{
      await c.page.goto(SITE+'/',{waitUntil:'networkidle'});await homeFacts(c.page);
      await c.page.goto(SITE+'/registration/confirmation/#r='+f.receiptToken,{waitUntil:'networkidle'});await privateFacts(c.page);
      const view=c.confirmationViews.at(-1);assert.equal(view.eventFacts.ready,true);assert.equal(view.eventFacts.revision,f.initialFacts.revision);
      assert.equal(view.email.status,'provider_accepted');assert.equal(view.notifications.applicationReceived.status,'provider_accepted');assert.equal(view.notifications.preEventReminder.status,'provider_accepted');
      const bytes=await c.walletBlob();assert.equal(c.walletResponses.length,1,'one explicit activation creates one actual signed response');
      assert.ok(bytes.equals(c.walletResponses[0]),'compiled client Blob bytes exactly equal the real Wallet HTTP response');
      const wallet=await verifyPass(bytes,view);priorPass=bytes;
      noBusinessWritesSince(before);assert.deepEqual(noticeEvidence().map(item=>item.bodySha256),mailHashes);
      reports.push({width,homeAndPrivateFactsMatch:true,publishedRevision:f.initialFacts.revision,notices:'application receipt, formal confirmation, reminder accepted by mock provider only',wallet:{...wallet,clientBlobHandoffVerified:true,nativeDownloadSaved:false},publicReads:c.calls.filter(call=>call.path==='/api/public/content').length,capabilityReads:c.calls.filter(call=>call.method==='POST').length,noBusinessWrites:true,noExtraMessages:true,noOverflow:true});
    }finally{await c.context.close();}
  }
  const priorPassHash=sha(priorPass),conflicting=await f.conflictPublishedFacts();
  const c=await browserContext(390),before=f.runtime.objects.calls.length;
  try{
    await c.page.goto(SITE+'/',{waitUntil:'networkidle'});await homeFacts(c.page,'2026-12-06');
    await c.page.goto(SITE+'/registration/confirmation/#r='+f.receiptToken,{waitUntil:'networkidle'});await privateFacts(c.page,{conflict:true});
    assert.equal(c.confirmationViews.at(-1).eventFacts.reason,'EVENT_FACTS_MISMATCH');
    const denied=await c.page.evaluate(async({origin,receiptToken})=>{
      const response=await fetch(origin+'/api/admin/registration/wallet',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json'},body:JSON.stringify({receiptToken})});
      const value=await response.json();return {status:response.status,code:value.error?.code};
    },{origin:API,receiptToken:f.receiptToken});
    assert.deepEqual(denied,{status:503,code:'EVENT_FACTS_UNAVAILABLE'});assert.equal(c.walletResponses.length,0);assert.equal(c.nativeDownloads,0);
    assert.deepEqual(noticeEvidence().map(item=>item.bodySha256),mailHashes,'new publication does not rewrite already issued mock emails');
    assert.equal(sha(priorPass),priorPassHash);assert.equal(JSON.parse(passFiles(priorPass).get('pass.json')).relevantDate,expected.date+'T10:00:00+08:00','an existing signed pass remains its original version');
    noBusinessWritesSince(before);
    reports.push({width:390,conflictingPublishedRevision:conflicting.revision,homeShowsNewPublication:true,privateFactsWarning:true,newWalletDenied:'EVENT_FACTS_UNAVAILABLE',newPasses:0,priorMailAndPassUnchanged:true,noBusinessWrites:true,noExtraMessages:true,noOverflow:true});
  }finally{await c.context.close();}
  assert.equal(sha(JSON.stringify(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}))),admissionHash,'the integration read leaves the original admission unchanged');
  assert.deepEqual(pageErrors,[]);
  assert.equal(sha(await readFile(resolve(dist,'index.html'))),sha(publicHtml),'the tested public build remains frozen');
  assert.equal(sha(await readFile(resolve(dist,'registration/confirmation/index.html'))),sha(privateHtml),'the tested private build remains frozen');
  result={ok:true,syntheticOnly:true,publicFacts:f.publicFacts,initialPublishedRevision:f.initialFacts.revision,publicHtmlSha256:sha(publicHtml),privateHtmlSha256:sha(privateHtml),notices,reports,assets:[...assets.values()].sort((a,b)=>a.path.localeCompare(b.path)),pageErrors,privacy:{capabilitiesPersisted:false,passArchivePersisted:false,passJsonPersisted:false,privatePageScreenshots:false,ephemeralSignerCleanedOnExit:true},scope:{signedApiAndCompiledClientBlob:true,nativeDownloadOrWalletInstallation:false,providerAcceptanceIsDeliveryProof:false}};
}finally{try{await browser?.close();}finally{await f.cleanup();}}
// A cleanup failure is a failed run, never a successful evidence file.
await mkdir(evidence,{recursive:true});await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');
process.stdout.write(JSON.stringify(result,null,2)+'\n');
