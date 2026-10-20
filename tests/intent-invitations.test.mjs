import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createIntentInvitationRepository } from '../functions/intent-invitations/repository.mjs';
import { createIntentInvitationService } from '../functions/intent-invitations/service.mjs';
import { createIntentInvitationApi } from '../functions/intent-invitations/handler.mjs';
import { prepareIntentContactImport, createIntentContactImporter } from '../functions/intent-invitations/importer.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const actor = { id: 'synthetic-staff', roles: ['outreach', 'reviewer'] };
const now = () => Date.parse('2026-10-21T01:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const objects = memoryObjects(), journalFor = prefix => createObjectJournal({ objects, prefix });
  const contentStore = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore: createOssPortraitStore({ objects }), now });
  const contactsStore = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore, now });
  const created = await contactsStore.createContact(0, { name: '合成来宾', displayName: '合成称呼', email: 'synthetic@example.invalid',
    city: '合成城市', organization: '合成机构', position: '合成岗位', background: '合成资料，仅用于测试。', contactConsent: 'consented' }, actor.id);
  const contact = created.contact, submitted = [], saved = new Map(); let providerCalls = 0, providerStatus = 'provider_accepted';
  const registrationService = { async submitStaffRegistration(input) {
    submitted.push(structuredClone(input));
    if (!saved.has(input.sourceContactId)) saved.set(input.sourceContactId, { committed: true, eventId: 'ggj-cn-2026', registrationId: 'r_synthetic', referenceCode: 'R_SYNTHETIC', committedAt: new Date(now()).toISOString() });
    return { outcome: submitted.length === 1 ? 'created' : 'replayed', receipt: structuredClone(saved.get(input.sourceContactId)) };
  } };
  const repository = createIntentInvitationRepository({ journal: journalFor('cms/v1/intent-invitations') });
  const emailProvider = { readiness: () => ({ ready: true, reason: 'SYNTHETIC_PROVIDER' }), async send() { providerCalls++; return { status: providerStatus }; } };
  const dependencies = { registrationService, contactsStore, contentStore, repository, emailProvider, isRegistrationActive: async () => true, now };
  const service = createIntentInvitationService(dependencies);
  const convert = () => service.convertContacts({ contactIds: [contact.id], expectedContactRevision: 1, actor, permissionReference: '合成用户明确授权转换原始意向。' });
  const invitationInput = channel => ({ contactId: contact.id, expectedContactRevision: 1, expectedRegistrationId: 'r_synthetic', channel, actor, confirmEmail: channel === 'email' });
  return { objects, journalFor, contentStore, contactsStore, contact, submitted, repository, dependencies, service, convert, invitationInput,
    providerCalls: () => providerCalls, setProviderStatus(value) { providerStatus = value; } };
}

test('selected source conversion is durable and idempotent without fabricated applicant consent or source edits', async () => {
  const f = await fixture(), before = await f.contactsStore.read();
  const result = await f.convert();
  assert.equal(result.status, 'completed'); assert.equal(result.registrations[0].outcome, 'created');
  assert.deepEqual(await f.contactsStore.read(), before);
  const input = f.submitted[0];
  assert.equal(input.sourceContactId, f.contact.id); assert.deepEqual(input.actor, actor);
  assert.equal(input.input.fields.name, '合成来宾');
  assert.equal(Object.hasOwn(input.input, 'consent'), false);
  assert.equal(Object.hasOwn(input.input.fields, 'consentAccepted'), false);
  const second = createIntentInvitationService(f.dependencies);
  const replay = await second.convertContacts({ contactIds: [f.contact.id], expectedContactRevision: 1, actor, permissionReference: '合成授权。' });
  assert.equal(replay.registrations[0].outcome, 'replayed'); assert.equal(f.submitted.length, 1);
  const state = await second.read({ actor });
  assert.equal(state.conversions[0].sourceContactId, f.contact.id); assert.equal(state.conversions[0].sourceDigest, f.contact.source.digest);
  assert.doesNotMatch(JSON.stringify(state), /scrypt\$|passwordHash|csrfToken/u);
});

