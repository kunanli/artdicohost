import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createAdmissionsApi } from '../functions/registration-admin/admissions-handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createConfirmationTokens } from '../functions/registration-confirmation/tokens.mjs';
import { createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { createConfirmationEmailProvider } from '../functions/registration-confirmation/email-provider.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const EVENT = 'synthetic-confirmation', SITE = 'https://artdico.host';
const SECRET = 'SYNTHETIC-CONFIRMATION-SHARED-SECRET-ONLY-1234567890';
const actor = { id: 'synthetic-admin', roles: ['superadmin'] };
const operationId = () => randomBytes(32).toString('base64url');
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00Z', closesAt: '2026-12-05T04:00:00Z', privacy: {
  version: 'synthetic-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成报名', storageRegion: '合成地区',
  retention: '合成期限', rightsRequest: '合成权利申请', sharing: '合成分享规则' } };
const event = { id: EVENT, title: '合成活动', date: { value: '2026-12-05' }, time: { label: '10:00–18:00', start: '09:30', timezone: 'Asia/Shanghai' }, venue: { address: '合成地址' } };
const fields = { name: 'PRIVATE-SYNTHETIC-NAME', city: '合成城市', organization: 'PRIVATE-SYNTHETIC-ORG', email: 'private-synthetic@example.invalid', categories: ['other'],
  participationInterests: ['attend'], attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' };
function fixture(patch = {}) {
  const { capacity = 1, ...confirmationPatch } = patch;
  const remote = objectFixture(), state = { now: Date.parse('2026-10-21T00:00:00Z'), ready: true, messages: [], confirmationWrites: 0, loseAt: 0,
    providerStatus: 'provider_accepted', providerThrow: false, reviewFailure: false, withdrawn: new Set(), loseAdmissionAck: false };
  const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
  const objects = { ...base, async append(path, position, bytes) {
    const ack = await base.append(path, position, bytes);
    if (state.loseAdmissionAck && path.includes('/registrations/') && path.endsWith('/index/commits.jsonl')) {
      state.loseAdmissionAck = false; throw new Error('PRIVATE-LOST-ADMISSION-ACK');
    }
    if (path.includes('/registration-confirmations/') && path.endsWith('/commits.jsonl')) {
      state.confirmationWrites++;
      if (state.loseAt === state.confirmationWrites) throw new Error('PRIVATE-LOST-ACK');
    }
    return ack;
  } };
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const service = createRegistrationService({ objects, journalFor, policy, capacity, waitlistEnabled: true, tokenSecret: SECRET,
    allowedOrigins: [SITE], clock: () => state.now, isWithdrawn: async id => { if (state.reviewFailure) throw new Error('PRIVATE-REVIEW'); return state.withdrawn.has(id); } });
  const provider = { readiness: () => ({ ready: state.ready, enabled: state.ready, missing: state.ready ? [] : ['EMAILJS_CONFIRMATION_TEMPLATE_ID'] }),
    async send(input) { state.messages.push(input); if (state.providerThrow) throw new Error('PRIVATE-PROVIDER-ERROR'); return { status: state.providerStatus }; } };
  const confirmation = extra => createRegistrationConfirmationService({ registrationService: service, journalFor, tokenSecret: SECRET, event,
    emailProvider: provider, clock: () => state.now, walletReadiness: async () => ({ ready: true, reason: 'WALLET_CONFIGURED' }),
    groupInviteProvider: async () => ({ platform: 'wechat', qrImageUrl: 'https://api.artdico.host/api/admin/registration/group-invite/synthetic', expiresAt: new Date(state.now + 60_000).toISOString(), PRIVATE_FIELD: 'never-project' }),
    ...confirmationPatch, ...extra });
  return { remote, state, objects, journalFor, service, confirmation };
}
async function register(f, value = fields, approve = true) {
  const idempotencyKey = operationId(), issued = await f.service.issueToken({ eventId: EVENT, origin: SITE, idempotencyKey });
  const input = { origin: SITE, idempotencyKey, submissionToken: issued.submissionToken,
    payload: { eventId: EVENT, fields: value, consent: { accepted: true, version: policy.privacy.version } } };
  let saved = await f.service.submit(input); assert.equal(saved.outcome, 'created');
  assert.equal(saved.receipt.admissionStatus, 'pending_review');
  if (approve) {
    const current = await f.service.getAdmissions({ actor });
    const decision = await f.service.approveApplication({ actor, registrationId: saved.receipt.registrationId,
      expectedRevision: current.revision, operationId: operationId() });
    assert.equal(decision.outcome, 'updated');
    saved = { ...saved, receipt: { ...saved.receipt, admissionStatus: (await f.service.getAdmissionStatus(saved.receipt.registrationId)).status,
      admissionRevision: decision.revision } };
  }
  return { saved, input };
}

test('receipt capability is stable, bounded, purpose separated and contains no personal data', () => {
  let now = Date.parse('2026-10-21T00:00:00Z'); const id = 'a'.repeat(43), expiry = now + 10_000;
  const tokens = createConfirmationTokens({ tokenSecret: SECRET, eventId: EVENT, expiresAt: expiry, clock: () => now });
  const first = tokens.issue(id); assert.equal(tokens.issue(id).receiptToken, first.receiptToken);
  assert.deepEqual(tokens.verify(first.receiptToken), { registrationId: id, expiresAt: new Date(expiry).toISOString() });
  assert.equal(tokens.verify(first.receiptToken.replace('c1.', 'r1.')), null);
  assert.equal(tokens.verify(first.receiptToken.slice(0, -1) + (first.receiptToken.endsWith('a') ? 'b' : 'a')), null);
  assert.equal(createConfirmationTokens({ tokenSecret: SECRET, eventId: 'other-event', expiresAt: expiry, clock: () => now }).verify(first.receiptToken), null);
  const claims = Buffer.from(first.receiptToken.split('.')[1], 'base64url').toString();
  assert.doesNotMatch(claims, /PRIVATE|@|email|name/u);
  now = expiry; assert.equal(tokens.verify(first.receiptToken), null); assert.throws(() => tokens.issue(id));
  assert.throws(() => createConfirmationTokens({ tokenSecret: 'short', eventId: EVENT, expiresAt: expiry }));
});

test('pending receipt and repeated private reads reserve no formal notice, send no mail and expose no admission extras', async () => {
  const f = fixture(), { saved } = await register(f, fields, false), c = f.confirmation();
  const before = f.remote.calls.length;
  const receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  assert.equal(receipt.email.status, 'not_applicable'); assert.equal(f.remote.calls.length, before, 'pending decoration has no outbox or provider I/O');
  for (const reader of [c, f.confirmation()]) {
    const current = await reader.confirmation({ receiptToken: receipt.receiptToken });
    assert.equal(current.admission.status, 'pending_review'); assert.equal(current.email.status, 'not_applicable');
    assert.deepEqual(current.wallet, { ready: false, reason: 'ADMISSION_NOT_CONFIRMED' }); assert.equal(current.groupInvite, null);
  }
  assert.equal(f.state.confirmationWrites, 0); assert.equal(f.state.messages.length, 0);
  assert.equal(f.remote.calls.slice(before).some(call => call.key.includes('/registration-confirmations/')), false);
  assert.equal((await f.service.getAdmissions({ actor })).summary.confirmedCount, 0);
  const candidate = { ...saved.receipt, admissionStatus: 'confirmed' };
  assert.equal((await c.forSavedReceipt({ receipt: candidate })).email.status, 'not_applicable', 'even a stale confirmed receipt cannot authorize an unreviewed send');
  assert.equal((await c.notifyApproved({ registrationIds: [saved.receipt.registrationId] })).results[0].status, 'not_applicable');
  assert.equal((await c.notifyPromoted({ registrationIds: [saved.receipt.registrationId] })).results[0].status, 'not_applicable');
  assert.equal(f.state.confirmationWrites, 0); assert.equal(f.state.messages.length, 0);
});

test('rejection preserves a working private application receipt without a formal notification identity', async () => {
  const f = fixture(), { saved } = await register(f, fields, false), c = f.confirmation();
  const cap = await c.forSavedReceipt({ receipt: saved.receipt, notify: false });
  const decision = await f.service.rejectApplication({ actor, registrationId: saved.receipt.registrationId,
    expectedRevision: saved.receipt.admissionRevision, operationId: operationId() });
  assert.equal(decision.outcome, 'updated');
  const page = await c.confirmation({ receiptToken: cap.receiptToken });
  assert.equal(page.admission.status, 'rejected'); assert.equal(page.attendee.name, fields.name);
  assert.equal(page.email.status, 'not_applicable'); assert.equal(page.groupInvite, null); assert.equal(page.wallet.ready, false);
  await c.notifyApproved({ registrationIds: [saved.receipt.registrationId] });
  assert.equal(f.state.confirmationWrites, 0); assert.equal(f.state.messages.length, 0);
  assert.equal((await f.service.repository.list()).registrations.length, 1);
});

test('approval notification is durable and deduplicated; public receipt replay with notify false never sends', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation();
  const before = f.remote.calls.length, cap = await c.forSavedReceipt({ receipt: saved.receipt, notify: false });
  assert.equal(cap.email.status, 'not_applicable'); assert.equal(f.remote.calls.length, before); assert.equal(f.state.messages.length, 0);
  await Promise.all([c.notifyApproved({ registrationIds: [saved.receipt.registrationId] }),
    f.confirmation().notifyApproved({ registrationIds: [saved.receipt.registrationId] })]);
  assert.equal(f.state.messages.length, 1);
  const history = await c.staffHistory({ actor, registrationId: saved.receipt.registrationId });
  assert.equal(history.notices.length, 1); assert.equal(history.notices[0].kind, 'registration');
  assert.equal(history.notices[0].admissionStatus, 'confirmed');
  await c.forSavedReceipt({ receipt: saved.receipt, notify: false });
  await c.notifyApproved({ registrationIds: [saved.receipt.registrationId] });
  assert.equal(f.state.messages.length, 1);
});

