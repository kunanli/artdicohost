import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';
const op=()=>randomBytes(24).toString('base64url');
async function body(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
async function request(f,headers,input,status=200){return body(await f.app.handle(f.request('/api/admin/people/resolve',{headers,method:'POST',body:input})),status);}
async function preview(f,headers,keys){return request(f,headers,{action:'preview',keys});}
const write=(p,action='merge')=>({action,keys:p.keys,primaryKey:p.primaryKey,roles:p.roles,expectedRevision:p.expectedRevision,expectedContactRevision:p.expectedContactRevision,operationId:op(),...(action==='merge'?{confirmSamePerson:true}:{})});
async function convert(f,contacts){return f.app.intentService.convertContacts({actor:f.users[0],contactIds:contacts.map(c=>c.id),expectedContactRevision:(await f.app.contactsStore.read()).revision,permissionReference:'合成明确授权代登记'});}

test('duplicate detection is read only, shared addresses are candidates rather than automatic identity, and explicit source links are not duplicates',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact({name:'合成甲',email:'shared@example.invalid'})).contact,b=(await f.createContact({name:'合成乙',email:'shared@example.invalid'})).contact,headers=await f.login();
 await convert(f,[a]);const before=f.objects.calls.length;
 const value=await body(await f.app.handle(f.request('/api/admin/people/duplicates',{headers})));
 assert.equal(value.candidates.length,1);assert.deepEqual(new Set(value.candidates[0].keys),new Set(['contact:'+a.id,'contact:'+b.id]));assert.match(value.candidates[0].reasons.join(),/邮箱/u);
 assert.ok(f.objects.calls.slice(before).every(call=>call.operation==='get'));assert.equal((await f.app.contactsStore.read()).contacts.length,2);assert.equal(f.messages.length,0);
 assert.doesNotMatch(JSON.stringify(value),/shared@example|SYNTHETIC_ORIGINAL|wechat/u);
});

test('confirmed duplicates merge in the same admission CAS, preserve sources, revoke old tickets, and replay without releasing twice',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),a=(await f.createContact({name:'合成重复人员',email:'same@example.invalid'})).contact,b=(await f.createContact({name:'合成重复人员',email:'same@example.invalid'})).contact,headers=await f.login();
 const converted=await convert(f,[a,b]);assert.equal(converted.registrations.length,2);const original=await f.app.contactsStore.read(),keys=['contact:'+a.id,'contact:'+b.id];
 const p=await preview(f,headers,keys);assert.equal(p.confirmedCount,2);assert.equal(p.rows.length,4);
 const input=write(p),saved=await request(f,headers,input);assert.equal(saved.outcome,'updated');assert.equal(saved.releasedCount,1);assert.equal(saved.person.registrationIds.length,2);
 const admissions=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.equal(admissions.summary.confirmedCount,1);assert.equal(admissions.summary.withdrawnCount,1);
 assert.deepEqual(await f.app.contactsStore.read(),original,'all original contact sources and notes survive byte-equivalent');assert.equal((await f.app.registrationService.repository.list()).registrations.length,2);
 const alias=saved.person.registrationIds.find(id=>id!==saved.person.primaryRegistrationId);assert.equal((await f.app.registrationService.getAdmissionStatus(alias)).status,'withdrawn');
 const replay=await request(f,headers,input);assert.equal(replay.outcome,'replayed');assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,1);
 const repeated=await convert(f,[a,b]);assert.equal(repeated.registrations.length,2);assert.ok(repeated.registrations.every(r=>r.registrationId===saved.person.primaryRegistrationId));assert.equal(f.messages.length,0);
 assert.equal((await f.app.registrationService.repository.list()).registrations.length,2,'converting a duplicate source never creates a third registration');
});

test('public application and old intent explicitly link without approving the application or inventing website consent',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact({name:'合成同一人',email:'person@example.invalid'})).contact,pending=await f.seedPublic({name:'合成同一人',email:'person@example.invalid'}),headers=await f.login();
 const p=await preview(f,headers,['contact:'+a.id,'registration:'+pending.reference_code]);const saved=await request(f,headers,write(p));
 assert.equal(saved.registrationId,pending.reference_code);assert.equal((await f.app.registrationService.getAdmissionStatus(pending.reference_code)).status,'pending_review');
 const converted=await convert(f,[a]);assert.equal(converted.registrations[0].registrationId,pending.reference_code);assert.equal((await f.app.registrationService.repository.list()).registrations.length,1);
 const record=(await f.app.registrationService.repository.list()).registrations[0];assert.equal(record.provenance.kind,'public');assert.equal(record.consent.accepted,true);
});

