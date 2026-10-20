import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createFcClient, FC_API_ENDPOINT, FC_REGION, MAX_FC_ZIP_BYTES, summarizeFcError, validateFcTriggerUrl } from '../scripts/fc-client.mjs';
import { MAX_FC_REQUEST_BYTES, MAX_FC_ZIP_BYTES as SHARED_MAX_FC_ZIP_BYTES, fcCodeRequestBytes } from '../scripts/fc-upload-limits.mjs';

const credentials = { accessKeyId: 'SYNTHETICKEY', accessKeySecret: 'synthetic-access-secret' };
const clock = () => new Date('2026-10-19T04:00:00Z');
const nonce = () => '0123456789abcdef0123456789abcdef';
const triggerUrl = 'https://artdicohost-api-synthetic.cn-hongkong.fcapp.run';
const functionPath = '/2023-03-30/functions/artdicohost-api';
const signedNames = 'content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version';
function json(body, options = {}) { return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...options }); }
function fakeClient(reply = () => json({ functionName: 'artdicohost-api' }), options = {}) {
  const calls = [];
  const fetchFn = async (url, settings) => { calls.push({ url, settings }); return reply(url, settings); };
  return { calls, client: createFcClient({ credentials, clock, nonce, fetchFn, ...options }) };
}
async function safelyRejected(operation) {
  let caught;
  await assert.rejects(operation, error => {
    caught = error;
    assert.match(error.message, /^FC (?:request failed|client configuration is invalid)/u);
    for (const privateValue of [credentials.accessKeyId, 'STS.SYNTHETICKEY', credentials.accessKeySecret, 'synthetic-security-token', 'PRIVATE-REMOTE', 'PRIVATE-NETWORK']) assert.equal(String(error.stack).includes(privateValue), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  return caught;
}

test('ACS3 GetFunction matches an independently computed Python HMAC fixture and uses only the fixed API endpoint', async () => {
  // Literal vector independently generated with Python hashlib/hmac from the official ACS3 formula.
  const { client, calls } = fakeClient();
  assert.deepEqual(await client.getFunction(), { functionName: 'artdicohost-api' });
  assert.equal(calls.length, 1);
  const { url, settings } = calls[0];
  assert.equal(url, FC_API_ENDPOINT + functionPath);
  assert.equal(settings.method, 'GET');
  assert.equal(settings.body, undefined);
  assert.equal(settings.headers.authorization, `ACS3-HMAC-SHA256 Credential=SYNTHETICKEY,SignedHeaders=${signedNames},Signature=ada8bd4a666b04efa066c9f45d5ba9c948b4f5a494c79893d17479d6789b29f3`);
  assert.equal(settings.headers['x-acs-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(settings.headers['x-acs-date'], '2026-10-19T04:00:00Z');
  assert.equal(settings.headers['x-acs-version'], '2023-03-30');
  assert.equal(settings.headers['x-acs-action'], 'GetFunction');
  assert.equal(Object.hasOwn(settings.headers, 'x-acs-account-id'), false);
  assert.equal(settings.redirect, 'error');
  assert.equal(settings.cache, 'no-store');
  assert.ok(settings.signal instanceof AbortSignal);
});

test('STS participates in ACS3 signing and fixed health v1 signing, including the empty-query trailing newline', async () => {
  const { client, calls } = fakeClient(url => url.startsWith(FC_API_ENDPOINT) ? json({ httpTrigger: { urlInternet: triggerUrl } }) : json({ status: 'ok', scope: 'process-only' }), { credentials: { ...credentials, accessKeyId: 'STS.SYNTHETICKEY', securityToken: 'synthetic-security-token' } });
  await client.getFunction();
  assert.equal(calls[0].settings.headers.authorization, 'ACS3-HMAC-SHA256 Credential=STS.SYNTHETICKEY,SignedHeaders=content-type;host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-security-token;x-acs-signature-nonce;x-acs-version,Signature=2669e50eb9531f9d2db8463a02bba50a99cfa992253b68859b188f8bd601383c');
  await client.getTrigger();
  const result = await client.checkHealth(triggerUrl);
  assert.deepEqual(result, { status: 200, body: { status: 'ok', scope: 'process-only' } });
  const health = calls.at(-1);
  assert.equal(health.url, triggerUrl + '/healthz');
  assert.equal(health.settings.method, 'GET');
  assert.equal(health.settings.headers.date, 'Mon, 19 Oct 2026 04:00:00 GMT');
  assert.equal(health.settings.headers.authorization, 'FC STS.SYNTHETICKEY:cStXtJBTr19N6Gr7fr1lU7JFr1l464JVI1bGwJr1pTs=');
  assert.equal(health.settings.headers['x-fc-security-token'], 'synthetic-security-token');
  assert.equal(health.settings.body, undefined);
});

test('code update sends exact supplied bytes as a code-only JSON body and signs the actual payload hash', async () => {
  const { client, calls } = fakeClient();
  const bytes = new Uint8Array([0, 80, 75, 3, 4, 255, 0]).subarray(1, 6);
  await client.updateCode(bytes);
  const { url, settings } = calls[0];
  assert.equal(url, FC_API_ENDPOINT + functionPath);
  assert.equal(settings.method, 'PUT');
  assert.deepEqual(JSON.parse(settings.body), { code: { zipFile: Buffer.from(bytes).toString('base64') } });
  assert.equal(settings.headers['x-acs-action'], 'UpdateFunction');
  assert.equal(Buffer.byteLength(settings.body, 'utf8'), fcCodeRequestBytes(bytes.byteLength));
  assert.ok(Buffer.byteLength(settings.body, 'utf8') <= MAX_FC_REQUEST_BYTES);
  assert.equal(settings.headers['x-acs-content-sha256'], createHash('sha256').update(settings.body).digest('hex'));
  for (const invalid of [undefined, '', {}, new Uint8Array()]) await safelyRejected(() => client.updateCode(invalid));
  assert.equal(calls.length, 1);
});

test('over-budget and invalid byte lengths fail as opaque input errors before copy, Base64, signing or fetch', async t => {
  assert.equal(MAX_FC_ZIP_BYTES, SHARED_MAX_FC_ZIP_BYTES, 'the existing client export uses the shared fixed cap');
  const { client, calls } = fakeClient(undefined, { nonce() { assert.fail('Rejected input must not reach signing'); } });
  const originalFrom = Buffer.from;
  const blocked = new Set();
  t.mock.method(Buffer, 'from', function(value, ...args) {
    assert.equal(blocked.has(value), false, 'rejected ZIP input must not be copied or Base64 encoded');
    return originalFrom.call(Buffer, value, ...args);
  });
  // Synthetic views supply only a length; no large ZIP or request body is allocated.
  for (const length of [MAX_FC_ZIP_BYTES + 1, 64 * 1024 * 1024, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, -1, 0.5, Infinity, 'PRIVATE-SYNTHETIC-LENGTH']) {
    const bytes = new Uint8Array([80, 75]);
    Object.defineProperty(bytes, 'byteLength', { value: length });
    blocked.add(bytes);
    const error = await safelyRejected(() => client.updateCode(bytes));
    assert.equal(summarizeFcError(error), 'operation=UpdateFunction phase=input');
  }
  assert.deepEqual(calls, []);
});

test('health signing requires this client to fetch and bind the exact fixed function trigger first', async () => {
  const { client, calls } = fakeClient(url => url.startsWith(FC_API_ENDPOINT) ? json({ httpTrigger: { urlInternet: triggerUrl } }) : json({ status: 'ok' }));
  await safelyRejected(() => client.checkHealth(triggerUrl));
  assert.equal(calls.length, 0);
  await client.getTrigger();
  assert.equal(calls[0].url, FC_API_ENDPOINT + functionPath + '/triggers/defaultTrigger');
  await safelyRejected(() => client.checkHealth('https://other-function.cn-hongkong.fcapp.run'));
  await safelyRejected(() => client.checkHealth(triggerUrl + '/api/registrations'));
  assert.equal(calls.length, 1);
  await client.checkHealth();
  assert.equal(calls[1].settings.headers.authorization, 'FC SYNTHETICKEY:NOOOKouT+WVgq+o2DEi3AopqOdT0dnc9eGJF1UFQGQA=');
});

test('trigger URL rejects credentials, non-Hong-Kong hosts, alternate ports, paths and URL normalization tricks', async () => {
  assert.equal(validateFcTriggerUrl(triggerUrl + '/'), triggerUrl);
  for (const url of ['http://artdicohost-api-synthetic.cn-hongkong.fcapp.run', 'https:artdicohost-api-synthetic.cn-hongkong.fcapp.run', triggerUrl + ':443', triggerUrl + ':8443', triggerUrl + '/healthz', triggerUrl + '/..', triggerUrl + '?', triggerUrl + '#', triggerUrl + '?secret=PRIVATE-REMOTE', triggerUrl + '#PRIVATE-REMOTE', 'https://SYNTHETICKEY:synthetic-access-secret@artdicohost-api-synthetic.cn-hongkong.fcapp.run', triggerUrl + '.attacker.invalid', triggerUrl.replace('cn-hongkong', 'cn-shanghai'), 'https://cn-hongkong.fcapp.run', 'https://localhost', 'https://*.cn-hongkong.fcapp.run', ' ' + triggerUrl]) {
    assert.throws(() => validateFcTriggerUrl(url), /^Error: FC request failed/u);
    const { client, calls } = fakeClient(() => json({ httpTrigger: { urlInternet: url } }));
    await safelyRejected(() => client.getTrigger());
    await safelyRejected(() => client.checkHealth(triggerUrl));
    assert.equal(calls.length, 1);
  }
});

test('a failed trigger refresh revokes the previous health-signing binding', async () => {
  let valid = true;
  const { client, calls } = fakeClient(() => json(valid ? { httpTrigger: { urlInternet: triggerUrl } } : { httpTrigger: { urlInternet: 'https://attacker.invalid' } }));
  await client.getTrigger(); valid = false;
  await safelyRejected(() => client.getTrigger());
  await safelyRejected(() => client.checkHealth(triggerUrl));
  assert.equal(calls.length, 2);
});

test('configuration, clock and nonce failures are safe and cannot redirect credentials to a custom endpoint', async () => {
  for (const options of [{}, { credentials: {} }, { credentials, region: 'cn-shanghai' }, { credentials, region: 'https://PRIVATE-REMOTE' }, { credentials: { ...credentials, accessKeyId: 'SYNTHETICKEY\r\nInjected: yes' } }, { credentials: { ...credentials, securityToken: 'PRIVATE-REMOTE\n' } }]) assert.throws(() => createFcClient(options), /^Error: FC client configuration is invalid/u);
  for (const options of [{ clock: () => new Date(NaN) }, { clock: () => '2026-02-30T00:00:00Z' }, { nonce: () => 'PRIVATE-REMOTE\n' }, { clock() { throw new Error('PRIVATE-REMOTE'); } }]) {
    const { client, calls } = fakeClient(undefined, options);
    await safelyRejected(() => client.getFunction());
    assert.equal(calls.length, 0);
  }
  const { client, calls } = fakeClient(undefined, { endpoint: 'https://attacker.invalid', accountId: '1111222233334444' });
  await client.getFunction();
  assert.equal(calls[0].url, FC_API_ENDPOINT + functionPath);
  assert.equal(FC_REGION, 'cn-hongkong');
});

test('HTTP, redirect, MIME, UTF-8 and JSON errors never echo remote diagnostics or credential material', async () => {
  for (const reply of [() => new Response('PRIVATE-REMOTE', { status: 403 }), () => new Response('PRIVATE-REMOTE', { status: 302, headers: { location: 'https://attacker.invalid' } }), () => new Response('PRIVATE-REMOTE', { headers: { 'content-type': 'text/plain' } }), () => new Response('PRIVATE-REMOTE', { headers: { 'content-type': 'application/json' } }), () => json([]), () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }), () => { throw new Error('PRIVATE-NETWORK SYNTHETICKEY synthetic-access-secret'); }]) {
    const { client } = fakeClient(reply);
    await safelyRejected(() => client.getFunction());
  }
});

test('responses are streamed under a fixed size limit and external cancellation stops blocked fetch or body reads', async () => {
  let cancelled = false;
  const { client } = fakeClient(() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } }));
  await safelyRejected(() => client.getFunction());
  assert.equal(cancelled, true);
  const abortFetch = new AbortController();
  const hanging = fakeClient(() => new Promise(() => {}));
  const pending = hanging.client.getFunction({ signal: abortFetch.signal });
  abortFetch.abort(new Error('PRIVATE-REMOTE'));
  await safelyRejected(() => pending);
  const abortBody = new AbortController();
  const blockedBody = fakeClient(() => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } }));
  const reading = blockedBody.client.getFunction({ signal: abortBody.signal });
  abortBody.abort();
  await safelyRejected(() => reading);
});

