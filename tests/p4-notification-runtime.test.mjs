import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';
import { EDITABLE_CONTACT_FIELDS, EDITABLE_CONTACT_ARRAY_FIELDS } from '../shared/contact-editor.mjs';

const operation = () => randomBytes(24).toString('base64url');
async function json(response, status = 200) {
  const value = await response.json();
  assert.equal(response.status, status, JSON.stringify(value)); return value;
}
const post = (f, app, path, body, headers = {}, origin) => app.handle(f.request(path, { method: 'POST', body, headers, ...(origin ? { origin } : {}) }));
async function application(f, app = f.app) {
  const key = randomBytes(32).toString('base64url'), metadata = await app.registrationService.metadata();
  const token = await json(await post(f, app, '/api/admin/registration/token', { eventId: PEOPLE_FIXTURE_EVENT, idempotencyKey: key }, {}, PEOPLE_FIXTURE_PUBLIC));
  return { key, token: token.submissionToken, payload: { eventId: PEOPLE_FIXTURE_EVENT,
    fields: { intake: 'general-v2', name: '合成恢复申请', email: 'synthetic.restore@example.invalid', categories: ['student'], participationInterests: ['attend'] },
    consent: { accepted: true, version: metadata.privacy.version } } };
}
const submit = (f, app, input) => post(f, app, '/api/admin/registration/submit', input.payload,
  { 'Idempotency-Key': input.key, 'X-Registration-Token': input.token }, PEOPLE_FIXTURE_PUBLIC);
const confirmation = (f, app, receipt) => post(f, app, '/api/admin/registration/confirmation', { receiptToken: receipt.confirmation.receiptToken }, {}, PEOPLE_FIXTURE_PUBLIC).then(json);
const preview = (f, headers, body = {}, app = f.app) => post(f, app, '/api/admin/registration-confirmation/reminder-preview', body, headers).then(json);
const sendReminder = (f, headers, body, app = f.app) => post(f, app, '/api/admin/registration-confirmation/reminder-dispatch', body, headers).then(json);
const sourceWrite = call => call.operation !== 'get' && /^cms\/v1\/(?:registrations|registration-confirmations|contacts|registration-reviews)\//u.test(call.key);

test('new durable application, formal approval and explicit reminder have three independent durable identities', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login();
  const receipt = await f.seedPublic({ intake: 'general-v2' }), id = receipt.reference_code;
  assert.equal(receipt.status, 'pending_review'); assert.equal(receipt.confirmation.email.status, 'not_applicable');
  assert.equal(f.messages.length, 1);
  const text = f.messages[0].template_params.invitation_text;
  assert.match(text, /申请已收到/u); assert.match(text, /尚未确认参会名额/u);
  assert.doesNotMatch(text, /你的参会名额已确认|Apple Wallet|group-invite/u);
  let view = await confirmation(f, f.app, receipt);
  assert.equal(view.notifications.applicationReceived.status, 'provider_accepted');
  assert.equal(view.email.status, 'not_applicable'); assert.equal(view.groupInvite, null); assert.equal(view.wallet.ready, false);
  assert.equal((await f.app.confirmationService.staffHistory({ actor: f.users[0], registrationId: id })).notices.length, 0);
  await f.approvePublic(id, { headers }); assert.equal(f.messages.length, 2);
  const before = f.objects.calls.length, list = await preview(f, headers);
  assert.equal(list.rows.length, 1); assert.equal(list.rows[0].registrationId, id); assert.equal(list.rows[0].eligible, true);
  assert.equal(list.rows[0].status, 'not_sent'); assert.match(list.message.text, /\[私人参会页链接\]/u);
  assert.doesNotMatch(JSON.stringify(list), /synthetic\.public@example\.invalid|receiptToken|confirmationUrl|relatedRegistrationIds|#r=c1\./u);
  assert.equal(f.objects.calls.slice(before).some(sourceWrite), false, 'preview never changes business journals');
  const body = { expectedRevision: list.revision, operationId: operation(), registrationIds: [id] };
  const sent = await sendReminder(f, headers, body); assert.equal(sent.results[0].status, 'provider_accepted'); assert.equal(f.messages.length, 3);
  assert.match(f.messages[2].template_params.invitation_text, /签到：09:30/u);
  const replay = await sendReminder(f, headers, body); assert.equal(replay.outcome, 'replayed'); assert.equal(f.messages.length, 3);
  const start = f.objects.calls.length, restarted = f.make();
  const result = await json(await restarted.handle(f.request('/api/admin/registration-confirmation/reminder-operation/' + body.operationId, { headers })));
  assert.equal(result.kind, 'pre_event_reminder'); assert.deepEqual(result.results, sent.results);
  view = await confirmation(f, restarted, receipt);
  assert.equal(view.email.status, 'provider_accepted'); assert.equal(view.notifications.preEventReminder.status, 'provider_accepted');
  assert.equal(f.objects.calls.slice(start).some(sourceWrite), false); assert.equal(f.messages.length, 3);
  const history = await restarted.confirmationService.staffHistory({ actor: f.users[0], registrationId: id });
  assert.deepEqual(history.notices.map(item => item.kind), ['registration']);
  assert.equal((await preview(f, headers, {}, restarted)).rows[0].eligible, false);
});

