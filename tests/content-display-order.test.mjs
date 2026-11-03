import test from 'node:test';
import assert from 'node:assert/strict';
import {displayOrderTarget,moveDisplayRecord,sessionDisplayOrderTarget,moveSessionDisplayRecord} from '../src/lib/content-display-order.mjs';
import {createInitialContent} from '../src/config/content.mjs';
import {contentSectionSnapshot,contentPublicationReadiness,confirmedContentSave} from '../src/lib/admin-save-state.mjs';
import {toPublicContent,orderedSessions} from '../shared/content-schema.mjs';

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


const session=(id,start,zone='A',status='scheduled')=>({id,start,end:start.slice(0,3)+'30',zone,title:'合成 '+id,description:'',format:'talk',speakerName:'',speakerBio:'',speakerStatus:'pending',guestId:'',status,internalNotes:'PRIVATE-'+id});
const sessionVisible=rows=>rows.filter(row=>['scheduled','cancelled'].includes(row.status)).map(row=>row.id);
test('session moves skip other zones and draft display slots, and cannot cross the morning/afternoon boundary',()=>{
  const rows=[session('morning-first','09:00'),session('zone-b','09:30','B'),session('private-draft','09:45','A','draft'),session('morning-last','10:00'),session('afternoon-first','12:00'),session('afternoon-last','13:00','A','cancelled')],ids=sessionVisible(rows),original=structuredClone(rows);
  assert.equal(sessionDisplayOrderTarget(rows,ids,'morning-first','down'),'morning-last');assert.equal(sessionDisplayOrderTarget(rows,ids,'morning-last','down'),null);assert.equal(sessionDisplayOrderTarget(rows,ids,'afternoon-first','up'),null);assert.equal(sessionDisplayOrderTarget(rows,ids,'zone-b','down'),null);assert.equal(sessionDisplayOrderTarget(rows,ids,'private-draft','up'),null);
  const moved=moveSessionDisplayRecord(rows,ids,'morning-first','down');assert.deepEqual(moved.map(row=>row.id),['morning-last','zone-b','private-draft','morning-first','afternoon-first','afternoon-last']);assert.equal(moved[1],rows[1]);assert.equal(moved[2],rows[2]);assert.deepEqual(rows,original);for(const item of moved)assert.deepEqual(item,original.find(row=>row.id===item.id));
  assert.equal(sessionDisplayOrderTarget(rows,ids,'afternoon-first','down'),'afternoon-last','cancelled public sessions keep an explicit place in the agenda');
});
test('first session move normalizes legacy effective display order before manual swapping without changing any session fields',()=>{
  const raw=[session('late','14:00'),session('am-b','10:00','B'),session('hidden-am','10:00','A','draft'),session('early','13:00'),session('morning','09:00')],original=structuredClone(raw),base=orderedSessions(raw);
  assert.deepEqual(base.map(row=>row.id),['morning','hidden-am','am-b','early','late']);const moved=moveSessionDisplayRecord(base,sessionVisible(base),'late','up');assert.deepEqual(moved.map(row=>row.id),['morning','hidden-am','am-b','late','early']);assert.equal(moved[1],base[1]);assert.equal(moved[2],base[2]);assert.deepEqual(raw,original);assert.deepEqual(orderedSessions(moved,'manual').map(row=>row.id),moved.map(row=>row.id));
  for(const item of moved)assert.deepEqual(item,original.find(row=>row.id===item.id));assert.deepEqual(orderedSessions(moved,'manual').filter(row=>row.zone==='A'&&row.status!=='draft').map(row=>row.id),['morning','late','early']);
});
test('invalid session moves and stale visible orders fail closed instead of changing timing or hidden drafts',()=>{
  const rows=[session('first','09:00'),session('second','10:00')];for(const [records,ids,id,direction]of [[rows,['second','first'],'first','up'],[rows,['first','missing'],'first','down'],[rows,['first','first'],'first','down'],[rows,['first','second'],'first','sideways'],[[{...rows[0],start:'24:00'},rows[1]],['first','second'],'first','down'],[[{...rows[0],zone:'unknown'},rows[1]],['first','second'],'first','down']])assert.equal(moveSessionDisplayRecord(records,ids,id,direction),null);
});
test('a session order save scopes mode and rows, retains other collections, and remains unpublished until explicit publication',()=>{
  const base=createInitialContent();base.showcases=[];base.sessions=[session('late','14:00'),session('other-zone','10:00','B'),session('hidden','10:00','A','draft'),session('early','13:00'),session('morning','09:00')];
  const attendance={schemaVersion:1,sourceRevision:0,confirmedGuestIds:[]},published={revision:7,publishedAt:'2026-11-03T00:00:00.000Z',content:toPublicContent(base,{guestAttendance:attendance})},old=structuredClone(published),candidate=structuredClone(base),effective=orderedSessions(base.sessions);
  candidate.sessions=moveSessionDisplayRecord(effective,sessionVisible(effective),'late','up');candidate.sessionOrder='manual';const submitted=contentSectionSnapshot(7,base,candidate,'sessions');assert.ok(submitted);assert.equal(submitted.content.sessionOrder,'manual');assert.deepEqual(submitted.content.guests,base.guests);assert.deepEqual(submitted.content.organizations,base.organizations);assert.deepEqual(submitted.content.booths,base.booths);assert.deepEqual(submitted.content.event,base.event);
  const saved=confirmedContentSave({draft:{revision:8,content:submitted.content}},submitted);assert.ok(saved);const proof=contentPublicationReadiness({draft:saved,published,attendancePreview:{status:'ready',contentRevision:8,guestAttendance:attendance}});assert.equal(proof.orderChanged.sessions,true);assert.equal(proof.hasPublicChanges,true);assert.equal(proof.summary.updated,0);assert.deepEqual(published,old);assert.deepEqual(toPublicContent(saved.content,{guestAttendance:attendance}).sessions.map(row=>row.id),['morning','other-zone','late','early']);
});
