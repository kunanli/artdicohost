import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationApi } from '../functions/registration-api/handler.mjs';
import { MAX_REGISTRATION_BYTES, validateRegistrationSubmission } from '../functions/registration-api/validation.mjs';
import { validateRegistrationPolicy } from '../functions/registration-api/policy.mjs';

const origin = 'https://event.example.invalid';
const endpoint = 'https://api.example.invalid/api/registrations';
const key = randomBytes(24).toString('base64url');
const token = 'synthetic.claims.' + randomBytes(32).toString('base64url');
const now = '2026-10-19T12:00:00+08:00';

function policy() {
  return { enabled: true, eventId: 'synthetic-2026', opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T10:00:00+08:00', privacy: {
    version: 'notice-2026-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成参会登记',
    storageRegion: '合成地区', retention: '合成期限', rightsRequest: '通过合成邮箱申请查阅、更正及删除', sharing: '合成资料不对外分享',
  } };
}
function payload() {
  return { eventId: 'synthetic-2026', fields: {
    name: '合成来宾', city: '合成城市', organization: '合成团队', position: '开发者', email: 'PRIVATE-SYNTHETIC@example.invalid',
    categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none',
  }, consent: { accepted: true, version: 'notice-2026-v1' } };
}
function request({ url = endpoint, method = 'POST', body = JSON.stringify(payload()), headers = {}, signal } = {}) {
  return new Request(url, { method, headers: { origin, 'content-type': 'application/json', 'idempotency-key': key, 'x-registration-token': token, ...headers },
    ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body } : {}), ...(body instanceof ReadableStream && method === 'POST' ? { duplex: 'half' } : {}), signal });
}
function spyApi(result = { outcome: 'unavailable' }) {
  const calls = [];
  const service = { async submit(input) { calls.push(input); return result; } };
  return { calls, handle: createRegistrationApi({ allowedOrigins: [origin], submissionService: service }) };
}
async function error(response, status, code) {
  assert.equal(response.status, status);
  const result = await response.json();
  assert.equal(result.error.code, code);
  assert.deepEqual(Object.keys(result), ['error']);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.has('access-control-allow-credentials'), false);
  assert.equal(JSON.stringify(result).includes('PRIVATE-'), false);
  return result;
}

/** Test-only service with real isolated file writes; never imported by a runtime module. */
async function fileService(t) {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-registration-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = { now, policy: policy(), writes: 0 };
  return { directory, state, async submit({ payload: input, idempotencyKey, submissionToken }) {
    if (submissionToken !== token) return { outcome: 'forbidden' };
    const file = join(directory, createHash('sha256').update(idempotencyKey).digest('hex') + '.json');
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      return saved.digest === digest ? { outcome: 'replayed', receipt: saved.receipt } : { outcome: 'conflict' };
    } catch (failure) { if (failure.code !== 'ENOENT') throw failure; }
    const readiness = validateRegistrationPolicy(state.policy, { now: state.now });
    if (!readiness.valid) return { outcome: readiness.errors.enabled || readiness.errors.window ? 'closed' : 'unavailable' };
    const validated = validateRegistrationSubmission(input, { policy: state.policy, now: state.now });
    if (!validated.valid) return { outcome: 'invalid' };
    const receipt = { committed: true, eventId: input.eventId, referenceCode: randomBytes(24).toString('base64url'), committedAt: validated.value.consent.acceptedAt };
    const handle = await open(file, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify({ digest, receipt, registration: validated.value })); await handle.sync(); }
    finally { await handle.close(); }
    state.writes++;
    return { outcome: 'created', receipt: { ...receipt, ignoredPrivateName: input.fields.name }, ignoredPrivateData: input.fields };
  } };
}

test('missing service, unusable method and malformed origin configuration remain unavailable', async () => {
  for (const options of [undefined, {}, { allowedOrigins: [origin] }, { allowedOrigins: [origin], submissionService: { submit: true } }, ...['https://event.example.invalid/', 'http://event.example.invalid', 'https://*.example.invalid', 'https://*'].map(value => ({ allowedOrigins: [value], submissionService: { submit() { assert.fail('Must not run'); } } }))]) {
    await error(await createRegistrationApi(options)(request()), 503, 'UNAVAILABLE');
  }
});

