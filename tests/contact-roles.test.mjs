import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyContactOperations, validateContactOperations, preserveContactOperationDefaults, hasNewContactAllocations } from '../shared/contacts-schema.mjs';
import { guestPrefillFromContact } from '../shared/contact-editor.mjs';

const operations = () => ({ ...createEmptyContactOperations(), participationForms:['speaker','organizer'], sessionIds:['morning','afternoon'],
  sessionRoles:[{sessionId:'morning',roles:['speaker']},{sessionId:'afternoon',roles:['organizer','host']}] });
const planning = { sessions:[{id:'morning',start:'10:00',end:'11:00',status:'scheduled'}, {id:'afternoon',start:'13:00',end:'14:00',status:'scheduled'}],booths:[] };

test('a person has independent global and per-session duties without changing reply, source or admission facts', () => {
  const input=operations(),before=structuredClone(input),result=validateContactOperations(input,planning);
  assert.equal(result.valid,true);assert.deepEqual(result.value.sessionRoles,input.sessionRoles);assert.equal(result.value.responseStatus,'pending');
  assert.deepEqual(input,before);assert.equal(Object.hasOwn(result.value,'admissionStatus'),false);assert.equal(Object.hasOwn(result.value,'publicConsent'),false);
  result.value.sessionRoles[0].roles.push('guest');assert.deepEqual(input,before);
});

test('legacy omission preserves duties and explicitly removing a session only removes that current link', () => {
  const current=operations(),legacy={...current,notes:'合成跟进更新'};delete legacy.sessionRoles;delete legacy.participationForms;
  assert.deepEqual(preserveContactOperationDefaults(legacy,current).sessionRoles,current.sessionRoles);
  assert.deepEqual(preserveContactOperationDefaults(legacy,current).participationForms,current.participationForms);
  assert.deepEqual(preserveContactOperationDefaults({...legacy,sessionIds:['morning']},current).sessionRoles,[current.sessionRoles[0]]);
  assert.deepEqual(preserveContactOperationDefaults({...legacy,sessionRoles:[]},current).sessionRoles,[]);
  const old={...createEmptyContactOperations()};delete old.sessionRoles;
  assert.equal(validateContactOperations(old).valid,true);assert.deepEqual(validateContactOperations(old).value.sessionRoles,[]);
});

test('duplicate, malformed, unassigned or unsupported duties fail before a role can become an allocation', () => {
  const base=operations();
  const malformed=[null,'speaker',[{sessionId:'missing',roles:['speaker']}],[{sessionId:'morning',roles:[]}],
    [{sessionId:'morning',roles:['speaker','speaker']}],[{sessionId:'morning',roles:['automatic_confirmation']}],
    [{sessionId:'morning',roles:['speaker'],publicConsent:true}],Array(2).fill({sessionId:'morning',roles:['speaker']})];
  for(const sessionRoles of malformed)assert.equal(validateContactOperations({...base,sessionRoles},planning).valid,false);
  const getter={roles:['speaker']};Object.defineProperty(getter,'sessionId',{enumerable:true,get(){throw Error('should not be read');}});
  assert.equal(validateContactOperations({...base,sessionRoles:[getter]},planning).valid,false);
  const cancelled={...planning,sessions:planning.sessions.map(value=>value.id==='morning'?{...value,status:'cancelled'}:value)};
  assert.equal(validateContactOperations(base,cancelled).valid,false);
});

test('adding a duty in an already assigned session needs fresh allocation checks while removal needs none', () => {
  const current=operations();
  assert.equal(hasNewContactAllocations({...current,notes:'合成笔记'},current),false);
  assert.equal(hasNewContactAllocations({...current,sessionRoles:[{sessionId:'morning',roles:['speaker']}]},current),false);
  assert.equal(hasNewContactAllocations({...current,sessionRoles:[{sessionId:'morning',roles:['speaker','organizer']}]},current),true);
  assert.equal(hasNewContactAllocations({...current,participationForms:[...current.participationForms,'guest']},current),true);
});

test('guest presentation prefill remains an unsaved suggestion and leaves oversized source details private', () => {
  const contact={id:'synthetic-contact',profile:{name:'合成姓名',displayName:'合成称呼',organization:'合成机构',siteRole:'',position:'合成职务',background:'合成简介',website:'https://example.invalid/profile',contactConsent:'consented'},operations:{...operations(),participationForms:['speaker','organizer','host','panelist']}};
  const before=structuredClone(contact),result=guestPrefillFromContact(contact);
  assert.equal(result.valid,true);assert.equal(result.value.title,'合成职务');assert.equal(result.value.bio,'合成简介');
  assert.deepEqual(result.value.publicRoles,['speaker','organizer','moderator']);assert.deepEqual(contact,before);
  assert.equal(Object.hasOwn(result.value,'publicConsent'),false);assert.equal(Object.hasOwn(result.value,'status'),false);
  const large=guestPrefillFromContact({...contact,profile:{...contact.profile,background:'字'.repeat(4001),website:'javascript:alert(1)'}});
  assert.deepEqual(large.omittedFields,['bio','website']);assert.equal(Object.hasOwn(large.value,'bio'),false);assert.equal(Object.hasOwn(large.value,'website'),false);
});
