import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { capturePublicVisualFixture } from '../scripts/capture-public-visual-fixture.mjs';
import { PUBLIC_CONTENT_URL, PUBLIC_CONTENT_ORIGIN } from '../scripts/verify-public-content.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';

const PRIVATE = 'SYNTHETIC_PRIVATE_RESPONSE_NEVER_LOG', PUBLIC_NAME = 'SYNTHETIC_PUBLIC_NAME_NEVER_LOG';
const COMMIT = 'c'.repeat(40), AT = Date.parse('2026-11-01T11:00:00.000Z');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1cAAAAASUVORK5CYII=', 'base64');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const publicHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': PUBLIC_CONTENT_ORIGIN, vary: 'Origin' };
function publication(images = [png]) {
  const content = createInitialContent(); content.event.title = PUBLIC_NAME;
  content.organizations = images.map((bytes, index) => ({ id: 'synthetic-org-' + index, name: PUBLIC_NAME + index,
    logoId: sha(bytes) + '.png', website: '', participation: 'undecided', status: 'confirmed', publicConsent: false, internalNotes: PRIVATE }));
  content.guests = [{ id: 'synthetic-public-guest', name: PUBLIC_NAME, company: '合成机构', portraitId: 'd'.repeat(64) + '.png',
    ggjRole: '', status: 'confirmed', publicConsent: false, internalNotes: PRIVATE, contactId: '' }];
  return { revision: 43, publishedAt: new Date(AT).toISOString(), content: toPublicContent(content) };
}
async function fixture(t, images = [png]) {
  const temporary = await mkdtemp(resolve(tmpdir(), 'artdico-public-visual-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outputDirectory = resolve(temporary, 'capture'), data = publication(images), calls = [];
  const raw = Buffer.from(' \n' + JSON.stringify(data, null, 1) + '\n');
  const media = new Map(images.map(bytes => ['/api/public/portraits/' + sha(bytes) + '.png', bytes]));
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    if (url === PUBLIC_CONTENT_URL) return new Response(raw, { headers: { ...publicHeaders, 'content-length': String(raw.length) } });
    assert.equal(new URL(url).origin, new URL(PUBLIC_CONTENT_URL).origin, 'only the fixed public API origin may be contacted');
    const bytes = media.get(new URL(url).pathname); assert.ok(bytes, 'media URL must come from this exact public publication');
    return new Response(bytes, { headers: { 'content-type': 'image/png', 'content-length': String(bytes.length) } });
  };
  const capture = options => capturePublicVisualFixture({ outputDirectory, sourceCommit: COMMIT, clock: () => AT, fetchFn, ...options });
  return { temporary, outputDirectory, data, raw, media, calls, fetchFn, capture };
}
async function rejected(promise, code) {
  await assert.rejects(promise, error => error.message === 'Public visual fixture capture failed.' && !error.cause
    && !error.stack.includes(PRIVATE) && !error.stack.includes(PUBLIC_NAME) && (!code || error.code === code));
}
async function absent(directory) { await assert.rejects(access(directory), { code: 'ENOENT' }); }

test('one validated anonymous public response supplies exact snapshot bytes and only referenced deduplicated organization logos', async t => {
  const f = await fixture(t, [png, png]), before = JSON.stringify(f.data), report = await f.capture();
  assert.equal(f.calls.filter(call => call.url === PUBLIC_CONTENT_URL).length, 1);
  assert.equal(f.calls.length, 2, 'no second snapshot GET, guest portrait request or guessed media URL');
  for (const { url, options } of f.calls) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.equal(options.cache, 'no-store'); assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.referrer, '');
    assert.equal(options.headers.origin, PUBLIC_CONTENT_ORIGIN); assert.equal(options.headers['accept-encoding'], 'identity');
    assert.equal(Object.keys(options.headers).some(name => /cookie|authorization/iu.test(name)), false);
    assert.equal(options.signal.aborted, true); assert.equal(new URL(url).search, '');
  }
  assert.deepEqual(await readFile(resolve(f.outputDirectory, 'snapshot.json')), f.raw);
  assert.deepEqual(await readFile(resolve(f.outputDirectory, 'media/' + sha(png) + '.png')), png);
  const manifest = JSON.parse(await readFile(resolve(f.outputDirectory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.snapshot, { file: 'snapshot.json', bytes: f.raw.length, sha256: sha(f.raw), revision: 43, publishedAt: new Date(AT).toISOString() });
  assert.deepEqual(manifest.media, [{ file: 'media/' + sha(png) + '.png', path: '/api/public/portraits/' + sha(png) + '.png', sha256: sha(png), bytes: png.length, contentType: 'image/png' }]);
  assert.equal(manifest.source, PUBLIC_CONTENT_URL); assert.equal(manifest.sourceCommit, COMMIT); assert.equal(manifest.capturedAt, new Date(AT).toISOString()); assert.equal(manifest.anonymous, true);
  assert.equal(manifest.counts.organizations, 2); assert.equal(report.media, 1); assert.equal(report.mediaBytes, png.length);
  assert.equal(JSON.stringify(f.data), before); assert.doesNotMatch(JSON.stringify({ manifest, report }), /SYNTHETIC_PUBLIC_NAME|SYNTHETIC_PRIVATE|contactId|receiptToken|internalNotes/u);
});

test('unpublished, private, malformed or foreign-logo snapshots never start a media request and leave no output', async t => {
  for (const mutate of [null, data => { data.content.internalNotes = PRIVATE; }, data => { data.content.organizations[0].logoUrl = 'https://foreign.invalid/' + PRIVATE; },
    data => { data.content.organizations[0].logoUrl += '?secret=' + PRIVATE; }, data => { data.content.organizations[0].logoUrl = '/api/public/portraits/../' + PRIVATE; }]) {
    const f = await fixture(t); let requests = 0;
    await rejected(f.capture({ fetchFn: async url => {
      requests++; assert.equal(url, PUBLIC_CONTENT_URL);
      if (mutate === null) return new Response(JSON.stringify({ error: { code: 'NOT_PUBLISHED', message: PRIVATE } }), { status: 404, headers: publicHeaders });
      mutate(f.data); return new Response(JSON.stringify(f.data), { headers: publicHeaders });
    } }), mutate === null ? 'NOT_PUBLISHED' : undefined);
    assert.equal(requests, 1); await absent(f.outputDirectory);
  }
});

test('more than thirty distinct published logos fails before any media fetch', async t => {
  const f = await fixture(t), data = publication(Array.from({ length: 31 }, (_, i) => Buffer.from('synthetic-logo-' + i)));
  await rejected(f.capture({ fetchFn: async (url, options) => { f.calls.push({ url, options }); assert.equal(url, PUBLIC_CONTENT_URL); return new Response(JSON.stringify(data), { headers: publicHeaders }); } }), 'MEDIA_LIMIT');
  assert.equal(f.calls.length, 1); await absent(f.outputDirectory);
});

test('media redirects, foreign response URLs, MIME changes, cookies and corrupt content fail without retaining a partial capture', async t => {
  for (const change of [response => { Object.defineProperty(response, 'redirected', { value: true }); return response; },
    response => { Object.defineProperty(response, 'url', { value: 'https://foreign.invalid/' + PRIVATE }); return response; },
    response => { response.headers.set('content-type', 'image/jpeg'); return response; },
    response => { response.headers.set('set-cookie', PRIVATE); return response; },
    response => { response.headers.set('content-encoding', 'gzip'); return response; },
    response => new Response(PRIVATE, { status: 404, headers: response.headers }),
    response => new Response(Buffer.alloc(png.length), { headers: response.headers }),
  ]) {
    const f = await fixture(t);
    await rejected(f.capture({ fetchFn: async (...args) => { const response = await f.fetchFn(...args); return args[0] === PUBLIC_CONTENT_URL ? response : change(response); } }));
    await absent(f.outputDirectory);
  }
  const f = await fixture(t, [png, Buffer.concat([png, Buffer.from('second')])]);
  await rejected(f.capture({ fetchFn: async (...args) => {
    const response = await f.fetchFn(...args); return f.calls.length === 3 ? new Response(PRIVATE, { headers: { 'content-type': 'image/png' } }) : response;
  } }), 'MEDIA_HASH');
  assert.equal(f.calls.length, 3); await absent(f.outputDirectory);
});

test('actual streamed media bytes are bounded at two MiB, including absent or truncated length declarations', async t => {
  const f = await fixture(t); let pulled = false, cancelled = 0;
  await rejected(f.capture({ fetchFn: async (...args) => args[0] === PUBLIC_CONTENT_URL ? f.fetchFn(...args) : new Response(new ReadableStream({
    pull(controller) { pulled = true; controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled++; },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } }) }), 'MEDIA_BODY');
  assert.equal(pulled, true); assert.equal(cancelled, 1); await absent(f.outputDirectory);
  const short = await fixture(t);
  await rejected(short.capture({ fetchFn: async (...args) => args[0] === PUBLIC_CONTENT_URL ? short.fetchFn(...args) : new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(png.length + 1) } }) }), 'MEDIA_BODY');
  await absent(short.outputDirectory);
});

