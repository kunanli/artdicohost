import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssContactsStore } from '../functions/cloud-content/contacts-store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createIntentInvitationRepository } from '../functions/intent-invitations/repository.mjs';
import { createIntentInvitationService, buildRegistrationInvitation } from '../functions/intent-invitations/service.mjs';
import { INVITATION_POSTER_RENDER_VERSION, buildPosterInvitationSettings } from '../shared/organizer-progress.mjs';
import { eventConfig } from '../src/config/event.mjs';
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
  const dependencies = { registrationService, contactsStore, contentStore, repository, emailProvider, isRegistrationActive: async () => true, getAdmissionStatus: async () => ({ status: 'confirmed', revision: 0 }), now };
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
  const skipped = await f.service.convertContacts({ contactIds: [f.contact.id], expectedContactRevision: updated.revision, actor, permissionReference: '合成授权。' });
  assert.deepEqual(skipped.skipped, [{ contactId: f.contact.id, reason: 'CONTACT_DECLINED' }]);
  assert.equal(f.submitted.length, 0);
});

test('conversion preview skips opt-outs and audits omitted optional free-text links without changing original answers', async () => {
  const f = await fixture(), contact = structuredClone(f.contact);
  Object.assign(contact.profile, { website: '合成非网址答案', caseLinks: '合成暂无链接' });
  contact.sourceProfile = structuredClone(contact.profile); contact.sourceProfileDigest = hash(JSON.stringify(contact.sourceProfile)); contact.source.digest = contact.sourceProfileDigest;
  const declinedContact = structuredClone(contact); declinedContact.source.rowId = 'another-synthetic-row';
  declinedContact.id = 'c_' + hash('manual\0' + declinedContact.source.rowId).slice(0, 32);
  declinedContact.profile.contactConsent = 'declined'; declinedContact.sourceProfile = structuredClone(declinedContact.profile);
  declinedContact.sourceProfileDigest = hash(JSON.stringify(declinedContact.sourceProfile)); declinedContact.source.digest = declinedContact.sourceProfileDigest;
  const roster = { revision: 1, contacts: [contact, declinedContact] }, before = structuredClone(roster);
  const service = createIntentInvitationService({ ...f.dependencies, contactsStore: { ...f.contactsStore, read: async () => structuredClone(roster) } });
  const input = { contactIds: [contact.id, declinedContact.id], expectedContactRevision: 1, actor };
  const preview = await service.previewConversions(input);
  assert.deepEqual(preview.summary, { selected: 2, eligible: 1, skipped: 1, optionalFieldsOmitted: 2 }); assert.equal(f.submitted.length, 0);
  const result = await service.convertContacts({ ...input, permissionReference: '合成授权转换。' });
  assert.equal(result.registrations.length, 1); assert.equal(result.skipped.length, 1);
  assert.deepEqual(result.warnings, [{ contactId: contact.id, fields: ['website', 'caseLinks'] }]);
  assert.equal(Object.hasOwn(f.submitted[0].input.fields, 'website'), false); assert.equal(Object.hasOwn(f.submitted[0].input.fields, 'caseLinks'), false);
  assert.deepEqual(roster, before);
  const durable = (await f.repository.read()).value;
  assert.deepEqual(durable.conversions[0].projectionWarnings, ['website', 'caseLinks']);
  assert.deepEqual(durable.audit[0].projectionWarnings, ['website', 'caseLinks']);
  assert.equal(JSON.stringify(durable).includes('合成非网址答案'), false);
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

test('versioned manual preparation preserves old records and derives a stable new ID from exact content', async () => {
  const f = await fixture(); await f.convert();
  const legacy = await f.service.issueInvitation(f.invitationInput('manual'));
  await f.service.markManualSent({ actor, invitationId: legacy.invitation.id, channel: 'wechat' });
  const original = (await f.repository.read()).value.invitations[0];
  const input = { ...f.invitationInput('manual'), renderVersion: INVITATION_POSTER_RENDER_VERSION };
  const created = await f.service.issueInvitation(input), content = created.invitation.content;
  assert.deepEqual(content.settings, buildPosterInvitationSettings('合成称呼', eventConfig));
  assert.equal(created.invitation.id, 'i_' + hash(eventConfig.id + '\0r_synthetic\0manual\0' + hash(JSON.stringify(content))).slice(0, 32));
  assert.notEqual(created.invitation.id, original.id); assert.doesNotMatch(content.text, /楼层.*另行公布/u);
  let state = await f.repository.read(); assert.deepEqual(state.value.invitations[0], original);
  const replay = await createIntentInvitationService(f.dependencies).issueInvitation(input);
  assert.equal(replay.replayed, true); assert.deepEqual(await f.repository.read(), state);
  const updated = await f.contactsStore.saveProfile(f.contact.id, 1, { displayName: '合成新称呼' }, actor.id);
  const revised = await f.service.issueInvitation({ ...input, expectedContactRevision: updated.revision });
  assert.notEqual(revised.invitation.id, created.invitation.id);
  state = await f.repository.read(); assert.equal(state.value.invitations.length, 3); assert.deepEqual(state.value.invitations[0], original);
  assert.equal(f.providerCalls(), 0);
});

test('new poster preparation cannot alter an existing email identity, unknown result or legacy builder bytes', async () => {
  const f = await fixture(); await f.convert(); f.setProviderStatus('unknown');
  const email = await f.service.issueInvitation(f.invitationInput('email'));
  assert.equal(email.invitation.id, 'i_' + hash(eventConfig.id + '\0r_synthetic\0email').slice(0, 32));
  assert.equal(Object.hasOwn(email.invitation.content.settings, 'renderVersion'), false);
  const legacyBytes = JSON.stringify(buildRegistrationInvitation(f.contact, { registrationId: 'r_synthetic', referenceCode: 'R_SYNTHETIC' }));
  const before = structuredClone(email.invitation);
  await f.service.issueInvitation({ ...f.invitationInput('manual'), renderVersion: INVITATION_POSTER_RENDER_VERSION });
  assert.equal((await f.service.issueInvitation(f.invitationInput('email'))).invitation.status, 'unknown');
  assert.equal(f.providerCalls(), 1); assert.deepEqual((await f.repository.read()).value.invitations[0], before);
  assert.equal(JSON.stringify(buildRegistrationInvitation(f.contact, { registrationId: 'r_synthetic', referenceCode: 'R_SYNTHETIC' })), legacyBytes);
  for (const renderVersion of [INVITATION_POSTER_RENDER_VERSION, 2, 'unknown']) await assert.rejects(f.service.issueInvitation({ ...f.invitationInput('email'), renderVersion }), { code: 'INVALID_INPUT' });
  assert.equal(f.providerCalls(), 1);
});

test('a lost versioned manual ACK is recovered by exact ID after restart without duplicate history or provider calls', async () => {
  const f = await fixture(); await f.convert(); let commits = 0;
  const interrupted = createIntentInvitationService({ ...f.dependencies, repository: { read: () => f.repository.read(), async commit(...args) { await f.repository.commit(...args); commits++; throw Error('SYNTHETIC_LOST_MANUAL_ACK'); } } });
  const input = { ...f.invitationInput('manual'), renderVersion: INVITATION_POSTER_RENDER_VERSION };
  await assert.rejects(interrupted.issueInvitation(input), { code: 'STORAGE_UNAVAILABLE' });
  const durable = await f.repository.read();
  assert.equal((await createIntentInvitationService(f.dependencies).issueInvitation(input)).replayed, true);
  assert.deepEqual(await f.repository.read(), durable); assert.equal(commits, 1); assert.equal(f.providerCalls(), 0);
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
  const session = (await f.contentStore.read()).draft.content.sessions.find(item => item.status === 'scheduled');
  await assert.rejects(closed.assignContact({ contactId: f.contact.id, expectedContactRevision: 1, sessionIds: [session.id], boothIds: [], actor }), { code: 'REGISTRATION_INACTIVE' });
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


test('new assignments require confirmed admission while waitlisted and withdrawn historical references can be removed', async () => {
  const f = await fixture(); await f.convert();
  const draft = (await f.contentStore.read()).draft.content;
  draft.booths = [{ id: 'synthetic-booth', code: 'C-01', zone: 'C', organization: '合成团队', project: '合成作品', status: 'pending', internalNotes: '' }];
  await f.contentStore.save(0, draft, actor.id);
  const first = draft.sessions.find(item => item.status === 'scheduled');
  const next = draft.sessions.find(item => item.status === 'scheduled' && item.start >= first.end);
  assert.ok(next);
  const saved = await f.service.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: 1,
    sessionIds: [first.id], boothIds: ['synthetic-booth'] });
  const waiting = createIntentInvitationService({ ...f.dependencies, getAdmissionStatus: async () => ({ status: 'waitlisted', revision: 1 }) });
  await assert.rejects(waiting.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: saved.revision,
    sessionIds: [first.id, next.id], boothIds: ['synthetic-booth'] }), { code: 'REGISTRATION_WAITLISTED' });
  assert.equal((await f.contactsStore.read()).revision, saved.revision);
  for (const status of ['pending_review', 'rejected']) {
    const nonadmitted = createIntentInvitationService({ ...f.dependencies, getAdmissionStatus: async () => ({ status, revision: 1 }) });
    await assert.rejects(nonadmitted.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: saved.revision,
      sessionIds: [first.id, next.id], boothIds: ['synthetic-booth'] }), { code: 'REGISTRATION_INACTIVE' });
    const preview = await nonadmitted.previewInvitations({ actor, contactIds: [f.contact.id], expectedContactRevision: saved.revision });
    assert.equal(preview.entries[0].eligible, false); assert.equal(preview.entries[0].reason, 'REGISTRATION_INACTIVE');
    await assert.rejects(nonadmitted.issueInvitation({ ...f.invitationInput('manual'), expectedContactRevision: saved.revision }), { code: 'REGISTRATION_INACTIVE' });
    assert.equal((await f.contactsStore.read()).revision, saved.revision);
  }
  let statusReads = 0;
  const cleanup = createIntentInvitationService({ ...f.dependencies,
    getAdmissionStatus: async () => { statusReads++; throw Error('SYNTHETIC_UNKNOWN_ADMISSION'); },
    isRegistrationActive: async () => { statusReads++; throw Error('SYNTHETIC_UNKNOWN_REVIEW'); } });
  const removedBooth = await cleanup.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: saved.revision,
    sessionIds: [first.id], boothIds: [] });
  assert.deepEqual(removedBooth.contact.operations.boothIds, []); assert.equal(statusReads, 0);
  await assert.rejects(waiting.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: removedBooth.revision,
    sessionIds: [first.id], boothIds: ['synthetic-booth'] }), { code: 'REGISTRATION_WAITLISTED' });
  const declined = await f.contactsStore.saveOperations(f.contact.id, removedBooth.revision,
    { ...removedBooth.contact.operations, responseStatus: 'declined', notes: '合成历史备注保留' }, actor.id);
  const inactive = createIntentInvitationService({ ...f.dependencies, isRegistrationActive: async () => false,
    getAdmissionStatus: async () => ({ status: 'withdrawn', revision: 2 }) });
  const removed = await inactive.assignContact({ actor, contactId: f.contact.id, expectedContactRevision: declined.revision,
    sessionIds: [], boothIds: [] });
  assert.deepEqual(removed.contact.operations.sessionIds, []); assert.equal(removed.contact.operations.notes, '合成历史备注保留');
  assert.equal(removed.contact.operations.responseStatus, 'declined'); assert.equal((await f.contentStore.read()).published, null);
});