test('only fixed provider codes from bounded error JSON become trusted status diagnostics', async () => {
  for (const field of ['Code', 'code', 'ErrorCode', 'errorCode']) {
    const { client, calls } = fakeClient(() => json({ [field]: 'AccessDenied', Message: 'PRIVATE-REMOTE SYNTHETICKEY', RequestId: 'PRIVATE-REMOTE' }, { status: 403 }));
    const error = await safelyRejected(() => client.updateCode(new Uint8Array([80, 75])));
    assert.equal(summarizeFcError(error), 'operation=UpdateFunction phase=http status=403 code=AccessDenied');
    assert.equal(calls.length, 1);
    assert.deepEqual(Object.keys(error), []);
  }
  for (const code of ['PRIVATE-REMOTE', 'InvalidArgument.PRIVATE-REMOTE', 'AccessDenied\nPRIVATE-REMOTE', ['AccessDenied'], { Code: 'AccessDenied' }]) {
    const { client } = fakeClient(() => json({ Code: code, Message: 'PRIVATE-REMOTE' }, { status: 403 }));
    const error = await safelyRejected(() => client.getFunction());
    assert.equal(summarizeFcError(error), 'operation=GetFunction phase=http status=403');
  }
  const { client } = fakeClient(() => json({ Code: 'InvalidArgument', Message: 'PRIVATE-REMOTE' }, { status: 201 }));
  assert.equal(summarizeFcError(await safelyRejected(() => client.getFunction())), 'operation=GetFunction phase=http status=201 code=InvalidArgument');
});

