import test from 'node:test';
import assert from 'node:assert/strict';
import {createStaffSettings} from '../src/scripts/staff-settings.mjs';

// A small DOM stand-in lets the regression control file/read completion order.
// No real records, images, credentials, browser storage or HTTP are involved.
function fixture(request){
  const nodes=new Map(),events=[];
  const get=selector=>{
    if(!nodes.has(selector)){
      const listeners=new Map(),fields=new Map();
      const node={hidden:false,textContent:'',value:'',disabled:false,listeners,
        addEventListener:(type,listener)=>listeners.set(type,listener),querySelectorAll:()=>[],
        reset(){for(const field of fields.values())field.value='';},reportValidity:()=>true,focus(){},
        replaceChildren(){},removeAttribute(){},cloneNode(){return {...this};},replaceWith(next){nodes.set(selector,next);},
        elements:{namedItem(name){if(!fields.has(name))fields.set(name,{value:'',files:[],required:false});return fields.get(name);}},
      };
      nodes.set(selector,node);
    }
    return nodes.get(selector);
  };
  const root={hidden:true,querySelector:get,querySelectorAll:selector=>selector==='form'?['user','group','restore'].map(kind=>get(`[data-${kind}-form]`)):[],dispatchEvent:event=>events.push(event)};
  const controller=createStaffSettings({root,request,binaryRequest:()=>{throw new Error('unexpected binary call');}});
  return {controller,get,events};
}
const account=id=>({id,roles:['superadmin']});
const group=revision=>({revision,configured:false,expired:true,expiresAt:null});
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('an old file upload cannot submit using a newly authenticated account',async()=>{
  const writes=[];let release;
  const f=fixture(async(path,options={})=>{
    if(options.method){writes.push(path);throw new Error('unexpected write');}
    if(path.endsWith('/users'))return {revision:0,users:[]};
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
    if(path.endsWith('/users'))return {revision:0,users:[]};
    if(path.endsWith('/group-invite'))return new Promise(resolve=>reads.push(resolve));
    return {enabled:false};
  });
  const first=f.controller.configure(account('same'));
  const second=f.controller.configure(account('same'));
  reads[1](group(2));await second;reads[0](group(1));await first;
  assert.equal(f.events.length,1);assert.equal(f.events[0].detail.configured,false);
  assert.equal(f.get('[data-settings-error]').textContent,'');
});

test('an uncertain group write blocks another mutation until an explicit read, without claiming success',async()=>{
  let writes=0;const originalConfirm=globalThis.confirm;globalThis.confirm=()=>true;
  try{
    const f=fixture(async(path,options={})=>{
      if(options.method){writes++;const error=new Error('服务暂不可用');error.status=503;throw error;}
      if(path.endsWith('/users'))return {revision:0,users:[]};
      if(path.endsWith('/group-invite'))return {revision:1,configured:true,expired:false,expiresAt:new Date(Date.now()+86400000).toISOString()};
      return {enabled:false};
    });
    await f.controller.configure(account('same'));
    f.get('[data-group-disable]').listeners.get('click')();await tick();
    assert.equal(writes,1);assert.equal(f.controller.pending,true);assert.equal(f.get('[data-group-disable]').disabled,true);
    assert.equal(f.get('[data-group-refresh]').disabled,false);assert.match(f.get('[data-settings-pending]').textContent,/待核对/u);
    f.get('[data-group-refresh]').listeners.get('click')();await tick();
    assert.equal(writes,1);assert.equal(f.controller.pending,false);
    assert.match(f.get('[data-settings-status]').textContent,/不代表先前修改成功/u);
  }finally{globalThis.confirm=originalConfirm;}
});
