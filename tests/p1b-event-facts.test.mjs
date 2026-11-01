import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { eventConfig, assessPublishedEventFacts } from '../src/config/event.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createIntentInvitationService } from '../functions/intent-invitations/service.mjs';
import { createIntentInvitationRepository } from '../functions/intent-invitations/repository.mjs';
import { createAppleWalletService } from '../functions/apple-wallet/service.mjs';
import { createAppleWalletApi } from '../functions/apple-wallet/handler.mjs';
import { confirmationView } from '../src/lib/confirmation-client.mjs';
import { validPersonConfirmation } from '../src/lib/person-confirmation.mjs';
import { peopleRuntimeFixture } from './helpers/people-runtime-fixture.mjs';
import { createWalletFixture, passFiles } from './apple-wallet-fixture.mjs';

const SECRET='synthetic-p1b-event-facts-confirmation-secret-123456';
const NOW=Date.parse('2026-10-21T09:00:00.000Z');
const operation=()=>randomBytes(24).toString('base64url');
const ready=(key='synthetic-facts-v1',revision=1)=>({ready:true,reason:'EVENT_FACTS_VERIFIED',revision,key});
const mismatch=()=>({ready:false,reason:'EVENT_FACTS_MISMATCH',revision:2,key:null});

async function publish(f,change=()=>{}) {
  const {draft}=await f.app.store.read(),content=structuredClone(draft.content);change(content);
  const saved=await f.app.store.save(draft.revision,content,f.users[0].id);
  return f.app.store.publish(saved.revision,f.users[0].id);
}
async function approved(f) {
  const saved=await f.seedPublic();await f.approvePublic(saved.reference_code);return saved.reference_code;
}
function confirmation(f,{readiness,providerStatus='provider_accepted',monotonicNow,batchTimeoutMs,walletReadiness}={}) {
  const messages=[],journalFor=prefix=>createObjectJournal({objects:f.objects,prefix});
  const service=createRegistrationConfirmationService({registrationService:f.app.registrationService,journalFor,tokenSecret:SECRET,
    event:eventConfig,clock:()=>NOW,eventFactsReadiness:readiness,
    emailProvider:{readiness:()=>({ready:true,enabled:true}),send:async message=>{messages.push(message);return{status:providerStatus};}},
    ...(monotonicNow?{monotonicNow,batchTimeoutMs}:{}),...(walletReadiness?{walletReadiness}:{})});
  return {service,messages,repository:createConfirmationRepository({journal:journalFor(service.prefix),eventId:eventConfig.id,clock:()=>NOW})};
}

test('event fact assessment accepts static fallback and approved legacy labels without rewriting source bytes',()=>{
  const content=createInitialContent(),published={revision:1,content},before=JSON.stringify(published);
  const staticFacts=assessPublishedEventFacts(null),first=assessPublishedEventFacts(published);
  assert.equal(staticFacts.ready,true);assert.equal(first.ready,true);assert.equal(first.key,staticFacts.key);
  for(const venue of [eventConfig.venue.name,eventConfig.venue.address,'深圳前海5号楼3F']){
    const candidate=structuredClone(published);candidate.content.event.venue=venue;
    candidate.content.event.title=candidate.content.event.title.replace('GlobalGameJam','GGJ');
    assert.equal(assessPublishedEventFacts(candidate).key,first.key);
  }
  const legacy=structuredClone(published);delete legacy.content.event.presentation;
  assert.equal(assessPublishedEventFacts(legacy).ready,true);
  const unrelated=structuredClone(published);unrelated.revision=5;unrelated.content.sessions[0].title='合成更新日程';
  assert.equal(assessPublishedEventFacts(unrelated).key,first.key);
  assert.equal(JSON.stringify(published),before);
});

