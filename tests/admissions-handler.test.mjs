import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionsApi, MAX_ADMISSIONS_BODY_BYTES } from '../functions/registration-admin/admissions-handler.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

const ROOT = 'https://api.artdico.host/api/admin/admissions', operationId = 'a'.repeat(43), id = 'r'.repeat(43);
const methods = ['getAdmissions', 'setAdmissionSettings', 'setAdmissionKind', 'withdrawAdmission', 'promoteAdmissions', 'saveAdmissionTeam', 'removeAdmissionTeam', 'addStaffMember'];
function setup(roles = ['superadmin'], outcome = 'updated') {
  const calls = [], actor = { id: 'synthetic-owner', roles };
  const service = Object.fromEntries(methods.map(method => [method, async input => { calls.push({ method, input });
    return { outcome, revision: 1, settings: { capacity: 3, staffReserve: 0, waitlistEnabled: true }, summary: {}, people: [], teams: [], auditCount: 1 }; }]));
  const handle = createAdmissionsApi({ enabled: true, auth: { authenticate: async () => ({ user: actor, csrfToken: 'synthetic-csrf' }) }, service });
  return { calls, handle, actor };
}
const request = (path = '', method = 'GET', body, headers = {}) => new Request(ROOT + path, { method,
  headers: { ...(method === 'GET' ? {} : { Origin: 'https://api.artdico.host', 'Content-Type': 'application/json', 'X-CSRF-Token': 'synthetic-csrf' }), ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });

test('ordinary editors and outreach cannot read private admissions, and rejected requests perform no service reads', async () => {
  for (const roles of [[], ['editor'], ['outreach']]) {
    const f = setup(roles); assert.equal((await f.handle(request())).status, 403); assert.deepEqual(f.calls, []);
  }
  for (const roles of [['reviewer'], ['superadmin']]) {
    const f = setup(roles); assert.equal((await f.handle(request())).status, 200); assert.equal(f.calls[0].input.actor, f.actor);
  }
  const f = setup();
  assert.equal((await f.handle(request('', 'GET', undefined, { Origin: 'https://artdico.host' }))).status, 403);
  assert.equal((await f.handle(request('?all=true'))).status, 400);
  assert.equal((await f.handle(request('/foreign'))).status, 404);
  assert.deepEqual(f.calls, []);
});

test('reviewers can coordinate withdrawal, promotion and teams but only superadmin can change reserve, kind or create staff', async () => {
  const reviewer = setup(['reviewer']), envelope = { expectedRevision: 0, operationId };
  for (const [path, input] of [['/withdraw', { registrationId: id }], ['/promote', {}], ['/teams', { team: { name: '合成团队', memberIds: [id] } }], ['/teams/remove', { teamId: 'synthetic-team' }]]) {
    assert.equal((await reviewer.handle(request(path, 'POST', { ...envelope, ...input }))).status, 200);
  }
  for (const [path, method, input] of [['/settings', 'PUT', { settings: { staffReserve: 0, waitlistEnabled: true } }], ['/kind', 'POST', { registrationId: id, kind: 'crew' }], ['/staff', 'POST', { input: { fields: { name: '合成工作人员' }, permissionReference: '合成授权', kind: 'crew' } }]]) {
    const body = { ...envelope, ...input };
    assert.equal((await reviewer.handle(request(path, method, body))).status, 403);
    const owner = setup(); assert.equal((await owner.handle(request(path, method, body))).status, 200);
    assert.equal(owner.calls[0].input.operationId, operationId);
    assert.equal(owner.calls[0].input.actor, owner.actor);
  }
  assert.equal(reviewer.calls.length, 4);
});

test('exact methods, origin, CSRF, bounded plain JSON and operation identity are enforced before mutation', async () => {
  const f = setup(), good = { expectedRevision: 0, operationId };
  const missing = request('/promote', 'POST', good); missing.headers.delete('origin');
  const csrf = request('/promote', 'POST', good); csrf.headers.delete('x-csrf-token');
  for (const [value, status] of [[missing, 403], [csrf, 403], [request('/settings', 'POST', good), 405], [request('/promote', 'POST', { ...good, actor: { id: 'foreign' } }), 400],
    [request('/promote', 'POST', { ...good, operationId: 'short' }), 400], [request('/promote', 'POST', { ...good, expectedRevision: -1 }), 400],
    [request('/promote', 'POST', '[]'), 400], [request('/promote', 'POST', good, { 'content-encoding': 'gzip' }), 415],
    [request('/promote', 'POST', 'x'.repeat(MAX_ADMISSIONS_BODY_BYTES + 1)), 413]]) assert.equal((await f.handle(value)).status, status);
  assert.deepEqual(f.calls, []);
});

test('service conflicts and unknown outcomes remain safe without retrying an admission mutation', async () => {
  for (const [outcome, status] of [['conflict', 409], ['capacity_conflict', 409], ['closed', 409], ['invalid', 400], ['not_found', 404], ['forbidden', 403], ['unavailable', 503], ['constructor', 503], ['__proto__', 503], ['PRIVATE_PROVIDER_DETAIL', 503]]) {
    const f = setup(['superadmin'], outcome), response = await f.handle(request('/promote', 'POST', { expectedRevision: 0, operationId }));
    assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER_DETAIL/u); assert.equal(f.calls.length, 1);
  }
  const denied = createAdmissionsApi({ enabled: true, auth: { authenticate() { throw new CloudContentError('AUTH_REQUIRED', 'PRIVATE', 401); } }, service: Object.fromEntries(methods.map(method => [method, () => {}])) });
  assert.equal((await denied(request())).status, 401);
  assert.equal((await createAdmissionsApi()(request())).status, 503);
});

test('a failed private admissions read never becomes an HTTP 200 empty snapshot', async () => {
  const service = Object.fromEntries(methods.map(method => [method, async () => ({ outcome: 'unavailable', privateDetails: 'PRIVATE_PROVIDER' })]));
  const api = createAdmissionsApi({ enabled: true, auth: { authenticate: async () => ({ user: { id: 'synthetic', roles: ['reviewer'] } }) }, service });
  const response = await api(request()); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /PRIVATE_PROVIDER/u);
});

test('promotion delivery runs only after a proven saved snapshot and cannot turn committed admissions into a failed request', async () => {
  const result = { outcome: 'updated', revision: 2, settings: {}, summary: {}, people: [], teams: [], auditCount: 2, promotedIds: [id] };
  let outcome = result, notifications = 0, mutations = 0;
  const service = Object.fromEntries(methods.map(method => [method, async () => { mutations++; return structuredClone(outcome); }]));
  const api = createAdmissionsApi({ enabled: true, service, auth: { authenticate: async () => ({ user: { id: 'synthetic-owner', roles: ['superadmin'] }, csrfToken: 'synthetic-csrf' }) },
    onCommitted: async ({ result: saved }) => { notifications++; saved.revision = 999; throw new Error('PRIVATE_PROVIDER_DETAIL'); } });
  const response = await api(request('/promote', 'POST', { expectedRevision: 1, operationId }));
  assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.revision, 2);
  assert.deepEqual(value.promotionEmail, { status: 'pending', attemptedCount: 0, pendingCount: 1 });
  assert.equal(notifications, 1); assert.equal(mutations, 1); assert.doesNotMatch(JSON.stringify(value), /PRIVATE_PROVIDER_DETAIL/u);
  outcome = { outcome: 'unavailable' };
  assert.equal((await api(request('/promote', 'POST', { expectedRevision: 1, operationId }))).status, 503);
  assert.equal(notifications, 1, 'an unknown mutation acknowledgement never starts optional delivery');
});