test('stale revision, malformed selections, unauthorized users and opted-out sources fail before registration writes', async () => {
  const f = await fixture();
  for (const patch of [{ expectedContactRevision: 0 }, { contactIds: [f.contact.id, f.contact.id] }, { contactIds: [] },
    { actor: { id: actor.id, roles: ['editor'] } }, { permissionReference: '' }]) {
    await assert.rejects(f.service.convertContacts({ contactIds: [f.contact.id], expectedContactRevision: 1, actor, permissionReference: '合成授权。', ...patch }));
  }
  assert.equal(f.submitted.length, 0);
  const updated = await f.contactsStore.saveOperations(f.contact.id, 1, { ...f.contact.operations, responseStatus: 'declined' }, actor.id);
  await assert.rejects(f.service.convertContacts({ contactIds: [f.contact.id], expectedContactRevision: updated.revision, actor, permissionReference: '合成授权。' }), { code: 'CONTACT_DECLINED' });
  assert.equal(f.submitted.length, 0);
});

test('manual invitation uses confirmed real event facts, prepares PNG settings and records sending only by explicit separate action', async () => {
  const f = await fixture(); await f.convert();
  const prepared = await f.service.issueInvitation(f.invitationInput('manual'));
  assert.equal(prepared.invitation.status, 'prepared'); assert.equal(f.providerCalls(), 0);
  const content = prepared.invitation.content;
  assert.equal(content.settings.confirmed, true); assert.equal(content.settings.date, '2026-12-05');
  assert.equal(content.settings.time, '09:30–18:00'); assert.match(content.settings.venue, /梦海大道5188号/u);
  assert.match(content.text, /10:00 正式活动开始/u); assert.match(content.text, /不自动授予/u);
  assert.equal((await f.service.issueInvitation(f.invitationInput('manual'))).replayed, true);
  const sent = await f.service.markManualSent({ invitationId: prepared.invitation.id, channel: 'wechat', actor });
  assert.equal(sent.invitation.status, 'manually_sent'); assert.equal(sent.invitation.sentChannel, 'wechat');
  assert.equal((await f.service.markManualSent({ invitationId: prepared.invitation.id, channel: 'wechat', actor })).replayed, true);
  await assert.rejects(f.service.markManualSent({ invitationId: prepared.invitation.id, channel: 'email', actor }), { code: 'INVITATION_CHANGED' });
  assert.equal(f.providerCalls(), 0);
});

test('real-email branch requires explicit send intent and acknowledged reservation before the single provider call', async () => {
  const f = await fixture(); await f.convert();
  await assert.rejects(f.service.issueInvitation({ ...f.invitationInput('email'), confirmEmail: false }), { code: 'EMAIL_NOT_READY' });
  assert.equal(f.providerCalls(), 0);
  const result = await f.service.issueInvitation(f.invitationInput('email'));
  assert.equal(result.invitation.status, 'provider_accepted'); assert.equal(f.providerCalls(), 1);
  assert.notEqual(result.invitation.status, 'delivered');
  assert.equal((await createIntentInvitationService(f.dependencies).issueInvitation(f.invitationInput('email'))).replayed, true);
  assert.equal(f.providerCalls(), 1);
});

test('independent issuers race on one persistent reservation and at most one sends', async () => {
  const f = await fixture(); await f.convert();
  const second = createIntentInvitationService(f.dependencies);
  const outcomes = await Promise.allSettled([f.service.issueInvitation(f.invitationInput('email')), second.issueInvitation(f.invitationInput('email'))]);
  assert.equal(f.providerCalls(), 1);
  assert.ok(outcomes.some(result => result.status === 'fulfilled'));
  assert.equal((await f.service.read({ actor })).invitations.length, 1);
});

