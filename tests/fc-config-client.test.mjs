import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFcConfigClient, summarizeFcConfigError } from '../scripts/fc-config-client.mjs';

const ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com';
const FUNCTION_PATH = '/2023-03-30/functions/artdicohost-api';
const CREDENTIALS = { accessKeyId: 'SYNTHETICKEY', accessKeySecret: 'synthetic-access-secret' };
const CLOCK = () => new Date('2026-10-20T04:00:00Z');
const NONCE = () => '0123456789abcdef0123456789abcdef';
const ENVIRONMENT = () => ({ ARTDICO_CLOUD_CONTENT_ENABLED: 'false', KEEP_PRIVATE: 'PRIVATE-SYNTHETIC-KEEP' });
const TRIGGER_URL = 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/';
const SIGNED_NAMES = 'content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';

function json(body = { functionName: 'artdicohost-api' }, options = {}) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...options });
}

function fixture(reply = () => json(), options = {}) {
  const calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    return reply(url, settings);
  };
  return { calls, client: createFcConfigClient({ credentials: CREDENTIALS, clock: CLOCK, nonce: NONCE, fetchFn, ...options }) };
}

async function safelyRejected(operation) {
  let caught;
  await assert.rejects(operation, error => {
    caught = error;
    assert.match(error.message, /^FC configuration (?:request failed|client is invalid)/u);
    for (const forbidden of ['PRIVATE-', CREDENTIALS.accessKeyId, CREDENTIALS.accessKeySecret, 'synthetic-security-token']) {
      assert.equal(String(error.stack).includes(forbidden), false);
      assert.equal(JSON.stringify(error).includes(forbidden), false);
    }
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  return caught;
}

test('configuration update matches an independent Python ACS3 vector and sends only environmentVariables', async () => {
  const { client, calls } = fixture(() => json({ functionName: 'artdicohost-api', environmentVariables: { PRIVATE_SYNTHETIC_RESPONSE: 'PRIVATE-REMOTE' } }));
  assert.deepEqual(await client.updateEnvironment(ENVIRONMENT()), { acknowledged: true });
  assert.equal(calls.length, 1);
  const { url, settings } = calls[0];
  assert.equal(url, ENDPOINT + FUNCTION_PATH);
  assert.equal(settings.method, 'PUT');
  assert.equal(settings.body, '{"environmentVariables":{"ARTDICO_CLOUD_CONTENT_ENABLED":"false","KEEP_PRIVATE":"PRIVATE-SYNTHETIC-KEEP"}}');
  assert.deepEqual(JSON.parse(settings.body), { environmentVariables: ENVIRONMENT() });
  assert.equal(settings.headers['x-acs-action'], 'UpdateFunction');
  assert.equal(settings.headers['x-acs-date'], '2026-10-20T04:00:00Z');
  assert.equal(settings.headers['x-acs-version'], '2023-03-30');
  assert.equal(settings.headers['x-acs-content-sha256'], 'ca640203a36818320da9943322cafeab967312d4fc74a2e8005a6cf5c2f82251');
  assert.equal(settings.headers['x-acs-content-sha256'], createHash('sha256').update(settings.body).digest('hex'));
  // Independently computed with Python hashlib/hmac using the documented ACS3 formula.
  assert.equal(settings.headers.authorization, `ACS3-HMAC-SHA256 Credential=SYNTHETICKEY,SignedHeaders=${SIGNED_NAMES},Signature=869df37dc4a09088c26caf87ea9b10261cdf72e493ee40028d11029838b0e0eb`);
  assert.equal(Object.hasOwn(settings.headers, 'x-acs-account-id'), false);
  assert.equal(settings.redirect, 'error');
  assert.equal(settings.cache, 'no-store');
  assert.ok(settings.signal instanceof AbortSignal);
  for (const method of ['updateCode', 'createFunction', 'updateRole', 'updateTrigger']) assert.equal(client[method], undefined);
});

test('configuration STS signing covers the security token and retains the fixed target', async () => {
  const { client, calls } = fixture(undefined, { credentials: { ...CREDENTIALS, accessKeyId: 'STS.SYNTHETICKEY', securityToken: 'synthetic-security-token' } });
  await client.updateEnvironment(ENVIRONMENT());
  assert.equal(calls[0].url, ENDPOINT + FUNCTION_PATH);
  assert.equal(calls[0].settings.headers['x-acs-security-token'], 'synthetic-security-token');
  assert.equal(calls[0].settings.headers.authorization,
    'ACS3-HMAC-SHA256 Credential=STS.SYNTHETICKEY,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version,Signature=afd2a8528d75b0188021013f1cbd90fd412947c7cdfaea700fa4d6b00ef5d3e4');
});

test('content activation requires an explicit constructor capability and retains the same one-shot configuration boundary', async () => {
  const environment = { ...ENVIRONMENT(), ARTDICO_CLOUD_CONTENT_ENABLED: 'true' };
  const closed = fixture(); await safelyRejected(closed.client.updateEnvironment(environment));
  assert.deepEqual(closed.calls, []);
  const enabled = fixture(undefined, { allowContentActivation: true });
  assert.deepEqual(await enabled.client.updateEnvironment(environment), { acknowledged: true });
  assert.equal(enabled.calls.length, 1);
  assert.deepEqual(JSON.parse(enabled.calls[0].settings.body), { environmentVariables: environment });
  for (const invalid of [null, 'true', 1]) assert.throws(() => fixture(undefined, { allowContentActivation: invalid }), /client is invalid/u);
  const ambiguous = fixture(undefined, { allowContentActivation: true });
  await safelyRejected(ambiguous.client.updateEnvironment({ ...environment, ARTDICO_CLOUD_CONTENT_ENABLED: 'yes' }));
  assert.deepEqual(ambiguous.calls, []);
});

test('the complete serialized environment map respects the conservative 4 KiB FC budget', async () => {
  const environment = { ARTDICO_CLOUD_CONTENT_ENABLED: 'false', SYNTHETIC_FILLER: '' };
  environment.SYNTHETIC_FILLER = 'x'.repeat(4096 - Buffer.byteLength(JSON.stringify(environment)));
  assert.equal(Buffer.byteLength(JSON.stringify(environment)), 4096);
  const { client, calls } = fixture();
  assert.deepEqual(await client.updateEnvironment(environment), { acknowledged: true });
  const tooLarge = { ...environment, SYNTHETIC_FILLER: environment.SYNTHETIC_FILLER + 'x' };
  assert.equal(Buffer.byteLength(JSON.stringify(tooLarge)), 4097);
  const error = await safelyRejected(() => client.updateEnvironment(tooLarge));
  assert.equal(summarizeFcConfigError(error), 'operation=UpdateFunction phase=input');
  const utf8OverBudget = { ARTDICO_CLOUD_CONTENT_ENABLED: 'false', SYNTHETIC_FILLER: 'é'.repeat(2050) };
  assert.ok(JSON.stringify(utf8OverBudget).length < 4096);
  assert.ok(Buffer.byteLength(JSON.stringify(utf8OverBudget)) > 4096);
  await safelyRejected(() => client.updateEnvironment(utf8OverBudget));
  assert.equal(calls.length, 1, 'over-budget map cannot produce another PUT');
});

test('read-only metadata and signed health retain the established client contract', async () => {
  const { client, calls } = fixture((url) => url.endsWith('/triggers/defaultTrigger')
    ? json({ httpTrigger: { urlInternet: TRIGGER_URL } })
    : url.startsWith(ENDPOINT) ? json({ functionName: 'artdicohost-api' })
      : json({ status: 'ok', scope: 'process-only', sourceCommit: 'e'.repeat(40) }));
  assert.deepEqual(await client.getFunction(), { functionName: 'artdicohost-api' });
  await client.getTrigger();
  const health = await client.checkHealth(TRIGGER_URL);
  assert.equal(health.status, 200);
  assert.equal(health.body.sourceCommit, 'e'.repeat(40));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].settings.method, 'GET');
  assert.equal(calls[0].url, ENDPOINT + FUNCTION_PATH);
  assert.equal(calls[1].url, ENDPOINT + FUNCTION_PATH + '/triggers/defaultTrigger');
  assert.equal(calls[2].url, TRIGGER_URL + 'healthz');
  assert.equal(calls.every(call => call.settings.body === undefined), true);
});