test('the total media budget cannot exceed eight MiB across otherwise valid individually bounded files', async t => {
  const images = Array.from({ length: 5 }, (_, index) => { const bytes = Buffer.alloc(2 * 1024 * 1024, index); png.copy(bytes); return bytes; });
  const f = await fixture(t, images);
  await rejected(f.capture(), 'MEDIA_BODY'); assert.equal(f.calls.length, 6); await absent(f.outputDirectory);
});

test('deadlines bound ignored-abort media fetches and pending readers, and cancel late responses', async t => {
  const f = await fixture(t); let resolveFetch, signal, cancelled = false;
  await rejected(f.capture({ timeoutMs: 10, fetchFn: async (...args) => {
    if (args[0] === PUBLIC_CONTENT_URL) return f.fetchFn(...args);
    signal = args[1].signal; return new Promise(resolve => { resolveFetch = resolve; });
  } }), 'TIMEOUT');
  assert.equal(signal.aborted, true); await absent(f.outputDirectory);
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'image/png' } }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
  const body = await fixture(t); let pulled = false, bodyCancelled = false;
  await rejected(body.capture({ timeoutMs: 10, fetchFn: async (...args) => args[0] === PUBLIC_CONTENT_URL ? body.fetchFn(...args) : new Response(new ReadableStream({
    pull() { pulled = true; }, cancel() { bodyCancelled = true; },
  }, { highWaterMark: 0 }), { headers: { 'content-type': 'image/png' } }) }), 'TIMEOUT');
  assert.equal(pulled, true); assert.equal(bodyCancelled, true); await absent(body.outputDirectory);
});