test('unknown delivery acknowledgement persists unknown and never automatically resends, including after reconstruction', async () => {
  const f = await fixture(); await f.convert(); f.setProviderStatus('unknown');
  assert.equal((await f.service.issueInvitation(f.invitationInput('email'))).invitation.status, 'unknown');
  assert.equal((await createIntentInvitationService(f.dependencies).issueInvitation(f.invitationInput('email'))).invitation.status, 'unknown');
  assert.equal(f.providerCalls(), 1);
  const changed = await f.contactsStore.saveProfile(f.contact.id, 1, { displayName: '合成新称呼' }, actor.id);
  await assert.rejects(f.service.issueInvitation({ ...f.invitationInput('email'), expectedContactRevision: changed.revision }), { code: 'INVITATION_CHANGED' });
  assert.equal(f.providerCalls(), 1);
});

test('withdrawal/deletion review and unknown review reads block invitations, assignments and manual sending', async () => {
  const f = await fixture(); await f.convert();
  const prepared = await f.service.issueInvitation(f.invitationInput('manual'));
  const closed = createIntentInvitationService({ ...f.dependencies, isRegistrationActive: async () => false });
  await assert.rejects(closed.issueInvitation(f.invitationInput('email')), { code: 'REGISTRATION_INACTIVE' });
  await assert.rejects(closed.markManualSent({ invitationId: prepared.invitation.id, channel: 'wechat', actor }), { code: 'REGISTRATION_INACTIVE' });
  await assert.rejects(closed.assignContact({ contactId: f.contact.id, expectedContactRevision: 1, sessionIds: [], boothIds: [], actor }), { code: 'REGISTRATION_INACTIVE' });
  const unknown = createIntentInvitationService({ ...f.dependencies, isRegistrationActive: async () => { throw new Error('PRIVATE-SYNTHETIC-REVIEW'); } });
  await assert.rejects(unknown.issueInvitation(f.invitationInput('email')), error => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes('PRIVATE-'));
  assert.equal(f.providerCalls(), 0);
});

test('lost reservation ACK never calls provider; persisted issuing is read as unknown', async () => {
  const f = await fixture(); await f.convert();
  const real = f.repository;
  const uncertain = { read: real.read, async commit(...args) { await real.commit(...args); throw new Error('PRIVATE-SYNTHETIC-LOST-ACK'); } };
  const service = createIntentInvitationService({ ...f.dependencies, repository: uncertain });
  await assert.rejects(service.issueInvitation(f.invitationInput('email')), error => !error.message.includes('PRIVATE-'));
  assert.equal(f.providerCalls(), 0);
  assert.equal((await f.service.read({ actor })).invitations[0].status, 'unknown');
  assert.equal((await f.service.issueInvitation(f.invitationInput('email'))).replayed, true);
  assert.equal(f.providerCalls(), 0);
});

test('accepted source receipt is recovered after a missing local link without a second staff submission', async () => {
  const f = await fixture();
  const receipt = { committed: true, eventId: 'ggj-cn-2026', registrationId: '_synthetic_recovered', referenceCode: '-synthetic_reference', committedAt: new Date(now()).toISOString() };
  const registrationService = { ...f.dependencies.registrationService, async getStaffRegistrationBySource() { return { outcome: 'found', receipt }; } };
  const service = createIntentInvitationService({ ...f.dependencies, registrationService });
  const recovered = await service.convertContacts({ contactIds: [f.contact.id], expectedContactRevision: 1, actor, permissionReference: '合成恢复授权。' });
  assert.equal(recovered.registrations[0].outcome, 'replayed'); assert.equal(recovered.registrations[0].registrationId, receipt.registrationId);
  assert.equal(f.submitted.length, 0);
});

test('contact/review changes after reservation refuse provider invocation', async () => {
  const f = await fixture(); await f.convert();
  let reads = 0;
  const service = createIntentInvitationService({ ...f.dependencies, isRegistrationActive: async () => ++reads < 2 });
  assert.equal((await service.issueInvitation(f.invitationInput('email'))).invitation.status, 'rejected');
  assert.equal(f.providerCalls(), 0);
});

