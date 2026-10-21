import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { prepareOssSite } from '../scripts/prepare-oss-site.mjs';
import { contentType } from '../scripts/deploy-oss.mjs';
import { verifyPublicDomain, PUBLIC_SITE_ORIGIN } from '../scripts/verify-public-domain.mjs';

const commit = 'a'.repeat(40), PRIVATE = 'PRIVATE-SYNTHETIC-RESPONSE';
async function fixture(t) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-domain-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dist = resolve(directory, 'dist'), output = resolve(directory, 'publication');
  for (const name of ['invitation', 'invitations', 'registration/confirmation', '_astro']) await mkdir(resolve(dist, name), { recursive: true });
  await writeFile(resolve(dist, 'index.html'), '<html><script src="/_astro/public.js"></script></html>');
  await writeFile(resolve(dist, 'invitation/index.html'), '<html>合成邀请</html>');
  await writeFile(resolve(dist, 'registration/confirmation/index.html'), '<html>合成确认页；无参会资料</html>');
  await writeFile(resolve(dist, 'invitations/template-blank.png'), Buffer.from([0, 1, 2, 255]));
  await writeFile(resolve(dist, 'invitations/ggj2026-poster-v2.webp'), Buffer.from([0, 1, 2, 255]));
  await writeFile(resolve(dist, '_astro/public.js'), '/* synthetic public script */');
  const manifest = await prepareOssSite({ distDirectory: dist, outputDirectory: output, commit });
  const calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    const path = decodeURIComponent(new URL(url).pathname.slice(1)), bytes = await readFile(resolve(output, path));
    return new Response(bytes, { headers: { 'content-type': contentType(path), 'content-length': String(bytes.length) } });
  };
  return { output, manifest, fetchFn, calls };
}
async function reject(promise) { await assert.rejects(promise, error => error.message === 'Public domain release verification failed.' && !error.cause && !error.stack.includes(PRIVATE)); }

test('real-domain verification validates publication then reads every exact object without credentials, redirects or cache', async t => {
  const f = await fixture(t), reports = [];
  const result = await verifyPublicDomain({ directory: f.output, commit, fetchFn: f.fetchFn, report: line => reports.push(line) });
  assert.deepEqual(result, { verified: true, origin: PUBLIC_SITE_ORIGIN, commit, files: f.manifest.files.length });
  assert.equal(f.calls.length, f.manifest.files.length); assert.equal(reports.length, f.manifest.files.length);
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
  const f = await fixture(t); let cancelled = 0;
  const stream = () => new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled++; } });
  await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: async url => new Response(stream(), { headers: { 'content-type': contentType(new URL(url).pathname) } }) }));
  assert.equal(cancelled, 1);
  await reject(verifyPublicDomain({ directory: f.output, commit, fetchFn: async url => new Response(new Uint8Array(), { headers: { 'content-type': contentType(new URL(url).pathname) } }) }));
});

test('timeouts bound fetch and body readers even when the dependency ignores abort', async t => {
  const f = await fixture(t);
  const keepAlive = setInterval(() => {}, 1000); t.after(() => clearInterval(keepAlive));
  await reject(verifyPublicDomain({ directory: f.output, commit, timeoutMs: 10, fetchFn: async () => new Promise(() => {}) }));
  let cancelled = 0;
  await reject(verifyPublicDomain({ directory: f.output, commit, timeoutMs: 10, fetchFn: async url => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': contentType(new URL(url).pathname) } }) }));
  assert.equal(cancelled, 1);
});