test('input must be an own-data string map with the content switch forced false before any signing or fetch', async () => {
  let getterCalls = 0;
  const getterMap = ENVIRONMENT();
  Object.defineProperty(getterMap, 'PRIVATE_GETTER', { enumerable: true, get() { getterCalls++; throw new Error('PRIVATE-GETTER'); } });
  const inherited = Object.assign(Object.create({ PRIVATE_INHERITED: 'PRIVATE-INHERITED' }), ENVIRONMENT());
  const symbolic = { ...ENVIRONMENT(), [Symbol('PRIVATE-SYMBOL')]: 'PRIVATE-SYMBOL-VALUE' };
  const hiddenGetter = ENVIRONMENT();
  Object.defineProperty(hiddenGetter, 'PRIVATE_HIDDEN_GETTER', { get() { getterCalls++; throw new Error('PRIVATE-HIDDEN-GETTER'); } });
  const reflectedFailure = new Proxy({}, { getPrototypeOf() { throw new Error('PRIVATE-PROXY'); } });
  const invalid = [undefined, null, '', [], new Map(), {}, inherited, getterMap, symbolic,
    hiddenGetter, reflectedFailure,
    JSON.parse('{"ARTDICO_CLOUD_CONTENT_ENABLED":"false","__proto__":"PRIVATE-PROTO"}'),
    { ...ENVIRONMENT(), constructor: 'PRIVATE-CONSTRUCTOR' }, { ...ENVIRONMENT(), prototype: 'PRIVATE-PROTOTYPE' },
    { ARTDICO_CLOUD_CONTENT_ENABLED: 'true' }, { ARTDICO_CLOUD_CONTENT_ENABLED: false },
    { ...ENVIRONMENT(), INVALID_KEY: null }, { ...ENVIRONMENT(), INVALID_KEY: ['PRIVATE-ARRAY'] },
    { ...ENVIRONMENT(), 'PRIVATE-BAD-KEY': 'value' }, { ...ENVIRONMENT(), 'PRIVATE\nKEY': 'value' },
    { ...ENVIRONMENT(), ['A'.repeat(129)]: 'value' },
    { ...ENVIRONMENT(), PRIVATE_BIG_VALUE: 'x'.repeat(32 * 1024 + 1) },
    { ...ENVIRONMENT(), PRIVATE_BIG_UTF8: 'é'.repeat(20_000) },
    { ...ENVIRONMENT(), FIRST_BIG: 'x'.repeat(32 * 1024), SECOND_BIG: 'x'.repeat(32 * 1024) },
    Object.fromEntries([['ARTDICO_CLOUD_CONTENT_ENABLED', 'false'], ...Array.from({ length: 100 }, (_, index) => ['SETTING_' + index, 'value'])]),
  ];
  const { client, calls } = fixture(undefined, { nonce() { assert.fail('Invalid input cannot reach signing'); } });
  for (const value of invalid) {
    const error = await safelyRejected(() => client.updateEnvironment(value));
    assert.equal(summarizeFcConfigError(error), 'operation=UpdateFunction phase=input');
  }
  assert.equal(getterCalls, 0);
  assert.deepEqual(calls, []);
});

