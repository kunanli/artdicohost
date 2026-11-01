import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createConfirmationRepository, canonicalConfirmationKind, confirmationNoticeId } from '../functions/registration-confirmation/repository.mjs';
import { createConfirmationEmailProvider } from '../functions/registration-confirmation/email-provider.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const EVENT = 'synthetic-p4', SITE = 'https://artdico.host';
const actor = { id: 'synthetic-manager', roles: ['superadmin'] };
const operationId = () => randomBytes(32).toString('base64url');
const SECRET = 'SYNTHETIC-P4-PRIVATE-SERVER-KEY-12345678901234567890';
const event = { id: EVENT, title: '合成活动', date: { value: '2026-12-05' }, time: { label: '10:00–18:00', start: '09:30', timezone: 'Asia/Shanghai' }, venue: { address: '合成地址' } };
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00Z', closesAt: '2026-12-05T04:00:00Z', privacy: {
  version: 'synthetic-p4-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成报名及必要通知',
  storageRegion: '合成地区', retention: '合成期限', rightsRequest: '合成权利流程', sharing: '合成必要通知' } };
const fields = { intake: 'general-v2', name: '合成参会者', email: 'synthetic.attendee@example.invalid', organization: '合成单位', city: '合成城市',
  wechat: '', categories: ['industry'], participationInterests: ['attend'] };
function fixture(patch = {}) {
  const remote = objectFixture(), state = { now: Date.parse('2026-11-01T00:00:00Z'), messages: [], status: 'provider_accepted',
    loseAck: false, withdrawn: new Set(), aliases: null, sources: [], sourceRevision: 'a'.repeat(64), previewCalls: 0 };
  const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
  const objects = { ...base, async append(key, offset, bytes) {
    const ack = await base.append(key, offset, bytes);
    if (state.loseAck && key.includes('/registration-confirmations/')) { state.loseAck = false; throw new Error('SYNTHETIC_LOST_NOTICE_ACK'); }
    return ack;
  } };
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const registration = createRegistrationService({ objects, journalFor, policy, capacity: 300, tokenSecret: SECRET, allowedOrigins: [SITE],
    clock: () => state.now, isWithdrawn: async id => state.withdrawn.has(id) });
  const provider = { readiness: () => ({ ready: true, enabled: true, missing: [] }),
    async send(input) { state.messages.push(input); return { status: state.status }; } };
  const confirmation = extra => createRegistrationConfirmationService({ registrationService: registration, journalFor, tokenSecret: SECRET, event,
    emailProvider: provider, clock: () => state.now, deliveryAliases: async record => state.aliases?.(record) ?? { registrationIds: [record.id], primaryRegistrationId: record.id },
    noticePreviewSource: async ({ offset, limit }) => { state.previewCalls++; return { revision: state.sourceRevision, total: state.sources.length, rows: state.sources.slice(offset, offset + limit) }; },
    ...patch, ...extra });
  return { state, remote, objects, journalFor, registration, confirmation };
}
async function register(f, { approve = false, name = fields.name } = {}) {
  const idempotencyKey = operationId(), issued = await f.registration.issueToken({ eventId: EVENT, origin: SITE, idempotencyKey });
  const input = { origin: SITE, idempotencyKey, submissionToken: issued.submissionToken,
    payload: { eventId: EVENT, fields: { ...fields, name }, consent: { accepted: true, version: policy.privacy.version } } };
  const saved = await f.registration.submit(input); assert.equal(saved.outcome, 'created');
  const id = saved.receipt.registrationId;
  if (approve) await f.registration.approveApplication({ actor, registrationId: id,
    expectedRevision: (await f.registration.getAdmissions({ actor })).revision, operationId: operationId() });
  return { id, saved, input };
}
const repoFor = f => createConfirmationRepository({ journal: f.journalFor('cms/v1/registration-confirmations/' + EVENT), eventId: EVENT, clock: () => f.state.now });
const source = id => ({ registrationId: id, relatedRegistrationIds: [id], name: '合成参会者', organization: '合成单位', eligible: true, reason: 'ELIGIBLE' });

