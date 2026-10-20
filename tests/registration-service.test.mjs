import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createRegistrationApi } from '../functions/registration-api/handler.mjs';
import { createRegistrationTokens } from '../functions/registration-api/tokens.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const ORIGIN = 'https://registration.example.invalid';
const EVENT = 'synthetic-registration-2026';
const SECRET = 'PRIVATE-SYNTHETIC-SHARED-REGISTRATION-KEY-ONLY';
const at = Date.parse('2026-10-20T04:00:00Z');
const makeKey = () => randomBytes(32).toString('base64url');
function policy() {
  return { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00', privacy: {
    version: 'notice-2026-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成参会登记', storageRegion: '合成地区',
    retention: '合成期限', rightsRequest: '通过合成邮箱申请查阅、更正及删除', sharing: '合成资料不对外分享',
  } };
}
function payload() {
  return { eventId: EVENT, fields: { name: '合成来宾', city: '合成城市', organization: '合成团队', position: '开发者', email: 'PRIVATE-SYNTHETIC@example.invalid',
    categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' },
  consent: { accepted: true, version: 'notice-2026-v1' } };
}
function fixture(options = {}) {
  const remote = objectFixture(), state = { now: at, loseIndexAck: false, indexAppends: 0 };
  function service(patch = {}) {
    const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
    const objects = { ...base, async append(key, position, data) {
      const result = await base.append(key, position, data);
      if (key.endsWith('/index/commits.jsonl')) {
        state.indexAppends++;
        if (state.loseIndexAck) { state.loseIndexAck = false; throw new Error('PRIVATE-SYNTHETIC-LOST-ACK'); }
      }
      return result;
    } };
    return createRegistrationService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), policy: policy(), capacity: 300,
      tokenSecret: SECRET, allowedOrigins: [ORIGIN], clock: () => state.now, ...options, ...patch });
  }
  return { remote, state, service };
}
async function submission(service, key = makeKey(), input = payload()) {
  const issued = await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: key });
  assert.equal(issued.outcome, 'issued');
  return { payload: input, origin: ORIGIN, idempotencyKey: key, submissionToken: issued.submissionToken };
}

test('signed tokens bind event, origin and key, reject noncanonical/tampered tokens and enforce expiry', () => {
  const tokens = createRegistrationTokens({ secret: SECRET, eventId: EVENT }), key = makeKey();
  const issued = tokens.issue({ origin: ORIGIN, idempotencyKey: key, now: at });
  const input = { token: issued.submissionToken, origin: ORIGIN, idempotencyKey: key, now: at };
  assert.equal(tokens.verify(input), true);
  for (const patch of [{ token: issued.submissionToken + '=' }, { token: issued.submissionToken.slice(0, -1) + '!' }, { origin: 'https://foreign.example.invalid' },
    { idempotencyKey: makeKey() }, { now: at - 1 }, { now: at + 600000 }]) assert.equal(tokens.verify({ ...input, ...patch }), false);
  assert.equal(tokens.verify({ ...input, now: at + 600000, allowExpired: true }), true);
  assert.throws(() => createRegistrationTokens({ secret: 'short', eventId: EVENT }), error => !error.message.includes('short'));
});

test('two independent storage clients save exactly one registration for same-key races and return one durable receipt', async () => {
  const f = fixture(), first = f.service(), second = f.service(), input = await submission(first);
  const results = await Promise.all([first.submit(input), second.submit(input)]);
  assert.deepEqual(results.map(value => value.outcome).sort(), ['created', 'replayed']);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  const saved = await f.service().repository.list();
  assert.equal(saved.registrations.length, 1); assert.equal(saved.revision, 1);
  assert.equal(saved.registrations[0].fields.email, payload().fields.email);
  assert.deepEqual(saved.registrations[0].provenance, { kind: 'public' });
  assert.equal(saved.registrations[0].consent.acceptedAt, new Date(at).toISOString());
  assert.equal(JSON.stringify(results).includes('PRIVATE-'), false);
});

test('same-key changed content conflicts, and saved replay survives cutoff/token expiry without another write', async () => {
  const f = fixture(), service = f.service(), input = await submission(service);
  const created = await service.submit(input); assert.equal(created.outcome, 'created');
  const changed = structuredClone(input); changed.payload.fields.name = '另一合成来宾';
  assert.equal((await f.service().submit(changed)).outcome, 'conflict');
  const appends = f.remote.calls.filter(call => call.method === 'POST').length;
  f.state.now = Date.parse(policy().closesAt) + 1000;
  const replay = await f.service().submit(input);
  assert.equal(replay.outcome, 'replayed'); assert.deepEqual(replay.receipt, created.receipt);
  assert.equal(f.remote.calls.filter(call => call.method === 'POST').length, appends);
  const renewed = await f.service().issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: input.idempotencyKey });
  assert.equal(renewed.outcome, 'issued');
  assert.equal((await f.service().issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: makeKey() })).outcome, 'closed');
});

test('capacity is one atomic index gate across concurrent different keys', async () => {
  const f = fixture({ capacity: 1 }), a = f.service(), b = f.service();
  const inputs = await Promise.all([submission(a), submission(b)]);
  const results = await Promise.all([a.submit(inputs[0]), b.submit(inputs[1])]);
  assert.deepEqual(results.map(value => value.outcome).sort(), ['closed', 'created']);
  assert.equal((await a.repository.list()).registrations.length, 1);
  assert.deepEqual(await a.metadata(), { enabled: false, reason: 'closed' });
});