test('real approval HTTP keeps lost ACK uncertain, then the exact replay authorizes one notification and never revives a later withdrawal', async () => {
  const f = fixture(), { saved } = await register(f, fields, false), c = f.confirmation();
  const command = { registrationId: saved.receipt.registrationId, expectedRevision: saved.receipt.admissionRevision, operationId: operationId() };
  let callbacks = 0;
  const api = createAdmissionsApi({ enabled: true, service: f.service,
    auth: { authenticate: async () => ({ user: actor, csrfToken: 'synthetic-csrf' }) },
    onCommitted: async ({ action, result }) => {
      callbacks++; assert.equal(action, 'approve'); assert.equal(result.registrationId, command.registrationId); assert.deepEqual(result.promotedIds, []);
      const notified = await c.notifyApproved({ registrationIds: [result.registrationId] });
      return { approvalEmail: notified.results[0].status === 'not_applicable'
        ? { status: 'not_applicable', attemptedCount: 0, pendingCount: 0 }
        : { status: 'completed', attemptedCount: 1, pendingCount: 0 } };
    } });
  const request = (method = 'POST') => new Request('https://api.artdico.host/api/admin/admissions' + (method === 'POST' ? '/approve' : ''), {
    method, headers: { origin: 'https://api.artdico.host', 'content-type': 'application/json', 'x-csrf-token': 'synthetic-csrf' },
    ...(method === 'POST' ? { body: JSON.stringify(command) } : {}) });
  f.state.loseAdmissionAck = true;
  assert.equal((await api(request())).status, 503); assert.equal(callbacks, 0); assert.equal(f.state.messages.length, 0);
  const replay = await api(request()), current = await replay.json();
  assert.equal(replay.status, 200); assert.equal(current.outcome, 'replayed'); assert.equal(current.operation.operationId, command.operationId);
  assert.equal(current.people.find(person => person.registrationId === command.registrationId).status, 'confirmed');
  assert.equal(f.state.messages.length, 1); await api(request()); assert.equal(f.state.messages.length, 1);
  const beforeRead = callbacks; await api(request('GET')); assert.equal(callbacks, beforeRead);
  const capacity = await f.service.getAdmissions({ actor });
  await f.service.withdrawAdmission({ actor, registrationId: command.registrationId, expectedRevision: capacity.revision, operationId: operationId() });
  const later = await (await api(request())).json();
  assert.equal(later.people.find(person => person.registrationId === command.registrationId).status, 'withdrawn');
  assert.equal(later.operation.revision, command.expectedRevision + 1);
  assert.deepEqual(later.approvalEmail, { status: 'not_applicable', attemptedCount: 0, pendingCount: 0 });
  assert.equal(f.state.messages.length, 1);
});

