import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { once } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { createFcClient, summarizeFcError } from '../scripts/fc-client.mjs';

const credentials = { accessKeyId: 'SYNTHETICKEY', accessKeySecret: 'SYNTHETIC-NOT-REAL' };
const clientOptions = { credentials, clock: () => new Date('2026-10-20T00:00:00Z'), nonce: () => '0123456789abcdef0123456789abcdef' };

async function localTransport(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const calls = [];
  t.mock.method(https, 'request', (url, options, callback) => {
    assert.equal(String(url), 'https://fcv3.cn-hongkong.aliyuncs.com/2023-03-30/functions/artdicohost-api');
    assert.equal(options.method, 'PUT');
    calls.push(options);
    // Only the injected test adapter connects locally. Production keeps HTTPS/TLS.
    return http.request({ hostname: '127.0.0.1', port: server.address().port, path: '/2023-03-30/functions/artdicohost-api', ...options }, callback);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  return calls;
}

test('default client keeps metadata on fetch and sends one exact signed JSON upload over native HTTPS', async t => {
  const bytes = Buffer.alloc(1024 * 1024, 80);
  let received;
  const calls = await localTransport(t, async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = Buffer.concat(chunks);
    assert.equal(request.headers['content-length'], String(received.length));
    assert.equal(request.headers['x-acs-content-sha256'], createHash('sha256').update(received).digest('hex'));
    assert.match(request.headers.authorization, /^ACS3-HMAC-SHA256 /);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{"functionName":"artdicohost-api"}');
  });
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.method, 'GET');
    reads++;
    return new Response('{"functionName":"artdicohost-api"}', { headers: { 'content-type': 'application/json' } });
  });
  const client = createFcClient(clientOptions);
  await client.getFunction();
  assert.deepEqual(await client.updateCode(bytes), { functionName: 'artdicohost-api' });
  assert.equal(reads, 1);
  assert.equal(calls.length, 1);
  assert.equal(received.toString(), JSON.stringify({ code: { zipFile: bytes.toString('base64') } }));
});

test('a native upload timeout reports only trusted write/response progress and never retransmits', async t => {
  let bodyReceived;
  const written = new Promise(resolve => { bodyReceived = resolve; });
  const calls = await localTransport(t, async request => {
    for await (const _chunk of request) { /* Consume synthetic bytes without returning headers. */ }
    bodyReceived();
  });
  const deadline = new AbortController();
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 180_000);
    return deadline.signal;
  });
  t.mock.method(globalThis, 'fetch', () => { assert.fail('Upload must use the native transport'); });
  const pending = createFcClient(clientOptions).updateCode(Buffer.from('SYNTHETIC-ZIP'));
  await written;
  deadline.abort(new Error('PRIVATE-SYNTHETIC-CAUSE'));
  await assert.rejects(pending, error => {
    assert.equal(summarizeFcError(error), 'operation=UpdateFunction phase=timeout uploadBodyWritten=true responseStarted=false');
    assert.doesNotMatch(error.stack, /PRIVATE-|SYNTHETICKEY|SYNTHETIC-NOT-REAL|aliyuncs\.com/);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  assert.equal(calls.length, 1);
});
