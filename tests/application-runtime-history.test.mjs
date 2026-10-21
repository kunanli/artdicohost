import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture,PEOPLE_FIXTURE_PUBLIC} from './helpers/people-runtime-fixture.mjs';
import {memoryObjects} from './helpers/cloud-memory-objects.mjs';
import {inspectEncryptedObjectBackup,restoreEncryptedBackupIsolated} from '../functions/registration-admin/maintenance.mjs';

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
  assert.equal(f.messages.length,0);
  const stored=await f.app.registrationService.repository.list();
  const student=stored.registrations.find(row=>row.id===a.reference_code);
  assert.deepEqual(student.fields.categories,['student']);assert.deepEqual(student.fields.speaker,{topic:'合成主题',summary:'合成分享摘要'});
  for(const key of ['attendance','accommodationChoice','accommodationNights','cooperationInterest','background'])assert.equal(Object.hasOwn(student.fields,key),false);
  const headers=await f.login('reviewer');
  const first=await f.approvePublic(a.reference_code,{headers});assert.equal(first.approvalEmail.status,'completed');assert.equal(f.messages.length,1);
  const waiting=await f.approvePublic(b.reference_code,{headers});assert.equal(waiting.approvalEmail,undefined);assert.equal(f.messages.length,1);
  async function command(action,id){
    const before=await f.app.registrationService.getAdmissions({actor:f.users[0]});
    const response=await f.app.handle(f.request('/api/admin/admissions/'+action,{method:'POST',headers,body:{registrationId:id,expectedRevision:before.revision,operationId:randomBytes(32).toString('base64url')}}));
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
  }
  await command('reject',c.reference_code);assert.equal(f.messages.length,1);
  const withdrawn=await command('withdraw',a.reference_code);assert.deepEqual(withdrawn.promotedIds,[b.reference_code]);assert.equal(f.messages.length,2);
  const before=await f.app.registrationService.getAdmissions({actor:f.users[0]});
  assert.deepEqual([before.summary.confirmedCount,before.summary.pendingReviewCount,before.summary.rejectedCount,before.summary.withdrawnCount],[1,1,1,1]);
  async function confirmation(app,receipt){
    const response=await app.handle(f.request('/api/admin/registration/confirmation',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,body:{receiptToken:receipt.confirmation.receiptToken}}));
    assert.equal(response.status,200);return response.json();
  }
  for(const [receipt,status] of [[c,'rejected'],[d,'pending_review']]){
    const view=await confirmation(f.app,receipt);assert.equal(view.admission.status,status);assert.equal(view.email.status,'not_applicable');assert.equal(view.groupInvite,null);assert.equal(view.wallet.ready,false);
  }
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
  const aHistory=await recovered.confirmationService.staffHistory({actor:f.users[0],registrationId:a.reference_code});
  const bHistory=await recovered.confirmationService.staffHistory({actor:f.users[0],registrationId:b.reference_code});
  assert.equal(aHistory.notices[0].status,'provider_accepted');assert.equal(bHistory.notices[0].status,'provider_accepted');
  assert.equal((await confirmation(recovered,d)).admission.status,'pending_review');
  assert.equal(f.messages.length,2,'reading recovered state never sends either formal notice again');
});
