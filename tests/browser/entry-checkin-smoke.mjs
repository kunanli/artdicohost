import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createHash} from 'node:crypto';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||'dist'),evidence=resolve(process.env.ARTDICO_ENTRY_EVIDENCE_DIRECTORY||'.local-data/browser-evidence/entry-checkin');
const origin='https://api.artdico.host',code='a'.repeat(22),id='b'.repeat(43),pageErrors=[],reports=[];
const session={user:{id:'synthetic-door-staff',label:'合成工作人员',roles:['reviewer']},csrfToken:'c'.repeat(43)};
const initial={ticketCode:code,revision:0,registrationId:id,name:'合成参会者',organization:'合成组织',admissionStatus:'confirmed',checkedInAt:null,eligible:true,canCheckIn:true};
const mime=file=>({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
async function fixture(browser,width,mode){
  const context=await browser.newContext({viewport:{width,height:900}}),calls=[];let authenticated=mode!=='login',checked=mode==='already',operation=null,unknownThrown=false;
  const view=()=>({...initial,...(checked?{revision:1,checkedInAt:'2026-12-05T02:00:00.000Z',canCheckIn:false}:{})});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin,'all requests stay inside synthetic interception');
    if(url.pathname.startsWith('/api/')){
      calls.push({path:url.pathname,method:request.method()});let status=200,body;
      if(url.pathname==='/api/admin/session'){status=authenticated?200:401;body=authenticated?session:{error:{code:'AUTH_REQUIRED'}};}
      else if(url.pathname==='/api/admin/login'){authenticated=true;body=session;}
      else if(url.pathname==='/api/admin/logout'){authenticated=false;body={ok:true};}
      else if(!authenticated){status=401;body={error:{code:'AUTH_REQUIRED'}};}
      else if(url.pathname==='/api/admin/checkin/'+code&&request.method()==='GET'){
        status=mode==='revoked'?404:200;body=status===200?view():{error:{code:'ENTRY_NOT_FOUND'}};
      }else if(url.pathname==='/api/admin/checkin/'+code&&request.method()==='POST'){
        const input=request.postDataJSON();assert.deepEqual(Object.keys(input).sort(),['expectedRevision','operationId']);assert.equal(input.expectedRevision,0);assert.match(input.operationId,/^[A-Za-z0-9_-]{43}$/u);assert.equal((await request.allHeaders())['x-csrf-token'],session.csrfToken);
        operation=input.operationId;checked=true;body={...view(),operationId:operation,outcome:'checked_in'};
        if(mode==='unknown'&&!unknownThrown){unknownThrown=true;return route.abort('failed');}
      }else if(url.pathname==='/api/admin/checkin/'+code+'/operation/'+operation){body={found:true,result:{...view(),operationId:operation,outcome:'checked_in'}};}
      else throw new Error('SYNTHETIC_UNEXPECTED_REQUEST');
      return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    }
    const file=resolve(dist,'.'+(url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname));assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));
  return {context,page,calls,width,mode};
}
async function layout(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('[data-entry-confirm]').evaluate(element=>Number.parseFloat(getComputedStyle(element).fontSize)>=16),true);}
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const [width,mode]of [[320,'normal'],[390,'normal'],[1440,'already'],[390,'unknown'],[390,'login'],[390,'revoked']]){
    const f=await fixture(browser,width,mode),{page,calls}=f;
    try{
      await page.goto(origin+'/admin/checkin/#ticket='+code,{waitUntil:'networkidle'});
      assert.equal(new URL(page.url()).hash,'','scan fragment is removed immediately after capture');
      assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0,'ticket and private fields are never browser persisted');
      if(mode==='login'){
        await page.locator('[data-entry-login-panel]:visible').waitFor();assert.equal(await page.locator('[data-entry-name]').textContent(),'');
        await page.locator('[name=username]').fill('synthetic');await page.locator('[name=password]').fill('synthetic-password');await page.locator('[data-entry-login] button').click();
        await page.locator('[data-entry-record]:visible').waitFor();assert.equal(await page.locator('[name=password]').inputValue(),'');
      }else if(mode==='revoked'){
        await page.locator('[data-entry-error]:visible').waitFor();assert.equal(await page.locator('[data-entry-name]').textContent(),'');assert.equal(await page.locator('[data-entry-confirm]').isVisible(),false);
      }else await page.locator('[data-entry-record]:visible').waitFor();
      assert.equal(calls.filter(call=>call.path.startsWith('/api/admin/checkin/')&&call.method==='POST').length,0,'scan and login never check in');
      if(mode==='normal'||mode==='login'||mode==='unknown'){
        await page.locator('[data-entry-confirm]:enabled').click();
        if(mode==='unknown'){
          await page.locator('[data-entry-check]:visible').waitFor();assert.equal(await page.locator('[data-entry-confirm]').isVisible(),false);await page.locator('[data-entry-check]:enabled').click();
        }
        await page.locator('[data-entry-message]').filter({hasText:'已入场'}).waitFor();assert.equal(await page.locator('[data-entry-confirm]').isVisible(),false);
        await page.locator('[data-entry-refresh]').click();await page.locator('[data-entry-message]').filter({hasText:'已入场'}).waitFor();
        assert.equal(calls.filter(call=>call.path.startsWith('/api/admin/checkin/')&&call.method==='POST').length,1,'only explicit first confirmation mutates');
      }
      if(mode==='already'){assert.match(await page.locator('[data-entry-message]').textContent(),/已入场/u);assert.equal(await page.locator('[data-entry-confirm]').isVisible(),false);}
      await layout(page);await page.screenshot({path:resolve(evidence,'entry-'+width+'-'+mode+'.png'),fullPage:true});
      if(mode!=='revoked'){
        await page.locator('[data-entry-logout]:enabled').click();await page.locator('[data-entry-login-panel]:visible').waitFor();assert.equal(await page.locator('[data-entry-name]').textContent(),'');assert.equal(await page.locator('[data-entry-organization]').textContent(),'');
      }
      reports.push({width,mode,fragmentRemoved:true,localPrivateStorage:0,overflow:false,entryWrites:calls.filter(call=>call.path.startsWith('/api/admin/checkin/')&&call.method==='POST').length,originalLookup:mode==='unknown'?calls.some(call=>call.path.includes('/operation/')):null});
    }finally{await f.context.close();}
  }
  assert.deepEqual(pageErrors,[]);assert.equal(reports.length,6);
  const result={ok:true,cases:6,sourceCommit:process.env.GITHUB_SHA??null,adminCheckinHtmlSha256:createHash('sha256').update(await readFile(resolve(dist,'admin/checkin/index.html'))).digest('hex'),reports,pageErrors:0,syntheticOnly:true};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('Entry check-in browser verified: '+JSON.stringify(result)+'\n');
}finally{await browser.close();}
