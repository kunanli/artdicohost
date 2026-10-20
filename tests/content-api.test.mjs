import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hashPassword, parseAdminUsers } from '../functions/content-api/auth.mjs';
import { createContentApi, MAX_BODY_BYTES } from '../functions/content-api/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { startLocalContentServer } from '../functions/content-api/server.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const PASSWORD = 'synthetic-local-test-password';
const passwordHash = await hashPassword(PASSWORD);
const users = [
  { id: 'test-editor', username: 'test-editor', label: '合成编辑账号', roles: ['editor'], passwordHash },
  { id: 'test-publisher', username: 'test-publisher', label: '合成发布账号', roles: ['publisher'], passwordHash },
];
const ORIGIN = 'http://127.0.0.1:8787';
const TEST_ROOT = fileURLToPath(new URL('../.local-data/', import.meta.url));

async function temporary(t) {
  await mkdir(TEST_ROOT, { recursive: true });
  const directory = await mkdtemp(join(TEST_ROOT, 'artdico-content-test-'));
  t.after(async () => {
    const path = relative(resolve(TEST_ROOT), resolve(directory));
    assert.ok(!isAbsolute(path) && path.startsWith('artdico-content-test-') && !path.startsWith('..'));
    await rm(directory, { recursive: true, force: true });
  });
  return directory;
}

async function fixture(t, options = {}) {
  const directory = await temporary(t);
  const store = createFileContentStore({ directory });
  const api = createContentApi({ store, users, allowedOrigin: ORIGIN, ...options });
  return { directory, store, api };
}

function request(api, path, { method = 'GET', payload, session, origin = ORIGIN, csrf = session?.csrfToken, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (origin !== null) headers.origin = origin;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.cookie = session.cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  return api(new Request(ORIGIN + path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }));
}

async function login(api, username = 'test-editor') {
  const response = await request(api, '/api/admin/login', { method: 'POST', payload: { username, password: PASSWORD } });
  assert.equal(response.status, 200);
  const value = await response.json();
  return { ...value, cookie: response.headers.get('set-cookie').split(';')[0], setCookie: response.headers.get('set-cookie') };
}

test('accounts require scrypt hashes and explicit supported roles; login exposes no hash', async (t) => {
  assert.throws(() => parseAdminUsers(''), /JSON/u);
  assert.throws(() => parseAdminUsers([]), /默认/u);
  assert.throws(() => parseAdminUsers([{ ...users[0], password: PASSWORD }]), /明文/u);
  assert.throws(() => parseAdminUsers([{ ...users[0], roles: ['implicit-admin'] }]), /无效/u);
  assert.deepEqual(parseAdminUsers([{ ...users[0], roles: ['superadmin'] }])[0].roles, ['superadmin']);
  const { api } = await fixture(t);
  const session = await login(api);
  assert.deepEqual(session.user.roles, ['editor']);
  assert.equal(JSON.stringify(session).includes(passwordHash), false);
  assert.match(session.setCookie, /HttpOnly; SameSite=Strict/u);
  assert.match(session.setCookie, /Path=\/api\/admin/u);
  assert.equal((await request(api, '/api/admin/session', { session })).status, 200);
});

test('unauthenticated reads and mutations are denied; unknown and bad passwords look the same', async (t) => {
  const { api } = await fixture(t);
  assert.equal((await request(api, '/api/admin/content')).status, 401);
  assert.equal((await request(api, '/api/admin/content', { method: 'PUT', payload: {} })).status, 401);
  const first = await request(api, '/api/admin/login', { method: 'POST', payload: { username: 'test-editor', password: 'incorrect' } });
  const second = await request(api, '/api/admin/login', { method: 'POST', payload: { username: 'unknown', password: 'incorrect' } });
  assert.equal(first.status, 401);
  assert.deepEqual(await first.json(), await second.json());
});

test('Origin and CSRF checks protect login, save, publish and logout', async (t) => {
  const { api } = await fixture(t);
  assert.equal((await request(api, '/api/admin/login', { method: 'POST', payload: {}, origin: 'https://example.invalid' })).status, 403);
  assert.equal((await request(api, '/api/admin/login', { method: 'POST', payload: {}, origin: null })).status, 403);
  const session = await login(api);
  for (const [path, method] of [['/api/admin/content', 'PUT'], ['/api/admin/content/publish', 'POST'], ['/api/admin/logout', 'POST']]) {
    assert.equal((await request(api, path, { method, payload: {}, session, csrf: 'invalid' })).status, 403);
    assert.equal((await request(api, path, { method, payload: {}, session, origin: 'https://example.invalid' })).status, 403);
  }
  assert.equal((await request(api, '/api/admin/content', { session, origin: 'https://example.invalid' })).status, 403);
});

