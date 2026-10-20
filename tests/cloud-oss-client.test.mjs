import test from 'node:test';
import assert from 'node:assert/strict';
import { createOssObjectClient, OSS_ORIGIN, MAX_OSS_OBJECT_BYTES } from '../functions/cloud-content/oss-client.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { fakeCredentials, fixedClock, objectFixture, objectResponse, xmlError, sha256 } from './cloud-oss-fixture.mjs';

const logKey = 'cms/v1/content/commits.jsonl';
const make = (extra = {}) => createOssObjectClient({ credentials: async () => fakeCredentials, clock: fixedClock, ...extra });
const opaque = error => error instanceof CloudContentError && error.status === 503
  && !/PRIVATE|Example|cms\/v1|password|secret|provider|raw/iu.test(error.message + JSON.stringify(error));

// Generated independently from the official ali-oss@6.23.0 signer, not this module.
// Official source: https://github.com/ali-sdk/ali-oss/blob/35fd762d8b1600aa1ece32ff2b75d284c2631358/lib/common/signUtils.js
// signUtils.js SHA-256: 46699555e13c5411a852e586f6206072a8fd4db7a27e437d48817f49f39819dd
// SDK authorizationV4(ExampleId, ExampleSecretForOnlyFixtures, cn-hongkong,
// method, {headers, queries}, artdicohost-data-hk, key, []), 20261020T000000Z.
test('OSS GET, immutable PUT and first AppendObject match independent official SDK V4 vectors', async () => {
  const fixture = objectFixture(), client = make({ fetchFn: fixture.fetchFn });
  assert.equal(await client.get(logKey), null);
  assert.equal(fixture.calls[0].headers.authorization,
    'OSS4-HMAC-SHA256 Credential=ExampleId/20261020/cn-hongkong/oss/aliyun_v4_request,Signature=1a7a6f78c22000dfa2b9aa70fe4d171b1965b6856c6fa1561e945090cb2e6909');
  const body = Buffer.from('{"demo":true}'), key = `cms/v1/content/blobs/${sha256(body)}.json`;
  await client.putImmutable(key, body, { contentType: 'application/json' });
  assert.equal(fixture.calls.find(call => call.method === 'PUT').headers.authorization,
    'OSS4-HMAC-SHA256 Credential=ExampleId/20261020/cn-hongkong/oss/aliyun_v4_request,Signature=7fe9b7dcbfd657adefc8693519ebedd74f9f93021bf56a0e480871957402fb19');
  const appended = await client.append(logKey, 0, Buffer.from('{"v":1}\n'));
  assert.deepEqual(appended, { nextPosition: 8 });
  assert.equal(fixture.calls.find(call => call.method === 'POST').headers.authorization,
    'OSS4-HMAC-SHA256 Credential=ExampleId/20261020/cn-hongkong/oss/aliyun_v4_request,Signature=652c79d14b62d4a75cee0ebef512f2ac86ed95dd788eb177bfc7200f84af2aca');
  assert.ok(fixture.calls.every(call => call.headers['x-oss-content-sha256'] === 'UNSIGNED-PAYLOAD' && call.headers['x-oss-security-token'] === 'ExampleToken'));
  assert.equal(fixture.calls.find(call => call.method === 'POST').url, OSS_ORIGIN + '/' + logKey + '?append&position=0');
});

test('only a bounded validated NoSuchKey XML response represents absence', async () => {
  for (const response of [xmlError(404, 'NoSuchBucket'), new Response('NoSuchKey', { status: 404 }), new Response('<Error><Message><Code>NoSuchKey</Code></Message></Error>', { status: 404, headers: { 'content-type': 'application/xml' } }), new Response('<!DOCTYPE Error><Error><Code>NoSuchKey</Code></Error>', { status: 404, headers: { 'content-type': 'application/xml' } }), new Response('<Error><Code>NoSuchKey</Code><Code>NoSuchKey</Code></Error>', { status: 404, headers: { 'content-type': 'application/xml' } }), new Response('<Error><Code>NoSuchKey</Code></Error>', { status: 403, headers: { 'content-type': 'application/xml' } })]) {
    await assert.rejects(make({ fetchFn: async () => response }).get(logKey), opaque);
  }
  assert.equal(await make({ fetchFn: async () => xmlError(404, 'NoSuchKey') }).get(logKey), null);
});

test('keys, byte limits, media types and content-addressed names are checked before requesting credentials', async () => {
  let credentials = 0, requests = 0;
  const client = make({ credentials: async () => { credentials++; return fakeCredentials; }, fetchFn: async () => { requests++; throw new Error('PRIVATE'); } });
  for (const key of ['https://evil.invalid/x', '../x', 'cms/v1/../x', 'cms/v1/x%2fy', 'cms/v1/x?acl', 'cms/v1/.x', 'cms/v1/x\\y', 'other-project/data', 'cms/v1/x\n']) await assert.rejects(client.get(key), opaque);
  await assert.rejects(client.get(logKey, { maxBytes: MAX_OSS_OBJECT_BYTES + 1 }), opaque);
  await assert.rejects(client.putImmutable('cms/v1/content/blobs/' + 'a'.repeat(64) + '.json', Buffer.from('different')), opaque);
  await assert.rejects(client.append(logKey, -1, Buffer.from('x')), opaque);
  await assert.rejects(client.append(logKey, 0, Buffer.alloc(0)), opaque);
  await assert.rejects(client.putImmutable(`cms/v1/content/blobs/${sha256('x')}.json`, Buffer.from('x'), { contentType: 'text/html' }), opaque);
  assert.equal(credentials, 0); assert.equal(requests, 0);
});

