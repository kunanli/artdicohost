import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { verifyCloudAdminPages, CLOUD_ADMIN_ORIGIN } from '../scripts/verify-cloud-admin-pages.mjs';
import { CLOUD_ADMIN_PAGE_ALIASES } from '../functions/cloud-content/http-server.mjs';
import { CANDIDATE_ARCHIVE, CANDIDATE_KIND, CANDIDATE_NODE, CANDIDATE_SOURCES, candidateSha256 } from '../scripts/cloud-content-package.mjs';

const commit = 'a'.repeat(40), PRIVATE = 'PRIVATE-SYNTHETIC-ERROR';
const inline = 'globalThis.syntheticAdmin = true;\r\n';
const rootHtml = Buffer.from('<!doctype html><html><script>' + inline + '</script><p>合成内容页壳</p></html>');
const settingsHtml = Buffer.from('<!doctype html><html><p>合成设置页壳</p></html>');
const csp = (script = '') => "default-src 'self'; script-src 'self'" + (script ? " 'sha256-" + createHash('sha256').update(script.replace(/\r\n?/gu, '\n')).digest('base64') + "'" : '')
  + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function storedZip(items) {
  const parts = [], directories = []; let cursor = 0;
  for (const { path, data, mode } of items) {
    const name = Buffer.from(path), local = Buffer.alloc(30 + name.length), central = Buffer.alloc(46 + name.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(10, 4); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); name.copy(local, 30);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x031e, 4); central.writeUInt16LE(10, 6);
    local.subarray(14, 26).copy(central, 16); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100000 | parseInt(mode, 8)) * 65536, 38); central.writeUInt32LE(cursor, 42); name.copy(central, 46);
    parts.push(local, data); directories.push(central); cursor += local.length + data.length;
  }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(items.length, 8); end.writeUInt16LE(items.length, 10);
  end.writeUInt32LE(directories.reduce((n, bytes) => n + bytes.length, 0), 12); end.writeUInt32LE(cursor, 16);
  return Buffer.concat([...parts, ...directories, end]);
}

async function fixture(t, { mutateManifest = () => {}, mutateRelease = () => {} } = {}) {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-admin-verify-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const items = CANDIDATE_SOURCES.map(([, path, mode]) => ({ path, mode, data: Buffer.from('// synthetic allowlisted source\n') }));
  // A complete bounded ZIP is checked, but this read-only HTTP verifier never
  // executes server sources or re-decompresses the already checked Node binary.
  items.push({ path: 'runtime/node/bin/node.xz', mode: '0644', data: Buffer.from('synthetic runtime bytes; never executed') });
  const sources = [
    ['/admin/', 'admin/index.html', rootHtml],
    ['/admin/contacts/', 'admin/contacts/index.html', Buffer.from('<html>contacts</html>')],
    ['/admin/registrations/', 'admin/registrations/index.html', Buffer.from('<html>registrations</html>')],
    ['/admin/tasks/', 'admin/tasks/index.html', Buffer.from('<html>tasks</html>')],
    ['/admin/settings/', 'admin/settings/index.html', settingsHtml],
    ['/admin/person/', 'admin/person/index.html', Buffer.from('<html>person</html>')],
    ['/admin/volunteers/', 'admin/volunteers/index.html', Buffer.from('<html>volunteers</html>')],
    ['/invitations/template-blank.png', 'invitations/template-blank.png', Buffer.from('synthetic-png')],
    ['/invitations/ggj2026-poster-v2.webp', 'invitations/ggj2026-poster-v2.webp', Buffer.from('synthetic-webp')],
  ];
  const record = item => ({ path: item.path, bytes: item.data.length, sha256: candidateSha256(item.data), mode: item.mode });
  const assets = sources.map(([url, path, data]) => { const item = { path: 'admin-assets/' + path, mode: '0644', data }; items.push(item); return { url, ...record(item) }; });
  const release = { schemaVersion: 1, kind: CANDIDATE_KIND, sourceCommit: commit, node: CANDIDATE_NODE, files: items.map(record), assets };
  mutateRelease(release);
  items.push({ path: 'release.json', mode: '0644', data: Buffer.from(JSON.stringify(release)) });
  const zip = storedZip(items), manifest = { schemaVersion: 1, kind: CANDIDATE_KIND, sourceCommit: commit, node: CANDIDATE_NODE,
    files: items.map(record), archive: { path: CANDIDATE_ARCHIVE, bytes: zip.length, sha256: candidateSha256(zip) }, verification: 'Synthetic exact checked artifact fixture.' };
  mutateManifest(manifest);
  await writeFile(resolve(directory, CANDIDATE_ARCHIVE), zip);
  await writeFile(resolve(directory, 'package-manifest.json'), JSON.stringify(manifest));
  const calls = [];
  const fetchFn = async (url, settings) => {
    calls.push({ url, settings });
    const path = new URL(url).pathname, source = CLOUD_ADMIN_PAGE_ALIASES.find(([route]) => route === path)?.[1];
    assert.ok(source, 'no canonical or fallback request');
    const bytes = source === '/admin/' ? rootHtml : settingsHtml;
    return new Response(bytes, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': String(bytes.length),
      'cache-control': 'no-store', 'content-security-policy': csp(source === '/admin/' ? inline : '') } });
  };
  return { directory, calls, fetchFn, manifest, zip };
}

