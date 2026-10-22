// Optional real Chromium regression. Every request is intercepted with synthetic data.
import {fileURLToPath} from 'node:url';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.ARTDICO_PLAYWRIGHT_MODULE || 'playwright-core');
const project=fileURLToPath(new URL('../../',import.meta.url));
const dist=resolve(process.env.ARTDICO_DIST_DIRECTORY||resolve(project,'dist')),evidence=resolve(project,'.local-data/browser-evidence');
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.ARTDICO_CHROMIUM_BINARY || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const ids=['a','b','c','d','e'].map(value=>value.repeat(43)),teamId='t_'+'x'.repeat(22),csrf='s'.repeat(43);
const at='2026-10-20T16:00:00Z';
const errors=[],reports=[];
const json=(body,status=200)=>({status,contentType:'application/json',body:JSON.stringify(body)});
function syntheticState(){
 return {revision:0,settings:{capacity:2,staffReserve:0,waitlistEnabled:true},people:[
  {registrationId:ids[0],kind:'attendee',status:'confirmed',queueNumber:1,changedAt:at,teamId:''},
  {registrationId:ids[1],kind:'crew',status:'confirmed',queueNumber:2,changedAt:at,teamId:''},
  {registrationId:ids[2],kind:'attendee',status:'waitlisted',queueNumber:3,changedAt:at,teamId:''},
  {registrationId:ids[3],kind:'attendee',status:'waitlisted',queueNumber:4,changedAt:at,teamId:''},
 ],teams:[],auditCount:0};
}
function envelope(state,extra={}){
 const confirmed=state.people.filter(person=>person.status==='confirmed'),crew=confirmed.filter(person=>person.kind==='crew').length;
 const remainingTotal=state.settings.capacity-confirmed.length;
 return {...structuredClone(state),summary:{...state.settings,confirmedCount:confirmed.length,attendeeConfirmedCount:confirmed.length-crew,crewConfirmedCount:crew,waitlistCount:state.people.filter(person=>person.status==='waitlisted').length,remainingPublic:Math.max(0,remainingTotal-Math.max(0,state.settings.staffReserve-crew)),remainingTotal},...extra};
}
function registration(id,index){return {id,referenceCode:id,eventId:'synthetic-event',submittedAt:at,fields:{name:'合成人员 '+index,email:'synthetic'+index+'@example.invalid',city:'合成城市',categories:['other']},provenance:{kind:'public'},consent:{accepted:true,version:'synthetic-approved-v1',acceptedAt:at},review:{status:'new',accommodationStatus:'not_requested',invitationStatus:'not_sent'}};}
async function serve(route,path){
 const file=resolve(dist,'.'+(path.endsWith('/')?path+'index.html':path));
 assert.ok(file.startsWith(dist+'/'));
 try{return route.fulfill({status:200,body:await readFile(file),contentType:({html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',webp:'image/webp',woff2:'font/woff2'})[extname(file).slice(1)]||'application/octet-stream'});}
 catch{return route.fulfill({status:404,body:''});}
}
async function scenario(role){
 const context=await browser.newContext({viewport:{width:1280,height:950}}),page=await context.newPage();
 const user={id:'synthetic-'+role,label:'合成'+role,roles:[role]},state=syntheticState(),records=ids.slice(0,4).map(registration),writes=[];
 let staffAttempt=0,staffSavedBody=null,staffOperation=null;
 page.on('pageerror',error=>errors.push(role+':'+error.message));page.on('dialog',dialog=>dialog.accept());
 await context.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname;
  if(url.origin!=='https://api.artdico.host')return route.abort();
  if(!path.startsWith('/api/'))return serve(route,path);
  const raw=request.postData(),body=raw?JSON.parse(raw):null;
  if(request.method()!=='GET'){
   assert.equal(request.headers()['x-csrf-token'],csrf);
   writes.push({path,method:request.method(),raw,body});
  }
  if(path==='/api/admin/session')return route.fulfill(json({user,csrfToken:csrf}));
  if(path==='/api/admin/registrations')return route.fulfill(json({registrations:records,total:records.length,overallTotal:records.length,revision:0,nextCursor:null,stats:{byStatus:{new:records.length},byAccommodation:{not_requested:records.length}}}));
  if(path.startsWith('/api/admin/registrations/')){
   const record=records.find(value=>value.id===path.split('/').at(-1));
   return route.fulfill(json({registration:record,review:record?.review,revision:0}));
  }
  if(path==='/api/admin/users')return route.fulfill(json({revision:0,users:[{...user,username:'synthetic.owner',active:true,protected:true}]}));
  if(path==='/api/admin/group-invite')return route.fulfill(json({revision:0,configured:false,expired:false,expiresAt:null}));
  if(path==='/api/admin/maintenance')return route.fulfill(json({enabled:false,backup:{available:false}}));
  if(path==='/api/admin/admissions'&&request.method()==='GET')return route.fulfill(json(envelope(state)));
  if(path.startsWith('/api/admin/admissions/')){
   assert.match(body.operationId,/^[A-Za-z0-9_-]{32,128}$/u);
   if(path.endsWith('/staff')&&staffAttempt++){
    assert.equal(raw,staffSavedBody,'uncertain staff save must replay the exact original operation');
    return route.fulfill(json(envelope(state,{outcome:'replayed',promotedIds:[],registrationId:ids[4],receipt:{committed:true,registrationId:ids[4]},operation:staffOperation})));
   }
   assert.equal(body.expectedRevision,state.revision);
   if(path.endsWith('/settings')){
    assert.equal(role,'superadmin');assert.equal(request.method(),'PUT');
    assert.deepEqual(Object.keys(body.settings).sort(),['staffReserve','waitlistEnabled']);
    state.settings={...state.settings,...body.settings};
   }else if(path.endsWith('/staff')){
    assert.equal(role,'superadmin');staffSavedBody=raw;
    assert.deepEqual(body.input,{fields:{name:'合成工作人员',email:'crew@example.invalid'},permissionReference:'synthetic-permission-1',kind:'crew'});
    assert.equal(Object.hasOwn(body,'consent'),false);assert.equal(Object.hasOwn(body.input,'consent'),false);
    assert.equal(Object.hasOwn(body.input.fields,'consentAccepted'),false);
    state.people.push({registrationId:ids[4],kind:'crew',status:'waitlisted',queueNumber:5,changedAt:at,teamId:''});
    records.push({...registration(ids[4],5),fields:body.input.fields,provenance:{kind:'staff_entry',actorId:user.id,recordedAt:at,permissionReference:body.input.permissionReference},consent:{accepted:false,version:null,acceptedAt:null}});
    state.revision++;state.auditCount++;staffOperation={operationId:body.operationId,action:'staff_intake',registrationId:ids[4],kind:body.input.kind,revision:state.revision};
    // The synthetic service saved successfully, but the first acknowledgement was lost.
    return route.fulfill(json({error:{code:'UNAVAILABLE'}},503));
   }else if(path.endsWith('/teams')){
    assert.deepEqual(body.team,{...(body.team.id?{id:teamId}:{}),name:'合成两人团队',memberIds:[ids[0],ids[1]]});
    state.teams=[{id:teamId,...body.team}];for(const person of state.people)if(body.team.memberIds.includes(person.registrationId))person.teamId=teamId;
   }else if(path.endsWith('/withdraw')){
    assert.equal(body.registrationId,ids[0]);
    state.people[0].status='withdrawn';
    const first=state.people.find(person=>person.status==='waitlisted');assert.equal(first.registrationId,ids[2]);first.status='confirmed';
    state.revision++;state.auditCount++;
    return route.fulfill(json(envelope(state,{outcome:'updated',registrationId:body.registrationId,promotedIds:[ids[2]],operation:{operationId:body.operationId,action:'withdraw',registrationId:body.registrationId,revision:state.revision}})));
   }else if(path.endsWith('/promote')){
    assert.equal(envelope(state).summary.remainingTotal,0);
   }else return route.fulfill(json({error:{code:'UNEXPECTED'}},400));
   state.revision++;state.auditCount++;
   return route.fulfill(json(envelope(state,{outcome:'updated',promotedIds:[],...(path.endsWith('/teams')?{teamId}:{}),operation:{operationId:body.operationId,action:path.endsWith('/settings')?'settings':path.endsWith('/teams')?'team_save':'promote',registrationId:null,revision:state.revision,...(path.endsWith('/settings')?{settings:body.settings}:{}),...(path.endsWith('/teams')?{teamId}:{})}})));
  }
  return route.fulfill(json({error:{code:'NOT_FOUND'}},404));
 });
 try{
  await page.goto('https://api.artdico.host/admin/registrations/',{waitUntil:'networkidle'});
  const root=page.locator('[data-staff-admissions]');await root.waitFor({state:'visible'});
  const promote=root.locator('[data-admissions-promote]');await promote.waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-admissions-promote]').disabled);
  assert.equal(await page.locator('a[href="/admin/tasks/"]').count()>0,true);
  assert.match(await root.locator('[data-admissions-metrics]').textContent(),/已确认 \/ 总上限2 \/ 2/u);
  if(role==='superadmin'){
   const settings=root.locator('[data-admissions-settings]');
   const pendingTeam=root.locator('[data-admissions-team]'),pendingStaff=root.locator('[data-admissions-staff]');await pendingTeam.locator('..').evaluate(node=>node.open=true);await pendingStaff.locator('..').evaluate(node=>node.open=true);
   await pendingTeam.locator('[name=name]').fill('合成两人团队');await pendingTeam.locator('[name=memberIds]').selectOption([ids[0],ids[1]]);
   for(const[name,value]of Object.entries({name:'合成工作人员',email:'crew@example.invalid',permissionReference:'synthetic-permission-1'}))await pendingStaff.locator(`[name=${name}]`).fill(value);
   assert.equal(await settings.locator('[name=staffReserve]').inputValue(),'0');
   await settings.locator('[name=staffReserve]').fill('1');
   await root.locator('[data-admissions-refresh]').click();
   await root.locator('[data-admissions-status]').filter({hasText:'未执行任何修改'}).waitFor();
   assert.equal(await settings.locator('[name=staffReserve]').inputValue(),'1','read refresh preserves unsaved settings');
   assert.equal(state.settings.staffReserve,0);
   for(const reserve of ['1','0']){
    await settings.locator('[name=staffReserve]').fill(reserve);await settings.locator('button[type=submit]').click();
    await page.waitForFunction(value=>document.querySelector('[data-admissions-settings] [name=staffReserve]').value===value&&!document.querySelector('[data-admissions-promote]').disabled,reserve);
    assert.equal(state.settings.staffReserve,Number(reserve));assert.equal(await pendingTeam.locator('[name=name]').inputValue(),'合成两人团队');assert.equal(await pendingStaff.locator('[name=name]').inputValue(),'合成工作人员');
   }
   await settings.locator('[name=staffReserve]').fill('0');state.settings.staffReserve=1;state.revision++;state.auditCount++;
   await root.locator('[data-admissions-refresh]').click();await settings.locator('.ah-form-save-state[data-save-state=conflict]').waitFor();
   assert.equal(await settings.locator('[name=staffReserve]').inputValue(),'0');assert.equal(await settings.locator('button[type=submit]').isDisabled(),true);
   assert.equal(await pendingTeam.locator('[name=name]').inputValue(),'合成两人团队');assert.equal(await pendingTeam.locator('[data-admissions-save-state]').getAttribute('data-save-state'),'dirty');
   assert.equal(await pendingStaff.locator('[name=name]').inputValue(),'合成工作人员');
   await settings.locator('[data-admissions-reconcile]').click();await settings.locator('button[type=submit]').click();await settings.locator('.ah-form-save-state[data-save-state=saved]').waitFor();assert.equal(state.settings.staffReserve,0);
   await root.locator('[data-admissions-staff]').locator('..').evaluate(node=>node.open=true);
   const staff=root.locator('[data-admissions-staff]');
   for(const[name,value]of Object.entries({name:'合成工作人员',email:'crew@example.invalid',permissionReference:'synthetic-permission-1'}))await staff.locator(`[name=${name}]`).fill(value);
   await staff.locator('[name=confirmed]').check();await staff.locator('button[type=submit]').click();
   await root.locator('[data-admissions-pending]').waitFor({state:'visible'});
   assert.equal(await staff.locator('[name=name]').inputValue(),'合成工作人员');
   assert.equal(await staff.locator('[name=name]').isDisabled(),true);
   assert.equal(await promote.isDisabled(),true);
   assert.equal(await root.locator('[data-admissions-team] button[type=submit]').isDisabled(),true);
   assert.equal(writes.filter(write=>write.path.endsWith('/staff')).length,1);
   await page.reload({waitUntil:'networkidle'});await root.waitFor({state:'visible'});await staff.locator('..').evaluate(node=>node.open=true);
   await root.locator('[data-operations-local-draft="admission-pending"]').getByRole('button',{name:'恢复待核对操作',exact:true}).click();
   await root.locator('[data-admissions-retry]').click();
   await root.locator('[data-admissions-pending]').waitFor({state:'hidden'});
   await root.locator('[data-admissions-status]').filter({hasText:'实际一人的登记已保存'}).waitFor();
   assert.equal(await staff.locator('[name=name]').inputValue(),'合成工作人员');assert.equal(await staff.locator('[name=name]').isDisabled(),true);await staff.locator('[data-admissions-staff-next]').click();assert.equal(await staff.locator('[name=name]').inputValue(),'');
   const attempts=writes.filter(write=>write.path.endsWith('/staff'));assert.equal(attempts.length,2);assert.equal(attempts[0].raw,attempts[1].raw);
   assert.equal(state.people.filter(person=>person.registrationId===ids[4]).length,1);
   assert.equal(records.at(-1).consent.accepted,false);
  }else{
   assert.equal(await root.locator('[data-admissions-settings]').isVisible(),false);
   assert.equal(await root.locator('[data-admissions-staff]').isVisible(),false);
   assert.equal(await root.locator('[data-admissions-settings] [name=staffReserve]').isDisabled(),true);
   assert.equal(await root.getByRole('button',{name:'改为工作人员',exact:true}).count(),0);
   assert.equal(await promote.isEnabled(),true);
  }
  const team=root.locator('[data-admissions-team]');await team.locator('..').evaluate(node=>node.open=true);
  const beforePeople=state.people.length,beforeConfirmed=envelope(state).summary.confirmedCount;
  await team.locator('[name=name]').fill('合成两人团队');await team.locator('[name=memberIds]').selectOption([ids[0],ids[1]]);await team.locator('button[type=submit]').click();
  await root.locator('[data-admissions-teams]').filter({hasText:'2 位已登记成员'}).waitFor();
  assert.equal(state.people.length,beforePeople);assert.equal(envelope(state).summary.confirmedCount,beforeConfirmed);
  state.teams[0].name='另一页保存的团队名';state.revision++;state.auditCount++;
  await root.locator('[data-admissions-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-admissions-team] [name=name]').value==='另一页保存的团队名');
  await team.locator('[name=name]').fill('合成两人团队');state.teams[0].name='另一页再次修改团队';state.revision++;state.auditCount++;
  await root.locator('[data-admissions-refresh]').click();await team.locator('.ah-form-save-state[data-save-state=conflict]').waitFor();
  assert.equal(await team.locator('[name=name]').inputValue(),'合成两人团队');assert.equal(await team.locator('button[type=submit]').isDisabled(),true);
  await team.locator('[data-admissions-reconcile]').click();await team.locator('button[type=submit]').click();await team.locator('.ah-form-save-state[data-save-state=saved]').waitFor();
  await root.locator('[data-admissions-teams]').getByRole('button',{name:'编辑关联',exact:true}).click();
  assert.equal(await team.locator('[name=id]').inputValue(),teamId);
  await root.locator('[data-admissions-team-reset]').click();await page.waitForFunction(()=>document.querySelector('[data-admissions-team] [name=id]').value==='');
  assert.equal(await team.locator('[name=id]').inputValue(),'','new team mode clears the previous hidden team ID');
  await root.locator('.admissions-people > summary').click();
  const firstRow=root.locator('[data-admissions-people] tr').filter({hasText:ids[0]});
  assert.equal(await firstRow.getByRole('button',{name:'取消并释放名额',exact:true}).isEnabled(),true);
  await firstRow.getByRole('button',{name:'取消并释放名额',exact:true}).click();
  await root.locator('[data-admissions-status]').filter({hasText:'1 位已核准候补转正'}).waitFor();
  assert.equal(state.people[0].status,'withdrawn');assert.equal(state.people[2].status,'confirmed');assert.equal(state.people[3].status,'waitlisted');
  await root.locator('[data-admissions-promote]').click();
  await root.locator('[data-admissions-status]').filter({hasText:'未产生新的正式邀请'}).waitFor();
  assert.equal(writes.some(write=>write.path.endsWith('/promote')),true);
  if(role==='reviewer')assert.equal(writes.some(write=>/\/(?:settings|staff|kind)$/u.test(write.path)),false);
  await root.screenshot({path:resolve(evidence,'admissions-'+role+'.png')});
  reports.push({role,perPersonCounts:true,teamLinksOnly:true,fifoPromotion:true,dirtyOtherFormsRetained:true,sameScopeConflictRequiresExplicitReview:true,cleanTeamReadUsesCurrentValues:true,...(role==='superadmin'?{zeroDefaultReserve:true,uncertainStaffRetrySameOperation:true,recoveredPageAckLocksSavedPerson:true,staffConsentNotFabricated:true}:{restrictedToolsHidden:true}),mutations:writes.map(write=>write.path)});
 }finally{await context.close();}
}
try{await scenario('superadmin');await scenario('reviewer');assert.deepEqual(errors,[]);console.log(JSON.stringify({reports,pageErrors:errors},null,2));}
finally{await browser.close();}
