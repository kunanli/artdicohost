import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFileContactsStore } from '../functions/content-api/contacts-store.mjs';
import { validateImportedContact, validateContactOperations, validateInvitationSettings, createEmptyContactOperations, MAX_IMPORT_ROWS } from '../shared/contacts-schema.mjs';

const PASSWORD = 'synthetic-private-outreach-password';
const passwordHash = await hashPassword(PASSWORD);
const users = [
  { id: 'test-outreach', username: 'test-outreach', label: '合成联络账号', roles: ['outreach'], passwordHash },
  { id: 'test-second', username: 'test-second', label: '合成另一联络账号', roles: ['outreach'], passwordHash },
  { id: 'test-editor', username: 'test-editor', label: '合成编辑账号', roles: ['editor'], passwordHash },
  { id: 'test-publisher', username: 'test-publisher', label: '合成发布账号', roles: ['publisher'], passwordHash },
  { id: 'test-combined', username: 'test-combined', label: '合成邀约编辑账号', roles: ['outreach', 'editor'], passwordHash },
];
const ORIGIN = 'http://127.0.0.1:8787';
const TEST_ROOT = fileURLToPath(new URL('../.local-data/', import.meta.url));
const SOURCE = 'wjx-synthetic-test';

function row(sourceRowId = '1', overrides = {}) {
  return {
    sourceRowId, name: '合成对象 ' + sourceRowId, displayName: '合成邀请称呼 ' + sourceRowId,
    email: 'synthetic-' + sourceRowId + '@example.invalid', wechat: 'synthetic-wechat-' + sourceRowId,
    city: '合成城市', organization: '合成团队', categories: ['so'], interests: ['roundtable'],
    attendanceIntentCode: '1', accommodationIntentCode: '2', contactConsentCode: '1', futureCooperationCode: '3',
    contactConsent: 'consented', contactConsentLabel: '同意',
    ...overrides,
  };
}
async function fixture(t, options = {}) {
  await mkdir(TEST_ROOT, { recursive: true });
  const directory = await mkdtemp(join(TEST_ROOT, 'artdico-contacts-test-'));
  t.after(async () => {
    const path = relative(resolve(TEST_ROOT), resolve(directory));
    assert.ok(!isAbsolute(path) && path.startsWith('artdico-contacts-test-') && !path.startsWith('..'));
    await rm(directory, { recursive: true, force: true });
  });
  const contentStore = createFileContentStore({ directory });
  const contactsStore = createFileContactsStore({ directory, contentStore, ...options });
  const api = createContentApi({ store: contentStore, contactsStore, users, allowedOrigin: ORIGIN });
  return { directory, contentStore, contactsStore, api };
}
function request(api, path, { method = 'GET', payload, session, origin = ORIGIN, csrf = session?.csrfToken } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.cookie = session.cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  return api(new Request(ORIGIN + path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }));
}
async function login(api, username = 'test-outreach') {
  const response = await request(api, '/api/admin/login', { method: 'POST', payload: { username, password: PASSWORD } });
  assert.equal(response.status, 200);
  return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function preview(api, session, rows = [row()], sourceKey = SOURCE) {
  const response = await request(api, '/api/admin/contacts/import/preview', { method: 'POST', session, payload: { sourceKey, rows } });
  assert.equal(response.status, 200);
  return response.json();
}
async function commitImport(api, session, previewValue, expectedRevision = 0, allowPossibleDuplicates = false) {
  return request(api, '/api/admin/contacts/import', { method: 'POST', session, payload: { expectedRevision, previewToken: previewValue.previewToken, allowPossibleDuplicates } });
}
async function importOne(api, session) {
  const response = await commitImport(api, session, await preview(api, session));
  assert.equal(response.status, 200);
  return response.json();
}

test('private import whitelists source fields and keeps unknown numeric codes without inventing consent', () => {
  const result = validateImportedContact(row('1', { ip: '198.51.100.1', device: 'synthetic device', consentAccepted: true, attendance: 'confirmed', contactConsent: undefined, contactConsentLabel: '', email: ' SYNTHETIC@example.invalid ', website: 'javascript:synthetic-untrusted-text' }));
  assert.equal(result.valid, true);
  assert.equal(result.value.email, 'synthetic@example.invalid');
  assert.equal(result.value.contactConsentCode, '1');
  assert.equal(result.value.contactConsent, 'unknown');
  assert.equal(result.value.attendanceIntentCode, '1');
  for (const key of ['ip', 'device', 'consentAccepted', 'attendance']) assert.equal(key in result.value, false);
  assert.equal(result.value.website, 'javascript:synthetic-untrusted-text');
  assert.equal(validateImportedContact(row('2', { categories: ['certified_site'] })).valid, false);
  assert.equal(validateImportedContact(row('2', { interests: ['auto_exhibitor'] })).valid, false);
  assert.equal(validateImportedContact(row('2', { wechat: 123456 })).valid, false);
  assert.equal(validateInvitationSettings({ recipientName: '合成对象', date: '2026-12-05', time: '10:00-18:00', venue: '合成场地' }).value.confirmed, false);
});

test('contacts require explicit outreach role, authentication, origin and CSRF checks', async (t) => {
  const { api } = await fixture(t);
  assert.equal((await request(api, '/api/admin/contacts')).status, 401);
  const editor = await login(api, 'test-editor');
  const publisher = await login(api, 'test-publisher');
  for (const session of [editor, publisher]) {
    assert.equal((await request(api, '/api/admin/contacts', { session })).status, 403);
    assert.equal((await request(api, '/api/admin/contacts/import/preview', { method: 'POST', session, payload: { sourceKey: SOURCE, rows: [row()] } })).status, 403);
  }
  const session = await login(api);
  const response = await request(api, '/api/admin/contacts', { session });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { revision: 0, contacts: [] });
  assert.equal((await request(api, '/api/admin/contacts/import/preview', { method: 'POST', session, csrf: 'wrong', payload: {} })).status, 403);
  assert.equal((await request(api, '/api/admin/contacts', { session, origin: 'https://example.invalid' })).status, 403);
  assert.equal((await request(api, '/api/admin/content/publish', { method: 'POST', session, payload: { expectedRevision: 0 } })).status, 403);
});

