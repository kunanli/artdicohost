import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareOssSite } from '../scripts/prepare-oss-site.mjs';
import { verifyEntrySurfaces } from '../scripts/verify-entry-surfaces.mjs';

const commit = 'a'.repeat(40), PRIVATE = 'PRIVATE-SYNTHETIC-RESPONSE';
const SITE = 'https://artdico.host', API = 'https://api.artdico.host/api/admin/registration/entry-links/';
const PUBLIC = SITE + '/r/', INVALID = API + 'invalid', PREFLIGHT = API + 'A'.repeat(22);
const ERROR = JSON.stringify({ error: { code: 'ENTRY_NOT_FOUND', message: '合成无效入口' } });
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'artdico-entry-surfaces-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = resolve(root, 'dist'), directory = resolve(root, 'publication');
  for (const name of ['invitation', 'invitations', 'registration/confirmation', 'r', 'wallet']) await mkdir(resolve(dist, name), { recursive: true });
  for (const name of ['index.html', 'invitation/index.html', 'registration/confirmation/index.html', 'r/index.html']) await writeFile(resolve(dist, name), '<html>合成公开入口 ' + name + '</html>');
  for (const name of ['invitations/template-blank.png', 'invitations/ggj2026-poster-v2.webp']) await writeFile(resolve(dist, name), 'synthetic-public-image');
  for (const locale of ['cn', 'en']) for (const extension of ['png', 'svg']) await writeFile(resolve(dist, 'wallet/add-to-apple-wallet-' + locale + '.' + extension), 'synthetic-public-badge');
  await prepareOssSite({ distDirectory: dist, outputDirectory: directory, commit });
  const bytes = await readFile(resolve(directory, 'r/index.html')), calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    if (url === PUBLIC) return new Response(bytes, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(bytes.length), 'cache-control': 'public,no-cache' } });
    if (url === INVALID) return new Response(ERROR, { status: 404, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private,no-store' } });
    if (url === PREFLIGHT) return new Response(null, { status: 204, headers: { 'access-control-allow-origin': SITE, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-max-age': '0', 'cache-control': 'private,no-store' } });
    throw new Error(PRIVATE);
  };
  return { directory, bytes, calls, fetchFn };
}
async function reject(promise) {
  await assert.rejects(promise, error => error.message === 'Entry surfaces release verification failed.' && !error.cause && !error.stack.includes(PRIVATE));
}

test('exact directory route and canonical API probes use only fixed credential-free read requests', async t => {
  const f = await fixture(t), reports = [];
  const result = await verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: f.fetchFn, report: value => reports.push(value) });
  assert.deepEqual(result, { verified: true, publicEntry: true, invalidEntry: true, cors: true, requests: 3, commit });
  assert.deepEqual(f.calls.map(({ url }) => url), [PUBLIC, INVALID, PREFLIGHT]);
  assert.deepEqual(f.calls.map(({ settings }) => settings.method), ['GET', 'GET', 'OPTIONS']);
  for (const { settings } of f.calls) {
    assert.equal(settings.credentials, 'omit'); assert.equal(settings.redirect, 'error'); assert.equal(settings.cache, 'no-store');
    assert.equal(settings.referrerPolicy, 'no-referrer'); assert.equal(settings.body, undefined); assert.equal(settings.signal.aborted, true);
    const headers = new Headers(settings.headers);
    assert.equal(headers.has('authorization'), false); assert.equal(headers.has('cookie'), false); assert.equal(headers.has('referer'), false);
  }
  const preflight = new Headers(f.calls[2].settings.headers);
  assert.equal(preflight.get('origin'), SITE); assert.equal(preflight.get('access-control-request-method'), 'GET');
  assert.equal(preflight.has('access-control-request-headers'), false);
  assert.equal(JSON.stringify([result, ...reports]).includes(PRIVATE), false);
  assert.equal(JSON.stringify([result, ...reports]).includes(ERROR), false, 'verification reports never contain provider bodies');
});

test('wrong commit, invalid options and corrupted publication fail before any network request', async t => {
  const f = await fixture(t);
  for (const patch of [{ commit: 'b'.repeat(40) }, { commit: 'main' }, { timeoutMs: 0 }]) await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: f.fetchFn, ...patch }));
  await writeFile(resolve(f.directory, 'r/index.html'), PRIVATE);
  await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: f.fetchFn }));
  assert.equal(f.calls.length, 0);
});

test('directory bytes must match the published hash and cannot redirect to an object or another release', async t => {
  const f = await fixture(t);
  const changes = [
    response => { const bytes = Buffer.from(f.bytes); bytes[0] ^= 1; return new Response(bytes, { headers: response.headers }); },
    response => ({ ...response, status: 200, redirected: true, headers: response.headers, body: response.body }),
    response => ({ status: 200, url: SITE + '/r/index.html', headers: response.headers, body: response.body }),
    response => { response.headers.set('content-type', 'application/octet-stream'); return response; },
    response => { response.headers.set('content-disposition', 'attachment'); return response; },
    response => { response.headers.set('content-length', '99999999999999999999'); return response; },
  ];
  for (const change of changes) await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); return args[0] === PUBLIC ? change(response) : response;
  } }));
});

test('canonical malformed API route requires its specific not-found response rather than authentication or generic failure', async t => {
  const f = await fixture(t);
  for (const [status, body] of [[401, ERROR], [404, JSON.stringify({ error: { code: 'NOT_FOUND', message: PRIVATE } })], [404, '<html>' + PRIVATE + '</html>'], [200, ERROR]]) {
    await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: async (...args) => args[0] === INVALID
      ? new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } }) : f.fetchFn(...args) }));
  }
});

test('preflight rejects wildcard or credentialed CORS, changed methods, redirects and incorrect status', async t => {
  const f = await fixture(t);
  const changes = [
    response => { response.headers.set('access-control-allow-origin', '*'); return response; },
    response => { response.headers.set('access-control-allow-credentials', 'true'); return response; },
    response => { response.headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS, POST'); return response; },
    response => { response.headers.set('access-control-allow-methods', 'GET, OPTIONS'); return response; },
    response => ({ status: 204, redirected: true, headers: response.headers, body: null }),
    response => new Response(null, { status: 200, headers: response.headers }),
  ];
  for (const change of changes) await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); return args[0] === PREFLIGHT ? change(response) : response;
  } }));
});

test('API response streams are byte bounded and cancelled without exposing their contents', async t => {
  const f = await fixture(t); let cancelled = 0, read = false;
  await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: async (...args) => args[0] === INVALID
    ? new Response(new ReadableStream({ pull(controller) { read = true; controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } })
    : f.fetchFn(...args) }));
  assert.equal(read, true); assert.equal(cancelled, 1);
});

test('deadlines cover ignored fetch aborts and pending body readers, and raw dependency errors stay private', async t => {
  const f = await fixture(t), keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await reject(verifyEntrySurfaces({ directory: f.directory, commit, timeoutMs: 10, fetchFn: async () => new Promise(() => {}) }));
  let cancelled = 0, read = false;
  await reject(verifyEntrySurfaces({ directory: f.directory, commit, timeoutMs: 10, fetchFn: async (...args) => args[0] === INVALID
    ? new Response(new ReadableStream({ pull() { read = true; }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'private,no-store' } })
    : f.fetchFn(...args) }));
  assert.equal(read, true); assert.equal(cancelled, 1);
  await reject(verifyEntrySurfaces({ directory: f.directory, commit, fetchFn: async () => { throw new Error(PRIVATE); } }));
});