test('unconfigured decoration adds no storage I/O, while re-open authoritatively reads the saved receipt without sending', async () => {
  const f = fixture(); f.state.ready = false; const { saved } = await register(f), c = f.confirmation();
  const before = f.remote.calls.length, receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  assert.equal(f.remote.calls.length, before); assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, 0);
  assert.equal(receipt.email.status, 'not_configured'); assert.equal(receipt.confirmationUrl, SITE + '/registration/confirmation/#r=' + receipt.receiptToken);
  const first = await c.confirmation({ receiptToken: receipt.receiptToken }), second = await f.confirmation().confirmation({ receiptToken: receipt.receiptToken });
  assert.deepEqual(first, second); assert.equal(first.attendee.name, fields.name); assert.equal(first.admission.status, 'confirmed');
  assert.equal(first.wallet.ready, true); assert.equal(first.groupInvite.platform, 'wechat'); assert.equal(Object.hasOwn(first.groupInvite, 'PRIVATE_FIELD'), false);
  assert.equal(JSON.stringify(first).includes(fields.email), false); assert.equal(f.state.messages.length, 0);
});

test('configured public confirmation is sent once across independent instances and replay only reads its durable result', async () => {
  const f = fixture(), { saved } = await register(f), a = f.confirmation(), b = f.confirmation();
  const results = await Promise.all([a.forSavedReceipt({ receipt: saved.receipt }), b.forSavedReceipt({ receipt: saved.receipt })]);
  assert.equal(f.state.messages.length, 1);
  assert.ok(results.every(value => ['provider_accepted', 'unknown'].includes(value.email.status)));
  const replay = await f.confirmation().forSavedReceipt({ receipt: saved.receipt });
  assert.equal(replay.email.status, 'provider_accepted'); assert.equal(f.state.messages.length, 1);
  assert.equal(f.state.messages[0].recipient, fields.email); assert.match(f.state.messages[0].subject, /名额已确认/u);
  assert.ok(f.state.messages[0].text.includes(replay.confirmationUrl));
  const state = await createConfirmationRepository({ journal: f.journalFor(a.prefix), eventId: EVENT }).read();
  assert.equal(state.value.audit.length, 2); assert.equal(state.value.notices[0].status, 'provider_accepted');
  assert.doesNotMatch(JSON.stringify(state.value), /PRIVATE-SYNTHETIC|private-synthetic@|receiptToken|confirmationUrl/u);
});

test('approved waitlist has no formal notice or group or Wallet; current receipt follows FIFO promotion', async () => {
  const f = fixture(), first = await register(f), second = await register(f, { ...fields, name: '合成候补', email: 'waiting@example.invalid' }), c = f.confirmation();
  const receipt = await c.forSavedReceipt({ receipt: second.saved.receipt });
  assert.equal(receipt.email.status, 'not_applicable'); assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, 0);
  const before = await c.confirmation({ receiptToken: receipt.receiptToken });
  assert.equal(before.admission.status, 'waitlisted'); assert.equal(before.wallet.ready, false); assert.equal(before.groupInvite, null);
  assert.equal(before.email.status, 'not_applicable');
  const capacity = await f.service.getAdmissions({ actor });
  const released = await f.service.withdrawAdmission({ actor, expectedRevision: capacity.revision, operationId: operationId(), registrationId: first.saved.receipt.registrationId });
  assert.deepEqual(released.promotedIds, [second.saved.receipt.registrationId]);
  const after = await c.confirmation({ receiptToken: receipt.receiptToken });
  assert.equal(after.admission.status, 'confirmed'); assert.equal(after.wallet.ready, true); assert.equal(f.state.messages.length, 0, 'read never sends a promotion');
  await c.notifyPromoted({ registrationIds: released.promotedIds }); await f.confirmation().notifyPromoted({ registrationIds: released.promotedIds });
  assert.equal(f.state.messages.length, 1); assert.match(f.state.messages[0].subject, /名额已确认/u);
});