test('each conflicting published event fact blocks new delivery while missing or unreadable sources remain distinct',()=>{
  const mutations=[c=>c.eventId='synthetic-other',c=>c.event.title='合成不同活动',c=>c.event.date='2026-12-06',
    c=>c.event.timezone='Asia/Tokyo',c=>c.event.venue='合成另一场地',c=>c.event.status='cancelled',
    c=>c.event.dateStatus='tentative',c=>c.event.venueStatus='tentative',c=>c.event.presentation.openingTime='11:00',
    c=>c.event.presentation.endTime='19:00',c=>c.event.presentation.checkInTime='10:00'];
  for(const mutate of mutations){const content=createInitialContent();mutate(content);const state=assessPublishedEventFacts({revision:2,content});assert.equal(state.ready,false);assert.equal(state.reason,'EVENT_FACTS_MISMATCH');}
  for(const source of [undefined,{},false,{revision:-1,content:createInitialContent()}])assert.equal(assessPublishedEventFacts(source).reason,'EVENT_FACTS_UNAVAILABLE');
  const conflictingConfig=structuredClone(eventConfig);conflictingConfig.time.opening='11:00';
  assert.equal(assessPublishedEventFacts(null,conflictingConfig).reason,'EVENT_FACTS_UNAVAILABLE');
  const anotherConfig=structuredClone(eventConfig);anotherConfig.venue.address='合成新地址';
  const oldPoster=createInitialContent();oldPoster.event.venue='深圳前海5号楼3F';
  assert.equal(assessPublishedEventFacts({revision:1,content:oldPoster},anotherConfig).ready,false,'the poster alias is limited to the exact known address');
});

test('production wiring blocks automatic and explicit confirmation against conflicting facts without reserving a notice',async()=>{
  const f=await peopleRuntimeFixture({mail:true});await publish(f,c=>{c.event.presentation.openingTime='11:00';});
  const id=await approved(f);assert.equal(f.messages.length,0);
  const state=await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id});
  assert.equal(state.reason,'EVENT_FACTS_MISMATCH');assert.equal(state.ready,false);assert.equal(validPersonConfirmation(state,id),true);
  const history=await f.app.confirmationService.staffHistory({actor:f.users[0],registrationId:id});assert.deepEqual(history.notices,[]);
  const result=await f.app.confirmationService.notifyApproved({registrationIds:[id]});assert.equal(result.results[0].status,'not_attempted');
  assert.equal(f.messages.length,0);assert.deepEqual((await f.app.confirmationService.staffHistory({actor:f.users[0],registrationId:id})).notices,[]);
  await publish(f,c=>{c.event.presentation.openingTime=eventConfig.time.opening;});
  assert.equal((await f.app.confirmationService.staffDeliveryState({actor:f.users[0],registrationId:id})).ready,true);
  assert.equal(f.messages.length,0,'correcting content does not send a historical notification');
  assert.equal((await f.app.confirmationService.notifyApproved({registrationIds:[id]})).results[0].status,'provider_accepted');assert.equal(f.messages.length,1);
});

test('unavailable event source and invalid actor/capability cannot become a ready fallback or cause outward work',async()=>{
  const f=await peopleRuntimeFixture(),id=await approved(f);let reads=0;
  const c=confirmation(f,{readiness:async()=>{reads++;throw new Error('synthetic-private-source-error');}});
  await assert.rejects(c.service.settings({actor:{id:'synthetic-editor',roles:['editor']}}),{code:'FORBIDDEN'});
  await assert.rejects(c.service.confirmation({receiptToken:'invalid'}),{code:'CONFIRMATION_NOT_FOUND'});assert.equal(reads,0);
  const state=await c.service.staffDeliveryState({actor:f.users[0],registrationId:id});assert.equal(state.reason,'EVENT_FACTS_UNAVAILABLE');assert.equal(state.ready,false);
  const before=await c.repository.read();assert.equal((await c.service.notifyApproved({registrationIds:[id]})).results[0].status,'not_attempted');
  assert.deepEqual(await c.repository.read(),before);assert.equal(c.messages.length,0);
});

