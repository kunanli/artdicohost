import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPublicContent, PUBLIC_CONTENT_URL, PUBLIC_CONTENT_ORIGIN } from '../scripts/verify-public-content.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';

const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  'access-control-allow-origin': PUBLIC_CONTENT_ORIGIN, vary: 'Origin' };
const PRIVATE = 'SYNTHETIC-PRIVATE-ERROR';
const snapshot = () => ({ revision: 7, publishedAt: '2026-10-21T15:00:00.000Z', content: toPublicContent(createInitialContent()) });
const json = (data, changes = {}) => new Response(JSON.stringify(data), { headers, ...changes });
const rejects = promise => assert.rejects(promise, error => error.message === 'Anonymous public content verification failed.' && !error.cause && !error.stack.includes(PRIVATE));

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
  for (const changes of [{ redirected: true }, { url: 'https://other.invalid/' }]) await rejects(verifyPublicContent({ fetchFn: async () => Object.assign(json(snapshot()), changes) }));
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