test('lost registration acknowledgement restores its original receipt after token expiry without historical mail backfill', async () => {
  let now = Date.parse('2026-10-21T09:00:00Z'), lose = true;
  const f = await peopleRuntimeFixture({ mail: true, clock: () => now });
  const objects = { ...f.objects, async append(key, position, data) {
    const ack = await f.objects.append(key, position, data);
    if (lose && key === 'cms/v1/registrations/' + PEOPLE_FIXTURE_EVENT + '/index/commits.jsonl') { lose = false; throw new Error('Synthetic saved registration ACK lost'); }
    return ack;
  } };
  const app = f.make({ objects }), input = await application(f, app), original = JSON.stringify(input.payload);
  assert.equal((await submit(f, app, input)).status, 503); assert.equal(f.messages.length, 0);
  now += 24 * 60 * 60 * 1000;
  const saved = await json(await submit(f, f.make(), input), 200);
  assert.equal(saved.status, 'pending_review'); assert.equal(JSON.stringify(input.payload), original);
  assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
  assert.equal(f.messages.length, 0, 'replayed old receipt never creates application mail');
  assert.equal((await confirmation(f, f.make(), saved)).notifications.applicationReceived.status, 'not_sent');
});

test('old unsaved pending body can refresh only its expired token and still create once with the original consent version', async () => {
  let now = Date.parse('2026-10-21T09:00:00Z');
  const f = await peopleRuntimeFixture({ mail: true, clock: () => now }), input = await application(f), original = JSON.stringify(input.payload);
  now += 24 * 60 * 60 * 1000;
  const restarted = f.make(), token = await json(await post(f, restarted, '/api/admin/registration/token', { eventId: PEOPLE_FIXTURE_EVENT, idempotencyKey: input.key }, {}, PEOPLE_FIXTURE_PUBLIC));
  input.token = token.submissionToken;
  const first = await json(await submit(f, restarted, input), 201), second = await json(await submit(f, restarted, input), 200);
  assert.equal(first.reference_code, second.reference_code); assert.equal(JSON.stringify(input.payload), original);
  assert.equal(f.messages.length, 1); assert.match(f.messages[0].template_params.invitation_text, /申请已收到/u);
  assert.equal((await restarted.registrationService.repository.list()).registrations[0].consent.version, input.payload.consent.version);
});

