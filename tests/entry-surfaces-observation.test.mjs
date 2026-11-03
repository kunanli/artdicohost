import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { observeEntrySurfaces } from '../scripts/verify-entry-surfaces.mjs';

const SITE = 'https://artdico.host', PREFIX = 'https://api.artdico.host/api/admin/registration/entry-links/';
const URLS = [SITE + '/release.json', SITE + '/r/', PREFIX + 'invalid', PREFIX + 'A'.repeat(22)];
const commit = 'a'.repeat(40), PRIVATE = 'PRIVATE-SYNTHETIC-OBSERVATION';
const html = Buffer.from('<html>合成公开入口，无票码或参会资料</html>');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const receipt = () => ({ schemaVersion: 1, commit, files: [{ path: 'r/index.html', bytes: html.length, sha256: sha256(html) }] });
const PHASES = ['release', 'public-entry', 'invalid-entry', 'preflight'];
const COMMON = ['phase', 'status', 'transport', 'redirect', 'url', 'encoding', 'cookie', 'declared', 'body', 'bytes'];
const EXTRA = [['mime', 'cache', 'receipt'], ['mime', 'cache', 'attachment', 'size', 'hash'], ['mime', 'cache', 'errorCode', 'envelope'], ['cache', 'origin', 'methods', 'credentials', 'credentialsValue', 'empty']];
const ERROR_CODES = new Set(['ENTRY_NOT_FOUND', 'AUTH_REQUIRED', 'FORBIDDEN', 'NOT_FOUND', 'ORIGIN_REJECTED', 'ENTRY_UNAVAILABLE', 'OTHER', 'UNREADABLE']);
function fixture(change = async (_url, response) => response) {
  const calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    let response;
    if (url === URLS[0]) response = new Response(JSON.stringify(receipt()), { headers: { 'content-type': 'application/json', 'cache-control': 'public,no-cache' } });
    else if (url === URLS[1]) response = new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public,no-cache', 'content-length': String(html.length) } });
    else if (url === URLS[2]) response = new Response(JSON.stringify({ error: { code: 'ENTRY_NOT_FOUND', message: PRIVATE } }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } });
    else if (url === URLS[3]) response = new Response(null, { status: 204, headers: { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'cache-control': 'private,no-store', 'content-length': '0' } });
    else throw new Error(PRIVATE);
    return change(url, response);
  };
  return { calls, fetchFn };
}
function safe(result, reports = []) {
  assert.equal(result.observed, true); assert.equal(result.requests, 4);
  assert.deepEqual(Object.keys(result).sort(), ['observed', 'requests', 'commit', 'phases'].sort());
  assert.deepEqual(result.phases.map(item => item.phase), PHASES);
  for (const [index, phase] of result.phases.entries()) {
    assert.deepEqual(Object.keys(phase).sort(), [...COMMON, ...EXTRA[index]].sort());
    assert.ok(phase.status === null || Number.isInteger(phase.status) && phase.status >= 100 && phase.status <= 599);
    assert.ok(Number.isSafeInteger(phase.bytes) && phase.bytes >= 0);
    for (const [key, value] of Object.entries(phase)) {
      if (!['phase', 'status', 'bytes', 'errorCode', 'credentialsValue'].includes(key)) assert.equal(typeof value, 'boolean', key);
      if (key === 'errorCode') assert.ok(ERROR_CODES.has(value));
      if (key === 'credentialsValue') assert.ok(['absent','true','false','other'].includes(value));
    }
  }
  const serialized = JSON.stringify([result, ...reports]);
  assert.equal(serialized.includes(PRIVATE), false); assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes(sha256(html)), false, 'only comparison booleans leave the observer');
}

