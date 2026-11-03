import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';

const EVENT='synthetic-speaker-only',ORIGIN='https://speaker.example.invalid';
const key=()=>randomBytes(32).toString('base64url');
const actor={id:'synthetic-reviewer',roles:['reviewer','superadmin']};
const fields=(speaker=true)=>({intake:'general-v2',name:'合成讲者申请人',email:'synthetic.speaker@example.invalid',categories:['industry'],
  participationInterests:speaker?['talk']:['attend'],phone:'+852 0012 3456',wechat:'synthetic-contact',...(speaker?{speaker:{topic:'合成分享主题',summary:'仅申请分享主题，不代表获得讲者或参会资格。'}}:{})});
const policy={enabled:true,eventId:EVENT,attendeeReviewRequired:false,opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',
  privacy:{version:'synthetic-speaker-v1',processor:'合成处理者',contactEmail:'privacy@example.invalid',purpose:'合成申请',storageRegion:'合成地区',retention:'合成期限',rightsRequest:'合成权利入口',sharing:'不对外分享'}};
function fixture({waitlistEnabled=false}={}){
  const base=memoryObjects(),state={now:Date.parse('2026-10-21T09:00:00Z'),loseAck:false,callbacks:[],withdrawn:new Set()};
  const objects={...base,async append(path,position,bytes){const result=await base.append(path,position,bytes);if(state.loseAck&&path.endsWith('/index/commits.jsonl')){state.loseAck=false;throw new Error('Synthetic lost commit acknowledgement');}return result;}};
  const make=(patch={})=>createRegistrationService({objects,journalFor:prefix=>createObjectJournal({objects,prefix}),policy:{...policy,...patch},capacity:1,waitlistEnabled,
    tokenSecret:'synthetic-speaker-token-secret-123456789',allowedOrigins:[ORIGIN],clock:()=>state.now,isWithdrawn:async id=>state.withdrawn.has(id),
    onSaved:async input=>{state.callbacks.push(input);return{};}});
  return {make,state,objects};
}
async function input(service,source=fields(),{speakerToken=source.participationInterests.length===1&&source.participationInterests[0]==='talk'}={}){
  const idempotencyKey=key(),issued=await service.issueToken({eventId:EVENT,origin:ORIGIN,idempotencyKey,...(speakerToken?{speakerApplication:true}:{})});
  assert.equal(issued.outcome,'issued');
  return {origin:ORIGIN,idempotencyKey,submissionToken:issued.submissionToken,payload:{eventId:EVENT,fields:source,consent:{accepted:true,version:policy.privacy.version}}};
}
const submit=(service,value)=>service.submit(value);

test('full seats without waitlisting still accept a speaker proposal without consuming or promoting a seat',async()=>{
  const f=fixture(),legacy=f.make(),first=await submit(legacy,await input(legacy,fields(false)));
  assert.equal(first.receipt.admissionStatus,'confirmed');
  const metadata=await legacy.metadata();assert.equal(metadata.enabled,false);assert.equal(metadata.speakerApplicationsEnabled,true);
  const service=f.make({publicRegistrationMode:'speaker_only'}),before=await service.getAdmissions({actor});
  assert.equal((await service.metadata()).enabled,true,'the standalone speaker intake stays open at full capacity');
  const result=await submit(service,await input(service));assert.equal(result.outcome,'created');assert.equal(result.receipt.admissionStatus,'pending_review');
  const after=await service.getAdmissions({actor});assert.equal(after.summary.confirmedCount,before.summary.confirmedCount);assert.equal(after.summary.waitlistCount,0);assert.equal(after.summary.remainingPublic,0);assert.equal(after.summary.pendingReviewCount,1);
  assert.equal(f.state.callbacks.at(-1).notify,false);assert.deepEqual(f.state.callbacks.at(-1).promotedIds,[]);
  assert.deepEqual((await service.repository.list()).registrations.at(-1).fields,fields());
});