test('draft edits persist across restart and remain private until explicit authorized publication', async (t) => {
  const { api, directory } = await fixture(t);
  const editor = await login(api);
  const initial = await (await request(api, '/api/admin/content', { session: editor })).json();
  assert.equal(initial.draft.revision, 0);
  assert.equal(initial.draft.content.sessions.length, 43);
  assert.equal(initial.published, null);
  const content = initial.draft.content;
  content.event.title = '合成测试活动';
  content.sessions[0].internalNotes = '仅工作人员可见的合成备注';
  content.sessions[0].speakerName = '尚未确认的合成名字';
  content.sessions[1].status = 'draft';
  content.booths.push({ id: 'test-booth', code: 'C-01', organization: '合成机构', project: '合成项目', zone: 'C', status: 'confirmed', internalNotes: '合成展位内部备注' });
  const saved = await request(api, '/api/admin/content', { method: 'PUT', session: editor, payload: { expectedRevision: 0, content } });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).draft.revision, 1);
  assert.equal((await request(api, '/api/public/content')).status, 404);
  const restarted = createContentApi({ store: createFileContentStore({ directory }), users, allowedOrigin: ORIGIN });
  assert.equal((await request(restarted, '/api/admin/session', { session: editor })).status, 401);
  const publisher = await login(restarted, 'test-publisher');
  const publication = await request(restarted, '/api/admin/content/publish', { method: 'POST', session: publisher, payload: { expectedRevision: 1 } });
  assert.equal(publication.status, 200);
  const publicResponse = await request(restarted, '/api/public/content');
  const published = await publicResponse.json();
  assert.equal(published.revision, 1);
  assert.equal(published.content.event.title, '合成测试活动');
  assert.equal(published.content.sessions[0].speakerName, '');
  assert.equal(published.content.sessions.length, 42);
  assert.equal(published.content.booths.length, 1);
  assert.equal(JSON.stringify(published).includes('internalNotes'), false);
  assert.equal(JSON.stringify(published).includes('尚未确认的合成名字'), false);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  const stored = JSON.parse(await readFile(join(directory, 'content.json'), 'utf8'));
  assert.deepEqual(stored.audit.map((entry) => entry.actorId), ['test-editor', 'test-publisher']);
});

test('editor and publisher capabilities are enforced by API, not UI', async (t) => {
  const { api } = await fixture(t);
  const editor = await login(api);
  const publisher = await login(api, 'test-publisher');
  assert.equal((await request(api, '/api/admin/content/publish', { method: 'POST', session: editor, payload: { expectedRevision: 0 } })).status, 403);
  assert.equal((await request(api, '/api/admin/content', { method: 'PUT', session: publisher, payload: { expectedRevision: 0, content: createInitialContent() } })).status, 403);
});

test('simultaneous writes to one expected revision accept only one; stale publication conflicts', async (t) => {
  const { api } = await fixture(t);
  const editor = await login(api);
  const responses = await Promise.all([1, 2].map((value) => {
    const content = createInitialContent();
    content.event.title = `合成标题 ${value}`;
    return request(api, '/api/admin/content', { method: 'PUT', session: editor, payload: { expectedRevision: 0, content } });
  }));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await responses.find((response) => response.status === 409).json()).error.code, 'REVISION_CONFLICT');
  const publisher = await login(api, 'test-publisher');
  assert.equal((await request(api, '/api/admin/content/publish', { method: 'POST', session: publisher, payload: { expectedRevision: 0 } })).status, 409);
});

test('malformed content, revision, JSON, media type and oversized payloads are rejected without saving', async (t) => {
  const { api } = await fixture(t);
  const session = await login(api);
  const invalid = createInitialContent();
  invalid.event.date = 'not-a-date';
  const badContent = await request(api, '/api/admin/content', { method: 'PUT', session, payload: { expectedRevision: 0, content: invalid } });
  assert.equal(badContent.status, 422);
  assert.ok((await badContent.json()).error.fields['event.date']);
  assert.equal((await request(api, '/api/admin/content', { method: 'PUT', session, payload: { expectedRevision: '0', content: createInitialContent() } })).status, 400);
  const headers = { origin: ORIGIN, cookie: session.cookie, 'x-csrf-token': session.csrfToken, 'content-type': 'application/json' };
  assert.equal((await api(new Request(`${ORIGIN}/api/admin/content`, { method: 'PUT', headers, body: '{' }))).status, 400);
  assert.equal((await api(new Request(`${ORIGIN}/api/admin/content`, { method: 'PUT', headers: { ...headers, 'content-type': 'text/plain' }, body: '{}' }))).status, 415);
  assert.equal((await api(new Request(`${ORIGIN}/api/admin/content`, { method: 'PUT', headers, body: ' '.repeat(MAX_BODY_BYTES + 1) }))).status, 413);
  assert.equal((await (await request(api, '/api/admin/content', { session })).json()).draft.revision, 0);
});

