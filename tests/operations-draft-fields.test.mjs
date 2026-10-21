import test from 'node:test';
import assert from 'node:assert/strict';
import {captureDraftFields,applyDraftFields,validDraftFields} from '../src/lib/operations-draft-fields.mjs';
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
