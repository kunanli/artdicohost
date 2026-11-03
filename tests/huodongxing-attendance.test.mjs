import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_API} from './helpers/people-runtime-fixture.mjs';
import {createPersonWorkspaceApi} from '../functions/person-workspace/handler.mjs';
import {personWorkspaceView,personAttendanceView,personNextAction,personWorkspaceSteps} from '../src/lib/person-workspace.mjs';
import {validatePeopleDirectory} from '../src/lib/people-directory.mjs';
import {COLLABORATOR_ROLES} from '../shared/staff-permissions.mjs';

const SOURCE='huodongxing-8884819113200',EVENT='8884819113200';
const op=()=>randomBytes(24).toString('base64url');
const copy=value=>structuredClone(value),businessWrites=f=>f.objects.calls.filter(row=>row.operation!=='get').length;
async function fixture({merge=false}={}){
  const runtime=await peopleRuntimeFixture({capacity:8,mail:false});
  const external=(await runtime.createContact({name:'合成活动行参加者',email:'synthetic.external@example.invalid'})).contact;
  const ordinary=(await runtime.createContact({name:'合成其他来源参加者',email:'synthetic.ordinary@example.invalid'})).contact;
  const converted=await runtime.app.intentService.convertContacts({actor:runtime.users[0],contactIds:[external.id,ordinary.id],expectedContactRevision:2,permissionReference:'合成受控代登记依据'});
  assert.equal(converted.status,'completed');const ids=new Map(converted.registrations.map(row=>[row.contactId,row.registrationId]));
  const externalId=ids.get(external.id),ordinaryId=ids.get(ordinary.id);assert.ok(externalId&&ordinaryId);
  if(merge){const admission=await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]}),roster=await runtime.app.contactsStore.read();
    const result=await runtime.app.registrationService.managePerson({actor:runtime.users[0],action:'person_merge',expectedRevision:admission.revision,operationId:op(),
      input:{keys:['contact:'+ordinary.id,'contact:'+external.id],primaryKey:'contact:'+ordinary.id,roles:null,contactRevision:roster.revision},verifySources:()=>true});assert.equal(result.outcome,'updated');
  }
  const program=await runtime.app.store.read(),data={roster:await runtime.app.contactsStore.read(),intent:await runtime.app.intentService.read({actor:runtime.users[0]}),
    registrations:await runtime.app.reviewStore.healthDirectory(),admissions:await runtime.app.registrationService.getAdmissions({actor:runtime.users[0]}),content:{...program.draft,published:program.published},
    details:new Map(),confirmations:new Map(),deliveries:{revision:0,notices:[]}};
  for(const id of[externalId,ordinaryId]){data.details.set(id,await runtime.app.reviewStore.detail(id));data.confirmations.set(id,{revision:0,notices:[]});}
  data.roster.contacts.find(row=>row.id===external.id).source.key=SOURCE;
  const reads=[],proofCalls=[];let revision=4,proofIds=[externalId];
  const proof=()=>({kind:'huodongxing',verified:true,sourceEventId:EVENT,revision,registrationIds:[...proofIds]});
  function api({roles=['superadmin'],provider=proof,omitProvider=false}={}){
    const actor={id:'synthetic-attendance-reader',roles:[...roles]},load=(name,fn)=>async(...args)=>{reads.push(name);return copy(await fn(...args));};
    return createPersonWorkspaceApi({authenticate:async()=>({user:actor}),
      loadContacts:load('contacts',()=>data.roster),loadIntent:load('intent',()=>data.intent),loadPersonGroups:load('groups',()=>({groups:data.admissions.personGroups??[]})),
      loadRegistration:load('registration',id=>data.details.get(id)),loadAdmission:load('admission',id=>{const row=data.admissions.people.find(item=>item.registrationId===id);return {...row,revision:data.admissions.revision};}),
      loadContent:load('content',()=>data.content),loadConfirmations:load('confirmations',id=>data.confirmations.get(id)),
      loadRegistrationDirectory:load('registrationDirectory',()=>data.registrations),loadHealthRegistrations:load('healthRegistrations',()=>data.registrations),
      loadAdmissions:load('admissions',()=>data.admissions),loadDeliveryDirectory:load('deliveries',()=>data.deliveries),
      ...(!omitProvider?{externalAttendanceEvidence:async input=>{proofCalls.push(copy(input));return provider(input);}}:{})});
  }
  async function read(path='/api/admin/people/directory',options={},status=200){const response=await api(options)(new Request(PEOPLE_FIXTURE_API+path)),body=await response.json();assert.equal(response.status,status,JSON.stringify(body));
    if(status===200){if(path.startsWith('/api/admin/people/directory'))assert.equal(validatePeopleDirectory(body,'all'),true);else if(!path.endsWith('/source'))assert.ok(personWorkspaceView(body,body.selected));}return body;}
  const person=(id=external.id,options={},status=200)=>read('/api/admin/people/contacts/'+id,options,status);
  const row=(body,id=external.id)=>body.rows.find(item=>item.contactId===id||item.registrationId===id);
  return {runtime,data,external,ordinary,externalId,ordinaryId,reads,proofCalls,proof,api,read,person,row,setRevision:value=>{revision=value;},setProofIds:value=>{proofIds=value;}};
}

