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
import { createInvitationBatchOperations } from '../functions/intent-invitations/batch.mjs';
import { failure } from '../functions/intent-invitations/errors.mjs';
import { INVITATION_POSTER_RENDER_VERSION } from '../shared/organizer-progress.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const actor = { id: 'synthetic-batch-staff', roles: ['outreach', 'reviewer'] };
const now = () => Date.parse('2026-10-21T01:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
async function fixture(consents = ['consented', 'consented', 'consented']) {
  const objects = memoryObjects(), journalFor = prefix => createObjectJournal({ objects, prefix });
  const contentStore = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore: createOssPortraitStore({ objects }), now });
  const contactsStore = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore, now });
  const contacts = []; let contactRevision = 0;
  for (const [index, contactConsent] of consents.entries()) {
    const created = await contactsStore.createContact(contactRevision, { name: '合成来宾' + index,
      email: `synthetic-${index}@example.invalid`, contactConsent }, actor.id);
    contacts.push(created.contact); contactRevision = created.revision;
  }
  const admissions = new Map(), receipts = new Map();
  const registrationService = {
    async submitStaffRegistration({ sourceContactId }) {
      const index = contacts.findIndex(item => item.id === sourceContactId), id = 'R_SYNTHETIC_' + index;
      const receipt = { committed: true, eventId: 'ggj-cn-2026', registrationId: id, referenceCode: id, committedAt: new Date(now()).toISOString() };
      receipts.set(sourceContactId, receipt); admissions.set(id, { status: 'confirmed', kind: 'attendee', revision: 1, queueNumber: null });
      return { outcome: 'created', receipt };
    },
    async getAdmissionStatus(id) { const value = admissions.get(id); if (!value) throw Error('synthetic missing'); return structuredClone(value); },
  };
  const repository = createIntentInvitationRepository({ journal: journalFor('cms/v1/intent-invitations') });
  let providerCalls = 0;
  const dependencies = { registrationService, contactsStore, contentStore, repository, now, isRegistrationActive: async () => true,
    emailProvider: { readiness: () => ({ ready: true }), send: async () => { providerCalls++; return { status: 'provider_accepted' }; } } };
  const service = createIntentInvitationService(dependencies), contactIds = contacts.map(item => item.id);
  await service.convertContacts({ actor, contactIds, expectedContactRevision: contactRevision, permissionReference: '合成已授权来源。' });
  const input = { actor, contactIds, expectedContactRevision: contactRevision };
  return { objects, journalFor, contacts, contactsStore, repository, service, dependencies, input, admissions, receipts, providerCalls: () => providerCalls };
}
const prepare = (service, input, preview) => service.prepareInvitations({ ...input, previewToken: preview.previewToken, confirmPrepare: true });

test('batch precheck skips absent consent, declined and waitlisted contacts without writes or extra personal fields', async () => {
  const f = await fixture(['consented', 'unknown', 'declined', 'consented']);
  f.admissions.get(f.receipts.get(f.contacts[3].id).registrationId).status = 'waitlisted';
  const before = await f.repository.read(), preview = await f.service.previewInvitations(f.input);
  assert.deepEqual(preview.summary, { selected: 4, eligible: 1, skipped: 3 });
  assert.deepEqual(preview.entries.map(item => item.reason), [null, 'CONTACT_NOT_CONSENTED', 'CONTACT_DECLINED', 'REGISTRATION_WAITLISTED']);
  assert.deepEqual(await f.repository.read(), before);
  assert.doesNotMatch(JSON.stringify(preview), /example\.invalid|合成来宾/u);
  const result = await prepare(f.service, f.input, preview);
  assert.equal(result.summary.prepared, 1); assert.equal(result.summary.skipped, 3); assert.equal(f.providerCalls(), 0);
  const state = (await f.repository.read()).value;
  assert.equal(state.invitations.length, 1); assert.equal(state.invitations[0].status, 'prepared');
  assert.equal(state.audit.at(-1).action, 'prepare_invitation'); assert.equal(state.audit.at(-1).batchId, preview.previewToken);
});

