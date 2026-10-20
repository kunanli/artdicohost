import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFilePortraitStore } from '../functions/content-api/portrait-store.mjs';
import { startLocalContentServer } from '../functions/content-api/server.mjs';

const ORIGIN = 'http://127.0.0.1:8787';
const PASSWORD = 'synthetic-guest-api-test-password';
const passwordHash = await hashPassword(PASSWORD);
const users = ['editor', 'publisher', 'outreach'].map(role => ({ id: 'synthetic-' + role, username: role, label: '合成账号', roles: [role], passwordHash }));
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, data) {
  const type = Buffer.from(name), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([size, type, data, crc]);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, 10, 20, 30, 255]))), chunk('IEND', Buffer.alloc(0))]);
const picture = { contentType: 'image/png', dataBase64: PNG.toString('base64') };

async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), 'artdico-guest-api-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function apiFixture(path) {
  const portraitStore = createFilePortraitStore({ directory: path });
  const store = createFileContentStore({ directory: path, portraitStore });
  const api = createContentApi({ store, portraitStore, users, allowedOrigin: ORIGIN });
  return { api, store, portraitStore };
}
function request(api, path, { method = 'GET', payload, session, origin = ORIGIN, csrf = session?.csrfToken } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.cookie = session.cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  return api(new Request(ORIGIN + path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }));
}
async function login(api, username = 'editor') {
  const response = await request(api, '/api/admin/login', { method: 'POST', payload: { username, password: PASSWORD } });
  assert.equal(response.status, 200);
  return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
}
async function upload(api, session) {
  const response = await request(api, '/api/admin/portraits', { method: 'POST', payload: picture, session });
  assert.equal(response.status, 201);
  return (await response.json()).portrait;
}
function guest(portraitId, overrides = {}) {
  return { id: 'synthetic-guest', name: '合成嘉宾', company: '合成公司', ggjRole: '', portraitId, status: 'pending', publicConsent: false, internalNotes: 'PRIVATE-GUEST-NOTE', ...overrides };
}
async function save(api, session, expectedRevision, content) {
  const response = await request(api, '/api/admin/content', { method: 'PUT', session, payload: { expectedRevision, content } });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return (await response.json()).draft;
}
async function publish(api, session, expectedRevision) {
  const response = await request(api, '/api/admin/content/publish', { method: 'POST', session, payload: { expectedRevision } });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  return (await response.json()).published;
}

test('portrait upload and private reads enforce API authentication, roles, Origin and CSRF', async t => {
  const path = await directory(t), { api } = apiFixture(path);
  assert.equal((await request(api, '/api/admin/portraits', { method: 'POST', payload: picture })).status, 401);
  const editor = await login(api), publisher = await login(api, 'publisher'), outreach = await login(api, 'outreach');
  for (const session of [publisher, outreach]) assert.equal((await request(api, '/api/admin/portraits', { method: 'POST', payload: picture, session })).status, 403);
  for (const options of [{ csrf: 'bad' }, { origin: null }, { origin: 'https://example.invalid' }]) {
    assert.equal((await request(api, '/api/admin/portraits', { method: 'POST', payload: picture, session: editor, ...options })).status, 403);
  }
  const portrait = await upload(api, editor);
  for (const session of [editor, publisher]) {
    const response = await request(api, '/api/admin/portraits/' + portrait.id, { session });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  }
  assert.equal((await request(api, '/api/admin/portraits/' + portrait.id)).status, 401);
  assert.equal((await request(api, '/api/admin/portraits/' + portrait.id, { session: outreach })).status, 403);
  assert.equal((await request(api, '/api/admin/content', { session: outreach })).status, 403);
});