test('application receipt, formal confirmation and one reminder have independent durable identities and private histories', async () => {
  const f = fixture(), c = f.confirmation(), { id, saved } = await register(f);
  assert.equal((await c.notifyApplicationReceived({ receipt: saved.receipt, outcome: saved.outcome })).status, 'provider_accepted');
  const link = await c.forSavedReceipt({ receipt: saved.receipt, notify: false });
  const pending = await c.confirmation({ receiptToken: link.receiptToken });
  assert.equal(pending.email.status, 'not_applicable'); assert.equal(pending.notifications.applicationReceived.status, 'provider_accepted');
  assert.equal(pending.wallet.ready, false); assert.equal(pending.groupInvite, null);
  assert.doesNotMatch(f.state.messages[0].text, /Apple Wallet|群码|名额已确认/u);
  assert.match(f.state.messages[0].text, /不是正式邀请/u);
  assert.equal((await c.staffDirectory({ actor })).notices.length, 0);
  assert.equal((await c.staffHistory({ actor, registrationId: id })).notices.length, 0);
  await f.registration.approveApplication({ actor, registrationId: id, expectedRevision: 1, operationId: operationId() });
  assert.equal((await c.notifyApproved({ registrationIds: [id] })).results[0].status, 'provider_accepted');
  f.state.sources = [source(id)];
  const preview = await c.staffReminderPreview({ actor });
  assert.equal(preview.rows[0].status, 'not_sent'); assert.equal(preview.rows[0].eligible, true);
  assert.match(preview.message.text, /\[私人参会页链接\]/u);
  assert.doesNotMatch(JSON.stringify(preview), /#r=|synthetic\.attendee@example|receiptToken/u);
  const command = { actor, expectedRevision: preview.revision, operationId: operationId(), registrationIds: [id] };
  assert.equal((await c.dispatchReminder(command)).results[0].status, 'provider_accepted');
  assert.equal((await f.confirmation().dispatchReminder(command)).outcome, 'replayed');
  assert.equal((await f.confirmation().reminderOperation({ actor, operationId: command.operationId })).results[0].status, 'provider_accepted');
  assert.equal(f.state.messages.length, 3);
  const current = await repoFor(f).read();
  assert.deepEqual(current.value.notices.map(n => n.kind).sort(), ['application_received', 'pre_event_reminder', 'registration']);
  assert.equal(new Set(current.value.notices.map(n => n.id)).size, 3);
  assert.equal(canonicalConfirmationKind(current.value, id, 'confirmed'), 'registration');
  const formal = await c.staffHistory({ actor, registrationId: id }); assert.deepEqual(formal.notices.map(n => n.kind), ['registration']);
  const settings = await c.settings({ actor }); assert.equal(settings.counts.total, 1);
  assert.equal(settings.notificationCounts.applicationReceived.total, 1); assert.equal(settings.notificationCounts.preEventReminder.total, 1);
  const page = await c.confirmation({ receiptToken: link.receiptToken });
  assert.equal(page.email.noticeType, 'registration'); assert.equal(page.notifications.preEventReminder.status, 'provider_accepted');
  assert.doesNotMatch(JSON.stringify(current.value), /synthetic\.attendee@example|#r=|合成参会者|invitation_text/u);
});

test('only a new proven pending public commit authorizes an application receipt; reads, replay and staff intake never backfill', async () => {
  const f = fixture(), c = f.confirmation(), { id, saved, input } = await register(f);
  const before = f.remote.calls.length;
  assert.equal((await c.notifyApplicationReceived({ receipt: saved.receipt, outcome: 'replayed' })).status, 'not_applicable');
  assert.equal(f.remote.calls.length, before);
  const replay = await f.registration.submit(input); assert.equal(replay.outcome, 'replayed');
  const link = await c.forSavedReceipt({ receipt: replay.receipt, notify: false });
  await c.confirmation({ receiptToken: link.receiptToken }); await c.staffReminderPreview({ actor });
  assert.equal((await c.confirmation({ receiptToken: link.receiptToken })).notifications.applicationReceived.status, 'not_sent');
  assert.equal(f.state.messages.length, 0); assert.equal((await repoFor(f).read()).value.revision, 0);
  await f.registration.approveApplication({ actor, registrationId: id, expectedRevision: 1, operationId: operationId() });
  assert.equal((await c.notifyApplicationReceived({ receipt: saved.receipt, outcome: 'created' })).status, 'not_applicable');
  const staff = await f.registration.submitStaffRegistration({ actor, sourceContactId: 'synthetic-contact',
    input: { fields: { name: '合成代登记者', email: 'synthetic.staff@example.invalid' }, permissionReference: '合成授权' } });
  assert.equal((await c.notifyApplicationReceived({ receipt: { ...staff.receipt, admissionStatus: 'pending_review' }, outcome: 'created' })).status, 'not_public');
  assert.equal(f.state.messages.length, 0);
});

test('concurrent application receipt calls and uncertain reservation ACKs never duplicate external requests', async () => {
  for (const lost of [false, true]) {
    const f = fixture(), { saved } = await register(f); f.state.loseAck = lost;
    const command = { receipt: saved.receipt, outcome: 'created' };
    const results = await Promise.all([f.confirmation().notifyApplicationReceived(command), f.confirmation().notifyApplicationReceived(command)]);
    assert.equal(f.state.messages.length, lost ? 0 : 1);
    assert.equal((await f.confirmation().notifyApplicationReceived(command)).status, lost ? 'unknown' : 'provider_accepted');
    assert.ok(results.every(row => ['provider_accepted', 'unknown'].includes(row.status)));
    assert.equal((await repoFor(f).read()).value.notices.length, 1);
  }
});

test('an unknown application receipt does not suppress a later formal confirmation or expose a new retry path', async () => {
  const f = fixture(), c = f.confirmation(), { id, saved } = await register(f);
  f.state.status = 'unknown'; await c.notifyApplicationReceived({ receipt: saved.receipt, outcome: 'created' });
  f.state.status = 'provider_accepted'; await c.notifyApplicationReceived({ receipt: saved.receipt, outcome: 'created' });
  assert.equal(f.state.messages.length, 1);
  await f.registration.approveApplication({ actor, registrationId: id, expectedRevision: 1, operationId: operationId() });
  assert.equal((await c.notifyApproved({ registrationIds: [id] })).results[0].status, 'provider_accepted');
  assert.equal((await c.staffDeliveryState({ actor, registrationId: id })).status, 'provider_accepted');
  assert.equal(f.state.messages.length, 2);
});

test('reminder preview is bounded, revision-bound, permission-first and read-only across pages', async () => {
  const f = fixture(), c = f.confirmation();
  f.state.sources = Array.from({ length: 101 }, (_, index) => source(createHash('sha256').update(String(index)).digest('base64url')));
  const before = f.remote.calls.length;
  await assert.rejects(c.staffReminderPreview({ actor: { id: 'synthetic-reviewer', roles: ['reviewer'] } }), error => error.code === 'FORBIDDEN');
  assert.equal(f.remote.calls.length, before); assert.equal(f.state.previewCalls, 0);
  const first = await c.staffReminderPreview({ actor }); assert.equal(first.rows.length, 100); assert.equal(first.total, 101);
  const second = await c.staffReminderPreview({ actor, cursor: first.nextCursor }); assert.equal(second.rows.length, 1); assert.equal(second.nextCursor, null);
  f.state.sourceRevision = 'b'.repeat(64);
  await assert.rejects(c.staffReminderPreview({ actor, cursor: first.nextCursor }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(f.remote.calls.slice(before).every(call => call.method === 'GET'), true); assert.equal(f.state.messages.length, 0);
  assert.equal((await repoFor(f).read()).value.revision, 0);
  await assert.rejects(c.staffReminderPreview({ actor, cursor: 'INVALID_CURSOR' }), error => error.code === 'INVALID_REQUEST');
});

test('canonical aliases suppress reminders from accepted or unknown history while an equal unrelated email does not', async () => {
  for (const status of ['provider_accepted', 'unknown', 'reserved']) {
    const f = fixture(), c = f.confirmation(), old = await register(f, { approve: true }), primary = await register(f, { approve: true }), unrelated = await register(f, { approve: true });
    const repo = repoFor(f); let current = await repo.read();
    current = await repo.append(current, 'reserve', { registrationId: old.id, kind: 'pre_event_reminder', admissionStatus: 'confirmed', admissionRevision: 1, retryRejected: false }, actor.id);
    if (status !== 'reserved') await repo.append(current, 'result', { noticeId: confirmationNoticeId(EVENT, old.id, 'pre_event_reminder'), status }, actor.id);
    f.state.aliases = record => record.id === unrelated.id ? { registrationIds: [unrelated.id], primaryRegistrationId: unrelated.id }
      : { registrationIds: [old.id, primary.id], primaryRegistrationId: primary.id };
    f.state.sources = [{ ...source(primary.id), relatedRegistrationIds: [old.id, primary.id] }, source(unrelated.id)];
    const preview = await c.staffReminderPreview({ actor }); assert.equal(preview.rows[0].eligible, false); assert.equal(preview.rows[1].eligible, true);
    const result = await c.dispatchReminder({ actor, expectedRevision: preview.revision, operationId: operationId(), registrationIds: [primary.id, unrelated.id] });
    assert.equal(result.results[0].status, status === 'reserved' ? 'unknown' : status);
    assert.equal(f.state.messages.length, status === 'provider_accepted' ? 1 : 0, 'unknown stops the remaining batch');
  }
});

test('formal delivery also honors unresolved or accepted canonical alias history before reserving a new identity', async () => {
  for (const status of ['provider_accepted', 'unknown']) {
    const f = fixture(), c = f.confirmation(), old = await register(f, { approve: true }), primary = await register(f, { approve: true });
    const repo = repoFor(f); let current = await repo.read();
    current = await repo.append(current, 'reserve', { registrationId: old.id, kind: 'registration', admissionStatus: 'confirmed', admissionRevision: 1, retryRejected: false }, actor.id);
    await repo.append(current, 'result', { noticeId: confirmationNoticeId(EVENT, old.id, 'registration'), status }, actor.id);
    f.state.aliases = () => ({ registrationIds: [old.id, primary.id], primaryRegistrationId: primary.id });
    assert.equal((await c.staffDeliveryState({ actor, registrationId: primary.id })).ready, false);
    assert.equal((await c.notifyApproved({ registrationIds: [primary.id] })).results[0].status, status);
    assert.equal(f.state.messages.length, 0); assert.equal((await repo.read()).value.notices.length, 1);
  }
});

test('lost reminder operation ACK is recovered by read-only lookup and never repeated under a new identity', async () => {
  const f = fixture(), c = f.confirmation(), { id } = await register(f, { approve: true });
  const command = { actor, expectedRevision: 0, operationId: operationId(), registrationIds: [id] };
  f.state.loseAck = true;
  await assert.rejects(c.dispatchReminder(command), error => error.code === 'CONFIRMATION_UNAVAILABLE');
  const before = f.remote.calls.length, result = await f.confirmation().reminderOperation({ actor, operationId: command.operationId });
  assert.equal(result.status, 'unknown'); assert.deepEqual(result.results, [{ registrationId: id, status: 'unknown' }]);
  assert.equal(f.remote.calls.slice(before).every(call => call.method === 'GET'), true); assert.equal(f.state.messages.length, 0);
  await assert.rejects(c.dispatch({ ...command, expectedRevision: 1 }), error => error.code === 'REVISION_CONFLICT');
  await assert.rejects(c.reminderOperation({ actor: { ...actor, id: 'another-manager' }, operationId: command.operationId }), error => error.code === 'CONFIRMATION_NOT_FOUND');
});

test('known reminder refusal is retried explicitly at most five times, while unknown is never retried', async () => {
  const f = fixture(), c = f.confirmation(), { id } = await register(f, { approve: true }); f.state.status = 'rejected';
  for (let attempt = 0; attempt < 6; attempt++) {
    await c.dispatchReminder({ actor, expectedRevision: (await repoFor(f).read()).value.revision, operationId: operationId(), registrationIds: [id], retryRejected: attempt > 0 });
  }
  assert.equal(f.state.messages.length, 5);
  f.state.sources = [source(id)]; assert.equal((await c.staffReminderPreview({ actor })).rows[0].reason, 'RETRY_LIMIT');
  const g = fixture(), d = g.confirmation(), saved = await register(g, { approve: true }); g.state.status = 'unknown';
  await d.dispatchReminder({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [saved.id] });
  await d.dispatchReminder({ actor, expectedRevision: (await repoFor(g).read()).value.revision, operationId: operationId(), registrationIds: [saved.id], retryRejected: true });
  assert.equal(g.state.messages.length, 1);
});

test('a withdrawal, pause or alias change during asynchronous provider configuration blocks the actual transport', async () => {
  for (const change of ['withdrawal', 'pause', 'alias']) {
    const f = fixture(), saved = await register(f, { approve: true }); let loads = 0, calls = 0, c;
    const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' },
      loadConfiguration: async () => {
        if (++loads === 2) {
          if (change === 'withdrawal') f.state.withdrawn.add(saved.id);
          if (change === 'pause') await c.setSettings({ actor, expectedRevision: 2, operationId: operationId(), enabled: false });
          if (change === 'alias') f.state.aliases = () => ({ registrationIds: [saved.id, 'z'.repeat(43)], primaryRegistrationId: 'z'.repeat(43) });
        }
        return { EMAILJS_SERVICE_ID: 'synthetic-service', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic-template', EMAILJS_PUBLIC_KEY: 'synthetic-public',
          EMAILJS_PRIVATE_KEY: 'synthetic-private', EMAIL_FROM_ADDRESS: 'synthetic@artdico.co', EMAIL_FROM_NAME: '合成团队' };
      }, fetchFn: async () => { calls++; return new Response('OK', { headers: { 'content-type': 'text/plain' } }); } });
    c = f.confirmation({ emailProvider: provider });
    const result = await c.dispatchReminder({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [saved.id] });
    assert.equal(calls, 0, change); assert.equal(result.results[0].status, 'not_attempted');
    assert.equal((await repoFor(f).read()).value.notices[0].status, 'rejected');
  }
});

test('an async final guard cannot start a late fetch after the provider has already timed out', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true', EMAILJS_SERVICE_ID: 'synthetic-service',
    EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic-template', EMAILJS_PUBLIC_KEY: 'synthetic-public', EMAILJS_PRIVATE_KEY: 'synthetic-private',
    EMAIL_FROM_ADDRESS: 'synthetic@artdico.co', EMAIL_FROM_NAME: '合成团队' }, timeoutMs: 10,
    fetchFn: async () => { calls++; return new Response('OK', { headers: { 'content-type': 'text/plain' } }); } });
  const text = '合成通知';
  const result = await provider.send({ recipient: 'synthetic@example.invalid', subject: text, text, idempotencyKey: 'synthetic-notice',
    canStart: async () => { await new Promise(resolve => setTimeout(resolve, 40)); return true; }, templateVariables: {
      to_name: '合成收件人', to_email: 'synthetic@example.invalid', event_title: text, event_date: '2026-12-05', event_time: '10:00–18:00',
      event_venue: '合成地址', reference_code: 'synthetic', invitation_text: text } });
  assert.equal(result.status, 'unknown');
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(calls, 0);
});

test('reminders do not send after check-in opens and typed journal failure does not erase current admission', async () => {
  const f = fixture(), c = f.confirmation(), saved = await register(f, { approve: true });
  f.state.now = Date.parse('2026-12-05T01:30:00Z'); f.state.sources = [source(saved.id)];
  assert.equal((await c.staffReminderPreview({ actor })).rows[0].reason, 'REMINDER_WINDOW_CLOSED');
  assert.equal((await c.dispatchReminder({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [saved.id] })).results[0].status, 'not_applicable');
  const receipt = await c.forSavedReceipt({ receipt: saved.saved.receipt, notify: false });
  const unavailable = f.confirmation({ journalFor: () => ({ read: async () => { throw new Error('SYNTHETIC_FAILURE'); }, commit: async () => assert.fail('read must not write') }) });
  const page = await unavailable.confirmation({ receiptToken: receipt.receiptToken });
  assert.equal(page.admission.status, 'confirmed'); assert.equal(page.email.status, 'unknown');
  assert.deepEqual(page.notifications, { applicationReceived: { status: 'unknown' }, preEventReminder: { status: 'unknown' } });
  assert.equal(f.state.messages.length, 0);
});
