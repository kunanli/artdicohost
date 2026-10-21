import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionAdminState, createAdmissionOperations} from '../src/lib/admission-admin.mjs';

const ids = ['a','b','c','d'].map(value => value.repeat(43));
const teamId = 't_' + 'x'.repeat(22);
function state(patch = {}) {
  return {
    revision:5,
    settings:{capacity:4,staffReserve:1,waitlistEnabled:true},
    summary:{capacity:4,staffReserve:1,waitlistEnabled:true,confirmedCount:2,attendeeConfirmedCount:1,crewConfirmedCount:1,waitlistCount:1,remainingPublic:2,remainingTotal:2},
    people:[
      {registrationId:ids[0],kind:'attendee',status:'confirmed',queueNumber:1,teamId},
      {registrationId:ids[1],kind:'crew',status:'confirmed',queueNumber:2,teamId},
      {registrationId:ids[2],kind:'attendee',status:'waitlisted',queueNumber:3,teamId:''},
      {registrationId:ids[3],kind:'attendee',status:'withdrawn',queueNumber:4,teamId:''},
    ],
    teams:[{id:teamId,name:'合成实际两人团队',memberIds:[ids[0],ids[1]]}],
    auditCount:1,
    ...patch,
  };
}
function rejection(status) { const error = new Error('synthetic rejection'); error.status = status; return error; }

test('admin state counts individual registrations, including linked teams, crew, waitlist and withdrawals', () => {
  const value=state();
  assert.deepEqual(admissionAdminState(value),{...value,summary:{...value.summary,pendingReviewCount:0,rejectedCount:0}});
  assert.equal(admissionAdminState(value).summary.confirmedCount,2);
  assert.equal(admissionAdminState(value).teams[0].memberIds.length,2);
  const noTeam=state({teams:[],people:state().people.map(person=>({...person,teamId:''}))});
  assert.ok(admissionAdminState(noTeam));
});

test('admin state rejects inconsistent individual counts or settings before enabling admission controls', () => {
  for (const patch of [
    {revision:-1}, {settings:{...state().settings,staffReserve:0}},
    {summary:{...state().summary,confirmedCount:3,attendeeConfirmedCount:2,remainingTotal:1}},
    {summary:{...state().summary,crewConfirmedCount:0,attendeeConfirmedCount:2}},
    {summary:{...state().summary,waitlistCount:0}},
    {people:[...state().people,state().people[0]]},
    {people:state().people.map((person,index)=>index===0?{...person,registrationId:'short'}:person)},
    {people:state().people.map((person,index)=>index===0?{...person,kind:'group'}:person)},
    {people:state().people.map((person,index)=>index===0?{...person,status:'registered'}:person)},
    {people:state().people.map((person,index)=>index===0?{...person,queueNumber:0}:person)},
    {people:state().people.map((person,index)=>index===0?{...person,queueNumber:2}:person)},
  ]) assert.equal(admissionAdminState(state(patch)),null);
});

test('admin state rejects missing, duplicate and contradictory team membership references', () => {
  for (const teams of [
    [{id:'short',name:'合成',memberIds:[ids[0],ids[1]]}],
    [{id:teamId,name:'合成',memberIds:[ids[0],ids[1],'z'.repeat(43)]}],
    [{id:teamId,name:'合成',memberIds:[ids[0],ids[0],ids[1]]}],
    [{id:teamId,name:'合成',memberIds:[ids[0]]}],
    [{id:teamId,name:'合成',memberIds:[]}],
    [{id:teamId,name:'合成',memberIds:[ids[0],ids[1]]},{id:'t_'+'y'.repeat(22),name:'另一组合成',memberIds:[ids[0]]}],
  ]) assert.equal(admissionAdminState(state({teams})),null);
  const unknown=state();unknown.people[0].teamId='t_'+'z'.repeat(22);
  assert.equal(admissionAdminState(unknown),null);
  const blank=state();blank.teams[0].name='  ';
  assert.equal(admissionAdminState(blank),null);
});

