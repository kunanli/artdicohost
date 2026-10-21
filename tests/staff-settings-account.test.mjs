import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {staffDirectory,staffUserSaveAcknowledged,generateInitialStaffPassword} from '../src/scripts/staff-settings.mjs';

const owner={id:'owner',username:'owner',label:'合成管理员',roles:['superadmin'],active:true,protected:true};
const collaborator={id:'staff_synthetic',username:'zhouyufei',label:'zhouyufei',roles:['editor','publisher','outreach','reviewer'],active:true,protected:false};
const before={revision:5,users:[owner]},after={revision:6,users:[owner,collaborator]};
const input={expectedRevision:5,username:'zhouyufei',label:'zhouyufei',roles:collaborator.roles,active:true,password:'synthetic-memory-only-password'};
const clone=value=>structuredClone(value);

test('only an exact actual create response acknowledges the new collaborator and unchanged directory',()=>{
  assert.equal(staffUserSaveAcknowledged({input,before,after}),true);
  assert.equal(staffUserSaveAcknowledged({input,before,after:{...after,revision:5}}),false);
  assert.equal(staffUserSaveAcknowledged({input,before,after:{...after,revision:7}}),false);
  assert.equal(staffUserSaveAcknowledged({input:{...input,expectedRevision:4},before,after}),false);
  for(const mutate of[
    value=>value.users.pop(),value=>value.users[1].roles.pop(),value=>value.users[1].roles.push('superadmin'),
    value=>value.users[1].active=false,value=>value.users[1].protected=true,value=>value.users[1].username='wangying',
    value=>value.users[1].id='owner',value=>value.users[0].label='mutated owner',value=>value.users[0].roles.push('reviewer'),
    value=>value.users.push({...collaborator,id:'extra'}),value=>value.users[1].passwordHash='must-never-project',
  ]){const bad=clone(after);mutate(bad);assert.equal(staffUserSaveAcknowledged({input,before,after:bad}),false);}
});

test('edit acknowledgements require stable ID, exact active state and preserved optional email',()=>{
  const original={revision:6,users:[owner,{...collaborator,email:'synthetic@artdico.co'}]};
  const edit={...input,id:collaborator.id,expectedRevision:6,active:false};
  const saved={revision:7,users:[owner,{...original.users[1],active:false}]};
  assert.equal(staffUserSaveAcknowledged({input:edit,before:original,after:saved}),true);
  assert.equal(staffUserSaveAcknowledged({input:{...edit,id:'absent'},before:original,after:saved}),false);
  assert.equal(staffUserSaveAcknowledged({input:{...edit,id:'owner'},before:original,after:saved}),false);
  const newId=clone(saved);newId.users[1].id='staff_replaced';assert.equal(staffUserSaveAcknowledged({input:edit,before:original,after:newId}),false);
  const email=clone(saved);email.users[1].email='other@artdico.co';assert.equal(staffUserSaveAcknowledged({input:edit,before:original,after:email}),false);
  assert.equal(staffUserSaveAcknowledged({input:{...input,expectedRevision:6},before:original,after:saved}),false,'an existing username cannot be acknowledged as newly created');
});

test('directory projection rejects sparse/accessor arrays, secret additions and malformed public rows',()=>{
  assert.deepEqual(staffDirectory(before),before);
  const accessor=clone(before);Object.defineProperty(accessor.users[0].roles,'0',{get(){throw new Error('must not execute');},enumerable:true});
  assert.equal(staffDirectory(accessor),null);
  const sparse=clone(before);sparse.users[0].roles=new Array(1);assert.equal(staffDirectory(sparse),null);
  for(const row of[{...owner,token:'private'},{...owner,passwordHash:'private'},{...owner,roles:['superadmin','superadmin']},{...owner,active:1},{...owner,email:'bad@example.invalid'}])assert.equal(staffDirectory({revision:0,users:[row]}),null);
});

test('independent initial passwords require cryptographic random bytes and clear their scratch buffer',()=>{
  const first=generateInitialStaffPassword(webcrypto),second=generateInitialStaffPassword(webcrypto);
  assert.equal(first.length,36);assert.match(first,/^Aa1![A-Za-z0-9_-]{32}$/u);assert.notEqual(first,second);
  let scratch;generateInitialStaffPassword({getRandomValues(bytes){scratch=bytes;bytes.fill(37);return bytes;}});assert.ok(scratch.every(byte=>byte===0));
  assert.throws(()=>generateInitialStaffPassword({}),/无法生成/u);
});
