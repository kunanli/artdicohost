import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_EVENT,PEOPLE_FIXTURE_PUBLIC} from './helpers/people-runtime-fixture.mjs';
import {memoryObjects} from './helpers/cloud-memory-objects.mjs';
import {inspectEncryptedObjectBackup,restoreEncryptedBackupIsolated} from '../functions/registration-admin/maintenance.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
import {createConfirmationRepository} from '../functions/registration-confirmation/repository.mjs';

test('short student proposal, approval, approved waitlist and refusal retain exact private history through encrypted isolated recovery',async()=>{
  const f=await peopleRuntimeFixture({capacity:1,mail:true});
  const a=await f.seedPublic({intake:'general-v2',name:'合成学生分享者',participationInterests:['attend','talk'],speaker:{topic:'合成主题',summary:'合成分享摘要'}});
  const b=await f.seedPublic({intake:'general-v2',name:'合成后续候补',categories:['industry']});
  const c=await f.seedPublic({intake:'general-v2',name:'合成未通过者'});
  const d=await f.seedPublic({intake:'general-v2',name:'合成仍待审者'});
  for(const receipt of [a,b,c,d]){
    assert.equal(receipt.status,'pending_review');assert.equal(receipt.groupInvite,null);
    assert.equal(receipt.confirmation.email.status,'not_applicable');
  }
  assert.equal(f.messages.length,4,'each newly saved public application has its own receipt');
  for(const message of f.messages){
    assert.match(message.template_params.invitation_text,/申请已收到|申请已经收到/u);
    assert.doesNotMatch(message.template_params.invitation_text,/Apple Wallet|名额已确认|已获邀|群码/u);
  }
  const stored=await f.app.registrationService.repository.list();
  const student=stored.registrations.find(row=>row.id===a.reference_code);
  assert.deepEqual(student.fields.categories,['student']);assert.deepEqual(student.fields.speaker,{topic:'合成主题',summary:'合成分享摘要'});
  for(const key of ['attendance','accommodationChoice','accommodationNights','cooperationInterest','background'])assert.equal(Object.hasOwn(student.fields,key),false);
  const headers=await f.login('reviewer');
  const first=await f.approvePublic(a.reference_code,{headers});assert.equal(first.approvalEmail.status,'completed');assert.equal(f.messages.length,5);
  const waiting=await f.approvePublic(b.reference_code,{headers});assert.equal(waiting.approvalEmail,undefined);assert.equal(f.messages.length,5);
  async function command(action,id){
    const before=await f.app.registrationService.getAdmissions({actor:f.users[0]});
    const response=await f.app.handle(f.request('/api/admin/admissions/'+action,{method:'POST',headers,body:{registrationId:id,expectedRevision:before.revision,operationId:randomBytes(32).toString('base64url')}}));
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
  }
  await command('reject',c.reference_code);assert.equal(f.messages.length,5);
  const withdrawn=await command('withdraw',a.reference_code);assert.deepEqual(withdrawn.promotedIds,[b.reference_code]);assert.equal(f.messages.length,6);
  const before=await f.app.registrationService.getAdmissions({actor:f.users[0]});
  assert.deepEqual([before.summary.confirmedCount,before.summary.pendingReviewCount,before.summary.rejectedCount,before.summary.withdrawnCount],[1,1,1,1]);
  async function confirmation(app,receipt){
    const response=await app.handle(f.request('/api/admin/registration/confirmation',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,body:{receiptToken:receipt.confirmation.receiptToken}}));
    assert.equal(response.status,200);return response.json();
  }
  for(const [receipt,status] of [[c,'rejected'],[d,'pending_review']]){
    const view=await confirmation(f.app,receipt);assert.equal(view.admission.status,status);assert.equal(view.email.status,'not_applicable');assert.equal(view.groupInvite,null);assert.equal(view.wallet.ready,false);
    assert.equal(view.notifications.applicationReceived.status,'provider_accepted');
  }
  const preview=await f.app.confirmationService.staffReminderPreview({actor:f.users[0],registrationIds:[b.reference_code]});
  assert.deepEqual(preview.rows.map(row=>[row.registrationId,row.eligible]),[[b.reference_code,true]]);assert.equal(f.messages.length,6,'preview never sends');
  const reminderBody={actor:f.users[0],registrationIds:[b.reference_code],expectedRevision:preview.revision,operationId:randomBytes(32).toString('base64url')};
  const reminded=await f.app.confirmationService.dispatchReminder(reminderBody);assert.equal(reminded.kind,'pre_event_reminder');
  assert.deepEqual(reminded.results,[{registrationId:b.reference_code,status:'provider_accepted'}]);assert.equal(f.messages.length,7);
  assert.equal((await f.app.confirmationService.dispatchReminder(reminderBody)).outcome,'replayed');assert.equal(f.messages.length,7);
  const noticeRepository=objects=>createConfirmationRepository({journal:createObjectJournal({objects,prefix:f.app.confirmationService.prefix}),eventId:PEOPLE_FIXTURE_EVENT});
  const noticeBefore=(await noticeRepository(f.objects).read()).value;
  assert.deepEqual(Object.fromEntries(['application_received','registration','pre_event_reminder'].map(kind=>[kind,noticeBefore.notices.filter(row=>row.kind===kind).length])),{application_received:4,registration:2,pre_event_reminder:1});
  const owner=await f.login(),key=randomBytes(32);
  const backup=await f.app.handle(f.request('/api/admin/maintenance/backup',{method:'POST',headers:owner,body:{encryptionKey:key.toString('base64url'),confirmation:'CREATE_ENCRYPTED_BACKUP'}}));
  assert.equal(backup.status,200);const bundle=Buffer.from(await backup.arrayBuffer());
  const inspection=inspectEncryptedObjectBackup({bundle,key,includeObjects:true});
  assert.ok(inspection.objects.some(row=>row.key.includes('/registration-confirmations/')));
  const destination=memoryObjects();
  const restored=await restoreEncryptedBackupIsolated({objects:destination,bundle,key,restoreId:'synthetic-application-history'});
  assert.equal(restored.active,false);assert.equal(restored.sessionsRestored,false);key.fill(0);
  const readOnly={get:(name,options)=>destination.get(restored.namespace+'/'+name.slice('cms/v1/'.length),options),putImmutable:async()=>assert.fail('recovery reads must not activate or write'),append:async()=>assert.fail('recovery reads must not commit')};
  const recovered=f.make({objects:readOnly});
  assert.deepEqual(await recovered.registrationService.getAdmissions({actor:f.users[0]}),before);
  assert.deepEqual(await recovered.registrationService.repository.list(),{...stored,revision:before.revision});
  assert.deepEqual((await noticeRepository(readOnly).read()).value,noticeBefore,'all typed notices, attempts and operation identities recover exactly');
  const aHistory=await recovered.confirmationService.staffHistory({actor:f.users[0],registrationId:a.reference_code});
  const bHistory=await recovered.confirmationService.staffHistory({actor:f.users[0],registrationId:b.reference_code});
  assert.equal(aHistory.notices[0].status,'provider_accepted');assert.equal(bHistory.notices[0].status,'provider_accepted');
  assert.equal(aHistory.notices.length,1);assert.equal(bHistory.notices.length,1,'application receipts and reminders do not replace the formal-confirmation history');
  const bRecovered=await confirmation(recovered,b);assert.equal(bRecovered.notifications.applicationReceived.status,'provider_accepted');assert.equal(bRecovered.notifications.preEventReminder.status,'provider_accepted');
  assert.equal((await confirmation(recovered,d)).admission.status,'pending_review');
  assert.equal(f.messages.length,7,'reading recovered state never resends any receipt, formal notice or reminder');
});

