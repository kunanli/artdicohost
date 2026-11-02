import test from 'node:test';
import assert from 'node:assert/strict';
import {displayOrderTarget,moveDisplayRecord} from '../src/lib/content-display-order.mjs';
import {createInitialContent} from '../src/config/content.mjs';
import {contentSectionSnapshot,contentPublicationReadiness,confirmedContentSave} from '../src/lib/admin-save-state.mjs';
import {toPublicContent} from '../shared/content-schema.mjs';

const guest=(id,extra={})=>({id,name:id,company:'合成机构',ggjRole:'',portraitId:'',status:'pending',publicConsent:false,internalNotes:'PRIVATE-'+id,...extra});
test('moving a filtered public record retains hidden positions, stable objects and every private field',()=>{
  const records=[guest('first'),guest('private',{visibility:'private',contactId:'synthetic-contact'}),guest('middle'),guest('hidden',{visibility:'private'}),guest('last')];
  const original=structuredClone(records),ids=['first','middle','last'];
  assert.equal(displayOrderTarget(records,ids,'middle','up'),'first');
  const next=moveDisplayRecord(records,ids,'middle','up');
  assert.deepEqual(next.map(row=>row.id),['middle','private','first','hidden','last']);
  assert.deepEqual(records,original);assert.equal(next[1],records[1]);assert.equal(next[0],records[2]);
  for(const row of next)assert.deepEqual(row,original.find(item=>item.id===row.id));
});
test('first and last edges do not create a move; invalid or stale subsets never reorder records',()=>{
  const records=[guest('first'),guest('second'),guest('third')],ids=records.map(row=>row.id);
  assert.equal(moveDisplayRecord(records,ids,'first','up'),null);assert.equal(moveDisplayRecord(records,ids,'third','down'),null);
  for(const [rows,visible,id,direction]of[[records,['second','first'],'first','down'],[records,['first','missing'],'first','down'],[records,['first','first'],'first','down'],[[...records,records[0]],ids,'first','down'],[records,ids,'missing','up'],[records,ids,'first','sideways']])assert.equal(moveDisplayRecord(rows,visible,id,direction),null);
  assert.deepEqual(moveDisplayRecord(records,ids,'first','down').map(row=>row.id),['second','first','third']);
});
test('a scoped order save keeps other collections and the old published snapshot unchanged until explicit publication',()=>{
  const base=createInitialContent();base.guests=[guest('first'),guest('private',{visibility:'private'}),guest('last')];
  const attendance={schemaVersion:1,sourceRevision:0,confirmedGuestIds:[]};
  const published={revision:3,publishedAt:'2026-11-02T00:00:00.000Z',content:toPublicContent(base,{guestAttendance:attendance})};
  const frozen=structuredClone(published),candidate=structuredClone(base);
  candidate.guests=moveDisplayRecord(candidate.guests,['first','last'],'last','up');
  const submitted=contentSectionSnapshot(3,base,candidate,'guests');
  assert.deepEqual(submitted.content.sessions,base.sessions);assert.deepEqual(submitted.content.booths,base.booths);
  assert.deepEqual(submitted.content.guests.map(row=>row.id),['last','private','first']);
  const saved=confirmedContentSave({draft:{revision:4,content:submitted.content}},submitted);assert.ok(saved);
  const proof=contentPublicationReadiness({draft:saved,published,attendancePreview:{status:'ready',contentRevision:4,guestAttendance:attendance}});
  assert.equal(proof.orderChanged.guests,true);assert.equal(proof.hasPublicChanges,true);assert.equal(proof.summary.updated,0);
  assert.deepEqual(published,frozen);assert.deepEqual(toPublicContent(saved.content,{guestAttendance:attendance}).guests.map(row=>row.id),['last','first']);
  const wrong=structuredClone(saved);wrong.content.guests.reverse();assert.equal(confirmedContentSave({draft:wrong},submitted),null,'an ACK with another order is not proof of this save');
});
