import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareOssSite, PUBLIC_ADMIN_PAGE_ALIASES } from '../scripts/prepare-oss-site.mjs';
import { contentType } from '../scripts/deploy-oss.mjs';
import { verifyPublicDomain, PUBLIC_SITE_ORIGIN } from '../scripts/verify-public-domain.mjs';

const commit = 'a'.repeat(40), PRIVATE = 'PRIVATE-SYNTHETIC-RESPONSE';
// The previous synthetic release had 28 exact objects. This stage adds precisely
// the short entry page, four official-badge variants, and the public check-in notice.
const ENTRY_PUBLIC_OBJECTS = Object.freeze(['r/index.html', 'wallet/add-to-apple-wallet-cn.png', 'wallet/add-to-apple-wallet-cn.svg',
  'wallet/add-to-apple-wallet-en.png', 'wallet/add-to-apple-wallet-en.svg', 'admin/checkin/index.html']);
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-domain-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = resolve(directory, 'dist'), output = resolve(directory, 'publication');
  for (const name of ['invitation', 'invitations', 'registration/confirmation', 'r', 'wallet', '_astro']) await mkdir(resolve(dist, name), { recursive: true });
  await writeFile(resolve(dist, 'index.html'), '<html><script src="/_astro/public.js"></script></html>');
  await writeFile(resolve(dist, 'invitation/index.html'), '<html>合成邀请</html>');
  await writeFile(resolve(dist, 'registration/confirmation/index.html'), '<html>合成确认页；无参会资料</html>');
  await writeFile(resolve(dist, 'r/index.html'), '<html>合成短链接入口；无票码或参会资料</html>');
  for (const locale of ['cn', 'en']) {
    await writeFile(resolve(dist, 'wallet/add-to-apple-wallet-' + locale + '.png'), Buffer.from([137, 80, 78, 71, locale === 'cn' ? 1 : 2]));
    await writeFile(resolve(dist, 'wallet/add-to-apple-wallet-' + locale + '.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><title>synthetic ' + locale + ' badge</title></svg>');
  }
  await writeFile(resolve(dist, 'invitations/template-blank.png'), Buffer.from([0, 1, 2, 255]));
  await writeFile(resolve(dist, 'invitations/ggj2026-poster-v2.webp'), Buffer.from([0, 1, 2, 255]));
  await writeFile(resolve(dist, '_astro/public.js'), '/* synthetic public script */');
  const manifest = await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  const calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    const path = decodeURIComponent(new URL(url).pathname.slice(1)), bytes = await readFile(resolve(output, path));
    return new Response(bytes, { headers: { 'content-type': contentType(path), 'content-length': String(bytes.length), 'cache-control': 'public,no-cache' } });
  };
  return { output, manifest, fetchFn, calls };
}
async function reject(promise) { await assert.rejects(promise, error => error.message === 'Public domain release verification failed.' && !error.cause && !error.stack.includes(PRIVATE)); }

test('real-domain verification validates publication then reads every exact object without credentials, redirects or cache', async t => {
  const f = await fixture(t), reports = [];
  const result = await verifyPublicDomain({ directory: f.output, commit, fetchFn: f.fetchFn, report: line => reports.push(line) });
  assert.deepEqual(result, { verified: true, origin: PUBLIC_SITE_ORIGIN, commit, files: f.manifest.files.length });
  assert.equal(f.manifest.files.length, 28 + 6, 'the fixture adds exactly six reviewed public objects');
  assert.equal(f.calls.length, f.manifest.files.length); assert.equal(reports.length, f.manifest.files.length);
  for (const path of ENTRY_PUBLIC_OBJECTS) {
    assert.equal(f.manifest.files.filter(item => item.path === path).length, 1, path);
    assert.equal(f.calls.filter(({ url }) => new URL(url).pathname === '/' + path).length, 1, path);
    assert.equal(reports.filter(line => line === 'Verified HTTPS public object ' + path).length, 1, path);
  }
  for (const route of PUBLIC_ADMIN_PAGE_ALIASES) {
    assert.ok(f.calls.some(({ url }) => new URL(url).pathname === route + 'index.html'), route);
  }
  for (const { url, settings } of f.calls) {
    assert.equal(new URL(url).origin, 'https://artdico.host'); assert.equal(new URL(url).search, '?release=' + commit);
    assert.equal(settings.credentials, 'omit'); assert.equal(settings.redirect, 'error'); assert.equal(settings.cache, 'no-store');
    assert.equal(settings.headers['accept-encoding'], 'identity'); assert.equal(Object.hasOwn(settings.headers, 'authorization'), false); assert.equal(Object.hasOwn(settings.headers, 'cookie'), false);
    assert.equal(settings.signal.aborted, true);
  }
});

