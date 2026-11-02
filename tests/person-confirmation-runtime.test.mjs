import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';
import {EDITABLE_CONTACT_FIELDS,EDITABLE_CONTACT_ARRAY_FIELDS} from '../shared/contact-editor.mjs';
import {createRegistrationConfirmationService} from '../functions/registration-confirmation/service.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
import {personNextAction,personWorkspaceView} from '../src/lib/person-workspace.mjs';
import {validPersonConfirmation} from '../src/lib/person-confirmation.mjs';
const operation=()=>randomBytes(24).toString('base64url');
async function response(value,status=200){assert.equal(value.status,status);return value.json();}
async function reply(f,contactId,changes,headers){const roster=await f.app.contactsStore.read(),contact=roster.contacts.find(item=>item.id===contactId);
 return response(await f.app.handle(f.request('/api/admin/contacts/'+contactId,{method:'PUT',headers,body:{expectedRevision:roster.revision,operations:{...contact.operations,...changes}}})));}
async function delivery(f,id,headers){const value=await response(await f.app.handle(f.request('/api/admin/registration-confirmation/delivery/'+id,{headers})));
 assert.equal(validPersonConfirmation(value,id),true);return value;}
async function send(f,id,headers,state,operationId=operation()){const body={expectedRevision:state.revision,operationId,retryRejected:state.retryRejected,...(state.accessRevision===undefined?{}:{expectedAccessRevision:state.accessRevision})};
 const value=await response(await f.app.handle(f.request('/api/admin/registration-confirmation/send/'+id,{headers,method:'POST',body})));return {value,body};}

test('explicit confirmed contact decision sends one private Wallet confirmation, while reads and later edits do not resend',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),contact=(await f.createContact()).contact;
 const saved=await reply(f,contact.id,{responseStatus:'attending'},headers),id=saved.admission.registrationId;
 assert.equal(saved.admission.status,'confirmed');assert.deepEqual(saved.admission.confirmationEmail,{status:'completed'});assert.equal(f.messages.length,1);
 const message=f.messages[0].template_params;assert.equal(message.to_email,contact.profile.email);assert.match(message.invitation_text,/https:\/\/artdico\.host\/registration\/confirmation\/#r=c1\./u);assert.match(message.invitation_text,/Apple Wallet/u);
 assert.doesNotMatch(JSON.stringify(saved),/receiptToken|confirmationUrl|synthetic-private-key/u);
 const start=f.objects.calls.length,state=await delivery(f,id,headers);assert.equal(state.reason,'ALREADY_ACCEPTED');assert.equal(state.ready,false);
 assert.ok(f.objects.calls.slice(start).every(call=>call.operation==='get'),'read state never reserves or writes');
 await reply(f,contact.id,{notes:'合成后续备注'},headers);await send(f,id,headers,state);assert.equal(f.messages.length,1);
});

test('historical conversion stays read-only until one explicit authorized dispatch and replays the original operation without resend',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),contact=(await f.createContact()).contact;
 const roster=await f.app.contactsStore.read();await f.app.contactsStore.saveOperations(contact.id,roster.revision,{...contact.operations,responseStatus:'attending'},f.users[0].id);
 const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:roster.revision+1,permissionReference:'合成历史本人确认出席授权'}),id=converted.registrations[0].registrationId;
 let state=await delivery(f,id,headers);assert.equal(state.ready,true);assert.equal(state.status,'not_sent');assert.equal(f.messages.length,0);
 const sent=await send(f,id,headers,state);assert.equal(sent.value.results[0].status,'provider_accepted');assert.equal(f.messages.length,1);
 const replay=await response(await f.app.handle(f.request('/api/admin/registration-confirmation/send/'+id,{headers,method:'POST',body:sent.body})));
 assert.equal(replay.outcome,'replayed');assert.equal(f.messages.length,1);state=await delivery(f,id,headers);assert.equal(state.ready,false);
});

test('unverified consent and missing email retain saved seats and explain the delivery block without mail',async()=>{
 for(const [profile,reason]of [[{contactConsent:'unknown'},'CONTACT_CONSENT_REQUIRED'],[{email:'',wechat:'synthetic_wechat_only'},'EMAIL_MISSING']]){
  const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),contact=(await f.createContact(profile)).contact;
  const saved=await reply(f,contact.id,{responseStatus:'attending'},headers);assert.equal(saved.admission.status,'confirmed');assert.equal(f.messages.length,0);
  const state=await delivery(f,saved.admission.registrationId,headers);assert.equal(state.reason,reason);assert.equal(state.ready,false);
  await send(f,saved.admission.registrationId,headers,state);assert.equal(f.messages.length,0);
 }
});

