import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePeopleDirectory} from '../src/lib/people-directory.mjs';
import {createPersonWorkspaceApi} from '../functions/person-workspace/handler.mjs';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_PRIVATE} from './helpers/people-runtime-fixture.mjs';

const API='https://api.artdico.host';
async function read(f,headers,path='/api/admin/people/directory'){
  const response=await f.app.handle(f.request(path,{headers})),value=await response.json();if(response.status===200)assert.equal(validatePeopleDirectory(value,new URL(path,API).searchParams.get('view')??'all'),true,'actual directory satisfies the browser contract');return{response,value};
}
test('directory joins only explicit sources, keeps same-name public applications separate, and derives multiple actual roles',async()=>{
  const f=await peopleRuntimeFixture(),first=await f.createContact({name:'合成同名人员',email:'synthetic.same@example.invalid'});
  const saved=await f.app.contactsStore.saveOperations(first.contact.id,first.revision,{...first.contact.operations,participationForms:['speaker','guest']},f.users[0].id);
  const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[first.contact.id],expectedContactRevision:saved.revision,permissionReference:'synthetic explicit permission'});
  assert.equal(converted.status,'completed');
  await f.seedPublic({intake:'general-v2',name:'合成同名人员',email:'synthetic.same@example.invalid'});
  const second=await f.createContact({name:'合成只有身份',categories:['industry']});
  const headers=await f.login(),writes=()=>f.objects.calls.filter(item=>item.operation!=='get').length,before=writes();
  const {response,value}=await read(f,headers);
  assert.equal(response.status,200);assert.equal(value.summary.people,3);assert.equal(value.summary.confirmed,1);assert.equal(value.summary.pendingReview,1);
  const joined=value.rows.find(row=>row.contactId===first.contact.id);
  assert.equal(joined.source,'linked');assert.equal(joined.registrationId,converted.registrations[0].registrationId);assert.deepEqual(joined.roles,['speaker','guest']);
  assert.deepEqual(value.rows.find(row=>row.contactId===second.contact.id).roles,[],'a current category is not an assigned role');
  assert.equal(value.rows.filter(row=>row.name==='合成同名人员').length,2,'same email/name is never an identity match');
  for(const view of ['speakers','guests']){const result=await read(f,headers,'/api/admin/people/directory?view='+view);assert.equal(result.value.rows.length,1);assert.equal(result.value.rows[0].key,joined.key);}
  const encoded=JSON.stringify(value);assert.doesNotMatch(encoded,/@example.invalid|synthetic.*secret|SYNTHETIC_ORIGINAL|internalNotes|consentAccepted|receiptToken/u);
  assert.equal(encoded.includes(PEOPLE_FIXTURE_PRIVATE),false);assert.equal(writes(),before);assert.equal(f.messages.length,0);
  assert.match(response.headers.get('cache-control'),/no-store/u);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
});
test('exhibitors are organizations with explicit members and booths; legacy booth text is preserved without creating organizations',async()=>{
  const f=await peopleRuntimeFixture(),created=await f.createContact({name:'合成企业联络人'}),saved=await f.app.store.read(),content=structuredClone(saved.draft.content);
  content.organizations=[{id:'synthetic-exhibitor',name:'合成参展团队',logoId:'',website:'',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:'PRIVATE_ORGANIZATION_NOTE'},
    {id:'synthetic-participant',name:'合成普通组织',logoId:'',website:'',participation:'attendee',status:'pending',publicConsent:false,internalNotes:''}];
  content.guests=[{id:'synthetic-unlinked-speaker',name:'合成企业联络人',company:'合成机构',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,internalNotes:'PRIVATE_PROFILE_NOTE',contactId:'',publicRoles:['speaker']}];
  content.booths=[{id:'synthetic-booth-a',code:'A01',organization:'合成参展团队',organizationId:'synthetic-exhibitor',project:'',zone:'C',status:'pending',internalNotes:'',slotNumber:1},
    {id:'synthetic-booth-b',code:'A02',organization:'合成旧展位文字',project:'',zone:'C',status:'pending',internalNotes:'',slotNumber:2}];
  await f.app.store.save(saved.draft.revision,content,f.users[0].id);
  await f.app.contactsStore.saveOperations(created.contact.id,created.revision,{...created.contact.operations,organizationMemberships:[{organizationId:'synthetic-exhibitor',role:'lead',title:'合成联络人'}]},f.users[0].id);
  const headers=await f.login(),result=await read(f,headers,'/api/admin/people/directory?view=exhibitors');
  assert.equal(result.response.status,200);assert.equal(result.value.summary.exhibitors,1);assert.equal(result.value.rows.length,2);
  const company=result.value.rows.find(item=>item.kind==='organization');assert.equal(company.name,'合成参展团队');assert.equal(company.members[0].id,created.contact.id);assert.equal(company.booths[0].id,content.booths[0].id);
  assert.ok(result.value.rows.some(item=>item.kind==='unlinked_booth'&&item.organizationId===null));
  const all=await read(f,headers);assert.equal(all.value.rows.length,2,'same-name unlinked public profile remains distinct');
  assert.deepEqual(all.value.rows.find(item=>item.contactId).roles,[],'organization membership alone is not an event duty');
  assert.doesNotMatch(JSON.stringify(result.value),/PRIVATE_ORGANIZATION_NOTE|PRIVATE_PROFILE_NOTE|@example.invalid/u);
});
test('directory permissions gate every source before IO and role views cannot read a reviewer-only roster',async()=>{
  let reads=0;
  for(const user of [null,{id:'editor',roles:['editor']}]){
    const api=createPersonWorkspaceApi({authenticate:async()=>({user}),loadContacts:()=>{reads++;throw new Error();},loadRegistrationDirectory:()=>{reads++;throw new Error();}});
    const response=await api(new Request(API+'/api/admin/people/directory'));assert.equal(response.status,user?403:401);
  }
  const reviewer=createPersonWorkspaceApi({authenticate:async()=>({user:{id:'reviewer',roles:['reviewer']}}),loadContacts:()=>{reads++;throw new Error();}});
  assert.equal((await reviewer(new Request(API+'/api/admin/people/directory?view=guests'))).status,403);assert.equal(reads,0);
  const f=await peopleRuntimeFixture();await f.createContact();await f.seedPublic({intake:'general-v2'});
  const onlyReview=await read(f,await f.login('reviewer'));assert.equal(onlyReview.response.status,200);assert.equal(onlyReview.value.rows.length,1);
  assert.equal(onlyReview.value.permissions.contacts,false);assert.equal(onlyReview.value.summary.guests,null);
  const onlyContact=await read(f,await f.login('outreach'));assert.equal(onlyContact.response.status,200);assert.equal(onlyContact.value.rows.length,1);
  assert.equal(onlyContact.value.permissions.registrations,false);assert.equal(onlyContact.value.summary.pendingReview,null);
});
test('directory cursors bind source revisions, filter and permission scope; malformed queries do not load records',async()=>{
  const f=await peopleRuntimeFixture();await f.createContact({name:'合成一'});await f.createContact({name:'合成二'});const headers=await f.login();
  const first=await read(f,headers,'/api/admin/people/directory?limit=1');assert.ok(first.value.nextCursor);
  const next=await read(f,headers,'/api/admin/people/directory?limit=1&cursor='+first.value.nextCursor);assert.equal(next.response.status,200);assert.notEqual(next.value.rows[0].key,first.value.rows[0].key);
  await f.createContact({name:'合成三'});assert.equal((await read(f,headers,'/api/admin/people/directory?cursor='+first.value.nextCursor)).response.status,409);
  for(const query of ['?view=unknown','?limit=0','?view=all&view=all','?query='+encodeURIComponent('\n')])assert.equal((await read(f,headers,'/api/admin/people/directory'+query)).response.status,400);
});