test('historical waitlist notice remains readable and keeps a distinct confirmed promotion identity', async () => {
  const f = fixture(), first = await register(f), waiting = await register(f), c = f.confirmation();
  const repository = createConfirmationRepository({ journal: f.journalFor(c.prefix), eventId: EVENT, clock: () => f.state.now });
  let stored = await repository.read();
  stored = await repository.append(stored, 'reserve', { registrationId: waiting.saved.receipt.registrationId,
    kind: 'registration', admissionStatus: 'waitlisted', admissionRevision: waiting.saved.receipt.admissionRevision, retryRejected: false }, actor.id);
  await repository.append(stored, 'result', { noticeId: stored.value.notices[0].id, status: 'provider_accepted' }, actor.id);
  const cap = await c.forSavedReceipt({ receipt: waiting.saved.receipt, notify: false });
  assert.equal((await c.confirmation({ receiptToken: cap.receiptToken })).email.status, 'provider_accepted');
  const current = await f.service.getAdmissions({ actor });
  const released = await f.service.withdrawAdmission({ actor, expectedRevision: current.revision, operationId: operationId(), registrationId: first.saved.receipt.registrationId });
  await c.notifyPromoted({ registrationIds: released.promotedIds });
  const history = await c.staffHistory({ actor, registrationId: waiting.saved.receipt.registrationId });
  assert.deepEqual(history.notices.map(notice => [notice.kind, notice.admissionStatus]), [['registration', 'waitlisted'], ['promotion', 'confirmed']]);
  assert.equal(f.state.messages.length, 1);
});

async function promotedBeforeNotification(f) {
  const first = await register(f), waiting = await register(f);
  const capacity = await f.service.getAdmissions({ actor });
  const released = await f.service.withdrawAdmission({ actor, expectedRevision: capacity.revision, operationId: operationId(), registrationId: first.saved.receipt.registrationId });
  assert.deepEqual(released.promotedIds, [waiting.saved.receipt.registrationId]);
  return { ...waiting.saved.receipt, admissionStatus: 'confirmed', admissionRevision: released.revision };
}

test('intake and promotion share one confirmed identity in either order when the waitlist hook was delayed', async () => {
  for (const promotionFirst of [false, true]) {
    const f = fixture(), receipt = await promotedBeforeNotification(f), c = f.confirmation();
    const intake = () => c.forSavedReceipt({ receipt }), promotion = () => f.confirmation().notifyPromoted({ registrationIds: [receipt.registrationId] });
    await (promotionFirst ? promotion() : intake()); await (promotionFirst ? intake() : promotion());
    assert.equal(f.state.messages.length, 1); assert.match(f.state.messages[0].subject, /名额已确认/u);
    const saved = await createConfirmationRepository({ journal: f.journalFor(c.prefix), eventId: EVENT }).read();
    assert.equal(saved.value.notices.length, 1); assert.equal(saved.value.notices[0].kind, 'registration');
    assert.equal(saved.value.notices[0].admissionStatus, 'confirmed');
  }
});

test('concurrent intake and promotion reserve one confirmed notice across independent instances', async () => {
  const f = fixture(), receipt = await promotedBeforeNotification(f);
  await Promise.all([f.confirmation().forSavedReceipt({ receipt }), f.confirmation().notifyPromoted({ registrationIds: [receipt.registrationId] })]);
  assert.equal(f.state.messages.length, 1);
  const current = await createConfirmationRepository({ journal: f.journalFor(f.confirmation().prefix), eventId: EVENT }).read();
  assert.equal(current.value.notices.length, 1); assert.equal(current.value.notices[0].status, 'provider_accepted');
});

test('cross-kind replays never resend a lost reservation or result acknowledgement', async () => {
  for (const promotionFirst of [false, true]) for (const lostAt of [1, 2]) {
    const f = fixture(), receipt = await promotedBeforeNotification(f); f.state.loseAt = lostAt;
    const intake = () => f.confirmation().forSavedReceipt({ receipt });
    const promotion = () => f.confirmation().notifyPromoted({ registrationIds: [receipt.registrationId] });
    await (promotionFirst ? promotion() : intake()); await (promotionFirst ? intake() : promotion());
    await intake(); await promotion();
    assert.equal(f.state.messages.length, lostAt === 1 ? 0 : 1);
    const current = await createConfirmationRepository({ journal: f.journalFor(f.confirmation().prefix), eventId: EVENT }).read();
    assert.equal(current.value.notices.length, 1); assert.equal(current.value.notices[0].attempt, 1);
  }
});

test('cross-kind explicit retries retain the canonical notice and never retry unknown delivery', async () => {
  for (const providerStatus of ['rejected', 'unknown']) {
    const f = fixture(), receipt = await promotedBeforeNotification(f), c = f.confirmation(); f.state.providerStatus = providerStatus;
    await c.notifyPromoted({ registrationIds: [receipt.registrationId] }); await c.forSavedReceipt({ receipt });
    assert.equal(f.state.messages.length, 1);
    f.state.providerStatus = 'provider_accepted';
    await c.dispatch({ actor, expectedRevision: (await c.settings({ actor })).revision, operationId: operationId(), registrationIds: [receipt.registrationId], retryRejected: true });
    assert.equal(f.state.messages.length, providerStatus === 'rejected' ? 2 : 1);
    const current = await createConfirmationRepository({ journal: f.journalFor(c.prefix), eventId: EVENT }).read();
    assert.equal(current.value.notices.length, 1); assert.equal(current.value.notices[0].kind, 'registration');
    assert.equal(current.value.notices[0].attempt, providerStatus === 'rejected' ? 2 : 1);
  }
});