test('facts changing after reservation record a known unsent rejection and only explicit retry reuses that notice',async()=>{
  const f=await peopleRuntimeFixture(),id=await approved(f);let reads=0,stable=false;
  const c=confirmation(f,{readiness:async()=>stable||++reads===1?ready():mismatch()});
  const result=await c.service.notifyApproved({registrationIds:[id]});assert.equal(result.results[0].status,'not_attempted');assert.equal(c.messages.length,0);
  const first=(await c.service.staffHistory({actor:f.users[0],registrationId:id})).notices[0];assert.equal(first.status,'rejected');assert.equal(first.attempt,1);
  stable=true;assert.equal((await c.service.notifyApproved({registrationIds:[id]})).results[0].status,'rejected');assert.equal(c.messages.length,0);
  const state=await c.service.settings({actor:f.users[0]});
  const retried=await c.service.dispatch({actor:f.users[0],registrationIds:[id],expectedRevision:state.revision,operationId:operation(),retryRejected:true});
  assert.equal(retried.results[0].status,'provider_accepted');assert.equal(c.messages.length,1);
  const final=(await c.service.staffHistory({actor:f.users[0],registrationId:id})).notices[0];assert.equal(final.id,first.id);assert.equal(final.attempt,2);
});

test('slow final facts read cannot start the provider after the remaining notification budget expires',async()=>{
  const f=await peopleRuntimeFixture(),id=await approved(f);let clock=0,reads=0;
  const c=confirmation(f,{batchTimeoutMs:100,monotonicNow:()=>clock,readiness:async()=>{if(++reads===2)clock=101;return ready();}});
  assert.equal((await c.service.notifyApproved({registrationIds:[id]})).results[0].status,'not_attempted');assert.equal(c.messages.length,0);
  assert.equal((await c.service.staffHistory({actor:f.users[0],registrationId:id})).notices[0].status,'rejected');
});

for(const status of ['provider_accepted','unknown'])test('existing '+status+' confirmation survives later fact conflicts unchanged',async()=>{
  const f=await peopleRuntimeFixture(),id=await approved(f);let current=ready();
  const c=confirmation(f,{readiness:async()=>current,providerStatus:status});
  assert.equal((await c.service.notifyApproved({registrationIds:[id]})).results[0].status,status);const before=await c.repository.read();
  current=mismatch();assert.equal((await c.service.notifyApproved({registrationIds:[id]})).results[0].status,status);
  assert.deepEqual(await c.repository.read(),before);assert.equal(c.messages.length,1);
  const link=await c.service.staffConfirmationLink({actor:f.users[0],registrationId:id}),page=await c.service.confirmation({receiptToken:link.receiptToken});
  assert.equal(page.admission.status,'confirmed');assert.equal(page.email.status,status);assert.equal(page.eventFacts.ready,false);assert.equal(page.invitation.ready,false);assert.equal(page.wallet.ready,false);
  const view=confirmationView({...page,eventFacts:{ready:'incorrect',privateSource:'synthetic-private'}});assert.equal(view.admission.status,'confirmed');assert.equal(view.email.status,status);assert.equal(view.eventFacts.reason,'EVENT_FACTS_UNAVAILABLE');assert.equal(view.wallet.ready,false);
});

test('production intent invitation uses canonical activity hours, while conflicting facts block new preparations and email',async()=>{
  const f=await peopleRuntimeFixture({capacity:4}),contact=(await f.createContact()).contact;
  const converted=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:1,permissionReference:'合成授权转换'});
  const id=converted.registrations[0].registrationId,input={actor:f.users[0],contactId:contact.id,expectedContactRevision:1,expectedRegistrationId:id,channel:'manual'};
  const prepared=await f.app.intentService.issueInvitation(input);assert.equal(prepared.invitation.content.settings.time,eventConfig.time.label);
  assert.match(prepared.invitation.content.text,/签到：09:30/u);
  await publish(f,c=>{c.event.date='2026-12-06';});
  const before=await createIntentInvitationRepository({journal:createObjectJournal({objects:f.objects,prefix:'cms/v1/intent-invitations'})}).read();
  const replay=await f.app.intentService.issueInvitation(input);assert.equal(replay.replayed,true);assert.deepEqual(replay.invitation,prepared.invitation);
  await assert.rejects(f.app.intentService.issueInvitation({...input,channel:'email',confirmEmail:true}),{code:'EVENT_FACTS_MISMATCH'});
  const after=await createIntentInvitationRepository({journal:createObjectJournal({objects:f.objects,prefix:'cms/v1/intent-invitations'})}).read();assert.deepEqual(after,before);
  assert.equal(f.messages.length,0);
});