test('directory orders by actual creation time newest first, not review state or later edits',async()=>{
  let clock=Date.parse('2026-10-21T09:00:00.000Z');const f=await peopleRuntimeFixture({clock:()=>clock}),headers=await f.login();
  const pending=await f.seedPublic({intake:'general-v2'});clock+=60000;
  const recent=await f.createContact({name:'A 合成较新录入'}),recentAt=recent.contact.createdAt;clock+=60000;
  const latest=await f.createContact({name:'Z 合成最新录入'}),latestAt=latest.contact.createdAt;clock+=60000;
  await f.app.contactsStore.saveProfile(recent.contact.id,latest.revision,{name:'A 合成后续修正'},f.users[0].id);
  const result=await read(f,headers);assert.equal(result.response.status,200);
  assert.deepEqual(result.value.rows.map(row=>row.key),['contact:'+latest.contact.id,'contact:'+recent.contact.id,'registration:'+pending.reference_code]);
  assert.equal(result.value.rows[0].recordedAt,latestAt);assert.equal(result.value.rows[1].recordedAt,recentAt);
  const first=await read(f,headers,'/api/admin/people/directory?limit=1');assert.equal(first.value.rows[0].key,'contact:'+latest.contact.id);
  const second=await read(f,headers,'/api/admin/people/directory?limit=1&cursor='+first.value.nextCursor);assert.equal(second.value.rows[0].key,'contact:'+recent.contact.id);
});