test('outreach planning is minimal without granting access to private content drafts', async t => {
  const { api, contentStore } = await fixture(t), session = await login(api);
  const { draft } = await contentStore.read();
  draft.content.sessions[0].speakerName = 'SYNTHETIC_PRIVATE_SPEAKER';
  draft.content.sessions[0].internalNotes = 'SYNTHETIC_PRIVATE_NOTE';
  draft.content.booths.push({ id: 'synthetic-planning-booth', code: 'C-99', zone: 'C', organization: '合成展位团队', project: '合成作品', status: 'pending', internalNotes: 'SYNTHETIC_PRIVATE_BOOTH' });
  await contentStore.save(0, draft.content, 'test-editor');
  const response = await request(api, '/api/admin/planning', { session });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const planning = await response.json();
  assert.deepEqual(planning.features, { contactImport: true, communicationsPreview: true });
  assert.deepEqual(Object.keys(planning.content.sessions[0]).sort(), ['id', 'start', 'end', 'zone', 'title', 'status'].sort());
  assert.deepEqual(planning.content.booths[0], { id: 'synthetic-planning-booth', code: 'C-99', zone: 'C', organization: '合成展位团队', project: '合成作品', status: 'pending' });
  assert.equal(JSON.stringify(planning).includes('SYNTHETIC_PRIVATE'), false);
  assert.equal((await request(api, '/api/admin/content', { session })).status, 403);
  assert.equal((await request(api, '/api/admin/planning')).status, 401);
  assert.equal((await request(api, '/api/admin/planning', { session: await login(api, 'test-editor') })).status, 403);
});

