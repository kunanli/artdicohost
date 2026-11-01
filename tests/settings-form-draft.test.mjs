import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsFormDraft} from '../src/lib/settings-form-draft.mjs';

function fixture(options={}){
  const nodes=[],scopes=[],calls={remove:0,confirm:0,discard:0};
  const original={body:'{ "operationId":"original", "registrationIds":["synthetic"] }'};
  let snapshot={revision:1,actorEpoch:0,record:{kind:'pending_submission',baseRevision:2,value:original}};
  const element=()=>{const node={children:[],dataset:{},hidden:false,textContent:'',events:new Map(),append(...children){this.children.push(...children);},addEventListener(name,fn){this.events.set(name,fn);},removeEventListener(){},before(){},remove(){}};nodes.push(node);return node;};
  const oldDocument=globalThis.document,oldConfirm=globalThis.confirm;
  globalThis.document={createElement:element};globalThis.confirm=()=>{calls.confirm++;return true;};
  const store={read:async scope=>{scopes.push(structuredClone(scope));return structuredClone(snapshot);},write:async()=>assert.fail('this recovery must not write another request'),subscribe:()=>()=>{},remove:async()=>{calls.remove++;snapshot={...snapshot,revision:snapshot.revision+1,record:null};return structuredClone(snapshot);}};
  const form=element(),binding=createSettingsFormDraft({store,actorId:'synthetic-actor',eventId:'synthetic-event',entity:'delivery-formal',form,policy:{fields:['body'],pendingFields:['body'],validate:()=>true},baseRevision:()=>2,isCurrent:()=>true,capture:()=>original,apply:()=>assert.fail('pending must not apply a new form'),onDiscard:()=>{calls.discard++;},...options});
  return{binding,calls,scopes,original,get snapshot(){return structuredClone(snapshot);},discardButton:nodes[0]===form?nodes[5]:null,findDiscard:()=>nodes.find(node=>node.textContent==='已手动核对，解除锁定'),cleanup(){binding.close();globalThis.document=oldDocument;globalThis.confirm=oldConfirm;}};
}

test('formal pending cannot be discarded through hidden actions or the public recovery API without proven completion',async()=>{
  const f=fixture({allowPendingDiscard:false,scopePage:'settings:roles=superadmin'});try{
    await f.binding.load();const button=f.findDiscard();assert.ok(button);assert.equal(button.hidden,true);
    await button.events.get('click')();assert.equal(f.calls.confirm,0);assert.equal(f.calls.remove,0);
    await assert.rejects(f.binding.discard(),/尚待核对/u);assert.equal(f.binding.pending,true);assert.deepEqual(f.snapshot.record.value,f.original);
    assert.equal(f.scopes[0].page,'settings:roles=superadmin');
    await f.binding.discard({resolvedPending:true});assert.equal(f.calls.remove,1);assert.equal(f.binding.pending,false);
  }finally{f.cleanup();}
});

test('default settings recovery retains its existing explicit manual discard and legacy settings scope',async()=>{
  const f=fixture();try{
    await f.binding.load();const button=f.findDiscard();assert.equal(button.hidden,false);await button.events.get('click')();
    assert.equal(f.calls.confirm,1);assert.equal(f.calls.remove,1);assert.equal(f.calls.discard,1);assert.equal(f.scopes[0].page,'settings');
  }finally{f.cleanup();}
});
