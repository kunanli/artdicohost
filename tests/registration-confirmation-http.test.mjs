import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationConfirmationApi } from '../functions/registration-confirmation/handler.mjs';
import { ConfirmationError } from '../functions/registration-confirmation/service.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { COLLABORATOR_ROLES } from '../shared/staff-permissions.mjs';

const API = 'https://api.artdico.host', SITE = 'https://artdico.host', csrf = 's'.repeat(43);
function fixture() {
  const state = { authCalls: 0, readCalls: 0, writes: [], actor: { id: 'synthetic-owner', roles: ['superadmin'] }, error: null };
  const auth = { async authenticate() { state.authCalls++; return state.actor ? { user: state.actor, csrfToken: csrf } : null; } };
  const service = {
    async confirmation(value) { state.readCalls++; if (state.error) throw state.error; return { referenceCode: 'a'.repeat(43), admission: { status: 'confirmed' }, inputMatched: value.receiptToken === 'c1.synthetic.capability' }; },
    async settings() { state.readCalls++; return { revision: 0, automaticEnabled: true, email: { ready: false, missing: ['EMAILJS_CONFIRMATION_TEMPLATE_ID'] } }; },
    async setSettings(value) { state.writes.push(value); return { outcome: 'updated', revision: 1, automaticEnabled: value.enabled }; },
    async dispatch(value) { state.writes.push(value); return { outcome: 'updated', revision: 1, results: [] }; },
  };
  const handle = createRegistrationConfirmationApi({ service, auth });
  return { state, handle };
}
const req = (path, { method = 'POST', origin = SITE, input = { receiptToken: 'c1.synthetic.capability' }, headers = {} } = {}) => new Request(API + path,
  { method, headers: { ...(origin === null ? {} : { origin }), 'content-type': 'application/json', ...headers }, ...(method === 'GET' || method === 'OPTIONS' ? {} : { body: JSON.stringify(input) }) });

test('canonical and existing-trigger receipt aliases allow exact public Origin and never read a staff session', async () => {
  const f = fixture();
  for (const path of ['/api/registration/confirmation', '/api/admin/registration/confirmation']) {
    const response = await f.handle(req(path, { headers: { cookie: 'staff-cookie-not-used' } }));
    assert.equal(response.status, 200); assert.equal((await response.json()).inputMatched, true);
    assert.equal(response.headers.get('access-control-allow-origin'), SITE); assert.equal(response.headers.get('access-control-allow-credentials'), null);
    assert.equal(response.headers.get('set-cookie'), null); assert.match(response.headers.get('cache-control'), /no-store/u);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  }
  assert.equal(f.state.authCalls, 0); assert.equal(f.state.readCalls, 2); assert.deepEqual(f.state.writes, []);
  const preflight = await f.handle(req('/api/registration/confirmation', { method: 'OPTIONS' }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-headers'), 'Content-Type');
  assert.equal(f.state.readCalls, 2);
});

test('foreign or missing origins, query tokens and wrong public methods do not reach private sources', async () => {
  const f = fixture();
  for (const origin of [null, API, 'https://foreign.example.invalid']) assert.equal((await f.handle(req('/api/registration/confirmation', { origin }))).status, 403);
  assert.equal((await f.handle(req('/api/registration/confirmation?receiptToken=PRIVATE', {}))).status, 404);
  assert.equal((await f.handle(req('/api/registration/confirmation', { method: 'GET' }))).status, 405);
  assert.equal(f.state.readCalls, 0); assert.equal(f.state.authCalls, 0); assert.deepEqual(f.state.writes, []);
});

test('full operations and CSRF boundaries run before settings reads, recipient dispatch or bounded body consumption', async () => {
  const f = fixture(); f.state.actor = null;
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'GET' }))).status, 401);
  f.state.actor = { id: 'synthetic-editor', roles: ['editor', 'outreach', 'reviewer'] };
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'GET' }))).status, 403);
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/dispatch', { origin: API, input: { registrationIds: [] } }))).status, 403);
  f.state.actor = { id: 'synthetic-owner', roles: ['superadmin'] };
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'PUT', input: { enabled: true } }))).status, 403);
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: SITE, method: 'GET' }))).status, 403);
  assert.equal(f.state.readCalls, 0); assert.deepEqual(f.state.writes, []);
});

