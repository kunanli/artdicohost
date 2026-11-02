import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryMutations,deliverySettingsView,deliveryReminderPreviewView,deliveryReminderRequestView,createReminderMutations,
  deliveryConfirmationPreviewView,deliveryConfirmationOperationView,deliveryLegacyDispatchView,createConfirmationMutations} from '../src/lib/delivery-settings.mjs';
const operationId='o'.repeat(43),id='r'.repeat(43);
const state=()=>({revision:2,automaticEnabled:false,email:{ready:false,missing:['EMAILJS_CONFIRMATION_TEMPLATE_ID'],privateKey:'PRIVATE'},wallet:{ready:false,privateKey:'PRIVATE'},counts:{total:0,providerAccepted:0,rejected:0,unknown:0}});
test('settings projection excludes credentials and rejects unverified counts or availability',()=>{
  const safe=deliverySettingsView(state());assert.ok(safe);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE/u);
  assert.equal(deliverySettingsView({...state(),email:{ready:false,missing:['private value with spaces']}}),null);
  assert.equal(deliverySettingsView({...state(),counts:{...state().counts,unknown:-1}}),null);
});
test('wallet setup projection preserves bounded safe diagnostics and valid expiry without exposing arbitrary errors',()=>{
  const wallet={ready:false,reason:'WALLET_DISABLED',missing:['APPLE_WALLET_PASS_TYPE_ID'],certificateExpiresAt:'2027-10-21T00:00:00.000Z',deviceTestRequired:true,privateKey:'PRIVATE'};
  assert.deepEqual(deliverySettingsView({...state(),wallet}).wallet,{ready:false,reason:wallet.reason,missing:wallet.missing,certificateExpiresAt:wallet.certificateExpiresAt,deviceTestRequired:true});
  assert.equal(deliverySettingsView({...state(),wallet:{...wallet,reason:'PRIVATE signing error'}}).wallet.reason,'WALLET_UNAVAILABLE');
  assert.equal(deliverySettingsView({...state(),wallet:{...wallet,reason:'WALLET_CERTIFICATE_EXPIRED'}}).wallet.reason,'WALLET_CERTIFICATE_EXPIRED');
  for(const change of [{missing:Array(21).fill('APPLE_WALLET_TEAM_ID')},{missing:['private value']},{certificateExpiresAt:'2027-02-30T00:00:00.000Z'},{certificateExpiresAt:'2027-10-21'},{deviceTestRequired:'true'}])assert.equal(deliverySettingsView({...state(),wallet:{...wallet,...change}}),null);
  assert.deepEqual(deliverySettingsView(state()).wallet,{ready:false,reason:'WALLET_NOT_CONFIGURED',missing:[],deviceTestRequired:true});
});
test('uncertain settings acknowledgement retries the exact original operation and body',async()=>{
  const calls=[];let attempt=0;
  const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>0,request:async(path,options)=>{calls.push({path,...options});if(!attempt++)throw Object.assign(new Error('uncertain'),{status:503});return{...state(),automaticEnabled:true,operationId,enabled:true,outcome:'replayed'};}});
  await assert.rejects(controller.run('settings',{enabled:true}));assert.equal(controller.pending,true);
  await assert.rejects(controller.run('settings',{enabled:false}));
  assert.equal((await controller.retry()).kind,'settings');assert.equal(controller.pending,false);assert.deepEqual(calls[0],calls[1]);assert.equal(JSON.parse(calls[0].body).operationId,operationId);
});
test('batch acknowledgement must cover every selected registration before unlocking another operation',async()=>{
  let attempt=0;const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>2,request:async()=>({outcome:'replayed',revision:3,operationId,status:'partial',results:attempt++?[{registrationId:id,status:'unknown'}]:[]})});
  await assert.rejects(controller.run('dispatch',{registrationIds:[id],retryRejected:false}),/逐人结果/u);assert.equal(controller.pending,true);
  const result=await controller.retry();assert.equal(result.value.results[0].status,'unknown');assert.equal(controller.pending,false);
});
test('a late acknowledgement from a cleared session cannot release or replace a newer pending operation',async()=>{
  const resolvers=[];let index=0;
  const controller=createDeliveryMutations({operationId:()=>String(++index).repeat(43),revision:()=>0,request:()=>new Promise(resolve=>resolvers.push(resolve))});
  const old=controller.run('settings',{enabled:true});controller.clear();const current=controller.run('settings',{enabled:false});
  resolvers[0]({...state(),outcome:'updated'});await assert.rejects(old,/会话已变更/u);assert.equal(controller.pending,true);
  resolvers[1]({...state(),operationId:'2'.repeat(43),enabled:false,outcome:'updated'});await current;assert.equal(controller.pending,false);
});
test('definite validation rejection unlocks edits without creating an automatic second request',async()=>{
  let calls=0;const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>2,request:async()=>{calls++;throw Object.assign(new Error('invalid'),{status:422});}});
  await assert.rejects(controller.run('settings',{enabled:true}));assert.equal(controller.pending,false);assert.equal(calls,1);
});


