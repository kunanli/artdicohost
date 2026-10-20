import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createCloudContentServer } from '../functions/cloud-content/http-server.mjs';
import { createCloudContentApi, MAX_CLOUD_BODY_BYTES } from '../functions/cloud-content/handler.mjs';

const HOST = 'api.artdico.host';
const SOURCE = 'b'.repeat(40);
const INLINE = 'globalThis.__syntheticStaff = true;\r\n';
const HTML = '<!doctype html><html><head><script>' + INLINE + '</script><script src="/_astro/staff-test.js"></script></head><body>合成后台页面</body></html>';
const ASSETS = () => new Map([
  ['/admin/', Buffer.from(HTML)],
  ['/admin/contacts/', Buffer.from('<!doctype html><html><body>合成名单页面</body></html>')],
  ['/invitations/template-blank.png', Buffer.from('synthetic-png-template')],
  ['/_astro/staff-test.js', Buffer.from('export const syntheticStaff = true;')],
  ['/_astro/staff-test.css', Buffer.from('body { color: #222; }')],
]);
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(JSON.stringify(value))), ...headers } });

async function loopback(t, { runtime = { configured: true, handle: async () => json({ error: { code: 'NOT_FOUND' } }, 404) }, assets = ASSETS(), sourceCommit = SOURCE } = {}) {
  const server = createCloudContentServer({ runtime, assets, sourceCommit });
  assert.equal(server.listening, false);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return { server, port: server.address().port };
}

function send(port, path, { method = 'GET', headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port, method, path,
      headers: { host: HOST, connection: 'close', ...headers }, agent: false }, incoming => {
      const parts = [];
      incoming.on('data', part => parts.push(part));
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, body: Buffer.concat(parts), text: Buffer.concat(parts).toString('utf8') }));
    });
    outgoing.setTimeout(3000, () => outgoing.destroy(new Error('Synthetic loopback HTTP request timed out')));
    outgoing.on('error', reject);
    if (chunks) for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end(body);
  });
}

function raw(port, payload) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port }, () => socket.write(payload));
    const parts = [];
    socket.setTimeout(3000, () => socket.destroy(new Error('Synthetic loopback parser request timed out')));
    socket.on('data', part => parts.push(part));
    socket.on('error', reject);
    socket.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

function secure(response) {
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.equal(response.headers['connection'], 'close');
}

