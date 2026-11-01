import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';
import { createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { personNextAction, personWorkspaceView } from '../src/lib/person-workspace.mjs';

const prefix = '/api/admin/registration-confirmation/', operation = () => randomBytes(24).toString('base64url');
async function json(response, status = 200) { const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value; }
const post = (f, headers, path, body, app = f.app) => app.handle(f.request(prefix + path, { method: 'POST', headers, body }));
const preview = (f, headers, body = {}, app = f.app) => post(f, headers, 'preview', body, app).then(json);
const lookup = (f, headers, id, app = f.app) => app.handle(f.request(prefix + 'operation/' + id, { headers }));
const business = call => /^cms\/v1\/(?:registrations|registration-confirmations|registration-reviews|contacts|content)\//u.test(call.key);
async function converted(f, profile = {}) {
  const contact = (await f.createContact(profile)).contact;
  const result = await f.app.intentService.convertContacts({ actor: f.users[0], contactIds: [contact.id],
    expectedContactRevision: (await f.app.contactsStore.read()).revision, permissionReference: '合成历史本人明确参会及联系授权' });
  return { id: result.registrations[0].registrationId, contact };
}
const repoFor = f => createConfirmationRepository({ eventId: PEOPLE_FIXTURE_EVENT,
  journal: createObjectJournal({ objects: f.objects, prefix: f.app.confirmationService.prefix }), clock: () => Date.parse('2026-10-21T09:00:00Z') });

test('actual runtime named formal preview and original operation GET preserve manual dispatch identity across a lost client acknowledgement', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login(), person = await converted(f);
  const start = f.objects.calls.length, list = await preview(f, headers);
  assert.equal(list.kind, 'registration'); assert.match(list.sourceRevision, /^[a-f0-9]{64}$/u);
  assert.equal(list.rows.length, 1); assert.equal(list.rows[0].registrationId, person.id);
  assert.equal(list.rows[0].name, person.contact.profile.name); assert.equal(list.rows[0].organization, person.contact.profile.organization);
  assert.equal(list.rows[0].eligible, true); assert.equal(list.rows[0].status, 'not_sent');
  assert.ok(f.objects.calls.slice(start).every(call => call.operation === 'get')); assert.equal(f.messages.length, 0);
  assert.doesNotMatch(JSON.stringify(list), /@example.invalid|receiptToken|confirmationUrl|relatedRegistrationIds|#r=/u);
  const body = { expectedRevision: list.revision, operationId: operation(), registrationIds: [person.id], retryRejected: false };
  const original = JSON.stringify(body), sent = await post(f, headers, 'dispatch', body);
  assert.equal(sent.status, 200); await sent.body.cancel(); // Client never receives its response body.
  assert.equal(f.messages.length, 1);
  const restarted = f.make(), before = f.objects.calls.length, found = await json(await lookup(f, headers, body.operationId, restarted));
  assert.equal(found.operationId, body.operationId); assert.equal(found.kind, 'registration'); assert.equal(found.status, 'completed');
  assert.equal(found.checkedAt, '2026-10-21T09:00:00.000Z');
  assert.deepEqual(found.results, [{ registrationId: person.id, status: 'provider_accepted' }]);
  assert.equal(JSON.stringify(body), original); assert.equal(f.messages.length, 1);
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
  assert.ok(f.objects.calls.slice(before).filter(business).every(call => call.key.startsWith('cms/v1/registration-confirmations/')),
    'operation GET reads no registration, contact, current publication, or provider source');
  assert.equal((await preview(f, headers, {}, restarted)).rows[0].reason, 'ALREADY_ACCEPTED');
});

test('actual runtime unknown formal provider result stays unknown on repeated read-only lookup after restart', async () => {
  const f = await peopleRuntimeFixture({ mail: true, mailResult: 'unknown' }), headers = await f.login(), person = await converted(f);
  const list = await preview(f, headers), command = { expectedRevision: list.revision, operationId: operation(), registrationIds: [person.id] };
  const sent = await json(await post(f, headers, 'dispatch', command)); assert.equal(sent.status, 'partial'); assert.equal(sent.results[0].status, 'unknown');
  const before = f.objects.calls.length;
  for (let i = 0; i < 3; i++) {
    const found = await json(await lookup(f, headers, command.operationId, f.make()));
    assert.equal(found.status, 'partial'); assert.deepEqual(found.results, sent.results);
  }
  assert.equal(f.messages.length, 1); assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
});

test('actual canonical alias preview and delivery block an unfinished formal batch with no notice, without inventing its nonce for other reads', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login(), a = await converted(f), b = await converted(f);
  const keys = ['contact:' + a.contact.id, 'contact:' + b.contact.id];
  const proposal = await json(await f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers, body: { action: 'preview', keys } })));
  const merged = await json(await f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers, body: {
    action: 'merge', keys: proposal.keys, primaryKey: proposal.primaryKey, roles: proposal.roles, expectedRevision: proposal.expectedRevision,
    expectedContactRevision: proposal.expectedContactRevision, operationId: operation(), confirmSamePerson: true } })));
  const ids = merged.person.registrationIds, primary = merged.person.primaryRegistrationId, alias = ids.find(id => id !== primary);
  const repo = repoFor(f), op = operation();
  await repo.append(await repo.read(), 'dispatch_started', { operationId: op, requestHash: 'a'.repeat(64), registrationIds: [alias], retryRejected: false }, f.users[0].id);
  const restarted = f.make(), before = f.objects.calls.length, list = await preview(f, headers, {}, restarted);
  assert.equal(list.total, 1); assert.equal(list.rows[0].registrationId, primary); assert.equal(list.rows[0].status, 'unknown');
  assert.equal(list.rows[0].reason, 'DELIVERY_UNKNOWN'); assert.equal(list.rows[0].eligible, false);
  const delivery = await json(await restarted.handle(f.request(prefix + 'delivery/' + primary, { headers })));
  assert.equal(delivery.status, 'unknown'); assert.equal(delivery.reason, 'DELIVERY_UNKNOWN'); assert.equal(delivery.ready, false);
  assert.equal(Object.hasOwn(delivery, 'operationId'), false); assert.equal(Object.hasOwn(delivery, 'checkedAt'), false);
  const found = await json(await lookup(f, headers, op, restarted));
  assert.equal(found.status, 'unknown'); assert.deepEqual(found.results, [{ registrationId: alias, status: 'unknown' }]);
  assert.deepEqual((await restarted.confirmationService.staffHistory({ actor: f.users[0], registrationId: primary, relatedRegistrationIds: ids })).notices, []);
  const person = await json(await restarted.handle(f.request('/api/admin/people/registrations/' + primary, { headers })));
  assert.equal(person.communications.unresolvedConfirmations, true); assert.equal(person.communications.confirmationTotal, 0);
  assert.deepEqual(person.communications.confirmations, []); assert.deepEqual(person.communications.timeline, []);
  assert.equal(personNextAction(personWorkspaceView(person, person.selected), f.users[0].roles).key, 'check', 'cloud-only recovery blocks Next without a local nonce');
  const directory = await json(await restarted.handle(f.request('/api/admin/people/directory', { headers })));
  const listed = directory.rows.find(row => row.registrationId === primary);
  assert.equal(listed.deliveryStatus, 'unknown'); assert.equal(listed.nextAction.key, 'check');
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get')); assert.equal(f.messages.length, 0);
});

