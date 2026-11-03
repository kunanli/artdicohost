import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRegistrationService} from '../functions/registration-api/service.mjs';
import {createRegistrationApi} from '../functions/registration-api/handler.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
import {memoryObjects} from './helpers/cloud-memory-objects.mjs';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';

const EVENT='synthetic-confirmed-only',ORIGIN='https://synthetic-registration.example.invalid';
const actor={id:'synthetic-confirmed-only-reviewer',roles:['superadmin']};
const key=()=>randomBytes(32).toString('base64url');
const hash=value=>createHash('sha256').update(value).digest('hex');
const policy={enabled:true,eventId:EVENT,opensAt:'2026-10-19T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',privacy:{
  version:'synthetic-confirmed-v1',processor:'合成处理者',contactEmail:'synthetic.privacy@example.invalid',purpose:'合成名额原子性回归',
  storageRegion:'合成隔离地区',retention:'合成保留规则',rightsRequest:'联系合成处理者',sharing:'合成资料不对外分享'}};
const staff=(sourceContactId,confirmed=true)=>({sourceContactId,actor,input:{fields:{name:'合成已确认参会者',email:'synthetic.attendee@example.invalid'},
  permissionReference:'  合成明确代登记授权  '},...(confirmed?{requireConfirmed:true}:{})});
const publicFields={name:'合成公开申请人',city:'合成城市',organization:'合成组织',position:'合成开发者',email:'synthetic.public@example.invalid',
  categories:['industry'],participationInterests:['attend'],background:'合成资料',attendance:'expected',accommodationChoice:'not_needed',cooperationInterest:'none'};

function fixture(options={}){
  const base=memoryObjects(),state={now:Date.parse('2026-10-21T09:00:00Z'),loseAck:false,indexCommits:0,recordStages:0,casConflicts:0,
    afterRecord:null,recordBarrier:null,bulkReviewReads:0,reviewFailure:false,withdrawn:new Set(),savedHooks:0,groupInvites:0};
  const objects={...base,async putImmutable(path,bytes,settings){
    const result=await base.putImmutable(path,bytes,settings);
    if(path.includes('/records/')){state.recordStages++;state.afterRecord?.();if(state.recordBarrier)await state.recordBarrier();}
    return result;
  },async append(path,position,bytes){
    const result=await base.append(path,position,bytes);
    if(path.endsWith('/index/commits.jsonl')){state.indexCommits++;if(state.loseAck){state.loseAck=false;throw new Error('SYNTHETIC_LOST_INDEX_ACK');}}
    return result;
  }};
  function journalFor(prefix){const journal=createObjectJournal({objects,prefix});return{...journal,async commit(...args){
    try{return await journal.commit(...args);}catch(error){if(error.code==='WRITE_CONFLICT'&&error.status===409)state.casConflicts++;throw error;}
  }};}
  function service(patch={}){return createRegistrationService({objects,journalFor,policy,capacity:1,waitlistEnabled:true,
    tokenSecret:'synthetic-confirmed-only-registration-secret-123456',allowedOrigins:[ORIGIN],clock:()=>state.now,
    isWithdrawn:async id=>state.withdrawn.has(id),getWithdrawnIds:async()=>{state.bulkReviewReads++;if(state.reviewFailure)throw new Error('SYNTHETIC_REVIEW_UNAVAILABLE');return [...state.withdrawn];},
    onSaved:async()=>{state.savedHooks++;},groupInviteProvider:async()=>{state.groupInvites++;return null;},...options,...patch});}
  return{objects,state,service,writes:()=>base.calls.filter(call=>call.operation!=='get').length};
}
function recordRaceBarrier(f){
  let arrived=0,release;const ready=new Promise(resolve=>{release=resolve;});
  f.state.recordBarrier=async()=>{arrived++;if(arrived===2)release();await ready;};
  return()=>arrived;
}
async function submission(service){
  const idempotencyKey=key(),issued=await service.issueToken({eventId:EVENT,origin:ORIGIN,idempotencyKey});assert.equal(issued.outcome,'issued');
  return{origin:ORIGIN,idempotencyKey,submissionToken:issued.submissionToken,payload:{eventId:EVENT,fields:structuredClone(publicFields),consent:{accepted:true,version:policy.privacy.version}}};
}
async function readJson(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}