test('the unbound adapter imports without listening and rejects non-allowlisted paths or asset capacities', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(new URL('../functions/cloud-content/http-server.mjs', import.meta.url).href)}); process.stdout.write('import-only');`], { encoding: 'utf8', timeout: 3000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, 'import-only');
  const runtime = { configured: true, handle: async () => json({}) };
  assert.equal(createCloudContentServer({ runtime }).listening, false);
  for (const path of ['/admin/index.html', '/admin/contacts/private/', '/etc/passwd', '../admin/', '/_astro/../hidden.js', '/_astro/nested/file.js', '/_astro/private.json', '/_astro/portrait.png', '/_astro/staff.js?secret=x', '/invitations/private.png']) {
    assert.throws(() => createCloudContentServer({ runtime, assets: new Map([[path, Buffer.from('synthetic')]]) }), TypeError);
  }
  for (const assets of [new Map([['/admin/', Buffer.alloc(0)]]), new Map([['/admin/', Buffer.alloc(2 * 1024 * 1024 + 1)]]),
    new Map(Array.from({ length: 41 }, (_, index) => [`/_astro/${index}.js`, Buffer.from('x')])),
    new Map(Array.from({ length: 9 }, (_, index) => [`/_astro/${index}.js`, Buffer.alloc(1024 * 1024, 1)]))]) {
    assert.throws(() => createCloudContentServer({ runtime, assets }), TypeError);
  }
  for (const runtime of [undefined, {}, { configured: 'true', handle() {} }, { configured: true }]) assert.throws(() => createCloudContentServer({ runtime }), TypeError);
});

test('actual HTTP serves copied allowlisted bytes, exact inline CSP hashes, safe MIME and bodyless HEAD', async t => {
  let calls = 0;
  const assets = ASSETS();
  const { port } = await loopback(t, { assets, runtime: { configured: true, handle: async () => { calls++; return json({}); } } });
  assets.get('/admin/').fill(0);
  assets.set('/_astro/not-in-reviewed-map.js', Buffer.from('unreviewed'));
  const page = await send(port, '/admin/');
  assert.equal(page.status, 200); secure(page);
  assert.equal(page.text, HTML);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  const expected = createHash('sha256').update(INLINE.replace(/\r\n?/gu, '\n')).digest('base64');
  const scriptPolicy = /(?:^|;\s*)script-src ([^;]+)/u.exec(page.headers['content-security-policy'])[1];
  assert.equal(scriptPolicy, `'self' 'sha256-${expected}'`);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline|https?:/u);
  assert.match(page.headers['content-security-policy'], /connect-src 'self';/u);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'; form-action 'self'/u);
  const head = await send(port, '/admin/', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], page.headers['content-length']);
  const js = await send(port, '/_astro/staff-test.js');
  assert.equal(js.status, 200); secure(js);
  assert.equal(js.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(js.text, 'export const syntheticStaff = true;');
  const css = await send(port, '/_astro/staff-test.css');
  assert.equal(css.headers['content-type'], 'text/css; charset=utf-8');
  assert.equal((await send(port, '/_astro/not-in-reviewed-map.js')).status, 404);
  const redirect = await send(port, '/admin');
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, '/admin/');
  const contacts = await send(port, '/admin/contacts/');
  assert.equal(contacts.status, 200); secure(contacts);
  assert.equal(contacts.headers['content-type'], 'text/html; charset=utf-8');
  assert.match(contacts.text, /合成名单页面/u);
  assert.match(contacts.headers['content-security-policy'], /connect-src 'self';/u);
  const contactRedirect = await send(port, '/admin/contacts');
  assert.equal(contactRedirect.status, 308);
  assert.equal(contactRedirect.headers.location, '/admin/contacts/');
  const queriedRedirect = await send(port, '/admin/contacts?marker=synthetic');
  assert.equal(queriedRedirect.status, 404);
  const template = await send(port, '/invitations/template-blank.png');
  assert.equal(template.status, 200); secure(template);
  assert.equal(template.headers['content-type'], 'image/png');
  assert.equal(template.text, 'synthetic-png-template');
  const templateHead = await send(port, '/invitations/template-blank.png', { method: 'HEAD' });
  assert.equal(templateHead.status, 200);
  assert.equal(templateHead.body.length, 0);
  assert.equal(templateHead.headers['content-length'], template.headers['content-length']);
  assert.equal(calls, 0, 'static routes cannot enter the API runtime');
});

test('filesystem-looking, unknown or queried static paths never discover files or enter the API', async t => {
  let calls = 0;
  const { port } = await loopback(t, { runtime: { configured: true, handle: async () => { calls++; return json({ error: { code: 'SYNTHETIC_API_NOT_FOUND' } }, 404); } } });
  for (const path of ['/package.json', '/AGENTS.md', '/.env.local', '/admin/contacts/private/', '/admin/?marker=PRIVATE-SYNTHETIC-QUERY', '/_astro/staff-test.js?marker=PRIVATE-SYNTHETIC-QUERY', '/_astro/%2e%2e/package.json', '/_astro/private.json', '/invitations/private.png', '/missing']) {
    const response = await send(port, path);
    assert.equal(response.status, 404, path); secure(response);
    assert.deepEqual(JSON.parse(response.text), { error: { code: 'NOT_FOUND', message: '页面不存在。' } });
    assert.equal(response.text.includes('PRIVATE-'), false);
  }
  const wrongMethod = await send(port, '/admin/', { method: 'POST', body: 'PRIVATE-SYNTHETIC-BODY' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.text.includes('PRIVATE-'), false);
  assert.equal(calls, 0);
  const unknownApi = await send(port, '/api/not-implemented');
  assert.equal(unknownApi.status, 404);
  assert.equal(calls, 1);
});

test('exact application Host and fixed HTTPS origin cannot be overridden with proxy headers or absolute targets', async t => {
  const seen = [];
  const { port } = await loopback(t, { runtime: { configured: true, handle: async request => { seen.push(request.url); return json({ ok: true }); } } });
  for (const host of ['127.0.0.1', 'example.invalid', 'API.ARTDICO.HOST', 'api.artdico.host:443']) {
    const rejected = await send(port, '/api/admin/session', { headers: { host, 'x-forwarded-host': HOST, 'x-forwarded-proto': 'https', forwarded: `host=${HOST};proto=https` } });
    assert.equal(rejected.status, 421); secure(rejected);
    assert.equal(rejected.text.includes(host), false);
  }
  const result = await send(port, '/api/admin/session', { headers: { 'x-forwarded-host': 'PRIVATE-SYNTHETIC-HOST', 'x-forwarded-proto': 'http', forwarded: 'host=example.invalid;proto=http' } });
  assert.equal(result.status, 200);
  assert.deepEqual(seen, ['https://api.artdico.host/api/admin/session']);
  const absolute = await send(port, 'https://example.invalid/api/admin/session');
  assert.equal(absolute.status, 403);
  assert.equal(seen.length, 1);
});

test('closed configuration serves no admin bytes while process health keeps the full source marker and no readiness claim', async t => {
  const { port } = await loopback(t, { runtime: { configured: false, handle: createCloudContentApi({ enabled: false }) } });
  for (const path of ['/admin', '/admin/', '/admin/contacts', '/admin/contacts/', '/invitations/template-blank.png', '/_astro/staff-test.js', '/api/admin/session', '/api/admin/login']) {
    const response = await send(port, path);
    assert.equal(response.status, 503, path); secure(response);
    assert.equal(response.text.includes('合成后台页面'), false);
    assert.equal(response.headers['set-cookie'], undefined);
  }
  // The application does not authenticate FC HTTP signatures. In production the
  // unchanged signed trigger protects this route; custom domain routes exclude it.
  const health = await send(port, '/healthz', { headers: { host: 'synthetic-fc-gateway.invalid', authorization: 'PRIVATE-SYNTHETIC-NOT-A-VALID-FC-SIGNATURE', 'x-source-commit': 'c'.repeat(40) } });
  assert.equal(health.status, 200); secure(health);
  assert.deepEqual(JSON.parse(health.text), { status: 'ok', scope: 'process-only', sourceCommit: SOURCE });
  assert.equal(health.text.includes('PRIVATE-'), false);
  const head = await send(port, '/healthz', { method: 'HEAD', headers: { host: 'synthetic-fc-gateway.invalid' } });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], health.headers['content-length']);
  const unsupported = await send(port, '/healthz', { method: 'POST', body: 'PRIVATE-SYNTHETIC-BODY' });
  assert.equal(unsupported.status, 405);
  assert.equal(unsupported.headers.allow, 'GET, HEAD');
  const invalid = await loopback(t, { sourceCommit: 'PRIVATE-SYNTHETIC-INVALID-SOURCE' });
  assert.deepEqual(JSON.parse((await send(invalid.port, '/healthz')).text), { status: 'ok', scope: 'process-only', sourceCommit: null });
});

test('actual API requests preserve JSON, cookies and multiple Set-Cookie headers without a HEAD body', async t => {
  const seen = [];
  const firstCookie = '__Secure-artdico_staff_session=synthetic-cookie; Path=/api/admin; Secure; HttpOnly; SameSite=Strict';
  const secondCookie = 'synthetic-other-cookie=clear; Path=/api/admin; Secure; HttpOnly; SameSite=Strict';
  const { port } = await loopback(t, { runtime: { configured: true, handle: async request => {
    seen.push({ method: request.method, url: request.url, body: await request.text(), cookie: request.headers.get('cookie'), csrf: request.headers.get('x-csrf-token'), origin: request.headers.get('origin') });
    const response = json({ synthetic: 'receipt only' });
    response.headers.append('set-cookie', firstCookie);
    response.headers.append('set-cookie', secondCookie);
    return response;
  } } });
  const payload = JSON.stringify({ username: 'synthetic-staff', password: 'synthetic-password-only' });
  const response = await send(port, '/api/admin/login', { method: 'POST', body: payload,
    headers: { 'content-type': 'application/json', origin: 'https://api.artdico.host', cookie: firstCookie.split(';')[0], 'x-csrf-token': 'synthetic-csrf' } });
  assert.equal(response.status, 200); secure(response);
  assert.deepEqual(response.headers['set-cookie'], [firstCookie, secondCookie]);
  assert.deepEqual(JSON.parse(response.text), { synthetic: 'receipt only' });
  assert.deepEqual(seen[0], { method: 'POST', url: 'https://api.artdico.host/api/admin/login', body: payload,
    cookie: firstCookie.split(';')[0], csrf: 'synthetic-csrf', origin: 'https://api.artdico.host' });
  const head = await send(port, '/api/admin/session', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal(head.headers['content-length'], response.headers['content-length']);
  assert.equal(seen[1].body, '');
});

test('declared and actually streamed oversized bodies are rejected before the runtime sees any data', async t => {
  let calls = 0;
  const { port } = await loopback(t, { runtime: { configured: true, handle: async request => { calls++; return json({ bytes: (await request.arrayBuffer()).byteLength }); } } });
  const declared = await send(port, '/api/admin/login', { method: 'POST', headers: { 'content-length': String(MAX_CLOUD_BODY_BYTES + 1) } });
  assert.equal(declared.status, 413); secure(declared);
  assert.equal(calls, 0);
  const chunked = await send(port, '/api/admin/login', { method: 'POST', chunks: [Buffer.alloc(MAX_CLOUD_BODY_BYTES, 32), Buffer.from('PRIVATE-SYNTHETIC-OVERFLOW')] });
  assert.equal(chunked.status, 413); secure(chunked);
  assert.equal(chunked.text.includes('PRIVATE-'), false);
  assert.equal(calls, 0);
  const exact = await send(port, '/api/admin/login', { method: 'POST', body: Buffer.alloc(MAX_CLOUD_BODY_BYTES, 32), headers: { 'content-length': String(MAX_CLOUD_BODY_BYTES) } });
  assert.equal(exact.status, 200);
  assert.deepEqual(JSON.parse(exact.text), { bytes: MAX_CLOUD_BODY_BYTES });
  assert.equal(calls, 1);
});

test('runtime and HTTP parser failures stay opaque and leave the actual server responsive', async t => {
  const { port } = await loopback(t, { runtime: { configured: true, handle: async () => { throw new Error('PRIVATE-SYNTHETIC-ERROR-AND-CREDENTIAL'); } } });
  const error = await send(port, '/api/admin/session', { headers: { authorization: 'PRIVATE-SYNTHETIC-REQUEST-CREDENTIAL' } });
  assert.equal(error.status, 503); secure(error);
  assert.deepEqual(JSON.parse(error.text), { error: { code: 'SERVICE_UNAVAILABLE', message: '操作未确认完成，请重新载入后核对。' } });
  assert.equal(error.text.includes('PRIVATE-'), false);
  const malformed = await raw(port, `GET /healthz HTTP/1.1\r\nHost: ${HOST}\r\nPRIVATE-SYNTHETIC-INVALID-HEADER\r\n\r\n`);
  assert.match(malformed, /^HTTP\/1\.1 400 /u);
  assert.equal(malformed.includes('PRIVATE-'), false);
  const oversized = await raw(port, `GET /healthz HTTP/1.1\r\nHost: ${HOST}\r\nX-Private: PRIVATE-SYNTHETIC-${'x'.repeat(9000)}\r\n\r\n`);
  assert.match(oversized, /^HTTP\/1\.1 400 /u);
  assert.ok(oversized.length < 256);
  assert.equal(oversized.includes('PRIVATE-'), false);
  const head = await send(port, '/not-present', { method: 'HEAD' });
  assert.equal(head.status, 404);
  assert.equal(head.body.length, 0);
  assert.equal((await send(port, '/healthz')).status, 200);
});
