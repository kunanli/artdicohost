import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {fixture, CONTACT, REGISTRATION, OTHER_REGISTRATION, AT} from './person-workspace-fixture.mjs';
import {peopleRuntimeFixture} from './helpers/people-runtime-fixture.mjs';
import {peopleDirectoryProjection, peopleDirectoryWork} from '../functions/person-workspace/projection.mjs';
import {personWorkspaceView, personNextAction} from '../src/lib/person-workspace.mjs';
import {createObjectJournal} from '../functions/cloud-content/object-journal.mjs';
import {createConfirmationRepository} from '../functions/registration-confirmation/repository.mjs';
const group = (contactIds, registrationIds = [REGISTRATION]) => ({id: 'p_' + 'a'.repeat(32), contactIds, registrationIds,
  primaryContactId: contactIds[0], primaryRegistrationId: registrationIds[0], primaryKey: 'contact:' + contactIds[0], roles: ['attendee']});
const invitation = (id, contactId, status, registrationId = REGISTRATION, at = AT) => ({id, sourceContactId: contactId, registrationId,
  channel: status === 'prepared' ? 'manual' : 'email', status, createdAt: at, updatedAt: at, sentChannel: null});

test('explicit canonical aliases retain unresolved invitation history, but equal unmerged email does not join it', async () => {
  const f = fixture(), alias = structuredClone(f.data.contacts.contacts[0]), unrelated = structuredClone(alias);
  alias.id = 'synthetic-alias'; alias.profile.wechat = 'ALIAS_PRIVATE_WECHAT';
  unrelated.id = 'synthetic-unrelated'; unrelated.profile.wechat = 'UNRELATED_PRIVATE_WECHAT';
  f.data.contacts.contacts.push(alias, unrelated);
  f.data.intent.personGroups = [group([CONTACT, alias.id])];
  f.data.intent.conversions.push({sourceContactId: alias.id, registrationId: REGISTRATION}, {sourceContactId: unrelated.id, registrationId: OTHER_REGISTRATION});
  f.data.intent.invitations = [invitation('primary-accepted', CONTACT, 'provider_accepted'), invitation('alias-accepted', alias.id, 'provider_accepted'), invitation('unrelated-unknown', unrelated.id, 'unknown', OTHER_REGISTRATION)];
  let result = await f.read(); assert.equal(result.response.status, 200);
  assert.equal(result.body.communications.unresolvedInvitations, false);
  assert.deepEqual(result.body.communications.invitations.map(item => item.id).sort(), ['alias-accepted', 'primary-accepted']);
  assert.notEqual(personNextAction(personWorkspaceView(result.body, result.body.selected), ['superadmin']).key, 'check');
  f.data.intent.invitations[1].status = 'unknown';
  result = await f.read(); assert.equal(result.response.status, 200);
  assert.equal(result.body.communications.unresolvedInvitations, true);
  assert.equal(personNextAction(personWorkspaceView(result.body, result.body.selected), ['superadmin']).label, '核对结果');
  assert.doesNotMatch(JSON.stringify(result.body.communications), /PRIVATE_WECHAT|receiptToken|confirmationUrl|permissionReference/u);

  const inputs = {permissions: {contact: true, registration: true}, roster: f.data.contacts, intent: f.data.intent,
    content: f.data.content, registrations: null, registrationDirectory: {revision: 1, applicationRevision: 12, registrations: [
      {id: REGISTRATION, fields: {name: '合成甲', organization: '合成机构', city: '深圳'}, provenance: {kind: 'staff_assisted', sourceContactId: CONTACT}, inactive: false},
      {id: OTHER_REGISTRATION, fields: {name: '合成另一人', organization: '', city: ''}, provenance: {kind: 'staff_assisted', sourceContactId: unrelated.id}, inactive: false}]},
    admissions: {revision: 12, people: [{registrationId: REGISTRATION, status: 'confirmed'}, {registrationId: OTHER_REGISTRATION, status: 'confirmed'}], personGroups: f.data.intent.personGroups},
    deliveries: {revision: 0, notices: []}};
  const rows = peopleDirectoryProjection(inputs);
  peopleDirectoryWork(rows, {actor: {id: 'synthetic-owner', roles: ['superadmin']}, ...inputs, revisions: {contacts: 3, invitations: 7, registration: 1, applications: 12, admissions: 12, content: 5, publishedContent: 4, delivery: 0}});
  assert.equal(rows.people.find(row => row.contactId === CONTACT).invitationStatus, 'unknown');
  assert.equal(rows.people.find(row => row.contactId === CONTACT).nextAction.label, '核对结果');
  assert.equal(rows.people.length, 2, 'unmerged equal-email source remains a separate person');
});

