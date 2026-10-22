import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFileContactsStore } from '../functions/content-api/contacts-store.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createIntentInvitationService } from '../functions/intent-invitations/service.mjs';
import { createIntentInvitationRepository } from '../functions/intent-invitations/repository.mjs';
import { createAttendanceSynchronizer, createGuestContactLinkGuard } from '../functions/people-operations/service.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const ORIGIN = 'https://api.artdico.host', EVENT = 'ggj-cn-2026', CSRF = 'synthetic-people-csrf-token';
const SECRET = 'SYNTHETIC_PRIVATE_PEOPLE_OPERATION_DETAIL';
const now = () => Date.parse('2026-10-21T10:00:00.000Z');
const policy = capacity => ({ enabled: true, eventId: EVENT, capacity, opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00',
  privacy: { version: 'synthetic-people-notice', processor: '合成处理者', contactEmail: 'synthetic@example.invalid', purpose: '合成隔离测试', storageRegion: '合成地区', retention: '合成保留规则', rightsRequest: '合成权利入口', sharing: '不对外分享合成资料' } });
const profile = (name = '合成人员', patch = {}) => ({ name, organization: '合成机构', city: '合成城市', email: 'synthetic.people@example.invalid', contactConsent: 'consented', ...patch });
const guest = (id = 'guest_synthetic', contactId = '') => ({ id, name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, internalNotes: '', contactId });
function cloudApi(f, onCommitted = f.synchronize, contactsStore = f.contactsStore) {
  return createCloudContentApi({ enabled: true, store: f.store, portraitStore: f.portraitStore, contactsStore, onContactOperationsCommitted: onCommitted,
    auth: { login: async () => {}, logout: async () => {}, authenticate: async () => ({ user: f.actor, csrfToken: CSRF }) } });
}
function request(f, path, body, { method = 'PUT', csrf = CSRF } = {}) {
  return f.api(new Request(ORIGIN + path, { method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) }));
}
async function fixture({ capacity = 300, waitlistEnabled = true } = {}) {
  const objects = memoryObjects(), journalFor = prefix => createObjectJournal({ objects, prefix });
  const actor = { id: 'synthetic_people_operator', roles: ['editor', 'outreach', 'reviewer'] };
  const portraitStore = createOssPortraitStore({ objects }), store = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore, now });
  const contactsStore = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore: store, now });
  const created = await contactsStore.createContact(0, profile(), actor.id);
  let mailCalls = 0; const publicCallbacks = [];
  const registrationService = createRegistrationService({ objects, journalFor, policy: policy(capacity), capacity, waitlistEnabled, staffReserve: 0,
    tokenSecret: 'synthetic-people-registration-secret', allowedOrigins: ['https://artdico.host'], clock: now, onSaved: async input => { publicCallbacks.push(input); if(input.notify===true)mailCalls++; } });
  const repository = createIntentInvitationRepository({ journal: journalFor('cms/v1/intent-invitations') });
  const intentService = createIntentInvitationService({ registrationService, contactsStore, contentStore: store, repository, now,
    isRegistrationActive: async ({ registrationId }) => (await registrationService.getAdmissionStatus(registrationId)).status !== 'withdrawn' });
  const synchronize = createAttendanceSynchronizer({ intentService, registrationService, contactsStore });
  const f = { objects, actor, portraitStore, store, contactsStore, registrationService, intentService, repository, synchronize, created, publicCallbacks, get mailCalls() { return mailCalls; } };
  f.api = cloudApi(f);
  f.saveReply = async (responseStatus = 'attending', patch = {}) => {
    const current = await contactsStore.read(), contact = current.contacts.find(row => row.id === created.contact.id);
    return request(f, '/api/admin/contacts/' + contact.id, { expectedRevision: current.revision, operations: { ...contact.operations, responseStatus, ...patch } });
  };
  return f;
}
async function expectError(response, status, code) { assert.equal(response.status, status); const body = await response.json(); assert.equal(body.error.code, code); assert.ok(!JSON.stringify(body).includes(SECRET)); }

