// Compiled admin pages over the actual isolated runtime and native IndexedDB.
// Every request is intercepted; only synthetic content, accounts and memory OSS are used.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(process.env.ARTDICO_ORDER_EVIDENCE_DIRECTORY||resolve(project,'.local-data/browser-evidence/admin-display-order'));
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE,PEOPLE_FIXTURE_PASSWORD}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES);
const KINDS=['guests','showcases','organizations'];
const PRIVATE='SYNTHETIC_ORDER_PRIVATE_NEVER_PUBLIC';
const AT='2026-10-21T09:00:00.000Z';
const EXPECTED_CASE_COUNT=8;
const syntheticWrites={contentSaves:0,publications:0,accountSaves:0};
const clone=value=>structuredClone(value);
const ids=rows=>rows.map(row=>row.id);
const publicIds=(content,kind)=>ids(content[kind].filter(row=>row.visibility!=='private'));
const orderedIds=kind=>[1,2,3].map(index=>'synthetic-order-'+kind+'-'+index);
const routeFor=key=>'/admin/content/'+key+'/';
const json=(value,status=200)=>({status,contentType:'application/json',body:JSON.stringify(value)});
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',jpg:'image/jpeg',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');

async function seed(runtime){
  const content=clone((await runtime.app.store.read()).draft.content);
  const names=[1,'private',2,3];
  content.guests=names.map(index=>({id:'synthetic-order-guests-'+index,name:'合成排序嘉宾 '+index,company:'合成机构',ggjRole:'',title:'合成职务',portraitId:'',status:'pending',publicConsent:false,publicRoles:['guest'],visibility:index==='private'?'private':'public',internalNotes:PRIVATE+'-guest-'+index}));
  content.organizations=names.map(index=>({id:'synthetic-order-organizations-'+index,name:'合成排序组织 '+index,logoId:'',website:'https://example.invalid/organization/'+index,participation:'undecided',status:'pending',publicConsent:false,visibility:index==='private'?'private':'public',internalNotes:PRIVATE+'-organization-'+index}));
  content.showcases=names.map(index=>({id:'synthetic-order-showcases-'+index,kind:index===2?'indie':'student',title:'合成排序作品 '+index,teamName:'合成署名 '+index,school:PRIVATE+'-school-'+index,contactName:PRIVATE+'-contact-'+index,email:'synthetic.order.'+index+'@example.invalid',wechat:PRIVATE+'-wechat-'+index,memberCount:2,participationForms:[],responseStatus:'pending',materialLinks:'https://example.invalid/'+PRIVATE+'/'+index,summary:'合成作品说明 '+index,coverId:'',status:'pending',publicConsent:false,sessionId:'',boothId:'',visibility:index==='private'?'private':'public',internalNotes:PRIVATE+'-work-'+index}));
  const checked=validateContent(content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  await runtime.app.store.save(0,checked.value,runtime.users[0].id);
  syntheticWrites.contentSaves++;
  const owner=await runtime.login(),stateResponse=await runtime.app.handle(runtime.request('/api/admin/content',{headers:owner}));
  assert.equal(stateResponse.status,200);const state=await stateResponse.json();assert.equal(state.attendancePreview.status,'ready');
  const published=await runtime.app.handle(runtime.request('/api/admin/content/publish',{method:'POST',headers:owner,body:{expectedRevision:state.draft.revision,expectedContactsRevision:state.attendancePreview.guestAttendance.sourceRevision}}));
  assert.equal(published.status,200,await published.clone().text());
  syntheticWrites.publications++;
  return clone(checked.value);
}

async function fixture(browser,errors,{width=1440,username='owner',fault='normal'}={}){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false}),initial=await seed(runtime);
  if(username==='synthetic-order-publisher'){await runtime.app.userStore.save({expectedRevision:0,username,label:'合成仅发布同事',roles:['publisher'],active:true,password:PEOPLE_FIXTURE_PASSWORD},runtime.users[0].id);syntheticWrites.accountSaves++;}
  const auth=await runtime.login(username),context=await browser.newContext({viewport:{width,height:940}});
  const [cookieName,...cookieValue]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name:cookieName,value:cookieValue.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  const page=await context.newPage();page.setDefaultTimeout(12000);await page.clock.setFixedTime(new Date(AT));
  const calls=[],dialogs=[],assets=new Map(),confirmDecisions=[];let nextFault=fault,publicationBudget=0,failProofAfterSave=false,proofReadsUnavailable=false;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{const accepted=dialog.type()==='confirm'&&confirmDecisions.length?confirmDecisions.shift():true;dialogs.push({type:dialog.type(),message:dialog.message(),accepted});if(accepted)await dialog.accept();else await dialog.dismiss();});
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    assert.ok([SITE,API].includes(url.origin),'all network origins remain intercepted');
    if(path.startsWith('/api/')){
      assert.equal(url.origin,API);const headers=await request.allHeaders(),rawBody=request.postData(),body=rawBody?JSON.parse(rawBody):null;
      const call={path,method:request.method(),rawBody,body};calls.push(call);
      assert.equal(/\/(?:dispatch|send|sent|manual-sent|users)(?:\/|$)/u.test(path),false,'sorting never sends notices or manages accounts');
      if(path==='/api/admin/content/publish'){assert.ok(publicationBudget>0,'publication requires an explicit test gesture');publicationBudget--;}
      const saving=path==='/api/admin/content'&&request.method()==='PUT',currentFault=saving?nextFault:null;
      if(saving)nextFault='normal';
      if(currentFault==='unknown-uncommitted'){call.status=503;return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));}
      if(path==='/api/admin/content'&&request.method()==='GET'&&proofReadsUnavailable){call.status=503;return route.fulfill(json({error:{code:'SYNTHETIC_PROOF_UNAVAILABLE'}},503));}
      if(path.startsWith('/api/public/')){assert.equal(headers.cookie,undefined,'anonymous projection never receives staff cookies');assert.equal(headers.authorization,undefined);}
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers,...(['GET','HEAD'].includes(request.method())?{}:{body:rawBody})}));
      call.status=response.status;
      if(response.ok&&saving){syntheticWrites.contentSaves++;if(failProofAfterSave)proofReadsUnavailable=true;}
      if(response.ok&&path==='/api/admin/content/publish')syntheticWrites.publications++;
      if(currentFault==='unknown-committed'&&response.ok)return route.fulfill(json({error:{code:'STORAGE_UNAVAILABLE'}},503));
      const responseHeaders=Object.fromEntries(response.headers);delete responseHeaders['content-length'];
      return route.fulfill({status:response.status,headers:responseHeaders,body:Buffer.from(await response.arrayBuffer())});
    }
    const served=url.origin===API?aliases.get(path)||path:path;
    const file=resolve(dist,'.'+(served.endsWith('/')?served+'index.html':served));assert.ok(file.startsWith(dist+'/'));
    try{const body=await readFile(file);if(/\.(?:html|js|css)$/u.test(file))assets.set(path,digest(body));return route.fulfill({status:200,contentType:mime(file),body});}
    catch{return route.fulfill({status:404,body:''});}
  });
  async function anonymous(){const response=await runtime.app.handle(runtime.request('/api/public/content',{origin:SITE}));assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),SITE);return response.json();}
  return{runtime,initial,auth,context,page,calls,dialogs,assets,anonymous,allowPublish:()=>{publicationBudget++;},confirmOnce:accepted=>confirmDecisions.push(accepted),setFault:value=>{nextFault=value;},failProofAfterNextSave:()=>{failProofAfterSave=true;},restoreProofReads:()=>{failProofAfterSave=false;proofReadsUnavailable=false;},close:()=>context.close()};
}