test('manual create and basic corrections preserve source, consent, operations and invitation across restarts', async t => {
  const { api, directory, contentStore } = await fixture(t), session = await login(api);
  const profile = { name: '合成手动对象', organization: '合成组织', email: 'synthetic-manual@example.invalid' };
  const createdResponse = await request(api, '/api/admin/contacts', { method: 'POST', session, payload: { expectedRevision: 0, profile } });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.revision, 1); assert.equal(created.contact.source.key, 'manual');
  assert.match(created.contact.source.rowId, /^[a-f0-9]{32}$/u);
  assert.equal(created.contact.profile.contactConsent, 'unknown');
  assert.equal(created.contact.operations.responseStatus, 'pending');
  const sameEmail = await (await request(api, '/api/admin/contacts', { method: 'POST', session, payload: { expectedRevision: 1, profile } })).json();
  assert.notEqual(sameEmail.contact.id, created.contact.id); // Matching personal fields never merge identities.
  const editedResponse = await request(api, '/api/admin/contacts/' + created.contact.id + '/profile', { method: 'PUT', session, payload: { expectedRevision: 2, profile: { name: '合成修正', email: 'synthetic-corrected@example.invalid' } } });
  assert.equal(editedResponse.status, 200);
  const edited = await editedResponse.json();
  assert.deepEqual(edited.contact.source, created.contact.source);
  assert.deepEqual(edited.contact.sourceProfile, created.contact.profile);
  assert.match(edited.contact.sourceProfileDigest, /^[a-f0-9]{64}$/u);
  assert.deepEqual(edited.contact.operations, created.contact.operations);
  assert.deepEqual(edited.contact.invitation, created.contact.invitation);
  assert.equal(edited.contact.profile.contactConsent, 'unknown');
  const restarted = createFileContactsStore({ directory, contentStore });
  assert.deepEqual((await restarted.read()).contacts[0], edited.contact);
  const audit = JSON.parse(await readFile(join(directory, 'contacts.json'), 'utf8')).audit;
  assert.equal(audit[0].action, 'create_contact'); assert.equal(audit[0].consentSource, 'staff_assertion');
  assert.equal(audit[0].contactConsent, 'unknown'); assert.doesNotMatch(JSON.stringify(audit), /example.invalid|合成手动对象/u);
});

test('imported correction retains first original snapshot and exact source reimport remains unchanged', async t => {
  const { api, directory } = await fixture(t), session = await login(api);
  const imported = await importOne(api, session), original = imported.contacts[0];
  const operations = { ...original.operations, notes: '合成跟进保留', responseStatus: 'attending' };
  assert.equal((await request(api, '/api/admin/contacts/' + original.id, { method: 'PUT', session, payload: { expectedRevision: 1, operations } })).status, 200);
  const first = await (await request(api, '/api/admin/contacts/' + original.id + '/profile', { method: 'PUT', session, payload: { expectedRevision: 2, profile: { name: '合成修正甲', organization: '合成修正组织', categories: ['student'] } } })).json();
  const second = await (await request(api, '/api/admin/contacts/' + original.id + '/profile', { method: 'PUT', session, payload: { expectedRevision: 3, profile: { name: '合成修正乙' } } })).json();
  assert.deepEqual(first.contact.sourceProfile, original.profile); assert.deepEqual(second.contact.sourceProfile, original.profile);
  assert.deepEqual(first.contact.profile.categories, ['student']); assert.deepEqual(second.contact.profile.categories, ['student']);
  assert.deepEqual(second.contact.source, original.source); assert.deepEqual(second.contact.operations, operations);
  const plan = await preview(api, session); assert.equal(plan.summary.unchanged, 1);
  const before = await readFile(join(directory, 'contacts.json'), 'utf8');
  const repeated = await (await commitImport(api, session, plan, 4)).json();
  assert.equal(repeated.revision, 4); assert.equal(repeated.contacts[0].profile.name, '合成修正乙');
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), before);
  for (const change of [
    item => { item.profile.contactConsent = 'declined'; },
    item => { item.sourceProfile.name = '合成腐败快照'; },
    item => { item.sourceProfileDigest = 'b'.repeat(64); },
    item => { delete item.sourceProfileDigest; },
  ]) {
    const corrupted = JSON.parse(before); change(corrupted.contacts[0]);
    await writeFile(join(directory, 'contacts.json'), JSON.stringify(corrupted));
    assert.equal((await request(api, '/api/admin/contacts', { session })).status, 503);
  }
});

