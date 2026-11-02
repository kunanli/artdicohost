import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createRegistrationConfirmationApi } from '../functions/registration-confirmation/handler.mjs';
import { createCloudContentServer } from '../functions/cloud-content/http-server.mjs';
import { ConfirmationError } from '../functions/registration-confirmation/service.mjs';

const API = 'https://api.artdico.host', prefix = '/api/admin/registration-confirmation/';
const manager = { id: 'synthetic-owner', roles: ['superadmin'] }, op = 'o'.repeat(43), id = 'r'.repeat(43), csrf = 'synthetic-csrf';
function request(path, { method = 'POST', body = {}, origin = API, token = csrf } = {}) {
  return new Request(API + prefix + path, { method, headers: { ...(origin === null ? {} : { origin }),
    ...(token === null ? {} : { 'x-csrf-token': token }), ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
function fixture(user = manager) {
  const calls = [], service = Object.fromEntries(['staffConfirmationPreview', 'confirmationOperation', 'dispatch'].map(name => [name, async input => { calls.push({ name, input }); return { synthetic: true }; }]));
  return { calls, service, handler: createRegistrationConfirmationApi({ service, auth: { authenticate: async () => user ? { user, csrfToken: csrf } : null } }) };
}

test('formal preview requires full operations, same Origin and CSRF before service/private input access', async () => {
  for (const user of [null, { id: 'synthetic-reviewer', roles: ['reviewer'] }, { id: 'synthetic-partial', roles: ['outreach', 'reviewer'] }]) {
    const f = fixture(user); assert.equal((await f.handler(request('preview'))).status, user ? 403 : 401); assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  for (const options of [{ origin: null }, { origin: 'https://artdico.host' }, { origin: 'https://foreign.example.invalid' }, { token: null }, { token: 'wrong' }]) {
    assert.equal((await f.handler(request('preview', options))).status, 403); assert.equal(f.calls.length, 0);
  }
  const full = fixture({ id: 'synthetic-collaborator', roles: ['editor', 'publisher', 'outreach', 'reviewer'] });
  assert.equal((await full.handler(request('preview'))).status, 200); assert.equal(full.calls.length, 1);
});

test('formal preview whitelists bounded fixed-purpose body and leaves old dispatch four-field contract unchanged', async () => {
  const f = fixture(), body = { cursor: 'synthetic-cursor', registrationIds: [id] };
  assert.equal((await f.handler(request('preview', { body }))).status, 200);
  assert.deepEqual(f.calls.pop(), { name: 'staffConfirmationPreview', input: { ...body, actor: manager } });
  for (const bad of [{ kind: 'pre_event_reminder' }, { actor: manager }, { sourceRevision: 'a'.repeat(64) }, { expectedRevision: 0 }]) {
    assert.equal((await f.handler(request('preview', { body: bad }))).status, 400);
  }
  assert.equal((await f.handler(request('preview', { body: { cursor: 'a'.repeat(17_000) } }))).status, 413);
  assert.equal((await f.handler(request('preview', { method: 'GET' }))).status, 405);
  assert.equal((await f.handler(request('preview?cursor=x'))).status, 404);
  assert.equal(f.calls.length, 0);
  const original = { expectedRevision: 5, operationId: op, registrationIds: [id], retryRejected: false };
  assert.equal((await f.handler(request('dispatch', { body: original }))).status, 200);
  assert.deepEqual(f.calls.pop(), { name: 'dispatch', input: { ...original, actor: manager } });
  assert.equal((await f.handler(request('dispatch', { body: { ...original, sourceRevision: 'a'.repeat(64) } }))).status, 400);
  assert.equal(f.calls.length, 0);
});

test('single-person send translates the displayed recipient revision without changing legacy request replay shape',async()=>{
  const f=fixture(),base={expectedRevision:5,operationId:op,retryRejected:false};
  assert.equal((await f.handler(request('send/'+id,{body:base}))).status,200);
  assert.deepEqual(f.calls.pop(),{name:'dispatch',input:{...base,registrationIds:[id],actor:manager}});
  assert.equal((await f.handler(request('send/'+id,{body:{...base,expectedAccessRevision:2}}))).status,200);
  assert.deepEqual(f.calls.pop(),{name:'dispatch',input:{...base,registrationIds:[id],expectedAccessRevisions:{[id]:2},actor:manager}});
  for(const value of[-1,null,'1',0.5])assert.equal((await f.handler(request('send/'+id,{body:{...base,expectedAccessRevision:value}}))).status,400);
  assert.equal((await f.handler(request('send/'+id,{body:{...base,expectedAccessRevisions:{[id]:2}}}))).status,400);assert.equal(f.calls.length,0);
});

test('formal and reminder dispatch admit only an exact bounded recipient revision map',async()=>{
  const f=fixture();f.service.dispatchReminder=async input=>{f.calls.push({name:'dispatchReminder',input});return{synthetic:true};};
  const original={expectedRevision:5,operationId:op,registrationIds:[id],retryRejected:false},expectedAccessRevisions={[id]:2};
  for(const[path,name]of[['dispatch','dispatch'],['reminder-dispatch','dispatchReminder']]){
    assert.equal((await f.handler(request(path,{body:{...original,expectedAccessRevisions}}))).status,200);
    assert.deepEqual(f.calls.pop(),{name,input:{...original,expectedAccessRevisions,actor:manager}});
    for(const map of[null,[],{},{[id]:-1},{[id]:null},{[id]:'1'},{[id]:0.5},{[id]:1,extra:0},{['n'.repeat(43)]:1}])assert.equal((await f.handler(request(path,{body:{...original,expectedAccessRevisions:map}}))).status,400);
    assert.equal(f.calls.length,0);
  }
});

test('original formal operation lookup is authenticated read-only GET with private no-store headers', async () => {
  for (const user of [null, { id: 'synthetic-reviewer', roles: ['reviewer'] }]) {
    const f = fixture(user); assert.equal((await f.handler(request('operation/' + op, { method: 'GET' }))).status, user ? 403 : 401); assert.equal(f.calls.length, 0);
  }
  const f = fixture(), response = await f.handler(request('operation/' + op, { method: 'GET', origin: null, token: null }));
  assert.equal(response.status, 200); assert.deepEqual(f.calls.pop(), { name: 'confirmationOperation', input: { actor: manager, operationId: op } });
  assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  for (const [path, options, status] of [['operation/' + op, {}, 405], ['operation/' + op + '?retry=true', { method: 'GET' }, 404],
    ['operation/invalid', { method: 'GET' }, 404], ['operation/' + op, { method: 'GET', origin: 'https://artdico.host' }, 403]]) {
    assert.equal((await f.handler(request(path, options))).status, status);
  }
  assert.equal(f.calls.length, 0);
});

test('formal operation errors preserve 404 versus unavailable without leaking details or inventing completed rows', async () => {
  const f = fixture();
  f.service.confirmationOperation = async () => { throw new ConfirmationError('CONFIRMATION_NOT_FOUND', 404); };
  assert.equal((await f.handler(request('operation/' + op, { method: 'GET' }))).status, 404);
  for (const method of ['staffConfirmationPreview', 'confirmationOperation']) f.service[method] = async () => { throw new Error('SYNTHETIC_PRIVATE_MAIL_OR_LINK'); };
  for (const [path, method] of [['preview', 'POST'], ['operation/' + op, 'GET']]) {
    const response = await f.handler(request(path, { method })); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE|results|checkedAt/u);
  }
});

test('actual HTTP adapter caps formal preview at 16KiB before forwarding to runtime', async t => {
  let calls = 0;
  const server = createCloudContentServer({ assets: new Map(), runtime: { configured: true, handle: async () => { calls++; return new Response('{}'); } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = text => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ host: '127.0.0.1', port: server.address().port, path: prefix + 'preview', method: 'POST',
      headers: { host: 'api.artdico.host', connection: 'close', 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, incoming => {
      incoming.resume(); incoming.on('end', () => resolve(incoming.statusCode));
    });
    outgoing.on('error', reject); outgoing.end(text);
  });
  assert.equal(await send(JSON.stringify({ cursor: 'a'.repeat(17_000) })), 413); assert.equal(calls, 0);
  assert.equal(await send('{}'), 200); assert.equal(calls, 1);
});
