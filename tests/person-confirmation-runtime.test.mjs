import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';
import {EDITABLE_CONTACT_FIELDS,EDITABLE_CONTACT_ARRAY_FIELDS} from '../shared/contact-editor.mjs';
import {validPersonConfirmation} from '../src/lib/person-confirmation.mjs';
const operation=()=>randomBytes(24).toString('base64url');
async function response(value,status=200){assert.equal(value.status,status);return value.json();}
async function reply(f,contactId,changes,headers){const roster=await f.app.contactsStore.read(),contact=roster.contacts.find(item=>item.id===contactId);
 return response(await f.app.handle(f.request('/api/admin/contacts/'+contactId,{method:'PUT',headers,body:{expectedRevision:roster.revision,operations:{...contact.operations,...changes}}})));}
async function delivery(f,id,headers){const value=await response(await f.app.handle(f.request('/api/admin/registration-confirmation/delivery/'+id,{headers})));
 assert.equal(validPersonConfirmation(value,id),true);return value;}
async function send(f,id,headers,state,operationId=operation()){const body={expectedRevision:state.revision,operationId,retryRejected:state.retryRejected};
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
 assert.ok(f.objects.calls.slice(before).every(call=>!call.key.startsWith('cms/v1/registration-confirmations/')));assert.equal(f.messages.length,0);
});

test('public approval and a newly confirmed staff entry each send after the real common-seat commit, with no initial application mail',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),pending=await f.seedPublic();assert.equal(f.messages.length,0);
 await f.approvePublic(pending.reference_code,{headers});assert.equal(f.messages.length,1);
 const body={expectedRevision:(await f.app.registrationService.getAdmissions({actor:f.users[0]})).revision,operationId:operation(),input:{kind:'attendee',permissionReference:'合成人员明确授权代登记并发送参会确认',fields:{name:'合成工作人员代登记',email:'synthetic.staff@example.invalid',organization:'合成单位',city:'合成城市',position:'',categories:['industry'],participationInterests:['attend'],background:'',attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'}}};
 const first=await response(await f.app.handle(f.request('/api/admin/admissions/staff',{method:'POST',headers,body})));assert.equal(first.receipt.admissionStatus,'confirmed');assert.equal(f.messages.length,2);
 await response(await f.app.handle(f.request('/api/admin/admissions/staff',{method:'POST',headers,body})));assert.equal(f.messages.length,2);
 const state=await delivery(f,first.registrationId,headers);assert.equal(state.reason,'ALREADY_ACCEPTED');
});