function reviewState(patch = {}) {
  const value = state({ revision: 6 });
  value.summary.pendingReviewCount = 1; value.summary.rejectedCount = 1;
  value.summary.waitlistCount = 0;
  value.people[2].status = 'pending_review'; value.people[3].status = 'rejected';
  return { ...value, ...patch };
}
function decisionResult({ action = 'approve', operationId = 'o'.repeat(43), status = 'confirmed', outcome = 'updated', revision = 6, operationRevision = 6 } = {}) {
  const value = reviewState({ revision, outcome });
  value.people[2].status = status;
  value.summary.pendingReviewCount = 0;
  if (status === 'confirmed') { value.summary.confirmedCount++; value.summary.attendeeConfirmedCount++; value.summary.remainingPublic--; value.summary.remainingTotal--; }
  if (status === 'waitlisted') value.summary.waitlistCount++;
  if (status === 'rejected') value.summary.rejectedCount++;
  return { ...value, registrationId: ids[2], operation: { operationId, action, registrationId: ids[2], revision: operationRevision } };
}

test('pending and rejected applicants count separately without consuming confirmed seats or approved waitlist', () => {
  const value = reviewState(); assert.ok(admissionAdminState(value));
  assert.equal(admissionAdminState(value).summary.confirmedCount, 2);
  for (const key of ['pendingReviewCount','rejectedCount']) {
    const missing = structuredClone(value); delete missing.summary[key]; assert.equal(admissionAdminState(missing), null);
    const contradictory = structuredClone(value); contradictory.summary[key] = 0; assert.equal(admissionAdminState(contradictory), null);
  }
  const legacyMismatch=structuredClone(value);delete legacyMismatch.summary.pendingReviewCount;delete legacyMismatch.summary.rejectedCount;
  assert.equal(admissionAdminState(legacyMismatch),null);
});

test('approve and reject need a matching durable operation receipt before clearing the original retry', async () => {
  for (const change of [
    value => { delete value.operation; },
    value => { value.operation.operationId = 'x'.repeat(43); },
    value => { value.operation.action = 'reject'; },
    value => { value.operation.registrationId = ids[1]; },
    value => { value.registrationId = ids[1]; },
    value => { value.operation.revision = 5; },
    value => { value.operation.revision = 7; },
  ]) {
    const calls = []; let attempt = 0;
    const operations = createAdmissionOperations({ revision: () => 5, operationId: () => 'o'.repeat(43), request: async(path, options) => {
      calls.push({path,...options}); const result = decisionResult(); if (++attempt === 1) change(result); return result;
    } });
    await assert.rejects(operations.run('/api/admin/admissions/approve', { registrationId: ids[2] }), /回执/u);
    assert.equal(operations.pending, true);
    await operations.retry(); assert.equal(operations.pending, false); assert.deepEqual(calls[0], calls[1]);
  }
  const rejecting = createAdmissionOperations({ revision: () => 5, operationId: () => 'o'.repeat(43), request: async() => decisionResult({action:'reject',status:'rejected'}) });
  assert.equal((await rejecting.run('/api/admin/admissions/reject',{registrationId:ids[2]})).people[2].status, 'rejected');
});

test('lost approval ACK retries only the original request and trusts the current replayed withdrawn snapshot', async () => {
  const calls = []; let attempt = 0;
  const operations = createAdmissionOperations({ revision: () => 5, operationId: () => 'o'.repeat(43), request: async(path,options) => {
    calls.push({path,...options}); if (++attempt === 1) throw new Error('synthetic lost ACK');
    return decisionResult({status:'withdrawn',outcome:'replayed',revision:9,operationRevision:6});
  } });
  await assert.rejects(operations.run('/api/admin/admissions/approve',{registrationId:ids[2]}));
  const replayed = await operations.retry();
  assert.deepEqual(calls[0], calls[1]); assert.equal(replayed.people[2].status, 'withdrawn');
  assert.equal(replayed.summary.confirmedCount, 2); assert.equal(operations.pending, false);
});

