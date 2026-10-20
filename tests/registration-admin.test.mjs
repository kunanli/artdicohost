import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationReviewStore, defaultRegistrationReview } from '../functions/registration-admin/store.mjs';
import { createRegistrationAdminApi } from '../functions/registration-admin/handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { parseAdminUsers } from '../functions/content-api/auth.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT = '2026-10-20T07:00:00.000Z', EVENT = 'ggj-cn-2026';
const A = 'A'.repeat(43), B = 'B'.repeat(43), C = 'C'.repeat(43);
const PRIVATE = 'PRIVATE-SYNTHETIC-REVIEW-NOTE';
const clone = value => structuredClone(value);
const record = (id, fields = {}, extra = {}) => ({ id, referenceCode: id, eventId: EVENT, submittedAt: AT,
  fields: { name: '合成来宾', organization: '合成机构', city: '深圳', position: '合成角色', categories: ['industry'], participationInterests: ['attend'],
    attendance: 'expected', accommodationChoice: 'not_needed', email: 'synthetic@example.invalid', wechat: 'private-synthetic-only', ...fields },
  consent: { accepted: true, version: 'synthetic-notice-v1', acceptedAt: AT }, provenance: { kind: 'public' }, ...extra });
function fixture(initial = [record(A), record(B, { name: '合成组织者', categories: ['so', 'ro'], city: '广州', accommodationChoice: 'needed' })]) {
  const objects = memoryObjects();
  let registrations = clone(initial), sourceRevision = initial.length;
  const journal = () => createObjectJournal({ objects, prefix: 'cms/v1/registration-reviews/ggj-cn-2026' });
  const loadRegistrations = async () => ({ registrations: clone(registrations), revision: sourceRevision });
  const store = () => createRegistrationReviewStore({ journal: journal(), loadRegistrations, eventId: EVENT, clock: () => Date.parse(AT) });
  return { objects, store, journal, records: () => clone(registrations), append: value => { registrations.push(clone(value)); sourceRevision++; } };
}
function editable(review) { const value = clone(review); delete value.deletionRequested; return value; }
const request = (path, { method = 'GET', role = 'superadmin', csrf = 'synthetic-csrf', origin = method === 'GET' ? undefined : 'https://api.artdico.host', body, headers = {} } = {}) =>
  new Request('https://api.artdico.host' + path, { method, headers: { Cookie: role, ...(origin ? { Origin: origin } : {}), 'X-CSRF-Token': csrf,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
const auth = { authenticate: async request => ({ user: { id: 'synthetic-staff', roles: [request.headers.get('cookie') ?? 'editor'] }, csrfToken: 'synthetic-csrf' }) };
async function rejects(promise, code) { await assert.rejects(promise, error => error.code === code && !error.message.includes(PRIVATE) && !error.cause); }

test('registration reviewer and superadmin roles require explicit account configuration and retain original roles', () => {
  const hash = 'scrypt$16384$8$1$' + 'A'.repeat(22) + '$' + 'B'.repeat(86);
  for (const roles of [['reviewer'], ['superadmin'], ['editor', 'publisher', 'outreach'], ['editor', 'superadmin']]) {
    const [user] = parseAdminUsers([{ id: 'synthetic', username: 'synthetic', label: '合成账号', roles, passwordHash: hash }]);
    assert.deepEqual(user.roles, roles);
  }
  assert.throws(() => parseAdminUsers([{ id: 'synthetic', username: 'synthetic', label: '合成账号', roles: ['owner'], passwordHash: hash }]), TypeError);
});

test('review filtering, totals and paging preserve one application per multi-category person and minimize list fields', async () => {
  const f = fixture(), store = f.store();
  const first = await store.list({ limit: 1 });
  assert.equal(first.total, 2); assert.equal(first.stats.byCategory.so, 1); assert.equal(first.stats.byCategory.ro, 1);
  assert.equal(first.stats.byAccommodation.requested, 1);
  assert.equal(first.registrations.length, 1); assert.ok(first.nextCursor);
  assert.equal(Object.hasOwn(first.registrations[0].fields, 'email'), false);
  assert.equal(Object.hasOwn(first.registrations[0].fields, 'wechat'), false);
  const second = await store.list({ limit: 1, cursor: first.nextCursor });
  assert.notEqual(first.registrations[0].id, second.registrations[0].id); assert.equal(second.nextCursor, null);
  const filtered = await store.list({ filters: { category: 'ro', accommodation: 'requested', city: '广州', query: '合成组织者' } });
  assert.equal(filtered.total, 1); assert.equal(filtered.overallTotal, 2);
  f.append(record(C));
  await rejects(store.list({ cursor: first.nextCursor }), 'REVISION_CONFLICT');
  await rejects(store.list({ filters: { email: 'private' } }), 'INVALID_REQUEST');
  await rejects(store.list({ filters: { status: 'confirmed' } }), 'INVALID_REQUEST');
  await rejects(store.list({ cursor: 'invalid' }), 'INVALID_REQUEST');
});

test('independent review stores enforce CAS, preserve raw application and keep accommodation decisions independent', async () => {
  const f = fixture(), a = f.store(), b = f.store();
  const original = f.records(), input = editable((await a.detail(B)).review);
  input.status = 'approved'; input.accommodationStatus = 'pending'; input.internalNotes = PRIVATE; input.recommendation = 'priority';
  const outcomes = await Promise.allSettled([a.saveReview(B, 0, input, 'reviewer-one'), b.saveReview(B, 0, { ...input, status: 'discussion' }, 'reviewer-two')]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(outcome => outcome.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const detail = await f.store().detail(B);
  assert.equal(detail.revision, 1); assert.equal(detail.review.accommodationStatus, 'pending'); assert.equal(detail.review.internalNotes, PRIVATE);
  assert.deepEqual(f.records(), original);
  const stored = (await f.journal().read()).value;
  assert.equal(stored.audit.length, 1); assert.doesNotMatch(JSON.stringify(stored.audit), /PRIVATE-SYNTHETIC-REVIEW-NOTE|example.invalid/u);
  await rejects(a.saveReview(A, 1, { ...editable((await a.detail(A)).review), accommodationStatus: 'approved' }, 'reviewer-one'), 'INVALID_REVIEW');
  await rejects(a.saveReview(B, 1, { ...input, mariaReviewDate: '2026-02-30' }, 'reviewer-one'), 'INVALID_REVIEW');
  await rejects(a.saveReview(B, 1, { ...input, approvedHotel: true }, 'reviewer-one'), 'INVALID_REVIEW');
});

test('exports persist an audit before returning minimal CSV and guard spreadsheet formulas', async () => {
  const f = fixture([record(A, { name: '=1+1', organization: '\t@SUM(1)', city: '深圳' })]), store = f.store();
  const result = await store.exportCsv(0, {}, 'synthetic-admin');
  assert.equal(result.revision, 1); assert.equal(result.count, 1);
  assert.match(result.csv, /"'=1\+1"/u); assert.match(result.csv, /"'\t@SUM\(1\)"/u);
  assert.doesNotMatch(result.csv, /synthetic@example.invalid|private-synthetic-only|internalNotes/u);
  const state = (await f.journal().read()).value;
  assert.deepEqual(state.audit[0].metadata, { count: 1, contactIncluded: false, filterNames: [] });
  const contact = await store.exportCsv(1, {}, 'synthetic-admin', { includeContact: true });
  assert.match(contact.csv, /synthetic@example.invalid/u);
  f.objects.setFailure('append');
  await rejects(store.exportCsv(2, {}, 'synthetic-admin'), 'STORAGE_UNAVAILABLE');
});

test('unknown acknowledgement never returns success or retries, while durable review can be inspected later', async () => {
  const f = fixture(), base = f.journal();
  let mutations = 0;
  const journal = { read: base.read, async commit(...args) { mutations++; await base.commit(...args); throw new Error(PRIVATE); } };
  const store = createRegistrationReviewStore({ journal, loadRegistrations: async () => ({ registrations: f.records(), revision: 2 }), eventId: EVENT, clock: () => Date.parse(AT) });
  const review = editable(defaultRegistrationReview(f.records()[0])); review.status = 'in_review';
  await rejects(store.saveReview(A, 0, review, 'synthetic'), 'STORAGE_UNAVAILABLE');
  assert.equal(mutations, 1); assert.equal((await f.store().detail(A)).review.status, 'in_review');
});

test('deletion requests are explicit audited maintenance requests and never claim physical erasure', async () => {
  const f = fixture(), store = f.store();
  const result = await store.requestDeletion(A, 0, 'request', 'synthetic-admin');
  assert.equal(result.erased, false); assert.equal(result.maintenanceRequired, true);
  assert.equal(result.review.deletionRequested.status, 'pending');
  assert.equal((await store.detail(A)).registration.fields.email, 'synthetic@example.invalid');
  await rejects(store.requestDeletion(A, 1, 'request', 'synthetic-admin'), 'REVISION_CONFLICT');
  const input = editable(result.review); input.status = 'withdrawn';
  const saved = await store.saveReview(A, 1, input, 'synthetic-admin');
  assert.deepEqual(saved.review.deletionRequested, result.review.deletionRequested);
});

test('HTTP boundary requires dedicated review role, exact Origin and CSRF; exports and deletion need extra authority', async () => {
  const f = fixture(), api = createRegistrationAdminApi({ enabled: true, auth, store: f.store() });
  for (const role of ['editor', 'outreach', 'publisher']) assert.equal((await api(request('/api/admin/registrations', { role }))).status, 403);
  assert.equal((await api(request('/api/admin/registrations', { role: 'reviewer' }))).status, 200);
  assert.equal((await api(request('/api/admin/registrations', { origin: 'https://artdico.host' }))).status, 403);
  assert.equal((await api(request('/api/admin/registrations/export', { method: 'POST', role: 'reviewer', body: { expectedRevision: 0 } }))).status, 403);
  const input = editable((await f.store().detail(A)).review);
  assert.equal((await api(request(`/api/admin/registrations/${A}/review`, { method: 'PATCH', csrf: 'wrong', body: { expectedRevision: 0, review: input } }))).status, 403);
  const save = await api(request(`/api/admin/registrations/${A}/review`, { method: 'PATCH', role: 'reviewer', body: { expectedRevision: 0, review: input } }));
  assert.equal(save.status, 200);
  const exportResult = await api(request('/api/admin/registrations/export', { method: 'POST', body: { expectedRevision: 1 } }));
  assert.equal(exportResult.status, 200); assert.match(exportResult.headers.get('content-type'), /text\/csv/u); assert.equal(exportResult.headers.get('cache-control'), 'no-store');
  assert.equal((await api(request(`/api/admin/registrations/${A}/deletion-request`, { method: 'POST', role: 'reviewer', body: { expectedRevision: 2, reason: 'request' } }))).status, 403);
  const erased = await api(request(`/api/admin/registrations/${A}/deletion-request`, { method: 'POST', body: { expectedRevision: 2, reason: 'request' } }));
  assert.equal(erased.status, 200); assert.equal((await erased.json()).erased, false);
  const delegated = createRegistrationAdminApi({ enabled: true, auth, store: f.store(), canExport: user => user.roles.includes('reviewer') });
  assert.equal((await delegated(request('/api/admin/registrations/export', { method: 'POST', role: 'reviewer', body: { expectedRevision: 3, includeContact: true } }))).status, 403);
});

test('HTTP encoding, duplicate/unknown filters and storage failures never expose input or provider details', async () => {
  const f = fixture(), api = createRegistrationAdminApi({ enabled: true, auth, store: f.store() });
  for (const path of ['/api/admin/registrations?category=so&category=ro', '/api/admin/registrations?secret=PRIVATE', '/api/admin/registrations?limit=1000']) {
    const response = await api(request(path)); assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /PRIVATE/u);
  }
  const malformed = await api(request('/api/admin/registrations/export', { method: 'POST', body: '{' })); assert.equal(malformed.status, 400);
  const oversized = await api(request('/api/admin/registrations/export', { method: 'POST', body: JSON.stringify({ input: 'x'.repeat(33000) }) })); assert.equal(oversized.status, 413);
  f.objects.setFailure('get');
  const response = await api(request('/api/admin/registrations')); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE_PROVIDER_DETAIL|cms\/v1/u);
  assert.equal((await createRegistrationAdminApi()(request('/api/admin/registrations'))).status, 503);
});

test('staff-assisted provenance remains distinct and malformed stored consent or audit data fails closed', async () => {
  const source = record(A, {}, { consent: { accepted: false, version: null, acceptedAt: null },
    provenance: { kind: 'staff_assisted', sourceContactId: 'synthetic-contact', actorId: 'synthetic-staff', recordedAt: AT, permissionReference: 'PRIVATE-SYNTHETIC-REFERENCE' } });
  const f = fixture([source]), store = f.store();
  const row = (await store.list()).registrations[0];
  assert.deepEqual(row.provenance, { kind: 'staff_assisted', sourceContactId: 'synthetic-contact' });
  assert.doesNotMatch(JSON.stringify(row), /PRIVATE-SYNTHETIC-REFERENCE/u);
  assert.equal((await store.detail(A)).registration.consent.accepted, false);
  const invalid = fixture([{ ...source, consent: { accepted: true, version: 'synthetic', acceptedAt: AT } }]);
  await rejects(invalid.store().list(), 'STORAGE_UNAVAILABLE');
  await store.saveReview(A, 0, editable(defaultRegistrationReview(source)), 'synthetic');
  const saved = await f.journal().read();
  for (const change of [value => { delete value.audit[0].actor; }, value => { value.audit[0].metadata = { changedFields: ['email'] }; }, value => { value.audit[0].at = '2026-02-30T00:00:00.000Z'; }]) {
    const changed = clone(saved); change(changed.value);
    const corrupted = createRegistrationReviewStore({ eventId: EVENT, journal: { read: async () => changed, commit() {} }, loadRegistrations: async () => ({ registrations: [source], revision: 1 }) });
    await rejects(corrupted.list(), 'STORAGE_UNAVAILABLE');
  }
});
