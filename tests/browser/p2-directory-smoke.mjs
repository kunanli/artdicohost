// Actual built directory over isolated runtime; every request is intercepted.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/p2-directory');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';

async function seed(){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false});
  for(let index=0;index<55;index++){
    const saved=await runtime.createContact({name:'合成已处理 '+String(index).padStart(2,'0')});
    await runtime.app.contactsStore.saveOperations(saved.contact.id,saved.revision,{...saved.contact.operations,responseStatus:'declined'},runtime.users[0].id);
  }
  const reply=(await runtime.createContact({name:'合成最后待回复',organization:'合成机构'})).contact;
  const integrationSaved=await runtime.createContact({name:'合成等待整合',organization:'合成机构'});
  await runtime.app.contactsStore.saveOperations(integrationSaved.contact.id,integrationSaved.revision,{...integrationSaved.contact.operations,responseStatus:'attending'},runtime.users[0].id);
  return {runtime,reply,integration:integrationSaved.contact};
}
async function fixture(browser,width,username='owner'){
  const seeded=await seed(),{runtime}=seeded,context=await browser.newContext({viewport:{width,height:960}}),calls=[];
  const auth=await runtime.login(username),[name,...value]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  const controls={directoryFailure:false,contactsFailure:false,holdHealth:false,releaseHealth:null};
  const get=runtime.objects.get.bind(runtime.objects);
  runtime.objects.get=async(key,options)=>{if(controls.contactsFailure&&key.startsWith('cms/v1/contacts/'))throw new Error('SYNTHETIC_PRIVATE_SOURCE_FAILURE');return get(key,options);};
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,API);
    if(url.pathname.startsWith('/api/')){
      const entry={path:url.pathname,search:url.search,method:request.method()};calls.push(entry);
      assert.ok(request.method()==='GET'||url.pathname==='/api/admin/logout','directory never mutates a business record');
      if(controls.directoryFailure&&url.pathname==='/api/admin/people/directory')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'PERSON_UNAVAILABLE',message:'名单暂时无法核对。'}})});
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:request.postData()})}));
      entry.status=response.status;
      if(controls.holdHealth&&url.pathname==='/api/admin/people/health')await new Promise(resolve=>{controls.releaseHealth=resolve;});
      const headers=Object.fromEntries(response.headers);delete headers['content-length'];
      return route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    }
    const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));
    assert.ok(file.startsWith(dist+'/'));
    return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});
  });
  const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.dismiss());
  const before={contacts:await runtime.app.contactsStore.read(),admissions:await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]}),content:await runtime.app.store.read()};
  return {...seeded,context,page,calls,controls,before,width};
}
const rows=page=>page.locator('[data-directory-rows] tr');
async function loaded(page,text='符合筛选'){await page.locator('[data-directory-status]').filter({hasText:text}).waitFor();await page.locator('[data-directory-search] [type=submit]:enabled').waitFor();}
async function choose(page,work){await page.locator('[data-directory-work]').selectOption(work);await loaded(page);}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
async function unchanged(f){assert.deepEqual(await f.runtime.app.contactsStore.read(),f.before.contacts);assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.before.admissions);assert.deepEqual(await f.runtime.app.store.read(),f.before.content);assert.equal(f.runtime.messages.length,0);}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width),{page,calls,controls}=f;
    try{
      await page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(page);
      assert.equal(await page.locator('[data-directory-work]').inputValue(),'pending');
      assert.equal(await rows(page).count(),2,'pending is filtered before the first fifty rows');
      assert.match(await page.locator('[data-directory-rows]').textContent(),/合成最后待回复/u);
      assert.equal(await page.locator('[data-directory-head] th').count(),3);
      assert.equal(await page.locator('[data-directory-rows] [data-directory-primary]').count(),2);
      assert.equal(await page.locator('[data-directory-rows] button:visible').count(),0,'secondary actions remain in More');
      assert.equal(await page.locator('[data-contacts-legacy-tools]').getAttribute('open'),null);
      assert.doesNotMatch(await page.locator('[data-people-directory]').textContent(),/@example\.invalid|SYNTHETIC_ORIGINAL|receiptToken/u);
      const primary=rows(page).filter({hasText:'合成最后待回复'}).locator('[data-directory-primary]');
      assert.equal(await primary.getAttribute('href'),'/admin/person/#contact='+f.reply.id);
      await choose(page,'all');assert.equal(await rows(page).count(),50);assert.equal(await page.locator('[data-directory-next]').isVisible(),true);
      await page.locator('[data-directory-next]').click();await loaded(page);assert.equal(await rows(page).count(),7);
      await choose(page,'reply');assert.equal(await rows(page).count(),1);assert.match(await rows(page).textContent(),/合成最后待回复/u);
      await page.locator('[name=query]').fill('合成不存在');await page.locator('[data-directory-search] [type=submit]').click();await loaded(page);
      assert.equal(await rows(page).count(),0);assert.equal(await page.locator('[data-directory-empty]').isVisible(),true);
      await page.locator('[data-directory-search] [type=reset]').click();await loaded(page);assert.equal(await page.locator('[data-directory-work]').inputValue(),'pending');
      controls.directoryFailure=true;await page.locator('[data-directory-search] [type=submit]').click();await page.locator('[data-directory-error]:visible').waitFor();
      assert.equal(await rows(page).count(),0,'failed read clears stale actionable rows');assert.match(await page.locator('[data-directory-status]').textContent(),/不能据此判断为零/u);
      assert.equal(await page.locator('[data-directory-empty]').isVisible(),false);assert.equal(await page.locator('[data-contacts-legacy-tools]').getAttribute('open'),null);
      controls.directoryFailure=false;await page.locator('[data-directory-search] [type=submit]').click();await loaded(page);
      const health=page.locator('[data-directory-health]');await health.locator('summary').click();await page.locator('[data-directory-health-items] li').filter({hasText:'合成等待整合'}).waitFor();
      assert.match(await page.locator('[data-directory-health-items]').textContent(),/合成等待整合/u);
      assert.equal(calls.filter(call=>call.path==='/api/admin/people/health').length,1);
      controls.contactsFailure=true;await page.locator('[data-directory-health-refresh]').click();await page.locator('[data-directory-health-status]').filter({hasText:'部分资料暂时无法核对'}).waitFor();
      assert.equal(await page.locator('[data-directory-health-empty]').isVisible(),false,'unavailable source never becomes zero issues');
      controls.contactsFailure=false;await page.locator('[data-directory-health-refresh]').click();await page.locator('[data-directory-health-status]').filter({hasText:'需核对'}).waitFor();
      await noOverflow(page);const screenshot=resolve(evidence,'directory-'+width+'.png');await page.screenshot({path:screenshot,fullPage:false});
      assert.ok(calls.filter(call=>call.path==='/api/admin/people/directory').every(call=>new URLSearchParams(call.search).has('work')));
      assert.ok(calls.some(call=>call.path==='/api/admin/people/directory'&&new URLSearchParams(call.search).get('work')==='reply'));
      await unchanged(f);
      controls.holdHealth=true;await page.locator('[data-directory-health-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-directory-health-status]')?.textContent==='正在核对…');
      for(let attempt=0;!controls.releaseHealth&&attempt<1000;attempt++)await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal(typeof controls.releaseHealth,'function','delayed health read reached the intercepted completion');
      await page.locator('[data-contacts-logout]').click();await page.locator('[data-contacts-login-panel]:visible').waitFor();
      const lateResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/admin/people/health');controls.releaseHealth();await lateResponse;
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.locator('[data-directory-health-items]').textContent(),'');assert.equal(await rows(page).count(),0);
      reports.push({width,pendingBeforePagination:true,allPageSizes:[50,7],threeColumns:true,onePrimaryPerPerson:true,sourceFailureClearsActions:true,partialHealthNotZero:true,logoutClearsLateHealth:true,requests:calls.length,screenshot});
    }finally{await f.context.close();}
  }
  const restricted=await fixture(browser,390,'outreach');
  try{
    await restricted.page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded(restricted.page);
    assert.equal(await restricted.page.locator('[data-directory-health]').isVisible(),false);
    await restricted.page.locator('[data-directory-health]').evaluate(element=>{element.open=true;});await restricted.page.waitForTimeout(30);
    assert.equal(restricted.calls.filter(call=>call.path==='/api/admin/people/health').length,0,'restricted role never asks for cross-source health');
    await unchanged(restricted);reports.push({width:390,role:'outreach',healthRequests:0});
  }finally{await restricted.context.close();}
  assert.deepEqual(errors,[]);
  const result={ok:true,dist,adminHtmlSha256:createHash('sha256').update(await readFile(resolve(dist,'admin/contacts/index.html'))).digest('hex'),reports,pageErrors:errors};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
