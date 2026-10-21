import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { createEmptyContactOperations } from '../shared/contacts-schema.mjs';
import { prepareBoothDraft, prepareContactAssignments, boothReadiness, sessionTimeline } from '../src/lib/arrangement-planner.mjs';

const changes = { code:'C-01',organization:'合成机构',project:'合成作品',contactName:'合成负责人',contactMethods:'synthetic@example.invalid',description:'合成展示内容',status:'pending' };
const content = () => ({ ...createInitialContent(), booths: [] });

test('direct booth edit keeps private notes and unrelated content, with no write or public-state mutation', () => {
  const initial = content(), copy = structuredClone(initial);
  const first = prepareBoothDraft(initial,{slotNumber:1,changes,newId:'synthetic-booth'});
  assert.deepEqual(initial,copy); assert.equal(first.boothId,'synthetic-booth'); assert.deepEqual(first.warnings,[]);
  first.content.booths[0].internalNotes='PRIVATE_SYNTHETIC';
  const original=structuredClone(first.content.booths[0]);
  const edited=prepareBoothDraft(first.content,{boothId:original.id,slotNumber:1,original,changes:{...changes,organization:'合成机构修正',internalNotes:'FORGED'}});
  assert.equal(edited.content.booths[0].internalNotes,'PRIVATE_SYNTHETIC');
  assert.equal(edited.content.booths[0].contactMethods,changes.contactMethods);
  assert.equal(first.content.booths[0].organization,changes.organization);
});

test('stale local edits, occupied slots and duplicate booth codes cannot silently overwrite another arrangement', () => {
  const first=prepareBoothDraft(content(),{slotNumber:1,changes,newId:'synthetic-booth'}).content;
  const original=structuredClone(first.booths[0]); first.booths[0].project='另一份合成修改';
  assert.throws(()=>prepareBoothDraft(first,{boothId:original.id,slotNumber:1,original,changes}));
  assert.throws(()=>prepareBoothDraft(first,{slotNumber:1,changes,newId:'synthetic-other'}));
  assert.throws(()=>prepareBoothDraft(first,{slotNumber:2,changes,newId:'synthetic-other'}));
  assert.throws(()=>prepareBoothDraft(first,{slotNumber:16,changes,newId:'synthetic-other'}));
  assert.throws(()=>prepareBoothDraft(first,{slotNumber:2,changes,newId:'../../unsafe'}));
});

test('booth readiness shows missing practical details while allowing a valid pending draft', () => {
  const result=prepareBoothDraft(content(),{slotNumber:1,newId:'synthetic-empty',changes:{...changes,organization:'',project:'',contactName:'',contactMethods:'',description:''}});
  assert.equal(boothReadiness(result.content.booths[0]).length,5);
  assert.throws(()=>prepareBoothDraft(content(),{slotNumber:1,newId:'synthetic-confirmed',changes:{...changes,organization:'',status:'confirmed'}}));
});

test('person assignment preserves actual reply and follow-up fields and rejects declines, cancelled references and time overlap', () => {
  const base=content();
  base.sessions=[{id:'session-a',title:'合成A',start:'10:00',end:'11:00',zone:'A',status:'scheduled'},
    {id:'session-b',title:'合成B',start:'10:30',end:'11:30',zone:'B',status:'scheduled'},
    {id:'session-c',title:'合成取消',start:'12:00',end:'13:00',zone:'A',status:'cancelled'}];
  const contact={id:'contact-a',profile:{contactConsent:'consented'},operations:{...createEmptyContactOperations(),owner:'synthetic-owner',notes:'PRIVATE_SYNTHETIC',responseStatus:'pending'}};
  const result=prepareContactAssignments(contact,{sessionIds:['session-a'],boothIds:[]},base);
  assert.equal(result.responseStatus,'pending'); assert.equal(result.notes,'PRIVATE_SYNTHETIC'); assert.equal(result.owner,'synthetic-owner');
  assert.deepEqual(contact.operations.sessionIds,[]);
  assert.throws(()=>prepareContactAssignments(contact,{sessionIds:['session-a','session-b'],boothIds:[]},base));
  assert.throws(()=>prepareContactAssignments(contact,{sessionIds:['session-c'],boothIds:[]},base));
  assert.throws(()=>prepareContactAssignments({...contact,profile:{contactConsent:'declined'}},{sessionIds:['session-a'],boothIds:[]},base));
  assert.throws(()=>prepareContactAssignments({...contact,operations:{...contact.operations,responseStatus:'declined'}},{sessionIds:[],boothIds:[]},base));
});

test('timeline orders start times, keeps actual zone columns and excludes duplicate workshop projections', () => {
  const a={id:'session-a',start:'11:00',end:'12:00',zone:'A',title:'合成A'};
  const b={id:'session-b',start:'10:00',end:'11:00',zone:'B',title:'合成B'};
  const c={id:'session-c',start:'10:00',end:'12:00',zone:'C',title:'合成C'};
  const result=sessionTimeline({sessions:{A:[a,a],B:[b],other:[c],workshops:[b]}});
  assert.deepEqual(result.map(row=>row.start),['10:00','11:00']);
  assert.equal(result[0].zones.B.length,1); assert.equal(result[0].zones.C[0].id,'session-c'); assert.equal(result[1].zones.A.length,1);
});

test('direct assignment preserves current session duties and drops only links for explicitly removed sessions', () => {
  const base=content();base.sessions=[{id:'morning',title:'合成早场',start:'10:00',end:'11:00',zone:'A',status:'scheduled'}, {id:'afternoon',title:'合成午场',start:'13:00',end:'14:00',zone:'B',status:'scheduled'}];
  const contact={id:'contact-a',profile:{contactConsent:'consented'},operations:{...createEmptyContactOperations(),sessionIds:['morning','afternoon'],sessionRoles:[{sessionId:'morning',roles:['speaker']},{sessionId:'afternoon',roles:['organizer']}]}};
  const result=prepareContactAssignments(contact,{sessionIds:['afternoon'],boothIds:[]},base);
  assert.deepEqual(result.sessionRoles,[{sessionId:'afternoon',roles:['organizer']}]);assert.equal(contact.operations.sessionRoles.length,2);
});
