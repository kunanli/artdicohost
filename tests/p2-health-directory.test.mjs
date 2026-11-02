import test from 'node:test';
import assert from 'node:assert/strict';
import {peopleRuntimeFixture, PEOPLE_FIXTURE_PRIVATE} from './helpers/people-runtime-fixture.mjs';
import {createPersonWorkspaceApi} from '../functions/person-workspace/handler.mjs';
import {peopleHealthProjection, peopleDuplicateCandidates, peopleDirectoryProjection, peopleDirectoryWork, personSourceProjection} from '../functions/person-workspace/projection.mjs';
import {validatePeopleDirectory, validatePeopleHealth} from '../src/lib/people-directory.mjs';
import {personSourceView} from '../src/lib/person-workspace.mjs';
const ROOT = '/api/admin/people/';
async function get(f, path, headers) { const response = await f.app.handle(f.request(ROOT + path, {headers})); return {response, body: await response.json()}; }
const writes = f => f.objects.calls.filter(call => call.operation !== 'get').length;
async function sources(f) {
  const contacts = await f.app.contactsStore.read(), raw = await f.app.registrationService.repository.list(), admissions = await f.app.registrationService.getAdmissions({actor: f.users[0]}), content = await f.app.store.read(), intent = await f.app.intentService.read({actor: f.users[0]});
  const registrations = {revision: 0, applicationRevision: raw.revision, registrations: raw.registrations.map(row => ({...row, inactive: false, review: {status: 'new', accommodationStatus: row.fields.accommodationChoice === 'needed' ? 'requested' : 'not_requested'}}))};
  return Object.fromEntries(Object.entries({contacts, registrations, admissions, invitations: intent, content: {...content.draft, published: content.published}}).map(([key, value]) => [key, {state: 'available', value}]));
}

test('pending/work filtering occurs before pagination and binds cursors to the work filter', async () => {
  const f = await peopleRuntimeFixture({capacity: 20}), done = await f.createContact({name: 'A 合成结束'});
  await f.app.contactsStore.saveOperations(done.contact.id, done.revision, {...done.contact.operations, responseStatus: 'declined'}, f.users[0].id);
  await f.createContact({name: 'Y 合成待回复'}); await f.createContact({name: 'Z 合成待回复'});
  const headers = await f.login(), before = writes(f);
  const selected = await get(f, 'directory?work=reply&limit=1', headers);
  assert.equal(selected.response.status, 200); assert.equal(validatePeopleDirectory(selected.body, 'all'), true);
  assert.equal(selected.body.total, 2); assert.match(selected.body.rows[0].name, /Y /u); assert.equal(selected.body.rows[0].nextAction.key, 'reply');
  const invalidBasis = structuredClone(selected.body); invalidBasis.rows[0].basisRevisions.delivery = 'private';
  assert.equal(validatePeopleDirectory(invalidBasis, 'all'), false);
  assert.ok(selected.body.nextCursor);
  const stale = await get(f, 'directory?work=all&limit=1&cursor=' + selected.body.nextCursor, headers);
  assert.equal(stale.response.status, 409);
  assert.equal((await get(f, 'directory?work=pending', headers)).body.total, 2);
  assert.equal((await get(f, 'directory?work=all', headers)).body.total, 3);
  assert.equal(writes(f), before); assert.equal(f.messages.length, 0);
});

