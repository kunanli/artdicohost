// Actual built people directory over memory OSS. All network is intercepted;
// no real records, recipients, credentials or backend requests are used.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API as API} from '../helpers/people-runtime-fixture.mjs';
import {CLOUD_ADMIN_PAGE_ALIASES} from '../../functions/cloud-content/http-server.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url)),dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist'));
const evidence=resolve(process.env.ARTDICO_PEOPLE_ENTRY_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/people-entry-order-delete'));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),reports=[],errors=[];
const mime=file=>({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',woff2:'font/woff2',png:'image/png',svg:'image/svg+xml',webp:'image/webp'})[extname(file).slice(1)]||'application/octet-stream';
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
await mkdir(evidence,{recursive:true});
try{
  for(const width of [390,1440]){
    let clock=Date.parse('2026-11-02T08:00:00.000Z');const f=await peopleRuntimeFixture({attendeeReviewRequired:false,clock:()=>clock}),calls=[];
    const registration=await f.seedPublic({intake:'general-v2'});clock+=60000;const first=await f.createContact({name:'A 合成较早'});clock+=60000;const latest=await f.createContact({name:'Z 合成最新'});
    const auth=await f.login(),context=await browser.newContext({viewport:{width,height:960}}),[cookieName,...cookieValue]=auth.Cookie.split('=');
    await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name:cookieName,value:cookieValue.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
    let dropArchiveAck=width===390;
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());assert.equal(url.origin,API);
      if(url.pathname.startsWith('/api/')){
        const entry={path:url.pathname,method:request.method()};calls.push(entry);
        assert.ok(request.method()==='GET'||request.method()==='POST'&&(/\/archive$/u.test(url.pathname)||/\/deletion-request$/u.test(url.pathname)),'only explicitly tested synthetic delete mutations');
        const response=await f.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(request.method()==='GET'?{}:{body:request.postData()})}));entry.status=response.status;
        if(dropArchiveAck&&request.method()==='POST'&&url.pathname.endsWith('/archive')){dropArchiveAck=false;return route.abort('failed');}
        const headers=Object.fromEntries(response.headers);delete headers['content-length'];return route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
      }
      const path=aliases.get(url.pathname)||url.pathname,file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});
    });
    const page=await context.newPage();page.setDefaultTimeout(18000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>void dialog.accept());
    const loaded=async()=>{await page.locator('[data-directory-status]').filter({hasText:'符合筛选'}).waitFor();await page.locator('[data-directory-search] [type=submit]:enabled').waitFor();};
    try{
      await page.goto(API+'/admin/contacts/',{waitUntil:'networkidle'});await loaded();await page.locator('[data-directory-work]').selectOption('all');await loaded();
      const rows=page.locator('[data-directory-rows] tr');assert.equal(await rows.count(),3);
      assert.equal(await rows.nth(0).getAttribute('data-directory-person'),'contact:'+latest.contact.id);
      assert.equal(await rows.nth(1).getAttribute('data-directory-person'),'contact:'+first.contact.id);
      assert.equal(await rows.nth(2).getAttribute('data-directory-person'),'registration:'+registration.reference_code);
      assert.equal(await rows.nth(0).locator('time').getAttribute('datetime'),latest.contact.createdAt);assert.match(await rows.nth(0).locator('time').textContent(),/录入：/u);
      await rows.nth(0).locator('summary').click();await rows.nth(0).getByRole('button',{name:'删除',exact:true}).click();
      await page.locator('[data-directory-status]').filter({hasText:width===390?'已核对删除结果':'已从名单删除'}).waitFor();assert.equal(await rows.count(),2);
      assert.equal(calls.filter(row=>row.method==='POST'&&row.path.endsWith('/archive')).length,1,'lost ACK is resolved with a read, never a duplicate write');
      const retained=(await f.app.contactsStore.read()).contacts.find(row=>row.id===latest.contact.id);assert.ok(retained.archivedAt);assert.deepEqual(retained.source,latest.contact.source);
      const registrationRow=rows.filter({has:page.locator('[data-directory-primary][href="/admin/person/#registration='+registration.reference_code+'"]')});
      await registrationRow.locator('summary').click();await registrationRow.getByRole('button',{name:'删除',exact:true}).click();
      await page.locator('[data-directory-status]').filter({hasText:'已删除报名'}).waitFor();assert.equal(await rows.count(),1);
      const admissions=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.equal(admissions.people.find(row=>row.registrationId===registration.reference_code).status,'withdrawn');assert.equal(f.messages.length,0);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);const screenshot=resolve(evidence,'people-order-delete-'+width+'.png');await page.screenshot({path:screenshot,fullPage:false});
      reports.push({width,actualCreationOrder:true,visibleRecordedAt:true,archivePosts:1,lostAcknowledgement:width===390,deletedRegistrationWithdrawn:true,retainedHistory:true,messages:0,screenshot});
    }finally{await context.close();}
  }
  assert.deepEqual(errors,[]);const result={ok:true,cases:reports.length,sourceCommit:process.env.GITHUB_SHA??null,htmlSha256:createHash('sha256').update(await readFile(resolve(dist,'admin/contacts/index.html'))).digest('hex'),reports,pageErrors:errors};await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('People entry order/delete browser verified: '+JSON.stringify({...result,reports:undefined})+'\n');
}finally{await browser.close();}
