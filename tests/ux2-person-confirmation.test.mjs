import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonConfirmation,personConfirmationScope,personConfirmationPolicy,validPersonConfirmationOperation} from '../src/lib/person-confirmation.mjs';

const A='a'.repeat(43),B='b'.repeat(43),OP='x'.repeat(32),checkedAt='2026-11-01T09:00:00.000Z';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<100;n++){if(check())return;await pause();}assert.fail('controller did not settle');}
function fixture(){
  const controls=new Map(),root={hidden:true,querySelector(selector){if(!controls.has(selector))controls.set(selector,{textContent:'',disabled:false,listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},append(){}});return controls.get(selector);}};
  const records=new Map(),listeners=new Map(),epochs=new Map(),calls=[],writes=[],gates=[],readGates=[],checks=[];
  let user={id:'synthetic-owner',roles:['outreach','reviewer']},failWrite=false,delayWrite=false,delayRead=false,lost=false,lookupStatus='provider_accepted',lookupError=null,postError=null,deliveryUnknown=false,deliveryError=null,deliveryAccepted=false,requestGate=null;
  const key=scope=>JSON.stringify(scope),copy=value=>structuredClone(value);
  const observed=scope=>copy(records.get(key(scope))??{revision:0,actorEpoch:epochs.get(scope.actorId)??0,record:null});
  const emit=(scope,event)=>{for(const fn of listeners.get(key(scope))??[])fn(event);};
  const store={async read(scope,policy){if(delayRead)await new Promise(resolve=>readGates.push({id:scope.entityId,resolve}));const value=observed(scope);if(value.record)assert.equal(policy.validate(value.record.value,{kind:value.record.kind}),true);return value;},async write(scope,input,policy){
    assert.equal(policy.validate(input.value,{kind:input.kind}),true);writes.push(copy(input.value));if(failWrite)throw Error('synthetic quota');
    if(delayWrite)await new Promise(resolve=>gates.push({id:scope.entityId,resolve}));
    const old=observed(scope);assert.equal(input.expectedRevision,old.revision);assert.equal(input.actorEpoch,old.actorEpoch);
    const saved={revision:old.revision+1,actorEpoch:old.actorEpoch,record:{kind:input.kind,baseRevision:input.baseRevision,value:copy(input.value)}};records.set(key(scope),saved);emit(scope,{type:'change',revision:saved.revision,actorEpoch:saved.actorEpoch});return copy(saved);
  },async remove(scope,input){const old=observed(scope);assert.equal(input.expectedRevision,old.revision);assert.equal(input.actorEpoch,old.actorEpoch);assert.equal(input.allowPending,true);const saved={revision:old.revision+1,actorEpoch:old.actorEpoch,record:null};records.set(key(scope),saved);emit(scope,{type:'change',revision:saved.revision,actorEpoch:saved.actorEpoch});return copy(saved);},subscribe(scope,fn){const set=listeners.get(key(scope))??new Set();set.add(fn);listeners.set(key(scope),set);return()=>set.delete(fn);},async clearActor(actorId){epochs.set(actorId,(epochs.get(actorId)??0)+1);for(const [k]of records)if(JSON.parse(k).actorId===actorId)records.delete(k);for(const [k,set]of listeners)if(JSON.parse(k).actorId===actorId)for(const fn of set)fn({type:'actor_cleared',actorEpoch:epochs.get(actorId)});}};
  const result=(id,operationId,lookup=false)=>({outcome:lookup?'replayed':'updated',revision:3,operationId,status:['unknown','unavailable','not_attempted'].includes(lookupStatus)?'partial':'completed',results:[{registrationId:id,status:lookupStatus}],...(lookup?{kind:'registration',checkedAt}:{})});
  async function request(path,options={}){
    calls.push({path,method:options.method??'GET',body:options.body});
    if(path.includes('/send/')){if(requestGate)await requestGate;if(postError)throw Object.assign(Error('synthetic rejection'),{status:postError});if(lost)throw Error('synthetic lost ACK');return result(path.split('/').at(-1),JSON.parse(options.body).operationId);}
    if(path.includes('/operation/')){if(lookupError)throw Object.assign(Error('synthetic lookup unavailable'),{status:lookupError});const saved=[...records.values()].find(value=>value.record&&JSON.parse(value.record.value.payloadJson).operationId===path.split('/').at(-1));const id=saved?.record.value.path.split('/').at(-1)??A;return result(id,path.split('/').at(-1),true);}
    if(deliveryError)throw Object.assign(Error('synthetic delivery unavailable'),{status:deliveryError});
    const id=path.split('/').at(-1),canSend=user?.roles.includes('outreach')&&user?.roles.includes('reviewer');return{registrationId:id,revision:2,admissionStatus:'confirmed',status:deliveryUnknown?'unknown':deliveryAccepted?'provider_accepted':'not_sent',reason:deliveryUnknown?'DELIVERY_UNKNOWN':deliveryAccepted?'ALREADY_ACCEPTED':canSend?'ELIGIBLE':'OPERATOR_PERMISSION_REQUIRED',ready:Boolean(canSend&&!deliveryUnknown&&!deliveryAccepted),canSend:Boolean(canSend),retryRejected:false,recipient:'synthetic@example.invalid'};
  }
  const create=()=>createPersonConfirmation({root,request,getUser:()=>user,draftStore:store,eventId:'synthetic-event',onChecked:value=>checks.push(value)});
  const click=name=>controls.get('[data-person-confirmation-'+name+']').listeners.get('click')();
  return{root,controls,records,writes,calls,gates,readGates,checks,store,create,click,get user(){return user;},set user(v){user=v;},set failWrite(v){failWrite=v;},set delayWrite(v){delayWrite=v;},set delayRead(v){delayRead=v;},set lost(v){lost=v;},set lookupStatus(v){lookupStatus=v;},set lookupError(v){lookupError=v;},set postError(v){postError=v;},set deliveryUnknown(v){deliveryUnknown=v;},set deliveryError(v){deliveryError=v;},set deliveryAccepted(v){deliveryAccepted=v;},set requestGate(v){requestGate=v;}};
}
globalThis.confirm=()=>true;
test('passive initialization exposes its exact settling promise, so explicit next can await local recovery once',async()=>{
  const f=fixture(),c=f.create();f.delayRead=true;let finished=false;const first=c.select(A,{activate:false});first.then(()=>{finished=true;});await until(()=>f.readGates.length===1);assert.equal(c.blocked,true);assert.equal(c.settled,first);await pause();assert.equal(finished,false);
  const second=c.select(B,{activate:false});await until(()=>f.readGates.length===2);assert.equal(c.settled,second);f.readGates[0].resolve();await first;assert.equal(c.blocked,true,'old selection settling does not unlock the new selected person');f.readGates[1].resolve();await second;assert.equal(c.blocked,false);assert.equal(f.calls.length,0,'passive selection never invents a delivery or send request');c.clear();
});
test('durable single request ACK precedes POST; raw record has no recipient or capability',async()=>{
  const f=fixture(),c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);
  f.delayWrite=true;f.click('send');await until(()=>f.gates.length===1);assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
  f.gates[0].resolve();await until(()=>f.calls.some(x=>x.method==='POST'));await until(()=>!c.blocked);
  const original=f.calls.find(x=>x.method==='POST');assert.equal(original.body,f.writes[0].payloadJson);assert.deepEqual(Object.keys(JSON.parse(original.body)),['expectedRevision','operationId','retryRejected']);
  assert.deepEqual(Object.keys(f.writes[0]),['path','method','payloadJson']);assert.doesNotMatch(JSON.stringify(f.writes),/synthetic@example|recipient|confirmationUrl|receiptToken/u);c.clear();
});
test('storage denial prevents all send POSTs',async()=>{
  const f=fixture(),c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.failWrite=true;f.click('send');await until(()=>f.writes.length===1);await pause();assert.equal(f.calls.some(x=>x.method==='POST'),false);assert.equal(c.blocked,true);c.clear();
});
test('reload checks only original operation; 404/503/unknown/unavailable retain the exact local lock',async()=>{
  const f=fixture();let c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.lost=true;f.click('send');await until(()=>c.pending);await until(()=>f.calls.some(x=>x.method==='POST'));await pause();c.clear();
  const body=f.calls.find(x=>x.method==='POST').body,operation=JSON.parse(body).operationId;
  for(const value of [404,503,'unknown','unavailable']){
    f.lookupError=typeof value==='number'?value:null;f.lookupStatus=typeof value==='string'?value:'provider_accepted';c=f.create();c.select(A);await until(()=>f.calls.at(-1)?.path.endsWith(operation));await pause();assert.equal(c.pending,true);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);c.clear();
  }
  f.lookupError=null;f.lookupStatus='provider_accepted';c=f.create();c.select(A);await until(()=>!c.pending&&f.calls.at(-1)?.path.endsWith('/delivery/'+A));assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(f.calls.find(x=>x.method==='POST').body,body);c.clear();
});
test('a complete original not_attempted receipt releases only local pending and rereads eligibility without sending',async()=>{
  const f=fixture();let c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.lost=true;f.click('send');await until(()=>c.pending);await until(()=>f.calls.some(x=>x.method==='POST'));await pause();c.clear();
  f.lookupStatus='not_attempted';const before=f.calls.length;c=f.create();c.select(A);await until(()=>!c.pending&&!c.blocked);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal(f.calls.slice(before).some(x=>x.path==='/api/admin/registration-confirmation/delivery/'+A),true);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,false);
  assert.equal(f.calls.slice(before).some(x=>x.method==='POST'),false);c.clear();
});
test('only a validated original operation GET supplies server checkedAt; ordinary delivery reads invent no audit time',async()=>{
  const f=fixture();let c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);assert.deepEqual(f.checks,[]);f.lost=true;f.click('send');await until(()=>c.pending);await pause();assert.deepEqual(f.checks,[]);c.clear();
  f.lookupError=404;c=f.create();c.select(A);await until(()=>f.calls.at(-1)?.path.includes('/operation/'));await pause();assert.deepEqual(f.checks,[]);c.clear();
  f.lookupError=null;f.lookupStatus='unknown';c=f.create();c.select(A);await until(()=>f.checks.length===1);assert.deepEqual(f.checks,[{registrationId:A,checkedAt}]);assert.equal(c.pending,true);c.clear();
});
test('an actor or role switch while local ACK is pending prevents the first POST',async()=>{
  for(const switched of [{id:'other-owner',roles:['outreach','reviewer']},{id:'synthetic-owner',roles:['reviewer']}]){
    const f=fixture(),c=f.create();f.delayWrite=true;c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.click('send');await until(()=>f.gates.length===1);f.user=switched;f.gates[0].resolve();await pause();await pause();assert.equal(f.calls.some(x=>x.method==='POST'),false);assert.equal([...f.records.values()].some(x=>x.record?.kind==='pending_submission'),true);c.clear();
  }
});
test('roles isolate pending recovery; explicit logout clears it and a new session only reads cloud state',async()=>{
  const f=fixture();let c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.lost=true;f.click('send');await until(()=>c.pending);await pause();c.clear();
  const calls=f.calls.length;f.user={id:'synthetic-owner',roles:['reviewer']};c=f.create();c.select(A);await until(()=>f.calls.length>calls);assert.equal(f.calls.slice(calls).some(x=>x.path.includes('/operation/')),false);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);c.clear();
  f.user={id:'synthetic-owner',roles:['reviewer','outreach']};await f.store.clearActor(f.user.id);f.deliveryUnknown=true;const start=f.calls.length;c=f.create();c.select(A);await until(()=>f.calls.length>start);assert.equal(c.pending,false);assert.equal(f.calls.slice(start).some(x=>x.path.includes('/operation/')),false);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);c.clear();
});
test('a late ACK after selecting another person never sends the old request or corrupts the new writing generation',async()=>{
  const f=fixture(),c=f.create();f.delayWrite=true;c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.click('send');await until(()=>f.gates.length===1);
  c.select(B);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.click('send');await until(()=>f.gates.length===2);
  f.gates[0].resolve();await pause();assert.equal(f.calls.some(x=>x.path.endsWith('/send/'+A)),false);
  f.gates[1].resolve();await until(()=>f.calls.some(x=>x.path.endsWith('/send/'+B)));await until(()=>!c.blocked);assert.equal(f.controls.get('[data-person-confirmation-status]').textContent.includes('另一页'),false);c.clear();
});
test('first definite pre-start 409 may release only its new request; no same-body repost follows',async()=>{
  const f=fixture(),c=f.create();f.postError=409;c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.click('send');await until(()=>f.calls.some(x=>x.method==='POST'));await until(()=>!c.pending&&!c.blocked);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);assert.equal([...f.records.values()].every(x=>!x.record),true);c.clear();
});
test('accepted POST followed by failed state read clears stale eligibility and blocks send and navigation until fresh read',async()=>{
  for(const status of [404,503]){
    const f=fixture(),c=f.create();c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);f.deliveryError=status;f.click('send');await until(()=>f.calls.some(x=>x.method==='POST'));await until(()=>f.controls.get('[data-person-confirmation-status]').textContent.includes('当前寄送状态暂时无法核对'));
    assert.equal(c.pending,false);assert.equal(c.blocked,true);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);assert.equal(f.controls.get('[data-person-confirmation-recipient]').textContent,'');f.click('send');await pause();assert.equal(f.calls.filter(x=>x.method==='POST').length,1);
    f.deliveryError=null;f.deliveryAccepted=true;await c.refresh();assert.equal(c.blocked,false);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);assert.equal(f.calls.filter(x=>x.method==='POST').length,1);c.clear();
  }
});
test('operation receipts must bind kind, original ordered ID, operation and server read timestamp',()=>{
  const valid={outcome:'replayed',revision:2,operationId:OP,status:'completed',results:[{registrationId:A,status:'provider_accepted'}],kind:'registration',checkedAt};
  const context={registrationId:A,operationId:OP,lookup:true};assert.equal(validPersonConfirmationOperation(valid,context),true);
  for(const patch of [{kind:'pre_event_reminder'},{checkedAt:'unknown'},{operationId:'z'.repeat(32)},{results:[{registrationId:B,status:'provider_accepted'}]},{results:[...valid.results,...valid.results]},{results:[{...valid.results[0],email:'private@example.invalid'}]}])assert.equal(validPersonConfirmationOperation({...valid,...patch},context),false);
  const scope=personConfirmationScope({id:'actor',roles:['reviewer','outreach']},A,'event');assert.equal(scope.page,'person-confirmation:roles=outreach,reviewer');
  assert.equal(personConfirmationPolicy(A).validate({path:'/api/admin/registration-confirmation/send/'+A,method:'POST',payloadJson:JSON.stringify({expectedRevision:1,operationId:OP,retryRejected:false,recipient:'private'})},{kind:'pending_submission'}),false);
});