test('an unknown provider ACK remains visible after restart and is never retried by later decisions or explicit dispatch',async()=>{
 const f=await peopleRuntimeFixture({mail:true,mailResult:'unknown'}),headers=await f.login(),contact=(await f.createContact()).contact;
 const saved=await reply(f,contact.id,{responseStatus:'attending'},headers),id=saved.admission.registrationId;assert.equal(f.messages.length,1);
 const restarted=f.make();const state=await restarted.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id});assert.equal(state.reason,'DELIVERY_UNKNOWN');assert.equal(state.ready,false);
 await reply(f,contact.id,{notes:'合成核对未知寄送'},headers);await send(f,id,headers,state);assert.equal(f.messages.length,1);
});

test('current consent/address/attendance is rechecked on manual delivery and cannot be bypassed by a stale ready state',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),contact=(await f.createContact()).contact;
 const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:1,permissionReference:'合成本次确认授权'}),id=converted.registrations[0].registrationId;
 const state=await delivery(f,id,headers);assert.equal(state.ready,true);
 const roster=await f.app.contactsStore.read();await f.app.contactsStore.saveProfile(contact.id,roster.revision,{...Object.fromEntries([...EDITABLE_CONTACT_FIELDS,...EDITABLE_CONTACT_ARRAY_FIELDS].map(key=>[key,contact.profile[key]])),email:'synthetic.changed@example.invalid'},f.users[0].id);
 await send(f,id,headers,state);assert.equal(f.messages.length,0);assert.equal((await delivery(f,id,headers)).reason,'CONTACT_EMAIL_CHANGED');
});

test('delivery routes enforce authentication, origin, complete roles and CSRF before private data access',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),owner=await f.login(),pending=await f.seedPublic();const id=pending.reference_code,path='/api/admin/registration-confirmation/send/'+id;
 for(const username of ['reviewer','outreach','combined','editor']){const headers=await f.login(username),start=f.objects.calls.length;
  assert.equal((await f.app.handle(f.request(path,{method:'POST',headers,body:{expectedRevision:0,operationId:operation()}}))).status,403);
  assert.ok(f.objects.calls.slice(start).every(call=>!/^cms\/v1\/(?:registrations|registration-confirmations)\//u.test(call.key)));
 }
 const state=await delivery(f,id,owner);assert.equal(state.reason,'ADMISSION_NOT_CONFIRMED');const before=f.objects.calls.length;
 assert.equal((await f.app.handle(f.request(path,{method:'POST',headers:{Cookie:owner.Cookie},body:{expectedRevision:state.revision,operationId:operation()}}))).status,403);
 assert.ok(f.objects.calls.slice(before).every(call=>!call.key.startsWith('cms/v1/registration-confirmations/')));assert.equal(f.messages.length,1,'denied staff actions never add mail after the public receipt');
 assert.match(f.messages[0].template_params.invitation_text,/申请已收到|申请已经收到/u);assert.doesNotMatch(f.messages[0].template_params.invitation_text,/Apple Wallet|名额已确认/u);
});

test('public receipts stay independent of the one formal notice after approval and a newly confirmed staff entry',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),pending=await f.seedPublic();assert.equal(f.messages.length,1);
 assert.match(f.messages[0].template_params.invitation_text,/申请已收到|申请已经收到/u);assert.doesNotMatch(f.messages[0].template_params.invitation_text,/Apple Wallet|名额已确认/u);
 await f.approvePublic(pending.reference_code,{headers});assert.equal(f.messages.length,2);assert.match(f.messages[1].template_params.invitation_text,/Apple Wallet/u);
 const body={expectedRevision:(await f.app.registrationService.getAdmissions({actor:f.users[0]})).revision,operationId:operation(),input:{kind:'attendee',permissionReference:'合成人员明确授权代登记并发送参会确认',fields:{name:'合成工作人员代登记',email:'synthetic.staff@example.invalid',organization:'合成单位',city:'合成城市',position:'',categories:['industry'],participationInterests:['attend'],background:'',attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'}}};
 const first=await response(await f.app.handle(f.request('/api/admin/admissions/staff',{method:'POST',headers,body})));assert.equal(first.receipt.admissionStatus,'confirmed');assert.equal(f.messages.length,3);
 await response(await f.app.handle(f.request('/api/admin/admissions/staff',{method:'POST',headers,body})));assert.equal(f.messages.length,3);
 const state=await delivery(f,first.registrationId,headers);assert.equal(state.reason,'ALREADY_ACCEPTED');
});


test('review-only delivery state never loads contact permissions or provider configuration',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),contact=(await f.createContact()).contact;
 const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:1,permissionReference:'合成明确授权'}),id=converted.registrations[0].registrationId;
 let permissionReads=0,configurationReads=0;
 const service=createRegistrationConfirmationService({registrationService:f.app.registrationService,journalFor:prefix=>createObjectJournal({objects:f.objects,prefix}),tokenSecret:'synthetic-people-registration-token-secret-123456',clock:()=>Date.parse('2026-10-21T09:00:00Z'),
  staffDeliveryPermission:async()=>{permissionReads++;throw new Error('Review reader cannot load contacts');},emailProvider:{readiness:async()=>{configurationReads++;throw new Error('Review reader cannot load provider keys');},send:async()=>{throw new Error('No send');}}});
 const actor=f.users.find(item=>item.username==='reviewer'),state=await service.staffDeliveryState({actor,registrationId:id});
 assert.equal(state.canSend,false);assert.equal(state.ready,false);assert.equal(state.reason,'OPERATOR_PERMISSION_REQUIRED');assert.equal(validPersonConfirmation(state,id),true);
 assert.equal(permissionReads,0);assert.equal(configurationReads,0);assert.equal(f.messages.length,0);
 const headers=await f.login('reviewer'),before=f.objects.calls.length;
 const actual=await delivery(f,id,headers);assert.equal(actual.reason,'OPERATOR_PERMISSION_REQUIRED');assert.equal(actual.ready,false);
 assert.equal(f.objects.calls.slice(before).some(call=>call.key.startsWith('cms/v1/contacts/')||call.key.startsWith('cms/v1/delivery-config/')),false);
});