test('explicit preparation replays the stable individual ledger after reconstruction without duplicate audit or sending', async () => {
  const f = await fixture(), preview = await f.service.previewInvitations(f.input);
  await assert.rejects(f.service.prepareInvitations({ ...f.input, previewToken: preview.previewToken }), { code: 'INVALID_INPUT' });
  const first = await prepare(f.service, f.input, preview), before = await f.repository.read();
  assert.equal(first.summary.prepared, 3);
  const replay = await prepare(createIntentInvitationService(f.dependencies), f.input, preview);
  assert.equal(replay.summary.replayed, 3); assert.deepEqual(await f.repository.read(), before); assert.equal(f.providerCalls(), 0);
});

test('explicit versioned batch prepares a new digest beside legacy prepared history and binds the exact version', async () => {
  const f = await fixture(['consented']), legacyPreview = await f.service.previewInvitations(f.input);
  await prepare(f.service, f.input, legacyPreview);
  const legacy = structuredClone((await f.repository.read()).value.invitations[0]);
  const input = { ...f.input, renderVersion: INVITATION_POSTER_RENDER_VERSION }, preview = await f.service.previewInvitations(input);
  assert.equal(preview.summary.eligible, 1); assert.notEqual(preview.previewToken, legacyPreview.previewToken);
  const before = await f.repository.read();
  await assert.rejects(prepare(f.service, input, legacyPreview), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await f.repository.read(), before);
  const result = await prepare(f.service, input, preview);
  assert.equal(result.summary.prepared, 1); assert.equal(result.results[0].invitation.content.settings.renderVersion, INVITATION_POSTER_RENDER_VERSION);
  assert.notEqual(result.results[0].invitation.id, legacy.id);
  assert.deepEqual((await f.repository.read()).value.invitations[0], legacy);
  const stable = await f.repository.read(); assert.equal((await prepare(createIntentInvitationService(f.dependencies), input, preview)).summary.replayed, 1);
  assert.deepEqual(await f.repository.read(), stable); assert.equal(f.providerCalls(), 0);
});

test('versioned batch still skips all historical dispatches and unknown outcomes without writes or resends', async () => {
  const f = await fixture(['consented', 'consented']);
  const first = f.contacts[0], second = f.contacts[1];
  const prepared = await f.service.issueInvitation({ actor, contactId: first.id, expectedContactRevision: f.input.expectedContactRevision,
    expectedRegistrationId: f.receipts.get(first.id).registrationId });
  await f.service.markManualSent({ actor, invitationId: prepared.invitation.id, channel: 'wechat' });
  const unknown = createIntentInvitationService({ ...f.dependencies, emailProvider: { readiness: () => ({ ready: true }), send: async () => ({ status: 'unknown' }) } });
  await unknown.issueInvitation({ actor, contactId: second.id, expectedContactRevision: f.input.expectedContactRevision,
    expectedRegistrationId: f.receipts.get(second.id).registrationId, channel: 'email', confirmEmail: true });
  const before = await f.repository.read(), input = { ...f.input, renderVersion: INVITATION_POSTER_RENDER_VERSION };
  const preview = await f.service.previewInvitations(input);
  assert.deepEqual(preview.entries.map(entry => entry.reason), ['INVITATION_DISPATCH_RECORDED', 'INVITATION_STATUS_UNKNOWN']);
  assert.equal((await prepare(f.service, input, preview)).summary.skipped, 2); assert.deepEqual(await f.repository.read(), before);
});

