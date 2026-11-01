import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSchema } from '../shared/content-schema.mjs';
import { nextBoothSlot, nextBoothCode } from '../src/lib/booth-slots.mjs';

const booth=(id,slotNumber,extra={})=>({id,code:'C-'+String(slotNumber).padStart(2,'0'),slotNumber,status:'pending',...extra});

test('one new booth gets a vacant position without creating a grid or changing saved records',()=>{
  assert.equal(nextBoothSlot([]),1);assert.equal(nextBoothCode([],1),'C-01');
  const records=Array.from({length:32},(_,i)=>booth('saved-'+i,i+1));
  const before=structuredClone(records);
  assert.equal(nextBoothSlot(records),33);assert.equal(nextBoothCode(records,33),'C-33');
  assert.deepEqual(records,before);
});

test('sparse and cancelled positions can be reused while historical codes remain unique',()=>{
  const records=[booth('third',3,{status:'confirmed',contactMethods:'synthetic@example.invalid'}),booth('cancelled',1,{status:'cancelled'}),booth('unplaced',0,{code:'C-01-2'})];
  const before=structuredClone(records);
  assert.equal(nextBoothSlot(records),1);assert.equal(nextBoothCode(records,1),'C-01-3');
  assert.deepEqual(records,before);
});

test('capacity, malformed values and ambiguous active positions fail without guessing',()=>{
  const full=Array.from({length:contentSchema.maxBooths},(_,i)=>booth('saved-'+i,i+1));
  assert.throws(()=>nextBoothSlot(full),/上限/u);
  for(const slotNumber of [-1,contentSchema.maxBoothPosition+1,1.5,'1',null])assert.throws(()=>nextBoothSlot([booth('invalid',slotNumber)]),TypeError);
  for(const slotNumber of [0,-1,contentSchema.maxBoothPosition+1,1.5,'1'])assert.throws(()=>nextBoothCode([],slotNumber),TypeError);
  assert.throws(()=>nextBoothSlot([booth('one',1),booth('two',1,{code:'C-02'})]),/重复/u);
  assert.throws(()=>nextBoothSlot([booth('one',1),booth('two',2,{code:'c-01'})]),TypeError);
  assert.throws(()=>nextBoothSlot(Array(1)),TypeError);
  let accessed=false;const records=[];Object.defineProperty(records,0,{get(){accessed=true;throw new Error('must not read');}});
  assert.throws(()=>nextBoothSlot(records),TypeError);assert.equal(accessed,false);
});