test('confirmed-only is a trusted literal true option; malformed flags fail before any storage IO',async()=>{
  const f=fixture(),service=f.service();
  for(const requireConfirmed of[false,null,'true','false',0,1,undefined,{},[]]){
    const before=f.objects.calls.length;assert.deepEqual(await service.submitStaffRegistration({...staff('synthetic-malformed'),requireConfirmed}),{outcome:'invalid'});
    assert.equal(f.objects.calls.length,before);assert.equal(f.writes(),0);
  }
  const accessor=staff('synthetic-accessor');Object.defineProperty(accessor,'requireConfirmed',{enumerable:true,get(){assert.fail('a trusted flag must not invoke an accessor');}});
  assert.deepEqual(await service.submitStaffRegistration(accessor),{outcome:'invalid'});assert.equal(f.objects.calls.length,0);
  const hidden=staff('synthetic-hidden-flag');Object.defineProperty(hidden,'requireConfirmed',{enumerable:false,value:true});
  assert.deepEqual(await service.submitStaffRegistration(hidden),{outcome:'invalid'});assert.equal(f.objects.calls.length,0,'an own non-enumerable flag is invalid rather than an omitted legacy flag');
  assert.deepEqual(await service.submitStaffRegistration({...staff('synthetic-editor'),actor:{id:'synthetic-editor',roles:['editor']}}),{outcome:'forbidden'});assert.equal(f.objects.calls.length,0);
});

test('one remaining place is committed as confirmed with no release, promotion, mail or public consent',async()=>{
  const f=fixture({capacity:2}),service=f.service(),first=await service.submitStaffRegistration(staff('synthetic-existing',false));assert.equal(first.outcome,'created');
  const before=(await service.repository.readIndex()).value,result=await service.submitStaffRegistration(staff('synthetic-new-confirmed'));
  assert.equal(result.outcome,'created');assert.equal(result.receipt.admissionStatus,'confirmed');assert.deepEqual(result.promotedIds,[]);assert.deepEqual(result.releasedIds,[]);
  const after=(await service.repository.readIndex()).value;assert.equal(after.revision,before.revision+1);assert.equal(after.entries.length,2);assert.deepEqual(after.admissions.people[first.receipt.registrationId],before.admissions.people[first.receipt.registrationId]);
  const audit=after.admissions.audit.at(-1);assert.equal(audit.action,'staff_intake');assert.equal(audit.details.status,'confirmed');assert.deepEqual(audit.result.promotedIds,[]);assert.deepEqual(audit.result.releasedIds,[]);
  const record=(await service.repository.list()).registrations.find(row=>row.id===result.receipt.registrationId);assert.deepEqual(record.consent,{accepted:false,acceptedAt:null,version:null});assert.equal(record.provenance.kind,'staff_assisted');
  assert.equal(Object.hasOwn(record,'requireConfirmed'),false);assert.equal(Object.hasOwn(record.provenance,'requireConfirmed'),false);assert.equal(f.state.savedHooks,0);assert.equal(f.state.groupInvites,0);
});

test('a known full pool creates no waiter, record blob, index entry or audit whether waitlists are enabled or disabled',async()=>{
  for(const waitlistEnabled of[false,true]){
    const f=fixture({waitlistEnabled}),service=f.service();assert.equal((await service.submitStaffRegistration(staff('synthetic-occupant'))).outcome,'created');
    const before=(await service.repository.readIndex()).value,beforeWrites=f.writes(),beforeStages=f.state.recordStages,beforeCommits=f.state.indexCommits;
    assert.deepEqual(await f.service().submitStaffRegistration(staff('synthetic-full')),{outcome:'capacity_conflict'});
    assert.deepEqual((await service.repository.readIndex()).value,before);assert.equal(f.writes(),beforeWrites);assert.equal(f.state.recordStages,beforeStages);assert.equal(f.state.indexCommits,beforeCommits);
  }
  const reserved=fixture({capacity:2,staffReserve:1}),service=reserved.service();await service.submitStaffRegistration(staff('synthetic-public-pool-occupant'));
  assert.deepEqual(await service.submitStaffRegistration(staff('synthetic-reserved-crew-slot')),{outcome:'capacity_conflict'},'staff-assisted attendees cannot consume the crew reserve');
  assert.equal((await service.getAdmissions({actor})).summary.remainingTotal,1);
});

