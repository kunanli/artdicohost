// Compiled sessions UI and public timetable over actual, isolated memory OSS.
// Every browser request is intercepted. No live records, provider or storage are used.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_SESSION_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/session-publication-order'));
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE,PEOPLE_FIXTURE_PASSWORD}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {validateContent,orderedSessions}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),reports=[],pageErrors=[];
const EXPECTED_CASES=8,ROUTE='/admin/content/sessions/',PRIVATE='SYNTHETIC_SESSION_INTERNAL_NEVER_PUBLIC';
const EARLY='synthetic-session-a-early',LATE='synthetic-session-a-late',LAST='synthetic-session-a-last',AM='synthetic-session-a-morning',NOON='synthetic-session-a-noon',DRAFT='synthetic-session-a-draft';
const TITLE='合成 Houdini 讲座：从创作想法到可交互的程序化场景';
const clone=value=>structuredClone(value),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime=file=>({html:'text/html',js:'text/javascript',mjs:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
const sourceCommit=process.env.ARTDICO_SOURCE_COMMIT||process.env.GITHUB_SHA||(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',maxBuffer:4096})).stdout.trim();
assert.match(sourceCommit,/^[a-f0-9]{40}$/u);
function session(id,start,end,zone,title,status='scheduled'){return{id,start,end,zone,title,format:'talk',guestId:'',speakerName:'合成讲者',speakerStatus:'pending',status,internalNotes:PRIVATE+' '+id};}
function sessions({unsorted=false}={}){
  const rows=[session(AM,'09:30','10:00','A','合成上午交流'),session('synthetic-session-b-morning','10:00','11:00','B','合成B区上午'),session(DRAFT,'10:00','10:15','A','合成未安排场次','draft'),session(NOON,'12:00','12:30','A','合成正午场次'),session(EARLY,'13:30','14:15','A','合成原讲座（主题待定）'),session('synthetic-session-b-afternoon','13:45','14:15','B','合成B区午后'),session(LATE,'14:30','15:15','A','合成后续讲座'),session(LAST,'15:30','16:00','A','合成最后分享')];
  if(unsorted){const early=rows.findIndex(row=>row.id===EARLY),late=rows.findIndex(row=>row.id===LATE);[rows[early],rows[late]]=[rows[late],rows[early]];}return rows;
}
async function setup(browser,{width=1440,role='owner',unsorted=false,unrelatedDraft=false,pendingTitle=false}={}){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false}),state=await runtime.app.store.read();
  const content=clone(state.draft.content);content.sessions=sessions({unsorted});content.guests=[];content.organizations=[];content.showcases=[];content.booths=[];delete content.sessionOrder;
  const checked=validateContent(content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  await runtime.app.store.save(state.draft.revision,checked.value,runtime.users[0].id);
  const owner=await runtime.login();
  async function staffState(){const response=await runtime.app.handle(runtime.request('/api/admin/content',{headers:owner}));assert.equal(response.status,200);return response.json();}
  async function publishSeed(){const snapshot=await staffState();assert.equal(snapshot.attendancePreview.status,'ready');const response=await runtime.app.handle(runtime.request('/api/admin/content/publish',{method:'POST',headers:owner,body:{expectedRevision:snapshot.draft.revision,expectedContactsRevision:snapshot.attendancePreview.guestAttendance.sourceRevision}}));assert.equal(response.status,200,await response.clone().text());}
  await publishSeed();
  if(unrelatedDraft||pendingTitle){const current=(await runtime.app.store.read()).draft,changed=clone(current.content);if(pendingTitle)changed.sessions.find(row=>row.id===EARLY).title=TITLE;
    if(unrelatedDraft)changed.organizations=[{id:'synthetic-session-extra-organization',name:'合成其他待发布组织',logoId:'',website:'',participation:'undecided',status:'pending',publicConsent:false,visibility:'public',internalNotes:PRIVATE}];
    await runtime.app.store.save(current.revision,changed,runtime.users[0].id);}
  let username=role;
  if(role==='publisher'){username='synthetic-session-publisher';await runtime.app.userStore.save({expectedRevision:0,username,label:'合成仅发布同事',roles:['publisher'],active:true,password:PEOPLE_FIXTURE_PASSWORD},runtime.users[0].id);}
  const auth=role==='owner'?owner:await runtime.login(username),context=await browser.newContext({locale:'zh-CN',viewport:{width,height:960}}),calls=[],dialogs=[],assets=new Map();
  const [name,...value]=auth.Cookie.split('=');await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  let publishBudget=0,nextSaveFault=null,failReads=false,nextPublishFault=false;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;assert.ok([API,SITE].includes(url.origin),'all requests stay intercepted at the two synthetic origins');
    if(path.startsWith('/api/')){
      assert.equal(url.origin,API);const headers=await request.allHeaders(),raw=request.postData(),call={path,method:request.method(),raw};calls.push(call);
      const writing=!['GET','HEAD','OPTIONS'].includes(request.method());if(writing)assert.ok(path==='/api/admin/content'&&request.method()==='PUT'||path==='/api/admin/content/publish'&&request.method()==='POST','only explicit synthetic content saves and publications may write');
      if(path.startsWith('/api/public/')){assert.equal(headers.cookie,undefined);assert.equal(headers.authorization,undefined);}
      if(path==='/api/admin/content/publish'){assert.ok(publishBudget>0,'publication requires an explicit test gesture');publishBudget--;if(nextPublishFault){nextPublishFault=false;call.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_PUBLISH_UNAVAILABLE',message:'合成发布回执不可用'}},503));}}
      if(path==='/api/admin/content'&&request.method()==='GET'&&failReads){call.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_PROOF_UNAVAILABLE'}},503));}
      if(path==='/api/admin/content'&&request.method()==='PUT'&&nextSaveFault){nextSaveFault=null;call.status=503;return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));}
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers,...(writing?{body:raw}:{})}));call.status=response.status;
      const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-length'];return route.fulfill({status:response.status,headers:responseHeaders,body:Buffer.from(await response.arrayBuffer())});
    }
    const served=url.origin===API?aliases.get(path)||path:path,file=resolve(dist,'.'+(served.endsWith('/')?served+'index.html':served));assert.ok(file.startsWith(dist+'/'));
    try{const body=await readFile(file);if(/\.(?:html|js|css)$/u.test(file))assets.set(path,hash(body));return route.fulfill({status:200,contentType:mime(file),body});}catch{return route.fulfill({status:404,body:''});}
  });
  const admin=await context.newPage();admin.setDefaultTimeout(15000);admin.on('pageerror',error=>pageErrors.push(error.message));
  let confirmDecision=true;admin.on('dialog',async dialog=>{dialogs.push({type:dialog.type(),message:dialog.message(),accepted:confirmDecision});if(confirmDecision)await dialog.accept();else await dialog.dismiss();confirmDecision=true;});
  async function anonymous(){const response=await runtime.app.handle(runtime.request('/api/public/content',{origin:SITE}));assert.equal(response.status,200);return response.json();}
  async function publicPage(){const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>pageErrors.push(error.message));await page.goto(SITE+'/',{waitUntil:'networkidle'});await page.locator('#program-'+EARLY).waitFor({state:'attached'});return page;}
  return{runtime,context,admin,width,calls,dialogs,assets,anonymous,publicPage,staffState,allowPublish:()=>publishBudget++,cancelConfirm:()=>{confirmDecision=false;},failNextSave:()=>{nextSaveFault='before';},failReads:()=>{failReads=true;},failNextPublish:()=>{nextPublishFault=true;}};
}
const saves=f=>f.calls.filter(c=>c.path==='/api/admin/content'&&c.method==='PUT');
const publications=f=>f.calls.filter(c=>c.path==='/api/admin/content/publish');
const moveButton=(page,id,direction)=>page.locator('[data-content-order-kind="sessions"][data-content-order-id="'+id+'"][data-content-order-direction="'+direction+'"][data-content-order-scope="editor"]');
const badge=(page,id)=>page.locator('[data-admin-sessions] [data-publication-kind="sessions"][data-publication-id="'+id+'"]');
async function idle(f){await f.admin.locator('[data-admin-logout]:enabled').waitFor();}
async function saved(f){await f.admin.locator('[data-admin-savebar][data-save-state="saved"]').waitFor({state:'attached'});await idle(f);}
async function open(f){await f.admin.goto(API+ROUTE,{waitUntil:'networkidle'});await f.admin.locator('[data-content-panel="sessions"]:visible').waitFor();await idle(f);}
async function editTitle(f,title=TITLE){await f.admin.getByRole('button',{name:'编辑场次 合成原讲座（主题待定）',exact:true}).click();await f.admin.locator('[data-session-form] [name="title"]').fill(title);await f.admin.locator('[data-session-submit]').click();await saved(f);await f.admin.locator('[data-session-dialog] [data-close-dialog="session"]').first().click();await f.admin.locator('[data-session-dialog]').waitFor({state:'hidden'});await idle(f);}
async function publish(f,{cancel=false,fail=false}={}){const button=f.admin.locator('[data-session-publish]');await button.waitFor({state:'visible'});await f.admin.locator('[data-session-publish]:enabled').waitFor();await button.scrollIntoViewIfNeeded();assert.equal(await button.isEnabled(),true,'nearby publish is enabled for a current verified snapshot');if(cancel)f.cancelConfirm();else f.allowPublish();if(fail)f.failNextPublish();const before=publications(f).length;await button.click();await idle(f);if(cancel)assert.equal(publications(f).length,before,'cancel sends no publication POST');else assert.equal(publications(f).length,before+1,'one explicit confirmation sends exactly one publication POST');}
async function refreshSite(page){await page.waitForTimeout(1100);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));}
async function zoneIds(page,zone='A'){return page.locator('[data-agenda-panel="'+zone+'"] .ah-agenda-row').evaluateAll(nodes=>nodes.map(node=>node.id.replace(/^program-/u,'')));}
async function noOverflow(page){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}
async function screenshot(page,name){const path=resolve(evidence,name);await page.screenshot({path,fullPage:false});return path;}
async function noReal(f){assert.equal(f.runtime.messages.length,0);const content=JSON.stringify((await f.anonymous()).content);assert.equal(content.includes(PRIVATE),false);}
async function closeFixture(f){for(const [index,page]of f.context.pages().entries())try{await page.screenshot({path:resolve(evidence,'diagnostic-last-'+reports.length+'-'+f.width+'-'+index+'.png'),fullPage:false});}catch{}await f.context.close();}
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--disable-dev-shm-usage']});await mkdir(evidence,{recursive:true});
try{
  for(const width of [390,1440]){
    const f=await setup(browser,{width,unrelatedDraft:true});try{
      const site=await f.publicPage(),before=await f.anonymous();await open(f);await editTitle(f);assert.equal(saves(f).length,1);assert.equal(publications(f).length,0);
      assert.match(await badge(f.admin,EARLY).textContent(),/待更新|待发布/u);const pending=await f.anonymous();assert.equal(pending.revision,before.revision);assert.equal(pending.content.sessions.find(row=>row.id===EARLY).title,'合成原讲座（主题待定）');assert.equal(pending.content.organizations.length,0);
      assert.equal((await f.runtime.app.store.read()).draft.content.sessions.find(row=>row.id===EARLY).speakerStatus,'pending','pending speaker is independent from a published title');
      const waiting=await screenshot(f.admin,'title-saved-'+width+'.png');await publish(f);assert.match(f.dialogs.at(-1).message,/全部/u);assert.match(f.dialogs.at(-1).message,/新增\s*1/u);assert.match(f.dialogs.at(-1).message,/更新\s*1/u);
      const published=await f.anonymous();assert.equal(published.content.sessions.find(row=>row.id===EARLY).title,TITLE);assert.equal(published.content.organizations.length,1,'explicit impact confirmation covers another saved public change');assert.match(await badge(f.admin,EARLY).textContent(),/已发布|已同步/u);
      await refreshSite(site);await site.locator('#program-'+EARLY+' strong').filter({hasText:TITLE}).waitFor();assert.equal(await site.locator('#program-'+DRAFT).count(),0);await noOverflow(site);await noOverflow(f.admin);await noReal(f);
      reports.push({case:'save-title-then-explicit-publish',width,pendingTitleBlockedBySpeaker:false,saveDoesNotPublish:true,globalImpactConfirmed:true,publishedTitleMatchesAPIAndDOM:true,mailRequests:0,screenshots:[waiting,await screenshot(f.admin,'title-published-'+width+'.png')]});await site.close();
    }finally{await closeFixture(f);}
  }
  for(const width of [390,1440]){
    const f=await setup(browser,{width,unsorted:true});try{
      const site=await f.publicPage();await open(f);const before=(await f.runtime.app.store.read()).draft.content;assert.equal(Object.hasOwn(before,'sessionOrder'),false);assert.deepEqual(await zoneIds(site),[AM,NOON,EARLY,LATE,LAST]);
      assert.equal(await moveButton(f.admin,NOON,'up').isDisabled(),true,'the first afternoon row cannot cross the morning boundary');assert.equal(await moveButton(f.admin,LAST,'down').isDisabled(),true);assert.equal(await f.admin.locator('[data-content-order-kind="sessions"][data-content-order-id="'+DRAFT+'"]:enabled').count(),0,'draft sessions cannot be moved by public display controls');assert.equal(await badge(f.admin,DRAFT).textContent(),'未公开','a draft cannot promise that a publish click will expose it');
      const confirms=f.dialogs.length;await moveButton(f.admin,EARLY,'down').click();await saved(f);assert.equal(f.dialogs.length,confirms,'ordinary order save has no confirmation');assert.equal(saves(f).length,1);assert.equal(publications(f).length,0);
      const after=(await f.runtime.app.store.read()).draft.content;assert.equal(after.sessionOrder,'manual');const effective=orderedSessions(before.sessions,before.sessionOrder);assert.deepEqual(effective.map(row=>row.id),[AM,DRAFT,'synthetic-session-b-morning',NOON,EARLY,'synthetic-session-b-afternoon',LATE,LAST],'legacy effective order is chronological, including stable zone ties');const expected=effective.map(row=>row.id),a=expected.indexOf(EARLY),b=expected.indexOf(LATE);[expected[a],expected[b]]=[expected[b],expected[a]];assert.deepEqual(after.sessions.map(row=>row.id),expected,'only same-zone afternoon neighbours swap in the current effective display; draft and other-zone display positions remain');
      for(const row of before.sessions)assert.deepEqual(after.sessions.find(item=>item.id===row.id),row,'manual display order never edits time, field, ID or relation');assert.equal(Object.hasOwn((await f.anonymous()).content,'sessionOrder'),false);assert.deepEqual(await zoneIds(site),[AM,NOON,EARLY,LATE,LAST],'a save alone cannot update the public timetable');
      await publish(f);const published=await f.anonymous();assert.equal(published.content.sessionOrder,'manual');assert.equal(await badge(f.admin,DRAFT).textContent(),'未公开','explicit publication still excludes the draft');await refreshSite(site);await site.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('[data-agenda-panel="A"] .ah-agenda-row')].map(node=>node.id.replace(/^program-/,'')))===JSON.stringify(expected),[AM,NOON,LATE,EARLY,LAST]);assert.deepEqual(await zoneIds(site,'B'),['synthetic-session-b-morning','synthetic-session-b-afternoon']);assert.equal(await site.locator('#program-'+DRAFT).count(),0);
      assert.equal(await site.locator('#program-'+NOON).evaluate(node=>{let previous=node.previousElementSibling;while(previous&&!previous.dataset.programDivider)previous=previous.previousElementSibling;return previous?.dataset.programDivider;}),'afternoon','12:00 belongs to afternoon');
      assert.equal(await site.locator('#program-'+LATE+' time').textContent(),'14:30–15:15');assert.equal(await site.locator('#program-'+EARLY+' time').textContent(),'13:30–14:15');assert.deepEqual(await site.locator('[data-agenda-panel="A"] [data-program-divider]').evaluateAll(nodes=>nodes.map(node=>node.dataset.programDivider)),['morning','afternoon']);await site.goto(SITE+'/#program-'+EARLY,{waitUntil:'networkidle'});await site.locator('#program-'+EARLY).waitFor();assert.deepEqual(await zoneIds(site),[AM,NOON,LATE,EARLY,LAST]);assert.equal(await site.locator('[data-zone="A"]').getAttribute('aria-selected'),'true');assert.equal(new URL(site.url()).hash,'#program-'+EARLY,'manual order keeps stable deep links');await noOverflow(f.admin);await noOverflow(site);await noReal(f);
      reports.push({case:'manual-same-zone-and-period-order',width,defaultChronological:true,explicitManualMode:true,otherZoneAndDraftDisplayPositionsPreserved:true,legacyRawArrayCanonicalized:true,noonIsAfternoon:true,stableDeepLink:true,timesUnchanged:true,saveDoesNotPublish:true,frontendMatchesManualOrder:true,mailRequests:0,screenshot:await screenshot(f.admin,'manual-order-'+width+'.png')});await site.close();
    }finally{await closeFixture(f);}
  }
  {
    const f=await setup(browser,{width:390,pendingTitle:true});try{await open(f);const before=await f.anonymous();await publish(f,{cancel:true});assert.deepEqual(await f.anonymous(),before);assert.match(await badge(f.admin,EARLY).textContent(),/待更新|待发布/u);await noReal(f);reports.push({case:'cancel-global-publication',width:390,publishPosts:0,publicSnapshotUnchanged:true,mailRequests:0});}finally{await closeFixture(f);}
  }
  {
    const f=await setup(browser,{width:390});try{await open(f);const before=await f.anonymous();f.failNextSave();await moveButton(f.admin,EARLY,'down').click();await f.admin.locator('[data-admin-savebar][data-save-state="unknown"]').waitFor({state:'attached'});await idle(f);assert.equal(saves(f).length,1);assert.equal(await f.admin.locator('[data-session-publish]').isDisabled(),true);assert.equal(await f.admin.locator('[data-content-order-kind="sessions"]:enabled').count(),0);
      const feedback=f.admin.locator('[data-session-publication-feedback]').first();assert.match(await feedback.textContent(),/待核对|未确认|核对/u);await f.admin.locator('[data-admin-check-save]:visible').first().click();await idle(f);assert.equal(saves(f).length,1,'checking never retries the original save');assert.equal(publications(f).length,0);assert.deepEqual(await f.anonymous(),before);await noReal(f);reports.push({case:'unknown-save-blocks-publish-and-order',width:390,savePosts:1,lookupOnly:true,publishPosts:0,publicSnapshotUnchanged:true,mailRequests:0,screenshot:await screenshot(f.admin,'unknown-save.png')});}finally{await closeFixture(f);}
  }
  {
    const editor=await setup(browser,{width:390,role:'editor',pendingTitle:true});try{await open(editor);const button=editor.admin.locator('[data-session-publish]');assert.ok(!await button.isVisible()||await button.isDisabled(),'editor cannot publish');await button.evaluate(node=>node.click());await idle(editor);assert.equal(publications(editor).length,0);await noReal(editor);}finally{await closeFixture(editor);}
    const publisher=await setup(browser,{width:1440,role:'publisher',pendingTitle:true});try{await open(publisher);assert.equal(await publisher.admin.locator('[data-content-order-kind="sessions"]:enabled').count(),0);assert.equal(await publisher.admin.locator('[data-admin-sessions] [data-row-action="edit"]:enabled').count(),0);await publish(publisher);assert.equal((await publisher.anonymous()).content.sessions.find(row=>row.id===EARLY).title,TITLE);await noReal(publisher);reports.push({case:'editor-and-publisher-permissions',widths:[390,1440],editorPublishPosts:0,publisherSavePosts:saves(publisher).length,publisherPublishPosts:1,mailRequests:0});}finally{await closeFixture(publisher);}
  }
  {
    const f=await setup(browser,{width:390,unsorted:true,pendingTitle:true});try{const site=await f.publicPage();await open(f);assert.equal(Object.hasOwn((await f.anonymous()).content,'sessionOrder'),false);assert.deepEqual(await zoneIds(site),[AM,NOON,EARLY,LATE,LAST],'legacy absence keeps chronological rendering even for an unsorted stored array');const old=await f.anonymous();await publish(f,{fail:true});assert.deepEqual(await f.anonymous(),old);const feedback=f.admin.locator('[data-session-publication-feedback]').first();await feedback.waitFor({state:'visible'});assert.match(await feedback.textContent(),/发布.*待核对|发布.*未|核对/u);assert.equal(publications(f).length,1);await noOverflow(f.admin);await noReal(f);reports.push({case:'legacy-time-default-and-publication-failure',width:390,absentModePreserved:true,legacyChronological:true,failedPublishDoesNotClaimSuccess:true,publishPosts:1,mailRequests:0,screenshot:await screenshot(f.admin,'publish-failure.png')});await site.close();}finally{await closeFixture(f);}
  }
  assert.equal(reports.length,EXPECTED_CASES);assert.deepEqual(pageErrors,[]);
  const status=(await promisify(execFile)('git',['status','--porcelain'],{cwd:source,encoding:'utf8',maxBuffer:4096})).stdout.trim();
  const result={ok:true,cases:reports.length,expectedCases:EXPECTED_CASES,sourceCommit,sourceTreeClean:status==='',sourceQualification:status?'local-working-tree-not-exact-commit-proof':'clean-checkout',scriptSha256:hash(await readFile(fileURLToPath(import.meta.url))),publicHtmlSha256:hash(await readFile(resolve(dist,'index.html'))),adminHtmlSha256:hash(await readFile(resolve(dist,'admin/index.html'))),reports,pageErrors,realMail:0,realBusinessWrites:0,uninterceptedNetwork:0};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');process.stdout.write('Session publication/order browser verified: '+JSON.stringify({...result,reports:undefined})+'\n');
}finally{await browser.close();}