test('speaker-only server mode rejects new ordinary submissions even with a speaker token, while saved legacy keys replay unchanged',async()=>{
  const f=fixture(),legacy=f.make(),old=await input(legacy,fields(false)),original=JSON.stringify(old.payload);
  const saved=await submit(legacy,old);assert.equal(saved.receipt.admissionStatus,'confirmed');
  const current=f.make({publicRegistrationMode:'speaker_only'}),newKey=key();
  assert.deepEqual(await current.issueToken({eventId:EVENT,origin:ORIGIN,idempotencyKey:newKey}),{outcome:'closed'});
  const spoof=await input(current,fields(false),{speakerToken:true});assert.deepEqual(await submit(current,spoof),{outcome:'closed'});
  const closed=f.make({publicRegistrationMode:'speaker_only',enabled:false,privacy:{...policy.privacy,version:'synthetic-speaker-v2'}});
  const issued=await closed.issueToken({eventId:EVENT,origin:ORIGIN,idempotencyKey:old.idempotencyKey});assert.equal(issued.outcome,'issued');
  const replay=await submit(closed,{...old,submissionToken:issued.submissionToken});assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.registrationId,saved.receipt.registrationId);assert.equal(replay.receipt.admissionStatus,'confirmed');
  assert.equal(JSON.stringify(old.payload),original);assert.deepEqual(await submit(current,{...old,payload:{...old.payload,fields:{...old.payload.fields,name:'合成更改正文'}}}),{outcome:'conflict'});assert.equal((await current.repository.list()).registrations.length,1);assert.equal(f.state.callbacks.at(-1).notify,false);
});

test('an old uncommitted ordinary pending body cannot obtain a new seat after switching to speaker-only mode',async()=>{
  const f=fixture(),legacy=f.make(),old=await input(legacy,fields(false)),original=JSON.stringify(old.payload);
  const current=f.make({publicRegistrationMode:'speaker_only'});assert.deepEqual(await submit(current,old),{outcome:'closed'});
  assert.equal(JSON.stringify(old.payload),original);assert.equal((await current.repository.list()).registrations.length,0);assert.equal(f.state.callbacks.length,0);
});

test('speaker proposals racing the last ordinary seat remain pending and never compete in the admission queue',async()=>{
  const f=fixture({waitlistEnabled:true}),service=f.make(),submissions=await Promise.all([input(service,fields(false)),input(service),input(service)]);
  const results=await Promise.all(submissions.map(value=>submit(f.make(),value)));
  assert.deepEqual(results.map(value=>value.receipt.admissionStatus).sort(),['confirmed','pending_review','pending_review']);
  const state=await service.getAdmissions({actor});assert.equal(state.summary.confirmedCount,1);assert.equal(state.summary.waitlistCount,0);assert.equal(state.summary.pendingReviewCount,2);assert.equal(f.state.callbacks.filter(value=>value.notify).length,1);
});

test('speaker intake does not release a withdrawn seat or trigger a waiting attendee promotion',async()=>{
  const f=fixture({waitlistEnabled:true}),service=f.make();const first=await submit(service,await input(service,fields(false)));const waiting=await submit(service,await input(service,fields(false)));
  assert.equal(waiting.receipt.admissionStatus,'waitlisted');f.state.withdrawn.add(first.receipt.registrationId);
  const result=await submit(service,await input(service));assert.equal(result.receipt.admissionStatus,'pending_review');
  const state=await service.getAdmissions({actor});assert.equal(state.people.find(value=>value.registrationId===waiting.receipt.registrationId).status,'waitlisted');assert.deepEqual(f.state.callbacks.at(-1).promotedIds,[]);
});