test('settings save rejects unrelated operation IDs, choices and nonadvancing revisions before claiming saved',async()=>{
  for(const change of [{operationId:'x'.repeat(43)},{enabled:false},{revision:2}]){
    const bodies=[];let incorrect=true;
    const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>2,request:async(_path,options)=>{bodies.push(options.body);return{...state(),automaticEnabled:true,revision:3,outcome:'updated',operationId,enabled:true,...(incorrect?change:{})};}});
    await assert.rejects(controller.run('settings',{enabled:true}),/未通过核对/u);assert.equal(controller.pending,true);
    incorrect=false;const result=await controller.retry();assert.equal(result.requestedEnabled,true);assert.equal(controller.pending,false);assert.equal(bodies[0],bodies[1]);
  }
});
test('a proven original settings operation remains acknowledged when a later editor changed the current setting',async()=>{
  const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>2,request:async()=>({...state(),revision:5,automaticEnabled:false,outcome:'replayed',operationId,enabled:true})});
  const result=await controller.run('settings',{enabled:true});assert.equal(result.requestedEnabled,true);assert.equal(result.value.automaticEnabled,false);assert.equal(controller.pending,false);
});

const noticeCounts=()=>({total:2,providerAccepted:1,rejected:0,unknown:1});
const reminderPreview=()=>({revision:7,kind:'pre_event_reminder',total:1,nextCursor:null,rows:[{registrationId:id,name:'合成提醒收件人',organization:'合成组织',status:'not_sent',eligible:true,reason:'ELIGIBLE',retryRejected:false,email:'PRIVATE'}],message:{subject:'合成行前提醒',text:'活动信息\n[私人参会页链接]',privateUrlPlaceholder:'[私人参会页链接]',privateToken:'PRIVATE'}});
const reminderResult=(change={})=>({revision:8,operationId,kind:'pre_event_reminder',outcome:'updated',status:'completed',results:[{registrationId:id,status:'provider_accepted'}],...change});
const formalPreview=()=>({...reminderPreview(),kind:'registration',sourceRevision:'a'.repeat(64)});
const formalResult=(change={})=>({revision:8,operationId,outcome:'replayed',status:'completed',results:[{registrationId:id,status:'provider_accepted'}],kind:'registration',checkedAt:'2026-11-01T09:00:00.000Z',...change});

test('notification counters keep receipt, formal confirmation and reminder identities separate without credentials',()=>{
  const value={...state(),notificationCounts:{applicationReceived:noticeCounts(),preEventReminder:{...noticeCounts(),total:3},privateKey:'PRIVATE'}},safe=deliverySettingsView(value);
  assert.equal(safe.counts.total,0);assert.equal(safe.notificationCounts.applicationReceived.total,2);assert.equal(safe.notificationCounts.preEventReminder.total,3);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE/u);
  assert.equal(deliverySettingsView({...value,notificationCounts:{applicationReceived:noticeCounts()}}),null);
  assert.equal(deliverySettingsView({...value,notificationCounts:{...value.notificationCounts,applicationReceived:{...noticeCounts(),unknown:-1}}}),null);
});