test('verified external evidence is batched for authorized IDs, confirms attendance without rewriting pending replies, and GETs never write or send',async()=>{
  const f=await fixture(),before=businessWrites(f.runtime),snapshot=JSON.stringify(f.data.roster),directory=await f.read(),external=f.row(directory),ordinary=f.row(directory,f.ordinary.id);
  assert.equal(external.responseStatus,'pending');assert.equal(external.attendance.key,'confirmed');assert.notEqual(external.nextAction.key,'reply');assert.equal(ordinary.attendance.key,'awaiting');assert.equal(ordinary.nextAction.key,'reply');
  assert.equal(f.proofCalls.length,1);assert.deepEqual([...f.proofCalls[0].registrationIds].sort(),[f.externalId,f.ordinaryId].sort());assert.deepEqual(f.proofCalls[0].actor.roles,['superadmin']);
  const person=await f.person();assert.equal(person.registration.externalAttendance,'verified');assert.equal(person.contact.operations.responseStatus,'pending');assert.equal(person.attendance.key,'confirmed');assert.notEqual(personNextAction(person,['superadmin']).key,'reply');
  assert.deepEqual(f.proofCalls[1].registrationIds,[f.externalId]);assert.equal(personWorkspaceSteps(person,['superadmin']).find(row=>row.key==='reply').state,'complete');
  const view=personWorkspaceView(person,person.selected);delete view.attendance;assert.equal(personAttendanceView(view).key,'confirmed');assert.notEqual(personNextAction(view,['superadmin']).key,'reply');
  assert.equal(JSON.stringify(f.data.roster),snapshot);assert.equal(businessWrites(f.runtime),before);assert.equal(f.runtime.messages.length,0);
  assert.doesNotMatch(JSON.stringify([directory,person]),/sourceEventId|8884819113200|receiptToken|PRIVATE-/u);assert.doesNotMatch(JSON.stringify(directory),/synthetic.external@example/u);
});

test('a source key alone and a valid empty proof cannot turn reserved staff places into attendee replies',async()=>{
  const f=await fixture();
  for(const options of[{omitProvider:true},{provider:()=>({...f.proof(),registrationIds:[]})}]){
    const directory=await f.read(undefined,options),person=await f.person(undefined,options);
    assert.equal(f.row(directory).attendance.key,'awaiting');assert.equal(person.registration.externalAttendance,undefined);assert.equal(person.attendance.key,'awaiting');assert.equal(personNextAction(person,['superadmin']).key,'reply');
  }
});