test('journal replay itself rejects a second confirmed identity across notice kinds', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation(); await c.forSavedReceipt({ receipt: saved.receipt });
  const repository = createConfirmationRepository({ journal: f.journalFor(c.prefix), eventId: EVENT }), current = await repository.read();
  await assert.rejects(repository.append(current, 'reserve', { registrationId: saved.receipt.registrationId, kind: 'promotion',
    admissionStatus: 'confirmed', admissionRevision: 1, retryRejected: false }, actor.id), /unavailable/u);
  assert.equal((await repository.read()).value.revision, current.value.revision); assert.equal(f.state.messages.length, 1);
});

test('withdrawal hides attendee, group and Wallet immediately, and review failure never exposes a stale receipt', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation(), receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  const source = await f.service.repository.readIndex(), original = await f.service.repository.readRecord(source.value.entries[0]);
  f.state.withdrawn.add(saved.receipt.registrationId);
  const result = await c.confirmation({ receiptToken: receipt.receiptToken });
  assert.equal(result.admission.status, 'withdrawn'); assert.deepEqual(result.attendee, { name: '', organization: '' });
  assert.equal(result.groupInvite, null); assert.equal(result.wallet.ready, false);
  const projection = await c.authorizedRegistration(saved.receipt.registrationId); assert.equal(projection.admissionStatus, 'withdrawn'); assert.equal(projection.name, '');
  assert.deepEqual(await f.service.repository.readRecord(source.value.entries[0]), original);
  f.state.reviewFailure = true;
  await assert.rejects(c.confirmation({ receiptToken: receipt.receiptToken }), error => error.code === 'CONFIRMATION_UNAVAILABLE');
});

test('invalid or expired capabilities never inspect private storage or obtain a registration by reference alone', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation(), cap = await c.forSavedReceipt({ receipt: saved.receipt });
  for (const token of [saved.receipt.registrationId, 'c1.a.' + 'b'.repeat(43), cap.receiptToken + 'x']) {
    const before = f.remote.calls.length;
    await assert.rejects(c.authorize({ receiptToken: token }), error => error.code === 'CONFIRMATION_NOT_FOUND');
    assert.equal(f.remote.calls.length, before);
  }
  f.state.now = Date.parse(cap.expiresAt);
  const before = f.remote.calls.length;
  await assert.rejects(c.authorize({ receiptToken: cap.receiptToken }), error => error.code === 'CONFIRMATION_NOT_FOUND');
  assert.equal(f.remote.calls.length, before);
});

test('lost reservation acknowledgement makes no provider request and never resends automatically', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation(); f.state.loseAt = 1;
  const receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  assert.equal(receipt.email.status, 'unknown'); assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, 1);
  assert.equal((await f.confirmation().forSavedReceipt({ receipt: saved.receipt })).email.status, 'unknown');
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, 1);
});

test('lost result acknowledgement and unknown provider output never duplicate a possible external send', async () => {
  for (const lost of [true, false]) {
    const f = fixture(), { saved } = await register(f), c = f.confirmation();
    if (lost) f.state.loseAt = 2; else f.state.providerThrow = true;
    assert.equal((await c.forSavedReceipt({ receipt: saved.receipt })).email.status, 'unknown');
    const replay = await f.confirmation().forSavedReceipt({ receipt: saved.receipt });
    assert.equal(replay.email.status, lost ? 'provider_accepted' : 'unknown'); assert.equal(f.state.messages.length, 1);
  }
});

test('legacy no-email and staff-assisted records do not receive automatic email or invented consent', async () => {
  const f = fixture(), withoutEmail = { ...fields, wechat: 'synthetic-wechat' }; delete withoutEmail.email;
  const submittedAt = new Date(f.state.now).toISOString();
  const saved = await f.service.repository.accept({ keyHash: '1'.repeat(64), payloadHash: '2'.repeat(64), beforeCommit: () => true,
    value: { eventId: EVENT, submittedAt, fields: withoutEmail, consent: { accepted: true, version: policy.privacy.version, acceptedAt: submittedAt }, provenance: { kind: 'public' } } });
  assert.equal(saved.outcome, 'created');
  const c = f.confirmation(), receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  assert.equal(receipt.email.status, 'not_applicable'); assert.equal((await c.confirmation({ receiptToken: receipt.receiptToken })).email.status, 'not_applicable');
  const staff = await f.service.submitStaffRegistration({ sourceContactId: 'synthetic-source', actor,
    input: { fields: { name: '合成受托人', email: 'staff-assisted@example.invalid' }, permissionReference: 'synthetic-owner-permission' } });
  assert.equal(staff.outcome, 'created');
  const result = await c.forSavedReceipt({ receipt: staff.receipt }); assert.equal(result.email.status, 'not_applicable'); assert.equal(f.state.messages.length, 0);
  const batch = await c.dispatch({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [staff.receipt.registrationId] });
  assert.equal(batch.results[0].status, 'not_public'); assert.equal(f.state.messages.length, 0);
});