test('reminder preview rejects ambiguous recipients and strips private source fields',()=>{
  const value=reminderPreview(),safe=deliveryReminderPreviewView(value);assert.ok(safe);assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|email|privateToken/u);
  for(const change of[{status:'provider_accepted',eligible:true},{status:'unknown',eligible:true},{status:'rejected',eligible:true,retryRejected:false},{reason:'PRIVATE_ERROR'}, {registrationId:'short'}])assert.equal(deliveryReminderPreviewView({...value,rows:[{...value.rows[0],...change}]}),null);
  assert.equal(deliveryReminderPreviewView({...value,rows:[value.rows[0],value.rows[0]],total:2}),null);
  assert.equal(deliveryReminderPreviewView({...value,message:{...value.message,text:'missing private page placeholder'}}),null);
  assert.equal(deliveryReminderPreviewView({...value,total:0}),null);
  assert.equal(deliveryReminderPreviewView({...value,rows:[{...value.rows[0],status:'rejected',retryRejected:true}]}).rows[0].eligible,true);
});

test('a lost reminder POST acknowledgement is reconciled only by GET of the original operation',async()=>{
  const calls=[];let generated=0,revision=7;
  const controller=createReminderMutations({revision:()=>revision,operationId:()=>{generated++;return operationId;},request:async(path,options)=>{calls.push({path,...options});if(options.method==='POST')throw Object.assign(new Error('lost ACK'),{status:503});return reminderResult({outcome:'replayed'});}});
  await assert.rejects(controller.run({registrationIds:[id],retryRejected:false}));const original=controller.body;revision=99;
  await assert.rejects(controller.run({registrationIds:['x'.repeat(43)]}));assert.equal(generated,1);assert.equal(controller.pending,true);
  const result=await controller.lookup();assert.equal(result.results[0].status,'provider_accepted');assert.equal(controller.pending,false);
  assert.equal(calls.length,2);assert.equal(calls[0].method,'POST');assert.equal(calls[1].method,'GET');assert.equal(calls[1].path,'/api/admin/registration-confirmation/reminder-operation/'+operationId);assert.equal(calls[1].body,undefined);
  assert.equal(JSON.parse(original).expectedRevision,7);assert.equal(JSON.parse(original).operationId,operationId);
});

test('restoring a pending reminder preserves its raw request and never allocates a new operation',async()=>{
  const body=JSON.stringify({registrationIds:[id],retryRejected:false,expectedRevision:7,operationId}),calls=[];
  const controller=createReminderMutations({revision:()=>100,operationId:()=>{throw new Error('must not allocate');},request:async(path,options)=>{calls.push({path,...options});return reminderResult({outcome:'replayed'});}});
  controller.restore(body);assert.equal(controller.body,body);await controller.lookup();assert.deepEqual(calls,[{path:'/api/admin/registration-confirmation/reminder-operation/'+operationId,method:'GET'}]);
  for(const value of['',JSON.stringify({registrationIds:[id]}),JSON.stringify({registrationIds:[id,id],retryRejected:false,expectedRevision:7,operationId}),body+' '.repeat(16001)])assert.equal(deliveryReminderRequestView(value),null);
});

test('preview projections preserve bounded recipient revisions and normalize legacy rows without retaining private data',()=>{
  for(const [view,preview]of[[deliveryReminderPreviewView,reminderPreview],[deliveryConfirmationPreviewView,formalPreview]]){
    const value=preview();assert.equal(view(value).rows[0].accessRevision,0);
    assert.equal(view({...value,rows:[{...value.rows[0],accessRevision:3}]}).rows[0].accessRevision,3);
    for(const accessRevision of [-1,null,'3',0.5])assert.equal(view({...value,rows:[{...value.rows[0],accessRevision}]}),null);
    assert.equal(view({...value,rows:[{...value.rows[0],reason:'HISTORICAL_DELIVERY_UNKNOWN',eligible:false}]}).rows[0].eligible,false);
  }
});