test('automatic formal notices without a manual operation remain visible only through delivery/history and cannot become a made-up operation', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login(), receipt = await f.seedPublic({ intake: 'general-v2' });
  await f.approvePublic(receipt.reference_code, { headers }); assert.equal(f.messages.length, 2);
  const history = await f.app.confirmationService.staffHistory({ actor: f.users[0], registrationId: receipt.reference_code });
  assert.equal(history.notices.length, 1); assert.equal(history.notices[0].status, 'provider_accepted');
  assert.equal(Object.hasOwn(history.notices[0], 'operationId'), false);
  const before = f.objects.calls.length;
  await json(await lookup(f, headers, history.notices[0].id), 404);
  const state = await json(await f.app.handle(f.request(prefix + 'delivery/' + receipt.reference_code, { headers })));
  assert.equal(state.status, 'provider_accepted'); assert.equal(state.ready, false);
  assert.equal(Object.hasOwn(state, 'operationId'), false); assert.equal(f.messages.length, 2);
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
});

test('actual formal preview has bounded page reads and invalidates changed source revisions without touching reminder cursor compatibility', async () => {
  const f = await peopleRuntimeFixture({ capacity: 300 });
  for (let i = 0; i < 105; i++) await f.app.registrationService.addStaffMember({ actor: f.users[0], expectedRevision: i, operationId: operation(),
    input: { kind: 'attendee', permissionReference: '合成有界名单授权', fields: { name: '合成人员 ' + i, email: 'synthetic.' + i + '@example.invalid', organization: '合成机构',
      city: '', position: '', categories: ['industry'], participationInterests: ['attend'], background: '', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' } } });
  const headers = await f.login(), start = f.objects.calls.length, first = await preview(f, headers), reads = f.objects.calls.slice(start);
  assert.equal(first.total, 105); assert.equal(first.rows.length, 100);
  assert.ok(reads.every(call => call.operation === 'get'));
  assert.ok(reads.filter(call => call.key.startsWith('cms/v1/registrations/' + PEOPLE_FIXTURE_EVENT + '/index/')).length <= 3,
    'page reads one shared registration index, not one full index per person');
  const last = await preview(f, headers, { cursor: first.nextCursor }); assert.equal(last.rows.length, 5); assert.equal(last.nextCursor, null);
  const reminder = await json(await post(f, headers, 'reminder-preview', {}));
  await json(await post(f, headers, 'preview', { cursor: reminder.nextCursor }), 400);
  await json(await post(f, headers, 'reminder-preview', { cursor: first.nextCursor }), 400);
  await f.createContact({ name: '合成来源修订' });
  await json(await post(f, headers, 'preview', { cursor: first.nextCursor }), 409);
  assert.equal(f.messages.length, 0);
});

test('new actual runtime routes enforce roles, Origin, CSRF and unavailable-source failure before any business writes or mail', async () => {
  const f = await peopleRuntimeFixture();
  for (const user of ['reviewer', 'outreach', 'combined', 'editor']) {
    const headers = await f.login(user), start = f.objects.calls.length;
    await json(await post(f, headers, 'preview', {}), 403); await json(await lookup(f, headers, operation()), 403);
    assert.equal(f.objects.calls.slice(start).some(business), false);
  }
  const headers = await f.login(), start = f.objects.calls.length;
  await json(await post(f, { Cookie: headers.Cookie }, 'preview', {}), 403);
  await json(await f.app.handle(f.request(prefix + 'preview', { method: 'POST', headers, origin: PEOPLE_FIXTURE_PUBLIC, body: {} })), 403);
  assert.equal(f.objects.calls.slice(start).some(business), false);
  const unavailable = f.make({ objects: { ...f.objects, get: (key, options) => {
    if (key.startsWith('cms/v1/registration-confirmations/') || key.startsWith('cms/v1/contacts/')) throw new Error('SYNTHETIC_PRIVATE_UNAVAILABLE');
    return f.objects.get(key, options);
  } } });
  await json(await post(f, headers, 'preview', {}, unavailable), 503);
  await json(await lookup(f, headers, operation(), unavailable), 503);
  assert.ok(f.objects.calls.slice(start).every(call => call.operation === 'get')); assert.equal(f.messages.length, 0);
});
