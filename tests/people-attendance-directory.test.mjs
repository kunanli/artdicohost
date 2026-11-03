import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {peopleRuntimeFixture, PEOPLE_FIXTURE_API, PEOPLE_FIXTURE_PRIVATE} from './helpers/people-runtime-fixture.mjs';
import {createPersonWorkspaceApi} from '../functions/person-workspace/handler.mjs';
import {peopleDirectoryProjection, peopleDirectoryWork, personAttendanceProjection} from '../functions/person-workspace/projection.mjs';
import {validatePeopleDirectory} from '../src/lib/people-directory.mjs';
import {buildPosterInvitationSettings, INVITATION_POSTER_FACTS} from '../shared/organizer-progress.mjs';
import {createInitialContent} from '../src/config/content.mjs';
import {eventConfig, assessPublishedEventFacts} from '../src/config/event.mjs';

const ROOT='/api/admin/people/directory';
const unknownWarning='寄送结果待核对，请勿重寄。';
const generatedAt='2020-10-20T01:00:00.000Z', sentAt='2020-10-20T02:00:00.000Z', newerAt='2020-10-21T01:00:00.000Z';
const operationId=()=>randomBytes(24).toString('base64url');
const writes=f=>f.objects.calls.filter(call=>call.operation!=='get').length;

async function json(response,status=200){const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;}
async function directory(f,headers,query='',status=200){
  const body=await json(await f.app.handle(f.request(ROOT+query,{headers})),status);
  if(status===200)assert.equal(validatePeopleDirectory(body,new URL(ROOT+query,PEOPLE_FIXTURE_API).searchParams.get('view')??'all'),true,'actual API response satisfies the directory DTO');
  return body;
}
async function readOnly(f,callback){const beforeWrites=writes(f),beforeMessages=f.messages.length;await callback();assert.equal(writes(f),beforeWrites,'directory GETs never write business data');assert.equal(f.messages.length,beforeMessages,'directory GETs never dispatch mail');}
async function saveResponse(f,id,responseStatus,{headers,notify=false}={}){
  const roster=await f.app.contactsStore.read(),contact=roster.contacts.find(item=>item.id===id),operations={...contact.operations,responseStatus};
  return notify?json(await f.app.handle(f.request('/api/admin/contacts/'+id,{method:'PUT',headers,body:{expectedRevision:roster.revision,operations}})))
    :f.app.contactsStore.saveOperations(id,roster.revision,operations,f.users[0].id);
}
async function convert(f,id){return f.app.intentService.convertContacts({actor:f.users[0],contactIds:[id],expectedContactRevision:(await f.app.contactsStore.read()).revision,permissionReference:'合成明确代登记授权'});}
async function linkPublic(f,headers,contactId,registrationId){
  const path='/api/admin/people/resolve',keys=['contact:'+contactId,'registration:'+registrationId];
  const preview=await json(await f.app.handle(f.request(path,{method:'POST',headers,body:{action:'preview',keys}})));
  return json(await f.app.handle(f.request(path,{method:'POST',headers,body:{action:'merge',keys:preview.keys,primaryKey:'registration:'+registrationId,
    roles:preview.roles,expectedRevision:preview.expectedRevision,expectedContactRevision:preview.expectedContactRevision,operationId:operationId(),confirmSamePerson:true}})));
}
async function inputSources(f){
  const [roster,intent,registrationDirectory,admissions,content,deliveries]=await Promise.all([f.app.contactsStore.read(),f.app.intentService.read({actor:f.users[0]}),
    f.app.reviewStore.healthDirectory(),f.app.registrationService.getAdmissions({actor:f.users[0]}),f.app.store.read(),f.app.confirmationService.staffDirectory({actor:f.users[0]})]);
  return {permissions:{contact:true,registration:true},roster,intent,registrationDirectory,admissions,content:{...content.draft,published:content.published},deliveries};
}
function projected(input,id){const row=peopleDirectoryProjection(input).people.find(item=>item.contactId===id);assert.ok(row);return row;}
async function manualFixture(){
  const f=await peopleRuntimeFixture({capacity:20}),created=await f.createContact({name:'合成当前邀请收件人'}),id=created.contact.id;
  await saveResponse(f,id,'attending');await convert(f,id);
  const content=createInitialContent();content.event.venue=eventConfig.venue.address;
  const saved=await f.app.store.save((await f.app.store.read()).draft.revision,content,f.users[0].id);
  await f.app.store.publish(saved.revision,f.users[0].id);
  const input=await inputSources(f);assert.equal(assessPublishedEventFacts(input.content.published).ready,true);
  const contact=input.roster.contacts.find(item=>item.id===id),settings=buildPosterInvitationSettings(contact.profile.name,eventConfig);
  contact.invitation={settings,generatedAt,sentAt,sentGenerationAt:generatedAt,channel:'wechat'};
  return {f,input,id,settings,registrationId:input.intent.conversions[0].registrationId};
}
function currentModern(input,id,settings){
  const link=input.intent.conversions.find(item=>item.sourceContactId===id);
  return {id:'synthetic-current-manual',sourceContactId:id,registrationId:link.registrationId,referenceCode:link.referenceCode,channel:'manual',status:'manually_sent',
    sentChannel:'wechat',createdAt:generatedAt,updatedAt:sentAt,content:{registrationId:link.registrationId,referenceCode:link.referenceCode,eventId:eventConfig.id,
      title:INVITATION_POSTER_FACTS.title,settings}};
}