test('observation checks fixed sources in order without local checkout, credentials or write requests', async () => {
  const f = fixture(), reports = [];
  const result = await observeEntrySurfaces({ fetchFn: f.fetchFn, report: value => reports.push(value) });
  safe(result, reports); assert.equal(result.commit, commit);
  assert.deepEqual(f.calls.map(item => item.url), URLS);
  assert.deepEqual(f.calls.map(item => item.settings.method), ['GET', 'GET', 'GET', 'OPTIONS']);
  for (const { settings } of f.calls) {
    assert.equal(settings.credentials, 'omit'); assert.equal(settings.redirect, 'manual'); assert.equal(settings.cache, 'no-store');
    assert.equal(settings.referrer, ''); assert.equal(settings.referrerPolicy, 'no-referrer'); assert.equal(settings.body, undefined);
    assert.equal(settings.signal.aborted, true);
    const headers = new Headers(settings.headers);
    for (const name of ['authorization', 'cookie', 'referer']) assert.equal(headers.has(name), false);
    assert.equal(headers.get('accept-encoding'), 'identity');
  }
  const preflight = new Headers(f.calls[3].settings.headers);
  assert.equal(preflight.get('origin'), SITE); assert.equal(preflight.get('access-control-request-method'), 'GET');
  assert.equal(preflight.has('access-control-request-headers'), false);
  for (const phase of result.phases) {
    for (const key of ['transport', 'url', 'encoding', 'declared', 'body', 'cache']) assert.equal(phase[key], true, phase.phase + ':' + key);
    assert.equal(phase.redirect, false); assert.equal(phase.cookie, false);
  }
  assert.deepEqual(result.phases.map(item => item.status), [200, 200, 404, 204]);
  assert.equal(result.phases[0].receipt, true);
  assert.equal(result.phases[1].size, true); assert.equal(result.phases[1].hash, true); assert.equal(result.phases[1].attachment, false);
  assert.equal(result.phases[2].envelope, true); assert.equal(result.phases[2].errorCode, 'ENTRY_NOT_FOUND');
  assert.equal(result.phases[3].origin, true); assert.equal(result.phases[3].methods, true); assert.equal(result.phases[3].credentials, false); assert.equal(result.phases[3].credentialsValue, 'absent'); assert.equal(result.phases[3].empty, true);
});

test('transport and response failures remain observations and cannot prevent the other fixed probes', async () => {
  const f = fixture(async (url, response) => {
    if (url === URLS[0]) throw new Error(PRIVATE);
    if (url === URLS[1]) return { status: 302, redirected: true, url: 'https://other.invalid/' + PRIVATE, headers: new Headers({ 'content-type': 'text/plain', 'content-encoding': PRIVATE, 'set-cookie': PRIVATE, 'cache-control': PRIVATE }), body: response.body };
    if (url === URLS[2]) return new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: PRIVATE } }), { status: 401, headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } });
    response.headers.set('access-control-allow-origin', PRIVATE); response.headers.set('access-control-allow-methods', PRIVATE); response.headers.set('access-control-allow-credentials', PRIVATE); return response;
  });
  const reports = [], result = await observeEntrySurfaces({ fetchFn: f.fetchFn, report: value => reports.push(value) });
  safe(result, reports); assert.deepEqual(f.calls.map(item => item.url), URLS); assert.equal(result.commit, null);
  assert.equal(result.phases[0].transport, false); assert.equal(result.phases[0].status, null);
  assert.equal(result.phases[1].status, 302); assert.equal(result.phases[1].redirect, true); assert.equal(result.phases[1].url, false);
  assert.equal(result.phases[1].encoding, false); assert.equal(result.phases[1].cookie, true); assert.equal(result.phases[1].hash, false);
  assert.equal(result.phases[2].errorCode, 'AUTH_REQUIRED'); assert.equal(result.phases[3].origin, false); assert.equal(result.phases[3].methods, false); assert.equal(result.phases[3].credentials, true); assert.equal(result.phases[3].credentialsValue, 'other');
});