test('uncertain network, 503 and invalid success preserve the exact serialized operation for explicit retry', async () => {
  for (const first of [() => {throw new Error('synthetic network');},() => {throw rejection(503);},() => ({...state(),outcome:'updated',summary:{...state().summary,waitlistCount:0}}),() => ({...state(),outcome:'unknown'})]) {
    const calls=[];let count=0;let sequence=0;
    const operations=createAdmissionOperations({request:async(path,options)=>{calls.push({path,...options});if(++count===1)return first();return {...state(),outcome:'replayed'};},revision:()=>5,operationId:()=>String(++sequence).repeat(43)});
    const input={team:{name:'合成两人',memberIds:[ids[0],ids[1]]}};
    await assert.rejects(operations.run('/api/admin/admissions/teams',input));
    input.team.name='不可混入的后续编辑';
    assert.equal(operations.pending,true);
    await assert.rejects(operations.run('/api/admin/admissions/promote',{}),/上次操作/u);
    assert.equal(calls.length,1);
    const result=await operations.retry();
    assert.equal(result.outcome,'replayed');
    assert.equal(operations.pending,false);
    assert.equal(sequence,1);
    assert.deepEqual(calls[1],calls[0]);
    assert.equal(JSON.parse(calls[1].body).team.name,'合成两人');
    assert.equal(JSON.parse(calls[1].body).operationId,'1'.repeat(43));
  }
});

test('a definite conflict clears the rejected operation and the next action reads a fresh revision', async () => {
  const calls=[];let currentRevision=5;let sequence=0;
  const operations=createAdmissionOperations({request:async(path,options)=>{calls.push({path,...options});if(calls.length===1)throw rejection(409);return {...state({revision:7}),outcome:'updated'};},revision:()=>currentRevision,operationId:()=>String(++sequence).repeat(43)});
  await assert.rejects(operations.run('/api/admin/admissions/settings',{settings:{staffReserve:0,waitlistEnabled:true}},'PUT'),{status:409});
  assert.equal(operations.pending,false);
  await assert.rejects(operations.retry());
  currentRevision=6;
  await operations.run('/api/admin/admissions/settings',{settings:{staffReserve:0,waitlistEnabled:true},expectedRevision:999,operationId:'cannot-override'},'PUT');
  assert.equal(JSON.parse(calls[0].body).expectedRevision,5);
  assert.equal(JSON.parse(calls[1].body).expectedRevision,6);
  assert.equal(JSON.parse(calls[1].body).operationId,'2'.repeat(43));
  assert.equal(calls[1].method,'PUT');
  assert.equal(operations.pending,false);
});

test('an in-flight request cannot be duplicated by retry or another mutation', async () => {
  let complete;const calls=[];
  const response=new Promise(resolve=>{complete=resolve;});
  const operations=createAdmissionOperations({request:async(path,options)=>{calls.push({path,...options});return response;},revision:()=>5,operationId:()=>'o'.repeat(43)});
  const saving=operations.run('/api/admin/admissions/promote',{});
  await assert.rejects(operations.retry());
  await assert.rejects(operations.run('/api/admin/admissions/withdraw',{registrationId:ids[0]}));
  assert.equal(calls.length,1);
  complete({...state(),outcome:'updated'});
  assert.equal((await saving).outcome,'updated');
  assert.equal(operations.pending,false);
});

test('invalid operation identity or unloaded revision prevents every request', async () => {
  for (const patch of [{operationId:()=> 'short',revision:()=>5},{operationId:()=> 'o'.repeat(43),revision:()=>-1}]) {
    let calls=0;
    const operations=createAdmissionOperations({request:async()=>{calls++;return state();},...patch});
    await assert.rejects(operations.run('/api/admin/admissions/promote',{}));
    assert.equal(calls,0);
    assert.equal(operations.pending,false);
  }
});

test('clearing an in-flight operation discards its late success or rejection without changing a new session operation', async () => {
  for (const late of ['success','403']) {
    const deferred=[],calls=[];
    const operations=createAdmissionOperations({request:(path,options)=>{calls.push({path,...options});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));},revision:()=>5,operationId:()=>'o'.repeat(43)});
    const old=operations.run('/api/admin/admissions/promote',{});const oldRejection=assert.rejects(old);
    operations.clear();assert.equal(operations.pending,false);
    const next=operations.run('/api/admin/admissions/withdraw',{registrationId:ids[0]});
    if(late==='success')deferred[0].resolve({...state(),outcome:'updated'});else deferred[0].reject(rejection(403));
    await oldRejection;
    assert.equal(operations.pending,true,'late completion cannot clear the new operation');
    await assert.rejects(operations.retry());assert.equal(calls.length,2,'late finally cannot release the new operation lock');
    deferred[1].resolve({...state(),outcome:'updated'});await next;
    assert.equal(operations.pending,false);
  }
});