test('unregistered duplicate sources reserve one identity first and concurrent conversion takes only one last seat',async()=>{
 const f=await peopleRuntimeFixture({capacity:1}),a=(await f.createContact({email:'same@example.invalid'})).contact,b=(await f.createContact({email:'same@example.invalid'})).contact,headers=await f.login();
 const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]);assert.equal(p.rows.length,2);const saved=await request(f,headers,write(p));assert.equal(saved.person.primaryRegistrationId,null);
 await Promise.all([convert(f,[a]),convert(f,[b])]);const admissions=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.equal(admissions.people.length,1);assert.equal(admissions.summary.confirmedCount,1);
 const ra=await f.app.registrationService.getStaffRegistrationBySource({actor:f.users[0],sourceContactId:a.id}),rb=await f.app.registrationService.getStaffRegistrationBySource({actor:f.users[0],sourceContactId:b.id});assert.equal(ra.receipt.registrationId,rb.receipt.registrationId);
});

test('classification alone occupies no seat, sends no mail and one person can be both speaker and invited guest',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),a=(await f.createContact()).contact,headers=await f.login(),p=await preview(f,headers,['contact:'+a.id]);
 const value=write(p,'roles');value.roles=['speaker','guest'];const saved=await request(f,headers,value);assert.deepEqual(saved.person.roles,['guest','speaker']);
 assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,0);assert.equal((await f.app.contactsStore.read()).contacts[0].operations.participationForms.length,0);assert.equal(f.messages.length,0);
});

test('resolution gates authentication, complete roles, CSRF and stale previews before writing or exposing source details',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,owner=await f.login(),keys=['contact:'+a.id];
 for(const username of ['reviewer','outreach','combined','editor']){const headers=await f.login(username),before=f.objects.calls.length;await request(f,headers,{action:'preview',keys},403);assert.equal(f.objects.calls.slice(before).some(call=>/^cms\/v1\/(?:contacts|registrations)\//u.test(call.key)),false);}
 await request(f,{Cookie:owner.Cookie},{action:'preview',keys},403);
 const p=await preview(f,owner,keys),input=write(p,'roles');await f.createContact();await request(f,owner,input,409);assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).personGroups,undefined);
});