test('actual API distinguishes public confirmation, linked public provenance, staff reservations and contact replies',async()=>{
  const f=await peopleRuntimeFixture({capacity:20,attendeeReviewRequired:false}),headers=await f.login();
  const publicOnly=await f.seedPublic({intake:'general-v2',name:'合成公开已确认'}),pending=(await f.createContact({name:'合成尚未回覆'})).contact;
  const reserved=(await f.createContact({name:'合成已留名额尚未回覆'})).contact;await convert(f,reserved.id);
  const attending=(await f.createContact({name:'合成明确出席'})).contact;await saveResponse(f,attending.id,'attending',{headers,notify:true});
  const declined=(await f.createContact({name:'合成明确不出席'})).contact;await saveResponse(f,declined.id,'declined');
  const linked=(await f.createContact({name:'合成关联公开报名'})).contact,publicLinked=await f.seedPublic({intake:'general-v2',name:linked.profile.name});
  await linkPublic(f,headers,linked.id,publicLinked.reference_code);
  await readOnly(f,async()=>{
    const value=await directory(f,headers),find=id=>value.rows.find(row=>row.contactId===id||row.registrationId===id);
    assert.equal(find(publicOnly.reference_code).attendance.key,'confirmed');assert.equal(find(publicOnly.reference_code).contactId,null);
    assert.equal(find(pending.id).attendance.key,'awaiting');assert.equal(find(reserved.id).admissionStatus,'confirmed');assert.equal(find(reserved.id).responseStatus,'pending');assert.equal(find(reserved.id).attendance.key,'awaiting','a staff reservation is not a reply');
    assert.equal(find(attending.id).attendance.key,'confirmed');assert.equal(find(declined.id).attendance.key,'declined');
    assert.equal((await f.app.contactsStore.read()).contacts.find(row=>row.id===linked.id).operations.responseStatus,'pending');assert.equal(find(linked.id).source,'linked');assert.equal(find(linked.id).attendance.key,'confirmed','canonical public self-registration remains positive evidence after an explicit contact link');
    assert.doesNotMatch(JSON.stringify(value),/receiptToken|permissionReference|synthetic-private-key|@example\.invalid/u);assert.equal(JSON.stringify(value).includes(PEOPLE_FIXTURE_PRIVATE),false);
  });
  await saveResponse(f,linked.id,'declined');
  await readOnly(f,async()=>assert.equal((await directory(f,headers)).rows.find(row=>row.contactId===linked.id).attendance.key,'declined','an explicit later decline overrides public provenance'));
  assert.equal(f.messages.length,0);
});

test('actual provider acceptance is current invitation evidence; an unknown acknowledgement preserves attendance and the check action',async()=>{
  for(const mailResult of ['accepted','unknown']){
    const f=await peopleRuntimeFixture({capacity:20,mail:true,mailResult,attendeeReviewRequired:false}),headers=await f.login();
    const saved=await f.seedPublic({intake:'general-v2'}),contact=(await f.createContact()).contact;
    await saveResponse(f,contact.id,'attending',{headers,notify:true});assert.equal(f.messages.length,2,'both formal messages went only to the synthetic provider');
    await readOnly(f,async()=>{
      const value=await directory(f,headers);
      for(const row of value.rows){
        assert.equal(row.deliveryStatus,mailResult==='accepted'?'provider_accepted':'unknown');assert.equal(row.attendance.key,mailResult==='accepted'?'invited':'confirmed');
        assert.equal(row.attendance.invitationLabel,mailResult==='accepted'?'邮件服务已接收，未证明送达':'');assert.equal(row.attendance.warning,mailResult==='accepted'?'':unknownWarning);
        if(mailResult==='unknown')assert.equal(row.nextAction.key,'check');
      }
      assert.equal(value.rows.some(row=>row.registrationId===saved.reference_code),true);
    });
  }
});