test('profile corrections and recipient-scoped notices restore with original source and revoked capabilities intact',async()=>{
 const f=await peopleRuntimeFixture({mail:true}),headers=await f.login(),pending=await f.seedPublic(),id=pending.reference_code;await f.approvePublic(id,{headers});
 const original=await f.app.registrationService.repository.list(),detail=await f.app.reviewStore.detail(id),operationId=randomBytes(24).toString('base64url');
 const fields={...Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??''])),email:'synthetic.restored.corrected@example.invalid'};
 await f.app.reviewStore.saveProfile(id,detail.revision,operationId,fields,f.users[0].id);
 const state=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id});
 await f.app.confirmationService.dispatch({actor:f.users[0],registrationIds:[id],expectedRevision:state.revision,expectedAccessRevisions:{[id]:state.accessRevision},operationId:randomBytes(24).toString('base64url')});
 const key=randomBytes(32),backup=await f.app.handle(f.request('/api/admin/maintenance/backup',{method:'POST',headers,body:{encryptionKey:key.toString('base64url'),confirmation:'CREATE_ENCRYPTED_BACKUP'}}));assert.equal(backup.status,200);const bundle=Buffer.from(await backup.arrayBuffer());
 const destination=memoryObjects(),restored=await restoreEncryptedBackupIsolated({objects:destination,bundle,key,restoreId:'synthetic-profile-corrections'});key.fill(0);
 const readOnly={get:(name,options)=>destination.get(restored.namespace+'/'+name.slice('cms/v1/'.length),options),putImmutable:async()=>assert.fail('read only recovery'),append:async()=>assert.fail('read only recovery')},recovered=f.make({objects:readOnly});
 assert.deepEqual(await recovered.registrationService.repository.list(),original);assert.deepEqual((await recovered.reviewStore.profileOperation(id,operationId,f.users[0].id)).fields,fields);
 assert.equal((await recovered.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id})).status,'provider_accepted');assert.equal((await recovered.confirmationService.staffHistory({actor:f.users[0],registrationId:id})).notices.length,2);
 await assert.rejects(recovered.confirmationService.authorize({receiptToken:pending.confirmation.receiptToken}),error=>error.code==='CONFIRMATION_NOT_FOUND');assert.equal(f.messages.length,3,'isolated recovery never sends');
});