async function directory(f,headers,view='all'){
 const {validatePeopleDirectory}=await import('../src/lib/people-directory.mjs');const value=await body(await f.app.handle(f.request('/api/admin/people/directory?view='+view,{headers})));assert.equal(validatePeopleDirectory(value,view),true);return value;
}
test('merged sources appear once across directories and exhibitor company membership, with original sources still inspectable',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact({name:'合成主资料'})).contact,b=(await f.createContact({name:'合成旧资料'})).contact,headers=await f.login();await convert(f,[a,b]);
 const planning=await f.app.store.read(),content=structuredClone(planning.draft.content);content.organizations=[{id:'synthetic-team',name:'合成参展团队',logoId:'',website:'',participation:'exhibitor',status:'confirmed',publicConsent:false,internalNotes:''}];await f.app.store.save(planning.draft.revision,content,f.users[0].id);
 for(const item of [a,b]){const roster=await f.app.contactsStore.read();await f.app.contactsStore.saveOperations(item.id,roster.revision,{...item.operations,organizationMemberships:[{organizationId:'synthetic-team',role:item.id===a.id?'lead':'member',title:''}]},f.users[0].id);}
 const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]),input=write(p);input.primaryKey='contact:'+a.id;input.roles=['speaker','guest'];await request(f,headers,input);
 const all=await directory(f,headers);assert.equal(all.rows.length,1);assert.equal(all.rows[0].name,a.profile.name);assert.equal(all.rows[0].sourceCount,4);assert.deepEqual(all.rows[0].roles,['guest','speaker']);
 for(const view of ['speakers','guests'])assert.equal((await directory(f,headers,view)).rows.length,1);
 const team=(await directory(f,headers,'exhibitors')).rows[0];assert.equal(team.memberTotal,1);assert.equal(team.members[0].id,a.id);assert.equal(team.members[0].role,'lead');
 assert.equal((await directory(f,headers,'unassigned')).rows.length,0);assert.equal((await directory(f,await f.login('outreach'))).rows.length,1);
 const p2=await preview(f,headers,['contact:'+b.id]);assert.equal(p2.rows.length,4);assert.equal(p2.primaryKey,'contact:'+a.id);
 assert.doesNotMatch(JSON.stringify(all),/@example.invalid|contactConsent|SYNTHETIC_ORIGINAL/u);
});
test('classification splits unassigned intent and general participants without granting roles to review-only readers',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,pub=await f.seedPublic(),headers=await f.login();
 assert.equal((await directory(f,headers,'unassigned')).rows.length,1);assert.equal((await directory(f,headers,'attendees')).rows.length,1);
 const p=await preview(f,headers,['registration:'+pub.reference_code]),input=write(p,'roles');input.roles=['guest'];await request(f,headers,input);
 assert.equal((await directory(f,headers,'attendees')).rows.length,0);assert.equal((await directory(f,headers,'guests')).rows.length,1);
 const review=await directory(f,await f.login('reviewer'));assert.deepEqual(review.rows[0].roles,[]);assert.equal(review.summary.attendees,null);assert.equal(review.rows[0].contactId,null);
 assert.equal((await f.app.registrationService.getAdmissionStatus(pub.reference_code)).status,'pending_review');assert.equal((await preview(f,headers,['contact:'+a.id])).roles.length,0);
});
test('preview opened by a native staff registration includes its original contact in the canonical identity',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,headers=await f.login(),converted=await convert(f,[a]),id=converted.registrations[0].registrationId;
 const p=await preview(f,headers,['registration:'+id]);assert.deepEqual(p.keys,['contact:'+a.id]);assert.equal(p.rows.length,2);
 const input=write(p,'roles');input.roles=['attendee'];await request(f,headers,input);
 const all=await directory(f,headers);assert.equal(all.rows.length,1);assert.equal(all.rows[0].contactId,a.id);assert.equal(all.rows[0].registrationId,id);
});
test('lost merge acknowledgement replays the original operation even after a contact change and cannot release a seat twice',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,b=(await f.createContact()).contact,headers=await f.login();await convert(f,[a,b]);const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]),input=write(p);
 const append=f.objects.append;let lost=false;f.objects.append=async(...args)=>{const result=await append(...args);if(!lost){lost=true;throw new Error('SYNTHETIC_LOST_MERGE_ACK');}return result;};
 await request(f,headers,input,503);assert.equal(lost,true);await f.createContact();const replay=await request(f,headers,input);assert.equal(replay.outcome,'replayed');assert.equal(replay.releasedCount,1);
 assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,1);
 assert.equal((await request(f,headers,{...input,roles:['speaker']},409)).error.code,'SOURCE_CHANGED');
});
test('merge racing a new conversion fails closed or converges on the same single admitted identity',async()=>{
 const f=await peopleRuntimeFixture({capacity:2}),a=(await f.createContact()).contact,b=(await f.createContact()).contact,headers=await f.login();await convert(f,[a]);const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]);
 const [response]=await Promise.all([f.app.handle(f.request('/api/admin/people/resolve',{headers,method:'POST',body:write(p)})),convert(f,[b])]);assert.ok([200,409].includes(response.status));
 if(response.status===409)await request(f,headers,write(await preview(f,headers,p.keys)));
 await convert(f,[a,b]);assert.equal((await directory(f,headers)).rows.length,1);assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,1);
});
test('a retired duplicate ticket cannot be approved again, and merging withdrawn people never revives them',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,b=(await f.createContact()).contact,headers=await f.login();const converted=await convert(f,[a,b]);
 for(const item of converted.registrations){const current=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.equal((await f.app.registrationService.withdrawAdmission({actor:f.users[0],registrationId:item.registrationId,expectedRevision:current.revision,operationId:op()})).outcome,'updated');}
 const merged=await request(f,headers,write(await preview(f,headers,['contact:'+a.id,'contact:'+b.id])));assert.equal(merged.releasedCount,0);await convert(f,[a,b]);assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,0);
 const alias=merged.person.registrationIds.find(id=>id!==merged.person.primaryRegistrationId),current=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.equal((await f.app.registrationService.approveApplication({actor:f.users[0],registrationId:alias,expectedRevision:current.revision,operationId:op()})).outcome,'conflict');
});
test('explicit non-contact permission cannot be inherited from another merged source and a current decline blocks delivery',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),a=(await f.createContact({contactConsent:'unknown'})).contact,b=(await f.createContact()).contact,headers=await f.login();await convert(f,[a,b]);
 const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]),input=write(p);
 const records=(await f.app.registrationService.repository.list()).registrations,primary=records.find(record=>record.provenance.sourceContactId===a.id);input.primaryKey='registration:'+primary.id;await request(f,headers,input);
 let state=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:primary.id});assert.equal(state.ready,false);assert.equal(state.reason,'CONTACT_CONSENT_REQUIRED');
 const later=await f.app.contactsStore.read(),other=later.contacts.find(row=>row.id===b.id);await f.app.contactsStore.saveOperations(b.id,later.revision,{...other.operations,responseStatus:'declined'},f.users[0].id);
 state=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:primary.id});assert.equal(state.ready,false);assert.equal(state.reason,'CONTACT_DECLINED');assert.equal(f.messages.length,0);
});

