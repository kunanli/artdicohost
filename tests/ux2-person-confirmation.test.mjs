import test from 'node:test';
import assert from 'node:assert/strict';
import {createPersonConfirmation,personConfirmationScope,personConfirmationPolicy,validPersonConfirmation,validPersonConfirmationOperation} from '../src/lib/person-confirmation.mjs';

const A='a'.repeat(43),B='b'.repeat(43),OP='x'.repeat(32),checkedAt='2026-11-01T09:00:00.000Z';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function until(check){for(let n=0;n<100;n++){if(check())return;await pause();}assert.fail('controller did not settle');}
function uiNode(tagName=''){
  return{tagName,dataset:{},children:[],listeners:new Map(),disabled:false,_text:'',
    get textContent(){return this._text+this.children.map(value=>typeof value==='string'?value:value.textContent).join('');},
    set textContent(value){this._text=String(value);this.children=[];},
    addEventListener(type,fn){this.listeners.set(type,fn);},append(...values){this.children.push(...values);}};
}
globalThis.document={createElement:tagName=>uiNode(tagName.toUpperCase())};
function fixture(){
  const controls=new Map(),root={hidden:true,querySelector(selector){if(!controls.has(selector))controls.set(selector,uiNode());return controls.get(selector);}};
  const records=new Map(),listeners=new Map(),epochs=new Map(),calls=[],writes=[],gates=[],readGates=[],checks=[];
  let user={id:'synthetic-owner',roles:['outreach','reviewer']},failWrite=false,delayWrite=false,delayRead=false,lost=false,lookupStatus='provider_accepted',lookupError=null,postError=null,deliveryUnknown=false,deliveryError=null,deliveryAccepted=false,requestGate=null,accessRevision=0,deliveryState=null,afterSendState=null;
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
    if(path.includes('/send/')){if(requestGate)await requestGate;if(postError||JSON.parse(options.body).expectedAccessRevision!==(accessRevision??0))throw Object.assign(Error('synthetic rejection'),{status:postError??409});if(lost)throw Error('synthetic lost ACK');if(afterSendState)deliveryState=afterSendState;return result(path.split('/').at(-1),JSON.parse(options.body).operationId);}
    if(path.includes('/operation/')){if(lookupError)throw Object.assign(Error('synthetic lookup unavailable'),{status:lookupError});const saved=[...records.values()].find(value=>value.record&&JSON.parse(value.record.value.payloadJson).operationId===path.split('/').at(-1));const id=saved?.record.value.path.split('/').at(-1)??A;return result(id,path.split('/').at(-1),true);}
    if(deliveryError)throw Object.assign(Error('synthetic delivery unavailable'),{status:deliveryError});
    const id=path.split('/').at(-1),canSend=user?.roles.includes('outreach')&&user?.roles.includes('reviewer');return{registrationId:id,revision:2,...(accessRevision===undefined?{}:{accessRevision}),admissionStatus:'confirmed',status:deliveryUnknown?'unknown':deliveryAccepted?'provider_accepted':'not_sent',reason:deliveryUnknown?'DELIVERY_UNKNOWN':deliveryAccepted?'ALREADY_ACCEPTED':canSend?'ELIGIBLE':'OPERATOR_PERMISSION_REQUIRED',ready:Boolean(canSend&&!deliveryUnknown&&!deliveryAccepted),canSend:Boolean(canSend),retryRejected:false,recipient:'synthetic@example.invalid',...(deliveryState??{})};
  }
  const create=()=>createPersonConfirmation({root,request,getUser:()=>user,draftStore:store,eventId:'synthetic-event',onChecked:value=>checks.push(value)});
  const click=name=>controls.get('[data-person-confirmation-'+name+']').listeners.get('click')();
  return{root,controls,records,writes,calls,gates,readGates,checks,store,create,click,get user(){return user;},set user(v){user=v;},set accessRevision(v){accessRevision=v;},set failWrite(v){failWrite=v;},set delayWrite(v){delayWrite=v;},set delayRead(v){delayRead=v;},set lost(v){lost=v;},set lookupStatus(v){lookupStatus=v;},set lookupError(v){lookupError=v;},set postError(v){postError=v;},set deliveryUnknown(v){deliveryUnknown=v;},set deliveryError(v){deliveryError=v;},set deliveryAccepted(v){deliveryAccepted=v;},set requestGate(v){requestGate=v;},set deliveryState(v){deliveryState=v;},set afterSendState(v){afterSendState=v;}};
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
  const original=f.calls.find(x=>x.method==='POST');assert.equal(original.body,f.writes[0].payloadJson);assert.deepEqual(Object.keys(JSON.parse(original.body)),['expectedRevision','operationId','retryRejected','expectedAccessRevision']);assert.equal(JSON.parse(original.body).expectedAccessRevision,0);
  assert.deepEqual(Object.keys(f.writes[0]),['path','method','payloadJson']);assert.doesNotMatch(JSON.stringify(f.writes),/synthetic@example|recipient|confirmationUrl|receiptToken/u);c.clear();
});
test('single send freezes the displayed recipient revision and a stale rejection refreshes without automatically sending again',async()=>{
  const f=fixture();f.accessRevision=2;const c=f.create();await c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);
  f.delayWrite=true;f.click('send');await until(()=>f.gates.length===1);f.accessRevision=3;f.gates[0].resolve();
  await until(()=>f.calls.some(call=>call.method==='POST')&&!c.pending&&!f.controls.get('[data-person-confirmation-send]').disabled);
  assert.equal(JSON.parse(f.calls.find(call=>call.method==='POST').body).expectedAccessRevision,2);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1,'409 only refreshes the current recipient');
  f.delayWrite=false;f.click('send');await until(()=>f.calls.filter(call=>call.method==='POST').length===2&&!c.pending);
  assert.equal(JSON.parse(f.calls.filter(call=>call.method==='POST')[1].body).expectedAccessRevision,3);c.clear();
});
test('legacy delivery reads normalize to revision zero while pending request validation accepts only bounded old or new shapes',async()=>{
  const f=fixture();f.accessRevision=undefined;const c=f.create();await c.select(A);await until(()=>!f.controls.get('[data-person-confirmation-send]').disabled);
  const delivery={registrationId:A,revision:2,admissionStatus:'confirmed',status:'not_sent',reason:'ELIGIBLE',ready:true,canSend:true,retryRejected:false,recipient:'synthetic@example.invalid'};
  assert.equal(validPersonConfirmation(delivery,A),true);
  for(const value of [-1,null,'1',0.5])assert.equal(validPersonConfirmation({...delivery,accessRevision:value},A),false);
  const original={expectedRevision:2,operationId:OP,retryRejected:false},policy=personConfirmationPolicy(A),valid=body=>policy.validate({path:'/api/admin/registration-confirmation/send/'+A,method:'POST',payloadJson:JSON.stringify(body)},{kind:'pending_submission'});
  assert.equal(valid(original),true);assert.equal(valid({...original,expectedAccessRevision:2}),true);
  for(const value of [-1,null,'1',0.5])assert.equal(valid({...original,expectedAccessRevision:value}),false);
  assert.equal(valid({...original,expectedAccessRevision:2,recipient:'private@example.invalid'}),false);
  f.click('send');await until(()=>f.calls.some(call=>call.method==='POST')&&!c.pending);
  assert.equal(JSON.parse(f.calls.find(call=>call.method==='POST').body).expectedAccessRevision,0);c.clear();
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

const recoveryState={status:'rejected',reason:'RETRY_LIMIT',ready:false,canSend:true,retryRejected:true,canRecover:true};
test('recovery eligibility and diagnostic fields are strict while legacy missing evidence remains valid',()=>{
  const value={registrationId:A,revision:2,accessRevision:3,admissionStatus:'confirmed',recipient:'synthetic@example.invalid',...recoveryState};
  assert.equal(validPersonConfirmation(value,A),true);
  for(const patch of[{canRecover:false},{canRecover:'true'},{ready:true},{canSend:false},{reason:'RECOVERY_USED'},{status:'unknown',retryRejected:false},{status:'provider_accepted',retryRejected:false},{admissionStatus:'waitlisted'},{accessRevision:undefined},{retryRejected:false}])assert.equal(validPersonConfirmation({...value,...patch},A),false);
  const {canRecover,accessRevision,...legacy}=value;assert.equal(validPersonConfirmation(legacy,A),true);
  assert.equal(validPersonConfirmation({...value,diagnostic:{code:'PROVIDER_REJECTED',transportStarted:true,httpStatus:403}},A),true);
  assert.equal(validPersonConfirmation({...value,diagnostic:{code:'DELIVERY_GUARD_BLOCKED',transportStarted:false}},A),true);
  assert.equal(validPersonConfirmation({...value,diagnostic:{code:'DELIVERY_UNKNOWN',transportStarted:true}},A),false,'a rejected notice cannot carry an ambiguous transport result');
  const uncertain={...legacy,status:'unknown',reason:'DELIVERY_UNKNOWN',retryRejected:false,diagnostic:{code:'DELIVERY_UNKNOWN',transportStarted:true}};
  assert.equal(validPersonConfirmation(uncertain,A),true);
  assert.equal(validPersonConfirmation({...uncertain,diagnostic:{code:'DELIVERY_GUARD_BLOCKED',transportStarted:false}},A),false,'unknown cannot masquerade as proven not started');
  for(const diagnostic of[{code:'PRIVATE_PROVIDER_BODY',transportStarted:true},{code:'PROVIDER_REJECTED',transportStarted:false,httpStatus:403},{code:'PROVIDER_REJECTED',transportStarted:true,httpStatus:503},{code:'PROVIDER_REJECTED',transportStarted:true,httpStatus:403,body:'PRIVATE'}])assert.equal(validPersonConfirmation({...value,diagnostic},A),false);
});
test('pending policy accepts recovery only with true retry permission and a bounded explicit recipient revision',()=>{
  const policy=personConfirmationPolicy(A),valid=body=>policy.validate({path:'/api/admin/registration-confirmation/send/'+A,method:'POST',payloadJson:JSON.stringify(body)},{kind:'pending_submission'});
  const body={expectedRevision:2,operationId:OP,retryRejected:true,expectedAccessRevision:3,recoverRejected:true};assert.equal(valid(body),true);
  for(const patch of[{recoverRejected:false},{recoverRejected:1},{retryRejected:false},{expectedAccessRevision:undefined},{expectedAccessRevision:null},{expectedAccessRevision:-1},{recipient:'PRIVATE'},{other:true}])assert.equal(valid({...body,...patch}),false);
  const {recoverRejected,expectedAccessRevision,...legacy}=body;assert.equal(valid(legacy),true);
});
test('repair retry explicitly confirms EmailJS repair for one person, and cancellation performs no write or POST',async()=>{
  const f=fixture();f.deliveryState=recoveryState;const c=f.create();await c.select(A);
  const send=f.controls.get('[data-person-confirmation-send]'),status=f.controls.get('[data-person-confirmation-status]');assert.equal(send.disabled,false);assert.equal(send.textContent,'修复后重试一次');
  const link=status.children.find(node=>typeof node==='object'&&node.dataset.personConfirmationSettings==='');assert.equal(link.href,'/admin/settings/delivery/');
  const confirmations=[],previous=globalThis.confirm;try{globalThis.confirm=message=>{confirmations.push(message);return false;};f.click('send');await pause();}finally{globalThis.confirm=previous;}
  assert.equal(confirmations.length,1);assert.match(confirmations[0],/EmailJS.*已修复/u);assert.match(confirmations[0],/这位.*一次/u);assert.equal(f.writes.length,0);assert.equal(f.calls.some(call=>call.method==='POST'),false);assert.equal(c.pending,false);c.clear();
});
test('repair retry is stored before one POST and accepted results disable the old recovery action',async()=>{
  const f=fixture();f.accessRevision=3;f.deliveryState=recoveryState;f.afterSendState={status:'provider_accepted',reason:'ALREADY_ACCEPTED',ready:false,retryRejected:false};f.delayWrite=true;
  const c=f.create();await c.select(A);f.click('send');await until(()=>f.gates.length===1);assert.equal(f.calls.some(call=>call.method==='POST'),false);
  const original=f.writes[0].payloadJson;assert.deepEqual(JSON.parse(original),{expectedRevision:2,operationId:JSON.parse(original).operationId,retryRejected:true,expectedAccessRevision:3,recoverRejected:true});
  f.gates[0].resolve();await until(()=>f.calls.some(call=>call.method==='POST')&&!c.pending&&!c.blocked);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(f.calls.find(call=>call.method==='POST').body,original);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);
  f.click('send');await pause();assert.equal(f.calls.filter(call=>call.method==='POST').length,1);c.clear();
});
test('raw recovery pending survives reload unchanged and only looks up the original operation',async()=>{
  const f=fixture(),scope=personConfirmationScope(f.user,A,'synthetic-event');
  const raw='{ "recoverRejected":true, "operationId":"'+OP+'", "retryRejected":true, "expectedAccessRevision":3, "expectedRevision":2 }';
  const value={path:'/api/admin/registration-confirmation/send/'+A,method:'POST',payloadJson:raw};
  f.records.set(JSON.stringify(scope),{revision:1,actorEpoch:0,record:{kind:'pending_submission',baseRevision:2,value}});f.lookupStatus='unknown';
  const c=f.create();await c.select(A);assert.equal(c.pending,true);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);
  assert.deepEqual(f.calls.map(call=>[call.path,call.method,call.body]),[['/api/admin/registration-confirmation/operation/'+OP,'GET',undefined]]);
  assert.equal([...f.records.values()][0].record.value.payloadJson,raw);f.click('send');await pause();assert.equal(f.calls.length,1);
  f.lookupError=404;await c.refresh();assert.equal(c.pending,true);assert.equal([...f.records.values()][0].record.value.payloadJson,raw);
  f.lookupError=null;f.lookupStatus='provider_accepted';f.deliveryAccepted=true;await c.refresh();assert.equal(c.pending,false);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);assert.equal(f.calls.some(call=>call.method==='POST'),false);c.clear();
});
test('only fixed safe diagnostics render and old retry-limit records do not invent a cause',async()=>{
  const f=fixture(),c=f.create();f.deliveryState={...recoveryState,diagnostic:{code:'PROVIDER_REJECTED',transportStarted:true,httpStatus:403}};await c.select(A);
  assert.match(f.controls.get('[data-person-confirmation-status]').textContent,/EmailJS拒绝请求（HTTP 403）/u);
  f.deliveryState={...recoveryState,diagnostic:{code:'DELIVERY_GUARD_UNAVAILABLE',transportStarted:false}};await c.refresh();assert.match(f.controls.get('[data-person-confirmation-status]').textContent,/发送前核对未通过/u);
  f.deliveryState={status:'rejected',reason:'RETRY_LIMIT',ready:false,retryRejected:true};await c.refresh();assert.doesNotMatch(f.controls.get('[data-person-confirmation-status]').textContent,/HTTP|发送前核对|EmailJS拒绝/u);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);
  f.deliveryState={status:'rejected',reason:'RECOVERY_USED',ready:false,retryRejected:true};await c.refresh();assert.match(f.controls.get('[data-person-confirmation-status]').textContent,/单次重试已使用/u);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);
  c.clear();assert.equal(f.controls.get('[data-person-confirmation-status]').textContent,'');assert.equal(f.controls.get('[data-person-confirmation-recipient]').textContent,'');
});
test('repair recovery obeys current recipient revisions and person or actor switches before local ACK',async()=>{
  for(const change of['person','actor','access']){
    const f=fixture();f.accessRevision=2;f.deliveryState=recoveryState;f.delayWrite=true;const c=f.create();await c.select(A);f.click('send');await until(()=>f.gates.length===1);
    if(change==='person'){f.deliveryState=null;await c.select(B);}else if(change==='actor'){f.user={id:'other-owner',roles:['reviewer','outreach']};f.deliveryState=null;await c.select(A);}else{f.accessRevision=3;f.deliveryState={status:'rejected',reason:'RECOVERY_USED',ready:false,retryRejected:true};}
    f.gates[0].resolve();await pause();await pause();
    if(change==='access'){await until(()=>!c.pending&&!c.blocked);assert.equal(f.calls.filter(call=>call.method==='POST').length,1);assert.equal(JSON.parse(f.calls.find(call=>call.method==='POST').body).expectedAccessRevision,2);assert.equal(f.controls.get('[data-person-confirmation-send]').disabled,true);}
    else assert.equal(f.calls.some(call=>call.method==='POST'),false);
    c.clear();
  }
});