test('uploaded and draft portraits stay private; explicit publication links the same approved guest into the schedule', async t => {
  const path = await directory(t), { api } = apiFixture(path);
  const editor = await login(api), publisher = await login(api, 'publisher');
  const portrait = await upload(api, editor);
  let draft = (await (await request(api, '/api/admin/content', { session: editor })).json()).draft;
  assert.equal(draft.revision, 0, 'upload is audited but does not change the content revision');
  draft.content.guests = [guest(portrait.id)];
  draft.content.sessions[0].guestId = 'synthetic-guest';
  draft.content.sessions[0].speakerName = 'PRIVATE-COPIED-NAME';
  draft.content.sessions[0].speakerStatus = 'confirmed';
  assert.equal((await request(api, '/api/public/portraits/' + portrait.id)).status, 404);
  draft = await save(api, editor, 0, draft.content);
  const pending = await publish(api, publisher, 1);
  assert.deepEqual(pending.content.guests, []);
  assert.equal(pending.content.sessions[0].speakerName, '');
  assert.equal((await request(api, '/api/public/portraits/' + portrait.id)).status, 404);
  Object.assign(draft.content.guests[0], { status: 'confirmed', publicConsent: true, ggjRole: '合成站点职务' });
  draft = await save(api, editor, 1, draft.content);
  const approved = await publish(api, publisher, 2);
  assert.equal(approved.content.guests[0].name, '合成嘉宾');
  assert.equal(approved.content.guests[0].company, '合成公司');
  assert.equal(approved.content.guests[0].ggjRole, '合成站点职务');
  assert.equal(approved.content.sessions[0].speakerName, '合成嘉宾');
  assert.equal(approved.content.sessions[0].guestId, 'synthetic-guest');
  assert.equal(JSON.stringify(approved).includes('PRIVATE-'), false);
  const publicPhoto = await request(api, '/api/public/portraits/' + portrait.id);
  assert.equal(publicPhoto.status, 200);
  assert.equal(publicPhoto.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await publicPhoto.arrayBuffer()), PNG);
  const restarted = apiFixture(path);
  assert.deepEqual((await (await request(restarted.api, '/api/public/content')).json()), approved);
  assert.equal((await request(restarted.api, '/api/public/portraits/' + portrait.id)).status, 200);
  const state = JSON.parse(await readFile(join(path, 'content.json'), 'utf8'));
  assert.deepEqual(state.audit.map(item => item.action), ['upload_portrait', 'save_draft', 'publish', 'save_draft', 'publish']);
  assert.equal(state.audit[0].actorId, 'synthetic-editor');
  assert.equal(state.audit[0].portraitId, portrait.id);
});

test('withdrawn publication removes both guest metadata and public photo access while retaining private editing', async t => {
  const path = await directory(t), { api, store } = apiFixture(path);
  const editor = await login(api), publisher = await login(api, 'publisher');
  const portrait = await upload(api, editor);
  let draft = (await store.read()).draft;
  draft.content.guests = [guest(portrait.id, { status: 'confirmed', publicConsent: true })];
  draft.content.sessions[0].guestId = 'synthetic-guest';
  draft = await save(api, editor, 0, draft.content);
  await publish(api, publisher, 1);
  draft.content.guests[0].publicConsent = false;
  draft = await save(api, editor, 1, draft.content);
  assert.equal((await request(api, '/api/public/portraits/' + portrait.id)).status, 200, 'saving a draft does not silently replace the publication');
  const withdrawn = await publish(api, publisher, 2);
  assert.deepEqual(withdrawn.content.guests, []);
  assert.equal(withdrawn.content.sessions[0].speakerName, '');
  assert.equal(withdrawn.content.sessions[0].guestId, '');
  assert.equal((await request(api, '/api/public/portraits/' + portrait.id)).status, 404);
  assert.equal((await request(api, '/api/admin/portraits/' + portrait.id, { session: editor })).status, 200);
  for (const suffix of [portrait.id + '?download=1', 'b'.repeat(64) + '.png', '../content.json', '%2e%2e%2fcontent.json', portrait.id + '/other']) {
    assert.equal((await request(api, '/api/public/portraits/' + suffix)).status, 404, suffix);
  }
});