test('untrusted receipts cannot claim a commit or authorize an entry hash comparison', async () => {
  const changes = [
    value => { value.schemaVersion = 2; }, value => { value.commit = 'A'.repeat(40); },
    value => { value.files = []; }, value => { value.files.push({ ...value.files[0] }); },
    value => { value.files[0].path = '../r/index.html'; }, value => { value.files[0].path = 'private/index.html'; },
    value => { value.files.push({ path: 'release.json', bytes: 1, sha256: 'b'.repeat(64) }); },
    value => { value.files[0].bytes = 0; }, value => { value.files[0].bytes = 1024 * 1024 + 1; },
    value => { value.files[0].sha256 = 'not-a-hash'; }, value => { value.files[0].unexpected = PRIVATE; },
    value => { value.unexpected = PRIVATE; }, value => { value.files.push(...Array.from({ length: 2048 }, (_, index) => ({ path: '_astro/f' + index + '.js', bytes: 1, sha256: 'b'.repeat(64) }))); },
  ];
  for (const change of changes) {
    const value = receipt(); change(value);
    const f = fixture(async (url, response) => url === URLS[0] ? new Response(JSON.stringify(value), { headers: response.headers }) : response);
    const result = await observeEntrySurfaces({ fetchFn: f.fetchFn }); safe(result);
    assert.equal(result.commit, null); assert.equal(result.phases[0].receipt, false); assert.equal(result.phases[1].hash, false);
    assert.equal(f.calls.length, 4);
  }
});

test('observed public bytes and API error codes are checked without reporting their values', async () => {
  for (const code of ['FORBIDDEN', 'NOT_FOUND', 'ORIGIN_REJECTED', 'ENTRY_UNAVAILABLE', PRIVATE]) {
    const f = fixture(async (url, response) => {
      if (url === URLS[1]) { const changed = Buffer.from(html); changed[0] ^= 1; return new Response(changed, { headers: response.headers }); }
      if (url === URLS[2]) return new Response(JSON.stringify({ error: { code, message: PRIVATE } }), { status: 404, headers: response.headers });
      return response;
    });
    const result = await observeEntrySurfaces({ fetchFn: f.fetchFn }); safe(result);
    assert.equal(result.commit, commit); assert.equal(result.phases[1].size, true); assert.equal(result.phases[1].hash, false);
    assert.equal(result.phases[2].envelope, true); assert.equal(result.phases[2].errorCode, code === PRIVATE ? 'OTHER' : code);
  }
  const f = fixture(async (url, response) => url === URLS[2] ? new Response(PRIVATE, { status: 404, headers: response.headers }) : response);
  const result = await observeEntrySurfaces({ fetchFn: f.fetchFn }); safe(result);
  assert.equal(result.phases[2].errorCode, 'UNREADABLE'); assert.equal(result.phases[2].envelope, false);
});

test('oversized receipt and API streams are cancelled, stay bounded and still permit all remaining probes', async () => {
  for (const [url, limit] of [[URLS[0], 1024 * 1024], [URLS[2], 4096]]) {
    let read = false, cancelled = 0;
    const f = fixture(async (requested, response) => requested === url ? new Response(new ReadableStream({
      pull(controller) { read = true; controller.enqueue(new Uint8Array(limit + 1)); }, cancel() { cancelled++; },
    }, { highWaterMark: 0 }), { status: response.status, headers: response.headers }) : response);
    const result = await observeEntrySurfaces({ fetchFn: f.fetchFn }); safe(result);
    const phase = result.phases[url === URLS[0] ? 0 : 2];
    assert.equal(read, true); assert.equal(cancelled, 1); assert.equal(phase.body, false); assert.ok(phase.bytes <= limit);
    assert.equal(f.calls.length, 4);
  }
});

test('each pending fetch and body reader has its own deadline, cancellation and safe result', async t => {
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  const calls = [];
  const stalled = await observeEntrySurfaces({ timeoutMs: 10, fetchFn: async url => { calls.push(url); return new Promise(() => {}); } });
  safe(stalled); assert.deepEqual(calls, URLS); assert.equal(stalled.commit, null);
  assert.ok(stalled.phases.every(item => item.transport === false && item.body === false));
  let read = false, cancelled = 0;
  const f = fixture(async (url, response) => url === URLS[2] ? new Response(new ReadableStream({ pull() { read = true; }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { status: 404, headers: response.headers }) : response);
  const result = await observeEntrySurfaces({ timeoutMs: 10, fetchFn: f.fetchFn }); safe(result);
  assert.equal(read, true); assert.equal(cancelled, 1); assert.equal(result.phases[2].body, false); assert.equal(f.calls.length, 4);
});
