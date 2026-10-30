import test from 'node:test';
import assert from 'node:assert/strict';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';

async function json(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
async function saveOperations(f,id,changes,headers){
  const state=await f.app.contactsStore.read(),contact=state.contacts.find(row=>row.id===id);
  assert.ok(contact);
  return json(await f.app.handle(f.request('/api/admin/contacts/'+id,{method:'PUT',headers,
    body:{expectedRevision:state.revision,operations:{...contact.operations,...changes}}})));
}
async function contentWithRelations(f,contactId){
  const snapshot=await f.app.store.read(),content=structuredClone(snapshot.draft.content);
  content.organizations=[{id:'synthetic-organization-a',name:'合成参与组织甲',logoId:'',website:'https://example.org/synthetic',participation:'exhibitor',status:'confirmed',publicConsent:true,internalNotes:'PRIVATE_ORGANIZATION_NOTE'},
    {id:'synthetic-organization-b',name:'合成参与组织乙',logoId:'',website:'',participation:'attendee',status:'pending',publicConsent:false,internalNotes:''}];
  content.guests=[{id:'synthetic-linked-guest',name:'合成讲者',company:'原始机构文字',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,internalNotes:'PRIVATE_GUEST_NOTE',contactId,publicRoles:['speaker','guest']}];
  if(content.booths.length)content.booths[0].organizationId=content.organizations[0].id;
  await f.app.store.save(snapshot.draft.revision,content,f.users[0].id);
  return content;
}

test('a durable attending reply reserves the original common seat once, survives restart and sends one authorized confirmation email',async()=>{
  const f=await peopleRuntimeFixture({capacity:1,mail:true}),created=await f.createContact(),headers=await f.login();
  const first=await saveOperations(f,created.contact.id,{responseStatus:'attending'},headers);
  assert.equal(first.replySaved,true);assert.equal(first.contact.operations.responseStatus,'attending');
  assert.equal(first.admission.status,'confirmed');assert.match(first.admission.registrationId,/^[A-Za-z0-9_-]{43}$/u);
  const repeated=await saveOperations(f,created.contact.id,{notes:'合成后续沟通'},headers);
  assert.equal(repeated.admission.status,'confirmed');assert.equal(repeated.admission.registrationId,first.admission.registrationId);
  const restarted=f.make(),admissions=await restarted.registrationService.getAdmissions({actor:f.users[0]});
  assert.equal(admissions.summary.confirmedCount,1);assert.equal(admissions.people.length,1);
  assert.equal((await restarted.registrationService.repository.list()).registrations.length,1);
  const person=await json(await restarted.handle(f.request('/api/admin/people/contacts/'+created.contact.id,{headers})));
  assert.equal(person.linkage.registrationId,first.admission.registrationId);assert.equal(person.admission.status,'confirmed');
  assert.equal(f.messages.length,1,'explicit authorized attendance confirmation sends once');
  assert.match(f.messages[0].template_params.invitation_text,/Apple Wallet/u);
  assert.equal(f.messages[0].template_params.to_email,created.contact.profile.email);
  assert.doesNotMatch(JSON.stringify(first),/receiptToken|synthetic-private-key/u);
});

test('a public application cannot take an invited contact last seat before manual approval, while outreach-only replies remain unsynchronized',async()=>{
  const f=await peopleRuntimeFixture({capacity:1}),created=await f.createContact(),headers=await f.login();
  const pending=await f.seedPublic();assert.equal(pending.admissionStatus,'pending_review');
  const contact=await saveOperations(f,created.contact.id,{responseStatus:'attending'},headers);
  assert.equal(contact.admission.status,'confirmed');
  const approved=await f.approvePublic(pending.reference_code,{headers});
  assert.equal(approved.people.find(person=>person.registrationId===pending.reference_code).status,'waitlisted');
  const admissions=await f.app.registrationService.getAdmissions({actor:f.users[0]});
  assert.equal(admissions.summary.confirmedCount,1);assert.equal(admissions.people.length,2);
  assert.equal(admissions.people.filter(row=>row.status==='confirmed').length,1);
  assert.equal(admissions.people.filter(row=>row.status==='waitlisted').length,1);
  const repeated=await saveOperations(f,created.contact.id,{notes:'合成重开后跟进'},headers);
  assert.equal(repeated.admission.registrationId,contact.admission.registrationId);
  assert.equal((await f.app.registrationService.repository.list()).registrations.length,2);

  const other=await f.createContact(),outreach=await f.login('outreach');
  const reply=await saveOperations(f,other.contact.id,{responseStatus:'attending'},outreach);
  assert.equal(reply.replySaved,true);assert.equal(reply.admission.status,'requiresReviewer');
  assert.equal((await f.app.registrationService.repository.list()).registrations.length,2);
  assert.equal(f.messages.length,0);
});

test('explicit organization memberships join person and minimal directory views without claiming a seat or leaking source answers',async()=>{
  const f=await peopleRuntimeFixture(),first=await f.createContact(),second=await f.createContact({organization:'合成参与组织甲'}),headers=await f.login();
  const content=await contentWithRelations(f,first.contact.id);
  await saveOperations(f,first.contact.id,{organizationMemberships:[{organizationId:'synthetic-organization-a',role:'lead',title:'合成联络负责人'}]},headers);
  const start=f.objects.calls.length;
  const catalog=await json(await f.app.handle(f.request('/api/admin/people/relationships',{headers})));
  assert.equal(catalog.profiles[0].contactId,first.contact.id);assert.deepEqual(catalog.profiles[0].publicRoles,['speaker','guest']);
  assert.equal(f.objects.calls.slice(start).some(call=>/^cms\/v1\/contacts(?:\/|$)/u.test(call.key)),false,'the relationship catalog never reads the private roster');
  const members=await json(await f.app.handle(f.request('/api/admin/people/organizations/synthetic-organization-a/members',{headers})));
  assert.equal(members.total,1);assert.equal(members.members[0].contactId,first.contact.id);assert.equal(members.members[0].role,'lead');
  assert.equal(members.members.some(row=>row.contactId===second.contact.id),false,'free-text employer names never establish membership');
  const person=await json(await f.app.handle(f.request('/api/admin/people/contacts/'+first.contact.id,{headers})));
  assert.equal(person.availability.organizations,'available');assert.equal(person.organizations.memberships[0].organizationId,'synthetic-organization-a');
  assert.equal(person.organizations.memberships[0].name,'合成参与组织甲');
  assert.doesNotMatch(JSON.stringify({catalog,members,organizations:person.organizations}),/PRIVATE_ORGANIZATION_NOTE|PRIVATE_GUEST_NOTE|SYNTHETIC_ORIGINAL_PEOPLE_ANSWER|@example\.invalid|wechat|phone/u);
  assert.equal((await f.app.registrationService.repository.list()).registrations.length,0,'membership is not attendance or admission');
  await f.app.store.publish(1,f.users[0].id);
  const publicContent=await json(await f.app.handle(f.request('/api/public/content',{origin:'https://artdico.host'})));
  assert.doesNotMatch(JSON.stringify(publicContent),/organizationMemberships|contactId|organizationId|PRIVATE_ORGANIZATION_NOTE|PRIVATE_GUEST_NOTE/u);
  assert.equal(content.organizations.length,2);
});

test('private relationship reads and guest identity edits enforce complete role gates and preserve omitted legacy links',async()=>{
  const f=await peopleRuntimeFixture(),first=await f.createContact(),second=await f.createContact();
  await contentWithRelations(f,first.contact.id);
  assert.equal((await f.app.handle(f.request('/api/admin/people/relationships'))).status,401);
  for(const username of ['editor','reviewer']){
    const headers=await f.login(username),start=f.objects.calls.length;
    assert.equal((await f.app.handle(f.request('/api/admin/people/relationships',{headers}))).status,403);
    assert.equal((await f.app.handle(f.request('/api/admin/people/organizations/synthetic-organization-a/members',{headers}))).status,403);
    assert.equal(f.objects.calls.slice(start).some(call=>/^cms\/v1\/(?:contacts|content)(?:\/|$)/u.test(call.key)),false);
  }
  const outreach=await f.login('outreach'),before=f.objects.calls.length;
  assert.equal((await f.app.handle(f.request('/api/admin/people/candidates',{headers:outreach}))).status,403);
  assert.equal(f.objects.calls.slice(before).some(call=>/^cms\/v1\/contacts(?:\/|$)/u.test(call.key)),false);
  const editor=await f.login('editor'),snapshot=await f.app.store.read(),legacy=structuredClone(snapshot.draft.content);
  delete legacy.guests[0].contactId;
  const start=f.objects.calls.length;
  await json(await f.app.handle(f.request('/api/admin/content',{method:'PUT',headers:editor,body:{expectedRevision:snapshot.draft.revision,content:legacy}})));
  assert.equal(f.objects.calls.slice(start).some(call=>/^cms\/v1\/contacts(?:\/|$)/u.test(call.key)),false,'ordinary editor changes do not load private names');
  const saved=await f.app.store.read();assert.equal(saved.draft.content.guests[0].contactId,first.contact.id);
  const changed=structuredClone(saved.draft.content);changed.guests[0].contactId=second.contact.id;
  const deniedStart=f.objects.calls.length;
  assert.equal((await f.app.handle(f.request('/api/admin/content',{method:'PUT',headers:editor,body:{expectedRevision:saved.draft.revision,content:changed}}))).status,403);
  assert.equal(f.objects.calls.slice(deniedStart).some(call=>/^cms\/v1\/contacts(?:\/|$)/u.test(call.key)),false);
  assert.equal((await f.app.store.read()).draft.revision,saved.draft.revision);
});
