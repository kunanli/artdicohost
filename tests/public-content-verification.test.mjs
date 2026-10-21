import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { verifyPublicContent, observePublicContent, PUBLIC_CONTENT_URL, PUBLIC_CONTENT_ORIGIN } from '../scripts/verify-public-content.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': PUBLIC_CONTENT_ORIGIN, vary: 'Origin' };
const PRIVATE = 'SYNTHETIC-PRIVATE-ERROR';
const snapshot = () => ({ revision: 7, publishedAt: '2026-10-21T15:00:00.000Z', content: toPublicContent(createInitialContent()) });
const json = (data, changes = {}) => new Response(JSON.stringify(data), { headers, ...changes });
const rejects = promise => assert.rejects(promise, error => error.message === 'Anonymous public content verification failed.' && !error.cause && !error.stack.includes(PRIVATE));
const historicalSnapshot = () => {
  const content = createInitialContent(), imageId = '1'.repeat(64) + '.png';
  content.guests = [{ id: 'historical-guest', name: 'SYNTHETIC-NAME-NEVER-REPORT', company: '合成历史机构', ggjRole: '', portraitId: imageId, status: 'confirmed', publicConsent: true, internalNotes: PRIVATE }];
  content.organizations = [{ id: 'historical-organization', name: '合成历史组织', logoId: '', website: '', participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: PRIVATE }];
  content.booths = [{ id: 'historical-booth', code: 'C-01', organization: '合成历史展位', project: '合成历史项目', zone: 'C', status: 'confirmed', contactName: PRIVATE, contactMethods: PRIVATE, internalNotes: PRIVATE }];
  content.showcases = [{ id: 'historical-work', title: '合成历史作品', teamName: '合成历史团队', school: PRIVATE, contactName: PRIVATE, email: 'synthetic@example.invalid', wechat: PRIVATE, memberCount: 3, participationForms: ['booth'], responseStatus: 'attending', materialLinks: 'https://example.invalid/' + PRIVATE, summary: '合成简介', coverId: imageId, status: 'confirmed', publicConsent: true, sessionId: '', boothId: 'historical-booth', internalNotes: PRIVATE }];
  return { revision: 9, publishedAt: '2026-10-20T15:00:00.000Z', content: toPublicContent(content) };
};

test('nonempty historical public snapshots retain optional-field absence and verify without exposing names', async () => {
  const data = historicalSnapshot();
  assert.equal(Object.hasOwn(data.content.showcases[0], 'kind'), false);
  assert.equal(Object.hasOwn(data.content.showcases[0], 'organizationId'), false);
  assert.equal(Object.hasOwn(data.content.guests[0], 'publicRoles'), false);
  assert.equal(JSON.stringify(data).includes(PRIVATE), false);
  const expected = { verified: true, cors: true, publication: 'published', revision: 9, publishedAt: data.publishedAt,
    counts: { guests: 1, organizations: 1, showcases: 1, booths: 1, sessions: data.content.sessions.length } };
  assert.deepEqual(await verifyPublicContent({ fetchFn: async () => json(data) }), expected);
  const legacy = structuredClone(data); delete legacy.content.organizations;
  assert.deepEqual(await verifyPublicContent({ fetchFn: async () => json(legacy) }), { ...expected, counts: { ...expected.counts, organizations: 0 } });
  assert.equal(JSON.stringify(expected).includes(data.content.guests[0].name), false);
});

test('actual anonymous CORS verification requests one fixed URL and returns only counts and publication metadata', async () => {
  const data = snapshot(), calls = [];
  const result = await verifyPublicContent({ fetchFn: async (...args) => { calls.push(args); return json(data); } });
  assert.equal(calls.length, 1);
  const [url, options] = calls[0];
  assert.equal(url, PUBLIC_CONTENT_URL);
  assert.deepEqual(Object.keys(options).sort(), ['method', 'redirect', 'credentials', 'cache', 'referrer', 'referrerPolicy', 'headers', 'signal'].sort());
  assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
  assert.equal(options.cache, 'no-store'); assert.equal(options.referrer, ''); assert.equal(options.referrerPolicy, 'no-referrer');
  assert.deepEqual(options.headers, { accept: 'application/json', origin: PUBLIC_CONTENT_ORIGIN, 'accept-encoding': 'identity' });
  assert.equal(options.signal.aborted, true);
  assert.deepEqual(result, { verified: true, cors: true, publication: 'published', revision: 7, publishedAt: data.publishedAt,
    counts: Object.fromEntries(['guests', 'organizations', 'showcases', 'booths', 'sessions'].map(name => [name, data.content[name]?.length ?? 0])) });
  assert.equal(JSON.stringify(result).includes(data.content.event.title), false);
});

