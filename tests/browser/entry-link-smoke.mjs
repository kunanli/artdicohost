// Built /r/ capability entry: every request is intercepted, and the resolved
// private destination is a safe local 404. No real API, persistence or POST.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_ENTRY_LINK_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/entry-link'));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const SITE='https://artdico.host',API='https://api.artdico.host',code='s'.repeat(22);
const API_PATH='/api/admin/registration/entry-links/'+code;
const TARGET=SITE+'/registration/confirmation/#r=c1.synthetic.signature';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const publicHtml=await readFile(resolve(dist,'index.html')),rHtml=await readFile(resolve(dist,'r/index.html'));
const sourceCommit=execFileSync('git',['-C',project,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
const scriptSha256=sha(await readFile(fileURLToPath(import.meta.url))),assets=new Map(),reports=[],pageErrors=[];
const mime=file=>({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]||'application/octet-stream';
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
await mkdir(evidence,{recursive:true});
try{
  for(const scenario of ['valid','invalid-code','offsite-target','revoked-retry']){
    const context=await browser.newContext({locale:'zh-CN',viewport:{width:390,height:940}}),calls=[],navigations=[],storageCalls=[];
    await context.addCookies([{domain:new URL(API).hostname,path:'/',name:'synthetic_link_cookie',value:'must-not-send',secure:true,httpOnly:true,sameSite:'None'}]);
    await context.exposeBinding('__entryLinkStorageProbe',(_,method)=>storageCalls.push(method));
    await context.addInitScript(()=>{
      for(const method of ['getItem','setItem','removeItem','clear','key'])Object.defineProperty(Storage.prototype,method,{configurable:true,value(){void window.__entryLinkStorageProbe('Storage.'+method);throw new Error('SYNTHETIC_STORAGE_FORBIDDEN');}});
      Object.defineProperty(IDBFactory.prototype,'open',{configurable:true,value(){void window.__entryLinkStorageProbe('indexedDB.open');throw new Error('SYNTHETIC_STORAGE_FORBIDDEN');}});
    });
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());assert.equal(request.method(),'GET','short entry never posts');
      if(request.isNavigationRequest())navigations.push({origin:url.origin,path:url.pathname});
      if(url.origin===API){
        assert.equal(page.url(),SITE+'/r/','capability fragment is cleared before the API read');
        assert.equal(url.pathname,API_PATH);assert.equal(url.search,'');const headers=await request.allHeaders();assert.equal(headers.cookie,undefined);assert.equal(headers.referer,undefined);calls.push({method:request.method(),path:url.pathname});
        const headersOut={'access-control-allow-origin':SITE,'cache-control':'private, no-store'};
        if(scenario==='revoked-retry')return route.fulfill({status:404,contentType:'application/json',headers:headersOut,body:JSON.stringify({error:{code:'ENTRY_NOT_FOUND'}})});
        return route.fulfill({status:200,contentType:'application/json',headers:headersOut,body:JSON.stringify({confirmationUrl:scenario==='offsite-target'?'https://external.example.invalid/registration/confirmation/#r=c1.synthetic.signature':TARGET})});
      }
      assert.equal(url.origin,SITE,'all destinations stay first party');
      if(url.pathname==='/registration/confirmation/')return route.fulfill({status:404,contentType:'text/html',headers:{'cache-control':'no-store'},body:'<!doctype html><title>Synthetic destination</title><main>SAFE_SYNTHETIC_DESTINATION_404</main>'});
      if(url.pathname==='/favicon.ico')return route.fulfill({status:204,body:''});
      assert.ok(url.pathname==='/r/'||/^\/_astro\/[A-Za-z0-9_.-]+$/u.test(url.pathname),'only the compiled short page and its assets');
      const file=resolve(dist,'.'+(url.pathname==='/r/'?'/r/index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
      const bytes=await readFile(file);if(url.pathname.startsWith('/_astro/'))assets.set(url.pathname,{path:url.pathname,bytes:bytes.length,sha256:sha(bytes)});
      return route.fulfill({status:200,contentType:mime(file),headers:{'cache-control':'no-store'},body:bytes});
    });
    const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
    try{
      await page.goto(SITE+'/r/#'+(scenario==='invalid-code'?'invalid':code),{waitUntil:'networkidle'});
      if(scenario==='valid'){
        await page.waitForURL(TARGET,{waitUntil:'networkidle'});assert.equal(page.url(),TARGET);assert.equal(await page.locator('main').textContent(),'SAFE_SYNTHETIC_DESTINATION_404');assert.equal(calls.length,1);
        assert.deepEqual(navigations,[{origin:SITE,path:'/r/'},{origin:SITE,path:'/registration/confirmation/'}]);
      }else{
        const status=page.locator('[data-entry-link-status]'),retry=page.locator('[data-entry-link-retry]');await status.filter({hasText:'链接暂时无法使用'}).waitFor();assert.equal(page.url(),SITE+'/r/');assert.equal(calls.length,scenario==='invalid-code'?0:1);
        if(scenario==='invalid-code'){assert.equal(await retry.isVisible(),false);}
        else{await retry.waitFor({state:'visible'});}
        if(scenario==='revoked-retry'){
          const response=page.waitForResponse(response=>new URL(response.url()).origin===API&&new URL(response.url()).pathname===API_PATH);
          await retry.click();await response;await retry.waitFor({state:'visible'});assert.equal(calls.length,2);assert.equal(page.url(),SITE+'/r/');await status.filter({hasText:'链接暂时无法使用'}).waitFor();
        }
        assert.deepEqual(navigations,[{origin:SITE,path:'/r/'}]);
      }
      assert.deepEqual(storageCalls,[]);assert.equal((await context.cookies(SITE)).length,0);
      assert.equal(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      const screenshot=resolve(evidence,'short-link-'+scenario+'.png');await page.screenshot({path:screenshot,fullPage:false});
      reports.push({scenario,width:390,apiReads:calls.length,posts:0,storageCalls:0,cookiesSent:0,targetNavigationVerified:scenario==='valid',safeSyntheticTarget404:scenario==='valid',offsiteNavigation:false,fragmentRemovedBeforeResolution:true,retryReadOnly:scenario==='revoked-retry',screenshot});
    }finally{await context.close();}
  }
  assert.deepEqual(pageErrors,[]);assert.equal(reports.length,4);const result={ok:true,cases:4,expectedCases:4,sourceCommit,publicHtmlSha256:sha(publicHtml),rHtmlSha256:sha(rHtml),scriptSha256,assets:[...assets.values()],reports,pageErrors:0,allRequestsIntercepted:true,businessWrites:0,posts:0,realPrivatePageRequests:0};await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('Entry short link browser verified: '+JSON.stringify({...result,reports:undefined})+'\n');
}finally{await browser.close();}