test('profile routes reject missing roles, Origin, CSRF, stale revisions and hidden-field mass assignment', async t => {
  const { api } = await fixture(t), session = await login(api), editor = await login(api, 'test-editor');
  const payload = { expectedRevision: 0, profile: { name: '合成新对象', contactConsent: 'consented' } };
  for (const options of [{}, { session: editor }, { session, origin: null }, { session, origin: 'https://foreign.invalid' }, { session, csrf: 'wrong' }]) assert.ok([401, 403].includes((await request(api, '/api/admin/contacts', { method: 'POST', payload, ...options })).status));
  const created = await (await request(api, '/api/admin/contacts', { method: 'POST', session, payload })).json();
  assert.equal(created.contact.profile.contactConsent, 'consented');
  const path = '/api/admin/contacts/' + created.contact.id + '/profile';
  assert.equal((await request(api, path, { method: 'PUT', session, payload: { expectedRevision: 0, profile: { name: '合成旧版本' } } })).status, 409);
  for (const profile of [{ name: '合成', contactConsent: 'declined' }, { name: '合成', source: {} }, { name: '合成', invitation: { sentAt: 'now' } }, { name: '合成', operations: { responseStatus: 'attending' } }]) assert.equal((await request(api, path, { method: 'PUT', session, payload: { expectedRevision: 1, profile } })).status, 422);
  assert.equal((await request(api, '/api/admin/contacts/missing/profile', { method: 'PUT', session, payload: { expectedRevision: 1, profile: { name: '合成' } } })).status, 404);
  const stored = await (await request(api, '/api/admin/contacts', { session })).json();
  assert.equal(stored.revision, 1); assert.equal(stored.contacts[0].profile.contactConsent, 'consented');
});

test('guest prefill needs outreach plus editor, supports pending invitees, and never writes or grants public consent', async t => {
  const { api, contactsStore, contentStore, directory } = await fixture(t), outreach = await login(api), combined = await login(api, 'test-combined'), editor = await login(api, 'test-editor');
  const imported = await importOne(api, outreach), item = imported.contacts[0], path = '/api/admin/contacts/' + item.id + '/guest-prefill';
  assert.equal((await request(api, path)).status, 401);
  assert.equal((await request(api, path, { session: outreach })).status, 403);
  assert.equal((await request(api, path, { session: editor })).status, 403);
  const beforePending = await readFile(join(directory, 'contacts.json'), 'utf8');
  const pending = await request(api, path, { session: combined });
  assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), { prefill: { name: item.profile.displayName, company: item.profile.organization, ggjRole: '', contactId: item.id }, contactRevision: 1, responseStatus: 'pending' });
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), beforePending);
  await contactsStore.saveOperations(item.id, 1, { ...item.operations, responseStatus: 'attending' }, 'test-outreach');
  const before = await readFile(join(directory, 'contacts.json'), 'utf8'), contentBefore = await contentStore.read();
  const response = await request(api, path, { session: combined });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { prefill: { name: item.profile.displayName, company: item.profile.organization, ggjRole: '', contactId: item.id }, contactRevision: 2, responseStatus: 'attending' });
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), before); assert.deepEqual(await contentStore.read(), contentBefore);
  assert.equal((await request(api, path, { session: combined, origin: 'https://foreign.invalid' })).status, 403);
  await contactsStore.saveOperations(item.id, 2, { ...item.operations, responseStatus: 'declined' }, 'test-outreach');
  const declined = await request(api, path, { session: combined });
  assert.equal(declined.status, 422); assert.equal((await declined.json()).error.code, 'CONTACT_DECLINED');
});