test('settings and explicit dispatch are revision-bound, actor-bound and replay their durable operation without sends', async () => {
  const f = fixture({ capacity: 3 }), first = await register(f), second = await register(f), c = f.confirmation();
  const deniedCalls = f.remote.calls.length;
  await assert.rejects(c.settings({ actor: { id: 'editor', roles: ['editor'] } }), error => error.code === 'FORBIDDEN');
  assert.equal(f.remote.calls.length, deniedCalls);
  const settings = await c.settings({ actor }); assert.equal(settings.revision, 0);
  const setting = { actor, expectedRevision: 0, operationId: operationId(), enabled: false };
  assert.equal((await c.setSettings(setting)).automaticEnabled, false); const after = f.state.confirmationWrites;
  assert.equal((await c.setSettings(setting)).outcome, 'replayed'); assert.equal(f.state.confirmationWrites, after);
  await assert.rejects(c.setSettings({ ...setting, enabled: true }), error => error.code === 'REVISION_CONFLICT');
  assert.equal((await c.forSavedReceipt({ receipt: first.saved.receipt })).email.status, 'disabled'); assert.equal(f.state.messages.length, 0);
  await c.setSettings({ actor, expectedRevision: (await c.settings({ actor })).revision, operationId: operationId(), enabled: true });
  const command = { actor, expectedRevision: (await c.settings({ actor })).revision, operationId: operationId(), registrationIds: [first.saved.receipt.registrationId, second.saved.receipt.registrationId] };
  const dispatched = await c.dispatch(command); assert.equal(dispatched.status, 'completed'); assert.equal(dispatched.results.length, 2); assert.equal(f.state.messages.length, 2);
  assert.equal((await f.confirmation().dispatch(command)).outcome, 'replayed'); assert.equal(f.state.messages.length, 2);
  await assert.rejects(c.dispatch({ ...command, registrationIds: [...command.registrationIds].reverse() }), error => error.code === 'REVISION_CONFLICT');
  assert.deepEqual((await c.settings({ actor })).counts, { total: 2, providerAccepted: 2, rejected: 0, unknown: 0 });
});

test('explicit known-refusal retry is bounded and unknown batch outcome stops following recipients', async () => {
  const f = fixture({ capacity: 3 }), first = await register(f), second = await register(f), c = f.confirmation();
  f.state.providerStatus = 'rejected'; await c.forSavedReceipt({ receipt: first.saved.receipt }); assert.equal(f.state.messages.length, 1);
  await c.forSavedReceipt({ receipt: first.saved.receipt }); assert.equal(f.state.messages.length, 1, 'public replay never retries a refusal');
  f.state.providerStatus = 'provider_accepted';
  await c.dispatch({ actor, expectedRevision: (await c.settings({ actor })).revision, operationId: operationId(), registrationIds: [first.saved.receipt.registrationId], retryRejected: true });
  assert.equal(f.state.messages.length, 2);
  f.state.providerThrow = true;
  const third = await register(f);
  const result = await c.dispatch({ actor, expectedRevision: (await c.settings({ actor })).revision, operationId: operationId(), registrationIds: [second.saved.receipt.registrationId, third.saved.receipt.registrationId] });
  assert.equal(result.status, 'partial'); assert.deepEqual(result.results.map(item => item.status), ['unknown', 'not_attempted']);
  assert.equal(f.state.messages.length, 3);
});

test('outbox replay rejects a forged mutable result rather than replacing or silently trusting it', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation(); await c.forSavedReceipt({ receipt: saved.receipt });
  const current = await f.journalFor(c.prefix).read(), changed = structuredClone(current.value); changed.notices[0].status = 'unknown';
  const bad = createConfirmationRepository({ eventId: EVENT, journal: { read: async () => ({ cursor: current.cursor, value: changed }), commit: async () => assert.fail('no rewrite') } });
  await assert.rejects(bad.read(), /unavailable/u);
});

test('uncertain batch reservation replay covers every selected ID and never starts an unacknowledged external send', async () => {
  const f = fixture(), first = await register(f), second = await register(f), c = f.confirmation();
  const command = { actor, expectedRevision: 0, operationId: operationId(), registrationIds: [first.saved.receipt.registrationId, second.saved.receipt.registrationId] };
  f.state.loseAt = 1;
  await assert.rejects(c.dispatch(command), error => error.code === 'CONFIRMATION_UNAVAILABLE');
  const replay = await f.confirmation().dispatch(command);
  assert.equal(replay.status, 'unknown'); assert.deepEqual(replay.results, command.registrationIds.map(registrationId => ({ registrationId, status: 'unknown' })));
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, 1);
});

test('pausing automatic delivery after reservation still prevents the external request', async () => {
  const f = fixture(), { saved } = await register(f); let reads = 0, c;
  const registrationService = { ...f.service, async getAdmissionStatus(id) {
    const result = await f.service.getAdmissionStatus(id);
    if (++reads === 2) await c.setSettings({ actor, expectedRevision: 1, operationId: operationId(), enabled: false });
    return result;
  } };
  c = f.confirmation({ registrationService });
  const receipt = await c.forSavedReceipt({ receipt: saved.receipt });
  assert.equal(receipt.email.status, 'rejected'); assert.equal(f.state.messages.length, 0);
  assert.equal((await c.settings({ actor })).automaticEnabled, false);
});