async function rejects(promise) {
  await assert.rejects(promise, error => error.message === 'Cloud admin page verification failed.' && !error.cause && !error.stack.includes(PRIVATE));
}

test('all13 HTTPS aliases match the exact checked canonical bytes, SHA, MIME and inline CSP anonymously', async t => {
  const f = await fixture(t), reports = [];
  const result = await verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: f.fetchFn, report: line => reports.push(line) });
  assert.deepEqual(result, { verified: true, origin: CLOUD_ADMIN_ORIGIN, commit, pages: 13 });
  assert.deepEqual(f.calls.map(({ url }) => new URL(url).pathname), CLOUD_ADMIN_PAGE_ALIASES.map(([path]) => path));
  assert.equal(reports.length, 13);
  for (const { url, settings } of f.calls) {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.artdico.host'); assert.equal(target.search, ''); assert.equal(target.hash, '');
    assert.equal(settings.method, 'GET'); assert.equal(settings.redirect, 'error'); assert.equal(settings.credentials, 'omit');
    assert.equal(settings.cache, 'no-store'); assert.equal(settings.referrer, ''); assert.equal(settings.referrerPolicy, 'no-referrer');
    assert.deepEqual(Object.keys(settings.headers).sort(), ['accept', 'accept-encoding', 'cache-control', 'pragma']);
    assert.equal(settings.headers['accept-encoding'], 'identity'); assert.equal(settings.signal.aborted, true);
  }
  assert.doesNotMatch(reports.join('\n'), /<html|合成|PRIVATE-|syntheticAdmin/u);
});

test('invalid options and mismatched artifact identities fail before any network access', async t => {
  const f = await fixture(t);
  for (const patch of [{ commit: 'b'.repeat(40) }, { commit: 'main' }, { timeoutMs: 15_001 }, { timeoutMs: 0 }, { overallTimeoutMs: 45_001 }, { overallTimeoutMs: 0 }]) {
    await rejects(verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: f.fetchFn, ...patch }));
  }
  assert.equal(f.calls.length, 0);
  for (const mutateManifest of [value => { value.sourceCommit = 'b'.repeat(40); }, value => { value.node = { ...value.node, version: 'v24.0.0' }; },
    value => { value.extra = PRIVATE; }, value => { value.archive.path = '../private.zip'; }, value => { value.archive.sha256 = '0'.repeat(64); },
    value => { value.files.find(file => file.path === 'admin-assets/admin/index.html').bytes = 2 * 1024 * 1024 + 1; }]) {
    const broken = await fixture(t, { mutateManifest });
    await rejects(verifyCloudAdminPages({ directory: broken.directory, commit, fetchFn: broken.fetchFn }));
    assert.equal(broken.calls.length, 0);
  }
  const broken = await fixture(t, { mutateRelease: value => { value.sourceCommit = 'b'.repeat(40); } });
  await rejects(verifyCloudAdminPages({ directory: broken.directory, commit, fetchFn: broken.fetchFn }));
  assert.equal(broken.calls.length, 0);
});

test('corrupted ZIPs, unexpected publication files and symlinked artifacts fail before public requests', async t => {
  const corrupt = await fixture(t), altered = Buffer.from(corrupt.zip); altered[100] ^= 1;
  await writeFile(resolve(corrupt.directory, CANDIDATE_ARCHIVE), altered);
  await rejects(verifyCloudAdminPages({ directory: corrupt.directory, commit, fetchFn: corrupt.fetchFn })); assert.equal(corrupt.calls.length, 0);
  const extra = await fixture(t); await writeFile(resolve(extra.directory, 'private.json'), PRIVATE);
  await rejects(verifyCloudAdminPages({ directory: extra.directory, commit, fetchFn: extra.fetchFn })); assert.equal(extra.calls.length, 0);
  const linked = await fixture(t), original = resolve(linked.directory, CANDIDATE_ARCHIVE);
  const outside = resolve(linked.directory, '..', 'artdico-synthetic-link-' + linked.directory.split('/').at(-1));
  await writeFile(outside, linked.zip); t.after(() => rm(outside, { force: true }));
  await rm(original); await symlink(outside, original);
  await rejects(verifyCloudAdminPages({ directory: linked.directory, commit, fetchFn: linked.fetchFn })); assert.equal(linked.calls.length, 0);
});