test('participation forms survive restarts and legacy saves without rewriting original intent or reply', async t => {
  const { api, contactsStore, contentStore, directory } = await fixture(t), outreach = await login(api);
  const imported = await importOne(api, outreach), original = imported.contacts[0];
  const path = '/api/admin/contacts/' + original.id;
  const operations = { ...original.operations, participationForms: ['speaker', 'panelist', 'booth'] };
  const savedResponse = await request(api, path, { method: 'PUT', session: outreach, payload: { expectedRevision: 1, operations } });
  assert.equal(savedResponse.status, 200); const saved = await savedResponse.json();
  assert.deepEqual(saved.contact.operations.participationForms, ['speaker', 'panelist', 'booth']);
  assert.equal(saved.contact.operations.responseStatus, 'pending');
  assert.deepEqual(saved.contact.profile, original.profile); assert.deepEqual(saved.contact.source, original.source);
  const restarted = createFileContactsStore({ directory, contentStore });
  assert.deepEqual((await restarted.read()).contacts[0].operations.participationForms, operations.participationForms);
  const legacyInput = { ...saved.contact.operations, notes: '合成旧客户端跟进' }; delete legacyInput.participationForms;
  const legacy = await contactsStore.saveOperations(original.id, 2, legacyInput, 'test-outreach');
  assert.deepEqual(legacy.contact.operations.participationForms, operations.participationForms);
  const cleared = await contactsStore.saveOperations(original.id, 3, { ...legacy.contact.operations, participationForms: [] }, 'test-outreach');
  assert.deepEqual(cleared.contact.operations.participationForms, []);
  const persisted = JSON.parse(await readFile(join(directory, 'contacts.json'), 'utf8'));
  delete persisted.contacts[0].operations.participationForms;
  await writeFile(join(directory, 'contacts.json'), JSON.stringify(persisted));
  const before = await readFile(join(directory, 'contacts.json'), 'utf8');
  assert.deepEqual((await restarted.read()).contacts[0].operations.participationForms, []);
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), before); // Read-time compatibility is not a new write.
});

test('attending does not override unknown or declined contact permission during guest prefill', async t => {
  const { api, contactsStore } = await fixture(t), outreach = await login(api), combined = await login(api, 'test-combined');
  for (const [index, contactConsent] of ['unknown', 'declined'].entries()) {
    const revision = index * 2;
    const created = await (await request(api, '/api/admin/contacts', { method: 'POST', session: outreach, payload: { expectedRevision: revision, profile: { name: '合成未授权', organization: '合成团队', contactConsent } } })).json();
    await contactsStore.saveOperations(created.contact.id, revision + 1, { ...created.contact.operations, responseStatus: 'attending' }, 'test-outreach');
    const response = await request(api, '/api/admin/contacts/' + created.contact.id + '/guest-prefill', { session: combined });
    assert.equal(response.status, 422); assert.equal((await response.json()).error.code, 'CONTACT_NOT_CONSENTED');
  }
});

test('preview does not persist, exact source reimport is idempotent and source data survives restart privately', async (t) => {
  const { api, directory, contentStore } = await fixture(t);
  const session = await login(api);
  const plan = await preview(api, session, [row(), row('2')]);
  assert.deepEqual(plan.summary, { total: 2, new: 2, unchanged: 0, conflicts: 0, invalid: 0, possibleDuplicates: 0 });
  await assert.rejects(readFile(join(directory, 'contacts.json')), { code: 'ENOENT' });
  const first = await commitImport(api, session, plan);
  const imported = await first.json();
  assert.equal(first.status, 200);
  assert.equal(imported.revision, 1);
  assert.equal(imported.contacts.length, 2);
  assert.deepEqual(imported.contacts[0].operations, createEmptyContactOperations());
  assert.equal(imported.contacts[0].invitation.generatedAt, null);
  assert.equal(imported.contacts[0].source.rowId, '1');
  assert.equal(imported.contacts[0].profile.contactConsentCode, '1');
  assert.equal('consentAccepted' in imported.contacts[0].profile, false);
  const secondPlan = await preview(api, session, [row(), row('2')]);
  assert.equal(secondPlan.summary.unchanged, 2);
  const before = await readFile(join(directory, 'contacts.json'), 'utf8');
  const repeated = await (await commitImport(api, session, secondPlan, 1)).json();
  assert.equal(repeated.revision, 1);
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), before);
  const restarted = createFileContactsStore({ directory, contentStore });
  assert.deepEqual(await restarted.read(), { revision: 1, contacts: imported.contacts });
  assert.equal((await request(api, '/api/public/contacts')).status, 404);
  assert.equal((await request(api, '/api/public/content')).status, 404);
  const audit = JSON.parse(before).audit;
  assert.equal(JSON.stringify(audit).includes('example.invalid'), false);
  assert.equal(JSON.stringify(audit).includes('合成邀请'), false);
});

