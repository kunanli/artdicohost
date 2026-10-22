import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffSettings} from '../src/scripts/staff-settings.mjs';
const directory={revision:0,users:[{id:'owner',username:'owner',label:'合成管理员',roles:['superadmin'],active:true,protected:true}]};
globalThis.document={createElement:()=>({append(){},addEventListener(){},dataset:{}})};

// A small DOM stand-in lets the regression control file/read completion order.
// No real records, images, credentials, browser storage or HTTP are involved.
function fixture(request,options={}){
  const nodes=new Map(),events=[];
  const get=selector=>{
    if(!nodes.has(selector)){
      const listeners=new Map(),fields=new Map();
      const node={hidden:false,textContent:'',value:'',disabled:false,listeners,dataset:{},
        addEventListener:(type,listener)=>listeners.set(type,listener),querySelectorAll:()=>[],
        reset(){for(const field of fields.values())field.value='';},reportValidity:()=>true,focus(){},
        replaceChildren(){},append(){},removeAttribute(){},cloneNode(){return {...this};},replaceWith(next){nodes.set(selector,next);},
        elements:{namedItem(name){if(!fields.has(name))fields.set(name,{value:'',files:[],required:false});return fields.get(name);}},
      };
      nodes.set(selector,node);
    }
    return nodes.get(selector);
  };
  const root={hidden:true,querySelector:get,querySelectorAll:selector=>selector==='form'?['user','group','restore'].map(kind=>get(`[data-${kind}-form]`)):[],dispatchEvent:event=>events.push(event)};
  const controller=createStaffSettings({root,request,binaryRequest:()=>{throw new Error('unexpected binary call');},...options});
  return {controller,get,events};
}
const account=id=>({id,roles:['superadmin']});
const group=revision=>{const at=Date.now();return{revision,configured:false,expired:true,expiresAt:null,serverTime:new Date(at).toISOString(),maxExpiresAt:new Date(at+7*86400000).toISOString()};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('group subpage initializes only group state even for a superadmin',async()=>{
  const calls=[];const f=fixture(async path=>{calls.push(path);return group(0);},{section:'group'});
  await f.controller.configure(account('owner'));
  assert.deepEqual(calls,['/api/admin/group-invite']);
});

test('accounts subpage preserves account gates without loading group images',async()=>{
  for(const roles of [['superadmin'],['editor','publisher','outreach','reviewer']]){
    const calls=[];const f=fixture(async path=>{calls.push(path);return path.endsWith('/users')?directory:{enabled:false};},{section:'accounts'});
    await f.controller.configure({id:'synthetic',roles});
    assert.deepEqual(calls,roles.includes('superadmin')?['/api/admin/users','/api/admin/maintenance']:[]);
  }
  assert.throws(()=>fixture(async()=>{}, {section:'unknown'}),TypeError);
});

test('an old file upload cannot submit using a newly authenticated account',async()=>{
  const writes=[];let release;
  const f=fixture(async(path,options={})=>{
    if(options.method){writes.push(path);throw new Error('unexpected write');}
    if(path.endsWith('/users'))return directory;
    if(path.endsWith('/group-invite'))return group(0);
    return {enabled:false};
  });
  await f.controller.configure(account('old'));
  const form=f.get('[data-group-form]');
  form.elements.namedItem('image').files=[{type:'image/png',size:1,arrayBuffer:()=>new Promise(resolve=>{release=resolve;})}];
  form.elements.namedItem('expiresAt').value=new Date(Date.now()+2*86400000).toISOString().slice(0,16);
  form.listeners.get('submit')({preventDefault(){},currentTarget:form});await tick();
  assert.equal(f.controller.pending,true);
  f.controller.clear();await f.controller.configure(account('new'));
  release(new Uint8Array([1]).buffer);await tick();
  assert.deepEqual(writes,[]);assert.equal(f.controller.pending,false);assert.equal(f.get('[data-settings-error]').textContent,'');
});

test('a late same-account group read cannot replace a newer revision',async()=>{
  const reads=[];
  const f=fixture(async path=>{
    if(path.endsWith('/users'))return directory;
    if(path.endsWith('/group-invite'))return new Promise(resolve=>reads.push(resolve));
    return {enabled:false};
  });
  const first=f.controller.configure(account('same'));
  const second=f.controller.configure(account('same'));
  reads[1](group(2));await second;reads[0](group(1));await first;
  assert.equal(f.events.length,1);assert.equal(f.events[0].detail.configured,false);
  assert.equal(f.get('[data-settings-error]').textContent,'');
});

test('an uncertain group write stays blocked after a read without durable write proof',async()=>{
  let writes=0;const originalConfirm=globalThis.confirm;globalThis.confirm=()=>true;
  try{
    const f=fixture(async(path,options={})=>{
      if(options.method){writes++;const error=new Error('服务暂不可用');error.status=503;throw error;}
      if(path.endsWith('/users'))return directory;
      if(path.endsWith('/group-invite'))return {revision:1,configured:true,expired:false,expiresAt:new Date(Date.now()+86400000).toISOString()};
      return {enabled:false};
    });
    await f.controller.configure(account('same'));
    f.get('[data-group-disable]').listeners.get('click')();await tick();
    assert.equal(writes,1);assert.equal(f.controller.pending,true);assert.equal(f.get('[data-group-disable]').disabled,true);
    assert.equal(f.get('[data-group-refresh]').disabled,false);assert.match(f.get('[data-settings-pending]').textContent,/待核对/u);
    f.get('[data-group-refresh]').listeners.get('click')();await tick();
    assert.equal(writes,1);assert.equal(f.controller.pending,true);
    assert.match(f.get('[data-settings-error]').textContent,/不能证明先前修改成功/u);
  }finally{globalThis.confirm=originalConfirm;}
});


test('a selected group expiry outside the server rolling window fails inline without sending or clearing the image',async()=>{
  const calls=[],f=fixture(async(path,options={})=>{calls.push({path,...options});return group(0);},{section:'group'});
  await f.controller.configure(account('owner'));
  const form=f.get('[data-group-form]'),file={type:'image/png',size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer};
  form.elements.namedItem('image').files=[file];form.elements.namedItem('expiresAt').value=new Date(Date.now()+10*86400000).toISOString().slice(0,16);
  form.listeners.get('submit')({preventDefault(){},currentTarget:form});await tick();
  assert.equal(calls.some(call=>call.method),false);assert.match(f.get('[data-group-expiry-error]').textContent,/最晚可选/u);
  assert.equal(form.elements.namedItem('image').files[0],file);assert.equal(f.get('[data-settings-form-state="group"]').dataset.saveState,'error');
});
test('a group settings refresh preserves an entered date and does not silently replace it with a later maximum',async()=>{
  const f=fixture(async()=>group(0),{section:'group'});await f.controller.configure(account('owner'));
  const field=f.get('[data-group-form]').elements.namedItem('expiresAt'),entered='2026-10-30T23:59';field.value=entered;
  f.get('[data-group-refresh]').listeners.get('click')();await tick();assert.equal(field.value,entered);
});