test('duplicate candidates stay manual and neither directory nor health reveals matching values', async () => {
  const f = await peopleRuntimeFixture(), contact = await f.createContact({name: '合成人员甲', email: 'shared@example.invalid'});
  await f.seedPublic({intake: 'general-v2', name: '合成人员乙', email: 'shared@example.invalid'});
  const headers = await f.login(), outreachHeaders = await f.login('outreach'), before = writes(f), original = await f.app.registrationService.getAdmissions({actor: f.users[0]});
  const directory = await get(f, 'directory?work=duplicate&limit=1', headers), health = await get(f, 'health?kind=duplicate', headers);
  assert.equal(directory.response.status, 200); assert.equal(directory.body.total, 2); assert.equal(directory.body.rows[0].nextAction.key, 'duplicate');
  assert.equal(health.response.status, 200); assert.equal(validatePeopleHealth(health.body), true); assert.equal(health.body.counts.duplicate, 1);
  const externalLink = structuredClone(health.body); externalLink.issues[0].href = 'https://example.invalid/private-capability';
  assert.equal(validatePeopleHealth(externalLink), false);
  assert.equal(health.body.issues[0].reasonCode, 'POSSIBLE_DUPLICATE');
  assert.doesNotMatch(JSON.stringify([directory.body, health.body]), /shared@example|SYNTHETIC_ORIGINAL|private-key|receiptToken|permissionReference/u);
  assert.equal((await get(f, 'directory?work=duplicate', outreachHeaders)).response.status, 403);
  assert.deepEqual(await f.app.registrationService.getAdmissions({actor: f.users[0]}), original); assert.equal(writes(f), before);
  assert.equal(f.messages.length, 0); assert.ok(contact.contact.id);
});

test('health/source permissions and malformed queries fail before private loaders', async () => {
  let reads = 0;
  const load = async () => { reads++; assert.fail('unauthorized or malformed reads must not load a source'); };
  for (const roles of [[], ['editor'], ['outreach'], ['reviewer'], ['outreach', 'reviewer']]) {
    const handle = createPersonWorkspaceApi({authenticate: async () => ({user: {id: 'synthetic-reader', roles}}), loadContacts: load, loadHealthRegistrations: load, loadIntent: load, loadAdmissions: load, loadContent: load});
    assert.equal((await handle(new Request('https://api.artdico.host' + ROOT + 'health'))).status, 403);
    if (!roles.includes('outreach')) assert.equal((await handle(new Request('https://api.artdico.host' + ROOT + 'contacts/test/source'))).status, 403);
  }
  const handle = createPersonWorkspaceApi({authenticate: async () => ({user: {id: 'synthetic-owner', roles: ['superadmin']}}), loadContacts: load});
  for (const query of ['?limit=201', '?kind=nope', '?kind=duplicate&kind=lodging', '?query=private']) assert.equal((await handle(new Request('https://api.artdico.host' + ROOT + 'health' + query))).status, 400);
  assert.equal((await handle(new Request('https://api.artdico.host' + ROOT + 'health', {method: 'POST'}))).status, 405);
  assert.equal(reads, 0);
});

test('source-on-demand returns one immutable answer set without another person or system metadata', async () => {
  const f = await peopleRuntimeFixture(), saved = await f.createContact({name: '原始合成姓名', background: '原始合成经历'});
  await f.createContact({name: 'OTHER_PRIVATE_PERSON', background: 'OTHER_PRIVATE_ANSWER'});
  const current = await f.app.contactsStore.read(), contact = current.contacts.find(row => row.id === saved.contact.id);
  await f.app.contactsStore.saveProfile(contact.id, current.revision, {name: '当前更正姓名', background: '当前更正经历'}, f.users[0].id);
  const headers = await f.login('outreach'), before = writes(f), result = await get(f, 'contacts/' + contact.id + '/source', headers);
  assert.equal(result.response.status, 200); assert.ok(personSourceView(result.body, contact.id));
  assert.equal(result.body.snapshot, 'preserved'); assert.equal(result.body.fields.find(row => row.label === '姓名').value, '原始合成姓名');
  assert.equal(result.body.fields.find(row => row.label === '背景与经历').value, '原始合成经历');
  assert.match(result.body.fields.find(row => row.label === '原住宿需求').value, /原问卷未填写/u);
  assert.doesNotMatch(JSON.stringify(result.body), /OTHER_PRIVATE|当前更正|sourceProfileDigest|generatedAt|sentAt|receiptToken|private-key|permissionReference/u);
  assert.equal(writes(f), before); assert.equal(f.messages.length, 0);
});