test('new formal and reminder requests freeze exact selected recipient revisions and restored unknowns only GET the original operation',async()=>{
  for(const [create,result]of[[createConfirmationMutations,()=>formalResult()],[createReminderMutations,()=>reminderResult()]]){
    const calls=[],revisions={[id]:2};const controller=create({revision:()=>7,operationId:()=>operationId,request:async(path,options)=>{calls.push({path,...options});if(options.method==='POST')throw Object.assign(Error('lost ACK'),{status:503});return result();}});
    await assert.rejects(controller.run({registrationIds:[id],expectedAccessRevisions:revisions}));const body=controller.body;
    revisions[id]=99;assert.equal(JSON.parse(body).expectedAccessRevisions[id],2);
    controller.clear();controller.restore(body);await controller.lookup();
    assert.equal(calls.length,2);assert.equal(calls[1].method,'GET');assert.equal(calls[1].body,undefined);assert.equal(controller.pending,false);
  }
});

test('scoped pending requests require an exact revision map and accept a full 100-person batch within the HTTP limit',()=>{
  const original={registrationIds:[id],retryRejected:false,expectedRevision:7,operationId};
  assert.ok(deliveryReminderRequestView(JSON.stringify(original)));
  for(const expectedAccessRevisions of [null,[],{}, {[id]:-1},{[id]:null},{[id]:'1'},{[id]:0.5},{[id]:1,extra:0},{['n'.repeat(43)]:1}])assert.equal(deliveryReminderRequestView(JSON.stringify({...original,expectedAccessRevisions})),null);
  const ids=Array.from({length:100},(_,index)=>String(index).padStart(43,'0')),expectedAccessRevisions=Object.fromEntries(ids.map(value=>[value,Number.MAX_SAFE_INTEGER]));
  const body=JSON.stringify({...original,registrationIds:ids,expectedAccessRevisions});assert.ok(body.length>10000&&Buffer.byteLength(body)<16*1024);assert.ok(deliveryReminderRequestView(body));
});

test('unknown reminder results and missing original operations keep the original request locked',async()=>{
  let missing=false;const controller=createReminderMutations({revision:()=>7,operationId:()=>operationId,request:async()=>{if(missing)throw Object.assign(new Error('not found'),{status:404});return reminderResult({status:'partial',results:[{registrationId:id,status:'unknown'}]});}});
  const result=await controller.run({registrationIds:[id]});assert.equal(result.status,'partial');assert.equal(controller.pending,true);const body=controller.body;
  missing=true;await assert.rejects(controller.lookup());assert.equal(controller.pending,true);assert.equal(controller.body,body);
});

test('partial reminder results unlock only after every selected recipient has a verified outcome',async()=>{
  let complete=false;const controller=createReminderMutations({revision:()=>7,operationId:()=>operationId,request:async()=>reminderResult({status:'partial',results:complete?[{registrationId:id,status:'not_attempted'}]:[]})});
  await assert.rejects(controller.run({registrationIds:[id]}),/尚未完整/u);assert.equal(controller.pending,true);complete=true;
  const result=await controller.lookup();assert.equal(result.results[0].status,'not_attempted');assert.equal(controller.pending,false);
});

test('a cleared reminder session ignores a late operation lookup instead of replacing a newer pending request',async()=>{
  let release;const controller=createReminderMutations({revision:()=>7,operationId:()=>operationId,request:()=>new Promise(resolve=>{release=resolve;})});
  const body=JSON.stringify({registrationIds:[id],retryRejected:false,expectedRevision:7,operationId});controller.restore(body);const old=controller.lookup();controller.clear();
  const next=body.replace(operationId,'n'.repeat(43));controller.restore(next);release(reminderResult({outcome:'replayed'}));await assert.rejects(old,/会话已改变/u);assert.equal(controller.body,next);assert.equal(controller.pending,true);
});

test('a definite reminder validation conflict unlocks only after one rejected POST and never retries automatically',async()=>{
  const calls=[],controller=createReminderMutations({revision:()=>7,operationId:()=>operationId,request:async(path,options)=>{calls.push({path,...options});throw Object.assign(new Error('revision conflict'),{status:409});}});
  await assert.rejects(controller.run({registrationIds:[id]}));assert.equal(controller.pending,false);assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
});