test('precheck binding rejects changed actor, selection, roster, source relation and admission revision before writes', async () => {
  const f = await fixture(), preview = await f.service.previewInvitations(f.input), before = await f.repository.read();
  for (const patch of [{ actor: { ...actor, id: 'another-synthetic-actor' } }, { contactIds: f.input.contactIds.slice().reverse() }, { previewToken: 'b_' + '0'.repeat(64) }]) {
    await assert.rejects(prepare(f.service, { ...f.input, ...patch }, { ...preview, ...patch }), { code: 'REVISION_CONFLICT' });
  }
  f.admissions.get(f.receipts.get(f.contacts[0].id).registrationId).revision++;
  await assert.rejects(prepare(f.service, f.input, preview), { code: 'REVISION_CONFLICT' });
  const changed = await f.contactsStore.saveOperations(f.contacts[0].id, f.input.expectedContactRevision,
    { ...f.contacts[0].operations, responseStatus: 'declined' }, actor.id);
  await assert.rejects(prepare(f.service, f.input, preview), { code: 'REVISION_CONFLICT' });
  assert.deepEqual(await f.repository.read(), before);
  const state = await f.repository.read(); state.value.conversions[1].sourceDigest = hash('synthetic alternate source');
  state.value.revision++; state.value.audit.push({ revision: state.value.revision, action: 'convert_contact', actorId: actor.id,
    sourceContactId: f.contacts[0].id, invitationId: null, at: new Date(now()).toISOString() });
  await f.repository.commit(state.cursor, state.value);
  const sourcePreview = await f.service.previewInvitations({ ...f.input, expectedContactRevision: changed.revision });
  assert.equal(sourcePreview.entries[1].reason, 'REGISTRATION_CHANGED');
  assert.equal(sourcePreview.entries[0].reason, 'CONTACT_DECLINED');
});

