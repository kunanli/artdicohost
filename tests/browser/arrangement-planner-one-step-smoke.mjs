// Native source component with synthetic state and intercepted module I/O only.
// No build, cloud service, real contact, publication, or email is used.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const origin='https://planner.synthetic.invalid';
const markup=await readFile(resolve(root,'src/components/ArrangementPlanner.astro'),'utf8');
const bootstrap=`
import {createArrangementPlanner} from '/src/scripts/arrangement-planner.mjs';
import {prepareBoothDraft} from '/src/lib/arrangement-planner.mjs';
import {createInitialContent} from '/src/config/content.mjs';
import {createEmptyContactOperations} from '/shared/contacts-schema.mjs';
import {readContentForm} from '/src/lib/content-local-drafts.mjs';
const initial=createInitialContent();
initial.booths=[{id:'booth-existing',code:'C-01',organization:'合成组织',project:'合成原作品',zone:'C',status:'pending',internalNotes:'SYNTHETIC_PRIVATE_NOTE',slotNumber:1,contactName:'合成负责人',contactMethods:'synthetic@example.invalid',description:'合成展示内容'}];
const person={id:'synthetic-contact',profile:{name:'合成人员',displayName:'合成人员',organization:'合成组织',contactConsent:'consented'},operations:createEmptyContactOperations()};
window.state={content:initial,revision:3,dirty:false,busy:false,allowed:true,active:true,actorId:'synthetic-editor'};
window.calls=[];window.reads=[];window.assignmentWrites=[];window.mode='reject';window.hold=false;window.release=null;window.sequence=0;window.epoch=0;window.completed=null;
window.planner=createArrangementPlanner({root:document.querySelector('[data-arrangement-planner]'),getContext:()=>window.state,
  onBusy:value=>window.workBusy=value,onDraftChange:()=>{},refreshArrangements:async()=>{},
  request:async(path,options={})=>{
    if(options.method){window.assignmentWrites.push({path,method:options.method,body:JSON.parse(options.body)});throw new Error('合成人员保存回执丢失');}
    window.reads.push(path);
    if(path==='/api/admin/contacts')return {revision:7,contacts:[structuredClone(person)]};
    if(path==='/api/admin/planning')return {features:{intentInvitations:false}};
    if(path==='/api/admin/content')return {draft:{revision:window.state.revision,content:structuredClone(window.state.content)}};
    throw new Error('Unexpected synthetic request '+path);
  },
  applyBooth:async input=>{
    const epoch=window.epoch,actor=window.state.actorId,captured=window.planner.localDraft();
    const raw=readContentForm(document.querySelector('[data-planner-booth]'),'plannerBooth');
    const candidate=prepareBoothDraft(window.state.content,{...input,newId:'booth-new-'+(++window.sequence)});
    window.calls.push({input:structuredClone(input),raw,formDataKeys:[...new FormData(document.querySelector('[data-planner-booth]')).keys()],boothId:candidate.boothId});
    // Match the host: a validated candidate is staged before the pending PUT,
    // and an unsuccessful save can leave this exact stable ID in local content.
    window.state.content=structuredClone(candidate.content);
    const mode=window.mode;
    if(window.hold)await new Promise(resolve=>window.release=resolve);
    if(epoch!==window.epoch||actor!==window.state.actorId)return {...candidate,saved:true};
    if(mode==='throw')throw new Error('合成网络错误');
    if(mode!=='ack')return {...candidate,saved:false,error:'合成保存未确认'};
    window.state.revision++;
    window.planner.acknowledgeSaved(captured);
    return {...candidate,saved:true};
  }
});
window.begin=options=>{window.completed=null;window.task=window.planner.saveBooth(options).then(value=>window.completed=value);};
window.teardown=()=>{window.epoch++;window.planner.clear();};
window.ready=true;`;

