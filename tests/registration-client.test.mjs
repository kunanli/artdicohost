import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegistrationClient} from '../src/lib/registration-client.mjs';
import {registrationFields} from '../src/lib/registration-fields.mjs';
import {normalizeRegistration} from '../shared/registration-schema.mjs';
import {eventTimeInstant} from '../src/lib/event-presentation.mjs';

const NOW=Date.parse('2026-10-20T16:00:00Z');
const policy={enabled:true,eventId:'synthetic-event',opensAt:'2026-10-01T00:00:00Z',closesAt:'2026-12-05T04:00:00Z',capacity:300,privacy:{version:'notice-v1',processor:'合成处理者',contactEmail:'privacy@example.invalid',purpose:'合成报名',storageRegion:'合成地区',retention:'合成保留规则',rightsRequest:'合成权利联络',sharing:'合成不分享'}};
const token={eventId:policy.eventId,submissionToken:'synthetic.payload.signature',expiresAt:'2026-10-20T16:05:00Z'};
const reference='r'.repeat(43);
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function fixture(send,config=policy){
  const calls=[];
  const client=createRegistrationClient({apiOrigin:'https://api.artdico.host',pageOrigin:'https://artdico.host',clock:()=>NOW,randomBytes:()=>new Uint8Array(32).fill(7),fetchFn:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/config'))return json(config);
    if(url.endsWith('/token'))return json(token);
    return send?send(calls):json({status:'registered',reference_code:reference,groupInvite:null},201);
  }});
  return{client,calls};
}

