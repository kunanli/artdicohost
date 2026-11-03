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
function publication(images = [png], portraits = [images[0] ?? png]) {
  const content = createInitialContent(); content.event.title = PUBLIC_NAME;
  content.organizations = images.map((bytes, index) => ({ id: 'synthetic-org-' + index, name: PUBLIC_NAME + index,
    logoId: sha(bytes) + '.png', website: '', participation: 'undecided', status: 'confirmed', publicConsent: false, internalNotes: PRIVATE }));
  content.guests = portraits.map((bytes, index) => ({ id: 'synthetic-public-guest' + (index ? '-' + index : ''), name: PUBLIC_NAME,
    company: '合成机构', portraitId: bytes ? sha(bytes) + '.png' : '',
    ggjRole: '', status: 'confirmed', publicConsent: false, internalNotes: PRIVATE, contactId: '' }));
  return { revision: 43, publishedAt: new Date(AT).toISOString(), content: toPublicContent(content) };
}
async function fixture(t, images = [png], portraits = [images[0] ?? png]) {
  const temporary = await mkdtemp(resolve(tmpdir(), 'artdico-public-visual-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const outputDirectory = resolve(temporary, 'capture'), data = publication(images, portraits), calls = [];
  const raw = Buffer.from(' \n' + JSON.stringify(data, null, 1) + '\n');
  const media = new Map([...images, ...portraits.filter(Boolean)].map(bytes => ['/api/public/portraits/' + sha(bytes) + '.png', bytes]));
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

test('one validated anonymous response supplies exact bytes and deduplicates a shared published logo and portrait', async t => {
  const f = await fixture(t, [png, png]), before = JSON.stringify(f.data), report = await f.capture();
  assert.equal(f.calls.filter(call => call.url === PUBLIC_CONTENT_URL).length, 1);
  assert.equal(f.calls.length, 2, 'one snapshot and one shared image GET; no duplicate portrait or guessed media URL');
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
  assert.deepEqual(report.guestCaptionCoverage, { title: 0, role: 0, company: 0, empty: 1 }, 'company alone does not become a position');
  assert.deepEqual(report.guestAffiliationCoverage, { company: 1, empty: 0 });
  assert.deepEqual(report.guestPortraitCoverage, { total: 1, withPortrait: 1, withoutPortrait: 0, uniqueImages: 1, capturedImages: 1 });
  assert.deepEqual(report.showcaseCoverCoverage, { total: 0, withCoverId: 0, withoutCoverId: 0 });
  assert.equal(Object.hasOwn(manifest, 'guestAffiliationCoverage'), false, 'diagnostic counts do not change the captured fixture format');
  assert.equal(Object.hasOwn(manifest, 'showcaseCoverCoverage'), false);
  assert.equal(JSON.stringify(f.data), before); assert.doesNotMatch(JSON.stringify({ manifest, report }), /SYNTHETIC_PUBLIC_NAME|SYNTHETIC_PRIVATE|contactId|receiptToken|internalNotes/u);
});

test('distinct public guest portraits join the exact logo capture without identity labels, duplicate fetches or invented missing portraits', async t => {
  const logo = Buffer.concat([png, Buffer.from('synthetic-second-logo')]);
  const photo = Buffer.concat([png, Buffer.from('synthetic-distinct-portrait')]);
  const f = await fixture(t, [png, logo], [photo, photo, null, png]);
  const before = JSON.stringify(f.data), report = await f.capture();
  const expected = [png, logo, photo];
  assert.equal(f.calls.length, 4, 'one snapshot plus the three distinct public content-addressed images');
  assert.deepEqual(f.calls.slice(1).map(call => new URL(call.url).pathname), expected.map(bytes => '/api/public/portraits/' + sha(bytes) + '.png'));
  for (const call of f.calls) {
    assert.equal(call.options.credentials, 'omit'); assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.referrerPolicy, 'no-referrer');
    assert.equal(Object.keys(call.options.headers).some(name => /cookie|authorization/iu.test(name)), false);
  }
  const manifest = JSON.parse(await readFile(resolve(f.outputDirectory, 'manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.sourceCommit, COMMIT);
  assert.deepEqual(manifest.media, expected.map(bytes => ({ file: 'media/' + sha(bytes) + '.png',
    path: '/api/public/portraits/' + sha(bytes) + '.png', sha256: sha(bytes), bytes: bytes.length, contentType: 'image/png' })));
  for (const bytes of expected) assert.deepEqual(await readFile(resolve(f.outputDirectory, 'media/' + sha(bytes) + '.png')), bytes);
  assert.deepEqual(await readFile(resolve(f.outputDirectory, 'snapshot.json')), f.raw);
  assert.deepEqual(report.guestPortraitCoverage, { total: 4, withPortrait: 3, withoutPortrait: 1, uniqueImages: 2, capturedImages: 2 });
  assert.equal(report.mediaBytes, expected.reduce((total, bytes) => total + bytes.length, 0));
  assert.equal(Object.hasOwn(manifest, 'guestPortraitCoverage'), false, 'media records remain the compatible shared fixture format');
  assert.equal(JSON.stringify(f.data), before);
  assert.doesNotMatch(JSON.stringify({ manifest, report }), /SYNTHETIC_PUBLIC_NAME|SYNTHETIC_PRIVATE|synthetic-public-guest|portraitId|portraitUrl/u);
});

test('a guest without a published portrait remains valid and causes no guessed portrait request', async t => {
  const f = await fixture(t, [png], [null]), report = await f.capture();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(report.guestPortraitCoverage, { total: 1, withPortrait: 0, withoutPortrait: 1, uniqueImages: 0, capturedImages: 0 });
});

test('foreign, query-bearing, mismatched or private guest portraits are rejected with the snapshot before any media request', async t => {
  for (const mutate of [
    guest => { guest.portraitUrl = 'https://foreign.invalid/' + PRIVATE; },
    guest => { guest.portraitUrl += '?secret=' + PRIVATE; },
    guest => { guest.portraitUrl = '/api/public/portraits/../' + PRIVATE; },
    guest => { guest.portraitId = 'd'.repeat(64) + '.png'; },
    guest => { guest.visibility = 'private'; },
  ]) {
    const f = await fixture(t); let requests = 0;
    await rejected(f.capture({ fetchFn: async url => {
      requests++; assert.equal(url, PUBLIC_CONTENT_URL); mutate(f.data.content.guests[0]);
      return new Response(JSON.stringify(f.data), { headers: publicHeaders });
    } }));
    assert.equal(requests, 1); await absent(f.outputDirectory);
  }
});

test('a missing or invalid distinct portrait fails the whole capture and removes already captured logo bytes', async t => {
  const photo = Buffer.concat([png, Buffer.from('synthetic-distinct-portrait')]);
  for (const change of [
    () => new Response(PRIVATE, { status: 404, headers: { 'content-type': 'image/png' } }),
    response => { response.headers.set('content-type', 'image/jpeg'); return response; },
    response => { response.headers.set('set-cookie', PRIVATE); return response; },
    response => { Object.defineProperty(response, 'redirected', { value: true }); return response; },
    response => { Object.defineProperty(response, 'url', { value: 'https://foreign.invalid/' + PRIVATE }); return response; },
    () => new Response(Buffer.alloc(photo.length), { headers: { 'content-type': 'image/png' } }),
  ]) {
    const f = await fixture(t, [png], [photo]);
    await rejected(f.capture({ fetchFn: async (...args) => {
      const response = await f.fetchFn(...args);
      return args[0].endsWith('/' + sha(photo) + '.png') ? change(response) : response;
    } }));
    assert.equal(f.calls.length, 3); await absent(f.outputDirectory);
  }
});

test('portrait and logo media share the unchanged thirty-image and eight-MiB limits', async t => {
  const logos = Array.from({ length: 15 }, (_, index) => Buffer.concat([png, Buffer.from('synthetic-logo-' + index)]));
  const photos = Array.from({ length: 16 }, (_, index) => Buffer.concat([png, Buffer.from('synthetic-photo-' + index)]));
  const many = await fixture(t, logos, photos);
  await rejected(many.capture(), 'MEDIA_LIMIT'); assert.equal(many.calls.length, 1); await absent(many.outputDirectory);
  const maximumLogos = Array.from({ length: 4 }, (_, index) => { const bytes = Buffer.alloc(2 * 1024 * 1024, index); png.copy(bytes); return bytes; });
  const total = await fixture(t, maximumLogos, [png]);
  await rejected(total.capture(), 'MEDIA_BODY'); assert.equal(total.calls.length, 6); await absent(total.outputDirectory);
  const largePhoto = Buffer.alloc(2 * 1024 * 1024 + 1); png.copy(largePhoto);
  const individual = await fixture(t, [png], [largePhoto]);
  await rejected(individual.capture(), 'MEDIA_BODY'); assert.equal(individual.calls.length, 3); await absent(individual.outputDirectory);
});

test('unpublished, private, malformed or foreign-logo snapshots never start a media request and leave no output', async t => {
  for (const mutate of [null, data => { data.content.internalNotes = PRIVATE; }, data => { data.content.organizations[0].logoUrl = 'https://foreign.invalid/' + PRIVATE; },
    data => { data.content.organizations[0].logoUrl += '?secret=' + PRIVATE; }, data => { data.content.organizations[0].logoUrl = '/api/public/portraits/../' + PRIVATE; },
    data => { data.content.organizations[0].id = '../' + PRIVATE; }]) {
    const f = await fixture(t); let requests = 0;
    await rejected(f.capture({ fetchFn: async url => {
      requests++; assert.equal(url, PUBLIC_CONTENT_URL);
      if (mutate === null) return new Response(JSON.stringify({ error: { code: 'NOT_PUBLISHED', message: PRIVATE } }), { status: 404, headers: publicHeaders });
      mutate(f.data); return new Response(JSON.stringify(f.data), { headers: publicHeaders });
    } }), mutate === null ? 'NOT_PUBLISHED' : undefined);
    assert.equal(requests, 1); await absent(f.outputDirectory);
  }
});

test('safe capture summary exposes only validated public organization IDs, reference keys, logo hashes and independent position and affiliation counts', async t => {
  const images = Array.from({ length: 8 }, (_, index) => Buffer.concat([png, Buffer.from('synthetic-variant-' + index)]));
  const f = await fixture(t, images);
  const identities = [['g4c-hk', PUBLIC_NAME], ['pengyou-gangwan', PUBLIC_NAME], ['game-singularity', PUBLIC_NAME], ['igda-shenzhen', PUBLIC_NAME],
    ['synthetic-bu', 'Bournemouth University'], ['synthetic-teesside', '英国提赛德大学'], ['synthetic-szdx', '深圳大学艺术学部'], ['synthetic-unknown', PUBLIC_NAME]];
  f.data.content.organizations.forEach((card, index) => { [card.id, card.name] = identities[index]; });
  const original = f.data.content.guests[0];
  f.data.content.guests = [
    { ...original, id: 'synthetic-title', title: PUBLIC_NAME, ggjRole: PUBLIC_NAME },
    { ...original, id: 'synthetic-role', title: ' ', ggjRole: PUBLIC_NAME },
    { ...original, id: 'synthetic-company', title: '', ggjRole: '', company: PUBLIC_NAME },
    { ...original, id: 'synthetic-empty', status: 'pending', title: '', ggjRole: '', company: '' },
  ];
  f.data.content.showcases = [sha(png) + '.png', 'b'.repeat(64) + '.png', ''].map((coverId, index) => ({
    id: 'synthetic-work-' + index, title: PUBLIC_NAME, teamName: PUBLIC_NAME, summary: PUBLIC_NAME, coverId,
    kind: 'indie', status: 'pending', responseStatus: 'pending', publicConsent: false, memberCount: 1,
  }));
  f.data.content = toPublicContent(f.data.content);
  const before = JSON.stringify(f.data), report = await f.capture({ fetchFn: async (...args) => args[0] === PUBLIC_CONTENT_URL
    ? new Response(JSON.stringify(f.data), { headers: publicHeaders }) : f.fetchFn(...args) });
  assert.deepEqual(report.referenceLogoSources, ['g4c', 'pengyou', 'gamezone', 'igda', 'bu', 'teesside', 'szdx', null].map((key, index) => ({ organizationId: identities[index][0], key, sha256: sha(images[index]) })));
  assert.deepEqual(report.referenceLogoSources.map(row => row.organizationId), f.data.content.organizations.map(row => row.id), 'public source order is preserved even when the visual reference key is unknown');
  assert.ok(report.referenceLogoSources.every(row => Object.keys(row).sort().join(',') === 'key,organizationId,sha256'));
  assert.deepEqual(report.guestCaptionCoverage, { title: 1, role: 1, company: 0, empty: 2 });
  assert.deepEqual(report.guestAffiliationCoverage, { company: 3, empty: 1 }, 'title and role records also count their independent company field');
  assert.deepEqual(report.showcaseCoverCoverage, { total: 3, withCoverId: 2, withoutCoverId: 1 }, 'public cover references are counted without treating them as captured images');
  assert.equal(report.media, 8, 'unknown public logos are captured safely without guessing their reference identity');
  assert.equal(f.calls.length, 8, 'only logo fetches use the fixture transport; the validated snapshot request remains the single explicit override');
  assert.doesNotMatch(JSON.stringify(report), /SYNTHETIC_PUBLIC_NAME|synthetic-title|synthetic-work-|Bournemouth|深圳大学|提赛德|ggjRole|content|base64/u);
  assert.equal(JSON.stringify(f.data), before);
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