test('404 NOT_PUBLISHED is explicitly no publication, not synchronized data or a readiness failure', async () => {
  assert.deepEqual(await verifyPublicContent({ fetchFn: async () => json({ error: { code: 'NOT_PUBLISHED', message: PRIVATE } }, { status: 404 }) }),
    { verified: true, cors: true, publication: 'none' });
  for (const code of ['NOT_FOUND', 'CONTENT_NOT_READY', 'SERVICE_UNAVAILABLE']) await rejects(verifyPublicContent({ fetchFn: async () => json({ error: { code, message: PRIVATE } }, { status: 404 }) }));
});

test('CORS, credentials, caching, redirects and transport errors cannot claim public verification', async () => {
  for (const changed of [
    { 'access-control-allow-origin': '*' }, { 'access-control-allow-origin': 'https://other.invalid' },
    { vary: 'Accept' }, { 'access-control-allow-credentials': 'true' }, { 'set-cookie': PRIVATE },
    { 'cache-control': 'public' }, { 'content-type': 'text/html' }, { 'content-encoding': 'gzip' },
    { 'content-length': '1048577' }, { 'content-length': '3' }, { 'content-length': '-1' },
  ]) await rejects(verifyPublicContent({ fetchFn: async () => json(snapshot(), { headers: { ...headers, ...changed } }) }));
  for (const status of [201, 301, 403, 500, 503]) await rejects(verifyPublicContent({ fetchFn: async () => json({ message: PRIVATE }, { status }) }));
  for (const [key, value] of [['redirected', true], ['url', 'https://other.invalid/']]) {
    const response = json(snapshot());
    Object.defineProperty(response, key, { value });
    assert.equal(response[key], value, 'fixture overrides the returned Response metadata');
    await rejects(verifyPublicContent({ fetchFn: async () => response }));
  }
  await rejects(verifyPublicContent({ fetchFn: async () => { throw new Error(PRIVATE); } }));
});

test('private fields, malformed projections, wrong event or invalid publication metadata are rejected without raw diagnostics', async () => {
  const mutations = [
    value => { value.content.guests.push({ id: 'private', internalNotes: PRIVATE }); },
    value => { value.content.internalNotes = PRIVATE; },
    value => { value.content.booths[0] && (value.content.booths[0].contactMethods = PRIVATE); value.content.event.private = PRIVATE; },
    value => { value.content.eventId = 'other-event'; },
    value => { value.revision = -1; }, value => { value.revision = '7'; }, value => { delete value.revision; },
    value => { value.publishedAt = 'not-a-date'; }, value => { value.publishedAt = '2026-02-31T15:00:00.000Z'; },
    value => { value.publishedAt = '2026-10-21T15:00:00+00:00'; }, value => { value.private = PRIVATE; },
  ];
  for (const mutate of mutations) { const value = snapshot(); mutate(value); await rejects(verifyPublicContent({ fetchFn: async () => json(value) })); }
  await rejects(verifyPublicContent({ fetchFn: async () => new Response(PRIVATE, { headers }) }));
  await rejects(verifyPublicContent({ fetchFn: async () => new Response(new Uint8Array([255]), { headers }) }));
});

test('bounded body and one deadline cover both unresolved requests and stalled streaming responses', async () => {
  let cancelled = false;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
  await rejects(verifyPublicContent({ fetchFn: async () => new Response(body, { headers }) }));
  assert.equal(cancelled, true);
  let active;
  await rejects(verifyPublicContent({ timeoutMs: 10, fetchFn: async (_url, options) => { active = options.signal; return new Promise(() => {}); } }));
  assert.equal(active.aborted, true);
  let streamCancelled = false;
  await rejects(verifyPublicContent({ timeoutMs: 10, fetchFn: async () => new Response(new ReadableStream({ cancel() { streamCancelled = true; } }), { headers }) }));
  assert.equal(streamCancelled, true);
  for (const timeoutMs of [0, 15001, NaN, '10']) await rejects(verifyPublicContent({ timeoutMs, fetchFn: async () => { assert.fail('invalid settings must not fetch'); } }));
});

