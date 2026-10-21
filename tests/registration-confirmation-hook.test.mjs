import test from 'node:test';
import assert from 'node:assert/strict';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createRegistrationApi } from '../functions/registration-api/handler.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const ORIGIN = 'https://artdico.host', EVENT = 'synthetic-confirmation-2026', NOW = Date.parse('2026-10-21T00:00:00Z');
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00', privacy: {
  version: 'notice-2026-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成报名确认', storageRegion: '合成地区',
  retention: '合成期限', rightsRequest: '通过合成邮箱申请更正及删除', sharing: '合成资料不对外分享',
} };
const payload = { eventId: EVENT, fields: { name: '合成参会者', city: '合成城市', email: 'synthetic@example.invalid', categories: ['other'],
  participationInterests: ['attend'], attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' },
consent: { accepted: true, version: policy.privacy.version } };
const receiptToken = 'c1.' + 'a'.repeat(43) + '.' + 'b'.repeat(43);
const confirmation = { receiptToken, confirmationUrl: 'https://artdico.host/registration/confirmation/#r=' + receiptToken,
  expiresAt: '2026-12-12T00:00:00Z', email: { status: 'not_configured' } };
function setup(onSaved) {
  const fixture = objectFixture(), state = { loseAck: false };
  const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(NOW), fetchFn: fixture.fetchFn });
  const objects = { ...base, async append(key, position, data) {
    const saved = await base.append(key, position, data);
    if (state.loseAck && key.endsWith('/index/commits.jsonl')) { state.loseAck = false; throw new Error('SYNTHETIC_LOST_ACK'); }
    return saved;
  } };
  const service = createRegistrationService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), policy, capacity: 300,
    tokenSecret: 'SYNTHETIC_CONFIRMATION_INDEPENDENT_SERVER_SECRET_1234567890', allowedOrigins: [ORIGIN], clock: () => NOW, onSaved });
  return { fixture, state, service };
}
async function input(service, suffix = 'a') {
  const key = suffix.repeat(43), token = await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: key });
  assert.equal(token.outcome, 'issued');
  return { payload, origin: ORIGIN, idempotencyKey: key, submissionToken: token.submissionToken };
}

test('confirmation hook runs after a proven public record and cannot mutate or undo the saved receipt', async () => {
  let calls = 0, f;
  f = setup(async context => {
    calls++; assert.equal((await f.service.repository.list()).registrations.length, 1);
    assert.equal(context.provenance.kind, 'public'); assert.equal(context.origin, ORIGIN); assert.equal(context.notify, false);
    context.receipt.committed = false;
    if (calls === 1) throw new Error('SYNTHETIC_DELIVERY_UNAVAILABLE');
    return confirmation;
  });
  const request = await input(f.service), saved = await f.service.submit(request);
  assert.equal(saved.outcome, 'created'); assert.equal(saved.receipt.committed, true); assert.equal(saved.confirmation, undefined);
  const replayed = await f.service.submit(request);
  assert.equal(replayed.outcome, 'replayed'); assert.equal(replayed.receipt.committed, true); assert.deepEqual(replayed.confirmation, confirmation);
  await f.service.submitStaffRegistration({ sourceContactId: 'synthetic-source', actor: { id: 'synthetic-reviewer', roles: ['reviewer'] },
    input: { fields: { name: '合成代登记', wechat: 'synthetic-wechat' }, permissionReference: 'synthetic-permission' } });
  assert.equal(calls, 2, 'staff intake does not automatically contact another person');
});

test('unknown registration acknowledgement never runs optional delivery until an explicit proven replay', async () => {
  let calls = 0;
  const f = setup(async () => { calls++; return confirmation; }), request = await input(f.service);
  f.state.loseAck = true;
  assert.deepEqual(await f.service.submit(request), { outcome: 'unavailable' }); assert.equal(calls, 0);
  const replayed = await f.service.submit(request);
  assert.equal(replayed.outcome, 'replayed'); assert.equal(calls, 1);
  assert.equal((await f.service.repository.list()).registrations.length, 1);
});

test('HTTP keeps a valid saved receipt and exposes only exact safe confirmation fields', async () => {
  const receipt = { committed: true, eventId: EVENT, registrationId: 'r'.repeat(43), referenceCode: 'r'.repeat(43), committedAt: new Date(NOW).toISOString(),
    admissionStatus: 'pending_review', admissionKind: 'attendee', admissionRevision: 1 };
  const send = async child => {
    const handler = createRegistrationApi({ allowedOrigins: [ORIGIN], clock: () => NOW,
      submissionService: { submit: async () => ({ outcome: 'created', receipt, confirmation: child }) } });
    const response = await handler(new Request('https://api.artdico.host/api/registrations', { method: 'POST', headers: {
      origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': 'k'.repeat(43), 'x-registration-token': 'a.b.' + 'c'.repeat(43),
    }, body: JSON.stringify({ eventId: EVENT }) }));
    assert.equal(response.status, 201); return response.json();
  };
  const valid = await send({ ...confirmation, privateKey: 'SYNTHETIC_PRIVATE', email: { ...confirmation.email, recipient: 'private@example.invalid' } });
  assert.deepEqual(valid.confirmation, confirmation); assert.doesNotMatch(JSON.stringify(valid), /SYNTHETIC_PRIVATE|private@example/u);
  for (const child of [{ ...confirmation, confirmationUrl: 'https://foreign.example.invalid/#r=' + receiptToken },
    { ...confirmation, expiresAt: '2026-01-01T00:00:00Z' }, { ...confirmation, email: { status: 'delivered' } }]) {
    const result = await send(child); assert.equal(result.status, 'pending_review'); assert.equal(result.confirmation, undefined);
  }
});