test('response format, redirect and size failures preserve only fixed phase and HTTP status', async () => {
  let cancelled = false;
  const replies = [
    [() => new Response('PRIVATE-REMOTE', { status: 403 }), 'response_type', 403],
    [() => new Response('PRIVATE-REMOTE', { status: 302, headers: { location: 'https://PRIVATE-REMOTE.invalid' } }), 'redirect', 302],
    [() => new Response('PRIVATE-REMOTE', { headers: { 'content-type': 'application/json' } }), 'json', 200],
    [() => json([]), 'response_shape', 200],
    [() => new Response(new Uint8Array([0xc3, 0x28]), { status: 403, headers: { 'content-type': 'application/json' } }), 'utf8', 403],
    [() => json({ Code: 'AccessDenied' }, { status: 403, headers: { 'content-type': 'application/json', 'content-length': '16385' } }), 'response_size', 403],
    [() => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(16385)); }, cancel() { cancelled = true; } }), { status: 403, headers: { 'content-type': 'application/json' } }), 'response_size', 403],
  ];
  for (const [reply, phase, status] of replies) {
    const { client, calls } = fakeClient(reply);
    assert.equal(summarizeFcError(await safelyRejected(() => client.getFunction())), `operation=GetFunction phase=${phase} status=${status}`);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].settings.redirect, 'error');
  }
  assert.equal(cancelled, true);
});