test('forged or missing portrait references cannot be saved or published, and audit failures cannot report upload success', async t => {
  const path = await directory(t), { api, store } = apiFixture(path);
  const editor = await login(api), publisher = await login(api, 'publisher');
  let draft = (await store.read()).draft;
  draft.content.guests = [guest('c'.repeat(64) + '.png', { status: 'confirmed', publicConsent: true })];
  let response = await request(api, '/api/admin/content', { method: 'PUT', session: editor, payload: { expectedRevision: 0, content: draft.content } });
  assert.equal(response.status, 422);
  assert.ok((await response.json()).error.fields['guests.0.portraitId']);
  assert.equal((await store.read()).draft.revision, 0);
  const portrait = await upload(api, editor);
  draft.content.guests[0].portraitId = portrait.id;
  draft = await save(api, editor, 0, draft.content);
  await writeFile(join(path, 'portraits', portrait.id), 'corrupt', { mode: 0o600 });
  response = await request(api, '/api/admin/content/publish', { method: 'POST', session: publisher, payload: { expectedRevision: 1 } });
  assert.equal(response.status, 422);
  assert.equal((await store.read()).published, null);
  await writeFile(join(path, 'portraits', portrait.id), PNG, { mode: 0o600 });
  await writeFile(join(path, 'content.json'), '{corrupt');
  response = await request(api, '/api/admin/portraits', { method: 'POST', session: editor, payload: picture });
  assert.notEqual(response.status, 201);
  assert.equal((await response.json()).error.code, 'STORAGE_ERROR');
});

test('loopback HTTP serves uploaded portraits through guarded API routes without exposing the private storage directory', async t => {
  const path = await directory(t), dist = join(path, 'dist'), data = join(path, 'private');
  await mkdir(join(dist, 'admin'), { recursive: true });
  await writeFile(join(dist, 'index.html'), '<html><head></head><body>合成预览</body></html>');
  await writeFile(join(dist, 'admin', 'index.html'), '<html><head></head><body>合成后台</body></html>');
  const local = await startLocalContentServer({ env: { NODE_ENV: 'test' }, users, port: 0, distDirectory: dist, dataDirectory: data });
  t.after(() => local.close());
  const authResponse = await fetch(local.origin + '/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: local.origin }, body: JSON.stringify({ username: 'editor', password: PASSWORD }) });
  const auth = await authResponse.json(), cookie = authResponse.headers.get('set-cookie').split(';')[0];
  const uploaded = await fetch(local.origin + '/api/admin/portraits', { method: 'POST', headers: { 'content-type': 'application/json', origin: local.origin, cookie, 'x-csrf-token': auth.csrfToken }, body: JSON.stringify(picture) });
  assert.equal(uploaded.status, 201);
  const portrait = (await uploaded.json()).portrait;
  const privateImage = await fetch(local.origin + '/api/admin/portraits/' + portrait.id, { headers: { cookie } });
  assert.equal(privateImage.status, 200);
  assert.match(privateImage.headers.get('content-security-policy'), /img-src 'self' data:/u);
  assert.deepEqual(Buffer.from(await privateImage.arrayBuffer()), PNG);
  assert.equal((await fetch(local.origin + '/api/public/portraits/' + portrait.id)).status, 404);
  assert.equal((await fetch(local.origin + '/private/portraits/' + portrait.id)).status, 404);
  assert.equal((await fetch(local.origin + '/portraits/' + portrait.id)).status, 404);
});

test('a legacy save cannot silently erase an existing guest list through an omitted new field', async t => {
  const path = await directory(t), { api, store } = apiFixture(path);
  const editor = await login(api);
  let draft = (await store.read()).draft;
  const legacy = structuredClone(draft.content);
  delete legacy.guests;
  draft = await save(api, editor, 0, legacy);
  draft.content.guests = [guest('')];
  draft = await save(api, editor, 1, draft.content);
  const incomplete = structuredClone(draft.content);
  delete incomplete.guests;
  const rejected = await request(api, '/api/admin/content', { method: 'PUT', session: editor, payload: { expectedRevision: 2, content: incomplete } });
  assert.equal(rejected.status, 422);
  assert.ok((await rejected.json()).error.fields.guests);
  assert.deepEqual((await store.read()).draft, draft);
  draft.content.guests = [];
  const explicit = await save(api, editor, 2, draft.content);
  assert.deepEqual(explicit.content.guests, []);
});