test('assignments keep stable IDs private, validate current planning and never publish or mark attendance', async () => {
  const f = await fixture(); await f.convert();
  const draft = (await f.contentStore.read()).draft;
  const selected = draft.content.sessions.find(session => session.status === 'scheduled');
  const saved = await f.service.assignContact({ contactId: f.contact.id, expectedContactRevision: 1, sessionIds: [selected.id], boothIds: [], actor });
  assert.deepEqual(saved.contact.operations.sessionIds, [selected.id]);
  assert.equal(saved.contact.operations.responseStatus, 'pending');
  assert.equal((await f.contentStore.read()).published, null);
  await assert.rejects(f.service.assignContact({ contactId: f.contact.id, expectedContactRevision: saved.revision, sessionIds: ['missing'], boothIds: [], actor }), { code: 'INVALID_ASSIGNMENT' });
});

test('HTTP conversion/invitation routes enforce authentication, Origin, CSRF, field whitelist and private responses', async () => {
  const f = await fixture();
  const api = createIntentInvitationApi({ service: f.service, authenticate: async request => {
    if (request.headers.get('cookie') !== 'synthetic-session') throw Object.assign(new Error('PRIVATE-SYNTHETIC'), { code: 'AUTH_REQUIRED', status: 401 });
    return { user: actor, csrfToken: 'synthetic-csrf' };
  } });
  const request = (path, data, extra = {}) => new Request('https://api.artdico.host' + path, { method: data ? 'POST' : 'GET',
    headers: { cookie: 'synthetic-session', origin: 'https://api.artdico.host', 'x-csrf-token': 'synthetic-csrf', 'content-type': 'application/json', ...extra }, ...(data ? { body: JSON.stringify(data) } : {}) });
  const input = { contactIds: [f.contact.id], expectedContactRevision: 1 };
  assert.equal((await api(request('/api/admin/contacts/convert', input, { cookie: '' }))).status, 401);
  assert.equal((await api(request('/api/admin/contacts/convert', input, { origin: 'https://artdico.host' }))).status, 403);
  assert.equal((await api(request('/api/admin/contacts/convert', input, { 'x-csrf-token': 'wrong' }))).status, 403);
  assert.equal((await api(request('/api/admin/contacts/convert', { ...input, actor: { id: 'attacker' } }))).status, 400);
  const result = await api(request('/api/admin/contacts/convert', input));
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).registrations.length, 1);
  const read = await api(request('/api/admin/intent-invitations'));
  assert.equal(read.status, 200); assert.doesNotMatch(await read.text(), /PRIVATE-|password|scrypt/u);
});

test('migration plans preserve original schema identities, source and private state and refuse conflicts or silent manual recreation', async () => {
  const f = await fixture(), roster = await f.contactsStore.read();
  const snapshot = JSON.stringify((await f.journalFor('cms/v1/contacts').read()).value);
  const plan = prepareIntentContactImport({ snapshot });
  assert.equal(plan.canCommit, true); assert.equal(plan.summary.added, 1); assert.deepEqual(plan.rows[0].contact, f.contact);
  assert.equal(plan.digest, hash(snapshot));
  assert.equal(prepareIntentContactImport({ snapshot, existingContacts: roster.contacts }).summary.unchanged, 1);
  const changed = structuredClone(roster.contacts); changed[0].profile.name = '合成变更';
  assert.equal(prepareIntentContactImport({ snapshot, existingContacts: changed }).summary.unchanged, 1);
  const malformed = JSON.parse(snapshot); malformed.contacts[0].id = 'c_wrong';
  assert.throws(() => prepareIntentContactImport({ snapshot: JSON.stringify(malformed) }));
  const importer = createIntentContactImporter({ contactsStore: { read: f.contactsStore.read } });
  await assert.rejects(importer.commit({ kind: 'snapshot', snapshot, originalSha256: plan.digest, expectedRevision: 1, actor }), { code: 'INVALID_INPUT' });
  assert.deepEqual(await f.contactsStore.read(), roster);
});