test('an unavailable notification journal cannot erase the committed application or private lookup link', async () => {
  const f = await peopleRuntimeFixture({ mail: true });
  const objects = { ...f.objects, append: (key, position, data) => {
    if (key.startsWith('cms/v1/registration-confirmations/')) throw new Error('Synthetic notice storage unavailable');
    return f.objects.append(key, position, data);
  } };
  const app = f.make({ objects }), input = await application(f, app), saved = await json(await submit(f, app, input), 201);
  assert.equal(saved.status, 'pending_review'); assert.ok(saved.confirmation.confirmationUrl);
  assert.equal((await app.registrationService.repository.list()).registrations.length, 1); assert.equal(f.messages.length, 0);
  const view = await confirmation(f, app, saved);
  assert.equal(view.admission.status, 'pending_review'); assert.equal(view.notifications.applicationReceived.status, 'not_sent');
});

test('unknown application mail survives restart and does not suppress an independent formal confirmation or reminder', async () => {
  let outcome = 'unknown';
  const f = await peopleRuntimeFixture({ mail: true, mailResult: () => outcome }), receipt = await f.seedPublic({ intake: 'general-v2' });
  assert.equal(f.messages.length, 1); assert.equal((await confirmation(f, f.make(), receipt)).notifications.applicationReceived.status, 'unknown');
  outcome = 'accepted'; const headers = await f.login();
  await f.approvePublic(receipt.reference_code, { headers }); assert.equal(f.messages.length, 2);
  const list = await preview(f, headers), sent = await sendReminder(f, headers, { expectedRevision: list.revision, operationId: operation(), registrationIds: [receipt.reference_code] });
  assert.equal(sent.results[0].status, 'provider_accepted'); assert.equal(f.messages.length, 3);
  const view = await confirmation(f, f.make(), receipt);
  assert.equal(view.notifications.applicationReceived.status, 'unknown'); assert.equal(view.notifications.preEventReminder.status, 'provider_accepted');
  assert.equal(view.email.status, 'provider_accepted');
  const settings = await f.app.confirmationService.settings({ actor: f.users[0] });
  assert.equal(settings.counts.total, 1); assert.equal(settings.counts.providerAccepted, 1);
  assert.equal(settings.notificationCounts.applicationReceived.unknown, 1); assert.equal(settings.notificationCounts.preEventReminder.providerAccepted, 1);
});

test('same name and mailbox are separate reminder recipients until an explicit saved person relationship exists', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login(), receipts = [];
  for (let i = 0; i < 2; i++) {
    const receipt = await f.seedPublic({ intake: 'general-v2', name: '合成同名不同人', email: 'synthetic.shared@example.invalid' });
    receipts.push(receipt); await f.approvePublic(receipt.reference_code, { headers });
  }
  const list = await preview(f, headers); assert.equal(list.rows.length, 2); assert.ok(list.rows.every(row => row.eligible));
  const sent = await sendReminder(f, headers, { expectedRevision: list.revision, operationId: operation(), registrationIds: list.rows.map(row => row.registrationId) });
  assert.deepEqual(sent.results.map(row => row.status), ['provider_accepted', 'provider_accepted']);
  assert.equal(f.messages.length, 6); assert.equal(new Set(receipts.map(row => row.reference_code)).size, 2);
});

test('a stale ready preview cannot send to a staff contact whose address changed before dispatch', async () => {
  const f = await peopleRuntimeFixture({ mail: true }), headers = await f.login(), contact = (await f.createContact()).contact;
  const saved = await json(await f.app.handle(f.request('/api/admin/contacts/' + contact.id, { method: 'PUT', headers,
    body: { expectedRevision: 1, operations: { ...contact.operations, responseStatus: 'attending' } } })));
  assert.equal(saved.admission.status, 'confirmed'); const list = await preview(f, headers);
  assert.equal(list.rows[0].eligible, true); const count = f.messages.length, roster = await f.app.contactsStore.read();
  await f.app.contactsStore.saveProfile(contact.id, roster.revision, { ...Object.fromEntries([...EDITABLE_CONTACT_FIELDS, ...EDITABLE_CONTACT_ARRAY_FIELDS].map(key => [key, contact.profile[key]])),
    email: 'synthetic.changed@example.invalid' }, f.users[0].id);
  const result = await sendReminder(f, headers, { expectedRevision: list.revision, operationId: operation(), registrationIds: [list.rows[0].registrationId] });
  assert.notEqual(result.results[0].status, 'provider_accepted'); assert.equal(f.messages.length, count);
  const latest = await preview(f, headers); assert.equal(latest.rows[0].eligible, false); assert.equal(latest.rows[0].reason, 'CONTACT_EMAIL_CHANGED');
});