test('manual batch deadline leaves following recipients explicitly unattempted instead of running past the request budget', async () => {
  const f = fixture(), first = await register(f), second = await register(f); let ticks = 0;
  const c = f.confirmation({ batchTimeoutMs: 1500, monotonicNow: () => ticks, emailProvider: {
    readiness: () => ({ ready: true }), async send(input) { f.state.messages.push(input); ticks = 2000; return { status: 'provider_accepted' }; } } });
  const result = await c.dispatch({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [first.saved.receipt.registrationId, second.saved.receipt.registrationId] });
  assert.equal(result.status, 'partial'); assert.deepEqual(result.results.map(item => item.status), ['provider_accepted', 'not_attempted']);
  assert.equal(f.state.messages.length, 1);
});

test('slow registration, reservation or final eligibility reads cannot start a provider request after the budget', async () => {
  for (const stage of ['registration', 'reservation', 'recheck']) {
    const f = fixture(), { saved } = await register(f); let ticks = 0, admissionReads = 0;
    const registrationService = { ...f.service, async getAdmissionStatus(id) {
      const result = await f.service.getAdmissionStatus(id); admissionReads++;
      if (stage === 'registration' && admissionReads === 1 || stage === 'recheck' && admissionReads === 2) ticks = 5000;
      return result;
    } };
    const journalFor = prefix => { const journal = f.journalFor(prefix); return { ...journal, async read() {
      const result = await journal.read(); if (stage === 'reservation') ticks = 5000; return result;
    } }; };
    const c = f.confirmation({ registrationService, journalFor, batchTimeoutMs: 5000, monotonicNow: () => ticks });
    const receipt = await c.forSavedReceipt({ receipt: saved.receipt });
    assert.equal(receipt.email.status, 'pending'); assert.equal(f.state.messages.length, 0);
    const current = await createConfirmationRepository({ journal: f.journalFor(c.prefix), eventId: EVENT }).read();
    assert.equal(current.value.notices.length, stage === 'recheck' ? 1 : 0);
    if (stage === 'recheck') assert.equal(current.value.notices[0].status, 'rejected', 'known unsent reservation stays explicitly retryable');
  }
});

test('promotion readiness and administrative operation writes consume the same deadline as notification', async () => {
  for (const mode of ['promotion', 'dispatch']) {
    const f = fixture(), { saved } = await register(f); let ticks = 0;
    const journalFor = prefix => { const journal = f.journalFor(prefix); return { ...journal, async commit(...args) {
      const result = await journal.commit(...args); ticks = 5000; return result;
    } }; };
    const c = f.confirmation({ journalFor, batchTimeoutMs: 5000, monotonicNow: () => ticks, emailProvider: {
      readiness: async () => { ticks = 5000; return { ready: true }; }, send: async () => assert.fail('expired window cannot send'),
    } });
    const response = mode === 'promotion' ? await c.notifyPromoted({ registrationIds: [saved.receipt.registrationId] })
      : await c.dispatch({ actor, expectedRevision: 0, operationId: operationId(), registrationIds: [saved.receipt.registrationId] });
    assert.deepEqual(response.results.map(item => item.status), ['not_attempted']); assert.equal(f.state.messages.length, 0);
  }
});

test('admin Wallet setup retains only safe missing field names and certificate dates, while public receipts stay minimal', async () => {
  const f = fixture(), c = f.confirmation({ walletReadiness: async () => ({ ready: false, reason: 'WALLET_NOT_CONFIGURED',
    missing: ['ARTDICO_WALLET_BUNDLE_ID', 'PRIVATE-UNSAFE-VALUE'], certificateExpiresAt: '2027-01-01T00:00:00Z', deviceTestRequired: true,
    teamIdentifier: 'PRIVATE-TEAM-VALUE', signerPrivateKey: 'PRIVATE-KEY-VALUE' }) });
  const settings = await c.settings({ actor }); assert.deepEqual(settings.wallet.missing, ['ARTDICO_WALLET_BUNDLE_ID']);
  assert.equal(settings.wallet.certificateExpiresAt, '2027-01-01T00:00:00.000Z'); assert.doesNotMatch(JSON.stringify(settings), /PRIVATE-/u);
  const saved = await register(f), receipt = await c.forSavedReceipt({ receipt: saved.saved.receipt });
  assert.deepEqual((await c.confirmation({ receiptToken: receipt.receiptToken })).wallet, { ready: false, reason: 'WALLET_NOT_CONFIGURED' });
});

