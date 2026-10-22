// Native source regression. All page/module requests are fulfilled from this tree;
// admission writes use an isolated synthetic fixture and never reach a service.
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE||'playwright-core');
const project=resolve(fileURLToPath(new URL('../../',import.meta.url))),origin='http://127.0.0.1:8899';
const evidence=resolve(project,'.local-data/browser-evidence/admissions-save-state');await mkdir(evidence,{recursive:true});
const component=await readFile(resolve(project,'src/components/StaffAdmissions.astro'),'utf8');
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
await context.route('**/*',async route=>{
  const url=new URL(route.request().url());assert.equal(url.origin,origin,'no external request is permitted');
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><link rel="stylesheet" href="/src/styles/admin.css"></head><body>'+component+'<script type="module">import {createStaffAdmissions} from "/src/scripts/staff-admissions.mjs";window.makeAdmissions=createStaffAdmissions;</script></body></html>'});
  const path=resolve(project,'.'+url.pathname);assert.ok(path.startsWith(project+'/'));
  let source=await readFile(path,'utf8');if(extname(path)==='.mjs')source=source.replace(/^import\s+['"][^'"\n]+\.css['"];?\s*$/gmu,'');
  return route.fulfill({contentType:extname(path)==='.css'?'text/css':'text/javascript',body:source});
});
try{
  await page.goto(origin+'/');await page.waitForFunction(()=>Boolean(window.makeAdmissions));
  const install=async seed=>{
    const ids=['a','b','c','d'].map(letter=>letter.repeat(43)),teamId='t_'+'x'.repeat(22),state=seed?.state??{revision:0,settings:{capacity:4,staffReserve:0,waitlistEnabled:true},people:ids.slice(0,3).map((registrationId,index)=>({registrationId,kind:index===1?'crew':'attendee',status:index===2?'waitlisted':'confirmed',queueNumber:index+1,teamId:''})),teams:[],auditCount:0};
    window.synthetic={state,ids,teamId,calls:seed?.calls??[],saved:new Map(seed?.saved??[]),loseStaffAck:seed?.loseStaffAck??true};
    const snapshot=()=>{const confirmed=state.people.filter(person=>person.status==='confirmed'),crew=confirmed.filter(person=>person.kind==='crew').length,remainingTotal=state.settings.capacity-confirmed.length;return {...structuredClone(state),summary:{...state.settings,confirmedCount:confirmed.length,crewConfirmedCount:crew,attendeeConfirmedCount:confirmed.length-crew,waitlistCount:state.people.filter(person=>person.status==='waitlisted').length,pendingReviewCount:0,rejectedCount:0,remainingTotal,remainingPublic:Math.max(0,remainingTotal-Math.max(0,state.settings.staffReserve-crew))}};};
    const request=async(path,options={})=>{
      if(path==='/api/admin/admissions')return snapshot();
      const body=JSON.parse(options.body),suffix=path.slice('/api/admin/admissions/'.length);window.synthetic.calls.push({path,method:options.method,body:options.body});
      await new Promise(resolve=>setTimeout(resolve,30));
      const previous=window.synthetic.saved.get(body.operationId);if(previous)return {...structuredClone(previous),outcome:'replayed'};
      if(body.expectedRevision!==state.revision){const error=new Error('synthetic revision conflict');error.status=409;throw error;}
      const action=({settings:'settings',teams:'team_save',staff:'staff_intake'})[suffix];if(!action)throw new Error('unexpected synthetic mutation');
      const operation={operationId:body.operationId,action,registrationId:null,revision:state.revision+1};let extra={};
      if(action==='settings'){Object.assign(state.settings,body.settings);operation.settings=body.settings;}
      if(action==='team_save'){const id=body.team.id||teamId;state.teams=[{id,name:body.team.name,memberIds:[...body.team.memberIds]}];for(const person of state.people)person.teamId=body.team.memberIds.includes(person.registrationId)?id:'';operation.teamId=id;extra.teamId=id;}
      if(action==='staff_intake'){const id=ids[3];state.people.push({registrationId:id,kind:body.input.kind,status:'confirmed',queueNumber:4,teamId:''});operation.registrationId=id;operation.kind=body.input.kind;extra={registrationId:id,receipt:{committed:true,registrationId:id}};}
      state.revision++;state.auditCount++;
      const result={...snapshot(),outcome:'updated',promotedIds:[],releasedIds:[],operation,...extra};window.synthetic.saved.set(body.operationId,structuredClone(result));
      if(action==='staff_intake'&&window.synthetic.loseStaffAck){window.synthetic.loseStaffAck=false;const error=new Error('synthetic lost acknowledgement');error.status=503;throw error;}
      return result;
    };
    window.controller=window.makeAdmissions({root:document.querySelector('[data-staff-admissions]'),request,openRecord(){}});
    await window.controller.configure({id:'synthetic-admin',roles:['superadmin']});
  };await page.evaluate(install,null);
  const root=page.locator('[data-staff-admissions]'),settings=root.locator('[data-admissions-settings]'),team=root.locator('[data-admissions-team]'),staff=root.locator('[data-admissions-staff]');
  await page.waitForFunction(()=>!document.querySelector('[data-admissions-settings] [name=staffReserve]').disabled);
  await team.locator('..').locator('summary').click();await staff.locator('..').locator('summary').click();
  for(const[name,value]of Object.entries({name:'合成待保存工作人员',email:'staff@example.invalid',permissionReference:'synthetic-permission'}))await staff.locator('[name='+name+']').fill(value);
  await staff.locator('[name=confirmed]').check();
  await team.locator('[name=name]').fill('合成待保存团队');await team.locator('[name=memberIds]').selectOption(['a'.repeat(43),'b'.repeat(43)]);
  await settings.locator('[name=staffReserve]').fill('1');await settings.locator('button[type=submit]').click();
  await settings.locator('[data-save-state=saved]').waitFor();
  assert.equal(await team.locator('[name=name]').inputValue(),'合成待保存团队');assert.equal(await staff.locator('[name=name]').inputValue(),'合成待保存工作人员');
  assert.equal(await team.locator('[data-admissions-save-state]').getAttribute('data-save-state'),'dirty');assert.equal(await staff.locator('[data-admissions-save-state]').getAttribute('data-save-state'),'dirty');
  await team.locator('button[type=submit]').click();await team.locator('[data-save-state=saved]').waitFor();
  assert.equal(await team.locator('[name=id]').inputValue(),'t_'+'x'.repeat(22));assert.equal(await team.locator('[name=name]').inputValue(),'合成待保存团队');
  assert.equal(await team.locator('button[type=submit]').isDisabled(),true);assert.equal(await staff.locator('[name=name]').inputValue(),'合成待保存工作人员');
  await page.evaluate(()=>{window.synthetic.state.teams[0].name='另一页保存的团队名';window.synthetic.state.revision++;});
  await root.locator('[data-admissions-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-admissions-team] [name=name]').value==='另一页保存的团队名');
  assert.equal(await team.locator('[name=name]').inputValue(),'另一页保存的团队名','clean existing team reloads current server values before a later edit');
  await team.locator('[name=name]').fill('我的未保存团队名');
  await page.evaluate(()=>{window.synthetic.state.teams[0].name='另一页再次修改团队';window.synthetic.state.revision++;});
  await root.locator('[data-admissions-refresh]').click();await team.locator('[data-save-state=conflict]').waitFor();
  assert.equal(await team.locator('[name=name]').inputValue(),'我的未保存团队名');assert.equal(await team.locator('button[type=submit]').isDisabled(),true);
  await team.locator('[data-admissions-reconcile]').click();await team.locator('button[type=submit]').click();await team.locator('[data-save-state=saved]').waitFor();
  await settings.locator('[name=staffReserve]').fill('0');
  await page.evaluate(()=>{window.synthetic.state.settings.staffReserve=2;window.synthetic.state.revision++;});
  await root.locator('[data-admissions-refresh]').click();await settings.locator('[data-save-state=conflict]').waitFor();
  assert.equal(await settings.locator('[name=staffReserve]').inputValue(),'0');assert.equal(await settings.locator('button[type=submit]').isDisabled(),true);
  await settings.locator('[data-admissions-reconcile]').click();await settings.locator('button[type=submit]').click();await settings.locator('[data-save-state=saved]').waitFor();
  assert.equal(await page.evaluate(()=>window.synthetic.state.settings.staffReserve),0);
  await staff.locator('button[type=submit]').click();await staff.locator('[data-save-state=unknown]').waitFor();
  assert.equal(await staff.locator('[name=name]').inputValue(),'合成待保存工作人员');assert.equal(await staff.locator('[name=name]').isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.synthetic.calls.filter(call=>call.path.endsWith('/staff')).length),1);
  const differentDraft=process.env.ARTDICO_ADMISSIONS_DIFFERENT_DRAFT==='1';
  if(differentDraft)await page.evaluate(async()=>{const {operationsDraftStore,operationsDraftPolicy,operationsDraftPage}=await import('/src/lib/operations-form-draft.mjs');const scope={actorId:'synthetic-admin',eventId:'ggj-cn-2026',page:operationsDraftPage('review',['superadmin']),entityId:'admission-form:staff'},store=operationsDraftStore(),policy=operationsDraftPolicy(),observed=await store.read(scope,policy);const fields={...observed.record.value.fields,name:'合成另一位尚未保存'};await store.write(scope,{expectedRevision:observed.revision,actorEpoch:observed.actorEpoch,kind:'editing',baseRevision:observed.record.baseRevision,value:{fields}},policy);});
  const persisted=await page.evaluate(()=>({state:window.synthetic.state,calls:window.synthetic.calls,saved:[...window.synthetic.saved],loseStaffAck:window.synthetic.loseStaffAck}));
  await page.reload();await page.waitForFunction(()=>Boolean(window.makeAdmissions));await page.evaluate(install,persisted);await staff.locator('..').evaluate(node=>node.open=true);
  await root.locator('[data-operations-local-draft="admission-pending"]').getByRole('button',{name:'恢复待核对操作',exact:true}).click();
  await root.locator('[data-admissions-retry]').click();
  if(differentDraft){await staff.locator('[data-save-state=conflict]').waitFor();assert.equal(await staff.locator('button[type=submit]').isDisabled(),true);await staff.locator('[data-admissions-reconcile=staff]').click();await page.waitForFunction(()=>document.querySelector('[data-admissions-staff] [name=name]').value==='合成另一位尚未保存');assert.equal(await staff.locator('[name=confirmed]').isChecked(),false);assert.equal(await staff.locator('[data-admissions-save-state]').getAttribute('data-save-state'),'dirty');assert.equal(await page.evaluate(()=>window.synthetic.calls.filter(call=>call.path.endsWith('/staff')).length),2);assert.equal(await page.evaluate(()=>window.synthetic.state.people.length),4);assert.deepEqual(errors,[]);console.log(JSON.stringify({recoveredStaffOriginalProved:true,differentUnsavedPersonRetained:true,explicitNextPersonReviewRequired:true,noAutomaticCreate:true,pageErrors:errors},null,2));}
  else {await staff.locator('[data-save-state=saved]').waitFor();
  assert.equal(await staff.locator('[name=name]').inputValue(),'合成待保存工作人员');assert.equal(await staff.locator('[name=name]').isDisabled(),true);
  assert.equal(await staff.locator('button[type=submit]').isDisabled(),true);
  const attempts=await page.evaluate(()=>window.synthetic.calls.filter(call=>call.path.endsWith('/staff')));assert.equal(attempts.length,2);assert.equal(attempts[0].body,attempts[1].body);
  assert.equal(await page.evaluate(()=>window.synthetic.state.people.length),4);
  await staff.locator('[data-admissions-staff-next]').click();assert.equal(await staff.locator('[name=name]').inputValue(),'');assert.equal(await staff.locator('[name=name]').isEnabled(),true);
  assert.equal(await staff.locator('[data-admissions-save-state]').getAttribute('data-save-state'),'idle');
  }
  await root.screenshot({path:resolve(evidence,differentDraft?'admissions-recovered-different.png':'admissions-save-states.png')});
  assert.deepEqual(errors,[]);if(!differentDraft)console.log(JSON.stringify({unrelatedDirtyFormsRetained:true,teamAckFieldsRetained:true,sameScopeConflictRequiresReview:true,cleanTeamRefreshUsesLatestValues:true,dirtyTeamRefreshRetainsInput:true,unknownStaffRetryExactBody:true,recoveredPageStaffAckLocksSavedPerson:true,staffSavedLockedUntilExplicitNext:true,pageErrors:errors},null,2));
}finally{await context.close();await browser.close();}