test('contact deletion is permission checked, durable and restorable without erasing source or withdrawing a linked registration',async()=>{
  const f=await peopleRuntimeFixture(),created=await f.createContact(),id=created.contact.id,headers=await f.login(),onlyOutreach=await f.login('outreach');
  const path='/api/admin/contacts/'+id+'/archive',body={expectedRevision:created.revision,archived:true};
  assert.equal((await f.app.handle(f.request(path,{method:'POST',headers:onlyOutreach,body}))).status,403);
  assert.equal((await f.app.handle(f.request(path,{method:'POST',headers:{Cookie:headers.Cookie},body}))).status,403);
  const removed=await f.app.handle(f.request(path,{method:'POST',headers,body}));assert.equal(removed.status,200);const receipt=await removed.json();assert.ok(receipt.contact.archivedAt);
  assert.deepEqual(receipt.contact.profile,created.contact.profile);assert.deepEqual(receipt.contact.source,created.contact.source);
  assert.equal((await read(f,headers)).value.rows.length,0);assert.equal((await f.app.contactsStore.read()).contacts.length,1);
  assert.equal((await f.make().contactsStore.read()).contacts[0].archivedAt,receipt.contact.archivedAt,'archive survives a fresh runtime');
  assert.equal((await f.app.handle(f.request(path,{method:'POST',headers,body}))).status,409,'stale deletion never rewrites');
  const restored=await f.app.handle(f.request(path,{method:'POST',headers,body:{expectedRevision:receipt.revision,archived:false}}));assert.equal(restored.status,200);assert.equal((await read(f,headers)).value.rows.length,1);
  const current=await f.app.contactsStore.read(),conversion=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[id],expectedContactRevision:current.revision,permissionReference:'synthetic explicit permission'});
  const registrationId=conversion.registrations[0].registrationId,beforeAdmission=await f.app.registrationService.getAdmissions({actor:f.users[0]});
  assert.equal((await f.app.handle(f.request(path,{method:'POST',headers,body:{expectedRevision:current.revision,archived:true}}))).status,200);
  const rows=(await read(f,headers)).value.rows;assert.equal(rows.length,1);assert.equal(rows[0].registrationId,registrationId);assert.equal(rows[0].contactId,null);
  assert.deepEqual(await f.app.registrationService.getAdmissions({actor:f.users[0]}),beforeAdmission);assert.equal(f.messages.length,0);
});

test('deletion-marked registration is excluded while its original record remains and its admission is revoked',async()=>{
  const f=await peopleRuntimeFixture({attendeeReviewRequired:false}),saved=await f.seedPublic({intake:'general-v2'}),id=saved.reference_code,headers=await f.login();
  const detail=await(await f.app.handle(f.request('/api/admin/registrations/'+id,{headers}))).json();
  const response=await f.app.handle(f.request('/api/admin/registrations/'+id+'/deletion-request',{method:'POST',headers,body:{expectedRevision:detail.revision,reason:'other'}}));assert.equal(response.status,200);
  assert.equal((await read(f,headers)).value.rows.length,0);const retained=await(await f.app.handle(f.request('/api/admin/registrations/'+id,{headers}))).json();assert.ok(retained.review.deletionRequested);
  assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).people.find(row=>row.registrationId===id).status,'withdrawn');assert.equal(f.messages.length,0);
});