test('unconfigured or untrusted pages never call the registration service',async()=>{
  for(const patch of [{},{apiOrigin:'https://foreign.invalid',pageOrigin:'https://artdico.host'},{apiOrigin:'https://api.artdico.host',pageOrigin:'https://foreign.invalid'}]){
    let requests=0;
    const client=createRegistrationClient({...patch,fetchFn:async()=>{requests++;throw new Error('not reached');}});
    assert.equal(await client.configure(),null);
    await assert.rejects(client.submit({name:'合成'}),/暂未开放/u);
    assert.equal(requests,0);
  }
});
test('formal submission omits cookies and returns success only for a confirmed receipt',async()=>{
  const f=fixture();await f.client.configure();
  const result=await f.client.submit({name:'合成访客'});
  assert.equal(result.body.reference_code,reference);assert.equal(f.client.pending,false);
  for(const call of f.calls){assert.equal(call.options.credentials,'omit');assert.equal(call.options.cache,'no-store');assert.equal(call.options.redirect,'error');}
  const issued=JSON.parse(f.calls[1].options.body),saved=JSON.parse(f.calls[2].options.body);
  assert.equal(issued.idempotencyKey,f.calls[2].options.headers['Idempotency-Key']);
  assert.equal(saved.consent.accepted,true);assert.equal(saved.consent.version,'notice-v1');
});
test('a saved waitlist entry retains its reference and admission state while dropping every invitation',async()=>{
  const f=fixture(()=>json({status:'waitlisted',admissionStatus:'waitlisted',admissionKind:'attendee',admissionRevision:4,reference_code:reference,
    groupInvite:{platform:'wechat',qrImageUrl:'https://api.artdico.host/api/admin/registration/group-invite/synthetic',expiresAt:'2026-10-20T16:05:00Z'},private:'PRIVATE-SYNTHETIC'},201));
  await f.client.configure();
  const result=await f.client.submit({name:'合成候补'});
  assert.deepEqual(result,{httpStatus:201,body:{status:'waitlisted',admissionStatus:'waitlisted',admissionKind:'attendee',admissionRevision:4,reference_code:reference,groupInvite:null}});
  assert.equal(f.client.pending,false);
  assert.equal(f.calls.some(call=>call.url.includes('/group-invite/')),false);
});
test('manual-review and rejected replay receipts preserve status while discarding all formal group access',async()=>{
  for(const status of ['pending_review','rejected']){
    const f=fixture(()=>json({status,admissionStatus:status,admissionKind:'attendee',admissionRevision:4,reference_code:reference,
      groupInvite:{platform:'wechat',qrImageUrl:'https://api.artdico.host/api/admin/registration/group-invite/synthetic',expiresAt:'2026-10-20T16:05:00Z'}},201));
    await f.client.configure();const result=await f.client.submit({intake:'general-v2',name:'合成申请人'});
    assert.deepEqual(result.body,{status,admissionStatus:status,admissionKind:'attendee',admissionRevision:4,reference_code:reference,groupInvite:null});assert.equal(f.client.pending,false);
    assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);assert.equal(f.calls.some(call=>call.url.includes('email')||call.url.includes('group-invite/')),false);
  }
});
test('contradictory or malformed admission receipts preserve the same uncertain submission for retry',async()=>{
  for(const patch of [{status:'pending_review'},{status:'rejected'},{status:'pending_review',admissionStatus:'confirmed'},{status:'rejected',admissionStatus:'waitlisted'},{status:'registered',admissionStatus:'waitlisted'},{status:'waitlisted',admissionStatus:'confirmed'},{status:'registered',admissionStatus:'unknown'},{status:'registered',admissionKind:'team'},{status:'waitlisted',admissionRevision:-1}]){
    const f=fixture(()=>json({...patch,reference_code:reference},201));await f.client.configure();
    await assert.rejects(f.client.submit({name:'合成候补'}),error=>error.uncertain===true);
    assert.equal(f.client.pending,true);
    await assert.rejects(f.client.submit({name:'另一个人'}),error=>error.code==='PENDING');
    assert.equal(f.calls.filter(call=>call.url.endsWith('/submit')).length,1);
  }
});
test('metadata exposes validated per-person capacity facts without leaking roster or accepting inconsistent totals',async()=>{
  const admissions={capacity:300,staffReserve:0,waitlistEnabled:true,confirmedCount:300,attendeeConfirmedCount:298,crewConfirmedCount:2,waitlistCount:3,remainingPublic:0,remainingTotal:0};
  const f=fixture(null,{...policy,admissions:{...admissions,people:[{name:'PRIVATE-SYNTHETIC'}]}});
  assert.deepEqual((await f.client.configure()).admissions,{...admissions,pendingReviewCount:0,rejectedCount:0});
  const invalid=fixture(null,{...policy,admissions:{...admissions,remainingTotal:1}});
  assert.equal(Object.hasOwn(await invalid.client.configure(),'admissions'),false);
});
test('manual review metadata forwards an explicit boolean and leaves older metadata compatible',async()=>{
  const enabled=fixture(null,{...policy,attendeeReviewRequired:true});assert.equal((await enabled.client.configure()).attendeeReviewRequired,true);
  const legacy=fixture();assert.equal(Object.hasOwn(await legacy.client.configure(),'attendeeReviewRequired'),false);
  const invalid=fixture(null,{...policy,attendeeReviewRequired:'true'});assert.equal(Object.hasOwn(await invalid.client.configure(),'attendeeReviewRequired'),false);
});
test('configured closed registration is explicit and can never submit a new record',async()=>{
  const calls=[];
  const client=createRegistrationClient({apiOrigin:'https://api.artdico.host',pageOrigin:'https://artdico.host',fetchFn:async(url,options)=>{calls.push(options.method);return json({enabled:false,reason:'closed'});}});
  assert.deepEqual(await client.configure(),{enabled:false,reason:'closed'});
  await assert.rejects(client.submit({name:'合成'}));assert.deepEqual(calls,['GET']);
});
test('closed registration keeps a complete approved privacy notice available for existing applicants',async()=>{
  const client=createRegistrationClient({apiOrigin:'https://api.artdico.host',pageOrigin:'https://artdico.host',fetchFn:async()=>json({...policy,enabled:false,reason:'closed'})});
  const result=await client.configure();assert.equal(result.enabled,false);assert.equal(result.privacy.rightsRequest,policy.privacy.rightsRequest);
  await assert.rejects(client.submit({name:'合成'}));
});
test('unknown save acknowledgement preserves the exact key and payload for explicit retry',async()=>{
  let attempts=0;
  const f=fixture(()=>{if(++attempts===1)throw new Error('PRIVATE-SYNTHETIC-TRANSPORT');return json({status:'registered',reference_code:reference},200);});
  await f.client.configure();
  await assert.rejects(f.client.submit({name:'合成访客'}),error=>error.uncertain&&!error.message.includes('PRIVATE-'));
  assert.equal(f.client.pending,true);
  await assert.rejects(f.client.submit({name:'不同访客'}),error=>error.code==='PENDING');
  assert.equal(attempts,1);
  await f.client.submit({name:'合成访客'});
  const sends=f.calls.filter(call=>call.url.endsWith('/submit'));
  assert.equal(sends.length,2);assert.equal(sends[0].options.body,sends[1].options.body);
  assert.equal(sends[0].options.headers['Idempotency-Key'],sends[1].options.headers['Idempotency-Key']);
});
test('malformed receipts never display success and valid rejection allows correction',async()=>{
  for(const body of [{status:'registered'},{status:'registered',reference_code:'123'},{status:'registered',reference_code:reference,private:'irrelevant'}]){
    const f=fixture(()=>json(body,body.private?503:201));await f.client.configure();
    await assert.rejects(f.client.submit({name:'合成'}));assert.equal(f.client.pending,true);
  }
  const f=fixture(()=>json({error:{message:'PRIVATE-SYNTHETIC-DETAIL'}},422));await f.client.configure();
  await assert.rejects(f.client.submit({name:'合成'}),error=>!error.message.includes('PRIVATE-'));assert.equal(f.client.pending,false);
});
test('official policy is required and can never use the demo consent version',async()=>{
  const client=createRegistrationClient({apiOrigin:'https://api.artdico.host',pageOrigin:'https://artdico.host',fetchFn:async()=>json({...policy,privacy:{...policy.privacy,version:'frontend-demo-v1'}})});
  await assert.rejects(client.configure(),error=>error.code==='CONFIG_INVALID');
  await assert.rejects(client.submit({}));
});
test('form projection converts active numeric branches and excludes demo or inactive metadata',()=>{
  const value=normalizeRegistration({categories:['so'],participationInterests:['attend'],consentAccepted:true,'soRo.firstYear':'2020',speaker:{topic:'inactive'}});
  const fields=registrationFields(value);
  assert.equal(fields.soRo.firstYear,2020);
  for(const key of ['consentAccepted','consentVersion','accommodationNights','speaker'])assert.equal(Object.hasOwn(fields,key),false);
});
test('published wall-clock times resolve accurately and reject missing or ambiguous local times',()=>{
  assert.equal(eventTimeInstant('2026-12-05','10:00','Asia/Shanghai'),Date.parse('2026-12-05T02:00:00Z'));
  assert.equal(eventTimeInstant('2026-02-30','10:00','Asia/Shanghai'),null);
  assert.equal(eventTimeInstant('2026-03-08','02:30','America/New_York'),null);
  assert.equal(eventTimeInstant('2026-11-01','01:30','America/New_York'),null);
});