test('partial source failure and mixed source revisions are unavailable rather than zero findings', async () => {
  const f = await peopleRuntimeFixture(), data = await sources(f);
  data.contacts = {state: 'unavailable'};
  const result = peopleHealthProjection(data);
  assert.equal(validatePeopleHealth(result), true); assert.equal(result.availability.contacts, 'unavailable'); assert.equal(result.counts.lodging, null); assert.equal(result.counts.duplicate, null); assert.equal(result.total, null);
  assert.equal(result.counts.legacy_work, 0, 'independently available content can still be checked');
  const mixed = await sources(f); mixed.registrations.value.applicationRevision++;
  const changed = peopleHealthProjection(mixed);
  assert.equal(changed.availability.registrations, 'unavailable'); assert.equal(changed.availability.admissions, 'unavailable'); assert.equal(changed.counts.duplicate, null);
});

test('unpublished public profiles need publication regardless of attendance and private profiles remain excluded', async () => {
  const f = await peopleRuntimeFixture(), saved = await f.createContact(), data = await sources(f);
  const contact = data.contacts.value.contacts.find(row => row.id === saved.contact.id);
  data.content.value.content.guests = [{id: 'synthetic-public-guest', name: '合成公开嘉宾', company: '', ggjRole: '',
    portraitId: '', status: 'pending', publicConsent: false, contactId: contact.id, internalNotes: PEOPLE_FIXTURE_PRIVATE}];
  const guest = data.content.value.content.guests[0], beforeWrites = writes(f);
  for (const responseStatus of ['pending', 'declined', 'attending']) {
    contact.operations.responseStatus = responseStatus;
    for (const visibility of [undefined, 'public', 'private']) {
      if (visibility === undefined) delete guest.visibility; else guest.visibility = visibility;
      const before = structuredClone(data), health = peopleHealthProjection(data, {kind: 'publication'});
      assert.equal(health.counts.publication, visibility === 'private' ? 0 : 1);
      assert.deepEqual(health.issues.map(row => row.reasonCode), visibility === 'private' ? [] : ['PUBLIC_PROFILE_CHANGED']);
      assert.deepEqual(data, before, 'checking publication does not change a reply, profile or publication');
      assert.doesNotMatch(JSON.stringify(health), /SYNTHETIC_ORIGINAL|internalNotes|confirmedGuestIds/u);
    }
  }
  assert.equal(writes(f), beforeWrites); assert.equal(f.messages.length, 0);
});

test('historical lodging and immutable source email survive a newer sparse application and another primary alias', async () => {
  const f = await peopleRuntimeFixture(), original = await f.createContact({name: '原来源', email: 'original@example.invalid'}), alias = await f.createContact({name: '别名来源', email: 'immutable@example.invalid'});
  const submitted = await f.seedPublic({intake: 'general-v2', name: '合成报名', email: 'immutable@example.invalid'}), data = await sources(f);
  const record = data.registrations.value.registrations.find(row => row.id === submitted.reference_code);
  const originalContact = data.contacts.value.contacts.find(row => row.id === original.contact.id);
  originalContact.profile.accommodationIntent = originalContact.sourceProfile.accommodationIntent = 'needed';
  record.provenance = {kind: 'staff_assisted', sourceContactId: original.contact.id};
  data.admissions.value.personGroups = [{id: 'p_' + 'a'.repeat(32), primaryKey: 'contact:' + alias.contact.id, contactIds: [original.contact.id, alias.contact.id], registrationIds: [record.id], primaryContactId: alias.contact.id, primaryRegistrationId: record.id, roles: ['attendee']}];
  const before = structuredClone(data), result = peopleHealthProjection(data);
  assert.equal(result.counts.email_mismatch, 1, 'another primary contact matching the email cannot bypass the immutable source');
  assert.equal(result.counts.lodging, 1, 'a missing new-form question does not clear the original lodging need');
  assert.equal(result.counts.attending_unintegrated, 0, 'existing canonical pending application is not new intake');
  assert.equal(record.review.accommodationStatus, 'not_requested'); assert.deepEqual(data, before);
  assert.doesNotMatch(JSON.stringify(result), /original@example|immutable@example|SYNTHETIC_ORIGINAL/u);
});