test('invalid batches and changed source rows fail atomically and never overwrite staff operations', async (t) => {
  const { api } = await fixture(t);
  const session = await login(api);
  const invalid = await preview(api, session, [row(), row('2', { name: '', displayName: '' })]);
  assert.equal(invalid.canCommit, false);
  assert.equal(invalid.summary.invalid, 1);
  assert.equal((await commitImport(api, session, invalid)).status, 422);
  assert.equal((await (await request(api, '/api/admin/contacts', { session })).json()).contacts.length, 0);
  const imported = await importOne(api, session);
  const contact = imported.contacts[0];
  const operations = { ...contact.operations, owner: '合成负责人', notes: '内部合成跟进记录', responseStatus: 'attending' };
  assert.equal((await request(api, '/api/admin/contacts/' + contact.id, { method: 'PUT', session, payload: { expectedRevision: 1, operations, profile: { name: '不可覆写' } } })).status, 200);
  const changed = await preview(api, session, [row('1', { organization: '改变后的来源机构' }), row('2')]);
  assert.equal(changed.summary.conflicts, 1);
  assert.equal(changed.summary.new, 1);
  assert.equal(changed.rows[0].status, 'source_changed');
  assert.equal((await commitImport(api, session, changed, 2)).status, 422);
  const state = await (await request(api, '/api/admin/contacts', { session })).json();
  assert.equal(state.contacts.length, 1);
  assert.equal(state.contacts[0].profile.organization, '合成团队');
  assert.equal(state.contacts[0].operations.notes, '内部合成跟进记录');
  assert.equal(state.contacts[0].operations.responseStatus, 'attending');
  assert.equal(state.contacts[0].profile.name, contact.profile.name);
});

test('matching email or wechat only suggests duplicates and needs explicit keep-separate review', async (t) => {
  const { api } = await fixture(t);
  const session = await login(api);
  const plan = await preview(api, session, [row(), row('2', { email: row().email.toUpperCase() })]);
  assert.equal(plan.summary.possibleDuplicates, 2);
  assert.equal(plan.rows[0].duplicateContactIds.length, 1);
  assert.equal(plan.canCommit, true);
  assert.equal((await commitImport(api, session, plan)).status, 422);
  const accepted = await (await commitImport(api, session, plan, 0, true)).json();
  assert.equal(accepted.contacts.length, 2);
  assert.notEqual(accepted.contacts[0].id, accepted.contacts[1].id);
  const exact = await preview(api, session, [row(), row('2', { email: row().email.toUpperCase() })]);
  assert.equal(exact.summary.possibleDuplicates, 0);
  assert.equal(exact.summary.unchanged, 2);
  const existing = await preview(api, session, [row('3', { wechat: row().wechat.toUpperCase() })]);
  assert.equal(existing.summary.possibleDuplicates, 1);
  assert.ok(existing.rows[0].duplicateContactIds.includes(accepted.contacts[0].id));
  const nameOnly = await preview(api, session, [row('4', { name: row().name, displayName: row().displayName })]);
  assert.equal(nameOnly.summary.possibleDuplicates, 0);
});

test('previews are actor-bound, expire, and cannot overwrite a newer contacts revision', async (t) => {
  let time = Date.parse('2026-10-19T00:00:00Z');
  const { api } = await fixture(t, { now: () => time });
  const session = await login(api);
  const other = await login(api, 'test-second');
  const bound = await preview(api, session);
  assert.equal((await commitImport(api, other, bound)).status, 409);
  time += 15 * 60 * 1000;
  assert.equal((await commitImport(api, session, bound)).status, 409);
  const plans = [await preview(api, session), await preview(api, session, [row('2')])];
  const responses = await Promise.all(plans.map((plan) => commitImport(api, session, plan)));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const stored = await (await request(api, '/api/admin/contacts', { session })).json();
  const recovery = await preview(api, session, [row(stored.contacts[0].source.rowId)]);
  assert.equal(recovery.summary.unchanged, 1);
  assert.equal((await commitImport(api, session, recovery, stored.revision)).status, 200);
});

