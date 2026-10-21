import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionsApi, MAX_ADMISSIONS_BODY_BYTES } from '../functions/registration-admin/admissions-handler.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

const ROOT = 'https://api.artdico.host/api/admin/admissions', operationId = 'a'.repeat(43), id = 'r'.repeat(43);
const methods = ['getAdmissions', 'setAdmissionSettings', 'setAdmissionKind', 'approveApplication', 'rejectApplication', 'withdrawAdmission', 'promoteAdmissions', 'saveAdmissionTeam', 'removeAdmissionTeam', 'addStaffMember'];
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

function decisionApi({ action = 'approve', outcome = 'updated', patch, roles = ['reviewer'], onCommitted } = {}) {
  const input = { registrationId: id, expectedRevision: 4, operationId }, calls = [];
  const result = { outcome, revision: 5, settings: {}, summary: {},
    people: [{ registrationId: id, status: action === 'approve' ? 'confirmed' : 'rejected' }], teams: [], auditCount: 5,
    registrationId: id, promotedIds: [], releasedIds: [], operation: { operationId, action, registrationId: id, revision: 5 } };
  const service = Object.fromEntries(methods.map(method => [method, async value => { calls.push({ method, value }); return structuredClone(patch ? patch(result) : result); }]));
  const handle = createAdmissionsApi({ enabled: true, service, onCommitted,
    auth: { authenticate: async () => ({ user: { id: 'synthetic-reviewer', roles }, csrfToken: 'synthetic-csrf' }) } });
  return { handle, input, calls };
}

test('explicit approve and reject require reviewer, exact identity, origin and CSRF before any service mutation', async () => {
  for (const action of ['approve', 'reject']) {
    for (const roles of [[], ['editor'], ['outreach']]) {
      const f = decisionApi({ action, roles });
      assert.equal((await f.handle(request('/' + action, 'POST', f.input))).status, 403); assert.deepEqual(f.calls, []);
    }
    const f = decisionApi({ action });
    for (const [value, expected] of [[request('/' + action, 'POST', { ...f.input, registrationId: 'bad' }), 400],
      [request('/' + action, 'POST', { ...f.input, status: 'confirmed' }), 400],
      [request('/' + action, 'POST', f.input, { Origin: 'https://foreign.example.invalid' }), 403],
      [request('/' + action, 'POST', f.input, { 'X-CSRF-Token': 'wrong' }), 403]]) assert.equal((await f.handle(value)).status, expected);
    assert.deepEqual(f.calls, []);
    const response = await f.handle(request('/' + action, 'POST', f.input)); assert.equal(response.status, 200);
    const body = await response.json(); assert.equal(body.operation.action, action);
    assert.equal(f.calls[0].method, action === 'approve' ? 'approveApplication' : 'rejectApplication');
  }
});

test('decision ACK is bound to the exact operation, target, revision and action before delivery', async () => {
  for (const patch of [value => ({ ...value, operation: undefined }), value => ({ ...value, registrationId: 'x'.repeat(43) }),
    value => ({ ...value, operation: { ...value.operation, operationId: 'x'.repeat(43) } }),
    value => ({ ...value, operation: { ...value.operation, action: 'reject' } }),
    value => ({ ...value, operation: { ...value.operation, registrationId: 'x'.repeat(43) } }),
    value => ({ ...value, operation: { ...value.operation, revision: 6 } }),
    value => ({ ...value, people: [] }), value => ({ ...value, promotedIds: [id] }),
    value => ({ outcome: 'unavailable' })]) {
    let sends = 0; const f = decisionApi({ patch, onCommitted: async () => { sends++; } });
    const response = await f.handle(request('/approve', 'POST', f.input));
    assert.equal(response.status, 503); assert.equal(sends, 0); assert.equal(f.calls.length, 1);
  }
});

test('approval ACK invokes separate target and genuine promotion notification projections; failures preserve the saved decision', async () => {
  const promoted = 'p'.repeat(43); let observed;
  const f = decisionApi({ patch: value => ({ ...value, promotedIds: [promoted] }), onCommitted: async value => {
    observed = value; value.result.revision = 999;
    return { approvalEmail: { status: 'completed', attemptedCount: 1, pendingCount: 0, privateDetail: 'PRIVATE' },
      promotionEmail: { status: 'pending', attemptedCount: 0, pendingCount: 1 } };
  } });
  const response = await f.handle(request('/approve', 'POST', f.input)), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.revision, 5); assert.equal(observed.action, 'approve');
  assert.equal(observed.result.registrationId, id); assert.deepEqual(observed.result.promotedIds, [promoted]);
  assert.deepEqual(body.approvalEmail, { status: 'completed', attemptedCount: 1, pendingCount: 0 });
  assert.deepEqual(body.promotionEmail, { status: 'pending', attemptedCount: 0, pendingCount: 1 });
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE/u);
  const failing = decisionApi({ onCommitted: async () => { throw new Error('PRIVATE'); } });
  const saved = await (await failing.handle(request('/approve', 'POST', failing.input))).json();
  assert.equal(saved.outcome, 'updated'); assert.deepEqual(saved.approvalEmail, { status: 'pending', attemptedCount: 0, pendingCount: 1 });
  const rejected = decisionApi({ action: 'reject', onCommitted: () => assert.fail('A rejection with no promotions never notifies') });
  assert.equal((await rejected.handle(request('/reject', 'POST', rejected.input))).status, 200);
});

test('replaying an approval returns the current withdrawn state with the original operation ACK', async () => {
  const f = decisionApi({ outcome: 'replayed', patch: value => ({ ...value, revision: 8, people: [{ registrationId: id, status: 'withdrawn' }] }) });
  const response = await f.handle(request('/approve', 'POST', f.input)), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.operation.revision, 5); assert.equal(body.revision, 8);
  assert.equal(body.people[0].status, 'withdrawn'); assert.equal(f.calls.length, 1);
});

test('approved waitlist omits formal mail while a fresh withdrawal can explicitly report not applicable', async () => {
  const waiting = decisionApi({ patch: value => ({ ...value, people: [{ registrationId: id, status: 'waitlisted' }] }), onCommitted: async () => ({}) });
  const deferred = await (await waiting.handle(request('/approve', 'POST', waiting.input))).json();
  assert.equal(deferred.approvalEmail, undefined);
  const withdrawn = decisionApi({ onCommitted: async () => ({ approvalEmail: { status: 'not_applicable', attemptedCount: 0, pendingCount: 0 } }) });
  const current = await (await withdrawn.handle(request('/approve', 'POST', withdrawn.input))).json();
  assert.deepEqual(current.approvalEmail, { status: 'not_applicable', attemptedCount: 0, pendingCount: 0 });
});