test('attendance filtering precedes pagination and every cursor is bound to its attendance and permission scope',async()=>{
  let clock=Date.parse('2026-10-21T09:00:00.000Z');const f=await peopleRuntimeFixture({capacity:20,attendeeReviewRequired:false,clock:()=>clock});
  const older=(await f.createContact({name:'合成较早待回覆'})).contact;clock+=60000;
  const declined=(await f.createContact()).contact;await saveResponse(f,declined.id,'declined');clock+=60000;
  const newer=(await f.createContact({name:'合成较新待回覆'})).contact;clock+=60000;await f.seedPublic({intake:'general-v2'});
  const headers=await f.login(),outreach=await f.login('outreach');
  await readOnly(f,async()=>{
    const first=await directory(f,headers,'?attendance=awaiting&limit=1');assert.equal(first.attendance,'awaiting');assert.equal(first.total,2);assert.equal(first.rows[0].contactId,newer.id);assert.ok(first.nextCursor);
    const next=await directory(f,headers,'?attendance=awaiting&limit=1&cursor='+first.nextCursor);assert.equal(next.total,2);assert.equal(next.rows[0].contactId,older.id);assert.equal(next.nextCursor,null);
    for(const query of ['attendance=all','attendance=confirmed','attendance=other','attendance=awaiting&work=reply','attendance=awaiting&query='+encodeURIComponent('合成'),'attendance=awaiting&view=unassigned']){
      assert.equal((await directory(f,headers,'?'+query+'&limit=1&cursor='+first.nextCursor,409)).error.code,'REVISION_CONFLICT');
    }
    assert.equal((await directory(f,outreach,'?attendance=awaiting&limit=1&cursor='+first.nextCursor,409)).error.code,'REVISION_CONFLICT');
    const other=await directory(f,headers,'?attendance=other');assert.equal(other.total,1);assert.equal(other.rows[0].contactId,declined.id);
    assert.equal((await directory(f,headers,'?attendance=invited')).total,0);
  });
  assert.equal(f.messages.length,0);
});

test('current legacy manual sends require the current generation, identity and verified event facts',async()=>{
  const {f,input,id}=await manualFixture(),row=projected(input,id);
  assert.equal(row.attendance.key,'invited');assert.equal(row.attendance.invitationLabel,'人工已记录发出');
  const mutations=[
    value=>{value.roster.contacts[0].invitation.sentAt=null;},
    value=>{value.roster.contacts[0].invitation.sentGenerationAt='2020-10-19T01:00:00.000Z';},
    value=>{value.roster.contacts[0].invitation.settings.confirmed=false;},
    value=>{value.roster.contacts[0].invitation.settings.date='2026-12-04';},
    value=>{delete value.roster.contacts[0].invitation.settings.renderVersion;},
    value=>{value.roster.contacts[0].profile.name='合成更正姓名';value.roster.contacts[0].profile.displayName='合成更正姓名';},
    value=>{value.content.published.content.event.date='2026-12-04';},
    value=>{delete value.content.published;},
    value=>{value.registrationDirectory.registrations[0].profileCorrection={accessRevision:1,revision:1};},
  ];
  const before=JSON.stringify(input),beforeWrites=writes(f);
  for(const mutate of mutations){const changed=structuredClone(input);mutate(changed);const current=projected(changed,id);assert.equal(current.attendance.key,'confirmed');assert.equal(current.attendance.invitationLabel,'');}
  const pending=structuredClone(input);pending.roster.contacts[0].operations.responseStatus='pending';assert.equal(projected(pending,id).attendance.key,'awaiting');assert.equal(projected(pending,id).attendance.invitationLabel,'人工已记录发出','sent evidence never fabricates a contact reply');
  assert.equal(JSON.stringify(input),before);assert.equal(writes(f),beforeWrites);assert.equal(f.messages.length,0);
});

