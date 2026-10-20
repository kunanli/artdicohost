import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createServer as createRawServer } from 'node:net';
import { createHash } from 'node:crypto';
import { uploadFcCode, fcUploadState } from '../scripts/fc-upload-transport.mjs';
import { MAX_FC_REQUEST_BYTES } from '../scripts/fc-upload-limits.mjs';

const ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com/2023-03-30/functions/artdicohost-api';
const body = JSON.stringify({ code: { zipFile: Buffer.from('synthetic ZIP transport bytes').toString('base64') } });
const hash = value => createHash('sha256').update(value).digest('hex');
const options = (extra = {}) => ({ method: 'PUT', body, headers: { 'content-type': 'application/json', host: 'fcv3.cn-hongkong.aliyuncs.com', 'x-acs-content-sha256': hash(body), authorization: 'SYNTHETIC-PRIVATE-AUTHORIZATION' }, ...extra });
const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept; }); return { promise, resolve }; };

async function loopback(t, handler) {
  const calls = [];
  const server = createServer(handler);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  return {
    calls,
    requestFn(url, settings, listener) {
      calls.push({ url, settings });
      assert.equal(url, ENDPOINT, 'test mapping does not broaden the public transport endpoint');
      return httpRequest(`http://127.0.0.1:${server.address().port}/2023-03-30/functions/artdicohost-api`, settings, listener);
    },
  };
}

function opaque(error) {
  assert.equal(error.message, 'FC upload transport failed; no request or credential details are included');
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.doesNotMatch(error.stack, /SYNTHETIC-PRIVATE|PRIVATE-REMOTE|fcv3\.cn-hongkong|zipFile|authorization/iu);
  return true;
}

test('one fixed PUT transmits exact code-only JSON bytes and native Content-Length with truthful copied state', { timeout: 5000 }, async t => {
  const received = deferred();
  let release;
  const fixture = await loopback(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    received.resolve({ method: request.method, path: request.url, headers: request.headers, bytes });
    release = () => { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{"accepted":true}'); };
  });
  const pending = uploadFcCode(ENDPOINT, options({ rejectUnauthorized: false }), fixture);
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: false, responseStarted: false });
  const actual = await received.promise;
  assert.equal(actual.method, 'PUT');
  assert.equal(actual.path, '/2023-03-30/functions/artdicohost-api');
  assert.equal(actual.headers['content-length'], String(Buffer.byteLength(body)));
  assert.equal(actual.headers['transfer-encoding'], undefined);
  assert.equal(actual.bytes.toString('utf8'), body);
  assert.equal(hash(actual.bytes), actual.headers['x-acs-content-sha256']);
  assert.deepEqual(Object.keys(JSON.parse(actual.bytes)), ['code']);
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: true, responseStarted: false });
  const copied = fcUploadState(pending);
  copied.responseStarted = true;
  copied.secret = 'SYNTHETIC-PRIVATE';
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: true, responseStarted: false });
  release();
  const response = await pending;
  assert.ok(response instanceof Response);
  assert.ok(response.body instanceof ReadableStream);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: true, responseStarted: true });
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].settings.rejectUnauthorized, true, 'caller options cannot relax TLS verification');
});

test('a redirect is returned as a response and is never followed', { timeout: 5000 }, async t => {
  let requests = 0;
  const fixture = await loopback(t, (request, response) => {
    requests++;
    request.resume();
    response.writeHead(302, { location: 'https://PRIVATE-REMOTE.invalid/', 'content-type': 'application/json' });
    response.end('{"redirected":true}');
  });
  const pending = uploadFcCode(ENDPOINT, options(), fixture);
  const response = await pending;
  assert.equal(response.status, 302);
  assert.equal(response.redirected, false);
  assert.equal(response.headers.get('location'), 'https://PRIVATE-REMOTE.invalid/');
  await response.text();
  assert.equal(requests, 1);
  assert.equal(fixture.calls.length, 1);
});

test('only this module can create trusted state and unknown promises or hostile objects return null', () => {
  for (const value of [undefined, null, 1, 'PRIVATE-REMOTE', {}, Promise.resolve(), { uploadBodyWritten: true, responseStarted: true }]) assert.equal(fcUploadState(value), null);
  const hostile = {};
  Object.defineProperty(hostile, 'uploadBodyWritten', { get() { assert.fail('untrusted properties must not be inspected'); } });
  assert.equal(fcUploadState(hostile), null);
});

test('endpoint, method, schema and framing failures reject opaquely before opening a connection', async t => {
  const calls = [];
  const dependency = { requestFn(...args) { calls.push(args); throw new Error('SYNTHETIC-PRIVATE request should not start'); } };
  for (const [url, configuration] of [
    [ENDPOINT + '?PRIVATE-REMOTE=1', options()],
    [ENDPOINT.replace('https:', 'http:'), options()],
    [ENDPOINT.replace('cn-hongkong', 'cn-shanghai'), options()],
    [ENDPOINT, options({ method: 'POST' })], [ENDPOINT, options({ body: {} })],
    [ENDPOINT, options({ body: '{"environmentVariables":{"PRIVATE":"value"}}' })],
    [ENDPOINT, options({ body: '{not-json' })],
    [ENDPOINT, options({ headers: { 'content-type': 'application/octet-stream' } })],
    [ENDPOINT, options({ headers: { 'content-type': 'application/json', 'content-length': '1' } })],
    [ENDPOINT, options({ headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } })],
    [ENDPOINT, options({ headers: { 'content-type': 'application/json', host: 'PRIVATE-REMOTE.invalid' } })],
  ]) await assert.rejects(uploadFcCode(url, configuration, dependency), opaque);
  const originalLength = Buffer.byteLength;
  t.mock.method(Buffer, 'byteLength', function(value, ...args) { return value === body ? MAX_FC_REQUEST_BYTES + 1 : originalLength.call(Buffer, value, ...args); });
  await assert.rejects(uploadFcCode(ENDPOINT, options(), dependency), opaque);
  assert.equal(calls.length, 0, 'oversize rejection needs no large allocation or socket');
});