async function correctRegistration(f,id,changes,headers){
 const detail=await f.app.reviewStore.detail(id),fields={...Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??''])),...changes};
 const body={expectedRevision:detail.revision,operationId:operation(),fields};
 const saved=await response(await f.app.handle(f.request('/api/admin/registrations/'+id+'/profile',{method:'PATCH',headers,body})));
 return {saved,body};
}
test('corrected registration profile feeds current person/private/export and one explicit new-recipient notice while originals and old journal stay immutable',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),pending=await f.seedPublic(),id=pending.reference_code;
 await f.approvePublic(id,{headers});const originalIndex=(await f.app.registrationService.repository.readIndex()).value,entry=originalIndex.entries.find(row=>row.id===id),original=await f.app.registrationService.repository.readRecord(entry),oldToken=pending.confirmation.receiptToken;
 assert.equal(f.messages.length,2);const oldFormal=f.messages[1].template_params;
 const {saved}=await correctRegistration(f,id,{name:'更正后的合成姓名',email:'corrected.runtime@example.invalid',organization:'更正单位',position:'更正职务',phone:'123'},headers);
 assert.equal(saved.accessRevision,1);assert.equal(f.messages.length,2);assert.deepEqual(await f.app.registrationService.repository.readRecord(entry),original);
 const after=(await f.app.registrationService.repository.readIndex()).value;assert.deepEqual(after,originalIndex,'correction never changes seats, original hashes or source provenance');
 await assert.rejects(f.app.confirmationService.confirmation({receiptToken:oldToken}),e=>e.code==='CONFIRMATION_NOT_FOUND');
 const link=await f.app.confirmationService.staffConfirmationLink({actor:f.users[0],registrationId:id});assert.equal(link.ready,true);
 const privatePage=await f.app.confirmationService.confirmation({receiptToken:link.receiptToken});assert.equal(privatePage.attendee.name,saved.fields.name);assert.equal(privatePage.attendee.organization,'更正单位');assert.equal(privatePage.email.status,'pending');
 const person=await response(await f.app.handle(f.request('/api/admin/people/registrations/'+id,{headers})));assert.equal(person.person.name,saved.fields.name);assert.equal(person.registration.fields.phone,'123');assert.equal(person.registration.profileTargetId,id);assert.equal(person.communications.confirmations[0].currentRecipient,false);assert.equal(personNextAction(person,f.users[0].roles).key,'notification');
 const malformed=structuredClone(person);malformed.communications.confirmations[0].currentRecipient='false';assert.equal(personWorkspaceView(malformed,malformed.selected),null);
 const omitted=structuredClone(person);for(const row of [...omitted.communications.confirmations,...omitted.communications.timeline])delete row.currentRecipient;assert.equal(personNextAction(omitted,f.users[0].roles).key,'notification','missing optional history scope cannot count as current delivery after an email correction');
 const directory=await response(await f.app.handle(f.request('/api/admin/people/directory',{headers})));assert.equal(directory.rows.find(row=>row.registrationId===id).name,saved.fields.name);
 const current=await delivery(f,id,headers);assert.equal(current.status,'not_sent');assert.equal(current.ready,true);assert.equal(current.recipient,saved.fields.email);
 assert.equal((await f.app.confirmationService.staffHistory({actor:f.users[0],registrationId:id})).notices[0].status,'provider_accepted');
 assert.equal(oldFormal.to_email,original.fields.email);assert.notEqual(oldFormal.to_email,current.recipient);
 const sent=await send(f,id,headers,current);assert.equal(sent.value.results[0].status,'provider_accepted');assert.equal(f.messages.length,3);assert.equal(f.messages[2].template_params.to_email,current.recipient);const updatedPerson=await response(await f.app.handle(f.request('/api/admin/people/registrations/'+id,{headers})));assert.equal(updatedPerson.communications.confirmations.filter(row=>row.currentRecipient).length,1);assert.equal(updatedPerson.communications.confirmations.filter(row=>!row.currentRecipient).length,1);
 await response(await f.app.handle(f.request('/api/admin/registration-confirmation/send/'+id,{method:'POST',headers,body:sent.body})));assert.equal(f.messages.length,3);
 const second=await correctRegistration(f,id,{name:'只更正姓名'},headers);assert.equal(second.saved.accessRevision,1);assert.equal((await delivery(f,id,headers)).reason,'ALREADY_ACCEPTED');assert.equal(f.messages.length,3);
 const receipt={committed:true,eventId:original.eventId,registrationId:id,referenceCode:id,committedAt:entry.committedAt,admissionStatus:'confirmed',admissionKind:'attendee',admissionRevision:after.revision};
 const replay=await f.app.confirmationService.forSavedReceipt({receipt,notify:false});assert.equal(replay.receiptToken,oldToken,'old public receipts never upgrade to the corrected capability');
 await assert.rejects(f.app.confirmationService.authorize({receiptToken:replay.receiptToken}),e=>e.code==='CONFIRMATION_NOT_FOUND');
});

