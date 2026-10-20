import test from 'node:test';
import assert from 'node:assert/strict';
import {completeBoothSlots} from '../src/lib/booth-slots.mjs';
const ids={idForSlot:slot=>'synthetic-slot-'+slot};
test('fifteen empty positions are pending with no invented occupants or contact data',()=>{
  const result=completeBoothSlots([],ids);
  assert.equal(result.created,15);assert.deepEqual(result.booths.map(item=>item.slotNumber),Array.from({length:15},(_,index)=>index+1));
  for(const booth of result.booths){assert.equal(booth.status,'pending');for(const key of ['organization','project','contactName','contactMethods','description'])assert.equal(booth[key],'');}
  const second=completeBoothSlots(result.booths,ids);assert.equal(second.created,0);assert.deepEqual(second.booths,result.booths);
});
test('existing occupancy and private details stay unchanged, cancelled history does not block a new position',()=>{
  const records=[{id:'existing',code:'C-01',slotNumber:3,status:'confirmed',organization:'合成机构',contactMethods:'synthetic@example.invalid'},
    {id:'cancelled',code:'C-02',slotNumber:2,status:'cancelled',organization:'合成取消记录'}];
  const before=structuredClone(records),result=completeBoothSlots(records,ids);
  assert.deepEqual(records,before);assert.deepEqual(result.booths.slice(0,2),before);assert.equal(result.created,14);
  assert.equal(result.booths.find(item=>item.id==='synthetic-slot-1').code,'C-01-2');
  assert.equal(result.booths.filter(item=>item.slotNumber===2&&item.status!=='cancelled').length,1);
  assert.equal(new Set(result.booths.map(item=>item.id)).size,result.booths.length);
});