test('cancellation before a request starts opens no connection', async () => {
  const controller = new AbortController();
  controller.abort(new Error('SYNTHETIC-PRIVATE cancellation cause'));
  let requests = 0;
  const pending = uploadFcCode(ENDPOINT, options({ signal: controller.signal }), { requestFn() { requests++; } });
  await assert.rejects(pending, opaque);
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: false, responseStarted: false });
  assert.equal(requests, 0);
});

test('cancellation while waiting for response headers closes the only socket without retrying', { timeout: 5000 }, async t => {
  const received = deferred();
  const closed = deferred();
  const fixture = await loopback(t, async (request) => {
    request.socket.once('close', closed.resolve);
    for await (const _chunk of request) { /* Synthetic body is drained but not acknowledged. */ }
    received.resolve();
  });
  const controller = new AbortController();
  const pending = uploadFcCode(ENDPOINT, options({ signal: controller.signal }), fixture);
  await received.promise;
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: true, responseStarted: false });
  controller.abort(new Error('SYNTHETIC-PRIVATE abort'));
  await assert.rejects(pending, opaque);
  await closed.promise;
  assert.equal(fixture.calls.length, 1);
});

test('cancellation after headers destroys the streamed response and preserves only safe progress', { timeout: 5000 }, async t => {
  const fixture = await loopback(t, (request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"partial":');
  });
  const controller = new AbortController();
  const pending = uploadFcCode(ENDPOINT, options({ signal: controller.signal }), fixture);
  const response = await pending;
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);
  controller.abort(new Error('SYNTHETIC-PRIVATE abort reason'));
  await assert.rejects(reader.read(), opaque);
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: true, responseStarted: true });
  assert.equal(fixture.calls.length, 1);
});

test('network and response-stream failures expose neither their original error nor a cause and never retry', { timeout: 5000 }, async t => {
  let attempts = 0;
  const rejected = uploadFcCode(ENDPOINT, options(), { requestFn() { attempts++; throw new Error('SYNTHETIC-PRIVATE connection error'); } });
  await assert.rejects(rejected, opaque);
  assert.equal(attempts, 1);
  assert.deepEqual(fcUploadState(rejected), { uploadBodyWritten: false, responseStarted: false });

  let incoming;
  const fixture = await loopback(t, (request, response) => {
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"partial":');
  });
  const requestFn = (url, settings, listener) => fixture.requestFn(url, settings, response => { incoming = response; listener(response); });
  const pending = uploadFcCode(ENDPOINT, options(), { requestFn });
  const response = await pending;
  incoming.destroy(new Error('SYNTHETIC-PRIVATE original response-stream error'));
  await assert.rejects(response.text(), opaque);
  assert.equal(fixture.calls.length, 1);
});

test('cancelling a response body closes its connection even without an external signal', { timeout: 5000 }, async t => {
  const closed = deferred();
  const fixture = await loopback(t, (request, response) => {
    request.socket.once('close', closed.resolve);
    request.resume();
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{"partial":');
  });
  const response = await uploadFcCode(ENDPOINT, options(), fixture);
  await response.body.cancel();
  await closed.promise;
  assert.equal(fixture.calls.length, 1);
});

test('an early complete response closes an unfinished large PUT instead of leaving an uncancellable upload', { timeout: 5000 }, async t => {
  const connections = new Set();
  const server = createRawServer(socket => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    socket.once('data', () => {
      // Respond before reading the upload, then stop reading so the large PUT
      // cannot finish merely because this is a fast loopback connection.
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\n{}');
      socket.pause();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    for (const socket of connections) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const largeBody = JSON.stringify({ code: { zipFile: Buffer.alloc(12 * 1024 * 1024, 80).toString('base64') } });
  const closed = deferred();
  let request, unfinishedAtHeaders, attempts = 0;
  const requestFn = (url, settings, listener) => {
    assert.equal(url, ENDPOINT);
    attempts++;
    request = httpRequest(`http://127.0.0.1:${server.address().port}/2023-03-30/functions/artdicohost-api`, settings, response => {
      unfinishedAtHeaders = !request.writableFinished;
      listener(response);
    });
    request.once('close', closed.resolve);
    return request;
  };
  const controller = new AbortController();
  const pending = uploadFcCode(ENDPOINT, options({ body: largeBody, signal: controller.signal }), { requestFn });
  const response = await pending;
  assert.deepEqual(await response.json(), {});
  await closed.promise;
  assert.equal(unfinishedAtHeaders, true, 'the fixture returns a complete response before upload completion');
  assert.equal(request.destroyed, true);
  assert.equal(request.socket.destroyed, true);
  assert.deepEqual(fcUploadState(pending), { uploadBodyWritten: false, responseStarted: true });
  controller.abort(new Error('SYNTHETIC-PRIVATE late abort reason'));
  assert.equal(request.destroyed, true);
  assert.equal(attempts, 1);
});