test('canonical identity survives a runtime restart and public-source person workspace loads only the explicit contact',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,pub=await f.seedPublic({name:a.profile.name,email:a.profile.email}),headers=await f.login();
 const saved=await request(f,headers,write(await preview(f,headers,['contact:'+a.id,'registration:'+pub.reference_code]))),restarted=f.make();
 const value=await body(await restarted.handle(f.request('/api/admin/people/directory',{headers})));assert.equal(value.rows.length,1);assert.equal(value.rows[0].registrationId,pub.reference_code);
 const person=await body(await restarted.handle(f.request('/api/admin/people/registrations/'+pub.reference_code,{headers})));assert.equal(person.linkage.state,'linked');assert.equal(person.contact.id,a.id);assert.equal(person.registration.id,pub.reference_code);
 const recovered=await restarted.registrationService.getStaffRegistrationBySource({actor:f.users[0],sourceContactId:a.id});assert.equal(recovered.receipt.registrationId,saved.registrationId);assert.equal(recovered.receipt.admissionStatus,'pending_review');
});
test('selecting a lower-status primary cannot silently discard an already confirmed place',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,headers=await f.login();await convert(f,[a]);const pub=await f.seedPublic(),p=await preview(f,headers,['contact:'+a.id,'registration:'+pub.reference_code]),input=write(p);input.primaryKey='registration:'+pub.reference_code;
 await request(f,headers,input,409);assert.equal((await f.app.registrationService.getAdmissions({actor:f.users[0]})).summary.confirmedCount,1);assert.equal((await directory(f,headers)).rows.length,2);assert.equal(f.messages.length,0);
});

test('a decline on a merged alias also blocks legacy invitation preparation for the primary source',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,b=(await f.createContact()).contact,headers=await f.login();await convert(f,[a,b]);
 const p=await preview(f,headers,['contact:'+a.id,'contact:'+b.id]),input=write(p);input.primaryKey='contact:'+a.id;const merged=await request(f,headers,input);
 const ready=await f.app.intentService.previewInvitations({actor:f.users[0],contactIds:[a.id],expectedContactRevision:2});assert.equal(ready.entries[0].eligible,true);
 const roster=await f.app.contactsStore.read(),other=roster.contacts.find(row=>row.id===b.id);const saved=await f.app.contactsStore.saveOperations(b.id,roster.revision,{...other.operations,responseStatus:'declined'},f.users[0].id);
 const denied=await f.app.intentService.previewInvitations({actor:f.users[0],contactIds:[a.id],expectedContactRevision:saved.revision});assert.equal(denied.entries[0].eligible,false);assert.equal(denied.entries[0].reason,'CONTACT_DECLINED');
 await assert.rejects(f.app.intentService.issueInvitation({actor:f.users[0],contactId:a.id,expectedContactRevision:saved.revision,expectedRegistrationId:merged.registrationId,channel:'manual'}),{code:'CONTACT_DECLINED'});assert.equal(f.messages.length,0);
});

test('canonical metadata preserves outreach and review-only boundaries outside the combined directory',async()=>{
 const f=await peopleRuntimeFixture(),a=(await f.createContact()).contact,headers=await f.login();await convert(f,[a]);const p=await preview(f,headers,['contact:'+a.id]),input=write(p,'roles');input.roles=['speaker','guest'];await request(f,headers,input);
 const outreach=await f.app.intentService.read({actor:f.users.find(user=>user.username==='outreach')});assert.equal(outreach.personGroups.length,1);assert.equal(outreach.personGroups[0].admissionStatus,null);
 const review=await f.app.registrationService.getAdmissions({actor:f.users.find(user=>user.username==='reviewer')});assert.equal(review.personGroups.length,1);assert.equal(review.personGroups[0].roles,null);assert.deepEqual(review.personGroups[0].contactIds,[]);assert.equal(review.personGroups[0].primaryContactId,null);assert.ok(review.personGroups[0].primaryKey.startsWith('registration:'));
 const owner=await f.app.registrationService.getAdmissions({actor:f.users[0]});assert.deepEqual(owner.personGroups[0].roles,['guest','speaker']);
});