test('manual session and booth assignments validate references and cross-zone double booking without publishing identity', async (t) => {
  const { api, contentStore } = await fixture(t);
  const session = await login(api);
  const imported = await importOne(api, session);
  const contact = imported.contacts[0];
  const content = (await contentStore.read()).draft.content;
  const first = content.sessions.find((item) => item.zone === 'A');
  const conflicting = content.sessions.find((item) => item.zone === 'B' && item.start === first.start);
  assert.ok(conflicting);
  const later = content.sessions.find((item) => item.zone === 'A' && item.start === first.end);
  assert.ok(later);
  content.booths.push({ id: 'synthetic-booth-1', code: 'C-01', organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '' });
  content.booths.push({ id: 'synthetic-booth-2', code: 'C-02', organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '' });
  await contentStore.save(0, content, 'test-editor');
  const overlapping = { ...contact.operations, sessionIds: [first.id, conflicting.id] };
  assert.equal(validateContactOperations(overlapping, content).valid, false);
  const invalid = await request(api, '/api/admin/contacts/' + contact.id, { method: 'PUT', session, payload: { expectedRevision: 1, operations: overlapping } });
  assert.equal(invalid.status, 422);
  const operations = { ...contact.operations, sessionIds: [first.id, later.id], boothIds: ['synthetic-booth-1', 'synthetic-booth-2'] };
  const saved = await request(api, '/api/admin/contacts/' + contact.id, { method: 'PUT', session, payload: { expectedRevision: 1, operations } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 2);
  content.sessions = content.sessions.filter((item) => item.id !== first.id);
  await contentStore.save(1, content, 'test-editor');
  const state = await (await request(api, '/api/admin/contacts', { session })).json();
  assert.ok(state.contacts[0].operations.sessionIds.includes(first.id));
  assert.equal((await request(api, '/api/admin/contacts/' + contact.id, { method: 'PUT', session, payload: { expectedRevision: 2, operations } })).status, 422);
  const fixed = { ...operations, sessionIds: [later.id] };
  assert.equal((await request(api, '/api/admin/contacts/' + contact.id, { method: 'PUT', session, payload: { expectedRevision: 2, operations: fixed } })).status, 200);
  const publisher = await login(api, 'test-publisher');
  assert.equal((await request(api, '/api/admin/content/publish', { method: 'POST', session: publisher, payload: { expectedRevision: 2 } })).status, 200);
  const publicContent = await (await request(api, '/api/public/content')).text();
  assert.equal(publicContent.includes(contact.profile.name), false);
  assert.equal(publicContent.includes(contact.profile.email), false);
  assert.equal(publicContent.includes('profile'), false);
});

test('generated, manually sent and attendee response are distinct revision-protected invitation events', async (t) => {
  const { api, directory } = await fixture(t);
  const session = await login(api);
  const imported = await importOne(api, session);
  const id = imported.contacts[0].id;
  const base = '/api/admin/contacts/' + id + '/invitation/';
  assert.equal((await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 1, channel: 'wechat' } })).status, 422);
  const settings = { recipientName: '合成专用称呼', date: '2026-12-05', time: '10:00-18:00', venue: '合成场地', confirmed: false };
  const generatedResponse = await request(api, base + 'generated', { method: 'POST', session, payload: { expectedRevision: 1, settings } });
  assert.equal(generatedResponse.status, 200);
  const generated = await generatedResponse.json();
  assert.equal(generated.revision, 2);
  assert.equal(generated.contact.invitation.settings.confirmed, false);
  assert.equal(generated.contact.invitation.sentAt, null);
  assert.equal(generated.contact.operations.responseStatus, 'pending');
  assert.equal((await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 1, channel: 'wechat' } })).status, 409);
  assert.equal((await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 2, channel: 'automatic-email' } })).status, 422);
  const generation = { generatedAt: generated.contact.invitation.generatedAt, settings };
  const missingGeneration = await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 2, channel: 'wechat', settings } });
  assert.equal(missingGeneration.status, 409);
  assert.equal((await missingGeneration.json()).error.code, 'INVITATION_GENERATION_MISMATCH');
  const editedSettings = await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 2, channel: 'wechat', ...generation, settings: { ...settings, recipientName: '未生成的不同称呼' } } });
  assert.equal(editedSettings.status, 409);
  assert.equal((await editedSettings.json()).error.code, 'INVITATION_GENERATION_MISMATCH');
  assert.equal((await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 2, channel: 'wechat', ...generation, generatedAt: '2020-01-01T00:00:00.000Z' } })).status, 409);
  const sentResponse = await request(api, base + 'sent', { method: 'POST', session, payload: { expectedRevision: 2, channel: 'wechat', ...generation } });
  assert.equal(sentResponse.status, 200);
  const sent = await sentResponse.json();
  assert.ok(sent.contact.invitation.sentAt);
  assert.equal(sent.contact.invitation.sentGenerationAt, generated.contact.invitation.generatedAt);
  assert.equal(sent.contact.operations.responseStatus, 'pending');
  const stored = JSON.parse(await readFile(join(directory, 'contacts.json'), 'utf8'));
  assert.deepEqual(stored.audit.map((entry) => entry.action), ['import_contacts', 'record_invitation_generated', 'record_invitation_manually_sent']);
  assert.equal(JSON.stringify(stored.audit).includes('合成专用称呼'), false);
  const invalid = await request(api, base + 'generated', { method: 'POST', session, payload: { expectedRevision: 3, settings: { ...settings, time: '18:00-10:00' } } });
  assert.equal(invalid.status, 422);
  assert.equal((await (await request(api, '/api/admin/contacts', { session })).json()).revision, 3);
});