test('a lost index append ACK returns unavailable once and the same key later replays proven storage', async () => {
  const f = fixture(), first = f.service(), input = await submission(first);
  f.state.loseIndexAck = true;
  const unknown = await first.submit(input);
  assert.deepEqual(unknown, { outcome: 'unavailable' }); assert.equal(f.state.indexAppends, 1);
  const replay = await f.service().submit(input);
  assert.equal(replay.outcome, 'replayed'); assert.equal(replay.receipt.committed, true); assert.equal(f.state.indexAppends, 1);
});

test('rate budgets persist between independent clients, while invalid tokens never touch storage', async () => {
  const f = fixture({ tokenLimit: 1 }), first = f.service(), second = f.service();
  const calls = f.remote.calls.length;
  assert.deepEqual(await first.submit({ payload: payload(), origin: ORIGIN, idempotencyKey: makeKey(), submissionToken: 'PRIVATE-invalid' }), { outcome: 'forbidden' });
  assert.equal(f.remote.calls.length, calls);
  await submission(first);
  const limited = await second.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: makeKey() });
  assert.equal(limited.outcome, 'rate_limited'); assert.ok(limited.retryAfter >= 1);
  f.state.now += 15 * 60 * 1000;
  assert.equal((await second.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: makeKey() })).outcome, 'issued');
});

test('corrupt or absent immutable accepted records fail closed instead of returning a receipt or empty list', async () => {
  const f = fixture(), service = f.service(), input = await submission(service);
  assert.equal((await service.submit(input)).outcome, 'created');
  const key = [...f.remote.stored.keys()].find(value => value.includes('/records/'));
  f.remote.stored.get(key).data = Buffer.from('PRIVATE-SYNTHETIC-CORRUPTION');
  assert.deepEqual(await f.service().submit(input), { outcome: 'unavailable' });
  await assert.rejects(f.service().repository.list(), error => error.message === 'Registration storage is unavailable.');
});

test('staff intake preserves partial known facts, source and operator without fabricating applicant consent', async () => {
  const f = fixture({ capacity: 2 }), service = f.service();
  const input = { sourceContactId: 'synthetic-contact', actor: { id: 'synthetic-reviewer', roles: ['reviewer'] },
    input: { fields: { name: '合成来宾', wechat: 'synthetic-known-contact' }, permissionReference: '合成既有联络授权记录' } };
  const created = await service.submitStaffRegistration(input); assert.equal(created.outcome, 'created');
  assert.equal((await f.service().submitStaffRegistration(input)).outcome, 'replayed');
  const lookedUp = await f.service().getStaffRegistrationBySource(input);
  assert.equal(lookedUp.outcome, 'found'); assert.equal(lookedUp.receipt.registrationId, created.receipt.registrationId);
  const record = (await service.repository.list()).registrations[0];
  assert.deepEqual(record.fields, { name: '合成来宾', wechat: 'synthetic-known-contact' });
  assert.deepEqual(record.consent, { accepted: false, acceptedAt: null, version: null });
  assert.equal(record.provenance.sourceContactId, input.sourceContactId);
  assert.equal(record.provenance.actorId, input.actor.id);
  assert.equal((await service.submitStaffRegistration({ ...input, actor: { id: 'editor', roles: ['editor'] } })).outcome, 'forbidden');
  assert.equal((await service.submitStaffRegistration({ ...input, sourceContactId: 'other', input: { ...input.input, fields: { name: '缺联络' } } })).outcome, 'invalid');
  assert.equal((await service.submit(await submission(service))).outcome, 'created');
  assert.equal((await service.submitStaffRegistration({ ...input, sourceContactId: 'third' })).outcome, 'closed');
});

test('public metadata and token endpoints project only approved configuration and never private values', async () => {
  const f = fixture({ policy: { ...policy(), arbitrarySecret: 'PRIVATE-UNRELATED-CONFIG' } }), service = f.service();
  const api = createRegistrationApi({ allowedOrigins: [ORIGIN], submissionService: service, clock: () => f.state.now });
  const get = await api(new Request('https://api.example.invalid/api/registration/config', { headers: { origin: ORIGIN } }));
  assert.equal(get.status, 200); const config = await get.json(); assert.equal(config.enabled, true); assert.equal(config.capacity, 300);
  assert.equal(JSON.stringify(config).includes('PRIVATE-'), false);
  const idempotencyKey = makeKey();
  const token = await api(new Request('https://api.example.invalid/api/registration/token', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ eventId: EVENT, idempotencyKey }) }));
  assert.equal(token.status, 200); const issued = await token.json(); assert.deepEqual(Object.keys(issued).sort(), ['eventId', 'expiresAt', 'submissionToken']);
  const response = await api(new Request('https://api.example.invalid/api/registrations', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': idempotencyKey, 'x-registration-token': issued.submissionToken }, body: JSON.stringify(payload()) }));
  assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.status, 'registered'); assert.equal(JSON.stringify(saved).includes('PRIVATE-'), false);
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(response.headers.has('access-control-allow-credentials'), false);
  const foreign = await api(new Request('https://api.example.invalid/api/registration/config', { headers: { origin: 'https://foreign.example.invalid' } }));
  assert.equal(foreign.status, 403); assert.equal(foreign.headers.has('access-control-allow-origin'), false);
});

test('disabled/incomplete policies and malformed new submissions cannot be unlocked by browser flags', async () => {
  const f = fixture({ policy: { enabled: false, eventId: EVENT } }), service = f.service();
  assert.deepEqual(await service.metadata(), { enabled: false, reason: 'unavailable' });
  assert.equal((await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: makeKey() })).outcome, 'closed');
  assert.equal([...f.remote.stored.keys()].length, 0);
  const ready = fixture(), active = ready.service(), invalid = await submission(active);
  invalid.payload.consent.accepted = false;
  assert.equal((await active.submit(invalid)).outcome, 'invalid');
  assert.equal([...ready.remote.stored.keys()].some(key => key.includes('/records/')), false);
});
