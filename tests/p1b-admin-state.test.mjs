import test from 'node:test';
import assert from 'node:assert/strict';
import {createInitialContent} from '../src/config/content.mjs';
import {validateContent,toPublicContent} from '../shared/content-schema.mjs';
import {contentPublicationReadiness,contentSaveSnapshot} from '../src/lib/admin-save-state.mjs';
import {sessionParticipantFields,contentFormValue,contentLocalDraftValue,readContentForm,writeContentForm} from '../src/lib/content-local-drafts.mjs';

function fixture(){
  const value=createInitialContent();
  value.guests=['one','two'].map(name=>({id:'synthetic-'+name,name:'合成嘉宾 '+name,company:'合成机构',ggjRole:'',portraitId:'',contactId:'synthetic-contact-'+name,status:'confirmed',publicConsent:false,internalNotes:'合成内部备注'}));
  const checked=validateContent(value);assert.equal(checked.valid,true);return checked.value;
}
const attendance=(ids,sourceRevision=4)=>({schemaVersion:1,sourceRevision,confirmedGuestIds:ids});
const published=(content,proof,revision=3)=>({revision,publishedAt:'2026-11-01T00:00:00.000Z',content:toPublicContent(content,proof?{guestAttendance:proof}:{})});
const preview=(proof,contentRevision=3)=>({status:'ready',contentRevision,guestAttendance:proof});

test('current attendance changes are publication changes without changing saved profiles or draft bytes',()=>{
  const content=fixture(),before=JSON.stringify(content),old=published(content,attendance(['synthetic-one']));
  const report=contentPublicationReadiness({draft:{revision:3,content},published:old,attendancePreview:preview(attendance(['synthetic-two'],5))});
  assert.ok(report);assert.equal(report.hasPublicChanges,true);assert.equal(report.attendanceChanged,true);
  for(const item of report.items.guests){assert.equal(item.change,'updated');assert.equal(item.attendanceChanged,true);}
  assert.equal(report.items.guests[0].attendanceConfirmed,false);assert.equal(report.items.guests[1].attendanceConfirmed,true);
  assert.equal(JSON.stringify(content),before);assert.deepEqual(old.content.guestAttendance.confirmedGuestIds,['synthetic-one']);
});

test('an unrelated private-source revision reuses the unchanged frozen proof without publish noise',()=>{
  const content=fixture(),old=published(content,attendance(['synthetic-one']));
  const report=contentPublicationReadiness({draft:{revision:3,content},published:old,attendancePreview:preview(attendance(['synthetic-one'],55))});
  assert.ok(report);assert.equal(report.hasPublicChanges,false);assert.equal(report.attendanceChanged,false);
  assert.deepEqual(report.guestAttendance,old.content.guestAttendance);assert.equal(report.items.guests[0].change,'unchanged');
});

test('a legacy publication remains readable and its absent attendance proof requires one explicit upgrade',()=>{
  const content=fixture(),old=published(content),before=JSON.stringify(old);
  const report=contentPublicationReadiness({draft:{revision:3,content},published:old,attendancePreview:preview(attendance([]))});
  assert.ok(report);assert.equal(report.hasPublicChanges,true);assert.equal(report.attendanceChanged,true);
  assert.equal(JSON.stringify(old),before);assert.equal(Object.hasOwn(old.content,'guestAttendance'),false);
  assert.ok(contentPublicationReadiness({draft:{revision:3,content},published:old}),'isolated historical callers retain their contract');
});

test('unavailable, stale and forged attendance previews block publishing without modifying editing content',()=>{
  const content=fixture(),before=JSON.stringify(content),old=published(content,attendance([]));
  for(const proof of [null,{status:'unavailable',contentRevision:3},preview(attendance([]),2),preview(attendance(['not-public'])),preview({...attendance([]),contactId:'private'})]){
    assert.equal(contentPublicationReadiness({draft:{revision:3,content},published:old,attendancePreview:proof}),null);
  }
  assert.equal(JSON.stringify(content),before);
});

test('the acknowledged new publication reconciles with a fresh proof even after source revision changes',()=>{
  const content=fixture(),old=published(content,attendance(['synthetic-two'],12),4);
  const report=contentPublicationReadiness({draft:{revision:4,content},published:old,attendancePreview:preview(attendance(['synthetic-two'],11),4)});
  assert.ok(report);assert.equal(report.hasPublicChanges,false);assert.equal(report.publishedRevision,4);assert.equal(report.guestAttendance.sourceRevision,12);
});

test('participant raw form input preserves omissions, incomplete rows and explicit removal separately',()=>{
  const rows=[{guestId:'synthetic-two',roles:['moderator','panelist']}],previous={participants:rows};
  const retained=sessionParticipantFields(previous,{});assert.deepEqual(retained,{participants:rows});assert.notEqual(retained.participants,rows);
  assert.deepEqual(sessionParticipantFields(previous,{participants:''}),{participants:rows});
  assert.deepEqual(sessionParticipantFields(previous,{participants:'[]'}),{participants:[]});
  assert.deepEqual(sessionParticipantFields({},{}),{});assert.deepEqual(sessionParticipantFields({},{participants:''}),{});
  const unfinished={id:'synthetic-session',participants:JSON.stringify([{guestId:'',roles:[]}])};
  assert.deepEqual(contentFormValue('session',unfinished),unfinished);
  assert.deepEqual(sessionParticipantFields({},unfinished),{participants:[{guestId:'',roles:[]}]});
  for(const participants of ['{','{}',JSON.stringify(Array.from({length:21},()=>({}))),5])assert.throws(()=>sessionParticipantFields(previous,{participants}),/参与者/u);
});

test('participant form recovery keeps original pending bytes apart from later unsaved role edits',()=>{
  const content=fixture(),session=content.sessions[0];session.participants=[{guestId:'synthetic-two',roles:['moderator']}];
  const original=contentSaveSnapshot(3,content),before=JSON.stringify(original);
  const raw={id:session.id,participants:JSON.stringify([{guestId:'synthetic-two',roles:['panelist']}])};
  const draft={schemaVersion:1,section:'sessions',roleKey:'editor',content,forms:{session:{editingId:session.id,fields:raw,imageNeedsReselect:false}},pendingSave:original,uncertain:true};
  assert.equal(contentLocalDraftValue(draft,{kind:'pending_submission'}),true);assert.equal(JSON.stringify(original),before);
  const hidden={value:raw.participants,type:'hidden'},id={value:session.id,type:'hidden'};
  const form={elements:{namedItem:name=>({id,participants:hidden})[name]},querySelectorAll:()=>[]};
  assert.deepEqual(readContentForm(form,'session'),raw);
  hidden.value='';writeContentForm(form,'session',raw);assert.equal(hidden.value,raw.participants);
  assert.equal(JSON.stringify(original),before);
});