test('malformed or unavailable attestations fail only the external source closed, including missing revision, wrong event and outsider IDs',async()=>{
  const f=await fixture(),outsider='z'.repeat(43),bad=[null,{}, {...f.proof(),kind:'manual'},{...f.proof(),verified:false},{...f.proof(),sourceEventId:'8884819113201'},
    {...f.proof(),revision:undefined},{...f.proof(),revision:null},{...f.proof(),revision:'4'},{...f.proof(),revision:-1},{...f.proof(),revision:1.5},
    {...f.proof(),registrationIds:[outsider]},{...f.proof(),registrationIds:[f.externalId,f.externalId]},{...f.proof(),registrationIds:[...f.proof().registrationIds,outsider]},{...f.proof(),registrationIds:new Array(1)}];
  const providers=[...bad.map(value=>()=>value),()=>{throw new Error('PRIVATE_EXTERNAL_PROVIDER_FAILURE');}];
  const before=businessWrites(f.runtime);
  for(const provider of providers){const directory=await f.read(undefined,{provider}),external=f.row(directory),ordinary=f.row(directory,f.ordinary.id);
    assert.equal(external.attendance.key,'unavailable');assert.equal(external.nextAction.key,'check');assert.equal(ordinary.attendance.key,'awaiting');assert.equal(ordinary.nextAction.key,'reply');
    const person=await f.person(undefined,{provider});assert.equal(person.registration.externalAttendance,'unavailable');assert.equal(person.attendance.key,'unavailable');assert.equal(personNextAction(person,['superadmin']).key,'check');
    const view=personWorkspaceView(person,person.selected);delete view.attendance;assert.equal(personAttendanceView(view).key,'unavailable');
    assert.doesNotMatch(JSON.stringify([directory,person]),/PRIVATE_EXTERNAL_PROVIDER_FAILURE|8884819113201/u);
  }
  assert.equal(businessWrites(f.runtime),before);assert.equal(f.runtime.messages.length,0);
});

test('the external getter is gated by the complete manager role set and is never consulted for malformed requests or unrelated routes',async()=>{
  const f=await fixture();
  for(const roles of[['reviewer'],['outreach'],['outreach','reviewer'],['editor','outreach','reviewer']]){
    const count=f.proofCalls.length;await f.read(undefined,{roles});assert.equal(f.proofCalls.length,count,'partial role sets do not consult the external source');
    if(roles.includes('outreach'))await f.person(undefined,{roles});else await f.read('/api/admin/people/registrations/'+f.externalId,{roles});assert.equal(f.proofCalls.length,count);
  }
  await f.read(undefined,{roles:[...COLLABORATOR_ROLES]});assert.equal(f.proofCalls.length,1);
  const count=f.proofCalls.length,reads=f.reads.length;await f.read('/api/admin/people/directory?attendance=invalid',{},400);assert.equal(f.proofCalls.length,count);assert.equal(f.reads.length,reads);
  await f.read('/api/admin/people/directory',{roles:['editor']},403);assert.equal(f.proofCalls.length,count);assert.equal(f.reads.length,reads);
  await f.read('/api/admin/people/contacts/'+f.external.id+'/source');assert.equal(f.proofCalls.length,count,'source disclosure does not consult attendance evidence');
});

test('external revision and availability participate in pagination proofs before attendance filtering',async()=>{
  const f=await fixture();f.setProofIds([f.externalId,f.ordinaryId]);
  const first=await f.read('/api/admin/people/directory?attendance=confirmed&limit=1');assert.equal(first.total,2);assert.equal(first.rows.length,1);assert.ok(first.nextCursor);
  const next=await f.read('/api/admin/people/directory?attendance=confirmed&limit=1&cursor='+first.nextCursor);assert.equal(next.rows.length,1);assert.notEqual(next.rows[0].key,first.rows[0].key);
  f.setRevision(5);await f.read('/api/admin/people/directory?attendance=confirmed&limit=1&cursor='+first.nextCursor,{},409);
  const refreshed=await f.read('/api/admin/people/directory?attendance=confirmed&limit=1');assert.notEqual(refreshed.revision,first.revision);
  await f.read('/api/admin/people/directory?attendance=confirmed&limit=1&cursor='+refreshed.nextCursor,{provider:()=>{throw Error('synthetic failure');}},409);
});

