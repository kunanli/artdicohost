import test from 'node:test';
import assert from 'node:assert/strict';
import { canLinkContentPeople, contactCandidatePage, organizationMemberPage, organizationChoices, boothOrganizationField, personContactPath } from '../src/lib/content-relationships.mjs';

const candidate=()=>({schemaVersion:1,contactsRevision:4,candidates:[{id:'contact_01',name:'合成人员',organization:'合成组织',eligible:true}],total:1,nextCursor:null});
const members=()=>({schemaVersion:1,organizationId:'organization_01',contentRevision:3,contactsRevision:4,members:[{contactId:'contact_01',name:'合成人员',role:'lead',title:'合成负责人'}],total:1,nextCursor:null});

test('private content relationships require both literal editor and outreach roles',()=>{
  for(const roles of [[],['editor'],['outreach'],['superadmin'],['superadmin','editor']]) assert.equal(canLinkContentPeople({roles}),false);
  assert.equal(canLinkContentPeople({roles:['outreach','editor']}),true);
});
test('candidate projection keeps exact IDs and eligibility while excluding unrelated private fields',()=>{
  const value=candidate();value.candidates[0].email='private@example.invalid';value.candidates[0].notes='PRIVATE_NOTES';
  assert.deepEqual(contactCandidatePage(value),{contactsRevision:4,candidates:[{id:'contact_01',name:'合成人员',organization:'合成组织',eligible:true}],total:1,nextCursor:null});
  assert.equal(personContactPath('contact_01'),'/admin/person/#contact=contact_01');
  assert.throws(()=>personContactPath('../forged'));
});
test('candidate pages reject malformed identity, repeated IDs, impossible pagination and unbounded choices',()=>{
  for(const change of [value=>value.candidates[0].id='bad/id',value=>value.candidates.push({...value.candidates[0]}),value=>value.total=0,value=>value.nextCursor='0',value=>value.nextCursor='2',value=>value.contactsRevision=-1,value=>value.candidates[0].eligible='yes',value=>value.candidates=Array(201).fill(value.candidates[0])]){const value=candidate();change(value);assert.throws(()=>contactCandidatePage(value));}
  const page=candidate();page.total=201;page.nextCursor='100';assert.equal(contactCandidatePage(page).nextCursor,'100');
});
test('member projection binds the requested saved organization and strips contacts and original answers',()=>{
  const value=members();value.members[0].email='private@example.invalid';value.members[0].originalAnswers='PRIVATE_ANSWER';
  const {schemaVersion,...expected}=members();assert.equal(schemaVersion,1);assert.deepEqual(organizationMemberPage(value,'organization_01'),expected);
  assert.throws(()=>organizationMemberPage(value,'organization_02'));
  for(const change of [value=>value.members[0].role='speaker',value=>value.members[0].title='x'.repeat(121),value=>value.members.push({...value.members[0]}),value=>value.contentRevision=null,value=>value.contactsRevision=-1,value=>value.total=0]){const value=members();change(value);assert.throws(()=>organizationMemberPage(value,'organization_01'));}
});
test('organization choices never infer a relation from static names and retain missing selected IDs',()=>{
  assert.deepEqual(organizationChoices({},''),[]);
  assert.deepEqual(organizationChoices({organizations:[]},'organization_old'),[{id:'organization_old',name:'原关联组织暂不可用',status:'missing',missing:true}]);
  const content={organizations:[{id:'organization_01',name:'合成组织',status:'withdrawn'}]};
  assert.deepEqual(organizationChoices(content,'organization_01'),[{id:'organization_01',name:'合成组织',status:'withdrawn',missing:false}]);
  assert.throws(()=>organizationChoices(content,'bad/id'));
});
test('booth form serialization preserves historical absent keys and only clears explicit relationships',()=>{
  assert.deepEqual(boothOrganizationField({organization:'旧名称'},''),{});
  assert.deepEqual(boothOrganizationField({},'organization_01'),{organizationId:'organization_01'});
  assert.deepEqual(boothOrganizationField({organizationId:'organization_01'},''),{organizationId:''});
  assert.throws(()=>boothOrganizationField({},null));
  assert.throws(()=>boothOrganizationField({},'../forged'));
});