test('modern manual proof checks registration, reference, expiry and the newest generation across both ledgers',async()=>{
  const {input,id,settings}=await manualFixture();input.roster.contacts[0].invitation={settings:null,generatedAt:null,sentAt:null,sentGenerationAt:null,channel:null};
  const manual=currentModern(input,id,settings);input.intent.invitations=[manual];assert.equal(projected(input,id).attendance.key,'invited');
  const mutations=[
    value=>{value.intent.invitations[0].status='prepared';},
    value=>{value.intent.invitations[0].content.settings.confirmed=false;},
    value=>{value.intent.invitations[0].content.referenceCode='synthetic-old-reference';},
    value=>{value.intent.invitations[0].content.registrationId='z'.repeat(43);},
    value=>{value.intent.invitations[0].content.eventId='synthetic-old-event';},
    value=>{value.intent.invitations[0].expiresAt='2001-01-01T00:00:00.000Z';},
    value=>{value.intent.invitations.push({...structuredClone(manual),id:'synthetic-new-preparation',status:'prepared',createdAt:newerAt,updatedAt:newerAt,sentChannel:null});},
    value=>{value.roster.contacts[0].invitation={settings,generatedAt:newerAt,sentAt:null,sentGenerationAt:null,channel:null};},
  ];
  for(const mutate of mutations){const changed=structuredClone(input);mutate(changed);assert.equal(projected(changed,id).attendance.key,'confirmed');}
  const legacy=structuredClone(input);legacy.roster.contacts[0].invitation={settings,generatedAt,sentAt,sentGenerationAt:generatedAt,channel:'email'};
  legacy.intent.invitations=[{...manual,id:'synthetic-new-manual-preparation',status:'prepared',createdAt:newerAt,updatedAt:newerAt,sentChannel:null}];
  assert.equal(projected(legacy,id).attendance.key,'confirmed','a newer prepared poster supersedes the old sent legacy generation');
});

test('actual profile correction invalidates a previously current manual invitation without erasing its history',async()=>{
  const f=await peopleRuntimeFixture({capacity:20}),contact=(await f.createContact()).contact,headers=await f.login();
  await saveResponse(f,contact.id,'attending');await convert(f,contact.id);
  const draft=(await f.app.store.read()).draft,content=createInitialContent();content.event.venue=eventConfig.venue.address;
  const saved=await f.app.store.save(draft.revision,content,f.users[0].id);await f.app.store.publish(saved.revision,f.users[0].id);
  const settings=buildPosterInvitationSettings(contact.profile.name,eventConfig),generated=await f.app.contactsStore.recordGenerated(contact.id,(await f.app.contactsStore.read()).revision,settings,f.users[0].id);
  await f.app.contactsStore.recordSent(contact.id,generated.revision,'wechat',generated.contact.invitation.generatedAt,settings,f.users[0].id);
  await readOnly(f,async()=>assert.equal((await directory(f,headers)).rows[0].attendance.key,'invited'));
  const id=(await f.app.intentService.read({actor:f.users[0]})).conversions[0].registrationId,detail=await f.app.reviewStore.detail(id);
  const fields=Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,key==='email'?'synthetic.corrected@example.invalid':detail.registration.fields[key]??'']));
  await f.app.reviewStore.saveProfile(id,detail.revision,operationId(),fields,f.users[0].id);
  await readOnly(f,async()=>{const row=(await directory(f,headers)).rows[0];assert.equal(row.attendance.key,'confirmed');assert.equal(row.attendance.invitationLabel,'');assert.equal(row.invitationStatus,'manually_sent','the historical send remains inspectable');});
  assert.equal((await f.app.contactsStore.read()).contacts[0].invitation.sentGenerationAt,generated.contact.invitation.generatedAt);assert.equal(f.messages.length,0);
});

test('old-recipient unknown mail stays a separate warning and check action after a recipient correction',async()=>{
  const f=await peopleRuntimeFixture({capacity:20,mail:true,mailResult:'unknown',attendeeReviewRequired:false}),saved=await f.seedPublic({intake:'general-v2'}),headers=await f.login();
  const detail=await f.app.reviewStore.detail(saved.reference_code),fields=Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,key==='email'?'synthetic.new.recipient@example.invalid':detail.registration.fields[key]??'']));
  await f.app.reviewStore.saveProfile(saved.reference_code,detail.revision,operationId(),fields,f.users[0].id);
  await readOnly(f,async()=>{
    const row=(await directory(f,headers)).rows[0];assert.equal(row.deliveryStatus,'not_sent','an old recipient is never current provider acceptance');assert.equal(row.deliveryHistoryUnknown,true);
    assert.equal(row.attendance.key,'confirmed');assert.equal(row.attendance.warning,unknownWarning);assert.equal(row.attendance.invitationLabel,'');assert.equal(row.nextAction.key,'check');
  });
  const input=await inputSources(f);input.deliveries={revision:999,notices:[{registrationId:saved.reference_code,status:'provider_accepted',historicalUnknown:true}]};
  const result=peopleDirectoryProjection(input);peopleDirectoryWork(result,{actor:f.users[0],...input,revisions:{contacts:0,registration:0,applications:1,admissions:1,invitations:0,delivery:999,content:0,publishedContent:null}});
  assert.equal(result.people[0].attendance.key,'invited');assert.equal(result.people[0].attendance.invitationLabel,'邮件服务已接收，未证明送达');assert.equal(result.people[0].attendance.warning,unknownWarning);assert.equal(result.people[0].nextAction.key,'check','current acceptance does not erase a separate unresolved historical attempt');
  assert.equal(f.messages.length,1);
});