test('current mail acceptance is the third stage while old or current unknown mail still wins the next action and cannot invent sent evidence',async()=>{
  const f=await fixture(),notice={id:'synthetic-formal-accepted',kind:'registration',status:'provider_accepted',admissionStatus:'confirmed',attempt:1,createdAt:'2026-10-21T09:00:00.000Z',updatedAt:'2026-10-21T09:00:00.000Z',currentRecipient:true};
  f.data.confirmations.set(f.externalId,{revision:1,notices:[notice]});f.data.deliveries={revision:1,notices:[{registrationId:f.externalId,status:'provider_accepted'}]};
  let directory=await f.read(),person=await f.person();assert.equal(f.row(directory).attendance.key,'invited');assert.equal(person.attendance.key,'invited');assert.match(person.attendance.invitationLabel,/服务已接收.*未证明送达/u);assert.notEqual(personNextAction(person,['superadmin']).key,'reply');
  f.data.confirmations.get(f.externalId).notices.push({...notice,id:'synthetic-old-unknown',status:'unknown',currentRecipient:false});f.data.deliveries.notices[0].historicalUnknown=true;
  directory=await f.read();person=await f.person();assert.equal(f.row(directory).attendance.key,'invited');assert.equal(person.attendance.key,'invited');assert.match(f.row(directory).attendance.warning,/待核对.*勿重寄/u);assert.match(person.attendance.warning,/待核对.*勿重寄/u);assert.equal(f.row(directory).nextAction.key,'check');assert.equal(personNextAction(person,['superadmin']).key,'check');
  f.data.confirmations.set(f.externalId,{revision:2,notices:[{...notice,status:'unknown'}]});f.data.deliveries={revision:2,notices:[{registrationId:f.externalId,status:'unknown'}]};
  directory=await f.read();person=await f.person();assert.equal(f.row(directory).attendance.key,'confirmed');assert.equal(person.attendance.key,'confirmed');assert.equal(person.attendance.invitationLabel,'');assert.equal(personNextAction(person,['superadmin']).key,'check');assert.equal(f.runtime.messages.length,0);
});

test('a verified ticket cannot override explicit refusal, withdrawal, rejection, waitlist or review state',async()=>{
  const f=await fixture(),contact=f.data.roster.contacts.find(row=>row.id===f.external.id),admission=f.data.admissions.people.find(row=>row.registrationId===f.externalId);
  for(const status of['withdrawn','rejected','waitlisted','pending_review']){admission.status=status;const directory=await f.read(),person=await f.person();assert.equal(f.row(directory).attendance.key,status);assert.equal(person.attendance.key,status);assert.equal(person.registration.externalAttendance,undefined);if(status!=='waitlisted')assert.notEqual(personNextAction(person,['superadmin']).key,'reply');}
  admission.status='confirmed';contact.operations.responseStatus='declined';let person=await f.person();assert.equal(person.attendance.key,'declined');assert.notEqual(personNextAction(person,['superadmin']).key,'reply');assert.equal(f.row(await f.read()).attendance.key,'declined');
  contact.operations.responseStatus='pending';contact.profile.contactConsent='declined';person=await f.person();assert.equal(person.attendance.key,'declined');assert.equal(f.row(await f.read()).attendance.key,'declined');assert.notEqual(personNextAction(person,['superadmin']).key,'reply');
});

test('optional client evidence validates the fixed enum, preserves fallback behavior and never treats a missing old field as verified',async()=>{
  const f=await fixture(),body=await f.person(),view=personWorkspaceView(body,body.selected);assert.ok(view);assert.equal(view.registration.externalAttendance,'verified');delete view.attendance;assert.equal(personAttendanceView(view).key,'confirmed');
  delete view.registration.externalAttendance;assert.equal(personAttendanceView(view).key,'awaiting');assert.equal(personNextAction(view,['superadmin']).key,'reply');
  for(const externalAttendance of[null,true,1,{},[],'confirmed','unverified']){const invalid=copy(body);invalid.registration.externalAttendance=externalAttendance;assert.equal(personWorkspaceView(invalid,invalid.selected),null);}
  const unavailable=copy(body);delete unavailable.attendance;unavailable.registration.externalAttendance='unavailable';assert.equal(personAttendanceView(personWorkspaceView(unavailable,unavailable.selected)).key,'unavailable');
});

