import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDraftFields,applyDraftFields,validDraftFields,operationsDraftPage} from '../src/lib/operations-draft-fields.mjs';
const input=(name,value,type='text')=>({name,value,type,tagName:'INPUT',checked:false});
const select=(name,options,value)=>({name,value,type:'select-one',tagName:'SELECT',options:options.map(value=>({value}))});
test('daily-operation draft capture uses an explicit allowlist and omits consent and credentials',()=>{
  const form={elements:[input('name','Synthetic person'),input('password','must-not-cache','password'),input('file','secret file','file'),input('csrfToken','secret'),input('confirmed','on','checkbox'),input('contactConsent','consented'),input('categories','developer','checkbox')]};form.elements[6].checked=true;
  assert.deepEqual(captureDraftFields(form,['name','categories']),{name:'Synthetic person',categories:['developer']});
  assert.deepEqual(captureDraftFields(form,['password','file']),{});
});
test('restore checks every selected exact ID before changing any current field',()=>{
  const name=input('name','cloud value'),organization=select('organizationId',['saved-one'],'saved-one'),form={elements:[name,organization]};
  assert.throws(()=>applyDraftFields(form,{name:'local value',organizationId:'same-name-but-other-id'},['name','organizationId']),/关联项目/u);
  assert.equal(name.value,'cloud value');assert.equal(organization.value,'saved-one');
  applyDraftFields(form,{name:'local value',organizationId:'saved-one'},['name','organizationId']);assert.equal(name.value,'local value');
});
test('restore rejects unknown fields and excessive local records',()=>{
  assert.equal(validDraftFields({notes:'x'.repeat(32001)}),false);assert.equal(validDraftFields({list:Array(101).fill('x')}),false);
  assert.throws(()=>applyDraftFields({elements:[input('name','cloud')]},{password:'value'},['name']),/字段/u);
});

test('local operation scopes bind the current complete role set before any read',()=>{
  assert.equal(operationsDraftPage('review',['reviewer','outreach']),operationsDraftPage('review',['outreach','reviewer']));
  assert.notEqual(operationsDraftPage('review',['reviewer']),operationsDraftPage('review',['editor','publisher','outreach','reviewer']));
  for(const roles of [[],['reviewer','reviewer'],['unknown'],null])assert.throws(()=>operationsDraftPage('review',roles),/权限/u);
});

test('atomic known rejection derives only original typed fields and refuses historical uncertainty',async()=>{
  const{operationsDraftPolicy}=await import('../src/lib/operations-draft-fields.mjs');let firstAttempt=true;
  const policy=operationsDraftPolicy(()=>true,()=>firstAttempt),value={fields:{name:'synthetic typed value'},path:'/api/admin/contacts',method:'POST',payloadJson:'{}',uncertain:false};
  assert.deepEqual(policy.rejectPending(value),{fields:value.fields});
  assert.equal(policy.rejectPending({...value,uncertain:true}),null);const legacy={...value};delete legacy.uncertain;assert.equal(policy.rejectPending(legacy),null);
  firstAttempt=false;assert.equal(policy.rejectPending(value),null,'a refreshed original operation is unknown even if its old flag says false');
  assert.equal(policy.validate({fields:value.fields},{kind:'editing'}),true);assert.equal(policy.validate({...value,uncertain:'false'},{kind:'pending_submission'}),false);
});