test('confirmed reply is durably saved then source-linked into the shared admission index once, without mail', async () => {
  const f = await fixture(), response = await f.saveReply(); assert.equal(response.status, 200);
  const saved = await response.json(); assert.equal(saved.replySaved, true); assert.equal(saved.contact.operations.responseStatus, 'attending'); assert.equal(saved.admission.status, 'confirmed');
  assert.match(saved.admission.registrationId, /^[A-Za-z0-9_-]{43}$/u); assert.equal(saved.admission.referenceCode, saved.admission.registrationId);
  const replay = await (await f.saveReply('attending', { notes: '合成后续沟通' })).json(); assert.equal(replay.admission.registrationId, saved.admission.registrationId);
  assert.equal((await f.registrationService.repository.list()).registrations.length, 1); assert.equal((await f.intentService.read({ actor: f.actor })).conversions.length, 1);
  assert.equal((await f.registrationService.getAdmissions({ actor: f.actor })).summary.confirmedCount, 1);
  assert.equal(f.mailCalls, 0); assert.ok(!JSON.stringify(saved.admission).includes('permissionReference'));
  const before = (await f.registrationService.repository.list()).revision;
  const declined = await (await f.saveReply('declined')).json(); assert.equal(declined.replySaved, true); assert.equal(Object.hasOwn(declined, 'admission'), false);
  assert.equal((await f.registrationService.repository.list()).revision, before, 'reply decline does not silently withdraw formal registration');
});

test('outreach-only staff can save a reply but require reviewer, before admission or intent I/O', async () => {
  const f = await fixture(); f.actor.roles = ['outreach'];
  const start = f.objects.calls.length, saved = await (await f.saveReply()).json();
  assert.equal(saved.replySaved, true); assert.deepEqual(saved.admission, { status: 'requiresReviewer', reason: 'REVIEWER_REQUIRED' });
  assert.equal(f.objects.calls.slice(start).some(call => /registrations|intent-invitations/u.test(call.key)), false);
  let reads = 0;
  const forbidden = createAttendanceSynchronizer({ intentService: { convertContacts: async () => { reads++; } }, registrationService: { getStaffRegistrationBySource: async () => { reads++; }, getAdmissionStatus: async () => { reads++; } }, contactsStore: { read: async () => { reads++; } } });
  for (const roles of [['reviewer'], ['editor'], [], ['outreach']]) assert.equal((await forbidden({ actor: { id: 'test', roles }, contactId: f.created.contact.id, saved: {} })).status, 'requiresReviewer');
  assert.equal(reads, 0);
});