test('immutable creation verifies bytes, deduplicates same bytes and refuses corrupted or substituted state', async () => {
  const fixture = objectFixture(), client = make({ fetchFn: fixture.fetchFn });
  const data = Buffer.from('{"value":"synthetic"}'), key = `cms/v1/content/blobs/${sha256(data)}.json`;
  assert.deepEqual((await client.putImmutable(key, data)).data, data);
  const puts = fixture.calls.filter(call => call.method === 'PUT').length;
  assert.deepEqual((await client.putImmutable(key, data)).data, data);
  assert.equal(fixture.calls.filter(call => call.method === 'PUT').length, puts);
  fixture.stored.get(key).data = Buffer.from('corrupt');
  await assert.rejects(client.putImmutable(key, data), opaque);
  assert.equal(fixture.calls.filter(call => call.method === 'PUT').length, puts);
  const racing = objectFixture();
  const once = make({ fetchFn: async (url, options) => {
    if (options.method === 'PUT') { racing.stored.set(key, { data, contentType: 'application/json', objectType: 'Normal' }); return xmlError(409, 'FileAlreadyExists'); }
    return racing.fetchFn(url, options);
  } });
  assert.deepEqual((await once.putImmutable(key, data)).data, data);
  let getCount = 0;
  await assert.rejects(make({ fetchFn: async (_url, options) => options.method === 'GET' ? (++getCount === 1 ? xmlError(404, 'NoSuchKey') : objectResponse(Buffer.from('other'))) : new Response(null) }).putImmutable(key, data), opaque);
});

test('only exact append-position conflicts become safe conflict errors; writes are never retried', async () => {
  const fixture = objectFixture(), client = make({ fetchFn: fixture.fetchFn });
  await client.append(logKey, 0, Buffer.from('one\n'));
  await assert.rejects(client.append(logKey, 0, Buffer.from('two\n')), error => error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409 && !error.message.includes(logKey));
  assert.equal(fixture.calls.filter(call => call.method === 'POST').length, 2);
  for (const response of [xmlError(409, 'FileImmutable'), xmlError(500, 'PositionNotEqualToLength'), new Response(null, { headers: { 'x-oss-next-append-position': '999' } }), new Response('PRIVATE', { headers: { 'x-oss-next-append-position': '2' } })]) {
    let calls = 0;
    await assert.rejects(make({ fetchFn: async () => { calls++; return response; } }).append(logKey, 0, Buffer.from('x\n')), opaque);
    assert.equal(calls, 1);
  }
});

test('timeouts bound unresponsive provider, transport and response reads without duplicate mutations', async () => {
  let fetches = 0, cancelled = false;
  const never = () => new Promise(() => {});
  await assert.rejects(make({ credentials: never, fetchFn: async () => { fetches++; return new Response(null); }, requestTimeoutMs: 5 }).get(logKey), opaque);
  assert.equal(fetches, 0);
  await assert.rejects(make({ fetchFn: () => { fetches++; return never(); }, requestTimeoutMs: 5 }).append(logKey, 0, Buffer.from('x')), opaque);
  assert.equal(fetches, 1);
  const stream = new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('x')); }, cancel() { cancelled = true; } });
  await assert.rejects(make({ fetchFn: async () => new Response(stream, { headers: { 'content-type': 'application/json', 'x-oss-object-type': 'Normal' } }), requestTimeoutMs: 5 }).get(logKey), opaque);
  assert.equal(cancelled, true);
});

test('redirected, partial, encoded, over-limit and wrong-shaped objects fail closed and never leak diagnostics', async () => {
  const redirected = objectResponse(Buffer.from('x')); Object.defineProperty(redirected, 'url', { value: 'https://evil.invalid/PRIVATE' });
  const cases = [redirected, new Response('x', { status: 206 }), new Response('x', { headers: { 'content-encoding': 'gzip' } }), new Response('x', { headers: { 'content-length': '99999999' } }), new Response('x', { headers: { 'content-length': '2' } }), objectResponse(Buffer.from('x'), 'application/json', 'Symlink'), objectResponse(Buffer.from('x'), 'text/html'), objectResponse(Buffer.alloc(11))];
  for (const response of cases) await assert.rejects(make({ fetchFn: async () => response }).get(logKey, { maxBytes: 10 }), opaque);
  for (const value of [null, { ...fakeCredentials, securityToken: '' }, { ...fakeCredentials, accessKeySecret: 'PRIVATE\n' }, Object.defineProperty({ ...fakeCredentials }, 'securityToken', { get() { throw new Error('PRIVATE'); } })]) await assert.rejects(make({ credentials: async () => value, fetchFn: async () => { throw new Error('PRIVATE'); } }).get(logKey), opaque);
  await assert.rejects(make({ fetchFn: async () => { const error = new CloudContentError('WRITE_CONFLICT', 'PRIVATE_RAW', 409); error.credentials = 'PRIVATE'; throw error; } }).get(logKey), opaque);
  await assert.rejects(make({ clock: () => new Date(NaN), fetchFn: async () => { throw new Error('PRIVATE'); } }).get(logKey), opaque);
});

test('temporary credential provider is consulted anew for every request and inputs are copied before awaiting it', async () => {
  const fixture = objectFixture(); let serial = 0;
  const client = make({ credentials: async () => ({ ...fakeCredentials, securityToken: 'ExampleToken' + ++serial }), fetchFn: fixture.fetchFn });
  await client.get(logKey); await client.get(logKey);
  assert.equal(serial, 2); assert.notEqual(fixture.calls[0].headers.authorization, fixture.calls[1].headers.authorization);
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const copied = make({ credentials: async () => { await pending; return fakeCredentials; }, fetchFn: fixture.fetchFn });
  const body = Buffer.from('safe\n'), append = copied.append(logKey, 0, body); body.fill(0); release();
  await append;
  assert.equal(fixture.stored.get(logKey).data.toString(), 'safe\n');
});