test('public entry notices and wrong canonical shells cannot masquerade as a successful API alias', async t => {
  const f = await fixture(t);
  for (const bytes of [Buffer.from('<html>前往云端工作人员后台</html>'), settingsHtml, Buffer.from(rootHtml.toString().replace('syntheticAdmin', 'syntheticAltered'))]) {
    let calls = 0;
    await rejects(verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: async (...args) => {
      calls++; const response = await f.fetchFn(...args); response.headers.delete('content-length'); return new Response(bytes, { headers: response.headers });
    } }));
    assert.equal(calls, 1, 'no redirect, canonical fallback or retry after mismatch');
  }
});

test('wrong status, CSP, MIME, encoding, cookies, redirects and invalid lengths never verify', async t => {
  const f = await fixture(t);
  for (const change of [
    response => { response.headers.set('content-security-policy', "default-src *; script-src 'unsafe-inline'"); return response; },
    response => { response.headers.set('content-security-policy', csp('a different inline script')); return response; },
    response => { response.headers.set('content-type', 'application/octet-stream'); return response; },
    response => { response.headers.set('content-disposition', 'attachment; filename=page.html'); return response; },
    response => { response.headers.set('content-encoding', 'gzip'); return response; },
    response => { response.headers.set('set-cookie', 'synthetic=private'); return response; },
    response => { response.headers.set('cache-control', 'public'); return response; },
    response => { response.headers.set('content-length', '999999999999999999999'); return response; },
    response => { response.headers.set('content-length', '1'); return response; },
    response => ({ status: 200, redirected: true, headers: response.headers, body: response.body }),
    response => ({ status: 200, url: CLOUD_ADMIN_ORIGIN + '/admin/?private=' + PRIVATE, headers: response.headers, body: response.body }),
    response => ({ status: 404, headers: response.headers, body: response.body }),
    () => { throw new Error(PRIVATE); },
  ]) await rejects(verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: async (...args) => change(await f.fetchFn(...args)) }));
});

test('HTML streams are bounded without Content-Length and truncated bytes fail the exact hash', async t => {
  const f = await fixture(t); let cancelled = 0;
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); response.headers.delete('content-length');
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); }, cancel() { cancelled++; } }), { headers: response.headers });
  } }));
  assert.equal(cancelled, 1);
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); response.headers.delete('content-length'); return new Response(rootHtml.subarray(0, -1), { headers: response.headers });
  } }));
});

test('per-request and overall deadlines bound dependencies which ignore abort, including body readers', async t => {
  const f = await fixture(t); let signal;
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, timeoutMs: 5, fetchFn: async (_url, settings) => { signal = settings.signal; return new Promise(() => {}); } }));
  assert.equal(signal.aborted, true);
  let cancelled = 0;
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, timeoutMs: 5, fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); response.headers.delete('content-length');
    return new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: response.headers });
  } }));
  assert.equal(cancelled, 1);
  const began = performance.now(); let calls = 0;
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, timeoutMs: 3000, overallTimeoutMs: 500, fetchFn: async (_url, settings) => { calls++; signal = settings.signal; return new Promise(() => {}); } }));
  assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.ok(performance.now() - began < 2000);
});

test('overall deadline spans all13 individually timely requests rather than restarting for each page', async t => {
  const f = await fixture(t); let calls = 0;
  await rejects(verifyCloudAdminPages({ directory: f.directory, commit, timeoutMs: 1000, overallTimeoutMs: 500, fetchFn: async (...args) => {
    calls++; await new Promise(resolve => setTimeout(resolve, 70)); return f.fetchFn(...args);
  } }));
  assert.ok(calls > 1 && calls < 13);
});

test('a transport returning after timeout has its unconsumed body cancelled without a fallback request', async t => {
  const f = await fixture(t); let release, started; const began = new Promise(resolve => { started = resolve; });
  const result = rejects(verifyCloudAdminPages({ directory: f.directory, commit, timeoutMs: 5, fetchFn: async () => { started(); return new Promise(resolve => { release = resolve; }); } }));
  await began; await result;
  let cancelled = 0;
  release(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test('workflow adds anonymous verification only after lifecycle activation under the unchanged production job gate', async () => {
  const workflow = await readFile(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const fc = workflow.slice(workflow.indexOf('\n  deploy-fc:'));
  assert.ok(fc.includes("if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' && github.repository == 'kunanli/artdicohost' && vars.ARTDICO_FC_DEPLOY_ENABLED == 'true' }}"));
  const lifecycle = fc.indexOf('run: node scripts/cloud-lifecycle.mjs .local-data/cloud-content-publication');
  const verification = fc.indexOf('- name: Verify all fixed admin subpages');
  assert.ok(lifecycle >= 0 && verification > lifecycle);
  const step = fc.slice(verification);
  assert.match(step, /timeout-minutes: 1/u);
  assert.match(step, /run: node scripts\/verify-cloud-admin-pages\.mjs \.local-data\/cloud-content-publication/u);
  assert.doesNotMatch(step, /env:|secret|token|continue-on-error|always\(\)|workflow_dispatch/iu);
});
