import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createOssContactsStore, MAX_CONTACT_AUDIT_ENTRIES, MAX_CONTACT_STATE_BYTES } from '../functions/cloud-content/contacts-store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN } from '../functions/cloud-content/handler.mjs';
import { createCloudAuth } from '../functions/cloud-content/auth.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { createEmptyContactOperations } from '../shared/contacts-schema.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT = '2026-10-20T08:00:00.000Z', now = () => Date.parse(AT), clone = value => structuredClone(value);
const profile = () => ({ name: '合成联络人', displayName: '合成称呼', organization: '合成机构', email: 'synthetic@example.invalid', wechat: 'SYNTHETIC_PRIVATE_WECHAT', siteRole: '合成待核 GGJ 职务', contactConsent: 'consented' });
const settings = { recipientName: '合成称呼', date: '2026-12-05', time: '10:00-18:00', venue: '合成场地', confirmed: true };
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fails = (operation, code, status) => assert.rejects(operation, error => error instanceof CloudContentError && error.code === code && error.status === status && !error.cause && !/SYNTHETIC_PRIVATE_PROVIDER/u.test(error.message));
function journalFixture() {
  let value = null, cursor = { position: 0, version: 0, hash: null }, attempts = 0, mode = null, gate;
  return {
    client: () => ({
      async read() {
        const captured = clone({ value, cursor });
        if (gate) { const current = gate; if (--current.remaining === 0) { gate = null; current.release(); } await current.promise; }
        return captured;
      },
      async commit(expected, next) {
        attempts++;
        if (JSON.stringify(expected) !== JSON.stringify(cursor)) throw new CloudContentError('WRITE_CONFLICT', 'SYNTHETIC_PRIVATE_PROVIDER', 409);
        if (mode === 'before') throw new Error('SYNTHETIC_PRIVATE_PROVIDER');
        value = clone(next); cursor = { position: cursor.position + 100, version: cursor.version + 1, hash: sha(next) };
        if (mode === 'after') throw new Error('SYNTHETIC_PRIVATE_PROVIDER');
        const ack = clone({ value, cursor }); return typeof mode === 'function' ? mode(ack) : ack;
      },
    }),
    pairReads() { let release; const promise = new Promise(resolve => { release = resolve; }); gate = { remaining: 2, promise, release }; },
    mode(input) { mode = input; },
    corrupt(input, expectedCursor) { value = clone(input); cursor = expectedCursor ?? { position: 100, version: input?.revision ?? 1, hash: 'a'.repeat(64) }; },
    snapshot: () => clone({ value, cursor, attempts }),
  };
}
function unitSetup(journal = journalFixture()) {
  const content = createInitialContent(), contentStore = { read: async () => ({ draft: { content } }) };
  const make = () => createOssContactsStore({ journal: journal.client(), contentStore, now });
  return { journal, content, first: make(), second: make(), make };
}