test('reminder preview pages more than one batch with bounded source reads and invalidates a changed source cursor', async () => {
  const f = await peopleRuntimeFixture({ capacity: 300 }), actor = f.users[0];
  for (let i = 0; i < 105; i++) {
    const saved = await f.app.registrationService.addStaffMember({ actor, expectedRevision: i, operationId: operation(),
      input: { kind: 'attendee', permissionReference: '合成逐人授权，仅内存测试', fields: { name: '合成名单 ' + i, email: 'synthetic.' + i + '@example.invalid',
        organization: '合成机构', city: '', position: '', categories: ['industry'], participationInterests: ['attend'], background: '', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' } } });
    assert.equal(saved.outcome, 'updated');
  }
  const headers = await f.login(), start = f.objects.calls.length, first = await preview(f, headers);
  assert.equal(first.total, 105); assert.equal(first.rows.length, 100); assert.ok(first.nextCursor);
  const reads = f.objects.calls.slice(start);
  assert.equal(reads.some(sourceWrite), false);
  assert.ok(reads.filter(call => call.operation === 'get' && call.key.startsWith('cms/v1/registrations/' + PEOPLE_FIXTURE_EVENT + '/index/')).length <= 3,
    'one preview page must not reread the entire registration index for each person');
  const last = await preview(f, headers, { cursor: first.nextCursor });
  assert.equal(last.rows.length, 5); assert.equal(last.nextCursor, null);
  assert.equal(new Set([...first.rows, ...last.rows].map(row => row.registrationId)).size, 105); assert.equal(f.messages.length, 0);
  await f.createContact({ name: '合成来源修订变化' });
  const response = await post(f, f.app, '/api/admin/registration-confirmation/reminder-preview', { cursor: first.nextCursor }, headers);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'REVISION_CONFLICT');
});

test('real runtime reminder routes enforce complete roles, origin and CSRF before reading private business sources', async () => {
  const f = await peopleRuntimeFixture(), path = '/api/admin/registration-confirmation/reminder-preview';
  const businessRead = call => /^cms\/v1\/(?:registrations|contacts|registration-confirmations|registration-reviews|content)\//u.test(call.key);
  for (const username of ['reviewer', 'outreach', 'combined', 'editor']) {
    const headers = await f.login(username), start = f.objects.calls.length;
    assert.equal((await post(f, f.app, path, {}, headers)).status, 403);
    assert.equal(f.objects.calls.slice(start).some(businessRead), false);
  }
  const headers = await f.login(), start = f.objects.calls.length;
  assert.equal((await post(f, f.app, path, {}, { Cookie: headers.Cookie })).status, 403);
  assert.equal((await post(f, f.app, path, {}, headers, PEOPLE_FIXTURE_PUBLIC)).status, 403);
  assert.equal(f.objects.calls.slice(start).some(businessRead), false); assert.equal(f.messages.length, 0);
  const empty = await preview(f, headers); assert.equal(empty.total, 0); assert.deepEqual(empty.rows, []);
  const readOnly = { ...f.objects, get: (key, options) => {
    if (key.startsWith('cms/v1/contacts/')) throw new Error('Synthetic roster unavailable');
    return f.objects.get(key, options);
  } };
  const response = await post(f, f.make({ objects: readOnly }), path, {}, headers);
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'CONFIRMATION_UNAVAILABLE');
});
