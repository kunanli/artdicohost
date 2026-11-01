// Built P1a admin UI over the real isolated application and memory-only OSS.
// Every browser request is intercepted; no real records, mail or publication.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const project=fileURLToPath(new URL('../../',import.meta.url));
const source=resolve(process.env.ARTDICO_SOURCE_DIRECTORY||project);
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(source,'dist'));
const evidence=resolve(project,'.local-data/browser-evidence/p1a-content');
const {peopleRuntimeFixture,PEOPLE_FIXTURE_API:API,PEOPLE_FIXTURE_PUBLIC:SITE}=await import(pathToFileURL(resolve(source,'tests/helpers/people-runtime-fixture.mjs')));
const {createObjectJournal}=await import(pathToFileURL(resolve(source,'functions/cloud-content/object-journal.mjs')));
const {validateContent}=await import(pathToFileURL(resolve(source,'shared/content-schema.mjs')));
const {CLOUD_ADMIN_PAGE_ALIASES}=await import(pathToFileURL(resolve(source,'functions/cloud-content/http-server.mjs')));
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const aliases=new Map(CLOUD_ADMIN_PAGE_ALIASES),errors=[],reports=[];
const PRIVATE='SYNTHETIC_P1A_PRIVATE_NEVER_PUBLIC';
const IDS={legacy:'synthetic-p1a-team',absent:'synthetic-p1a-absent',sparse:'synthetic-p1a-booth-32'};
const mime=file=>({html:'text/html',mjs:'text/javascript',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',svg:'image/svg+xml',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream';
const booth=(slot,extras={})=>({id:'synthetic-p1a-booth-'+slot,code:'C-'+String(slot).padStart(2,'0'),slotNumber:slot,zone:'C',organization:'合成展示团队 '+slot,project:'合成展示项目 '+slot,status:slot%2?'pending':'confirmed',internalNotes:PRIVATE,contactName:PRIVATE,contactMethods:'synthetic.p1a@example.invalid',...extras});
const work=(id,extras={})=>({id,title:'合成历史作品 '+id,teamName:'合成创作团队',school:'合成学校',contactName:PRIVATE,email:'synthetic.p1a@example.invalid',wechat:PRIVATE,memberCount:3,participationForms:['booth'],responseStatus:'attending',materialLinks:'https://example.invalid/synthetic',summary:'合成作品介绍',coverId:'',status:'pending',publicConsent:false,sessionId:'',boothId:IDS.sparse,internalNotes:PRIVATE,...extras});

async function fixture(browser,width,{empty=false}={}){
  const runtime=await peopleRuntimeFixture({capacity:300,mail:false});
  const content=(await runtime.app.store.read()).draft.content;
  content.booths=empty?[]:[...Array.from({length:15},(_,i)=>booth(i+1)),booth(32),booth(0,{id:'synthetic-p1a-unplaced',code:'C-UNPLACED'}),booth(99,{id:'synthetic-p1a-cancelled',code:'C-CANCELLED',status:'cancelled'})];
  content.showcases=empty?[]:[work(IDS.legacy,{kind:'team'}),work(IDS.absent)];
  const checked=validateContent(content);assert.equal(checked.valid,true,JSON.stringify(checked.errors));
  // Seed history directly: creating new team kinds is deliberately disallowed.
  const journal=createObjectJournal({objects:runtime.objects,prefix:'cms/v1/content'});
  await journal.commit((await journal.read()).cursor,{storageVersion:1,draft:{revision:0,content:checked.value},published:null,audit:[]});
  const admissions=await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]});
  const context=await browser.newContext({viewport:{width,height:940}}),calls=[],dialogs=[];
  const auth=await runtime.login(),[name,...value]=auth.Cookie.split('=');
  await context.addCookies([{domain:new URL(API).hostname,path:'/api/admin',name,value:value.join('='),httpOnly:true,secure:true,sameSite:'Strict'}]);
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    assert.ok([API,SITE].includes(url.origin),'all network requests stay inside the intercepted synthetic origins');
    if(url.pathname.startsWith('/api/')){
      assert.equal(url.origin,API);
      assert.equal(/\/(?:dispatch|send|sent|manual-sent|users|publish)(?:\/|$)/u.test(url.pathname),false,'P1a UI testing never sends, publishes or manages accounts');
      const entry={path:url.pathname,method:request.method()};calls.push(entry);
      const response=await runtime.app.handle(new Request(request.url(),{method:request.method(),headers:await request.allHeaders(),...(['GET','HEAD'].includes(request.method())?{}:{body:request.postData()})}));
      const headers=Object.fromEntries(response.headers);delete headers['content-length'];entry.status=response.status;
      return route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())});
    }
    const path=aliases.get(url.pathname)||url.pathname;
    const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));assert.ok(file.startsWith(dist+'/'));
    try{return route.fulfill({status:200,contentType:mime(file),body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
  });
  const page=await context.newPage();page.setDefaultTimeout(12000);
  await page.clock.setSystemTime(new Date('2026-10-21T09:00:00.000Z'));
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',dialog=>{dialogs.push(dialog.message());void dialog.dismiss();});
  return {runtime,context,page,calls,dialogs,admissions,width};
}
async function open(f,key){await f.page.goto(API+'/admin/content/'+key+'/',{waitUntil:'networkidle'});await f.page.locator('[data-admin-workspace]:visible').waitFor();await f.page.locator('[data-content-panel="'+key+'"]:visible').waitFor();}
async function saved(f,type){await f.page.locator('[data-'+type+'-submit]:enabled').click();await f.page.locator('[data-content-form-save-state="'+type+'"][data-save-state="saved"]').waitFor();assert.equal(await f.page.locator('[data-'+type+'-dialog]').isVisible(),true,'ordinary saving keeps the current editor open');}
async function close(f,type){await f.page.locator('[data-close-dialog="'+type+'"]').first().click();await f.page.locator('[data-'+type+'-dialog]').waitFor({state:'hidden'});}
async function noOverflow(f){assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal viewport overflow at '+f.width+'px');}
async function screenshot(f,name){await noOverflow(f);const path=resolve(evidence,name+'-'+f.width+'.png'),viewport=resolve(evidence,name+'-'+f.width+'-viewport.png');await f.page.screenshot({path,fullPage:true});await f.page.screenshot({path:viewport});return [path,viewport];}
async function head(f){return (await f.runtime.app.store.read()).draft.content;}
async function unchanged(f){assert.deepEqual(await f.runtime.app.registrationService.getAdmissions({actor:f.runtime.users[0]}),f.admissions,'content editing never allocates attendance places');assert.equal(f.runtime.messages.length,0);assert.deepEqual(f.dialogs,[],'ordinary saves and editor closes need no confirmation');}

await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const width of [320,390,1440]){
    const f=await fixture(browser,width);
    try{
      await open(f,'booths');
      assert.equal(await f.page.locator('[data-admin-fill-booths]').count(),0);
      await f.page.locator('[data-admin-add-booth]').click();
      const boothForm=f.page.locator('[data-booth-form]');
      assert.equal(await boothForm.locator('[name=slotNumber]').inputValue(),'16','new booth suggests the first unused position beyond fifteen');
      assert.equal(await boothForm.locator('[name=code]').inputValue(),'C-16');
      await boothForm.locator('[name=organization]').fill('合成新增展示团队');
      await boothForm.locator('[name=project]').fill('合成第十六号新增项目');
      await saved(f,'booth');
      const added=(await head(f)).booths.find(row=>row.slotNumber===16);assert.ok(added);assert.equal(added.code,'C-16');
      await boothForm.locator('[name=project]').fill('合成第十六号更新项目');await saved(f,'booth');
      assert.equal((await head(f)).booths.filter(row=>row.slotNumber===16).length,1,'saving twice retains one stable booth ID');
      assert.equal((await head(f)).booths.find(row=>row.slotNumber===16).id,added.id);
      await close(f,'booth');
      const boothShot=await screenshot(f,'booths');

      await open(f,'showcases');
      const filter=f.page.locator('[data-showcase-kind-filter] option');
      assert.deepEqual(await filter.evaluateAll(options=>options.map(option=>option.value)),['','student','indie']);
      for(const kind of ['student','indie']){
        await f.page.locator('[data-admin-add-showcase]').click();
        const form=f.page.locator('[data-showcase-form]');
        assert.deepEqual(await form.locator('[name=kind] option').evaluateAll(options=>options.filter(option=>option.value&&!option.disabled).map(option=>option.value)),['student','indie']);
        await form.locator('[name=kind]').selectOption(kind);
        await form.locator('[name=title]').fill('合成新增'+kind+'作品');
        await form.locator('[name=teamName]').fill('合成新增创作者');
        await saved(f,'showcase');await close(f,'showcase');
        assert.equal((await head(f)).showcases.filter(row=>row.title==='合成新增'+kind+'作品'&&row.kind===kind).length,1);
      }
      await f.page.locator('[data-showcase-id="'+IDS.legacy+'"] [data-row-action=edit]').click();
      const legacyForm=f.page.locator('[data-showcase-form]');
      assert.equal(await legacyForm.locator('[name=kind]').inputValue(),'team');
      assert.equal(await legacyForm.locator('[name=kind] option[value=team]').isDisabled(),true,'legacy team stays visible but cannot be newly selected');
      await legacyForm.locator('[name=internalNotes]').fill(PRIVATE+' UPDATED');await saved(f,'showcase');
      const kept=(await head(f)).showcases.find(row=>row.id===IDS.legacy);
      assert.equal(kept.kind,'team');assert.equal(kept.boothId,IDS.sparse);assert.equal(kept.email,'synthetic.p1a@example.invalid');assert.equal(kept.internalNotes,PRIVATE+' UPDATED');
      await legacyForm.locator('[name=kind]').selectOption('student');await saved(f,'showcase');
      const reclassified=(await head(f)).showcases.find(row=>row.id===IDS.legacy);
      assert.equal(reclassified.kind,'student');assert.equal(reclassified.boothId,IDS.sparse);assert.equal(reclassified.internalNotes,PRIVATE+' UPDATED');
      assert.equal(Object.hasOwn((await head(f)).showcases.find(row=>row.id===IDS.absent),'kind'),false,'editing other records does not backfill an absent legacy kind');
      await close(f,'showcase');
      const workShot=await screenshot(f,'works');

      await open(f,'arrangements');await f.page.locator('[data-arrangements-body]:visible').waitFor();
      const positions=await f.page.locator('[data-arrangements-slots] > [data-slot-number]').evaluateAll(rows=>rows.map(row=>Number(row.dataset.slotNumber)));
      assert.deepEqual(positions,[...Array.from({length:16},(_,i)=>i+1),32],'overview renders actual rows in order without empty holes');
      assert.equal(await f.page.locator('[data-arrangements-unplaced] > [data-slot-number="0"]').count(),1);
      assert.equal(await f.page.locator('[data-arrangements-cancelled] > [data-slot-number="99"]').count(),1);
      assert.deepEqual(await f.page.locator('[data-arrangements-summary] article strong').allTextContents(),['17','8','9','1']);
      assert.doesNotMatch(await f.page.locator('[data-arrangements-summary]').textContent(),/\/\s*(?:15|200)|总容量|剩余位置/u);
      await f.page.locator('[data-arrangements-slots] [data-slot-number="32"] [data-arrangements-plan="booth"]').click();
      const planner=f.page.locator('[data-planner-booth]');await planner.waitFor({state:'visible'});
      await planner.locator('[name=project]').fill('合成第三十二号编排更新');await f.page.locator('[data-planner-apply]').click();
      await f.page.locator('[data-planner-booth-save-state][data-save-state=saved]').waitFor();
      const sparse=(await head(f)).booths.find(row=>row.id===IDS.sparse);assert.equal(sparse.slotNumber,32);assert.equal(sparse.project,'合成第三十二号编排更新');assert.equal(sparse.internalNotes,PRIVATE);
      await f.page.locator('[data-planner-close]').click();
      const overviewShot=await screenshot(f,'arrangements');
      await unchanged(f);
      assert.equal(f.calls.filter(call=>call.status>=400).length,0,'every actual runtime response succeeds');
      reports.push({width,actualPlacedPositions:positions,newBoothPosition:16,plannerPosition:32,newKinds:['student','indie'],legacyTeam:'retained then reclassified by same ID',requests:f.calls.length,saves:f.calls.filter(call=>call.method==='PUT'&&call.path==='/api/admin/content').length,screenshots:[...boothShot,...workShot,...overviewShot]});
    }finally{await f.context.close();}
  }
  const empty=await fixture(browser,390,{empty:true});
  try{
    await open(empty,'arrangements');await empty.page.locator('[data-arrangements-body]:visible').waitFor();
    assert.equal(await empty.page.locator('[data-arrangements-slots] > [data-slot-number]').count(),0,'empty draft creates no fictitious booths');
    assert.match(await empty.page.locator('[data-arrangements-slots]').textContent(),/暂无已安排展位/u);
    assert.deepEqual(await empty.page.locator('[data-arrangements-summary] article strong').allTextContents(),['0','0','0','0']);
    await open(empty,'booths');await empty.page.locator('[data-admin-add-booth]').click();
    assert.equal(await empty.page.locator('[data-booth-form] [name=slotNumber]').inputValue(),'1');
    await close(empty,'booth');await unchanged(empty);
    reports.push({width:390,emptyDraft:true,actualPlacedPositions:[],newBoothPosition:1});
  }finally{await empty.context.close();}
  assert.deepEqual(errors,[]);
  const built=await readFile(resolve(dist,'admin/index.html'));
  const result={ok:true,dist,adminHtmlSha256:createHash('sha256').update(built).digest('hex'),reports,pageErrors:errors};
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(result,null,2)+'\n');
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
}finally{await browser.close();}