test('durable original operation is saved before any request and a storage failure never sends it', async () => {
  const events=[];
  const operations=createAdmissionOperations({revision:()=>5,operationId:()=> 'o'.repeat(43),
    savePending:async operation=>{events.push(['persist',operation]);},clearPending:async()=>{events.push(['clear']);},
    request:async(path,options)=>{events.push(['request',{path,...options}]);return decisionResult();}});
  await operations.run('/api/admin/admissions/approve',{registrationId:ids[2]});
  assert.deepEqual(events.map(item=>item[0]),['persist','request','clear']);
  assert.deepEqual(events[0][1],events[1][1]);
  let writes=0;
  const unavailable=createAdmissionOperations({revision:()=>5,operationId:()=> 'o'.repeat(43),savePending:async()=>{throw new Error('storage unavailable');},request:async()=>{writes++;}});
  await assert.rejects(unavailable.run('/api/admin/admissions/approve',{registrationId:ids[2]}),/storage/u);
  assert.equal(writes,0);assert.equal(unavailable.pending,false);
});

test('a refreshed original operation does not send until explicit retry and survives a later 409', async () => {
  let persisted,calls=[],clears=0;
  const first=createAdmissionOperations({revision:()=>5,operationId:()=> 'o'.repeat(43),savePending:async value=>{persisted=structuredClone(value);},request:async()=>{throw new Error('lost ACK');}});
  await assert.rejects(first.run('/api/admin/admissions/approve',{registrationId:ids[2]}));
  const restored=createAdmissionOperations({revision:()=>9,clearPending:async()=>{clears++;},request:async(path,options)=>{calls.push({path,...options});if(calls.length===1)throw rejection(409);return decisionResult({outcome:'replayed',revision:9,operationRevision:6});}});
  restored.restore(persisted);assert.equal(calls.length,0);assert.equal(restored.pending,true);
  await assert.rejects(restored.retry());assert.equal(restored.pending,true);assert.equal(clears,0);
  await assert.rejects(restored.run('/api/admin/admissions/reject',{registrationId:ids[2]}));
  await restored.retry();assert.equal(restored.pending,false);assert.equal(clears,1);
  assert.deepEqual(calls,[persisted,persisted]);assert.equal(JSON.parse(calls[0].body).expectedRevision,5);
});

test('an uncertain in-memory request also preserves its original operation after a later validation rejection',async()=>{
  let calls=0;const operations=createAdmissionOperations({revision:()=>5,operationId:()=> 'o'.repeat(43),request:async()=>{if(++calls===1)throw new Error('lost');throw rejection(422);}});
  await assert.rejects(operations.run('/api/admin/admissions/approve',{registrationId:ids[2]}));const original=operations.pendingRequest;
  await assert.rejects(operations.retry());assert.deepEqual(operations.pendingRequest,original);assert.equal(operations.pending,true);
});

test('clearing while local persistence is pending prevents every late cloud request',async()=>{
  let finish,writes=0;const wait=new Promise(resolve=>{finish=resolve;});
  const operations=createAdmissionOperations({revision:()=>5,operationId:()=> 'o'.repeat(43),savePending:()=>wait,request:async()=>{writes++;}});
  const work=operations.run('/api/admin/admissions/approve',{registrationId:ids[2]});operations.clear();finish();
  await assert.rejects(work,/会话/u);assert.equal(writes,0);assert.equal(operations.pending,false);
});

test('pending recovery refuses other API paths, verbs and unexpected operation fields',()=>{
  const operations=createAdmissionOperations({revision:()=>5,request:async()=>{throw new Error('must not send');}});
  const saved={path:'/api/admin/admissions/approve',method:'POST',body:JSON.stringify({registrationId:ids[2],expectedRevision:5,operationId:'o'.repeat(43)})};
  for(const item of [{...saved,path:'/api/admin/logout'},{...saved,method:'PUT'},{...saved,body:'not JSON'},{...saved,body:JSON.stringify({...JSON.parse(saved.body),password:'forbidden'})}])assert.throws(()=>operations.restore(item),/无法核对/u);
  assert.equal(operations.pending,false);
});