test('formal preview requires its own source proof and cannot consume a reminder or expose private source fields',()=>{
  const value=formalPreview(),safe=deliveryConfirmationPreviewView(value);assert.ok(safe);assert.equal(safe.kind,'registration');assert.equal(safe.sourceRevision,value.sourceRevision);
  assert.doesNotMatch(JSON.stringify(safe),/PRIVATE|email|privateToken/u);
  for(const change of [{kind:'pre_event_reminder'},{sourceRevision:''},{sourceRevision:'A'.repeat(64)},{total:1001},{rows:[{...value.rows[0],reason:'REMINDER_WINDOW_CLOSED'}]}])assert.equal(deliveryConfirmationPreviewView({...value,...change}),null);
  assert.equal(deliveryReminderPreviewView(value),null);
});

test('one formal dispatch keeps the original four fields and reconciles a lost acknowledgement only by original GET',async()=>{
  const calls=[];let allocated=0,revision=7;
  const controller=createConfirmationMutations({revision:()=>revision,operationId:()=>{allocated++;return operationId;},request:async(path,options)=>{calls.push({path,...options});if(options.method==='POST')throw Object.assign(new Error('lost ACK'),{status:503});return formalResult();}});
  await assert.rejects(controller.run({registrationIds:[id]}));const original=controller.body;
  assert.deepEqual(Object.keys(JSON.parse(original)).sort(),['expectedRevision','operationId','registrationIds','retryRejected']);assert.equal(JSON.parse(original).expectedRevision,7);
  revision=99;await assert.rejects(controller.run({registrationIds:['n'.repeat(43)]}));assert.equal(allocated,1);
  const result=await controller.lookup();assert.equal(result.checkedAt,'2026-11-01T09:00:00.000Z');assert.equal(controller.pending,false);
  assert.deepEqual(calls.map(call=>[call.path,call.method]),[['/api/admin/registration-confirmation/dispatch','POST'],['/api/admin/registration-confirmation/operation/'+operationId,'GET']]);assert.equal(calls[1].body,undefined);
});

test('formal restore preserves whitespace and key order without another POST or a newly allocated operation',async()=>{
  const body='{ "operationId":"'+operationId+'", "retryRejected":false, "registrationIds":["'+id+'"], "expectedRevision":7 }',calls=[];
  const controller=createConfirmationMutations({revision:()=>100,operationId:()=>assert.fail('restoring must not allocate'),request:async(path,options)=>{calls.push({path,...options});return formalResult();}});
  controller.restore(body);assert.equal(controller.body,body);await controller.lookup();assert.deepEqual(calls,[{path:'/api/admin/registration-confirmation/operation/'+operationId,method:'GET'}]);
});

test('legacy parsed formal pending is GET-only and never gains reconstructed request bytes',async()=>{
  const value={action:'dispatch',registrationIds:[id],retryRejected:false,expectedRevision:2,operationId},before=structuredClone(value),calls=[];
  const controller=createConfirmationMutations({revision:()=>99,operationId:()=>assert.fail('legacy must not allocate'),request:async(path,options)=>{calls.push({path,...options});return formalResult();}});
  assert.ok(deliveryLegacyDispatchView(value));controller.restoreLegacy(value);assert.equal(controller.body,null);await assert.rejects(controller.run({registrationIds:[id]}));await controller.lookup();
  assert.deepEqual(value,before);assert.deepEqual(calls,[{path:'/api/admin/registration-confirmation/operation/'+operationId,method:'GET'}]);assert.equal(controller.pending,false);
  for(const patch of [{action:'settings'},{registrationIds:[id,id]},{operationId:''},{body:'{}'}])assert.equal(deliveryLegacyDispatchView({...value,...patch}),null);
});

