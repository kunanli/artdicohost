import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationConfirmationApi } from '../functions/registration-confirmation/handler.mjs';
import { ConfirmationError } from '../functions/registration-confirmation/service.mjs';

const API = 'https://api.artdico.host', manager = { id: 'synthetic-manager', roles: ['superadmin'] };
const operationId = 'o'.repeat(43), registrationId = 'r'.repeat(43), csrf = 'synthetic-csrf';
const prefix = '/api/admin/registration-confirmation/';
function request(path, { method = 'POST', body = {}, origin = API, token = csrf, headers = {} } = {}) {
  return new Request(API + prefix + path, { method, headers: {
    ...(origin === null ? {} : { origin }), ...(token === null ? {} : { 'x-csrf-token': token }), ...headers,
    ...(method === 'GET' ? {} : { 'content-type': 'application/json' }),
  }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
function fixture(user = manager) {
  const calls = [], service = Object.fromEntries(['staffReminderPreview', 'dispatchReminder', 'reminderOperation'].map(name => [name, async input => { calls.push({ name, input }); return { synthetic: true }; }]));
  const handler = createRegistrationConfirmationApi({ service, auth: { authenticate: async () => user ? { user, csrfToken: csrf } : null } });
  return { calls, service, handler };
}

test('reminder preview and dispatch authenticate full operations and CSRF before private service access', async () => {
  for (const path of ['reminder-preview', 'reminder-dispatch']) {
    for (const user of [null, { id: 'synthetic-reviewer', roles: ['reviewer'] }, { id: 'synthetic-outreach', roles: ['outreach'] }]) {
      const f = fixture(user), response = await f.handler(request(path));
      assert.equal(response.status, user ? 403 : 401); assert.equal(f.calls.length, 0);
    }
    const f = fixture();
    for (const options of [{ origin: null }, { origin: 'https://artdico.host' }, { origin: 'https://foreign.example.invalid' }, { token: null }, { token: 'wrong' }]) {
      assert.equal((await f.handler(request(path, options))).status, 403);
    }
    assert.equal(f.calls.length, 0);
    const combined = fixture({ id: 'synthetic-collaborator', roles: ['editor', 'outreach', 'publisher', 'reviewer'] });
    const response = await combined.handler(request(path, { body: path === 'reminder-preview' ? {} : { expectedRevision: 0, operationId, registrationIds: [registrationId] } }));
    assert.equal(response.status, 200); assert.equal(combined.calls.length, 1);
  }
});

test('reminder endpoints whitelist exact bounded bodies and route fixed notification purposes', async () => {
  const f = fixture();
  assert.equal((await f.handler(request('reminder-preview'))).status, 200);
  assert.deepEqual(f.calls.pop(), { name: 'staffReminderPreview', input: { actor: manager } });
  const preview = { cursor: 'synthetic-cursor', registrationIds: [registrationId] };
  assert.equal((await f.handler(request('reminder-preview', { body: preview }))).status, 200);
  assert.deepEqual(f.calls.pop(), { name: 'staffReminderPreview', input: { ...preview, actor: manager } });
  const body = { expectedRevision: 7, operationId, registrationIds: [registrationId], retryRejected: false };
  assert.equal((await f.handler(request('reminder-dispatch', { body }))).status, 200);
  assert.deepEqual(f.calls.pop(), { name: 'dispatchReminder', input: { ...body, actor: manager } });
  for (const [path, invalidBody] of [['reminder-preview', { kind: 'registration' }], ['reminder-preview', { actor: manager }],
    ['reminder-dispatch', { ...body, kind: 'application_received' }], ['reminder-dispatch', { registrationIds: [registrationId] }]]) {
    assert.equal((await f.handler(request(path, { body: invalidBody }))).status, 400);
  }
  assert.equal(f.calls.length, 0);
  const oversized = await f.handler(request('reminder-preview', { body: { cursor: 'a'.repeat(17_000) } }));
  assert.equal(oversized.status, 413); assert.equal(f.calls.length, 0);
  for (const path of ['reminder-preview', 'reminder-dispatch']) {
    assert.equal((await f.handler(request(path, { method: 'GET' }))).status, 405);
    assert.equal((await f.handler(request(path + '?cursor=anything'))).status, 404);
  }
});

test('unknown reminder operation recovery is a role-gated read-only GET bound to the original operator', async () => {
  for (const user of [null, { id: 'synthetic-reviewer', roles: ['reviewer'] }]) {
    const f = fixture(user); assert.equal((await f.handler(request('reminder-operation/' + operationId, { method: 'GET' }))).status, user ? 403 : 401);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(), response = await f.handler(request('reminder-operation/' + operationId, { method: 'GET', token: null, origin: null }));
  assert.equal(response.status, 200); assert.deepEqual(f.calls.pop(), { name: 'reminderOperation', input: { actor: manager, operationId } });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await f.handler(request('reminder-operation/' + operationId))).status, 405);
  assert.equal((await f.handler(request('reminder-operation/' + operationId + '?retry=true', { method: 'GET' }))).status, 404);
  assert.equal(f.calls.length, 0);
  f.service.reminderOperation = async () => { throw new ConfirmationError('CONFIRMATION_NOT_FOUND', 404); };
  assert.equal((await f.handler(request('reminder-operation/' + operationId, { method: 'GET' }))).status, 404);
});

test('reminder handler returns fixed errors without leaking underlying private inputs', async () => {
  const f = fixture();
  for (const name of ['staffReminderPreview', 'dispatchReminder', 'reminderOperation']) f.service[name] = async () => { throw new Error('SYNTHETIC_PRIVATE_EMAIL_AND_LINK'); };
  for (const [path, options] of [['reminder-preview', {}], ['reminder-dispatch', { body: { expectedRevision: 0, operationId, registrationIds: [registrationId] } }],
    ['reminder-operation/' + operationId, { method: 'GET' }]]) {
    const response = await f.handler(request(path, options)); assert.equal(response.status, 503);
    assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE_EMAIL_AND_LINK/u);
  }
});