test('confirmation provider uses a separate template, never loads disabled configuration and does not leak configuration values', async () => {
  let loads = 0, calls = 0;
  const configuration = { EMAILJS_SERVICE_ID: 'synthetic_service', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic_confirmation', EMAILJS_PUBLIC_KEY: 'synthetic_public',
    EMAILJS_PRIVATE_KEY: 'PRIVATE-SYNTHETIC-KEY', EMAIL_FROM_ADDRESS: 'synthetic@artdico.co', EMAIL_FROM_NAME: '合成活动团队' };
  const disabled = createConfirmationEmailProvider({ env: {}, loadConfiguration: async () => { loads++; return configuration; }, fetchFn: async () => { calls++; throw new Error('unused'); } });
  assert.equal((await disabled.readiness()).ready, false); assert.equal(loads, 0);
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' }, loadConfiguration: async () => { loads++; return configuration; },
    fetchFn: async (_url, options) => { calls++; const value = JSON.parse(options.body); assert.equal(value.template_id, configuration.EMAILJS_CONFIRMATION_TEMPLATE_ID); assert.equal(value.accessToken, configuration.EMAILJS_PRIVATE_KEY); return new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }); } });
  const readiness = await provider.readiness(); assert.equal(readiness.ready, true); assert.doesNotMatch(JSON.stringify(readiness), /PRIVATE-SYNTHETIC|synthetic@|synthetic_service/u);
  const text = '合成确认正文'; const sent = await provider.send({ recipient: fields.email, subject: '合成确认', text, idempotencyKey: 'synthetic_notice', templateVariables: {
    to_name: fields.name, to_email: fields.email, event_title: event.title, event_date: event.date.value, event_time: event.time.label,
    event_venue: event.venue.address, reference_code: 'a'.repeat(43), invitation_text: text } });
  assert.equal(sent.status, 'provider_accepted'); assert.equal(calls, 1);
  const blocked = await provider.send({ recipient: fields.email, subject: '合成确认', text, idempotencyKey: 'synthetic_notice', canStart: () => false, templateVariables: {
    to_name: fields.name, to_email: fields.email, event_title: event.title, event_date: event.date.value, event_time: event.time.label,
    event_venue: event.venue.address, reference_code: 'a'.repeat(43), invitation_text: text } });
  assert.equal(blocked.status, 'rejected'); assert.equal(blocked.reason, 'DELIVERY_WINDOW_EXPIRED'); assert.equal(calls, 1, 'final transport guard runs after asynchronous config load');
  const broken = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' }, loadConfiguration: async () => { throw new Error('PRIVATE-LOAD-ERROR'); }, fetchFn: async () => assert.fail('no network') });
  assert.equal((await broken.readiness()).ready, false); assert.equal((await broken.send({})).status, 'rejected');
});

test('trusted staff notice history is role gated before I/O and exposes only the selected durable metadata', async () => {
  const f = fixture({ capacity: 3 }), first = await register(f), second = await register(f), c = f.confirmation();
  await c.forSavedReceipt({ receipt: first.saved.receipt }); await c.forSavedReceipt({ receipt: second.saved.receipt });
  const deny = async () => assert.fail('history cannot read applications, capabilities or provider configuration');
  const history = f.confirmation({ registrationService: { repository: { readIndex: deny, readRecord: deny }, getAdmissionStatus: deny },
    emailProvider: { readiness: deny, send: deny }, walletReadiness: deny, groupInviteProvider: deny });
  const beforeCalls = f.remote.calls.length, beforeWrites = f.state.confirmationWrites, beforeMessages = f.state.messages.length;
  for (const deniedActor of [undefined, { id: 'outreach', roles: ['outreach'] }, { id: 'editor', roles: ['editor'] }, { id: 'invalid actor', roles: ['reviewer'] }])
    await assert.rejects(history.staffHistory({ actor: deniedActor, registrationId: first.saved.receipt.registrationId }), error => error.code === 'FORBIDDEN');
  for (const id of ['', 'short', 'a'.repeat(44), 'a'.repeat(42) + '/'])
    await assert.rejects(history.staffHistory({ actor, registrationId: id }), error => error.code === 'INVALID_REQUEST');
  assert.equal(f.remote.calls.length, beforeCalls, 'authorization and ID validation precede even journal reads');
  const selected = await history.staffHistory({ actor: { id: 'synthetic-reviewer', roles: ['reviewer'] }, registrationId: first.saved.receipt.registrationId });
  assert.equal(selected.revision, 4); assert.equal(selected.notices.length, 1);
  assert.equal(selected.notices[0].admissionStatus, 'confirmed'); assert.equal(selected.notices[0].status, 'provider_accepted');
  assert.deepEqual(Object.keys(selected).sort(), ['notices', 'revision']);
  assert.deepEqual(Object.keys(selected.notices[0]).sort(), ['admissionStatus', 'attempt', 'createdAt', 'id', 'kind', 'status', 'updatedAt']);
  assert.doesNotMatch(JSON.stringify(selected), /PRIVATE-|private-synthetic@|receiptToken|confirmationUrl|settings|audit|actorId|registrationId/u);
  const absent = await history.staffHistory({ actor, registrationId: 'z'.repeat(43) }); assert.deepEqual(absent.notices, []);
  assert.equal(f.state.confirmationWrites, beforeWrites); assert.equal(f.state.messages.length, beforeMessages);
  assert.equal(f.remote.calls.slice(beforeCalls).every(item => item.method === 'GET'), true, 'staff projection performs only storage reads');
});

test('trusted staff history treats an uncertain reservation as unknown and refuses a forged journal without repair', async () => {
  const f = fixture(), { saved } = await register(f), c = f.confirmation();
  const repository = createConfirmationRepository({ eventId: EVENT, journal: f.journalFor(c.prefix), clock: () => f.state.now });
  const current = await repository.read();
  await repository.append(current, 'reserve', {
    registrationId: saved.receipt.registrationId, kind: 'registration', admissionStatus: 'confirmed', admissionRevision: 1, retryRejected: false }, actor.id);
  const writes = f.state.confirmationWrites;
  const result = await c.staffHistory({ actor, registrationId: saved.receipt.registrationId });
  assert.equal(result.notices[0].status, 'unknown'); assert.equal(result.notices[0].attempt, 1);
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, writes);
  const persisted = await f.journalFor(c.prefix).read(), forged = structuredClone(persisted.value); forged.notices[0].status = 'provider_accepted';
  const bad = f.confirmation({ journalFor: () => ({ read: async () => ({ ...persisted, value: forged }), commit: async () => assert.fail('no journal repair') }) });
  await assert.rejects(bad.staffHistory({ actor, registrationId: saved.receipt.registrationId }), /unavailable/u);
  assert.equal(f.state.messages.length, 0); assert.equal(f.state.confirmationWrites, writes);
});