test('only the full collaborator preset gains confirmation settings and explicit dispatch at the HTTP boundary', async () => {
  for (let mask = 0; mask < 16; mask++) {
    const f = fixture(); f.state.actor = { id: 'synthetic-collaborator', roles: COLLABORATOR_ROLES.filter((_, index) => mask & 1 << index) };
    const permitted = mask === 15 ? 200 : 403;
    assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'GET' }))).status, permitted);
    assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'PUT', input: { expectedRevision: 0, operationId: 'o'.repeat(43), enabled: true }, headers: { 'x-csrf-token': csrf } }))).status, permitted);
    assert.equal((await f.handle(req('/api/admin/registration-confirmation/dispatch', { origin: API, input: { expectedRevision: 1, operationId: 'p'.repeat(43), registrationIds: ['a'.repeat(43)] }, headers: { 'x-csrf-token': csrf } }))).status, permitted);
    assert.equal(f.state.readCalls, mask === 15 ? 1 : 0); assert.equal(f.state.writes.length, mask === 15 ? 2 : 0);
  }
});

test('authorized settings and exact dispatch bodies receive only the trusted authenticated actor', async () => {
  const f = fixture();
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/settings', { origin: null, method: 'GET' }))).status, 200);
  const mutation = { expectedRevision: 0, operationId: 'o'.repeat(43), enabled: false };
  const saved = await f.handle(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'PUT', input: mutation, headers: { 'x-csrf-token': csrf } }));
  assert.equal(saved.status, 200); assert.deepEqual(f.state.writes[0], { ...mutation, actor: f.state.actor });
  const batch = { expectedRevision: 1, operationId: 'b'.repeat(43), registrationIds: ['a'.repeat(43)], retryRejected: true };
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/dispatch', { origin: API, input: batch, headers: { 'x-csrf-token': csrf } }))).status, 200);
  assert.deepEqual(f.state.writes[1], { ...batch, actor: f.state.actor });
  assert.equal((await f.handle(req('/api/admin/registration-confirmation/dispatch', { origin: API, input: { ...batch, actor: { roles: ['superadmin'] } }, headers: { 'x-csrf-token': csrf } }))).status, 400);
  assert.equal(f.state.writes.length, 2);
});

test('malformed, encoded, oversized and unknown confirmation fields fail before service reads', async () => {
  const f = fixture();
  assert.equal((await f.handle(req('/api/registration/confirmation', { input: { receiptToken: 'x'.repeat(17_000) } }))).status, 413);
  assert.equal((await f.handle(req('/api/registration/confirmation', { input: { receiptToken: 'c1.synthetic.capability', registrationId: 'a'.repeat(43) } }))).status, 400);
  assert.equal((await f.handle(req('/api/registration/confirmation', { headers: { 'content-encoding': 'gzip' } }))).status, 415);
  assert.equal((await f.handle(new Request(API + '/api/registration/confirmation', { method: 'POST', headers: { origin: SITE, 'content-type': 'application/json' }, body: '{bad' }))).status, 400);
  assert.equal(f.state.readCalls, 0); assert.equal(f.state.authCalls, 0);
});

test('only fixed errors leave public confirmation, including failure from trusted dependencies', async () => {
  const f = fixture();
  for (const error of [new Error('PRIVATE-PROVIDER-DETAIL'), new ConfirmationError('PRIVATE-SECRET', 418)]) {
    f.state.error = error; const response = await f.handle(req('/api/registration/confirmation'));
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE|SECRET|PROVIDER-DETAIL/u);
  }
  f.state.error = new ConfirmationError('CONFIRMATION_NOT_FOUND', 404);
  assert.equal((await f.handle(req('/api/registration/confirmation'))).status, 404);
  const authFailure = createRegistrationConfirmationApi({ service: {}, auth: { authenticate: async () => { throw new CloudContentError('AUTH_REQUIRED', 'PRIVATE-AUTH', 401); } } });
  const response = await authFailure(req('/api/admin/registration-confirmation/settings', { origin: API, method: 'GET' }));
  assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /PRIVATE/u);
});