test('independent durable contacts stores have one CAS winner and preserve the winning private state', async () => {
  const { journal, first, second } = unitSetup();
  journal.pairReads();
  const results = await Promise.allSettled([first.createContact(0, profile(), 'left'), second.createContact(0, { ...profile(), name: '合成右编辑' }, 'right')]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const observed = await second.read(); assert.equal(observed.revision, 1); assert.equal(observed.contacts.length, 1);
  assert.deepEqual(observed.contacts[0], results.find(value => value.status === 'fulfilled').value.contact);
  observed.contacts[0].profile.email = 'client-mutation@example.invalid';
  assert.notEqual((await first.read()).contacts[0].profile.email, 'client-mutation@example.invalid');
  assert.equal(journal.snapshot().value.audit.length, 1);
  await fails(() => first.saveProfile(observed.contacts[0].id, 0, { name: '合成修改' }, 'left'), 'REVISION_CONFLICT', 409);
});

test('profile edits keep stable source, original answers and consent separate from generation, manual sent and attendance', async () => {
  const { first, second, journal } = unitSetup();
  let saved = await first.createContact(0, profile(), '_outreach');
  const original = clone(saved.contact), id = original.id;
  saved = await second.saveProfile(id, 1, { name: '合成修正姓名', organization: '合成修正机构' }, 'outreach');
  assert.deepEqual(saved.contact.source, original.source); assert.deepEqual(saved.contact.sourceProfile, original.profile);
  assert.equal(saved.contact.sourceProfileDigest, sha(original.profile));
  for (const key of ['contactConsent', 'attendanceIntent', 'accommodationIntent', 'futureCooperation', 'categories', 'interests']) assert.deepEqual(saved.contact.profile[key], original.profile[key]);
  for (const malicious of [{ contactConsent: 'consented' }, { source: {} }, { operations: {} }, { attendanceIntent: 'expected' }]) await fails(() => first.saveProfile(id, 2, malicious, 'outreach'), 'VALIDATION_ERROR', 422);
  saved = await first.recordGenerated(id, 2, settings, 'outreach');
  assert.equal(saved.contact.invitation.sentAt, null); assert.equal(saved.contact.operations.responseStatus, 'pending');
  assert.deepEqual(await first.guestPrefill(id), { prefill: { name: original.profile.displayName, company: '合成修正机构', ggjRole: profile().siteRole, contactId: id }, contactRevision: 3, responseStatus: 'pending' });
  await fails(() => second.recordSent(id, 3, 'wechat', AT, { ...settings, venue: '合成不同版本' }, 'outreach'), 'INVITATION_GENERATION_MISMATCH', 409);
  saved = await second.recordSent(id, 3, 'wechat', saved.contact.invitation.generatedAt, settings, 'outreach');
  assert.equal(saved.contact.operations.responseStatus, 'pending'); assert.equal(saved.contact.profile.attendanceIntent, 'unknown');
  saved = await first.saveOperations(id, 4, { ...createEmptyContactOperations(), responseStatus: 'attending' }, 'outreach');
  assert.deepEqual(await second.guestPrefill(id), { prefill: { name: original.profile.displayName, company: '合成修正机构', ggjRole: profile().siteRole, contactId: id }, contactRevision: 5, responseStatus: 'attending' });
  assert.equal(journal.snapshot().attempts, 5);
  const unknown = await first.createContact(5, { name: '合成未同意对象', organization: '合成机构' }, 'outreach');
  for (const method of [() => first.recordGenerated(unknown.contact.id, 6, settings, 'outreach'), () => first.recordSent(unknown.contact.id, 6, 'wechat', AT, settings, 'outreach')]) await fails(method, 'CONTACT_NOT_CONSENTED', 422);
  await first.saveOperations(unknown.contact.id, 6, { ...createEmptyContactOperations(), responseStatus: 'attending' }, 'outreach');
  await fails(() => first.guestPrefill(unknown.contact.id), 'CONTACT_NOT_CONSENTED', 422);
  await second.saveOperations(id, 7, { ...createEmptyContactOperations(), responseStatus: 'declined' }, 'outreach');
  await fails(() => first.guestPrefill(id), 'CONTACT_DECLINED', 422);
  assert.equal((await first.read()).revision, 8);
});

test('participation forms persist independently of source answers, invitation delivery and actual attendance', async () => {
  const { first, second, journal } = unitSetup();
  const original = (await first.createContact(0, profile(), 'outreach')).contact;
  assert.deepEqual(original.operations.participationForms, []);
  let saved = await first.saveOperations(original.id, 1, { ...createEmptyContactOperations(), participationForms: ['guest', 'speaker', 'booth'] }, 'outreach');
  assert.deepEqual(saved.contact.operations.participationForms, ['guest', 'speaker', 'booth']);
  assert.equal(saved.contact.operations.responseStatus, 'pending');
  assert.equal(saved.contact.invitation.sentAt, null);
  assert.deepEqual(saved.contact.profile, original.profile); assert.deepEqual(saved.contact.source, original.source);
  const legacyInput = { ...createEmptyContactOperations(), notes: '合成跟进备注' }; delete legacyInput.participationForms;
  saved = await second.saveOperations(original.id, 2, legacyInput, 'outreach');
  assert.deepEqual(saved.contact.operations.participationForms, ['guest', 'speaker', 'booth']);
  for (const participationForms of [null, 'speaker', ['unknown'], ['speaker', 'speaker']]) {
    await fails(() => first.saveOperations(original.id, 3, { ...createEmptyContactOperations(), participationForms }, 'outreach'), 'VALIDATION_ERROR', 422);
  }
  assert.equal(journal.snapshot().attempts, 3);
  saved = await first.saveOperations(original.id, 3, { ...createEmptyContactOperations(), participationForms: [] }, 'outreach');
  assert.deepEqual(saved.contact.operations.participationForms, []);
});

test('old persisted operations gain an empty participation default only in memory until an explicit CAS mutation', async () => {
  const { first, journal } = unitSetup();
  const original = (await first.createContact(0, profile(), 'outreach')).contact;
  const legacy = journal.snapshot().value; delete legacy.contacts[0].operations.participationForms;
  journal.corrupt(legacy);
  const observed = await first.read();
  assert.deepEqual(observed.contacts[0].operations.participationForms, []); assert.equal(observed.revision, 1);
  assert.equal(Object.hasOwn(journal.snapshot().value.contacts[0].operations, 'participationForms'), false);
  assert.equal(journal.snapshot().attempts, 1);
  const saved = await first.saveProfile(original.id, 1, { city: '合成新城市' }, 'outreach');
  assert.deepEqual(saved.contact.operations.participationForms, []); assert.deepEqual(saved.contact.source, original.source);
  assert.deepEqual(saved.contact.sourceProfile, original.sourceProfile); assert.equal(saved.contact.sourceProfileDigest, original.sourceProfileDigest);
  assert.deepEqual(journal.snapshot().value.contacts[0].operations.participationForms, []);
  for (const participationForms of [null, ['unknown'], ['guest', 'guest']]) {
    const bad = clone(legacy); bad.contacts[0].operations.participationForms = participationForms; journal.corrupt(bad);
    await fails(() => first.read(), 'CONTACT_STORAGE_ERROR', 503);
  }
});

test('assignments validate current planning while deleted historical references remain readable', async () => {
  const { first, content } = unitSetup();
  const created = await first.createContact(0, profile(), 'outreach'), id = created.contact.id;
  const session = content.sessions.find(item => item.status !== 'cancelled');
  await first.saveOperations(id, 1, { ...createEmptyContactOperations(), sessionIds: [session.id] }, 'outreach');
  content.sessions = content.sessions.filter(item => item.id !== session.id);
  assert.deepEqual((await first.read()).contacts[0].operations.sessionIds, [session.id]);
  await fails(() => first.saveOperations(id, 2, { ...createEmptyContactOperations(), sessionIds: [session.id] }, 'outreach'), 'VALIDATION_ERROR', 422);
});

test('failed, lost and malformed commit acknowledgements never succeed or retry and explicit reads resolve uncertainty', async () => {
  for (const mode of ['before', 'after', () => undefined, ack => ({ ...ack, value: null }), ack => ({ ...ack, extra: true }), ack => ({ ...ack, cursor: { ...ack.cursor, version: 9 } }), ack => ({ ...ack, cursor: { ...ack.cursor, position: 0 } }), ack => ({ ...ack, cursor: { ...ack.cursor, hash: 'PRIVATE' } })]) {
    const { first, journal } = unitSetup(); journal.mode(mode);
    await fails(() => first.createContact(0, profile(), 'outreach'), 'CONTACT_STORAGE_ERROR', 503);
    assert.equal(journal.snapshot().attempts, 1);
    assert.equal((await first.read()).contacts.length, mode === 'before' ? 0 : 1);
  }
});

test('corrupt state, extra fields, altered provenance snapshots, audit or cursor fail closed without reset', async () => {
  const source = unitSetup(); await source.first.createContact(0, profile(), 'outreach'); const good = source.journal.snapshot().value;
  const corruptions = [undefined, {}, { ...good, storageVersion: 2 }, { ...good, extra: 'SYNTHETIC_PRIVATE_PROVIDER' }, { ...good, revision: 0 }, { ...good, audit: [] }];
  for (const edit of [item => { item.profile.unknown = 'private'; }, item => { item.source.secret = 'private'; }, item => { item.source.digest = '0'.repeat(64); }, item => { item.sourceProfile.name = '合成损坏原姓名'; }, item => { item.sourceProfileDigest = '0'.repeat(64); }, item => { item.sourceProfile.contactConsent = 'declined'; }, item => { item.operations.extra = true; }, item => { item.invitation.channel = 'wechat'; }, item => { item.updatedAt = 'invalid'; }]) {
    const next = clone(good); edit(next.contacts[0]); corruptions.push(next);
  }
  for (const corruption of corruptions) {
    const { first, journal } = unitSetup(); journal.corrupt(corruption);
    await fails(() => first.read(), 'CONTACT_STORAGE_ERROR', 503);
    await fails(() => first.createContact(0, profile(), 'outreach'), 'CONTACT_STORAGE_ERROR', 503);
    assert.equal(journal.snapshot().attempts, 0);
  }
  const { first, journal } = unitSetup(); journal.corrupt(null, { position: 100, version: 1, hash: 'a'.repeat(64) });
  await fails(() => first.read(), 'CONTACT_STORAGE_ERROR', 503);
});

test('invitation settings, generation and manual sent receipts must agree with their private audit history', async () => {
  const journal = journalFixture(); let at = Date.parse(AT);
  const store = createOssContactsStore({ journal: journal.client(), contentStore: { read: async () => ({ draft: { content: createInitialContent() } }) }, now: () => at });
  const { contact } = await store.createContact(0, profile(), 'outreach');
  at += 2000; await store.recordGenerated(contact.id, 1, settings, 'outreach');
  const generation = (await store.read()).contacts[0].invitation.generatedAt;
  at += 2000; await store.recordSent(contact.id, 2, 'wechat', generation, settings, 'outreach');
  at += 2000; await store.saveProfile(contact.id, 3, { city: '合成修正城市' }, 'outreach');
  const good = journal.snapshot().value;
  for (const edit of [
    invitation => { invitation.generatedAt = new Date(Date.parse(AT) + 1000).toISOString(); },
    invitation => { invitation.sentAt = new Date(Date.parse(AT) + 3000).toISOString(); },
    invitation => { invitation.sentGenerationAt = new Date(Date.parse(AT) + 1000).toISOString(); },
    invitation => { invitation.channel = 'email'; },
    invitation => { invitation.settings.venue = '合成不同的设置'; },
  ]) {
    const bad = clone(good); edit(bad.contacts[0].invitation); journal.corrupt(bad);
    await fails(() => store.read(), 'CONTACT_STORAGE_ERROR', 503);
    await fails(() => store.saveProfile(contact.id, 4, { city: '合成更新' }, 'outreach'), 'CONTACT_STORAGE_ERROR', 503);
  }
  assert.equal(journal.snapshot().attempts, 4);
});

test('audit and state byte ceilings reject mutations without trimming private history', async () => {
  const { first, journal } = unitSetup(); await first.createContact(0, profile(), 'outreach');
  const state = journal.snapshot().value, id = state.contacts[0].id;
  for (let index = 1; index < MAX_CONTACT_AUDIT_ENTRIES; index++) state.audit.push({ action: 'save_contact_profile', actorId: 'outreach', revision: index + 1, at: AT, contactId: id });
  state.revision = MAX_CONTACT_AUDIT_ENTRIES; journal.corrupt(state);
  assert.equal((await first.read()).revision, MAX_CONTACT_AUDIT_ENTRIES);
  await fails(() => first.saveProfile(id, state.revision, { name: '合成修改' }, 'outreach'), 'CONTACT_CAPACITY_EXCEEDED', 503);
  assert.equal(journal.snapshot().attempts, 1); assert.equal(journal.snapshot().value.audit.length, MAX_CONTACT_AUDIT_ENTRIES);
  const oversized = unitSetup(), large = { ...profile(), background: '字'.repeat(10000), topics: '字'.repeat(4000) };
  let expected = 0;
  while (expected < 100) {
    try { await oversized.first.createContact(expected, large, 'outreach'); expected++; }
    catch (error) { assert.equal(error.code, 'CONTACT_CAPACITY_EXCEEDED'); break; }
  }
  assert.ok(expected > 0 && expected < 100); assert.equal(oversized.journal.snapshot().attempts, expected);
  assert.ok(Buffer.byteLength(JSON.stringify(oversized.journal.snapshot().value)) <= MAX_CONTACT_STATE_BYTES);
});

const password = 'synthetic-contact-password-only', passwordHash = await hashPassword(password);
const users = ['outreach', 'editor', 'publisher', 'combined'].map(username => ({ id: username, username, email: username + '@artdico.co', label: '合成账号', roles: username === 'combined' ? ['outreach', 'editor', 'publisher'] : [username], passwordHash }));
function cloudSetup(objects = memoryObjects()) {
  const journalFor = prefix => createObjectJournal({ objects, prefix }), portraits = createOssPortraitStore({ objects });
  const content = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore: portraits, now });
  const contacts = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore: content, now });
  const auth = createCloudAuth({ users, journalFor, now });
  return { objects, content, contacts, api: createCloudContentApi({ enabled: true, store: content, portraitStore: portraits, contactsStore: contacts, auth }) };
}
const request = (path, { method = 'GET', headers = {}, body, origin = method === 'GET' ? undefined : CLOUD_API_ORIGIN } = {}) => new Request(CLOUD_API_ORIGIN + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
async function login(api, username) {
  const response = await api(request('/api/admin/login', { method: 'POST', body: { username, password } })); assert.equal(response.status, 200);
  const value = await response.json(); return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': value.csrfToken };
}

test('two cloud API instances share private contacts and return minimum planning without content-edit permission', async () => {
  const first = cloudSetup(), second = cloudSetup(first.objects), headers = await login(first.api, 'outreach');
  const created = await first.api(request('/api/admin/contacts', { method: 'POST', headers, body: { expectedRevision: 0, profile: profile() } }));
  assert.equal(created.status, 201); const { contact } = await created.json();
  const read = await second.api(request('/api/admin/contacts', { headers })); assert.equal(read.status, 200); assert.equal((await read.json()).contacts[0].id, contact.id);
  assert.equal((await second.api(request('/api/admin/content', { headers }))).status, 403);
  const contentDraft = (await first.content.read()).draft.content;
  contentDraft.booths = [{ id: 'synthetic-booth', code: 'C-01', zone: 'C', organization: '合成展位机构', project: '合成作品', status: 'pending', internalNotes: 'SYNTHETIC_PRIVATE_BOOTH_NOTE' }];
  await first.content.save(0, contentDraft, '_editor');
  const planning = await second.api(request('/api/admin/planning', { headers })); assert.equal(planning.status, 200);
  const value = await planning.json(); assert.deepEqual(Object.keys(value.content).sort(), ['booths', 'sessions']);
  assert.deepEqual(Object.keys(value.content.sessions[0]).sort(), ['end', 'id', 'start', 'status', 'title', 'zone']);
  assert.deepEqual(Object.keys(value.content.booths[0]).sort(), ['code', 'id', 'organization', 'project', 'status', 'zone']);
  assert.deepEqual(value.features, { contactImport: false, communicationsPreview: true });
  assert.doesNotMatch(JSON.stringify(value), /internalNotes|SYNTHETIC_PRIVATE_WECHAT|email|sourceProfile/u);
  assert.ok(first.objects.calls.some(call => call.key.startsWith('cms/v1/contacts/')));
  const initial = (await first.content.read()).draft.content; await first.content.publish(1, 'publisher');
  const publicRead = await second.api(request('/api/public/content', { origin: PUBLIC_SITE_ORIGIN })); assert.equal(publicRead.status, 200);
  assert.doesNotMatch(await publicRead.text(), /SYNTHETIC_PRIVATE_WECHAT|synthetic@example|sourceProfile|contactConsent/u);
  assert.deepEqual((await first.content.read()).draft.content, initial);
});

test('cloud contact routes enforce outreach, both roles for guest prefill, exact Origin and CSRF', async () => {
  const { api, contacts } = cloudSetup(), outreach = await login(api, 'outreach'), editor = await login(api, 'editor'), combined = await login(api, 'combined');
  for (const path of ['/api/admin/contacts', '/api/admin/planning', '/api/admin/communications']) {
    assert.equal((await api(request(path))).status, 401);
    assert.equal((await api(request(path, { headers: editor }))).status, 403);
  }
  for (const delta of [{ headers: { Cookie: outreach.Cookie } }, { origin: 'https://attacker.invalid' }, { origin: null }]) {
    assert.equal((await api(request('/api/admin/contacts', { method: 'POST', headers: outreach, body: { expectedRevision: 0, profile: profile() }, ...delta }))).status, 403);
  }
  const created = await contacts.createContact(0, profile(), 'outreach'), path = '/api/admin/contacts/' + created.contact.id;
  assert.equal((await api(request(path + '/guest-prefill', { headers: outreach }))).status, 403);
  assert.equal((await api(request(path + '/guest-prefill', { headers: editor }))).status, 403);
  const pending = await api(request(path + '/guest-prefill', { headers: combined })); assert.equal(pending.status, 200);
  assert.deepEqual(await pending.json(), { prefill: { name: profile().displayName, company: profile().organization, ggjRole: profile().siteRole, contactId: created.contact.id }, contactRevision: 1, responseStatus: 'pending' });
  assert.equal((await contacts.read()).revision, 1);
  await contacts.saveOperations(created.contact.id, 1, { ...createEmptyContactOperations(), responseStatus: 'attending' }, 'outreach');
  const result = await api(request(path + '/guest-prefill', { headers: combined })); assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { prefill: { name: profile().displayName, company: profile().organization, ggjRole: profile().siteRole, contactId: created.contact.id }, contactRevision: 2, responseStatus: 'attending' });
  assert.equal((await contacts.read()).revision, 2);
});

