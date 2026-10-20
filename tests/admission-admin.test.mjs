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
  assert.deepEqual(admissionAdminState(value),value);
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