test('bad credentials, nonce and clock values fail without leaking supplied details', async () => {
  const throwingOptions = {};
  Object.defineProperty(throwingOptions, 'credentials', { get() { throw new Error('PRIVATE-CONSTRUCTOR-OPTION'); } });
  for (const options of [null, throwingOptions, {}, { credentials: {} }, { credentials: CREDENTIALS, endpoint: 'https://PRIVATE-REMOTE.invalid' },
    { credentials: CREDENTIALS, functionName: 'other-function' }, { credentials: CREDENTIALS, accountId: '0000111122223333' },
    { credentials: { ...CREDENTIALS, accessKeyId: 'PRIVATE\nKEY' } },
    { credentials: { ...CREDENTIALS, accessKeySecret: 'PRIVATE\nSECRET' } }, { credentials: { ...CREDENTIALS, securityToken: 'PRIVATE\nTOKEN' } },
    { credentials: CREDENTIALS, fetchFn: null }, { credentials: CREDENTIALS, clock: null }, { credentials: CREDENTIALS, nonce: null }]) {
    assert.throws(() => createFcConfigClient(options), error => {
      assert.equal(error.message, 'FC configuration client is invalid');
      assert.doesNotMatch(error.stack, /PRIVATE-/u);
      return true;
    });
  }
  for (const options of [{ clock: () => new Date(NaN) }, { clock: () => '2026-02-30T00:00:00Z' },
    { clock() { throw new Error('PRIVATE-CLOCK'); } }, { nonce: () => 'PRIVATE\nNONCE' }, { nonce() { throw new Error('PRIVATE-NONCE'); } }]) {
    const { client, calls } = fixture(undefined, options);
    const error = await safelyRejected(() => client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(error), 'operation=UpdateFunction phase=signing');
    assert.deepEqual(calls, []);
  }
});