test('observation identifies fixed header and transport categories without copying response diagnostics', async () => {
  const mutations = [
    ['CONTENT_TYPE', { 'content-type': PRIVATE }], ['CACHE_CONTROL', { 'cache-control': PRIVATE }],
    ['CONTENT_ENCODING', { 'content-encoding': PRIVATE }], ['CORS_ORIGIN', { 'access-control-allow-origin': PRIVATE }],
    ['VARY_ORIGIN', { vary: PRIVATE }], ['CREDENTIALS', { 'access-control-allow-credentials': PRIVATE }],
    ['SET_COOKIE', { 'set-cookie': PRIVATE }], ['CONTENT_LENGTH', { 'content-length': PRIVATE }], ['CONTENT_LENGTH', { 'content-length': '1' }],
  ];
  for (const [failure, changed] of mutations) {
    const result = await observePublicContent({ fetchFn: async () => json(historicalSnapshot(), { headers: { ...headers, ...changed } }) });
    assert.deepEqual(result, { verified: false, failure, status: 200 }); assert.equal(JSON.stringify(result).includes(PRIVATE), false);
  }
  for (const [failure, key, value] of [['REDIRECT', 'redirected', true], ['RESPONSE_URL', 'url', 'https://example.invalid/' + PRIVATE]]) {
    const response = json(snapshot()); Object.defineProperty(response, key, { value });
    assert.deepEqual(await observePublicContent({ fetchFn: async () => response }), { verified: false, failure, status: 200 });
  }
  assert.deepEqual(await observePublicContent({ fetchFn: async () => json({ message: PRIVATE }, { status: 503 }) }), { verified: false, failure: 'HTTP_STATUS', status: 503 });
  for (const thrown of [new Error(PRIVATE, { cause: PRIVATE }), { code: 'SET_COOKIE', status: 503, message: PRIVATE }, Object.defineProperties({}, {
    code: { get() { assert.fail('foreign error code must not be inspected'); } }, status: { get() { assert.fail('foreign error status must not be inspected'); } }, message: { get() { assert.fail('foreign error message must not be inspected'); } },
  })]) assert.deepEqual(await observePublicContent({ fetchFn: async () => { throw thrown; } }), { verified: false, failure: 'TRANSPORT_ERROR' });
  const response = json(snapshot()); Object.defineProperty(response, 'headers', { get() { throw { code: 'SET_COOKIE', status: PRIVATE, message: PRIVATE }; } });
  assert.deepEqual(await observePublicContent({ fetchFn: async () => response }), { verified: false, failure: 'INVALID_RESPONSE', status: 200 });
  assert.deepEqual(await observePublicContent({ get fetchFn() { throw new Error(PRIVATE); } }), { verified: false, failure: 'INVALID_RESPONSE' });
  for (const status of [0, 99, 600, NaN, '503', PRIVATE]) {
    const response = json(snapshot()); Object.defineProperty(response, 'status', { value: status });
    assert.deepEqual(await observePublicContent({ fetchFn: async () => response }), { verified: false, failure: 'HTTP_STATUS' });
  }
});