const saves=f=>f.calls.filter(call=>call.path==='/api/admin/content'&&call.method==='PUT');
const publications=f=>f.calls.filter(call=>call.path==='/api/admin/content/publish');
const order=(page,kind,id,direction,scope)=>page.locator('[data-content-order-kind="'+kind+'"][data-content-order-id="'+id+'"][data-content-order-direction="'+direction+'"][data-content-order-scope="'+scope+'"]');
const orderSet=(page,scope)=>page.locator('[data-content-order-kind]'+(scope?'[data-content-order-scope="'+scope+'"]':''));
async function waitState(f,state){await f.page.locator('[data-admin-savebar][data-save-state="'+state+'"]').waitFor({state:'attached'});await f.page.locator('[data-admin-logout]:enabled').waitFor();}
async function open(f,key){await f.page.goto(API+routeFor(key),{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await f.page.locator('[data-content-panel="'+key+'"]:visible').waitFor();await waitState(f,'loaded');}
async function preview(f){await f.page.locator('[data-admin-preview]').click();await f.page.locator('[data-admin-preview-panel]:visible').waitFor();}
async function edges(f,kind,scope,sequence){assert.equal(await order(f.page,kind,sequence[0],'up',scope).isDisabled(),true,'first visible record cannot move up');assert.equal(await order(f.page,kind,sequence.at(-1),'down',scope).isDisabled(),true,'last visible record cannot move down');}
async function move(f,kind,id,direction,scope){
  const before=saves(f).length,confirmations=f.dialogs.filter(row=>row.type==='confirm').length,button=order(f.page,kind,id,direction,scope);
  await button.scrollIntoViewIfNeeded();const position=await button.evaluate(node=>({top:node.getBoundingClientRect().top,href:location.href}));
  await button.click();await waitState(f,'saved');
  await f.page.waitForFunction(({kind,id,scope})=>{const node=document.activeElement;return node?.dataset.contentOrderKind===kind&&node.dataset.contentOrderId===id&&node.dataset.contentOrderScope===scope&&!node.disabled;},{kind,id,scope});
  const after=await f.page.evaluate(()=>{const box=document.activeElement.getBoundingClientRect();return{top:box.top,bottom:box.bottom,left:box.left,right:box.right,scrollY,maximum:Math.max(0,document.documentElement.scrollHeight-innerHeight),height:innerHeight,width:innerWidth,href:location.href};});
  assert.equal(after.href,position.href,'sorting keeps the same page');assert.ok(after.top>=-1&&after.bottom<=after.height+1&&after.left>=-1&&after.right<=after.width+1,'focus returns to a visible enabled control for the same record and scope');
  assert.ok(Math.abs(after.top-position.top)<=4||after.scrollY<=1||after.maximum-after.scrollY<=1,'the focused ordering control keeps its position, allowing document-edge clamping');
  assert.equal(saves(f).length,before+1,'one ordering gesture performs one full-content save');assert.equal(f.dialogs.filter(row=>row.type==='confirm').length,confirmations,'ordinary ordering save does not prompt for confirmation');
}
async function moveWithUnavailablePreview(f,kind,id,direction){
  const before=saves(f).length,start=f.calls.length,confirmations=f.dialogs.filter(row=>row.type==='confirm').length;
  f.failProofAfterNextSave();await order(f.page,kind,id,direction,'preview').click();await waitState(f,'saved');
  await f.page.waitForFunction(()=>{const node=document.activeElement;return node?.matches('[data-admin-attendance-refresh]')&&!node.disabled&&node.getClientRects().length>0;});
  const proofReads=f.calls.slice(start).filter(call=>call.path==='/api/admin/content'&&call.method==='GET');
  assert.ok(proofReads.length>=2,'both the save follow-up and explicit ordering proof reads are exercised');
  assert.equal(proofReads.every(call=>call.status===503),true,'all proof reads stay unavailable until the fixture is explicitly restored');
  assert.equal(saves(f).length,before+1,'proof read failure never resends the proven save');
  assert.equal(f.dialogs.filter(row=>row.type==='confirm').length,confirmations,'the proven ordinary save adds no confirmation');
  assert.equal(await f.page.locator('[data-admin-preview-panel]').isVisible(),false,'unverified preview stays hidden');
  assert.equal(await f.page.locator('[data-admin-public-preview]').evaluate(node=>node.childElementCount),0,'stale preview content is cleared');
  assert.match(await f.page.locator('[data-admin-status]').innerText(),/顺序已保存，预览待核对/u);
  assert.equal(await f.page.locator('[data-admin-savebar]').getAttribute('data-save-state'),'saved','the successful PUT stays proven despite unavailable preview evidence');
  assert.equal(await f.page.locator('[data-admin-publish]').evaluateAll(nodes=>nodes.every(node=>node.disabled)),true,'missing publication proof prevents publishing');
  const focus=await f.page.locator('[data-admin-attendance-refresh]').evaluate(node=>{const box=node.getBoundingClientRect();return{focused:node===document.activeElement,enabled:!node.disabled,top:box.top,bottom:box.bottom,height:innerHeight};});
  assert.ok(focus.focused&&focus.enabled&&focus.top>=-1&&focus.bottom<=focus.height+1,'focus falls back to the visible enabled proof-checking entry');
  f.restoreProofReads();await f.page.locator('[data-admin-attendance-refresh]').click();
  await f.page.locator('[data-content-panel=publish] [data-admin-publish]:enabled').first().waitFor();await f.page.locator('[data-admin-logout]:enabled').waitFor();
  assert.equal(saves(f).length,before+1,'manual proof recovery is read-only');assert.equal(publications(f).length,0);
}
function assertOnlyOrder(initial,current,kind){
  for(const key of Object.keys(initial))if(key!==kind)assert.deepEqual(current[key],initial[key],'sorting preserves unrelated '+key);
  assert.deepEqual([...ids(current[kind])].sort(),[...ids(initial[kind])].sort(),'stable IDs are neither replaced nor dropped');
  for(const record of initial[kind])assert.deepEqual(current[kind].find(row=>row.id===record.id),record,'all public and private fields stay attached to '+record.id);
  assert.equal(current[kind].findIndex(row=>row.visibility==='private'),initial[kind].findIndex(row=>row.visibility==='private'),'filtered-out private record keeps its original array index');
}
async function assertPublicUnchanged(f,baseline){assert.deepEqual(await f.anonymous(),baseline,'saved order does not change the frozen public source before publication');}
async function assertPrivate(f){const source=await f.anonymous();assert.doesNotMatch(JSON.stringify(source),new RegExp(PRIVATE+'|synthetic[.]order[.]|internalNotes|contactName|materialLinks|wechat|memberCount'));assert.equal(f.runtime.messages.length,0);}
async function scopeIds(f,kind,scope){return f.page.locator('[data-content-order-kind="'+kind+'"][data-content-order-direction=up][data-content-order-scope="'+scope+'"]').evaluateAll(nodes=>nodes.map(node=>node.dataset.contentOrderId));}
async function publish(f){const before=publications(f).length;f.allowPublish();await f.page.locator('[data-content-panel=publish] [data-admin-publish]').first().click();await f.page.locator('[data-admin-logout]:enabled').waitFor();assert.equal(publications(f).length,before+1);const dialog=f.dialogs.filter(row=>row.type==='confirm').at(-1);assert.ok(dialog?.accepted);assert.match(dialog.message,/顺序调整/u,'publication previews order changes explicitly');}
async function draftRows(page){return page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('artdico-browser-drafts-v1',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{return await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}finally{db.close();}});}
async function pendingBody(f){const row=(await draftRows(f.page)).find(item=>item.scope.page==='content');assert.equal(row?.kind,'pending_submission');return row.value.pendingSave;}
async function allOrderingLocked(f){assert.ok(await orderSet(f.page).count()>0);assert.equal(await orderSet(f.page).evaluateAll(nodes=>nodes.every(node=>node.disabled)),true,'unresolved save prevents further sorting');}
async function noPublication(f){assert.equal(publications(f).length,0);assert.equal(f.runtime.messages.length,0);}

const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const errors=[],reports=[],bindings=[];await mkdir(evidence,{recursive:true});
try{
  const sourceCommit=process.env.ARTDICO_SOURCE_COMMIT||(await promisify(execFile)('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8',maxBuffer:4096})).stdout.trim();
  assert.match(sourceCommit,/^[a-f0-9]{40}$/u,'sourceCommit is an exact full commit');
  const scriptSHA256=digest(await readFile(fileURLToPath(import.meta.url))),publicIndexHTMLSHA256=digest(await readFile(resolve(dist,'index.html'))),adminHTMLBindings={};
  for(const key of [...KINDS,'publish']){const requestedPath=routeFor(key),canonicalPath=aliases.get(requestedPath)||requestedPath;const file=resolve(dist,'.'+(canonicalPath.endsWith('/')?canonicalPath+'index.html':canonicalPath));assert.ok(file.startsWith(dist+'/'));adminHTMLBindings[key]={requestedPath,canonicalPath,sha256:digest(await readFile(file))};}
  for(const[kind,width]of [['guests',320],['showcases',390],['organizations',1440]]){
    const f=await fixture(browser,errors,{width});try{
      const baseline=await f.anonymous(),original=orderedIds(kind);assert.deepEqual(ids(baseline.content[kind]),original);
      await open(f,kind);await f.page.locator({guests:'[data-admin-guest-publication-filter]',showcases:'[data-showcase-publication-filter]',organizations:'[data-organization-publication-filter]'}[kind]).selectOption('public');
      await edges(f,kind,'editor',original);
      await move(f,kind,original[1],'down','editor');const moved=[original[0],original[2],original[1]];
      assert.deepEqual(publicIds((await f.runtime.app.store.read()).draft.content,kind),moved);assertOnlyOrder(f.initial,(await f.runtime.app.store.read()).draft.content,kind);await assertPublicUnchanged(f,baseline);
      await open(f,'publish');await preview(f);
      assert.deepEqual(await scopeIds(f,kind,'preview'),moved,'preview uses the saved source order');await edges(f,kind,'preview',moved);
      if(kind==='guests')await moveWithUnavailablePreview(f,kind,original[1],'up');else await move(f,kind,original[1],'up','preview');
      await preview(f);assert.deepEqual(await scopeIds(f,kind,'preview'),original);
      await move(f,kind,original[0],'down','publish');const final=[original[1],original[0],original[2]];
      await edges(f,kind,'publish',final);await preview(f);assert.deepEqual(await scopeIds(f,kind,'preview'),final);await assertPublicUnchanged(f,baseline);
      assertOnlyOrder(f.initial,(await f.runtime.app.store.read()).draft.content,kind);
      f.confirmOnce(false);await f.page.locator('[data-content-panel=publish] [data-admin-publish]').first().click();assert.equal(publications(f).length,0);assert.match(f.dialogs.filter(row=>row.type==='confirm').at(-1).message,/顺序调整/u);await assertPublicUnchanged(f,baseline);
      await publish(f);const after=await f.anonymous();assert.deepEqual(ids(after.content[kind]),final,'published source follows the approved saved array');for(const other of KINDS)if(other!==kind)assert.deepEqual(after.content[other],baseline.content[other]);
      await assertPrivate(f);assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
      await f.page.screenshot({path:resolve(evidence,kind+'-'+width+'.png'),fullPage:true});
      reports.push({kind,width,editorSavedWithoutConfirm:true,filteredPrivateIndexPreserved:true,previewAndPublicationOrder:true,focusAndPositionPreserved:true,...(kind==='guests'?{allPostSaveProofReads503KeepsSaved:true,missingPreviewFocusesVerificationEntry:true,manualProofRecoveryReadOnly:true}:{}),cancelledPublishUnchanged:true,explicitOrderPreview:true,stableIdsAndPrivateFields:true});
      bindings.push({case:kind,assets:Object.fromEntries(f.assets)});
    }finally{await f.close();}
  }
  for(const fault of ['unknown-uncommitted','unknown-committed']){
    const f=await fixture(browser,errors,{fault});try{
      await open(f,'guests');const sequence=orderedIds('guests');await f.page.locator('[data-admin-guest-publication-filter]').selectOption('public');
      await order(f.page,'guests',sequence[1],'up','editor').click();await waitState(f,'unknown');const original=saves(f)[0];assert.ok(original.rawBody);assert.deepEqual(await pendingBody(f),JSON.parse(original.rawBody));await allOrderingLocked(f);
      await f.page.waitForFunction(()=>{const node=document.activeElement;return node?.matches('[data-admin-check-save]')&&!node.disabled&&node.getClientRects().length>0;});
      if(fault==='unknown-uncommitted'){
        await f.page.reload({waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await f.page.locator('[data-admin-local-restore]:visible').click();await f.page.locator('[data-admin-check-save]:visible').last().waitFor();
        assert.equal(saves(f).length,1,'refresh and local recovery do not repeat a save');assert.deepEqual(await pendingBody(f),JSON.parse(original.rawBody));await allOrderingLocked(f);
      }
      await f.page.locator('[data-admin-check-save]:visible').last().click();
      if(fault==='unknown-uncommitted'){await f.page.locator('[data-admin-retry-save]:visible').last().click();await waitState(f,'saved');assert.equal(saves(f).length,2);assert.equal(saves(f)[1].rawBody,original.rawBody,'explicit retry uses byte-identical original full JSON');}
      else{await waitState(f,'saved');assert.equal(saves(f).length,1,'committed unknown is proved by readback without another PUT');}
      const current=(await f.runtime.app.store.read()).draft.content;assertOnlyOrder(f.initial,current,'guests');assert.deepEqual(publicIds(current,'guests'),[sequence[1],sequence[0],sequence[2]]);await noPublication(f);await assertPrivate(f);
      reports.push({fault,fullRawBodyPreserved:true,unknownBlocksFurtherOrdering:true,exactRetryOrReadOnlyProof:true});bindings.push({case:fault,assets:Object.fromEntries(f.assets)});
    }finally{await f.close();}
  }
  {
    const f=await fixture(browser,errors);try{
      await open(f,'guests');await f.page.locator('[data-admin-guest-publication-filter]').selectOption('public');
      const concurrent=clone(f.initial);concurrent.event.title='合成另一位同事已保存';await f.runtime.app.store.save(1,concurrent,f.runtime.users[0].id);syntheticWrites.contentSaves++;
      await order(f.page,'guests',orderedIds('guests')[1],'up','editor').click();await waitState(f,'conflict');assert.equal(saves(f).length,1);assert.equal(saves(f)[0].status,409);await allOrderingLocked(f);
      await orderSet(f.page).first().evaluate(button=>button.click());assert.equal(saves(f).length,1);assert.deepEqual((await f.runtime.app.store.read()).draft.content,concurrent,'CAS conflict never overwrites another writer');await noPublication(f);
      reports.push({conflict409:true,orderingLockedUntilReviewed:true,concurrentContentPreserved:true});bindings.push({case:'conflict',assets:Object.fromEntries(f.assets)});
    }finally{await f.close();}
  }
  {
    const f=await fixture(browser,errors,{username:'editor'});try{
      const baseline=await f.anonymous();await open(f,'guests');await f.page.locator('[data-admin-guest-publication-filter]').selectOption('public');await move(f,'guests',orderedIds('guests')[1],'up','editor');
      await open(f,'publish');await preview(f);assert.equal(await order(f.page,'guests',orderedIds('guests')[0],'up','preview').isEnabled(),true);assert.equal(await f.page.locator('[data-admin-publish]').evaluateAll(nodes=>nodes.every(node=>node.disabled)),true,'editor-only cannot publish');
      const state=await f.runtime.app.store.read(),denied=await f.runtime.app.handle(f.runtime.request('/api/admin/content/publish',{method:'POST',headers:f.auth,body:{expectedRevision:state.draft.revision,expectedContactsRevision:0}}));assert.equal(denied.status,403,'server enforces publisher permission');
      await assertPublicUnchanged(f,baseline);await noPublication(f);reports.push({editorOnlyCanSort:true,editorOnlyCannotPublish:true});bindings.push({case:'editor-only',assets:Object.fromEntries(f.assets)});
    }finally{await f.close();}
  }
  {
    const f=await fixture(browser,errors,{username:'synthetic-order-publisher'});try{
      const candidate=clone(f.initial);for(const kind of KINDS){const rows=candidate[kind];[rows[0],rows[2]]=[rows[2],rows[0]];}await f.runtime.app.store.save(1,candidate,f.runtime.users[0].id);syntheticWrites.contentSaves++;
      await open(f,'publish');await preview(f);await allOrderingLocked(f);
      const denied=await f.runtime.app.handle(f.runtime.request('/api/admin/content',{method:'PUT',headers:f.auth,body:{expectedRevision:2,content:f.initial}}));assert.equal(denied.status,403,'server enforces editor permission');
      assert.equal(saves(f).length,0);await publish(f);const current=await f.anonymous();for(const kind of KINDS)assert.deepEqual(ids(current.content[kind]),publicIds(candidate,kind));await assertPrivate(f);
      reports.push({publisherOnlyCannotSort:true,publisherOnlyCanApproveSavedOrder:true});bindings.push({case:'publisher-only',assets:Object.fromEntries(f.assets)});
    }finally{await f.close();}
  }
  assert.equal(reports.length,EXPECTED_CASE_COUNT,'all eight acceptance groups completed');assert.equal(bindings.length,EXPECTED_CASE_COUNT);assert.deepEqual(errors,[]);
  for(const binding of Object.values(adminHTMLBindings)){const actual=bindings.filter(group=>Object.hasOwn(group.assets,binding.requestedPath));assert.ok(actual.length>0,'each bound admin HTML was actually loaded');for(const group of actual)assert.equal(group.assets[binding.requestedPath],binding.sha256);}
  const syntheticRuntimeWrites={...syntheticWrites,total:Object.values(syntheticWrites).reduce((sum,count)=>sum+count,0)};
  const proof={expectedCaseCount:EXPECTED_CASE_COUNT,caseCount:reports.length,sourceCommit,scriptSHA256,publicIndexHTMLSHA256,adminHTMLBindings,pageErrors:errors,realMail:0,uninterceptedNetwork:0,realBusinessWrites:0,syntheticRuntimeWrites,passed:reports};
  await writeFile(resolve(evidence,'result.json'),JSON.stringify({...proof,bindings},null,2)+'\n');console.log('ARTDICO_ADMIN_DISPLAY_ORDER_OK '+JSON.stringify(proof));
}finally{await browser.close();}