test('an existing capture is never overwritten or deleted, and invalid arguments perform no public I/O', async t => {
  const f = await fixture(t); await mkdir(f.outputDirectory); await writeFile(resolve(f.outputDirectory, 'existing'), 'keep');
  await rejected(f.capture(), 'OUTPUT_EXISTS'); assert.equal(f.calls.length, 0); assert.equal(await readFile(resolve(f.outputDirectory, 'existing'), 'utf8'), 'keep');
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 15001 }, { sourceCommit: PRIVATE }, { outputDirectory: '' }]) await rejected(f.capture(options), 'INVALID_ARGUMENTS');
  assert.equal(f.calls.length, 0);
});

test('CI retains successful read-only captures before later checks without changing the main deployment gates', async () => {
  const workflow = await readFile(new URL('../.github/workflows/check.yml', import.meta.url), 'utf8');
  const check = workflow.slice(workflow.indexOf('\n  check:'), workflow.indexOf('\n  deploy:'));
  const observe = check.indexOf('run: node scripts/verify-public-content.mjs --observe'), capture = check.indexOf('run: node scripts/capture-public-visual-fixture.mjs');
  const upload = check.indexOf('name: public-visual-fixture'), tests = check.indexOf('name: Run tests');
  assert.ok(observe >= 0 && capture > observe && upload > capture && tests > upload);
  const block = check.slice(check.lastIndexOf('      - name:', capture), check.indexOf('      - name: Check source boundaries', capture));
  assert.match(block, /continue-on-error: true/u); assert.match(block, /steps\.public_visual_fixture\.outcome == 'success'/u); assert.match(block, /retention-days: 1\n/u);
  assert.doesNotMatch(block, /secrets\.|env:|Authorization|Cookie|workflow_dispatch/u);
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.match(deploy, /needs: \[check, deploy-fc\]/u);
  assert.match(deploy, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main' && github\.repository == 'kunanli\/artdicohost'/u);
});

test('CLI rejects arbitrary URL or output arguments without printing input or starting capture', () => {
  const script = fileURLToPath(new URL('../scripts/capture-public-visual-fixture.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [script, '--url=https://foreign.invalid/' + PRIVATE], { encoding: 'utf8', env: {} });
  assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.match(child.stderr, /INVALID_ARGUMENTS/u);
  assert.doesNotMatch(child.stderr, /SYNTHETIC_PRIVATE|foreign\.invalid|Error:| at /u);
});