test('new per-session duties need confirmed admission while omitted or removed duties preserve safe historical cleanup', async () => {
  const f=await fixture();await f.convert();const session=(await f.contentStore.read()).draft.content.sessions.find(item=>item.status==='scheduled');
  const saved=await f.service.assignContact({actor,contactId:f.contact.id,expectedContactRevision:1,sessionIds:[session.id],boothIds:[],sessionRoles:[{sessionId:session.id,roles:['speaker']}]});
  assert.deepEqual(saved.contact.operations.sessionRoles,[{sessionId:session.id,roles:['speaker']}]);
  const waiting=createIntentInvitationService({...f.dependencies,getAdmissionStatus:async()=>({status:'waitlisted',revision:1})});
  await assert.rejects(waiting.assignContact({actor,contactId:f.contact.id,expectedContactRevision:saved.revision,sessionIds:[session.id],boothIds:[],sessionRoles:[{sessionId:session.id,roles:['speaker','organizer']}]}),{code:'REGISTRATION_WAITLISTED'});
  const retained=await waiting.assignContact({actor,contactId:f.contact.id,expectedContactRevision:saved.revision,sessionIds:[session.id],boothIds:[]});
  assert.deepEqual(retained.contact.operations.sessionRoles,saved.contact.operations.sessionRoles);
  const removed=await waiting.assignContact({actor,contactId:f.contact.id,expectedContactRevision:retained.revision,sessionIds:[],boothIds:[]});assert.deepEqual(removed.contact.operations.sessionRoles,[]);
  assert.deepEqual(removed.contact.profile,f.contact.profile);assert.equal(removed.contact.operations.responseStatus,'pending');
});
