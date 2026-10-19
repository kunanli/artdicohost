import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { spawnSync } from 'node:child_process';
import { createFcServer, parseFcPort, startFcServer, sourceCommitFromRelease } from '../functions/fc-api/server.mjs';
import { handleFcRequest } from '../functions/fc-api/handler.mjs';

async function loopback(t, options) {
  const server = createFcServer(options);
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  t.after(() => new Promise((accept, reject) => { server.close(error => error ? reject(error) : accept()); server.closeAllConnections(); }));
  return { server, port: server.address().port, origin: `http://127.0.0.1:${server.address().port}` };
}
function safeHeaders(response) {
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('connection'), 'close');
}
function rawRequest(port, text) {
  return new Promise((accept, reject) => {
    let result = '';
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(text));
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error('Preflight response did not close promptly')));
    socket.on('data', chunk => { result += chunk; });
    socket.on('error', reject);
    socket.on('end', () => accept(result));
  });
}

test('actual loopback liveness is process-only; HEAD has the same headers and no body', async t => {
  const { origin } = await loopback(t);
  const get = await fetch(origin + '/healthz');
  assert.equal(get.status, 200);
  safeHeaders(get);
  assert.deepEqual(await get.json(), { status: 'ok', scope: 'process-only', sourceCommit: null });
  const head = await fetch(origin + '/healthz', { method: 'HEAD' });
  assert.equal(head.status, 200);
  safeHeaders(head);
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('content-length'), get.headers.get('content-length'));
});

test('readiness, registration and administrator routes remain unavailable without collecting a body', async t => {
  const { origin } = await loopback(t);
  for (const [path, method] of [['/api/health', 'GET'], ['/api/health', 'HEAD'], ['/api/registrations', 'POST'], ['/api/registrations', 'GET'], ['/api/registrations', 'OPTIONS'], ['/api/registrations/example', 'DELETE'], ['/admin/', 'GET'], ['/admin/contacts/', 'POST'], ['/api/admin/login', 'POST']]) {
    const response = await fetch(origin + path, { method, headers: { authorization: 'Bearer PRIVATE-SYNTHETIC-CREDENTIAL', 'x-private-marker': 'PRIVATE-SYNTHETIC-HEADER', 'content-type': 'application/json' },
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) ? { body: '{"name":"PRIVATE-SYNTHETIC-BODY"}' } : {}) });
    assert.equal(response.status, 503, `${method} ${path}`);
    safeHeaders(response);
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.deepEqual(await response.json(), { status: 'not_ready', registration: 'closed', storage: 'not_verified' });
  }
});