test('invalid request options and malformed response cleanup remain opaque before or after transport', async () => {
  for (const options of [null, Object.defineProperty({}, 'signal', { get() { throw new Error('PRIVATE-OPTION'); } })]) {
    const { client, calls } = fixture();
    await safelyRejected(() => client.updateEnvironment(ENVIRONMENT(), options));
    assert.deepEqual(calls, []);
  }
  for (const response of [
    Object.defineProperty({ status: 200, headers: new Headers({ 'content-type': 'application/json' }) }, 'body', { get() { throw new Error('PRIVATE-BODY'); } }),
    { status: 200, headers: new Headers({ 'content-type': 'text/plain' }), body: { cancel() { throw new Error('PRIVATE-CANCEL'); } } },
  ]) {
    const { client, calls } = fixture(() => response);
    await safelyRejected(() => client.updateEnvironment(ENVIRONMENT()));
    assert.equal(calls.length, 1);
  }
});

test('redirect, MIME, UTF-8, JSON and response-shape failures preserve only safe phases', async () => {
  const failures = [
    [() => new Response('PRIVATE-REMOTE', { status: 302, headers: { location: 'https://PRIVATE-REMOTE.invalid' } }), 'redirect', 302],
    [() => new Response('PRIVATE-REMOTE', { status: 403 }), 'response_type', 403],
    [() => new Response('PRIVATE-REMOTE', { headers: { 'content-type': 'application/json' } }), 'json', 200],
    [() => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }), 'utf8', 200],
    [() => json([]), 'response_shape', 200],
    [() => json(null), 'response_shape', 200],
    [() => { const response = json(); Object.defineProperty(response, 'url', { value: 'https://PRIVATE-REMOTE.invalid' }); return response; }, 'redirect', 200],
  ];
  for (const [reply, phase, status] of failures) {
    const { client, calls } = fixture(reply);
    const error = await safelyRejected(() => client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(error), `operation=UpdateFunction phase=${phase} status=${status}`);
    assert.equal(calls.length, 1);
  }
});