test('exact path, HTTPS, method and explicit allowed origins are enforced without service calls', async () => {
  const { calls, handle } = spyApi();
  for (const url of [endpoint + '/', endpoint + '?name=PRIVATE-SYNTHETIC', endpoint.replace('/api/registrations', '/api/admin/registrations')]) await error(await handle(request({ url })), 404, 'NOT_FOUND');
  const wrongMethod = await handle(request({ method: 'GET' }));
  assert.equal(wrongMethod.headers.get('allow'), 'POST, OPTIONS');
  await error(wrongMethod, 405, 'METHOD_NOT_ALLOWED');
  for (const givenOrigin of ['null', 'http://event.example.invalid', origin + '.attacker.invalid', origin + '/', 'https://other.example.invalid', '']) {
    const response = await handle(request({ headers: { origin: givenOrigin } }));
    assert.equal(response.headers.has('access-control-allow-origin'), false);
    await error(response, 403, 'ORIGIN_REJECTED');
  }
  await error(await handle(request({ url: endpoint.replace('https:', 'http:') })), 403, 'ORIGIN_REJECTED');
  assert.equal(calls.length, 0);
});

test('CORS preflight only permits POST and the explicit header list, with no credentials', async () => {
  const { calls, handle } = spyApi();
  const response = await handle(request({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'Content-Type, Idempotency-Key, X-Registration-Token' } }));
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST');
  assert.equal(response.headers.get('access-control-allow-headers'), 'Content-Type, Idempotency-Key, X-Registration-Token');
  assert.equal(response.headers.has('access-control-allow-credentials'), false);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  await error(await handle(request({ method: 'OPTIONS', headers: { 'access-control-request-method': 'PUT' } })), 403, 'PREFLIGHT_REJECTED');
  await error(await handle(request({ method: 'OPTIONS', headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'Authorization' } })), 403, 'PREFLIGHT_REJECTED');
  assert.equal(calls.length, 0);
});

test('media type, encoding, key and token syntax are checked before submit', async () => {
  const { calls, handle } = spyApi();
  for (const contentType of ['text/plain', 'application/json; charset=gbk', 'application/json; PRIVATE-param=1', '']) await error(await handle(request({ headers: { 'content-type': contentType } })), 415, 'UNSUPPORTED_MEDIA_TYPE');
  await error(await handle(request({ headers: { 'content-encoding': 'gzip' } })), 415, 'UNSUPPORTED_MEDIA_TYPE');
  for (const value of ['', 'short', 'x'.repeat(129), 'x'.repeat(32) + ',other', 'PRIVATE- invalid']) await error(await handle(request({ headers: { 'idempotency-key': value } })), 400, 'INVALID_HEADERS');
  for (const value of ['', 'unsigned', 'a.b.short', 'a.b.' + 'x'.repeat(4096), token + ',other']) await error(await handle(request({ headers: { 'x-registration-token': value } })), 400, 'INVALID_HEADERS');
  await handle(request({ headers: { 'content-type': 'application/json; charset="UTF-8"' } }));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]), ['payload', 'idempotencyKey', 'submissionToken', 'origin']);
});

test('raw bytes are limited before JSON parsing, including untrusted length and streamed overflow', async () => {
  const { calls, handle } = spyApi();
  await error(await handle(request({ headers: { 'content-length': String(MAX_REGISTRATION_BYTES + 1) } })), 413, 'BODY_TOO_LARGE');
  for (const contentLength of ['-1', '1.5', '1,2', 'PRIVATE-LENGTH']) await error(await handle(request({ headers: { 'content-length': contentLength } })), 400, 'INVALID_HEADERS');
  await error(await handle(request({ headers: { 'content-length': '1' } })), 400, 'INVALID_HEADERS');
  let cancelled = false;
  const oversized = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_REGISTRATION_BYTES)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await error(await handle(request({ body: oversized })), 413, 'BODY_TOO_LARGE');
  assert.equal(cancelled, true);
  const inflatedWhitespace = ' '.repeat(MAX_REGISTRATION_BYTES) + JSON.stringify(payload());
  await error(await handle(request({ body: inflatedWhitespace })), 413, 'BODY_TOO_LARGE');
  assert.equal(calls.length, 0);
});