test('unknown paths and unsupported health methods return fixed private errors', async t => {
  const { origin } = await loopback(t);
  const unknown = await fetch(origin + '/PRIVATE-SYNTHETIC-PATH?credential=PRIVATE-SYNTHETIC-QUERY');
  assert.equal(unknown.status, 404);
  safeHeaders(unknown);
  const unknownText = await unknown.text();
  assert.deepEqual(JSON.parse(unknownText), { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
  assert.equal(unknownText.includes('PRIVATE-'), false);
  for (const path of ['/healthz', '/api/health']) {
    const wrong = await fetch(origin + path, { method: 'POST', body: 'PRIVATE-SYNTHETIC-BODY' });
    assert.equal(wrong.status, 405);
    assert.equal(wrong.headers.get('allow'), 'GET, HEAD');
    safeHeaders(wrong);
    assert.deepEqual(await wrong.json(), { error: { code: 'METHOD_NOT_ALLOWED', message: '此接口只接受 GET 或 HEAD。' } });
  }
});

test('unfinished request streams are rejected and closed promptly; malformed requests do not kill the server', async t => {
  const { origin, port } = await loopback(t);
  const incomplete = await rawRequest(port, 'POST /api/registrations HTTP/1.1\r\nHost: localhost\r\nTransfer-Encoding: chunked\r\nX-Private: PRIVATE-SYNTHETIC-HEADER\r\n\r\n5\r\nhello\r\n');
  assert.match(incomplete, /^HTTP\/1\.1 503 /u);
  assert.match(incomplete, /connection: close/iu);
  assert.equal(incomplete.includes('PRIVATE-'), false);
  const malformed = await rawRequest(port, 'GET /healthz HTTP/1.1\r\nHost: localhost\r\nPRIVATE-SYNTHETIC-INVALID-HEADER\r\n\r\n');
  assert.match(malformed, /^HTTP\/1\.1 400 /u);
  assert.match(malformed, /Cache-Control: no-store/iu);
  assert.match(malformed, /X-Content-Type-Options: nosniff/iu);
  assert.equal(malformed.includes('PRIVATE-'), false);
  assert.equal((await fetch(origin + '/healthz')).status, 200);
});

test('oversized headers receive a bounded safe parser error and preserve process liveness', async t => {
  const { origin, port } = await loopback(t);
  const oversized = await rawRequest(port, 'GET /healthz HTTP/1.1\r\nHost: localhost\r\nX-Private: PRIVATE-SYNTHETIC-' + 'x'.repeat(9000) + '\r\n\r\n');
  assert.match(oversized, /^HTTP\/1\.1 431 /u);
  assert.match(oversized, /Cache-Control: no-store/iu);
  assert.match(oversized, /X-Content-Type-Options: nosniff/iu);
  assert.equal(oversized.includes('PRIVATE-'), false);
  assert.ok(oversized.length < 512);
  assert.equal((await fetch(origin + '/healthz')).status, 200);
});

test('FC port parsing has an explicit default and rejects ambiguous or invalid overrides', async () => {
  assert.equal(parseFcPort(), 9000);
  assert.equal(parseFcPort('19000'), 19000);
  assert.equal(parseFcPort(65535), 65535);
  for (const value of [0, -1, 65536, 1.5, NaN, Infinity, null, true, '', '09000', '9000.0', '9e3', ' 9000 ', 'PRIVATE-SYNTHETIC-PORT']) {
    assert.throws(() => parseFcPort(value), /端口无效/u);
    await assert.rejects(startFcServer({ env: { ARTDICO_FC_PORT: value } }), /端口无效/u);
  }
});

test('release identity exposes only an exact preflight commit and never manifest details', async t => {
  const release = { schemaVersion: 1, kind: 'fc-preflight', sourceCommit: 'a'.repeat(40), node: { version: 'synthetic', private: 'PRIVATE-SYNTHETIC-NODE' }, files: [{ path: 'PRIVATE-SYNTHETIC-PATH' }] };
  assert.equal(sourceCommitFromRelease(release), release.sourceCommit);
  for (const invalid of [null, [], {}, { ...release, schemaVersion: 2 }, { ...release, kind: 'public-site' }, { ...release, sourceCommit: 'main' }, { ...release, sourceCommit: 'PRIVATE-SYNTHETIC-COMMIT' }]) assert.equal(sourceCommitFromRelease(invalid), null);
  const { origin } = await loopback(t, { sourceCommit: sourceCommitFromRelease(release) });
  const body = await (await fetch(origin + '/healthz')).json();
  assert.deepEqual(body, { status: 'ok', scope: 'process-only', sourceCommit: release.sourceCommit });
  assert.equal(JSON.stringify(body).includes('PRIVATE-'), false);
});

test('importing the preflight server never listens, and direct-handler failures never echo input', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../functions/fc-api/server.mjs', import.meta.url).href)}); process.stdout.write('import-only');`], { timeout: 2000, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'import-only');
  const server = createFcServer();
  assert.equal(server.listening, false);
  const failed = handleFcRequest({ method: 'GET', url: 'PRIVATE-SYNTHETIC-INVALID-URL' });
  assert.equal(failed.status, 500);
  return failed.text().then(body => {
    assert.equal(body.includes('PRIVATE-'), false);
    assert.deepEqual(JSON.parse(body), { error: { code: 'INTERNAL_ERROR', message: '请求未完成。' } });
  });
});
