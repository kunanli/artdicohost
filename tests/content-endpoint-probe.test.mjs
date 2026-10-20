import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { probeContentEndpoint, CONTENT_PROBE_HOST, CONTENT_PROBE_CNAME } from '../scripts/probe-content-endpoint.mjs';

function transport({ status = 503, body = Buffer.from('{"status":"not_ready","registration":"closed"}'), authorized = true, encrypted = true, redirect = false, error = false } = {}) {
  const calls = [];
  const requestFn = (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      if (error) { request.emit('error', new Error('SYNTHETIC-PRIVATE-TOKEN-ERROR')); return; }
      const response = new EventEmitter();
      response.socket = { authorized, encrypted }; response.statusCode = status; response.destroy = () => {};
      Object.defineProperty(response, 'headers', { get() { throw new Error('Headers must never be inspected'); } });
      callback(response);
      if (!redirect) { response.emit('data', body); response.emit('end'); }
    });
    return request;
  };
  return { requestFn, calls };
}

const matchingDns = async host => { assert.equal(host, CONTENT_PROBE_HOST); return [CONTENT_PROBE_CNAME]; };

test('endpoint probe fixes hostname/path/method, strict TLS and a minimal credential-free request', async () => {
  const fake = transport();
  const report = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: fake.requestFn, hostname: 'private.invalid', url: 'http://private.invalid/', headers: { authorization: 'SYNTHETIC-PRIVATE' } });
  assert.deepEqual(report, { observation: 'read-only-endpoint', dnsMatched: true, httpsVerified: true, status: 503, applicationError: 'not_ready', failure: null });
  assert.equal(fake.calls.length, 1);
  const options = fake.calls[0];
  assert.equal(options.hostname, 'api.artdico.host'); assert.equal(options.path, '/admin/'); assert.equal(options.method, 'GET'); assert.equal(options.port, 443);
  assert.equal(options.protocol, 'https:'); assert.equal(options.servername, CONTENT_PROBE_HOST); assert.equal(options.rejectUnauthorized, true); assert.equal(options.minVersion, 'TLSv1.2');
  assert.equal(options.agent, false); assert.equal(options.maxHeaderSize, 8192);
  assert.deepEqual(Object.keys(options.headers).sort(), ['accept', 'host', 'user-agent']);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC-PRIVATE'), false);
  assert.equal(Object.hasOwn(report, 'businessReady'), false);
});

test('probe preserves status431 and only a known application code, dropping all private body fields', async () => {
  const fake = transport({ status: 431, body: Buffer.from('{"error":{"code":"INVALID_HTTP_REQUEST","message":"SYNTHETIC-PRIVATE-PASSWORD"},"cookie":"SYNTHETIC-PRIVATE-COOKIE"}') });
  const report = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: fake.requestFn });
  assert.equal(report.status, 431); assert.equal(report.applicationError, 'INVALID_HTTP_REQUEST'); assert.equal(report.httpsVerified, true);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC-PRIVATE'), false);
  const unknown = transport({ status: 400, body: Buffer.from('{"error":{"code":"SYNTHETIC-PRIVATE-TOKEN"}}') });
  assert.equal((await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: unknown.requestFn })).applicationError, 'UNRECOGNIZED');
});

test('probe never follows redirects or reads their location, cookies or body', async () => {
  const fake = transport({ status: 302, redirect: true });
  const report = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: fake.requestFn });
  assert.equal(fake.calls.length, 1); assert.equal(report.status, 302); assert.equal(report.applicationError, null); assert.equal(report.failure, 'REDIRECT_NOT_FOLLOWED');
});

test('probe rejects unauthorized TLS and bounded response overflow without returning data', async () => {
  for (const options of [{ authorized: false }, { encrypted: false }]) {
    const fake = transport(options), report = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: fake.requestFn });
    assert.equal(report.httpsVerified, false); assert.equal(report.failure, 'TLS_NOT_VERIFIED');
  }
  const large = transport({ status: 200, body: Buffer.alloc(16 * 1024 + 1, 65) });
  const report = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: large.requestFn });
  assert.equal(report.status, 200); assert.equal(report.failure, 'BODY_TOO_LARGE'); assert.equal(report.applicationError, null);
  assert.ok(JSON.stringify(report).length < 250);
});

test('DNS mismatch and failure make no HTTP request and never expose returned names or raw errors', async () => {
  const fake = transport();
  for (const resolveCnameFn of [async () => ['SYNTHETIC-PRIVATE-DNS.invalid'], async () => [], async () => [CONTENT_PROBE_CNAME, 'other.invalid']]) {
    const report = await probeContentEndpoint({ resolveCnameFn, requestFn: fake.requestFn });
    assert.equal(report.failure, 'DNS_TARGET_MISMATCH'); assert.equal(report.dnsMatched, false); assert.equal(report.status, null);
    assert.equal(JSON.stringify(report).includes('SYNTHETIC-PRIVATE'), false);
  }
  const report = await probeContentEndpoint({ resolveCnameFn: async () => { throw new Error('SYNTHETIC-PRIVATE-DNS-ERROR'); }, requestFn: fake.requestFn });
  assert.equal(report.failure, 'DNS_FAILED'); assert.equal(fake.calls.length, 0); assert.equal(JSON.stringify(report).includes('SYNTHETIC-PRIVATE'), false);
  const mixedCase = await probeContentEndpoint({ resolveCnameFn: async () => [CONTENT_PROBE_CNAME.toUpperCase() + '.'], requestFn: fake.requestFn });
  assert.equal(mixedCase.dnsMatched, true);
});

test('shared10second deadline covers DNS and network and reports only fixed failure classes', async () => {
  let scheduled, cancelled = 0;
  const schedule = (callback, milliseconds) => { assert.equal(milliseconds, 10_000); scheduled = callback; return 17; };
  const cancel = id => { assert.equal(id, 17); cancelled++; };
  const dnsWaiting = probeContentEndpoint({ resolveCnameFn: () => new Promise(() => {}), requestFn: () => assert.fail('DNS timeout must not invoke HTTPS'), schedule, cancel });
  scheduled();
  assert.equal((await dnsWaiting).failure, 'TIMEOUT'); assert.equal(cancelled, 1);
  let requested;
  const waiting = probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: () => { const request = new EventEmitter(); request.end = () => {}; request.destroy = () => { requested = true; }; return request; }, schedule, cancel });
  await new Promise(resolve => setImmediate(resolve)); scheduled();
  const report = await waiting; assert.equal(report.failure, 'TIMEOUT'); assert.equal(report.dnsMatched, true); assert.equal(requested, true); assert.equal(cancelled, 2);
  const failed = transport({ error: true });
  const errorReport = await probeContentEndpoint({ resolveCnameFn: matchingDns, requestFn: failed.requestFn });
  assert.equal(errorReport.failure, 'HTTPS_FAILED'); assert.equal(JSON.stringify(errorReport).includes('SYNTHETIC-PRIVATE'), false);
});