test('old-recipient unknown delivery remains historical and blocks new sends without falsely marking corrected address sent',async()=>{
 const f=await peopleRuntimeFixture({mail:true,mailResult:message=>message.template_params.invitation_text.includes('Apple Wallet')?'unknown':'accepted'}),headers=await f.login(),pending=await f.seedPublic(),id=pending.reference_code;
 await f.approvePublic(id,{headers});assert.equal(f.messages.length,2);
 await correctRegistration(f,id,{email:'unknown.corrected@example.invalid'},headers);
 const state=await delivery(f,id,headers);assert.equal(state.status,'not_sent');assert.equal(state.reason,'HISTORICAL_DELIVERY_UNKNOWN');assert.equal(state.ready,false);
 await send(f,id,headers,state);assert.equal(f.messages.length,2);assert.equal((await delivery(f,id,headers)).status,'not_sent');
});

test('an email correction while provider ACK is pending cannot turn the old attempt into new-recipient sent history',async()=>{
 let release,started;const began=new Promise(resolve=>{started=resolve;});
 const f=await peopleRuntimeFixture({mail:true,mailResult:async message=>{if(message.template_params.invitation_text.includes('Apple Wallet')){started();return new Promise(resolve=>{release=resolve;});}return 'accepted';}}),headers=await f.login(),pending=await f.seedPublic(),id=pending.reference_code;
 const approving=f.approvePublic(id,{headers});await began;
 await correctRegistration(f,id,{email:'late.ack@example.invalid'},headers);assert.equal((await delivery(f,id,headers)).reason,'HISTORICAL_DELIVERY_UNKNOWN');
 release('accepted');await approving;
 const state=await delivery(f,id,headers);assert.equal(state.recipient,'late.ack@example.invalid');assert.equal(state.status,'not_sent');assert.equal(state.reason,'ELIGIBLE');assert.equal(f.messages.length,2);
 const oldMail=f.messages[1].template_params.invitation_text,oldToken=oldMail.match(/#r=(c1\.[A-Za-z0-9_.-]+)/u)[1];await assert.rejects(f.app.confirmationService.authorize({receiptToken:oldToken}),e=>e.code==='CONFIRMATION_NOT_FOUND');
});


test('a displayed recipient revision cannot authorize a later edited address before an explicit fresh send',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),pending=await f.seedPublic(),id=pending.reference_code;await f.approvePublic(id,{headers});
 await correctRegistration(f,id,{email:'first.checked@example.invalid'},headers);const state=await delivery(f,id,headers);
 await correctRegistration(f,id,{email:'second.unseen@example.invalid'},headers);const count=f.messages.length;
 const refused=await f.app.handle(f.request('/api/admin/registration-confirmation/send/'+id,{method:'POST',headers,body:{expectedRevision:state.revision,expectedAccessRevision:state.accessRevision,operationId:operation(),retryRejected:false}}));assert.equal(refused.status,409);assert.equal(f.messages.length,count);
 const fresh=await delivery(f,id,headers);assert.equal(fresh.recipient,'second.unseen@example.invalid');await send(f,id,headers,fresh);assert.equal(f.messages.length,count+1);assert.equal(f.messages.at(-1).template_params.to_email,fresh.recipient);
});