test('an external-source authentication failure ends the request instead of returning already assembled private data',async()=>{
  const f=await fixture(),provider=()=>{throw Object.assign(Error('PRIVATE_EXTERNAL_SESSION_DETAIL'),{status:401});};
  for(const path of['/api/admin/people/directory','/api/admin/people/contacts/'+f.external.id]){const body=await f.read(path,{provider},401);assert.equal(body.error.code,'AUTH_REQUIRED');assert.doesNotMatch(JSON.stringify(body),/合成|PRIVATE_EXTERNAL_SESSION_DETAIL|registrationId/u);}
});

test('a merged person keeps refusal from any explicit contact source ahead of a verified external ticket',async()=>{
  const f=await fixture({merge:true}),secondary=f.data.roster.contacts.find(row=>row.id===f.external.id),group=f.data.admissions.personGroups[0];
  assert.equal(group.primaryContactId,f.ordinary.id);f.setProofIds([group.primaryRegistrationId]);
  for(const refusal of['reply','consent']){
    secondary.operations.responseStatus=refusal==='reply'?'declined':'pending';secondary.profile.contactConsent=refusal==='consent'?'declined':'consented';
    const directory=await f.read(),person=await f.person(f.ordinary.id);assert.equal(directory.rows[0].attendance.key,'declined');assert.equal(person.attendance.key,'declined');assert.equal(person.registration.externalAttendance,'declined');assert.notEqual(directory.rows[0].nextAction.key,'notification');assert.notEqual(personNextAction(person,['superadmin']).key,'notification');
    // Ordinary quick-save receipts replace only the primary contact operations
    // and invalidate the derived stage. The secondary refusal must survive it.
    const view=personWorkspaceView(person,person.selected);view.contact.operations={...view.contact.operations,notes:'合成普通保存后的备注'};view.revisions.contacts++;delete view.attendance;
    assert.ok(personWorkspaceView(view,view.selected));assert.equal(personAttendanceView(view).key,'declined');assert.notEqual(personNextAction(view,['superadmin']).key,'reply');assert.notEqual(personNextAction(view,['superadmin']).key,'notification');assert.equal(personWorkspaceSteps(view,['superadmin']).find(row=>row.key==='reply').state,'complete');
  }
});

test('external-source failure is localized to a merged person even when only the secondary contact has the external source key',async()=>{
  const f=await fixture({merge:true}),provider=()=>{throw Error('synthetic external source unavailable');},directory=await f.read(undefined,{provider}),person=await f.person(f.ordinary.id,{provider});
  assert.equal(directory.rows[0].attendance.key,'unavailable');assert.equal(directory.rows[0].nextAction.key,'check');assert.equal(person.registration.externalAttendance,'unavailable');assert.equal(person.attendance.key,'unavailable');assert.equal(personNextAction(person,['superadmin']).key,'check');
  const view=personWorkspaceView(person,person.selected);view.contact.operations={...view.contact.operations,notes:'合成普通保存后的备注'};view.revisions.contacts++;delete view.attendance;
  assert.ok(personWorkspaceView(view,view.selected));assert.equal(view.registration.externalAttendance,'unavailable');assert.equal(personAttendanceView(view).key,'unavailable');assert.equal(personNextAction(view,['superadmin']).key,'check');
});

test('ordinary quick-save fallback preserves verified external attendance while a newly saved explicit refusal still wins',async()=>{
  const f=await fixture(),person=await f.person(),view=personWorkspaceView(person,person.selected);
  view.contact.operations={...view.contact.operations,notes:'合成普通保存后的备注'};view.revisions.contacts++;delete view.attendance;
  assert.ok(personWorkspaceView(view,view.selected));assert.equal(view.registration.externalAttendance,'verified');assert.equal(view.contact.operations.responseStatus,'pending');assert.equal(personAttendanceView(view).key,'confirmed');assert.notEqual(personNextAction(view,['superadmin']).key,'reply');assert.equal(personWorkspaceSteps(view,['superadmin']).find(row=>row.key==='reply').state,'complete');
  view.contact.operations.responseStatus='declined';assert.equal(personAttendanceView(view).key,'declined');assert.notEqual(personNextAction(view,['superadmin']).key,'reply');assert.notEqual(personNextAction(view,['superadmin']).key,'notification');
});