test('fatal UTF-8, malformed JSON, primitive roots and aborted requests cannot reach the service', async () => {
  const { calls, handle } = spyApi();
  for (const body of ['{PRIVATE-INVALID', 'null', '[]', '"PRIVATE-TEXT"', '', new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])]) await error(await handle(request({ body })), 400, 'INVALID_JSON');
  const controller = new AbortController(); controller.abort();
  await error(await handle(request({ signal: controller.signal })), 400, 'INVALID_JSON');
  const duringRead = new AbortController();
  const interrupted = new ReadableStream({ pull(stream) { duringRead.abort(); stream.enqueue(new TextEncoder().encode(JSON.stringify(payload()))); stream.close(); } }, { highWaterMark: 0 });
  await error(await handle(request({ body: interrupted, signal: duringRead.signal })), 400, 'INVALID_JSON');
  assert.equal(calls.length, 0);
});

test('throws, unknown outcomes and incomplete or mismatching receipts never claim successful persistence', async () => {
  const receipt = { committed: true, eventId: 'synthetic-2026', referenceCode: randomBytes(24).toString('base64url'), committedAt: now };
  for (const result of [true, undefined, { reference_code: key }, { outcome: 'created' }, { outcome: 'created', receipt: { ...receipt, committed: 'true' } }, { outcome: 'created', receipt: { ...receipt, eventId: 'different-event' } }, { outcome: 'created', receipt: { ...receipt, referenceCode: '123' } }, { outcome: 'created', receipt: { ...receipt, committedAt: '2026-02-30T00:00:00Z' } }, { outcome: 'created', receipt: { ...receipt, committed: false } }, { outcome: 'unknown', receipt }]) {
    const { handle } = spyApi(result);
    await error(await handle(request()), 503, 'UNAVAILABLE');
  }
  const handle = createRegistrationApi({ allowedOrigins: [origin], submissionService: { submit() { throw new Error('PRIVATE-SYNTHETIC backend/path'); } } });
  await error(await handle(request()), 503, 'UNAVAILABLE');
});

test('service refusal outcomes have fixed, private responses and never expose supplied diagnostics', async () => {
  for (const [outcome, status, code] of [['invalid', 422, 'INVALID_SUBMISSION'], ['conflict', 409, 'CONFLICT'], ['closed', 409, 'CLOSED'], ['rate_limited', 429, 'RATE_LIMITED'], ['forbidden', 403, 'FORBIDDEN'], ['withdrawn', 410, 'WITHDRAWN'], ['unavailable', 503, 'UNAVAILABLE']]) {
    const { handle } = spyApi({ outcome, message: 'PRIVATE-SYNTHETIC-DIAGNOSTIC', fields: payload().fields });
    const response = await handle(request());
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    await error(response, status, code);
  }
});

test('201 follows an actual synced synthetic file; saved retries after closing replay without rewriting', async t => {
  const service = await fileService(t);
  const handle = createRegistrationApi({ allowedOrigins: [origin], submissionService: service });
  const created = await handle(request());
  assert.equal(created.status, 201);
  const body = await created.json();
  assert.deepEqual(Object.keys(body), ['status', 'reference_code', 'groupInvite']);
  assert.equal(body.groupInvite, null);
  assert.equal(body.status, 'registered');
  assert.match(body.reference_code, /^[A-Za-z0-9_-]{32}$/u);
  assert.equal(JSON.stringify(body).includes('PRIVATE-'), false);
  const files = await readdir(service.directory);
  assert.equal(files.length, 1);
  const saved = JSON.parse(await readFile(join(service.directory, files[0]), 'utf8'));
  assert.equal(saved.receipt.referenceCode, body.reference_code);
  assert.equal(saved.registration.fields.email, 'PRIVATE-SYNTHETIC@example.invalid');
  service.state.now = '2026-12-06T00:00:00+08:00';
  const replayed = await handle(request());
  assert.equal(replayed.status, 200);
  assert.deepEqual(await replayed.json(), body);
  assert.equal(service.state.writes, 1);
  await error(await handle(request({ headers: { 'idempotency-key': randomBytes(24).toString('base64url') } })), 409, 'CLOSED');
  const changed = payload(); changed.fields.city = '不同合成城市';
  await error(await handle(request({ body: JSON.stringify(changed) })), 409, 'CONFLICT');
  assert.equal(service.state.writes, 1);
  assert.equal((await readdir(service.directory)).length, 1);
});

