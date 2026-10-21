import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudApplication } from '../functions/cloud-content/runtime.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const ORIGIN='https://api.artdico.host', EVENT='ggj-cn-2026';
const PASSWORD='synthetic-volunteer-runtime-password';
const passwordHash=await hashPassword(PASSWORD);
const users=[
  {id:'synthetic-owner',username:'owner',roles:['superadmin','outreach','reviewer','editor','publisher']},
  {id:'synthetic-combined',username:'combined',roles:['outreach','reviewer']},
  {id:'synthetic-outreach',username:'outreach',roles:['outreach']},
  {id:'synthetic-reviewer',username:'reviewer',roles:['reviewer']},
  {id:'synthetic-editor',username:'editor',roles:['editor']},
].map(user=>({...user,label:user.id,passwordHash}));
const policy={enabled:true,eventId:EVENT,capacity:3,opensAt:'2026-10-19T00:00:00+08:00',closesAt:'2026-12-05T12:00:00+08:00',
  privacy:{version:'synthetic-volunteer-notice',processor:'合成处理者',contactEmail:'synthetic@example.invalid',purpose:'合成隔离测试',storageRegion:'合成地区',
    retention:'合成保留规则',rightsRequest:'合成权利入口',sharing:'不对外分享合成资料'}};
const request=(path,{method='GET',headers={},body,origin}={})=>new Request(ORIGIN+path,{method,
  headers:{...headers,...(origin?{Origin:origin}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})});
