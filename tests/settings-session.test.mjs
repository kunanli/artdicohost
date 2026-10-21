import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettingsSession} from '../src/lib/settings-session.mjs';
const session=id=>({user:{id,roles:['superadmin']},csrfToken:id.repeat(43).slice(0,43)});
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
test('a late settings 401 cannot clear a newer account or expose an old result',async()=>{
  let release,expired=0;
  const transport=createSettingsSession({fetchFn:()=>new Promise(resolve=>{release=resolve;}),onExpired:()=>expired++});
  transport.setSession(session('a'));const old=transport.request('/api/admin/users');transport.clear();transport.setSession(session('b'));
  release(new Response('{}',{status:401}));await assert.rejects(old,/会话已改变/u);assert.equal(expired,0);
});
test('late JSON and explicit session expiry retain their own generation boundary',async()=>{
  let release,expired=0;
  const transport=createSettingsSession({fetchFn:async()=>({ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(resolve=>{release=resolve;})}),onExpired:()=>expired++});
  transport.setSession(session('a'));const old=transport.request('/api/admin/group-invite');await new Promise(resolve=>setImmediate(resolve));
  transport.clear();transport.setSession(session('b'));release({private:'old'});await assert.rejects(old,/会话已改变/u);assert.equal(expired,0);
  const current=createSettingsSession({fetchFn:async()=>new Response('{}',{status:401}),onExpired:()=>expired++});
  current.setSession(session('a'));await assert.rejects(current.request('/api/admin/users'),/会话已结束/u);assert.equal(expired,1);
});
test('settings requests keep credentials same-origin and never retry a failed write',async()=>{
  const calls=[];const transport=createSettingsSession({fetchFn:async(path,options)=>{calls.push({path,options});return new Response('{}',{status:503});}});
  transport.setSession(session('a'));await assert.rejects(transport.request('/api/admin/users',{method:'POST',body:'{}'}),error=>error.status===503);
  assert.equal(calls.length,1);assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers['X-CSRF-Token'],'a'.repeat(43));
  await assert.rejects(transport.request('https://foreign.invalid/api/admin/users'));assert.equal(calls.length,1);
  const readonly=createSettingsSession({fetchFn:async()=>json({ready:true})});assert.deepEqual(await readonly.request('/api/admin/session'),{ready:true});
});
test('revoked permissions clear the current private workspace and malformed sessions are rejected',async()=>{
  let forbidden=0;
  const transport=createSettingsSession({fetchFn:async()=>new Response('{}',{status:403}),onForbidden:()=>forbidden++});
  transport.setSession(session('a'));const before=transport.generation;
  await assert.rejects(transport.request('/api/admin/users'),/权限/u);assert.equal(forbidden,1);assert.ok(transport.generation>before);
  for(const value of [{}, {...session('a'),csrfToken:'short'}, {...session('a'),user:{id:'a',roles:'superadmin'}}])assert.throws(()=>transport.setSession(value),/会话/u);
});