test('an unresolved notice outside the bounded history still blocks new next actions', async () => {
  const f = fixture();
  f.data.intent.invitations = [invitation('older-unknown', CONTACT, 'unknown', REGISTRATION, '2026-10-20T00:00:00.000Z'),
    ...Array.from({length: 200}, (_, i) => invitation('prepared-' + i, CONTACT, 'prepared'))];
  const {response, body} = await f.read(); assert.equal(response.status, 200);
  assert.equal(body.communications.historyTruncated, true); assert.equal(body.communications.invitationTotal, 201);
  assert.equal(body.communications.invitations.length, 200); assert.equal(body.communications.invitations.some(item => item.status === 'unknown'), false);
  assert.equal(body.communications.unresolvedInvitations, true);
  assert.equal(personNextAction(personWorkspaceView(body, body.selected), ['superadmin']).key, 'check');
  const legacy = structuredClone(body); delete legacy.communications.unresolvedInvitations; delete legacy.communications.unresolvedConfirmations;
  assert.equal(personNextAction(personWorkspaceView(legacy, legacy.selected), ['superadmin']).key, 'check', 'old truncated payload cannot prove the hidden history safe');
});

test('actual runtime reads canonical registration notice metadata in one history without borrowing unmerged matches', async () => {
  const f = await peopleRuntimeFixture({capacity: 5}), a = (await f.createContact({name: '合成甲', email: 'same@example.invalid'})).contact,
    b = (await f.createContact({name: '合成乙', email: 'same@example.invalid'})).contact, other = (await f.createContact({name: '合成其他', email: 'same@example.invalid'})).contact;
  const converted = await f.app.intentService.convertContacts({actor: f.users[0], contactIds: [a.id, b.id, other.id], expectedContactRevision: (await f.app.contactsStore.read()).revision, permissionReference: 'synthetic explicit original permission'});
  const ids = new Map(converted.registrations.map(row => [row.contactId ?? row.sourceContactId, row.registrationId]));
  // Conversion projection is keyed by contactId in this durable service.
  const index = await f.app.intentService.read({actor: f.users[0]});
  for (const row of index.conversions) ids.set(row.sourceContactId, row.registrationId);
  const repo = createConfirmationRepository({journal: createObjectJournal({objects: f.objects, prefix: 'cms/v1/registration-confirmations/ggj-cn-2026'}), eventId: 'ggj-cn-2026', clock: () => Date.parse(AT)});
  const noticeIds = new Map();
  for (const [contactId, status] of [[a.id, 'provider_accepted'], [b.id, 'unknown'], [other.id, 'unknown']]) {
    let state = await repo.read(); state = await repo.append(state, 'reserve', {registrationId: ids.get(contactId), kind: 'registration', admissionStatus: 'confirmed', admissionRevision: 3, retryRejected: false}, f.users[0].id);
    const notice = state.value.notices.find(row => row.registrationId === ids.get(contactId)); noticeIds.set(contactId, notice.id);
    await repo.append(state, 'result', {noticeId: notice.id, status}, f.users[0].id);
  }
  const headers = await f.login();
  const previewResponse = await f.app.handle(f.request('/api/admin/people/resolve', {method: 'POST', headers, body: {action: 'preview', keys: ['contact:' + a.id, 'contact:' + b.id]}}));
  const preview = await previewResponse.json(); assert.equal(previewResponse.status, 200);
  const merged = await f.app.handle(f.request('/api/admin/people/resolve', {method: 'POST', headers, body: {action: 'merge', keys: preview.keys, primaryKey: 'contact:' + a.id, roles: preview.roles,
    expectedRevision: preview.expectedRevision, expectedContactRevision: preview.expectedContactRevision, operationId: randomBytes(24).toString('base64url'), confirmSamePerson: true}}));
  assert.equal(merged.status, 200);
  const before = f.objects.calls.filter(call => call.operation !== 'get').length;
  const response = await f.app.handle(f.request('/api/admin/people/contacts/' + a.id, {headers})), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.communications.unresolvedConfirmations, true);
  assert.deepEqual(body.communications.confirmations.map(row => row.id).sort(), [noticeIds.get(a.id), noticeIds.get(b.id)].sort());
  assert.equal(body.communications.confirmations.some(row => row.id === noticeIds.get(other.id)), false);
  assert.equal(personNextAction(personWorkspaceView(body, body.selected), f.users[0].roles).label, '核对结果');
  const directory = await f.app.handle(f.request('/api/admin/people/directory', {headers})), listed = await directory.json();
  assert.equal(directory.status, 200); assert.equal(listed.rows.find(row => row.contactId === a.id).deliveryStatus, 'unknown');
  assert.equal(listed.rows.find(row => row.contactId === a.id).nextAction.label, '核对结果');
  assert.equal(f.objects.calls.filter(call => call.operation !== 'get').length, before); assert.equal(f.messages.length, 0);
});
