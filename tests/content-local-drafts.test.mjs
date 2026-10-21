import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent } from '../shared/content-schema.mjs';
import { contentSaveSnapshot } from '../src/lib/admin-save-state.mjs';
import { contentFormValue,contentLocalDraftValue,contentDraftCopy } from '../src/lib/content-local-drafts.mjs';

const content = () => validateContent(createInitialContent()).value;
const bundle = () => ({schemaVersion:1,roleKey:'editor,outreach',content:content(),forms:{},pendingSave:null});
const guest = () => ({editingId:null,fields:{id:'guest-synthetic',name:'尚未填完',company:'',portraitId:'a'.repeat(64)+'.png',contactId:'synthetic-source',publicRoles:['speaker'],publicConsent:true},imageNeedsReselect:true});

test('content recovery preserves applied canonical draft and an incomplete stable-ID guest form without image bytes', () => {
  const value=bundle();value.forms.guest=guest();
  assert.equal(contentLocalDraftValue(value,{kind:'editing'}),true);
  assert.equal(value.forms.guest.fields.id,'guest-synthetic');
  assert.deepEqual(contentFormValue('guest',value.forms.guest.fields),value.forms.guest.fields);
  assert.equal(value.forms.guest.fields.company,'','incomplete input is recoverable, not silently applied');
  for(const key of ['portraitFile','dataBase64','password','csrfToken','crop']){
    const bad=structuredClone(value);bad.forms.guest.fields[key]='SYNTHETIC_PRIVATE_SECRET';
    assert.equal(contentLocalDraftValue(bad,{kind:'editing'}),false,key);
  }
});

test('recovery rejects unbounded data, changed stable IDs, raw file envelopes and contradictory multiple modals', () => {
  for(const mutate of [
    value=>{value.password='SYNTHETIC_PRIVATE_SECRET';},
    value=>{value.content.event.password='SYNTHETIC_PRIVATE_SECRET';},
    value=>{value.forms.guest=guest();value.forms.guest.editingId='other-person';},
    value=>{value.forms.guest=guest();value.forms.guest.fields.name='x'.repeat(10001);},
    value=>{value.forms.guest=guest();value.forms.guest.fields.publicRoles=['speaker','speaker'];},
    value=>{value.forms.guest=guest();value.forms.guest.imageNeedsReselect={type:'image/png',bytes:'PRIVATE'};},
    value=>{value.forms.guest=guest();value.forms.organization={editingId:null,fields:{id:'synthetic-organization'},imageNeedsReselect:false};},
  ]){const value=bundle();mutate(value);assert.equal(contentLocalDraftValue(value,{kind:'editing'}),false);}
});

test('pending content recovery carries the exact normalized submitted snapshot separately from subsequent local edits', () => {
  const value=bundle();value.pendingSave=contentSaveSnapshot(4,value.content);value.content.event.title='之后的本机编辑';
  const original=structuredClone(value.pendingSave);
  assert.equal(contentLocalDraftValue(value,{kind:'pending_submission'}),true);
  assert.equal(contentLocalDraftValue(value,{kind:'editing'}),false);
  assert.deepEqual(value.pendingSave,original);
  for(const mutate of [
    item=>{item.pendingSave.expectedRevision=-1;},
    item=>{item.pendingSave.content.eventId='another-event';},
    item=>{item.pendingSave.operationId='not-this-cas-contract';},
    item=>{item.pendingSave=null;},
  ]){const bad=structuredClone(value);mutate(bad);assert.equal(contentLocalDraftValue(bad,{kind:'pending_submission'}),false);}
});

test('event FAQ and planner choices retain raw form input and explicit IDs without copying roster data', () => {
  const value=bundle();value.forms.event={fields:{title:'合成\n尚未核对',date:''},faqItems:[{question:'尚未完成',answer:''}]};
  value.forms.planner={selected:{type:'booth',id:'synthetic-booth',slotNumber:1},booth:{code:'C-01',organizationId:'synthetic-organization'},assignment:{contactId:'synthetic-contact',sessionIds:['synthetic-session'],boothIds:['synthetic-booth']},contactsRevision:3,uncertain:true};
  assert.equal(contentLocalDraftValue(value,{kind:'editing'}),true);
  const copied=JSON.parse(contentDraftCopy(value));assert.deepEqual(copied.unappliedForms,value.forms);
  assert.equal(Object.hasOwn(copied,'roleKey'),false);assert.equal(Object.hasOwn(copied,'pendingSave'),false);
  const bad=structuredClone(value);bad.forms.planner.assignment.contactName='SYNTHETIC_PRIVATE_ROSTER';
  assert.equal(contentLocalDraftValue(bad,{kind:'editing'}),false);
});