test('login limits use trusted caller address and sessions expire or revoke on logout', async (t) => {
  let time = 1000;
  const { api } = await fixture(t, { now: () => time, loginLimit: 3, loginWindowMs: 1000, sessionTtlMs: 100 });
  const session = await login(api);
  assert.equal((await request(api, '/api/admin/logout', { method: 'POST', session })).status, 200);
  assert.equal((await request(api, '/api/admin/session', { session })).status, 401);
  const second = await login(api);
  time += 101;
  assert.equal((await request(api, '/api/admin/session', { session: second })).status, 401);
  await request(api, '/api/admin/login', { method: 'POST', payload: {}, headers: { 'x-forwarded-for': '198.51.100.1' } });
  const limited = await request(api, '/api/admin/login', { method: 'POST', payload: {}, headers: { 'x-forwarded-for': '198.51.100.2' } });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  time += 1000;
  assert.equal((await login(api)).user.id, 'test-editor');
});

test('corrupt local state fails closed and is never reset or overwritten', async (t) => {
  const { api, directory } = await fixture(t);
  await writeFile(join(directory, 'content.json'), '{corrupt', 'utf8');
  const session = await login(api);
  const response = await request(api, '/api/admin/content', { session });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'STORAGE_ERROR');
  assert.equal(await readFile(join(directory, 'content.json'), 'utf8'), '{corrupt');
});

test('loopback HTTP serves only dist, injects content metadata, and never exposes environment or data', async (t) => {
  const directory = await temporary(t);
  const dist = join(directory, 'dist');
  await mkdir(join(dist, 'admin'), { recursive: true });
  const inlineScript = 'globalThis.synthetic = true;';
  await writeFile(join(dist, 'index.html'), `<html><head></head><body>synthetic<script type="module">${inlineScript}</script></body></html>`);
  await writeFile(join(dist, 'admin', 'index.html'), '<html><head></head><body>admin</body></html>');
  await writeFile(join(directory, '.env.local'), 'SYNTHETIC_PRIVATE=must-not-serve');
  const local = await startLocalContentServer({ env: { NODE_ENV: 'test' }, users, port: 0, distDirectory: dist, dataDirectory: join(directory, 'data') });
  t.after(() => local.close());
  assert.equal(local.server.address().address, '127.0.0.1');
  let page;
  try { page = await fetch(local.origin); }
  catch (error) {
    if (!process.env.CI && ['EACCES', 'EPERM'].includes(error.cause?.code)) {
      t.skip('本地沙箱禁止 loopback 连接；此 HTTP 测试必须在 CI 无跳过执行。');
      return;
    }
    throw error;
  }
  assert.match(await page.text(), /name="artdico-content-api" content="\/api\/public\/content"/u);
  assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok(page.headers.get('content-security-policy').includes(`'sha256-${createHash('sha256').update(inlineScript).digest('base64')}'`));
  assert.equal(page.headers.get('content-security-policy').split('script-src')[1].split(';')[0].includes('unsafe-inline'), false);
  assert.equal((await fetch(`${local.origin}/admin/`)).status, 200);
  assert.equal((await fetch(`${local.origin}/.env.local`)).status, 404);
  assert.equal((await fetch(`${local.origin}/%2e%2e/.env.local`)).status, 404);
  assert.equal((await fetch(`${local.origin}/.local-data/content.json`)).status, 404);
  assert.equal((await fetch(`${local.origin}/api/public/content`)).status, 404);
  const loggedIn = await fetch(`${local.origin}/api/admin/login`, { method: 'POST', headers: { origin: local.origin, 'content-type': 'application/json' }, body: JSON.stringify({ username: 'test-editor', password: PASSWORD }) });
  assert.equal(loggedIn.status, 200);
});

test('production, missing accounts and data under public dist are rejected before serving', async (t) => {
  const directory = await temporary(t);
  await assert.rejects(startLocalContentServer({ env: { NODE_ENV: 'production' }, users, distDirectory: directory }), /生产/u);
  await assert.rejects(startLocalContentServer({ env: { CONTENT_API_MODE: 'production' }, users, distDirectory: directory }), /生产/u);
  await assert.rejects(startLocalContentServer({ env: {}, distDirectory: directory }), /JSON|默认/u);
  await assert.rejects(startLocalContentServer({ env: {}, users, distDirectory: directory, dataDirectory: join(directory, 'private') }), /dist/u);
});