test('attendance DTO fields are closed and optional for legacy responses; malformed filters and source permissions fail safely',async()=>{
  const f=await peopleRuntimeFixture({attendeeReviewRequired:false}),saved=await f.seedPublic({intake:'general-v2'}),headers=await f.login(),value=await directory(f,headers);
  for(const attendance of [null,{...value.rows[0].attendance,extra:'PRIVATE'}, {...value.rows[0].attendance,label:'邮件已送达'},
    {...value.rows[0].attendance,warning:'PRIVATE_PROVIDER'}, {...value.rows[0].attendance,key:'all'}]){
    const malformed=structuredClone(value);malformed.rows[0].attendance=attendance;assert.equal(validatePeopleDirectory(malformed,'all'),false);
  }
  const legacy=structuredClone(value);delete legacy.attendance;delete legacy.rows[0].attendance;assert.equal(validatePeopleDirectory(legacy,'all'),true);
  const malformed=structuredClone(value);malformed.rows[0].deliveryHistoryUnknown='PRIVATE';assert.equal(validatePeopleDirectory(malformed,'all'),false);
  let reads=0;const forbidden=async()=>{reads++;assert.fail('unauthorized or malformed queries cannot read private sources');};
  for(const user of [null,{id:'synthetic-editor',roles:['editor']},{id:'synthetic-owner',roles:['superadmin']}]){
    const handle=createPersonWorkspaceApi({authenticate:async()=>({user}),loadContacts:forbidden,loadRegistrationDirectory:forbidden,loadAdmissions:forbidden,loadIntent:forbidden,loadContent:forbidden,loadDeliveryDirectory:forbidden});
    if(!user||user.roles[0]==='editor')assert.equal((await handle(new Request(PEOPLE_FIXTURE_API+ROOT+'?attendance=confirmed'))).status,user?403:401);
    else for(const query of ['?attendance=sent','?attendance=invited&attendance=confirmed','?attendance=','?attendance=confirmed&extra=private'])assert.equal((await handle(new Request(PEOPLE_FIXTURE_API+ROOT+query))).status,400);
  }
  assert.equal(reads,0);
  const input=await inputSources(f),calls=[];
  const restricted=createPersonWorkspaceApi({authenticate:async()=>({user:{id:'synthetic-reviewer',roles:['reviewer']}}),loadContacts:forbidden,loadIntent:forbidden,loadContent:forbidden,
    loadRegistrationDirectory:async()=>{calls.push('registrations');return input.registrationDirectory;},loadAdmissions:async()=>{calls.push('admissions');return input.admissions;},loadDeliveryDirectory:async()=>{calls.push('deliveries');throw new Error('PRIVATE_PROVIDER');}});
  const result=await json(await restricted(new Request(PEOPLE_FIXTURE_API+ROOT+'?attendance=confirmed')));assert.equal(validatePeopleDirectory(result,'all'),true);assert.equal(result.total,1);assert.equal(result.rows[0].registrationId,saved.reference_code);
  assert.equal(result.rows[0].attendance.key,'confirmed');assert.equal(result.rows[0].attendance.warning,'确认信状态暂时无法核对。');assert.equal(result.permissions.contacts,false);assert.deepEqual(new Set(calls),new Set(['registrations','admissions','deliveries']));assert.equal(reads,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_PROVIDER/u);
  const unavailable=createPersonWorkspaceApi({authenticate:async()=>({user:{id:'synthetic-reviewer',roles:['reviewer']}}),loadRegistrationDirectory:async()=>{throw new Error('PRIVATE_SOURCE');},loadAdmissions:async()=>input.admissions});
  const response=await unavailable(new Request(PEOPLE_FIXTURE_API+ROOT+'?attendance=invited'));assert.equal(response.status,503);assert.doesNotMatch(JSON.stringify(await response.json()),/PRIVATE_SOURCE/u);
  const stage=personAttendanceProjection({registration:{id:saved.reference_code,provenance:{kind:'public'},review:{status:'new'}},admission:{status:'confirmed'},communications:{confirmations:[{status:'provider_accepted'}]},availability:{contact:'unavailable'}});
  assert.equal(stage.key,'unavailable');assert.equal(stage.invitationLabel,'');assert.equal(stage.warning,'资料来源暂时无法核对。');assert.equal(f.messages.length,0);
});
