import test from 'node:test';
import assert from 'node:assert/strict';
import { observeConfirmationMail } from '../scripts/observe-confirmation-mail.mjs';

const API = 'https://api.artdico.host', SHA = '1'.repeat(40), COOKIE = '__Secure-artdico_staff_session';
const SESSION = Buffer.alloc(32, 1).toString('base64url'), CSRF = Buffer.alloc(32, 2).toString('base64url');
const env = { GITHUB_SHA: SHA, ARTDICO_ADMIN_USERNAME: 'PRIVATE_USERNAME', ARTDICO_ADMIN_PASSWORD: 'PRIVATE_PASSWORD_ONLY_SYNTHETIC' };
const paths = ['/api/admin/login', '/api/admin/registration-confirmation/settings', '/api/admin/logout'];
const setting = { automaticEnabled: true, email: { enabled: true, ready: true, reason: 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF', missing: [], invalid: [] } };
const cookie = (logout = false) => COOKIE + '=' + (logout ? '' : SESSION) + '; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (logout ? '0' : '28800');
function response(value, headers = {}, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', ...headers } });
}
function fixture({ settings = setting, intercept } = {}) {
  const calls = [];
  const fetchFn = async (url, options) => {
    const path = new URL(url).pathname; calls.push({ url, path, options });
    assert.ok(paths.includes(path)); assert.equal(url, API + path);
    assert.equal(options.method, path === paths[1] ? 'GET' : 'POST');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    assert.equal(options.referrer, ''); assert.equal(options.referrerPolicy, 'no-referrer'); assert.ok(options.signal instanceof AbortSignal);
    const headers = new Headers(options.headers); assert.equal(headers.get('origin'), API); assert.equal(headers.get('accept-encoding'), 'identity');
    assert.equal(headers.get('authorization'), null);
    if (path === paths[0]) { assert.equal(headers.get('cookie'), null); assert.equal(headers.get('x-csrf-token'), null); assert.deepEqual(JSON.parse(options.body), { username: env.ARTDICO_ADMIN_USERNAME, password: env.ARTDICO_ADMIN_PASSWORD }); }
    else { assert.equal(headers.get('cookie'), COOKIE + '=' + SESSION); assert.equal(headers.get('x-csrf-token'), path === paths[2] ? CSRF : null); }
    if (path === paths[1]) assert.equal(options.body, undefined);
    if (path === paths[2]) assert.deepEqual(JSON.parse(options.body), {});
    const overridden = await intercept?.(path, options); if (overridden !== undefined) return overridden;
    if (path === paths[0]) return response({ user: { id: 'PRIVATE_STAFF_ID', label: 'PRIVATE_LABEL' }, csrfToken: CSRF }, { 'set-cookie': cookie() });
    if (path === paths[2]) return response({ ok: true }, { 'set-cookie': cookie(true) });
    return response(structuredClone(settings));
  };
  return { calls, fetchFn };
}
const safe = result => {
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|csrfToken|set-cookie|Cookie|staff_session|notificationId|recipient|password|credentialFingerprint|counts|history/u);
  assert.equal(result.mailRequests, 0); assert.equal(result.businessWrites, 0); assert.equal(result.sourceCommit, SHA);
};

test('one fixed login/read/logout observation reports only safe readiness bound to the deployed source', async () => {
  const f = fixture({ settings: { ...setting, counts: { notificationId: 'PRIVATE_NOTICE', recipient: 'PRIVATE_RECIPIENT' },
    email: { ...setting.email, privateKey: 'PRIVATE_CONFIG_VALUE' } } });
  const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
  assert.deepEqual(result, { verified: true, sourceCommit: SHA, mailRequests: 0, businessWrites: 0, ...setting });
  assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
});

test('Wallet readiness projects only its optional boolean and filters private signer details', async () => {
  for (const ready of [true, false]) {
    const f = fixture({ settings: { ...setting, wallet: { ready, reason: 'PRIVATE_SIGNER_REASON',
      missing: ['PRIVATE_CONFIG_FIELD'], certificateExpiresAt: 'PRIVATE_CERTIFICATE', credentialFingerprint: 'PRIVATE_SIGNER_ID' } } });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.deepEqual(result, { verified: true, sourceCommit: SHA, mailRequests: 0, businessWrites: 0, ...setting, walletReady: ready });
    assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
  }
});

test('a present malformed Wallet readiness fails settings safely and still logs out once', async () => {
  for (const wallet of [null, [], true, {}, { ready: 'PRIVATE_BOOLEAN' }]) {
    const f = fixture({ settings: { ...setting, wallet } });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.deepEqual(result, { verified: false, sourceCommit: SHA, mailRequests: 0, businessWrites: 0, failure: 'SETTINGS_UNAVAILABLE' });
    assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
  }
});

test('paused, provider-disabled, missing, invalid and unavailable configurations are verified observations without delivery claims', async () => {
  for (const settings of [{ ...setting, automaticEnabled: false },
    { automaticEnabled: true, email: { enabled: false, ready: false, reason: 'EMAIL_DISABLED', missing: [] } },
    { automaticEnabled: true, email: { enabled: true, ready: false, reason: 'EMAIL_CONFIGURATION_MISSING', missing: ['EMAILJS_CONFIRMATION_TEMPLATE_ID'] } },
    { automaticEnabled: true, email: { enabled: true, ready: false, reason: 'EMAIL_CONFIGURATION_INVALID', missing: [], invalid: ['EMAIL_FROM_ADDRESS'] } },
    { automaticEnabled: true, email: { enabled: true, ready: false, reason: 'EMAIL_CONFIGURATION_UNAVAILABLE', missing: [] } }]) {
    const f = fixture({ settings }), result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.equal(result.verified, true); assert.deepEqual(result.email, settings.email); assert.equal(result.automaticEnabled, settings.automaticEnabled);
    assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
  }
});

test('rejected or malformed authentication stops without retrying or reading settings and never exposes errors or tokens', async () => {
  for (const login of [() => response({ error: { code: 'PRIVATE_AUTH_ERROR', message: 'PRIVATE_PASSWORD' } }, {}, 401),
    () => response('PRIVATE_RAW_BODY'), () => response({ user: {}, csrfToken: 'PRIVATE_INVALID_CSRF' }, { 'set-cookie': cookie() }),
    () => response({ user: {}, csrfToken: CSRF }, { 'set-cookie': cookie() + ', PRIVATE_OTHER_COOKIE=raw' }),
    () => response({ user: {}, csrfToken: CSRF }, { 'set-cookie': cookie().replace('Secure;', 'Domain=foreign.invalid; Secure;') }),
    () => { const value = response({ user: {}, csrfToken: CSRF }, { 'set-cookie': cookie() }); Object.defineProperty(value, 'redirected', { value: true }); return value; },
    () => { const value = response({ user: {}, csrfToken: CSRF }, { 'set-cookie': cookie() }); Object.defineProperty(value, 'url', { value: 'https://foreign.invalid/api/admin/login' }); return value; },
    () => { throw new Error('PRIVATE_RAW_EXCEPTION_WITH_COOKIE_' + SESSION); }]) {
    const f = fixture({ intercept: path => path === paths[0] ? login() : undefined });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.equal(result.verified, false); assert.equal(result.failure, 'AUTHENTICATION_UNAVAILABLE'); assert.equal(f.calls.length, 1); safe(result);
  }
});

test('settings read failures and unsafe readiness schemas still attempt exactly one logout with the original credentials', async () => {
  const malformed = [{}, { ...setting, automaticEnabled: 'PRIVATE_BOOLEAN' },
    { ...setting, email: { ...setting.email, reason: 'PRIVATE_PROVIDER_REASON' } },
    { ...setting, email: { ...setting.email, missing: ['PRIVATE_SECRET_VALUE'] } },
    { ...setting, email: { ...setting.email, invalid: ['EMAIL_FROM_NAME', 'EMAIL_FROM_NAME'] } },
    { ...setting, email: { ...setting.email, ready: false } }, { ...setting, email: { ...setting.email, enabled: false } }];
  for (const invalid of [...malformed.map(value => () => response(value)), () => response('PRIVATE_BODY', {}, 503),
    () => response('PRIVATE_NOT_JSON'), () => { throw new Error('PRIVATE_PROVIDER_ERROR'); },
    () => response(setting, { 'set-cookie': 'PRIVATE_SESSION_INJECTION' })]) {
    const f = fixture({ intercept: path => path === paths[1] ? invalid() : undefined });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.equal(result.verified, false); assert.equal(result.failure, 'SETTINGS_UNAVAILABLE'); assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
  }
});

test('logout acknowledgement is required and a failed logout is never retried or mistaken for a verified run', async () => {
  for (const logout of [() => response('PRIVATE_LOGOUT_ERROR', {}, 503), () => response({ ok: false }, { 'set-cookie': cookie(true) }),
    () => response({ ok: true }, { 'set-cookie': cookie() }), () => { throw new Error('PRIVATE_LOGOUT_FAILURE'); }]) {
    const f = fixture({ intercept: path => path === paths[2] ? logout() : undefined });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn });
    assert.equal(result.verified, false); assert.equal(result.failure, 'LOGOUT_UNAVAILABLE'); assert.equal(result.email, undefined);
    assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
  }
});