const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext(),page=await context.newPage(),errors=[],reports=[];
page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'all I/O stays inside the intercepted synthetic origin');
  if(url.pathname==='/')return route.fulfill({contentType:'text/html; charset=utf-8',body:'<meta charset="utf-8">'+markup+'<script type="module">'+bootstrap+'</script>'});
  if(!/^\/(?:src|shared)\/.+\.mjs$/u.test(url.pathname))return route.fulfill({status:404,body:''});
  const file=resolve(root,'.'+url.pathname);assert.ok(file.startsWith(root+'/'));
  try{return route.fulfill({contentType:'text/javascript',body:await readFile(file,'utf8')});}catch{return route.fulfill({status:404,body:''});}
});
const form=page.locator('[data-planner-booth]'),project=form.locator('[name=project]');
async function fresh(){await page.goto(origin);await page.waitForFunction(()=>window.ready);}
async function open({id='booth-existing',slot=1,load=false}={}){await page.evaluate(({id,slot,load})=>window.planner.open('booth',id,slot,{load}),{id,slot,load});}
async function save(){await page.evaluate(()=>window.begin());await page.waitForFunction(()=>window.completed!==null);return page.evaluate(()=>window.completed);}
async function held(){await page.evaluate(()=>{window.mode='ack';window.hold=true;window.begin();});await page.waitForFunction(()=>typeof window.release==='function');}
async function release(){await page.evaluate(()=>{window.hold=false;window.release();window.release=null;});await page.waitForFunction(()=>window.completed!==null);}
try{
  await fresh();await open();await project.fill('合成待回执作品');await held();
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),true);
  assert.equal(await project.inputValue(),'合成待回执作品');assert.equal(await project.isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.completed),null);
  assert.equal(await page.evaluate(()=>window.calls[0].raw.project),'合成待回执作品');
  assert.deepEqual(await page.evaluate(()=>window.calls[0].formDataKeys),[],'disabled real DOM fields are captured by readContentForm, not FormData');
  await release();assert.equal(await page.evaluate(()=>window.completed),true);
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),false);assert.equal(await page.evaluate(()=>window.planner.hasLocalChanges()),false);
  assert.equal(await page.locator('[data-arrangement-planner]').isVisible(),true);
  assert.equal(await project.inputValue(),'合成待回执作品');assert.equal(await project.isDisabled(),false);
  assert.match(await page.locator('[data-planner-result]').textContent(),/已保存到云端/u);
  reports.push('held ACK retains raw fields; exact ACK alone clears booth unapplied state');

  await fresh();await open({id:null,slot:2});await project.fill('合成新增未确认作品');
  assert.equal(await save(),false);const stagedId=await page.evaluate(()=>window.calls[0].boothId);
  assert.equal(await page.evaluate(()=>window.planner.localDraft().selected.id),stagedId);
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),true);assert.equal(await project.inputValue(),'合成新增未确认作品');
  await page.evaluate(()=>window.mode='ack');assert.equal(await save(),true);
  assert.deepEqual(await page.evaluate(()=>window.calls.map(call=>call.boothId)),[stagedId,stagedId]);
  assert.equal(await page.evaluate(()=>window.state.content.booths.length),2);
  assert.equal(await page.evaluate(id=>window.state.content.booths.filter(booth=>booth.id===id).length,stagedId),1);
  reports.push('failed staged new booth retries by the same stable ID without duplicates');

  await fresh();await open({load:true});await page.locator('[data-planner-assignment] [name=contactId]').selectOption('synthetic-contact');
  const assignment=await page.evaluate(()=>window.planner.localDraft().assignment);
  await project.fill('合成展位与人员分离');await page.evaluate(()=>window.mode='ack');assert.equal(await save(),true);
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),false);assert.equal(await page.evaluate(()=>window.planner.hasLocalChanges()),true);
  assert.deepEqual(await page.evaluate(()=>window.planner.localDraft().assignment),assignment);
  assert.equal(await page.evaluate(()=>window.planner.localDraft().uncertain),false);
  assert.deepEqual(await page.evaluate(()=>window.assignmentWrites),[]);
  reports.push('booth ACK preserves separately dirty person assignments without writing them');

  await fresh();await open({load:true});await page.locator('[data-planner-assignment] [name=contactId]').selectOption('synthetic-contact');
  await page.locator('[data-planner-save]').click();await page.waitForFunction(()=>window.assignmentWrites.length===1&&window.workBusy===false);
  assert.equal(await page.evaluate(()=>window.planner.localDraft().uncertain),true);
  const uncertainAssignment=await page.evaluate(()=>window.planner.localDraft().assignment);
  await project.fill('合成人员未知仍可独立保存展位');await page.evaluate(()=>window.mode='ack');assert.equal(await save(),true);
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),false);assert.equal(await page.evaluate(()=>window.planner.localDraft().uncertain),true);
  assert.deepEqual(await page.evaluate(()=>window.planner.localDraft().assignment),uncertainAssignment);
  assert.equal(await page.locator('[data-planner-save]').isDisabled(),true);assert.equal(await page.evaluate(()=>window.assignmentWrites.length),1);
  reports.push('booth ACK cannot resolve or resend uncertain person journal writes');

  await fresh();await page.evaluate(()=>window.state.active=false);await open({load:true});
  assert.equal(await page.locator('[data-arrangement-planner]').isHidden(),true);assert.deepEqual(await page.evaluate(()=>window.reads),[]);
  await page.evaluate(()=>window.state.active=true);await open();await page.evaluate(()=>{window.state.active=false;window.planner.configure();document.querySelector('[data-planner-refresh]').click();});
  assert.deepEqual(await page.evaluate(()=>window.reads),[]);assert.equal(await project.isDisabled(),true);assert.equal(await save(),false);
  reports.push('inactive page never fetches private people or starts a booth save');

  await fresh();await open();await project.fill('SYNTHETIC_CLEAR_LATE');await held();
  await page.evaluate(()=>window.teardown());await release();
  assert.equal(await page.evaluate(()=>window.completed),false);assert.equal(await page.locator('[data-arrangement-planner]').isHidden(),true);
  assert.equal(await project.inputValue(),'');assert.equal(await page.locator('[data-planner-result]').textContent(),'');assert.equal(await page.evaluate(()=>window.planner.hasLocalChanges()),false);
  reports.push('clear invalidates late cloud completion without restoring private raw fields');

  await fresh();await open();await project.fill('SYNTHETIC_ACCOUNT_LATE');await held();
  await page.evaluate(()=>{window.epoch++;window.state.actorId='synthetic-other-editor';window.state.allowed=false;window.planner.configure();});await release();
  assert.equal(await page.evaluate(()=>window.completed),false);assert.equal(await page.locator('[data-arrangement-planner]').isHidden(),true);
  assert.equal(await project.inputValue(),'');assert.equal(await page.locator('[data-planner-result]').textContent(),'');
  reports.push('account permission teardown suppresses a previous actor completion');

  await fresh();await open();await project.fill('合成已提交作品');await held();
  await page.evaluate(()=>{const field=document.querySelector('[data-planner-booth] [name=project]');field.value='合成提交后的新填写';field.dispatchEvent(new Event('input',{bubbles:true}));});
  await release();assert.equal(await page.evaluate(()=>window.completed),true);
  assert.equal(await project.inputValue(),'合成提交后的新填写');assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),true);
  assert.equal(await save(),true);assert.equal(await page.evaluate(()=>window.state.content.booths[0].project),'合成提交后的新填写');
  assert.equal(await page.evaluate(()=>window.planner.hasUnapplied()),false);
  reports.push('own ACK advances the base while retaining newer unmatched raw input');

  await fresh();await open();await project.fill('合成父控制器禁用中的值');
  await page.evaluate(()=>{window.mode='ack';window.state.busy=true;window.planner.configure();window.begin({allowBusy:true});});
  await page.waitForFunction(()=>window.completed!==null);assert.equal(await page.evaluate(()=>window.completed),true);
  assert.equal(await page.evaluate(()=>window.calls[0].input.changes.project),'合成父控制器禁用中的值');
  assert.equal(await page.evaluate(()=>window.calls[0].input.changes.contactName),'合成负责人');
  assert.deepEqual(await page.evaluate(()=>window.calls[0].formDataKeys),[]);
  reports.push('parent busy one-step entry captures disabled fields without FormData loss');

  assert.deepEqual(errors,[]);console.log(JSON.stringify({groups:reports.length,reports,pageErrors:errors,syntheticOnly:true},null,2));
}finally{await context.close();await browser.close();}