test('cloud preview and invitation routes never deliver, sign, enable import or claim attendance', async () => {
  const { api } = cloudSetup(), headers = await login(api, 'outreach');
  let response = await api(request('/api/admin/contacts', { method: 'POST', headers, body: { expectedRevision: 0, profile: profile() } }));
  const { contact } = await response.json(), base = '/api/admin/contacts/' + contact.id;
  response = await api(request(base + '/profile', { method: 'PUT', headers, body: { expectedRevision: 1, profile: { city: '合成城市' } } })); assert.equal(response.status, 200);
  response = await api(request(base + '/invitation/generated', { method: 'POST', headers, body: { expectedRevision: 2, settings } })); assert.equal(response.status, 200);
  const generated = (await response.json()).contact;
  response = await api(request(base + '/invitation/sent', { method: 'POST', headers, body: { expectedRevision: 3, channel: 'wechat', generatedAt: generated.invitation.generatedAt, settings } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).contact.operations.responseStatus, 'pending');
  const readiness = await (await api(request('/api/admin/communications', { headers }))).json(); assert.equal(readiness.email.ready, false); assert.equal(readiness.wallet.ready, false);
  response = await api(request(base + '/wallet/preview', { method: 'POST', headers, body: { settings } })); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'unsigned_preview');
  assert.equal((await api(request(base + '/email/preview', { method: 'POST', headers, body: { settings } }))).status, 422);
  response = await api(request(base, { method: 'PUT', headers, body: { expectedRevision: 4, operations: { ...createEmptyContactOperations(), responseStatus: 'attending' } } })); assert.equal(response.status, 200);
  response = await api(request(base + '/email/preview', { method: 'POST', headers, body: { settings } })); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'not_sent');
  for (const action of ['email/send', 'wallet/issue']) assert.equal((await api(request(base + '/' + action, { method: 'POST', headers, body: {} }))).status, 404);
  for (const action of ['import', 'import/preview']) assert.equal((await api(request('/api/admin/contacts/' + action, { method: 'POST', headers, body: {} }))).status, 503);
});