test('manual public approval and a confirmed contact compete for the last common place through actual CAS', async () => {
  const f = await fixture({ capacity: 1 }), key = randomBytes(32).toString('base64url');
  const token = await f.registrationService.issueToken({ eventId: EVENT, origin: 'https://artdico.host', idempotencyKey: key });
  const publicInput = { origin: 'https://artdico.host', idempotencyKey: key, submissionToken: token.submissionToken, payload: { eventId: EVENT,
    fields: { name: '合成公开报名者', city: '合成城市', organization: '合成团队', position: '开发者', email: 'public.synthetic@example.invalid', categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' }, consent: { accepted: true, version: policy(1).privacy.version } } };
  const publicResult = await f.registrationService.submit(publicInput);
  assert.equal(publicResult.receipt.admissionStatus,'pending_review');
  const before=await f.registrationService.getAdmissions({actor:f.actor});assert.equal(before.summary.confirmedCount,0);
  const decide=expectedRevision=>f.registrationService.approveApplication({actor:f.actor,registrationId:publicResult.receipt.registrationId,expectedRevision,operationId:randomBytes(32).toString('base64url')});
  const [contactResponse, firstDecision] = await Promise.all([f.saveReply(), decide(before.revision)]);
  let decision=firstDecision;
  if(decision.outcome==='conflict')decision=await decide((await f.registrationService.getAdmissions({actor:f.actor})).revision);
  assert.equal(decision.outcome,'updated');
  const contact = await contactResponse.json(); assert.equal(contact.replySaved, true); assert.ok(['confirmed', 'waitlisted'].includes(contact.admission.status));
  assert.ok(['created', 'replayed'].includes(publicResult.outcome));
  const admissions = await f.registrationService.getAdmissions({ actor: f.actor }); assert.equal(admissions.summary.confirmedCount, 1); assert.equal(admissions.summary.waitlistCount, 1); assert.equal(admissions.people.length, 2);
  const publicStatus=await f.registrationService.getAdmissionStatus(publicResult.receipt.registrationId);
  assert.notEqual(contact.admission.status, publicStatus.status);assert.equal(f.publicCallbacks.length,1);
  assert.equal(f.publicCallbacks[0].notify,false);assert.equal(f.mailCalls,0,'saving the public application only establishes a private receipt; the runtime approval hook owns formal delivery');
});

test('a lost contact save ACK never starts conversion; malformed ACK cannot acquire replySaved', async () => {
  const f = await fixture(), append = f.objects.append; let lose = true, callbacks = 0;
  f.objects.append = async (...args) => { const ack = await append(...args); if (lose && args[0] === 'cms/v1/contacts/commits.jsonl') { lose = false; throw new Error(SECRET); } return ack; };
  f.api = cloudApi(f, async input => { callbacks++; return f.synchronize(input); });
  await expectError(await f.saveReply(), 503, 'CONTACT_STORAGE_ERROR'); assert.equal(callbacks, 0);
  assert.equal((await f.contactsStore.read()).contacts[0].operations.responseStatus, 'attending');
  assert.equal((await f.registrationService.repository.list()).registrations.length, 0);
  const current = await f.contactsStore.read();
  f.api = cloudApi(f, async () => { callbacks++; }, { ...f.contactsStore, saveOperations: async () => ({ revision: current.revision + 1, contact: current.contacts[0] }) });
  await expectError(await f.saveReply('attending', { notes: 'This changed value is missing from the fake ACK.' }), 503, 'CONTACT_STORAGE_ERROR'); assert.equal(callbacks, 0);
  for (const patch of [{ revision: current.revision }, { contact: { ...current.contacts[0], id: 'another_contact' } }]) {
    f.api = cloudApi(f, async () => { callbacks++; }, { ...f.contactsStore, saveOperations: async () => ({ revision: current.revision + 1, contact: current.contacts[0], ...patch }) });
    await expectError(await f.saveReply(), 503, 'CONTACT_STORAGE_ERROR');
  }
  assert.equal(callbacks, 0);
  await expectError(await request(f, '/api/admin/contacts/' + f.created.contact.id, {}, { csrf: 'wrong' }), 403, 'CSRF_REJECTED'); assert.equal(callbacks, 0);
});

test('an older attending save preserves omitted memberships and duties in its verified ACK and still synchronizes', async () => {
  const f = await fixture(), draft = (await f.store.read()).draft;
  const organization = { id: 'org_synthetic', name: '合成组织', logoId: '', website: '', participation: 'attendee', status: 'confirmed', publicConsent: false, internalNotes: '' };
  await f.store.save(draft.revision, { ...draft.content, organizations: [organization] }, f.actor.id);
  const membership = [{ organizationId: organization.id, role: 'lead', title: '合成带队人' }];
  await f.contactsStore.saveOperations(f.created.contact.id, f.created.revision, { ...f.created.contact.operations, organizationMemberships: membership, participationForms: ['guest'] }, f.actor.id);
  const roster = await f.contactsStore.read(), operations = { ...roster.contacts[0].operations, responseStatus: 'attending' };
  for (const key of ['organizationMemberships', 'sessionRoles', 'participationForms']) delete operations[key];
  const response = await request(f, '/api/admin/contacts/' + f.created.contact.id, { expectedRevision: roster.revision, operations });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.replySaved, true); assert.equal(result.admission.status, 'confirmed');
  assert.deepEqual(result.contact.operations.organizationMemberships, membership); assert.deepEqual(result.contact.operations.participationForms, ['guest']);
  assert.equal((await f.registrationService.repository.list()).registrations.length, 1); assert.equal(f.mailCalls, 0);
});

for (const journal of ['registration', 'conversion']) test(journal + ' lost ACK preserves saved reply and resolves only through later explicit source replay', async () => {
  const f = await fixture(), append = f.objects.append; let lose = true;
  const suffix = journal === 'registration' ? 'cms/v1/registrations/' + EVENT + '/index/commits.jsonl' : 'cms/v1/intent-invitations/commits.jsonl';
  f.objects.append = async (...args) => { const ack = await append(...args); if (lose && args[0] === suffix) { lose = false; throw new Error(SECRET); } return ack; };
  const response = await f.saveReply(); assert.equal(response.status, 200); const saved = await response.json();
  assert.equal(saved.replySaved, true); assert.equal(saved.admission.status, 'unavailable'); assert.equal((await f.registrationService.repository.list()).registrations.length, 1); assert.equal(f.mailCalls, 0);
  const result = await f.synchronize({ actor: f.actor, contactId: f.created.contact.id, saved }); assert.equal(result.status, 'confirmed');
  assert.equal((await f.registrationService.repository.list()).registrations.length, 1); assert.equal((await f.intentService.read({ actor: f.actor })).conversions.length, 1); assert.equal(f.mailCalls, 0);
});

test('concurrent source changes and withdrawn existing registrations never claim fresh confirmed admission', async () => {
  const f = await fixture(), original = f.intentService.convertContacts;
  const synchronized = createAttendanceSynchronizer({ registrationService: f.registrationService, contactsStore: f.contactsStore,
    intentService: { convertContacts: async input => { const result = await original(input); const roster = await f.contactsStore.read(); await f.contactsStore.saveOperations(f.created.contact.id, roster.revision, { ...roster.contacts[0].operations, responseStatus: 'declined' }, f.actor.id); return result; } } });
  f.api = cloudApi(f, synchronized);
  const saved = await (await f.saveReply()).json(); assert.equal(saved.replySaved, true); assert.deepEqual(saved.admission, { status: 'unavailable', reason: 'SOURCE_CHANGED' });
  const admission = await f.registrationService.getAdmissions({ actor: f.actor }), id = admission.people[0].registrationId;
  const removed = await f.registrationService.withdrawAdmission({ actor: f.actor, expectedRevision: admission.revision, operationId: 'synthetic_explicit_withdraw_operation_01', registrationId: id }); assert.equal(removed.outcome, 'updated');
  f.api = cloudApi(f); const retried = await (await f.saveReply()).json(); assert.deepEqual(retried.admission, { status: 'unavailable', reason: 'REGISTRATION_INACTIVE' });
  assert.equal((await f.registrationService.getAdmissions({ actor: f.actor })).summary.confirmedCount, 0);
});

test('callback unavailability, malformed results and unconfigured local flow keep the known contact ACK', async t => {
  for (const callback of [async () => { throw new Error(SECRET); }, async () => ({ status: 'confirmed', registrationId: 'forged' })]) {
    const f = await fixture(); f.api = cloudApi(f, callback); const saved = await (await f.saveReply()).json(); assert.equal(saved.replySaved, true); assert.deepEqual(saved.admission, { status: 'unavailable', reason: 'REGISTRATION_UNAVAILABLE' });
  }
  const directory = await mkdtemp(join(tmpdir(), 'artdico-people-local-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createFileContentStore({ directory }), contactsStore = createFileContactsStore({ directory, contentStore: store });
  const created = await contactsStore.createContact(0, profile(), 'local_operator'), password = 'synthetic-people-local-password';
  const origin = 'http://127.0.0.1:8787', api = createContentApi({ store, contactsStore, users: [{ id: 'local_operator', username: 'operator', label: '合成账号', roles: ['editor', 'outreach'], passwordHash: await hashPassword(password) }], allowedOrigin: origin });
  const login = await api(new Request(origin + '/api/admin/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'operator', password }) }));
  const session = await login.json(), response = await api(new Request(origin + '/api/admin/contacts/' + created.contact.id, { method: 'PUT', headers: { origin, 'content-type': 'application/json', cookie: login.headers.get('set-cookie').split(';')[0], 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ expectedRevision: 1, operations: { ...created.contact.operations, responseStatus: 'attending' } }) }));
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.replySaved, true); assert.deepEqual(result.admission, { status: 'unavailable', reason: 'NOT_CONFIGURED' });
});

test('guest relationship guard requires literal editor+outreach before any contact access and rejects carried consent', async () => {
  let reads = 0; const guard = roles => createGuestContactLinkGuard({ actor: { id: 'operator', roles }, contactsStore: { read: async () => { reads++; throw new Error(SECRET); } }, errorFactory: (...args) => new CloudContentError(...args) });
  const before = { guests: [guest('guest_01', 'contact_01')] };
  for (const roles of [['editor'], ['outreach'], ['superadmin']]) {
    await assert.rejects(guard(roles)({ current: { guests: [] }, next: before, published: null }), { code: 'FORBIDDEN' });
    await assert.rejects(guard(roles)({ current: before, next: { guests: [] }, published: null }), { code: 'FORBIDDEN' });
    await guard(roles)({ current: before, next: { guests: [{ ...before.guests[0], name: 'Updated public name' }] }, published: null });
  }
  assert.equal(reads, 0);
  await assert.rejects(guard(['editor', 'outreach'])({ current: before, next: { guests: [{ ...guest('guest_01', 'contact_02'), publicConsent: true }] }, published: null }), { code: 'CONTACT_LINK_CONSENT_REQUIRED' }); assert.equal(reads, 0);
  await guard(['editor', 'outreach'])({ current: before, next: { guests: [guest('guest_01', '')] }, published: null }); assert.equal(reads, 0);
  await assert.rejects(guard(['editor', 'outreach'])({ current: before, next: { guests: [guest('guest_01', '')] } }), { code: 'CONTACTS_UNAVAILABLE', status: 503 }); assert.equal(reads, 0);
  await assert.rejects(guard(['editor', 'outreach'])({ current: { guests: [] }, next: before, published: { revision: 1, content: { guests: [{ id: 'guest_01' }] } } }), { code: 'CONTACT_LINK_PUBLISHED', status: 422 }); assert.equal(reads, 0, 'an orphan public ID also cannot be claimed by a new private link');
});

test('a published same-name guest cannot be relinked until its public version is explicitly withdrawn', async () => {
  const f = await fixture(); f.actor.roles.push('publisher');
  const second = await f.contactsStore.createContact(1, profile('合成人员', { email: 'second.synthetic.people@example.invalid' }), f.actor.id);
  const image = await f.portraitStore.upload({ contentType: 'image/png', dataBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=' });
  let draft = (await f.store.read()).draft;
  async function save(content) {
    const response = await request(f, '/api/admin/content', { expectedRevision: draft.revision, content });
    assert.equal(response.status, 200, JSON.stringify(await response.clone().json())); draft = (await response.json()).draft; return draft;
  }
  async function publish() {
    const response = await request(f, '/api/admin/content/publish', { expectedRevision: draft.revision }, { method: 'POST' });
    assert.equal(response.status, 200); return (await response.json()).published;
  }
  await save({ ...draft.content, guests: [{ ...guest('guest_same_name', f.created.contact.id), name: '合成人员', portraitId: image.id, status: 'confirmed' }] });
  await save({ ...draft.content, guests: [{ ...draft.content.guests[0], publicConsent: true }] });
  const publicA = await publish(); assert.equal(publicA.content.guests.length, 1);
  async function blocked(guests) {
    const before = f.objects.calls.length, response = await request(f, '/api/admin/content', { expectedRevision: draft.revision, content: { ...draft.content, guests } });
    assert.equal(response.status, 422); const body = await response.json(); assert.equal(body.error.code, 'CONTACT_LINK_PUBLISHED');
    assert.equal(body.error.message, '这份嘉宾资料仍有公开版本；请先停止公开并保存发布，再更换关联人员。');
    assert.equal(f.objects.calls.slice(before).some(call => call.key.startsWith('cms/v1/contacts/') || call.operation !== 'get'), false, 'public attribution rejection precedes PII reads, portrait checks and writes');
    assert.equal((await f.store.read()).draft.revision, draft.revision);
  }
  await blocked([{ ...draft.content.guests[0], contactId: second.contact.id, publicConsent: false }]);
  await blocked([{ ...draft.content.guests[0], contactId: '', publicConsent: false }]);
  await blocked([]);
  await save({ ...draft.content, guests: [{ ...draft.content.guests[0], publicConsent: false, visibility: 'private' }] });
  await blocked([{ ...draft.content.guests[0], contactId: second.contact.id }]);
  const withdrawn = await publish(); assert.equal(withdrawn.content.guests.length, 0);
  const unreviewed = { ...draft.content, guests: [{ ...draft.content.guests[0], contactId: second.contact.id, publicConsent: true }] };
  await expectError(await request(f, '/api/admin/content', { expectedRevision: draft.revision, content: unreviewed }), 422, 'CONTACT_LINK_CONSENT_REQUIRED');
  await save({ ...draft.content, guests: [{ ...draft.content.guests[0], contactId: second.contact.id, publicConsent: false }] });
  assert.equal(draft.content.guests[0].contactId, second.contact.id);
  await save({ ...draft.content, guests: [{ ...draft.content.guests[0], publicConsent: true, visibility: 'public' }] });
  assert.equal((await f.store.read()).published.content.guests.length, 0, 'a fresh consent save for B cannot attribute A\'s withdrawn public snapshot to B');
  const publicB = await publish(); assert.equal(publicB.content.guests.length, 1); assert.equal(publicB.content.guests[0].id, publicA.content.guests[0].id);
  assert.equal(JSON.stringify(publicB.content.guests[0]).includes(second.contact.id), false, 'private source linkage never enters public content');
});

test('cloud content save guards changed links inside existing CAS and retains unchanged old-client links without PII reads', async () => {
  const f = await fixture(), base = (await f.store.read()).draft;
  const input = { ...base.content, guests: [guest('guest_synthetic', f.created.contact.id)] };
  f.actor.roles = ['editor']; const start = f.objects.calls.length;
  await expectError(await request(f, '/api/admin/content', { expectedRevision: 0, content: input }), 403, 'FORBIDDEN');
  assert.equal(f.objects.calls.slice(start).some(call => call.key.startsWith('cms/v1/contacts/')), false);
  f.actor.roles = ['editor', 'outreach']; const linked = await request(f, '/api/admin/content', { expectedRevision: 0, content: input }); assert.equal(linked.status, 200); assert.equal((await linked.json()).draft.content.guests[0].contactId, f.created.contact.id);
  f.actor.roles = ['editor']; const current = (await f.store.read()).draft, next = structuredClone(current.content); delete next.guests[0].contactId; next.guests[0].name = '合成公开资料修正';
  const before = f.objects.calls.length, saved = await request(f, '/api/admin/content', { expectedRevision: current.revision, content: next }); assert.equal(saved.status, 200); assert.equal((await saved.json()).draft.content.guests[0].contactId, f.created.contact.id);
  assert.equal(f.objects.calls.slice(before).some(call => call.key.startsWith('cms/v1/contacts/')), false);
  const latest = (await f.store.read()).draft;
  await expectError(await request(f, '/api/admin/content', { expectedRevision: latest.revision, content: { ...latest.content, guests: [] } }), 403, 'FORBIDDEN');
  f.actor.roles = ['editor', 'outreach'];
  const modified = structuredClone(latest.content); modified.guests[0].contactId = 'missing_contact';
  await expectError(await request(f, '/api/admin/content', { expectedRevision: latest.revision, content: modified }), 404, 'CONTACT_NOT_FOUND');
  const roster = await f.contactsStore.read(); await f.contactsStore.saveOperations(f.created.contact.id, roster.revision, { ...roster.contacts[0].operations, responseStatus: 'declined' }, f.actor.id);
  const cleared = structuredClone(latest.content); cleared.guests[0].contactId = '';
  assert.equal((await request(f, '/api/admin/content', { expectedRevision: latest.revision, content: cleared })).status, 200, 'explicit unlink needs no fresh source eligibility');
  const after = (await f.store.read()).draft, relink = structuredClone(after.content); relink.guests[0].contactId = f.created.contact.id;
  await expectError(await request(f, '/api/admin/content', { expectedRevision: after.revision, content: relink }), 422, 'CONTACT_DECLINED');
  assert.equal((await f.store.read()).draft.revision, after.revision);
});

test('local content handler applies the same link guard, omission compatibility and consent reset with no redundant content read', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-people-local-links-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const store = createFileContentStore({ directory }), contactsStore = createFileContactsStore({ directory, contentStore: store }), password = 'synthetic-people-link-password';
  const created = await contactsStore.createContact(0, profile(), 'combined'), passwordHash = await hashPassword(password);
  let contactReads = 0;
  const origin = 'http://127.0.0.1:8787', api = createContentApi({ store, contactsStore: { ...contactsStore, read: async () => { contactReads++; return contactsStore.read(); } }, allowedOrigin: origin,
    users: [{ id: 'combined', username: 'combined', label: '合成邀约编辑', roles: ['editor', 'outreach'], passwordHash }, { id: 'editor', username: 'editor', label: '合成编辑', roles: ['editor'], passwordHash }] });
  async function login(username) { const response = await api(new Request(origin + '/api/admin/login', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })); return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] }; }
  const editor = await login('editor'), combined = await login('combined');
  const put = (session, revision, content) => api(new Request(origin + '/api/admin/content', { method: 'PUT', headers: { origin, 'content-type': 'application/json', cookie: session.cookie, 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ expectedRevision: revision, content }) }));
  const base = (await store.read()).draft, input = { ...base.content, guests: [guest('guest_local', created.contact.id)] };
  await expectError(await put(editor, base.revision, input), 403, 'FORBIDDEN'); assert.equal(contactReads, 0);
  assert.equal((await put(combined, base.revision, input)).status, 200); assert.equal(contactReads, 1);
  const current = (await store.read()).draft, unchanged = structuredClone(current.content); delete unchanged.guests[0].contactId; unchanged.guests[0].name = '合成公开修改';
  const response = await put(editor, current.revision, unchanged); assert.equal(response.status, 200); assert.equal((await response.json()).draft.content.guests[0].contactId, created.contact.id); assert.equal(contactReads, 1);
  const latest = (await store.read()).draft, clear = structuredClone(latest.content); clear.guests[0].contactId = ''; clear.guests[0].publicConsent = true;
  await expectError(await put(combined, latest.revision, clear), 422, 'CONTACT_LINK_CONSENT_REQUIRED'); assert.equal(contactReads, 1);
  clear.guests[0].publicConsent = false; assert.equal((await put(combined, latest.revision, clear)).status, 200); assert.equal(contactReads, 1);
});