test('observation identifies body, JSON, envelope, event and projection failures while retaining strict rejection', async () => {
  const cases = [
    ['BODY_UNAVAILABLE', () => new Response(null, { headers })],
    ['BODY_READ_ERROR', () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(PRIVATE)); } }), { headers })],
    ['BODY_CHUNK', () => new Response(new ReadableStream({ start(controller) { controller.enqueue(PRIVATE); controller.close(); } }), { headers })],
    ['BODY_TOO_LARGE', () => new Response(new Uint8Array(1024 * 1024 + 1), { headers })],
    ['BODY_ENCODING', () => new Response(new Uint8Array([255]), { headers })],
    ['INVALID_JSON', () => new Response(PRIVATE, { headers })],
    ['INVALID_ENVELOPE', () => json({ ...snapshot(), private: PRIVATE })],
    ['EVENT_MISMATCH', () => { const value = snapshot(); value.content.eventId = PRIVATE; return json(value); }],
    ['INVALID_PROJECTION', () => { const value = historicalSnapshot(); value.content.booths[0].contactMethods = PRIVATE; return json(value); }],
    ['INVALID_PROJECTION', () => { const value = historicalSnapshot(); value.content.guests[0].internalNotes = PRIVATE; return json(value); }],
    ['INVALID_PROJECTION', () => { const value = historicalSnapshot(); value.content.showcases[0].materialLinks = PRIVATE; return json(value); }],
  ];
  for (const [failure, make] of cases) {
    assert.deepEqual(await observePublicContent({ fetchFn: async () => make() }), { verified: false, failure, status: 200 });
    await assert.rejects(verifyPublicContent({ fetchFn: async () => make() }), error => error.message === 'Anonymous public content verification failed.' && error.code === failure && error.status === 200 && !error.cause && !error.stack.includes(PRIVATE));
  }
  assert.deepEqual(await observePublicContent({ fetchFn: async () => json({ error: { code: PRIVATE, message: PRIVATE } }, { status: 404 }) }), { verified: false, failure: 'INVALID_ENVELOPE', status: 404 });
  assert.deepEqual(await observePublicContent({ fetchFn: async () => json({ error: { code: 'NOT_PUBLISHED', message: PRIVATE } }, { status: 404 }) }), { verified: true, cors: true, publication: 'none' });
  assert.deepEqual(await observePublicContent({ fetchFn: null }), { verified: false, failure: 'INVALID_ARGUMENTS' });
});

test('observation retains one deadline and cancels stalled bodies and late responses that ignore abort', async () => {
  let late, cancelled = false, calls = 0;
  const result = await observePublicContent({ timeoutMs: 10, fetchFn: async () => { calls++; return new Promise(resolve => { late = resolve; }); } });
  assert.deepEqual(result, { verified: false, failure: 'TIMEOUT' }); assert.equal(calls, 1);
  late(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers }));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
  let streamCancelled = false;
  assert.deepEqual(await observePublicContent({ timeoutMs: 10, fetchFn: async () => new Response(new ReadableStream({ cancel() { streamCancelled = true; } }), { headers }) }), { verified: false, failure: 'TIMEOUT', status: 200 });
  assert.equal(streamCancelled, true);
});

test('CLI defaults to strict failure; only exact --observe is nonblocking and invalid arguments never fetch', () => {
  const script = fileURLToPath(new URL('../scripts/verify-public-content.mjs', import.meta.url));
  const preload = code => 'data:text/javascript,' + encodeURIComponent(code);
  const execute = (args, code) => spawnSync(process.execPath, ['--import', preload(code), script, ...args], { encoding: 'utf8', timeout: 5000 });
  const unavailable = 'globalThis.fetch=async()=>new Response(JSON.stringify({message:' + JSON.stringify(PRIVATE) + '}),{status:503});';
  const strict = execute([], unavailable); assert.equal(strict.status, 1); assert.equal(strict.stdout, '');
  assert.equal(strict.stderr.trim(), 'Anonymous public content verification failed. ' + JSON.stringify({ verified: false, failure: 'HTTP_STATUS', status: 503 }));
  const observed = execute(['--observe'], unavailable); assert.equal(observed.status, 0); assert.equal(observed.stderr, '');
  assert.equal(observed.stdout.trim(), 'Anonymous public content observation: ' + JSON.stringify({ verified: false, failure: 'HTTP_STATUS', status: 503 }));
  for (const args of [['--observe', '--observe'], ['--observe=true'], ['--observe', PUBLIC_CONTENT_URL], ['--unknown'], [PUBLIC_CONTENT_URL], ['--observe', '--unknown']]) {
    const child = execute(args, 'globalThis.fetch=async()=>{process.stderr.write(' + JSON.stringify(PRIVATE) + ');throw new Error(' + JSON.stringify(PRIVATE) + ');};');
    assert.equal(child.status, 1); assert.equal(child.stdout, ''); assert.equal(child.stderr.trim(), 'Anonymous public content verification failed. ' + JSON.stringify({ verified: false, failure: 'INVALID_ARGUMENTS' }));
  }
  for (const result of [strict, observed]) assert.equal((result.stdout + result.stderr).includes(PRIVATE), false);
});