test('network, external abort and the fixed request timeout have separate safe classifications', async t => {
  const network = fakeClient(() => { throw Object.assign(new Error('PRIVATE-NETWORK'), { status: 403, code: 'AccessDenied', cause: 'PRIVATE-REMOTE' }); });
  assert.equal(summarizeFcError(await safelyRejected(() => network.client.getFunction())), 'operation=GetFunction phase=network');
  const controller = new AbortController();
  const blocked = fakeClient(() => new Promise(() => {}));
  const pending = blocked.client.getFunction({ signal: controller.signal });
  controller.abort(new Error('PRIVATE-REMOTE'));
  assert.equal(summarizeFcError(await safelyRejected(() => pending)), 'operation=GetFunction phase=aborted');
  t.mock.method(AbortSignal, 'timeout', milliseconds => { assert.equal(milliseconds, 20_000); return AbortSignal.abort(new Error('PRIVATE-REMOTE')); });
  const timedOut = fakeClient();
  assert.equal(summarizeFcError(await safelyRejected(() => timedOut.client.getFunction())), 'operation=GetFunction phase=timeout');
  assert.equal(timedOut.calls.length, 0);
});

test('error names, copied properties, wrappers and causes cannot manufacture trusted diagnostics', async () => {
  const { client } = fakeClient(() => json({ Code: 'Forbidden' }, { status: 403 }));
  const trusted = await safelyRejected(() => client.getFunction());
  class FcRequestError extends Error {}
  for (const error of [undefined, null, 'PRIVATE-REMOTE', {}, new FcRequestError('PRIVATE-REMOTE'),
    Object.assign(new Error('PRIVATE-REMOTE'), { operation: 'GetFunction', phase: 'http', status: 403, code: 'Forbidden' }),
    new Error('PRIVATE-REMOTE', { cause: trusted }), Object.assign(new Error('PRIVATE-REMOTE'), trusted)]) assert.equal(summarizeFcError(error), null);
  const hostile = new Error('PRIVATE-REMOTE');
  for (const key of ['message', 'cause', 'code', 'status', 'operation']) Object.defineProperty(hostile, key, { get() { throw new Error('PRIVATE-REMOTE'); } });
  assert.equal(summarizeFcError(hostile), null);
  trusted.message = 'PRIVATE-REMOTE';
  assert.equal(summarizeFcError(trusted), 'operation=GetFunction phase=http status=403 code=Forbidden');
});