test('disabled or incomplete policies and invalid business fields never produce a synthetic file', async t => {
  const service = await fileService(t);
  const handle = createRegistrationApi({ allowedOrigins: [origin], submissionService: service });
  service.state.policy.enabled = false;
  await error(await handle(request()), 409, 'CLOSED');
  service.state.policy = policy(); delete service.state.policy.privacy.processor;
  await error(await handle(request()), 503, 'UNAVAILABLE');
  service.state.policy = policy();
  const invalid = payload(); invalid.consent.accepted = 'true';
  await error(await handle(request({ body: JSON.stringify(invalid) })), 422, 'INVALID_SUBMISSION');
  assert.equal(service.state.writes, 0);
  assert.deepEqual(await readdir(service.directory), []);
});

const inviteOrigin = 'https://qr.example.invalid';
function invite(overrides = {}) {
  return { platform: 'wechat', qrImageUrl: inviteOrigin + '/group.png?signature=synthetic', expiresAt: '2026-10-20T00:00:00+08:00', ...overrides };
}
function inviteResult(overrides = {}) {
  return { outcome: 'created', receipt: { committed: true, eventId: 'synthetic-2026', referenceCode: key, committedAt: now }, groupInvite: invite(), ...overrides };
}
function inviteApi(result, options = {}) {
  return createRegistrationApi({ allowedOrigins: [origin], submissionService: { async submit() { return result; } }, allowedGroupInviteOrigins: [inviteOrigin], clock: () => now, ...options });
}

test('waitlisted durable receipts retain creation/replay semantics while suppressing all group invitations', async () => {
  for (const outcome of ['created', 'replayed']) {
    const result = inviteResult({ outcome });
    Object.assign(result.receipt, { admissionStatus: 'waitlisted', admissionKind: 'attendee', admissionRevision: 3, privateQueue: 'PRIVATE-SYNTHETIC' });
    const response = await inviteApi(result)(request()), value = await response.json();
    assert.equal(response.status, outcome === 'created' ? 201 : 200);
    assert.equal(value.status, 'waitlisted'); assert.equal(value.reference_code, key); assert.equal(value.groupInvite, null);
    assert.equal(value.admissionStatus, 'waitlisted'); assert.equal(value.admissionKind, 'attendee'); assert.equal(value.admissionRevision, 3);
    assert.doesNotMatch(JSON.stringify(value), /PRIVATE-SYNTHETIC/u);
  }
  for (const admission of [{ admissionStatus: 'unknown' }, { admissionStatus: 'confirmed', admissionKind: 'crew', admissionRevision: 'PRIVATE' },
    { admissionStatus: 'withdrawn', admissionKind: 'attendee', admissionRevision: 1 }, { admissionKind: 'crew' }]) {
    const result = inviteResult(); Object.assign(result.receipt, admission);
    await error(await inviteApi(result)(request()), 503, 'UNAVAILABLE');
  }
});

test('committed creation and saved retries project only the current unexpired service invite', async t => {
  const stored = await fileService(t);
  let currentInvite = invite({ privateContact: 'PRIVATE-SYNTHETIC', instructionsHtml: '<b>PRIVATE-SYNTHETIC</b>' });
  const service = { async submit(input) { return { ...await stored.submit(input), groupInvite: currentInvite }; } };
  const handle = createRegistrationApi({ allowedOrigins: [origin], submissionService: service, allowedGroupInviteOrigins: [inviteOrigin], clock: () => stored.state.now });
  const created = await handle(request());
  assert.equal(created.status, 201);
  const first = await created.json();
  assert.deepEqual(first.groupInvite, invite());
  assert.deepEqual(Object.keys(first.groupInvite), ['platform', 'qrImageUrl', 'expiresAt']);
  assert.equal(JSON.stringify(first).includes('PRIVATE-'), false);
  stored.state.now = '2026-12-06T00:00:00+08:00';
  const expired = await handle(request());
  assert.equal(expired.status, 200);
  assert.equal((await expired.json()).groupInvite, null);
  currentInvite = invite({ qrImageUrl: inviteOrigin + '/new.png?signature=synthetic-new', expiresAt: '2026-12-07T00:00:00+08:00' });
  const replayed = await handle(request());
  assert.equal(replayed.status, 200);
  const replay = await replayed.json();
  assert.equal(replay.reference_code, first.reference_code);
  assert.deepEqual(replay.groupInvite, currentInvite);
  assert.equal(stored.state.writes, 1);
});