test('full confirmed-only intake never checks or releases review withdrawals and never promotes an existing waiter',async()=>{
  const f=fixture(),service=f.service(),occupant=await service.submitStaffRegistration(staff('synthetic-reviewed-withdrawal',false)),waiting=await service.submitStaffRegistration(staff('synthetic-waiter',false));
  assert.equal(waiting.receipt.admissionStatus,'waitlisted');f.state.withdrawn.add(occupant.receipt.registrationId);f.state.withdrawn.add(waiting.receipt.registrationId);f.state.reviewFailure=true;
  const before=(await service.repository.readIndex()).value,beforeWrites=f.writes(),beforeReviews=f.state.bulkReviewReads;
  assert.deepEqual(await f.service().submitStaffRegistration(staff('synthetic-no-side-effects')),{outcome:'capacity_conflict'});
  assert.deepEqual((await service.repository.readIndex()).value,before);assert.equal(f.writes(),beforeWrites);assert.equal(f.state.bulkReviewReads,beforeReviews,'the import branch does not invoke the exclusion loader');
  assert.equal(before.admissions.people[occupant.receipt.registrationId].status,'confirmed');assert.equal(before.admissions.people[waiting.receipt.registrationId].status,'waitlisted');
});

test('two independent clients genuinely race for the final place and only one can create an accepted registration',async()=>{
  const f=fixture(),arrivals=recordRaceBarrier(f),a=f.service(),b=f.service();
  const results=await Promise.all([a.submitStaffRegistration(staff('synthetic-final-place-a')),b.submitStaffRegistration(staff('synthetic-final-place-b'))]);
  assert.equal(arrivals(),2,'both clients staged against the same available place before either could commit');assert.ok(f.state.casConflicts>=1,'the loser encountered a definitive CAS conflict and reread capacity');
  assert.deepEqual(results.map(row=>row.outcome).sort(),['capacity_conflict','created']);assert.equal(f.state.indexCommits,1);
  const saved=await f.service().repository.list(),snapshot=await a.getAdmissions({actor});assert.equal(saved.registrations.length,1);assert.equal(snapshot.summary.confirmedCount,1);assert.equal(snapshot.summary.waitlistCount,0);assert.equal(snapshot.auditCount,1);
  assert.equal(results.find(row=>row.outcome==='created').receipt.registrationId,saved.registrations[0].id);assert.equal(f.state.savedHooks,0);assert.equal(f.state.groupInvites,0);
});

test('the same-source race shares the old key and payload hash across flag and default callers',async()=>{
  const f=fixture(),arrivals=recordRaceBarrier(f),command=staff('synthetic-shared-source'),old={...command};delete old.requireConfirmed;
  const results=await Promise.all([f.service().submitStaffRegistration(command),f.service().submitStaffRegistration(old)]);
  assert.equal(arrivals(),2);assert.deepEqual(results.map(row=>row.outcome).sort(),['created','replayed']);assert.deepEqual(results[0].receipt,results[1].receipt);assert.equal(f.state.indexCommits,1);
  const index=(await f.service().repository.readIndex()).value;assert.equal(index.entries.length,1);assert.equal(index.entries[0].keyHash,hash('staff\0'+EVENT+'\0'+command.sourceContactId));
  const legacyPayloadBytes='{"fields":{"email":"synthetic.attendee@example.invalid","name":"合成已确认参会者"},"permissionReference":"合成明确代登记授权"}';
  assert.equal(index.entries[0].payloadHash,hash(legacyPayloadBytes),'the pre-existing sorted JSON bytes remain the request hash, without the new mode flag');
});