test('formal unknown, unavailable and missing readbacks preserve the original lock and exact request',async()=>{
  for(const mode of ['unknown','unavailable',404,503]){
    const body=JSON.stringify({registrationIds:[id],retryRejected:false,expectedRevision:7,operationId}),calls=[];
    const controller=createConfirmationMutations({revision:()=>7,request:async(path,options)=>{calls.push({path,...options});if(typeof mode==='number')throw Object.assign(new Error('unavailable'),{status:mode});return formalResult({status:mode==='unknown'?'unknown':'partial',results:[{registrationId:id,status:mode}]});}});
    controller.restore(body);if(typeof mode==='number')await assert.rejects(controller.lookup());else await controller.lookup();
    assert.equal(controller.pending,true);assert.equal(controller.body,body);await assert.rejects(controller.run({registrationIds:[id]}));assert.equal(calls.length,1);assert.equal(calls[0].method,'GET');
  }
});

test('formal lookup requires correct kind, operation identity, server time and every original row in order',async()=>{
  const second='s'.repeat(43),body=JSON.stringify({registrationIds:[id,second],retryRejected:false,expectedRevision:7,operationId});
  for(const change of [{kind:'pre_event_reminder'},{operationId:'x'.repeat(43)},{checkedAt:null},{checkedAt:'2026-02-30T00:00:00.000Z'},{results:[{registrationId:id,status:'provider_accepted'}]},
    {results:[{registrationId:second,status:'provider_accepted'},{registrationId:id,status:'provider_accepted'}]}]){
    const controller=createConfirmationMutations({revision:()=>7,request:async()=>formalResult({...change})});controller.restore(body);await assert.rejects(controller.lookup());assert.equal(controller.body,body);assert.equal(controller.pending,true);
  }
  assert.equal(deliveryConfirmationOperationView(formalResult({checkedAt:undefined}),operationId),null);
});

test('formal rejects a reminder POST result and a late cleared lookup cannot unlock a newer original request',async()=>{
  const controller=createConfirmationMutations({revision:()=>7,operationId:()=>operationId,request:async()=>reminderResult()});
  await assert.rejects(controller.run({registrationIds:[id]}));assert.equal(controller.pending,true);
  let release;const other=createConfirmationMutations({revision:()=>7,request:()=>new Promise(resolve=>{release=resolve;})});
  const body=JSON.stringify({registrationIds:[id],retryRejected:false,expectedRevision:7,operationId});other.restore(body);const old=other.lookup();other.clear();
  const next=body.replace(operationId,'n'.repeat(43));other.restore(next);release(formalResult());await assert.rejects(old,/会话已改变/u);assert.equal(other.body,next);assert.equal(other.pending,true);
});

test('only a fresh first authoritative rejection can release a formal attempt without replaying its POST',async()=>{
  for(const status of [400,403,404,409]){
    const calls=[],controller=createConfirmationMutations({revision:()=>7,operationId:()=>operationId,request:async(path,options)=>{calls.push({path,...options});throw Object.assign(new Error('pre-start rejection'),{status});}});
    await assert.rejects(controller.run({registrationIds:[id]}));assert.equal(controller.knownRejected,true);assert.equal(controller.pending,true);
    controller.acknowledgeRejection();assert.equal(controller.pending,false);assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
  }
  for(const status of [401,422,503]){
    const controller=createConfirmationMutations({revision:()=>7,operationId:()=>operationId,request:async()=>{throw Object.assign(new Error('uncertain'),{status});}});
    await assert.rejects(controller.run({registrationIds:[id]}));assert.equal(controller.knownRejected,false);assert.throws(()=>controller.acknowledgeRejection());assert.equal(controller.pending,true);
  }
  const body=JSON.stringify({registrationIds:[id],retryRejected:false,expectedRevision:7,operationId});
  for(const status of [404,409]){
    const controller=createConfirmationMutations({revision:()=>7,request:async()=>{throw Object.assign(new Error('restored lookup'),{status});}});controller.restore(body);
    await assert.rejects(controller.lookup());assert.equal(controller.knownRejected,false);assert.throws(()=>controller.acknowledgeRejection());assert.equal(controller.body,body);
  }
});