function fixture(){
  const objects=memoryObjects();
  const env={ADMIN_USERS_JSON:JSON.stringify(users),ARTDICO_REGISTRATION_ENABLED:'true',ARTDICO_REGISTRATION_WAITLIST_ENABLED:'true',
    ARTDICO_REGISTRATION_POLICY_JSON:JSON.stringify(policy),ARTDICO_REGISTRATION_CAPACITY:'3',ARTDICO_REGISTRATION_TOKEN_SECRET:'synthetic-volunteer-registration-secret',
    ARTDICO_CONFIRMATION_EMAIL_ENABLED:'false'};
  const make=()=>createCloudApplication({objects,env,now:()=>Date.parse('2026-10-21T09:00:00.000Z'),fetchFn:async()=>{throw new Error('Unexpected external send.');}});
  return {objects,app:make(),make};
}
async function login(app,username='owner'){
  const response=await app.handle(request('/api/admin/login',{method:'POST',origin:ORIGIN,body:{username,password:PASSWORD}}));
  assert.equal(response.status,200);const value=await response.json();
  return {Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':value.csrfToken};
}
async function contactRegistration(f){
  const created=await f.app.contactsStore.createContact(0,{name:'合成志愿者',organization:'合成团队',city:'合成城市',email:'synthetic.volunteer@example.invalid',
    background:'PRIVATE_ORIGINAL_VOLUNTEER_ANSWER',contactConsent:'consented'},users[0].id);
  const converted=await f.app.intentService.convertContacts({contactIds:[created.contact.id],expectedContactRevision:created.revision,
    actor:users[0],permissionReference:'合成隔离测试明确授权'});
  assert.equal(converted.registrations.length,1,JSON.stringify(converted.failures));
  return {contactId:created.contact.id,registrationId:converted.registrations[0].registrationId};
}
const volunteer=(contactId)=>({id:'volunteer_synthetic_01',source:{kind:'contact',id:contactId},workflowStatus:'confirmed',owner:'合成同事',
  followUpAt:'2026-11-01',lastContactAt:'2026-10-21',notes:'合成内部跟进',availability:[{start:'09:00',end:'18:00'}]});
async function operate(app,headers,expectedRevision,action,payload){
  const response=await app.handle(request('/api/admin/volunteers/operations',{method:'POST',origin:ORIGIN,headers,
    body:{expectedRevision,operationId:'synthetic_operation_'+String(expectedRevision).padStart(4,'0'),action,payload}}));
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
}

test('runtime volunteer writes persist, link both person routes, and keep signup and original answers intact',async()=>{
  const f=fixture(),ids=await contactRegistration(f),headers=await login(f.app,'combined');
  const beforeRegistration=await f.app.registrationService.repository.list();
  const picker=await f.app.handle(request('/api/admin/volunteers/sources',{headers}));
  assert.equal(picker.status,200);const candidates=await picker.json();
  assert.equal(candidates.candidates.length,1,'known explicit contact conversion is one person in the picker');
  assert.equal(candidates.candidates[0].source.id,ids.contactId);
  assert.doesNotMatch(JSON.stringify(candidates),/PRIVATE_ORIGINAL_VOLUNTEER_ANSWER|permissionReference|sourceDigest|receiptToken/u);
  const saved=await operate(f.app,headers,0,'volunteer_upsert',volunteer(ids.contactId));assert.equal(saved.revision,1);
  await operate(f.app,headers,1,'position_upsert',{id:'position_synthetic_01',name:'合成签到',zone:'A',location:'合成入口',lead:'合成负责人',description:'合成岗位',status:'active'});
  await operate(f.app,headers,2,'shift_upsert',{id:'shift_synthetic_01',positionId:'position_synthetic_01',start:'10:00',end:'11:00',required:2,status:'active',sessionId:'',boothId:''});
  const assigned=await operate(f.app,headers,3,'assignment_upsert',{id:'assignment_synthetic_01',volunteerId:'volunteer_synthetic_01',shiftId:'shift_synthetic_01',status:'confirmed'});
  assert.equal(assigned.summary.assignedPeopleCount,1);assert.equal(assigned.summary.requiredSlots,2);
  assert.equal(assigned.summary.confirmedSlots,1);assert.equal(assigned.summary.gapSlots,1);
  const restarted=f.make(),readStart=f.objects.calls.length;
  const response=await restarted.handle(request('/api/admin/volunteers',{headers}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const state=await response.json();assert.equal(state.revision,4);assert.equal(state.volunteers[0].notes,'合成内部跟进');
  assert.equal(state.volunteers[0].person.registrationId,ids.registrationId);assert.equal(state.shifts[0].confirmedCount,1);
  for(const path of ['contacts/'+ids.contactId,'registrations/'+ids.registrationId]){
    const person=await restarted.handle(request('/api/admin/people/'+path,{headers}));
    assert.equal(person.status,200);const value=await person.json();
    assert.equal(value.availability.volunteers,'available');assert.equal(value.revisions.volunteers,4);
    assert.equal(value.volunteers.entries[0].id,'volunteer_synthetic_01');
    assert.equal(value.volunteers.entries[0].assignments[0].positionName,'合成签到');
    assert.doesNotMatch(JSON.stringify(value),/合成内部跟进|PRIVATE_ORIGINAL_VOLUNTEER_ANSWER|permissionReference|sourceDigest/u);
  }
  assert.equal(f.objects.calls.slice(readStart).some(call=>call.operation!=='get'),false,'read-only roster/person pages never write journals');
  const afterRegistration=await restarted.registrationService.repository.list();
  assert.deepEqual(afterRegistration,beforeRegistration,'volunteering does not create or reclassify registrations');
});

test('runtime whole-module role and CSRF gates run before private volunteer/source reads or writes',async()=>{
  const f=fixture();
  assert.equal((await f.app.handle(request('/api/admin/volunteers'))).status,401);
  for(const username of ['outreach','reviewer','editor']){
    const headers=await login(f.app,username),start=f.objects.calls.length;
    for(const path of ['/api/admin/volunteers','/api/admin/volunteers/sources']){
      assert.equal((await f.app.handle(request(path,{headers}))).status,403);
    }
    assert.equal(f.objects.calls.slice(start).some(call=>/^cms\/v1\/(?:volunteers|contacts|intent-invitations|content|registrations)(?:\/|$)/u.test(call.key)),false);
  }
  const headers=await login(f.app),start=f.objects.calls.length;
  const body={expectedRevision:0,operationId:'synthetic_operation_denied',action:'volunteer_upsert',payload:volunteer('contact_missing')};
  assert.equal((await f.app.handle(request('/api/admin/volunteers/operations',{method:'POST',origin:ORIGIN,headers:{Cookie:headers.Cookie},body}))).status,403);
  assert.equal((await f.app.handle(request('/api/admin/volunteers/operations',{method:'POST',origin:'https://foreign.example.invalid',headers,body}))).status,403);
  assert.equal(f.objects.calls.slice(start).some(call=>call.operation!=='get'),false);
  assert.equal(f.objects.calls.slice(start).some(call=>/^cms\/v1\/volunteers\//u.test(call.key)),false);
});
