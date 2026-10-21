import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeliveryMutations,deliverySettingsView} from '../src/lib/delivery-settings.mjs';
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
  const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>0,request:async(path,options)=>{calls.push({path,...options});if(!attempt++)throw Object.assign(new Error('uncertain'),{status:503});return{...state(),outcome:'replayed'};}});
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
  resolvers[1]({...state(),outcome:'updated'});await current;assert.equal(controller.pending,false);
});
test('definite validation rejection unlocks edits without creating an automatic second request',async()=>{
  let calls=0;const controller=createDeliveryMutations({operationId:()=>operationId,revision:()=>2,request:async()=>{calls++;throw Object.assign(new Error('invalid'),{status:422});}});
  await assert.rejects(controller.run('settings',{enabled:true}));assert.equal(controller.pending,false);assert.equal(calls,1);
});