test('lost speaker commit acknowledgement recovers the exact saved proposal without new writes or automatic confirmation',async()=>{
  const f=fixture(),service=f.make({publicRegistrationMode:'speaker_only'}),pending=await input(service),original=JSON.stringify(pending.payload);
  f.state.loseAck=true;assert.deepEqual(await submit(service,pending),{outcome:'unavailable'});assert.equal(f.state.callbacks.length,0);
  const replay=await submit(f.make({publicRegistrationMode:'speaker_only'}),pending);assert.equal(replay.outcome,'replayed');assert.equal(replay.receipt.admissionStatus,'pending_review');assert.equal(JSON.stringify(pending.payload),original);assert.equal((await service.repository.list()).registrations.length,1);assert.equal(f.state.callbacks.at(-1).notify,false);
});

test('speaker-only intake still respects the global switch, window and consent',async()=>{
  const f=fixture(),service=f.make({publicRegistrationMode:'speaker_only'});
  const invalid=await input(service);invalid.payload.consent.accepted=false;assert.deepEqual(await submit(service,invalid),{outcome:'invalid'});
  const disabled=f.make({publicRegistrationMode:'speaker_only',enabled:false});assert.equal((await disabled.metadata()).speakerApplicationsEnabled,false);assert.deepEqual(await disabled.issueToken({eventId:EVENT,origin:ORIGIN,idempotencyKey:key(),speakerApplication:true}),{outcome:'closed'});
  f.state.now=Date.parse(policy.closesAt)-1000;const pending=await input(service);f.state.now+=1000;assert.equal((await service.metadata()).speakerApplicationsEnabled,false);assert.deepEqual(await submit(service,pending),{outcome:'closed'});
});

test('actual runtime sends at most an application receipt and denies admission QR, Wallet and group access for a speaker proposal',async()=>{
  const f=await peopleRuntimeFixture({attendeeReviewRequired:false,mail:true}),app=f.make({policyOverride:{publicRegistrationMode:'speaker_only'}}),idempotencyKey=key();
  const tokenResponse=await app.handle(f.request('/api/admin/registration/token',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,body:{eventId:PEOPLE_FIXTURE_EVENT,idempotencyKey,speakerApplication:true}}));assert.equal(tokenResponse.status,200);const token=await tokenResponse.json();
  const payload={eventId:PEOPLE_FIXTURE_EVENT,fields:fields(),consent:{accepted:true,version:(await app.registrationService.metadata()).privacy.version}};
  const request=()=>f.request('/api/admin/registration/submit',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,headers:{'Idempotency-Key':idempotencyKey,'X-Registration-Token':token.submissionToken},body:payload});
  const response=await app.handle(request());assert.equal(response.status,201);const receipt=await response.json();assert.equal(receipt.admissionStatus,'pending_review');
  const viewResponse=await app.handle(f.request('/api/admin/registration/confirmation',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,body:{receiptToken:receipt.confirmation.receiptToken}}));assert.equal(viewResponse.status,200);const view=await viewResponse.json();assert.equal(view.wallet.ready,false);assert.equal(view.groupInvite,null);assert.equal(view.notifications.applicationReceived.status,'provider_accepted');
  await assert.rejects(app.entryService.issueEntry({registrationId:receipt.reference_code}),error=>error.code==='ENTRY_NOT_FOUND');
  assert.equal([...f.objects.files.keys()].some(path=>path.includes('/entry-tickets/')),false,'a proposal does not create an admission capability mapping');
  const history=await app.confirmationService.staffHistory({actor:f.users[0],registrationId:receipt.reference_code});assert.ok(history.notices.every(value=>value.kind==='application_received'));
  assert.equal(f.messages.length,1);for(const message of f.messages)assert.doesNotMatch(message.template_params.invitation_text,/你的参会名额已确认|加入 Apple Wallet/u);
  const before=f.messages.length;assert.equal((await app.handle(request())).status,200);assert.equal(f.messages.length,before,'replay does not backfill a receipt or formal mail');
  for(const speakerApplication of [false,'true',1,null]){const denied=await app.handle(f.request('/api/admin/registration/token',{method:'POST',origin:PEOPLE_FIXTURE_PUBLIC,body:{eventId:PEOPLE_FIXTURE_EVENT,idempotencyKey:key(),speakerApplication}}));assert.equal(denied.status,400);}
});