test('mismatched commit, corrupt local bytes and invalid options fail before network access', async t => {
  const f = await fixture(t);
  await reject(verifyPublicDomain({ directory: f.output, commit: 'b'.repeat(40), fetchFn: f.fetchFn }));
  await reject(verifyPublicDomain({ directory: f.output, commit: 'main', fetchFn: f.fetchFn }));
  await writeFile(resolve(f.output, 'index.html'), PRIVATE);
  await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: f.fetchFn }));
  assert.equal(f.calls.length, 0);
});

test('reviewed public cache policy tolerates directive order, case and whitespace', async t => {
  const f = await fixture(t);
  for (const value of ['PUBLIC, NO-CACHE', 'no-cache,public', ' public , no-cache ']) {
    const result = await verifyPublicDomain({ directory: f.output, commit, fetchFn: async (...args) => {
      const response = await f.fetchFn(...args); response.headers.set('cache-control', value); return response;
    } });
    assert.equal(result.files, f.manifest.files.length);
  }
});

test('missing, unexpected or contradictory cache policy cannot verify exact matching public bytes', async t => {
  const f = await fixture(t);
  for (const value of [null, '', 'public,max-age=3600', 'public,no-cache,immutable', 'private,no-cache',
    'public,no-cache,private', 'public,no-cache,no-store', 'public,no-cache,max-age=0', 'no-cache']) {
    const reports = [];
    await reject(verifyPublicDomain({ directory: f.output, commit, report: line => reports.push(line), fetchFn: async (...args) => {
      const response = await f.fetchFn(...args);
      if (value === null) response.headers.delete('cache-control'); else response.headers.set('cache-control', value);
      return response;
    } }));
    assert.deepEqual(reports, [], 'incorrect cache policy is rejected before reporting the first object as verified');
  }
});

test('wrong bytes, HTML type, attachment, response encoding, redirects and oversized declarations never verify', async t => {
  const f = await fixture(t);
  for (const change of [
    async response => new Response(PRIVATE, { headers: response.headers }),
    async response => { const bytes = Buffer.from(await response.arrayBuffer()); bytes[0] ^= 1; return new Response(bytes, { headers: response.headers }); },
    async response => { response.headers.set('content-type', 'application/octet-stream'); return response; },
    async response => { response.headers.set('content-disposition', 'attachment'); return response; },
    async response => { response.headers.set('content-encoding', 'gzip'); return response; },
    async response => { response.headers.set('content-length', '99999999999999999999'); return response; },
    async response => ({ status: 200, redirected: true, headers: response.headers, body: response.body }),
    async response => ({ status: 200, url: 'https://other.invalid/' + PRIVATE, headers: response.headers, body: response.body }),
    async () => { throw new Error(PRIVATE); },
  ]) {
    await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: async (...args) => change(await f.fetchFn(...args)) }));
  }
});

test('actual streams are bounded even without Content-Length and truncated bytes cannot match a release', async t => {
  const f = await fixture(t); let cancelled = 0, readStarted = false;
  const stream = () => new ReadableStream({ pull(controller) { readStarted = true; controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: async url => new Response(stream(), { headers: { 'content-type': contentType(new URL(url).pathname), 'cache-control': 'public,no-cache' } }) }));
  assert.equal(readStarted, true, 'size failure must exercise a body read rather than an unrelated header rejection');
  assert.equal(cancelled, 1);
  await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: async url => new Response(new Uint8Array(), { headers: { 'content-type': contentType(new URL(url).pathname), 'cache-control': 'public,no-cache' } }) }));
});

test('timeouts bound fetch and body readers even when the dependency ignores abort', async t => {
  const f = await fixture(t);
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await reject(verifyPublicDomain({ directory: f.output, commit, timeoutMs: 10, fetchFn: async () => new Promise(() => {}) }));
  let cancelled = 0, readStarted = false;
  await reject(verifyPublicDomain({ directory: f.output, commit, timeoutMs: 10, fetchFn: async url => new Response(new ReadableStream({ pull() { readStarted = true; }, cancel() { cancelled++; } }, { highWaterMark: 0 }), { headers: { 'content-type': contentType(new URL(url).pathname), 'cache-control': 'public,no-cache' } }) }));
  assert.equal(readStarted, true, 'body deadline must exercise a pending reader');
  assert.equal(cancelled, 1);
});