test('candidate calculation suppresses explicit canonical aliases without merging unrelated matches', () => {
  const rows = [{key: 'contact:a', name: '合成甲', organization: '合成组织', email: 'same@example.invalid', source: '意向'}, {key: 'registration:b', name: '合成乙', organization: '', email: 'same@example.invalid', source: '申请'}];
  assert.equal(peopleDuplicateCandidates(rows, row => row.key).candidates.length, 1);
  assert.equal(peopleDuplicateCandidates(rows, () => 'explicit-person').candidates.length, 0);
  assert.equal(rows.length, 2);
});

test('older unresolved delivery remains the next action despite a newer prepared invitation or accepted notice', async () => {
  const f = await peopleRuntimeFixture(), saved = await f.createContact();
  await f.app.intentService.convertContacts({actor: f.users[0], contactIds: [saved.contact.id], expectedContactRevision: saved.revision, permissionReference: 'synthetic prior permission'});
  const data = await sources(f), link = data.invitations.value.conversions[0];
  data.invitations.value.invitations = [
    {id: 'older-unknown', sourceContactId: saved.contact.id, registrationId: link.registrationId, channel: 'email', status: 'unknown', createdAt: '2026-10-21T08:00:00.000Z', updatedAt: '2026-10-21T08:00:00.000Z'},
    {id: 'newer-prepared', sourceContactId: saved.contact.id, registrationId: link.registrationId, channel: 'manual', status: 'prepared', createdAt: '2026-10-21T09:00:00.000Z', updatedAt: '2026-10-21T09:00:00.000Z'}];
  const input = {permissions: {contact: true, registration: true}, roster: data.contacts.value, intent: data.invitations.value, registrationDirectory: data.registrations.value,
    admissions: data.admissions.value, content: data.content.value, deliveries: {revision: 2, notices: [{registrationId: link.registrationId, status: 'unknown'}, {registrationId: link.registrationId, status: 'provider_accepted'}]}};
  const directory = peopleDirectoryProjection(input);
  peopleDirectoryWork(directory, {actor: f.users[0], ...input, revisions: {contacts: 1, registration: 0, applications: 1, admissions: 1, invitations: 0, delivery: 2, content: 0, publishedContent: null}});
  assert.equal(directory.people[0].invitationStatus, 'unknown'); assert.equal(directory.people[0].deliveryStatus, 'unknown');
  assert.equal(directory.people[0].nextAction.key, 'check'); assert.equal(directory.people[0].nextAction.label, '核对结果');
});

test('legacy source is explicitly unverified and cannot produce a zero original-lodging finding', async () => {
  const f = await peopleRuntimeFixture(), saved = await f.createContact(), data = await sources(f), legacy = data.contacts.value.contacts[0];
  delete legacy.sourceProfile; delete legacy.sourceProfileDigest;
  legacy.profile.accommodationIntent = 'needed';
  const selected = personSourceProjection(legacy, data.contacts.value.revision);
  assert.equal(selected.snapshot, 'legacy'); assert.ok(selected.fields.some(row => row.label === '旧记录住宿需求'));
  assert.equal(selected.fields.some(row => row.label === '原住宿需求'), false); assert.ok(personSourceView(selected, saved.contact.id));
  const health = peopleHealthProjection(data);
  assert.equal(health.counts.lodging, null); assert.equal(health.total, null);
  assert.ok(health.issues.some(row => row.reasonCode === 'LEGACY_LODGING_SOURCE'));
});

test('bounded health findings disclose truncation and malformed source states are not empty', async () => {
  const f = await peopleRuntimeFixture(), data = await sources(f);
  data.content.value.content.showcases = Array.from({length: 3}, (_, i) => ({id: 'legacy-' + i, kind: 'team', title: '合成作品 ' + i}));
  const health = peopleHealthProjection(data, {kind: 'legacy_work', limit: 1});
  assert.equal(health.issues.length, 1); assert.equal(health.counts.legacy_work, 3); assert.equal(health.total, 3); assert.equal(health.truncated, true);
  data.admissions.value.people = [{registrationId: 'a'.repeat(43), status: 'invented'}];
  const failed = peopleHealthProjection(data);
  assert.equal(failed.availability.admissions, 'unavailable'); assert.equal(failed.counts.duplicate, null); assert.equal(failed.total, null);
});