test('response content type, encoding, byte limit and declared length are enforced without printing raw data', async () => {
  for (const headers of [{ 'content-type': 'text/html' }, { 'content-encoding': 'gzip' }, { 'cache-control': 'public, max-age=3600' },
    { 'content-length': '999999' }, { 'content-length': '00' }, { 'content-length': '1' }]) {
    const f = fixture({ intercept: path => path === paths[1] ? response(setting, headers) : undefined });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn }); assert.equal(result.failure, 'SETTINGS_UNAVAILABLE'); safe(result);
  }
  const f = fixture({ intercept: path => path === paths[1] ? response({ ...setting, private: 'PRIVATE_' + 'x'.repeat(32 * 1024) }) : undefined });
  const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn }); assert.equal(result.failure, 'SETTINGS_UNAVAILABLE'); safe(result);
});

test('fetch and body deadlines remain bounded even when injected transport ignores abort; an established session is logged out', async () => {
  for (const stage of [paths[0], paths[1]]) {
    const f = fixture({ intercept: path => path === stage ? new Promise(() => {}) : undefined });
    const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn, timeoutMs: 10 });
    assert.equal(result.failure, stage === paths[0] ? 'AUTHENTICATION_UNAVAILABLE' : 'SETTINGS_UNAVAILABLE');
    assert.deepEqual(f.calls.map(call => call.path), stage === paths[0] ? [paths[0]] : paths); safe(result);
  }
  let cancelled = false;
  const f = fixture({ intercept: path => path === paths[1] ? new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"PRIVATE":')); }, cancel() { cancelled = true; } }),
    { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }) : undefined });
  const result = await observeConfirmationMail({ env, fetchFn: f.fetchFn, timeoutMs: 10 });
  assert.equal(result.failure, 'SETTINGS_UNAVAILABLE'); assert.equal(cancelled, true); assert.deepEqual(f.calls.map(call => call.path), paths); safe(result);
});

test('invalid context or caller arguments make zero requests and cannot inject a source identifier into reports', async () => {
  for (const patch of [{ GITHUB_SHA: 'PRIVATE_INVALID_COMMIT' }, { ARTDICO_ADMIN_USERNAME: '' }, { ARTDICO_ADMIN_USERNAME: 'PRIVATE\nHEADER' },
    { ARTDICO_ADMIN_PASSWORD: '' }, { ARTDICO_ADMIN_PASSWORD: 'x'.repeat(1025) }]) {
    let calls = 0; const result = await observeConfirmationMail({ env: { ...env, ...patch }, fetchFn: async () => { calls++; throw new Error('PRIVATE'); } });
    assert.equal(calls, 0); assert.equal(result.verified, false); assert.equal(result.failure, 'INVALID_OBSERVATION_INPUT');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/u);
  }
  for (const timeoutMs of [0, 10_001, 1.5]) {
    let calls = 0; const result = await observeConfirmationMail({ env, timeoutMs, fetchFn: async () => { calls++; } });
    assert.equal(result.failure, 'INVALID_OBSERVATION_INPUT'); assert.equal(calls, 0); safe(result);
  }
});