test('bounded error JSON exposes only fixed allowlisted provider codes, never provider bodies', async () => {
  for (const field of ['Code', 'code', 'ErrorCode', 'errorCode']) {
    const { client, calls } = fixture(() => json({ [field]: 'AccessDenied', Message: 'PRIVATE-REMOTE SYNTHETICKEY', RequestId: 'PRIVATE-REQUEST-ID' }, { status: 403 }));
    const error = await safelyRejected(() => client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(error), 'operation=UpdateFunction phase=http status=403 code=AccessDenied');
    assert.deepEqual(Object.keys(error), []);
    assert.equal(calls.length, 1);
  }
  for (const code of ['PRIVATE-REMOTE', 'AccessDenied\nPRIVATE-REMOTE', ['AccessDenied'], { Code: 'AccessDenied' }]) {
    const { client } = fixture(() => json({ Code: code, Message: 'PRIVATE-REMOTE' }, { status: 403 }));
    const error = await safelyRejected(() => client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(error), 'operation=UpdateFunction phase=http status=403');
  }
  assert.equal(summarizeFcConfigError(Object.assign(new Error('PRIVATE-FAKE'), { operation: 'UpdateFunction', phase: 'http', status: 403, code: 'AccessDenied' })), null);
});

test('declared and streamed response size limits reject success and error bodies and cancel streams', async () => {
  const cancellations = [];
  for (const [status, limit] of [[200, 1024 * 1024], [403, 16 * 1024]]) {
    const declared = fixture(() => json({ Message: 'PRIVATE-REMOTE' }, { status, headers: { 'content-type': 'application/json', 'content-length': String(limit + 1) } }));
    const declaredError = await safelyRejected(() => declared.client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(declaredError), `operation=UpdateFunction phase=response_size status=${status}`);
    const streamed = fixture(() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(limit + 1)); },
      cancel() { cancellations.push(status); },
    }), { status, headers: { 'content-type': 'application/json' } }));
    const streamedError = await safelyRejected(() => streamed.client.updateEnvironment(ENVIRONMENT()));
    assert.equal(summarizeFcConfigError(streamedError), `operation=UpdateFunction phase=response_size status=${status}`);
    assert.equal(streamed.calls.length, 1);
  }
  assert.deepEqual(cancellations, [200, 403]);
});

test('network, external abort and fixed timeout errors remain opaque and never retry configuration PUT', async t => {
  const network = fixture(() => { throw Object.assign(new Error('PRIVATE-NETWORK synthetic-access-secret'), { status: 403, code: 'AccessDenied' }); });
  const networkError = await safelyRejected(() => network.client.updateEnvironment(ENVIRONMENT()));
  assert.equal(summarizeFcConfigError(networkError), 'operation=UpdateFunction phase=network');
  assert.equal(network.calls.length, 1);

  const external = new AbortController();
  const hanging = fixture(() => new Promise(() => {}));
  const pending = hanging.client.updateEnvironment(ENVIRONMENT(), { signal: external.signal });
  external.abort(new Error('PRIVATE-ABORT'));
  const abortedError = await safelyRejected(() => pending);
  assert.equal(summarizeFcConfigError(abortedError), 'operation=UpdateFunction phase=aborted');
  assert.equal(hanging.calls.length, 1);

  let cancelled = false;
  const bodyController = new AbortController();
  const blockedBody = fixture(() => new Response(new ReadableStream({ start() {}, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  const reading = blockedBody.client.updateEnvironment(ENVIRONMENT(), { signal: bodyController.signal });
  await new Promise(resolve => setImmediate(resolve));
  bodyController.abort(new Error('PRIVATE-STREAM-ABORT'));
  const bodyError = await safelyRejected(() => reading);
  assert.equal(summarizeFcConfigError(bodyError), 'operation=UpdateFunction phase=aborted status=200');
  assert.equal(cancelled, true);

  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 20_000);
    return deadline.signal;
  });
  const timedOut = fixture(() => new Promise(() => {}));
  const waiting = timedOut.client.updateEnvironment(ENVIRONMENT());
  deadline.abort(new Error('PRIVATE-TIMEOUT'));
  const timedOutError = await safelyRejected(() => waiting);
  assert.equal(summarizeFcConfigError(timedOutError), 'operation=UpdateFunction phase=timeout');
  assert.equal(timedOut.calls.length, 1);
});
