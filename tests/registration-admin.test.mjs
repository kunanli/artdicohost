import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationReviewStore, defaultRegistrationReview } from '../functions/registration-admin/store.mjs';
import { createRegistrationAdminApi } from '../functions/registration-admin/handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { parseAdminUsers } from '../functions/content-api/auth.mjs';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
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

test('sparse staff intake composes with withdrawal checks and preserves unknown applicant answers through review and export', async () => {
  const objects = memoryObjects(), journalFor = prefix => createObjectJournal({ objects, prefix });
  let reviews;
  const service = createRegistrationService({ objects, journalFor, capacity: 300, tokenSecret: 'PRIVATE-SYNTHETIC-REGISTRATION-COMPOSITION-KEY',
    allowedOrigins: ['https://artdico.host'], clock: () => Date.parse(AT), isWithdrawn: id => reviews.isWithdrawn(id), policy: {
      enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00',
      privacy: { version: 'synthetic-policy-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成参会登记', storageRegion: '合成地区', retention: '合成期限', rightsRequest: '通过合成邮箱申请查阅、更正及删除', sharing: '合成资料不对外分享' },
    } });
  reviews = createRegistrationReviewStore({ journal: journalFor('cms/v1/registration-reviews/' + EVENT), loadRegistrations: () => service.repository.list(), eventId: EVENT, clock: () => Date.parse(AT) });
  const fields = { name: '合成意向来宾', email: 'sparse@example.invalid' };
  const input = { sourceContactId: 'synthetic-intent', actor: { id: 'synthetic-staff', roles: ['superadmin'] }, input: { fields, permissionReference: '合成联络授权记录' } };
  const created = await service.submitStaffRegistration(input);
  assert.equal(created.outcome, 'created');
  const id = created.receipt.registrationId;
  assert.equal(await reviews.isWithdrawn(id), false);
  const detail = await reviews.detail(id);
  assert.deepEqual(detail.registration.fields, fields); assert.equal(detail.registration.consent.accepted, false);
  const listed = await reviews.list();
  assert.deepEqual(listed.registrations[0].fields, { name: fields.name });
  assert.equal(listed.stats.byAttendance.unknown, 1); assert.equal(listed.stats.byCategory.unknown, 1);
  assert.equal((await reviews.list({ filters: { city: '深圳' } })).total, 0);
  assert.equal((await reviews.list({ filters: { category: 'industry' } })).total, 0);
  const exported = await reviews.exportCsv(0, {}, 'synthetic-staff'); assert.doesNotMatch(exported.csv, /undefined|null/u);
  const updated = editable((await reviews.detail(id)).review); updated.status = 'withdrawn';
  await reviews.saveReview(id, 1, updated, 'synthetic-staff');
  assert.equal(await reviews.isWithdrawn(id), true);
  assert.equal((await service.submitStaffRegistration(input)).outcome, 'withdrawn');
  assert.deepEqual((await reviews.detail(id)).registration.fields, fields);
  const incompletePublic = fixture([{ ...record(A), fields }]);
  await rejects(incompletePublic.store().list(), 'STORAGE_UNAVAILABLE');
});

test('withdrawal guard reads only validated review state and fails closed on malformed tombstones or storage errors', async () => {
  const f = fixture(), full = f.store(); let applicationReads = 0;
  const fast = createRegistrationReviewStore({ journal: f.journal(), eventId: EVENT, loadRegistrations: async () => { applicationReads++; throw new Error(PRIVATE); } });
  assert.equal(await fast.isWithdrawn(A), false); assert.equal(await fast.isWithdrawn(C), false);
  await full.requestDeletion(A, 0, 'request', 'synthetic-admin');
  const before = f.objects.calls.length;
  assert.equal(await fast.isWithdrawn(A), true); assert.equal(applicationReads, 0);
  const reads = f.objects.calls.slice(before); assert.equal(reads.length, 2); assert.ok(reads.every(call => call.key.startsWith('cms/v1/registration-reviews/')));
  const saved = await f.journal().read();
  for (const change of [state => { state.value.reviews[A].deletionRequested.status = 'cleared'; }, state => { state.value.reviews[A].status = 'invalid'; }, state => { state.value.audit[0].metadata.reason = PRIVATE; }]) {
    const altered = clone(saved); change(altered);
    const corrupted = createRegistrationReviewStore({ eventId: EVENT, journal: { read: async () => altered, commit() {} }, loadRegistrations: async () => { throw new Error('must not read'); } });
    await rejects(corrupted.isWithdrawn(A), 'STORAGE_UNAVAILABLE');
  }
  f.objects.setFailure('get'); await rejects(fast.isWithdrawn(A), 'STORAGE_UNAVAILABLE'); assert.equal(applicationReads, 0);
});

test('ordinary public profiles and manual staff entries retain absence and explicit provenance', async () => {
  const ordinary = record(A); delete ordinary.fields.organization; delete ordinary.fields.position;
  const manual = record(B, {}, { fields: { name: '合成工作人员', wechat: 'synthetic-only' }, consent: { accepted: false, version: null, acceptedAt: null },
    provenance: { kind: 'staff_entry', actorId: 'synthetic-admin', recordedAt: AT, permissionReference: '合成核定来源', operationId: 'X'.repeat(43) } });
  const store = fixture([ordinary, manual]).store(), list = await store.list();
  assert.deepEqual(list.registrations.find(item => item.id === B).provenance, { kind: 'staff_entry' });
  assert.equal(Object.hasOwn(list.registrations.find(item => item.id === A).fields, 'organization'), false);
  assert.deepEqual((await store.detail(B)).registration.fields, manual.fields);
  assert.equal((await store.detail(B)).registration.consent.accepted, false);
  assert.equal(list.stats.byAttendance.unknown, 1);
  for (const provenance of [{ ...manual.provenance, operationId: '' }, { ...manual.provenance, recordedAt: 'invalid' }, { ...manual.provenance, permissionReference: '' }]) {
    await rejects(fixture([{ ...manual, provenance }]).store().list(), 'STORAGE_UNAVAILABLE');
  }
  await rejects(fixture([{ ...manual, consent: { accepted: true, version: 'invented', acceptedAt: AT } }]).store().list(), 'STORAGE_UNAVAILABLE');
});
