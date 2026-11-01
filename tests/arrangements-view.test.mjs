import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArrangementOverview } from '../shared/arrangement-overview.mjs';
import { isArrangementSnapshot } from '../src/scripts/arrangements-view.mjs';

const booth=(id,slotNumber,status='pending')=>({id,code:'C-'+id,slotNumber,status,zone:'C',organization:'合成组织',project:'合成作品'});
const snapshot=(booths=[])=>buildArrangementOverview({content:{booths,sessions:[],guests:[],showcases:[]},contacts:[],contentRevision:1,contactsRevision:2});

test('client accepts empty and sparse dynamic saved overviews instead of a fixed position grid',()=>{
  assert.equal(isArrangementSnapshot(snapshot()),true);
  const value=snapshot([booth('high',32),booth('low',16,'confirmed'),booth('unplaced',0),booth('cancelled',32,'cancelled')]);
  assert.equal(isArrangementSnapshot(value),true);
  assert.deepEqual(value.boothRows.map(row=>row.slotNumber),[16,32]);
});

test('client rejects legacy, inconsistent or ambiguous booth summaries rather than showing guessed counts',()=>{
  const valid=snapshot([booth('one',16),booth('two',32,'confirmed')]);
  for(const mutate of [
    value=>{value.schemaVersion=1;},
    value=>{value.summary.booths.activePlaced=15;},
    value=>{value.summary.booths.confirmedPlaced=0;},
    value=>{value.summary.booths.totalRecords=3;},
    value=>{value.boothRows.reverse();},
    value=>{value.boothRows[1].slotNumber=16;value.boothRows[1].booth.slotNumber=16;},
    value=>{value.boothRows[0].booth=null;},
    value=>{value.boothRows[0].booth.status='cancelled';},
    value=>{value.boothRows[0].slotNumber=201;value.boothRows[0].booth.slotNumber=201;},
    value=>{value.boothRows[1].booth.id=value.boothRows[0].booth.id;},
  ]){const value=structuredClone(valid);mutate(value);assert.equal(isArrangementSnapshot(value),false);}
  for(const value of [null,{},[],{summary:{booths:{}}}])assert.equal(isArrangementSnapshot(value),false);
});