test('missing, malformed and expired invites do not reverse a committed registration', async () => {
  const invalidInvites = [undefined, null, false, invite({ platform: 'other' }), invite({ qrImageUrl: 123 }),
    ...['http://qr.example.invalid/group.png', 'https:qr.example.invalid/group.png', 'javascript:alert(1)', 'data:image/png;base64,synthetic', '/group.png', 'https://qr.example.invalid.attacker.invalid/group.png', 'https://user:password@qr.example.invalid/group.png', inviteOrigin + '/group.png#', inviteOrigin + '/group.png#PRIVATE-SYNTHETIC', inviteOrigin + '/group image.png', inviteOrigin + '/group\n.png', 'https:\\qr.example.invalid/group.png', inviteOrigin + ':8443/group.png', inviteOrigin + '/' + 'x'.repeat(4096)].map(qrImageUrl => invite({ qrImageUrl })),
    ...[null, 123, '2026-02-30T00:00:00Z', '2026-10-20T00:00:00', now, '2026-10-18T00:00:00Z'].map(expiresAt => invite({ expiresAt })),
  ];
  for (const groupInvite of invalidInvites) {
    const response = await inviteApi(inviteResult({ groupInvite }))(request());
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.status, 'registered');
    assert.equal(body.reference_code, key);
    assert.equal(body.groupInvite, null);
  }
});

test('invite clock and exact HTTPS allowlist failures omit the QR without changing successful status', async () => {
  for (const options of [{ clock: undefined }, { clock: null }, { clock: () => null }, { clock: () => NaN }, { clock: () => '2026-10-19T12:00:00' }, { clock() { throw new Error('PRIVATE-CLOCK'); } }, { clock: async () => { throw new Error('PRIVATE-ASYNC-CLOCK'); } },
    ...[undefined, [], ['http://qr.example.invalid'], ['https://*.example.invalid'], [inviteOrigin + '/']].map(allowedGroupInviteOrigins => ({ allowedGroupInviteOrigins }))]) {
    const response = await inviteApi(inviteResult(), options)(request());
    assert.equal(response.status, 201);
    assert.equal((await response.json()).groupInvite, null);
  }
  const numericClock = await inviteApi(inviteResult(), { clock: () => Date.parse(now) })(request());
  assert.deepEqual((await numericClock.json()).groupInvite, invite());
});

test('failure outcomes, invalid receipts and client-provided group codes never release an invite', async t => {
  let clockCalls = 0;
  const clock = () => { clockCalls++; return now; };
  for (const result of [inviteResult({ outcome: 'unavailable' }), inviteResult({ receipt: { committed: false } }), inviteResult({ outcome: 'invalid' })]) {
    const response = await inviteApi(result, { clock })(request());
    assert.ok([422, 503].includes(response.status));
    const body = await response.json();
    assert.equal(Object.hasOwn(body, 'groupInvite'), false);
    assert.equal(JSON.stringify(body).includes(inviteOrigin), false);
  }
  assert.equal(clockCalls, 0);
  const stored = await fileService(t);
  const service = { async submit(input) { const result = await stored.submit(input); return { ...result, receipt: { ...result.receipt, groupInvite: invite() } }; } };
  const handle = createRegistrationApi({ allowedOrigins: [origin], submissionService: service, allowedGroupInviteOrigins: [inviteOrigin], clock });
  const forged = payload(); forged.groupInvite = invite(); forged.fields.groupInvite = invite();
  const response = await handle(request({ body: JSON.stringify(forged) }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).groupInvite, null);
  assert.equal(stored.state.writes, 1);
  assert.equal(clockCalls, 0);
});