test('withdrawn, unknown admission reads and missing admission methods fail closed for batch and individual invitations', async () => {
  const f = await fixture();
  f.admissions.get(f.receipts.get(f.contacts[0].id).registrationId).status = 'withdrawn';
  const preview = await f.service.previewInvitations(f.input);
  assert.equal(preview.entries[0].reason, 'REGISTRATION_INACTIVE');
  await assert.rejects(f.service.issueInvitation({ actor, contactId: f.contacts[0].id, expectedContactRevision: f.input.expectedContactRevision,
    expectedRegistrationId: f.receipts.get(f.contacts[0].id).registrationId, channel: 'manual' }), { code: 'REGISTRATION_INACTIVE' });
  const missing = createIntentInvitationService({ ...f.dependencies, getAdmissionStatus: async () => undefined });
  await assert.rejects(missing.previewInvitations(f.input), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal((await f.repository.read()).value.invitations.length, 0);
});

test('already sent or uncertain dispatch is skipped, while an existing prepared manual invitation is reusable', async () => {
  const f = await fixture(), first = f.contacts[0], registrationId = f.receipts.get(first.id).registrationId;
  const invitation = await f.service.issueInvitation({ actor, contactId: first.id, expectedContactRevision: f.input.expectedContactRevision, expectedRegistrationId: registrationId });
  await f.service.markManualSent({ actor, invitationId: invitation.invitation.id, channel: 'wechat' });
  const preview = await f.service.previewInvitations(f.input);
  assert.equal(preview.entries[0].eligible, false); assert.equal(preview.entries[0].reason, 'INVITATION_DISPATCH_RECORDED');
  assert.equal((await prepare(f.service, f.input, preview)).summary.skipped, 1);
  const second = f.contacts[1];
  const unknownService = createIntentInvitationService({ ...f.dependencies, emailProvider: { readiness: () => ({ ready: true }), send: async () => ({ status: 'unknown' }) } });
  await unknownService.issueInvitation({ actor, contactId: second.id, expectedContactRevision: f.input.expectedContactRevision,
    expectedRegistrationId: f.receipts.get(second.id).registrationId, channel: 'email', confirmEmail: true });
  const unknownPreview = await f.service.previewInvitations(f.input);
  assert.equal(unknownPreview.entries[1].reason, 'INVITATION_STATUS_UNKNOWN');
});

test('unknown durable preparation ACK returns every person and stops later writes; explicit replay safely reads committed outcomes', async () => {
  const f = await fixture(), preview = await f.service.previewInvitations(f.input);
  let writes = 0;
  const interrupted = createIntentInvitationService({ ...f.dependencies, repository: {
    read: () => f.repository.read(), async commit(cursor, value) { const ack = await f.repository.commit(cursor, value); if (++writes === 2) throw failure(); return ack; },
  } });
  const partial = await prepare(interrupted, f.input, preview);
  assert.deepEqual(partial.results.map(item => item.status), ['prepared', 'unknown', 'failed']);
  assert.equal(partial.results[2].code, 'BATCH_NOT_ATTEMPTED'); assert.equal(writes, 2); assert.equal(partial.status, 'partial');
  assert.equal((await f.repository.read()).value.invitations.length, 2);
  const replay = await prepare(f.service, f.input, preview);
  assert.deepEqual(replay.results.map(item => item.status), ['replayed', 'replayed', 'prepared']); assert.equal(f.providerCalls(), 0);
});

test('bounded selection and loss of role are rejected before preparation; known individual failure remains an explicit partial result', async () => {
  const f = await fixture();
  for (const contactIds of [[], [f.contacts[0].id, f.contacts[0].id], Array.from({ length: 101 }, (_, index) => 'c_' + index)]) {
    await assert.rejects(f.service.previewInvitations({ ...f.input, contactIds }), { code: 'INVALID_INPUT' });
  }
  await assert.rejects(f.service.previewInvitations({ ...f.input, actor: { ...actor, roles: ['editor'] } }), { code: 'FORBIDDEN' });
  let writes = 0;
  const operations = createInvitationBatchOperations({ authorize: value => value,
    inspect: async input => ({ contactRevision: input.expectedContactRevision, entries: input.contactIds.map(contactId => ({ contactId, eligible: true, registrationId: 'r_' + contactId })), bindings: input.contactIds }),
    issueManual: async input => { writes++; if (writes === 2) throw failure('REGISTRATION_WAITLISTED', 409);
      return { contactRevision: 1, replayed: false, invitation: { registrationId: input.expectedRegistrationId, channel: 'manual', status: 'prepared' } }; },
  });
  const input = { actor, contactIds: ['a', 'b', 'c'], expectedContactRevision: 1 }, preview = await operations.preview(input);
  const result = await operations.prepare({ ...input, previewToken: preview.previewToken, confirmPrepare: true });
  assert.deepEqual(result.results.map(item => item.status), ['prepared', 'failed', 'prepared']); assert.equal(writes, 3);
});

test('HTTP batch routes enforce private origin, CSRF and exact payload fields; no bulk email channel exists', async () => {
  const f = await fixture(), csrf = 'synthetic-batch-csrf-token-value-12345';
  const api = createIntentInvitationApi({ service: f.service, authenticate: async () => ({ user: actor, csrfToken: csrf }) });
  const request = (path, body, headers = {}) => new Request('https://api.artdico.host' + path, { method: 'POST',
    headers: { origin: 'https://api.artdico.host', 'content-type': 'application/json', 'x-csrf-token': csrf, ...headers }, body: JSON.stringify(body) });
  const input = { contactIds: f.input.contactIds, expectedContactRevision: f.input.expectedContactRevision };
  const previewResponse = await api(request('/api/admin/contacts/invitations/preview', input));
  assert.equal(previewResponse.status, 200); assert.equal(previewResponse.headers.get('cache-control'), 'no-store');
  const preview = await previewResponse.json();
  assert.equal((await api(request('/api/admin/contacts/invitations/prepare-batch', { ...input, previewToken: preview.previewToken, confirmPrepare: true, channel: 'email' }))).status, 400);
  assert.equal((await api(request('/api/admin/contacts/invitations/preview', input, { origin: 'https://artdico.host' }))).status, 403);
  assert.equal((await api(request('/api/admin/contacts/invitations/preview', input, { 'x-csrf-token': 'wrong' }))).status, 403);
  const prepared = await api(request('/api/admin/contacts/invitations/prepare-batch', { ...input, previewToken: preview.previewToken, confirmPrepare: true }));
  assert.equal(prepared.status, 200); assert.equal((await prepared.json()).summary.prepared, 3); assert.equal(f.providerCalls(), 0);
});

test('HTTP accepts only the exact optional manual poster version and keeps version-specific preview binding', async () => {
  const f = await fixture(['consented']), csrf = 'synthetic-version-csrf';
  const api = createIntentInvitationApi({ service: f.service, authenticate: async () => ({ user: actor, csrfToken: csrf }) });
  const request = (path, body) => new Request('https://api.artdico.host' + path, { method: 'POST',
    headers: { origin: 'https://api.artdico.host', 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify(body) });
  const input = { contactIds: f.input.contactIds, expectedContactRevision: f.input.expectedContactRevision, renderVersion: INVITATION_POSTER_RENDER_VERSION };
  const response = await api(request('/api/admin/contacts/invitations/preview', input)); assert.equal(response.status, 200);
  const preview = await response.json();
  const prepared = await api(request('/api/admin/contacts/invitations/prepare-batch', { ...input, previewToken: preview.previewToken, confirmPrepare: true }));
  assert.equal(prepared.status, 200); assert.equal((await prepared.json()).results[0].invitation.content.settings.renderVersion, INVITATION_POSTER_RENDER_VERSION);
  for (const renderVersion of [2, '2', null, 'unknown']) assert.equal((await api(request('/api/admin/contacts/invitations/preview', { ...input, renderVersion }))).status, 400);
  const path = '/api/admin/contacts/' + f.contacts[0].id + '/invitation', individual = { expectedContactRevision: f.input.expectedContactRevision,
    expectedRegistrationId: f.receipts.get(f.contacts[0].id).registrationId, channel: 'manual', renderVersion: INVITATION_POSTER_RENDER_VERSION };
  assert.equal((await api(request(path, individual))).status, 200);
  assert.equal((await api(request(path, { ...individual, channel: 'email', confirmEmail: true }))).status, 400);
  assert.equal(f.providerCalls(), 0);
});

test('per-person admission or consent changes after preview cannot reserve a confirmed invitation', async () => {
  const f = await fixture(['consented']), preview = await f.service.previewInvitations(f.input);
  let reads = 0;
  const waiting = createIntentInvitationService({ ...f.dependencies, getAdmissionStatus: async () => ({ status: ++reads >= 2 ? 'waitlisted' : 'confirmed', revision: 1 }) });
  const result = await prepare(waiting, f.input, preview);
  assert.equal(result.results[0].status, 'failed'); assert.equal(result.results[0].code, 'REGISTRATION_WAITLISTED');
  assert.equal((await f.repository.read()).value.invitations.length, 0);
  reads = 0;
  const consentChanged = createIntentInvitationService({ ...f.dependencies, contactsStore: { ...f.contactsStore, read: async () => {
    const roster = await f.contactsStore.read();
    if (++reads >= 2) { roster.revision++; roster.contacts[0].operations.responseStatus = 'declined'; }
    return roster;
  } } });
  const stopped = await prepare(consentChanged, f.input, preview);
  assert.equal(stopped.results[0].code, 'REVISION_CONFLICT'); assert.equal((await f.repository.read()).value.invitations.length, 0);
});

test('strict batch audit rejects arbitrary metadata while legacy individual preparation remains readable', async () => {
  const f = await fixture(['consented']), preview = await f.service.previewInvitations(f.input);
  await prepare(f.service, f.input, preview);
  const state = await f.repository.read();
  state.value.audit.at(-1).batchId = 'arbitrary-unbound-metadata';
  await assert.rejects(f.repository.commit(state.cursor, state.value), { code: 'STORAGE_UNAVAILABLE' });
  const legacy = await f.repository.read(); delete legacy.value.audit.at(-1).batchId;
  const unchecked = createIntentInvitationRepository({ journal: { read: async () => legacy, commit: async () => { throw Error('not used'); } } });
  assert.equal((await unchecked.read()).value.invitations.length, 1);
});

test('exactly 100 unique selections are processed once each in bounded order', async () => {
  const ids = Array.from({ length: 100 }, (_, index) => 'c_synthetic_' + index), calls = [];
  const operations = createInvitationBatchOperations({ authorize: value => value,
    inspect: async input => ({ contactRevision: input.expectedContactRevision,
      entries: input.contactIds.map(contactId => ({ contactId, eligible: true, registrationId: 'r_' + contactId })), bindings: input.contactIds }),
    issueManual: async input => { calls.push(input.contactId); return { contactRevision: 1, replayed: false,
      invitation: { registrationId: input.expectedRegistrationId, channel: 'manual', status: 'prepared' } }; },
  });
  const input = { actor, contactIds: ids, expectedContactRevision: 1 }, preview = await operations.preview(input);
  const result = await operations.prepare({ ...input, previewToken: preview.previewToken, confirmPrepare: true });
  assert.equal(result.summary.prepared, 100); assert.deepEqual(calls, ids); assert.deepEqual(result.results.map(item => item.contactId), ids);
});