test('new production service reads an existing legacy invitation without changing its old content or identity',async()=>{
  const f=await peopleRuntimeFixture(),contact=(await f.createContact()).contact;
  const conversion=await f.app.intentService.convertContacts({actor:f.users[0],contactIds:[contact.id],expectedContactRevision:1,permissionReference:'合成原邀请授权'});
  const repository=createIntentInvitationRepository({journal:createObjectJournal({objects:f.objects,prefix:'cms/v1/intent-invitations'})});
  const legacy=createIntentInvitationService({registrationService:f.app.registrationService,contactsStore:f.app.contactsStore,contentStore:f.app.store,repository,
    isRegistrationActive:async()=>true,getAdmissionStatus:id=>f.app.registrationService.getAdmissionStatus(id),now:()=>NOW});
  const input={actor:f.users[0],contactId:contact.id,expectedContactRevision:1,expectedRegistrationId:conversion.registrations[0].registrationId,channel:'manual'};
  const old=await legacy.issueInvitation(input);assert.equal(old.invitation.content.settings.time,'09:30–18:00');const before=await repository.read();
  const current=await f.app.intentService.issueInvitation(input);assert.equal(current.replayed,true);assert.deepEqual(current.invitation,old.invitation);assert.deepEqual(await repository.read(),before);
});

test('Wallet checks event facts before signer access and after signing, while already issued pass verification stays admission based',async()=>{
  const fixture=await createWalletFixture();
  try{
    const id='w'.repeat(43),receiptToken='synthetic.receipt.'+'r'.repeat(43),event={id:'synthetic-p1b-wallet',title:'合成活动',date:new Date(fixture.now+7*86400000).toISOString().slice(0,10),time:'10:00–18:00',venue:'合成场地',timezone:'Asia/Shanghai',checkIn:'09:30'};
    const attendee={registrationId:id,referenceCode:id,admissionStatus:'confirmed',admissionKind:'attendee',admissionRevision:1,name:'合成参会者',organization:'合成机构',event};
    let facts=ready(),loads=0,reads=0,lateChange=false;
    const service=createAppleWalletService({env:{APPLE_WALLET_ENABLED:'true',APPLE_WALLET_BUNDLE_ID:'a'.repeat(64)},tokenSecret:SECRET,
      authorize:async()=>structuredClone(attendee),authorizedRegistration:async()=>{if(lateChange)facts=mismatch();return structuredClone(attendee);},clock:()=>fixture.now,
      trustedRootFingerprints:[fixture.rootHash],loadSigningBundle:async()=>{loads++;return fixture.env;},eventFactsReadiness:async()=>{reads++;return facts;}});
    facts=mismatch();assert.equal((await service.download({receiptToken})).outcome,'event_unverified');assert.equal(loads,0);
    const before=reads;assert.equal((await service.download({receiptToken:'invalid'})).outcome,'invalid');assert.equal(reads,before);
    facts=ready();const issued=await service.download({receiptToken});assert.equal(issued.outcome,'issued');assert.equal(loads,1);
    const pass=JSON.parse(passFiles(issued.data).get('pass.json')),token=pass.barcodes[0].message.split('/').at(-1);
    facts=mismatch();assert.equal((await service.verify({token})).valid,true,'facts changes cannot rewrite or remotely update an already saved card');
    facts=ready();lateChange=true;assert.equal((await service.download({receiptToken})).outcome,'event_unverified');assert.equal(loads,2);
    const api=createAppleWalletApi({service});const response=await api(new Request('https://api.artdico.host/api/registration/wallet',{method:'POST',headers:{Origin:'https://artdico.host','Content-Type':'application/json'},body:JSON.stringify({receiptToken})}));
    assert.equal(response.status,503);const body=await response.json();assert.equal(body.error.code,'EVENT_FACTS_UNAVAILABLE');assert.match(body.error.message,/活动资料/u);assert.doesNotMatch(body.error.message,/证书|设置/u);
  }finally{await fixture.cleanup();}
});