test('declined and unknown contact permission block both invitation APIs, including older stored profiles', async (t) => {
  const { api, directory } = await fixture(t);
  const session = await login(api);
  const rows = [row('declined', { contactConsent: 'declined', contactConsentLabel: '不同意' }), row('unknown', { contactConsent: undefined, contactConsentLabel: '' }), row('legacy')];
  const plan = await preview(api, session, rows);
  const imported = await (await commitImport(api, session, plan)).json();
  const settings = { recipientName: '合成对象', date: '2026-12-05', time: '10:00-18:00', venue: '合成场地', confirmed: false };
  for (const contact of imported.contacts.slice(0, 2)) {
    for (const [action, payload] of [['generated', { settings }], ['sent', { channel: 'wechat' }]]) {
      const response = await request(api, '/api/admin/contacts/' + contact.id + '/invitation/' + action, { method: 'POST', session, payload: { expectedRevision: 1, ...payload } });
      assert.equal(response.status, 422);
      assert.equal((await response.json()).error.code, 'CONTACT_NOT_CONSENTED');
    }
  }
  const persisted = JSON.parse(await readFile(join(directory, 'contacts.json'), 'utf8'));
  const legacy = persisted.contacts[2];
  delete legacy.profile.contactConsent;
  delete legacy.profile.contactConsentLabel;
  legacy.operations.notes = '保留合成历史跟进';
  await writeFile(join(directory, 'contacts.json'), JSON.stringify(persisted));
  const loaded = await (await request(api, '/api/admin/contacts', { session })).json();
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.contacts[2].profile.contactConsent, 'unknown');
  assert.equal(loaded.contacts[2].profile.contactConsentLabel, '');
  assert.equal(loaded.contacts[2].operations.notes, '保留合成历史跟进');
  const denied = await request(api, '/api/admin/contacts/' + legacy.id + '/invitation/generated', { method: 'POST', session, payload: { expectedRevision: 1, settings } });
  assert.equal(denied.status, 422);
  assert.equal((await denied.json()).error.code, 'CONTACT_NOT_CONSENTED');
  assert.equal((await (await request(api, '/api/admin/contacts', { session })).json()).revision, 1);
});

test('source row duplicates, excessive import size and corrupt private storage fail closed', async (t) => {
  const { api, directory } = await fixture(t);
  const session = await login(api);
  const repeatedRow = await preview(api, session, [row(), row()]);
  assert.equal(repeatedRow.summary.invalid, 1);
  assert.equal((await commitImport(api, session, repeatedRow)).status, 422);
  const tooMany = await request(api, '/api/admin/contacts/import/preview', { method: 'POST', session, payload: { sourceKey: SOURCE, rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, index) => row(String(index))) } });
  assert.equal(tooMany.status, 422);
  await writeFile(join(directory, 'contacts.json'), '{corrupt');
  assert.equal((await request(api, '/api/admin/contacts', { session })).status, 503);
  assert.equal((await request(api, '/api/admin/contacts/import/preview', { method: 'POST', session, payload: { sourceKey: SOURCE, rows: [row()] } })).status, 503);
  assert.equal(await readFile(join(directory, 'contacts.json'), 'utf8'), '{corrupt');
});