test('old saved keys replay truthfully across flags and closure without approving a waiter or changing immutable hashes',async()=>{
  const f=fixture(),service=f.service(),old=staff('synthetic-original-key',false),first=await service.submitStaffRegistration(old);assert.equal(first.receipt.admissionStatus,'confirmed');
  const waiter=staff('synthetic-original-waiter',false),waiting=await service.submitStaffRegistration(waiter);assert.equal(waiting.receipt.admissionStatus,'waitlisted');
  const before=(await service.repository.readIndex()).value,beforeWrites=f.writes();f.state.now=Date.parse(policy.closesAt)+1;
  for(const command of[old,waiter]){
    const replay=await f.service().submitStaffRegistration({...command,requireConfirmed:true});assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.registrationId,command===old?first.receipt.registrationId:waiting.receipt.registrationId);assert.equal(replay.receipt.admissionStatus,command===old?'confirmed':'waitlisted');
  }
  const changed={...old,requireConfirmed:true,input:{...old.input,fields:{...old.input.fields,name:'合成不同内容'}}};assert.deepEqual(await f.service().submitStaffRegistration(changed),{outcome:'conflict'});
  assert.deepEqual((await service.repository.readIndex()).value,before);assert.equal(f.writes(),beforeWrites);
  const fresh=fixture(),command=staff('synthetic-new-mode-key'),created=await fresh.service().submitStaffRegistration(command),without={...command};delete without.requireConfirmed;
  const replay=await fresh.service().submitStaffRegistration(without);assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.registrationId,created.receipt.registrationId);assert.equal(fresh.state.indexCommits,1);
});

test('a lost successful index acknowledgement recovers the exact source without a second acceptance or notification',async()=>{
  const f=fixture(),command=staff('synthetic-lost-original-source'),original=JSON.stringify(command);f.state.loseAck=true;
  assert.deepEqual(await f.service().submitStaffRegistration(command),{outcome:'unavailable'});assert.equal(f.state.indexCommits,1);
  const beforeWrites=f.writes(),found=await f.service().getStaffRegistrationBySource({sourceContactId:command.sourceContactId,actor});assert.equal(found.outcome,'found');assert.equal(found.receipt.admissionStatus,'confirmed');
  f.state.now=Date.parse(policy.closesAt)+1;const replay=await f.service().submitStaffRegistration(command);assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.registrationId,found.receipt.registrationId);assert.equal(replay.receipt.admissionStatus,'confirmed');
  assert.equal(JSON.stringify(command),original);assert.equal(f.writes(),beforeWrites);assert.equal(f.state.indexCommits,1);assert.equal((await f.service().repository.list()).registrations.length,1);assert.equal(f.state.savedHooks,0);assert.equal(f.state.groupInvites,0);
});

test('withdrawn saved keys never revive even when their conservative raw seat still looks confirmed',async()=>{
  const f=fixture(),command=staff('synthetic-withdrawn-original'),created=await f.service().submitStaffRegistration(command);f.state.withdrawn.add(created.receipt.registrationId);
  const before=(await f.service().repository.readIndex()).value,beforeWrites=f.writes();assert.equal(before.admissions.people[created.receipt.registrationId].status,'confirmed');
  assert.deepEqual(await f.service().submitStaffRegistration(command),{outcome:'withdrawn'});assert.deepEqual(await f.service().getStaffRegistrationBySource({sourceContactId:command.sourceContactId,actor}),{outcome:'withdrawn'});
  assert.deepEqual((await f.service().repository.readIndex()).value,before);assert.equal(f.writes(),beforeWrites);
});

test('policy closure is distinct from capacity rejection and the final time gate survives slow record staging',async()=>{
  const full=fixture();await full.service().submitStaffRegistration(staff('synthetic-full-before-close'));full.state.now=Date.parse(policy.closesAt);
  const beforeWrites=full.writes();assert.deepEqual(await full.service().submitStaffRegistration(staff('synthetic-policy-closed')),{outcome:'closed'});assert.equal(full.writes(),beforeWrites);
  const disabled=fixture({policy:{...policy,enabled:false}});assert.deepEqual(await disabled.service().submitStaffRegistration(staff('synthetic-disabled-policy')),{outcome:'closed'});assert.equal(disabled.writes(),0);
  const slow=fixture();slow.state.afterRecord=()=>{slow.state.now=Date.parse(policy.closesAt);};
  assert.deepEqual(await slow.service().submitStaffRegistration(staff('synthetic-slow-record')),{outcome:'closed'});assert.equal(slow.state.recordStages,1,'the immutable record may have been staged before closure');assert.equal(slow.state.indexCommits,0);assert.equal((await slow.service().repository.list()).registrations.length,0,'staging alone is never a saved registration');
  const speakerOnly=fixture({policy:{...policy,publicRegistrationMode:'speaker_only'}});assert.equal((await speakerOnly.service().submitStaffRegistration(staff('synthetic-external-attendee'))).receipt.admissionStatus,'confirmed','a public speaker-only intake policy does not disable authorized staff intake');
});

test('omitted flags preserve ordinary staff waitlists and public HTTP applications preserve their existing review policy',async()=>{
  const f=fixture(),service=f.service();await service.submitStaffRegistration(staff('synthetic-existing-default',false));
  const waiting=await service.submitStaffRegistration(staff('synthetic-waitlist-default',false));assert.equal(waiting.outcome,'created');assert.equal(waiting.receipt.admissionStatus,'waitlisted');
  const input=await submission(service),api=createRegistrationApi({allowedOrigins:[ORIGIN],submissionService:service,clock:()=>f.state.now});
  const response=await api(new Request('https://synthetic-api.example.invalid/api/registrations',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json','Idempotency-Key':input.idempotencyKey,'X-Registration-Token':input.submissionToken},body:JSON.stringify({...input.payload,requireConfirmed:true})}));
  const receipt=await readJson(response,201);assert.equal(receipt.admissionStatus,'pending_review','a public caller cannot opt into the trusted staff flag');
  const summary=(await service.getAdmissions({actor})).summary;assert.equal(summary.confirmedCount,1);assert.equal(summary.waitlistCount,1);assert.equal(summary.pendingReviewCount,1);
});

test('explicit canonical links replay existing confirmed or pending public people and preserve later withdrawal',async()=>{
  for(const attendeeReviewRequired of[false,true]){
    const f=await peopleRuntimeFixture({capacity:1,mail:false,attendeeReviewRequired}),contact=(await f.createContact()).contact,pub=await f.seedPublic({intake:'general-v2'}),headers=await f.login();
    const path='/api/admin/people/resolve',keys=['contact:'+contact.id,'registration:'+pub.reference_code];
    const preview=await readJson(await f.app.handle(f.request(path,{method:'POST',headers,body:{action:'preview',keys}})));
    await readJson(await f.app.handle(f.request(path,{method:'POST',headers,body:{action:'merge',keys:preview.keys,primaryKey:'registration:'+pub.reference_code,roles:preview.roles,
      expectedRevision:preview.expectedRevision,expectedContactRevision:preview.expectedContactRevision,operationId:key(),confirmSamePerson:true}})));
    const writes=()=>f.objects.calls.filter(call=>call.operation!=='get').length,beforeWrites=writes(),command={...staff(contact.id),actor:f.users[0]};
    const replay=await f.app.registrationService.submitStaffRegistration(command);assert.equal(replay.outcome,'replayed');assert.equal(replay.personLinked,true);assert.equal(replay.receipt.registrationId,pub.reference_code);assert.equal(replay.receipt.admissionStatus,attendeeReviewRequired?'pending_review':'confirmed');assert.equal(writes(),beforeWrites);
    assert.equal((await f.app.registrationService.repository.list()).registrations.length,1);assert.equal(f.messages.length,0);
    const before=await f.app.registrationService.getAdmissions({actor:f.users[0]}),withdrawn=await f.app.registrationService.withdrawAdmission({actor:f.users[0],expectedRevision:before.revision,operationId:key(),registrationId:pub.reference_code});assert.equal(withdrawn.outcome,'updated');
    const afterWithdrawal=writes();assert.deepEqual(await f.app.registrationService.submitStaffRegistration(command),{outcome:'withdrawn'});assert.equal(writes(),afterWithdrawal);assert.equal((await f.app.registrationService.repository.list()).registrations.length,1);
  }
});
