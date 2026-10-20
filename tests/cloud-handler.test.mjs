import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudAuth } from '../functions/cloud-content/auth.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN, MAX_CLOUD_BODY_BYTES } from '../functions/cloud-content/handler.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const secret = 'synthetic-cloud-password-only';
const passwordHash = await hashPassword(secret);
const accounts = [{ id: 'synthetic', username: 'synthetic', email: 'synthetic@artdico.co', label: '合成工作人员', roles: ['editor', 'publisher'], passwordHash }];
function setup(objects = memoryObjects(), users = accounts) {
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const portraitStore = createOssPortraitStore({ objects });
  const store = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore });
  const auth = createCloudAuth({ users, journalFor });
  return { objects, api: createCloudContentApi({ enabled: true, store, portraitStore, auth }) };
}
const request = (path, { method = 'GET', headers = {}, body, origin = method === 'GET' || method === 'HEAD' ? undefined : CLOUD_API_ORIGIN } = {}) => new Request(CLOUD_API_ORIGIN + path, { method, headers: { ...(origin === undefined ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body) }) });
async function login(api, identifier = 'synthetic') {
  const response = await api(request('/api/admin/login', { method: 'POST', body: { username: identifier, password: secret } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal('passwordHash' in result.user, false);
  return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': result.csrfToken };
}

test('two cloud API instances share login, content, publication and logout without local files', async () => {
  const first = setup(); const second = setup(first.objects);
  const headers = await login(first.api, 'synthetic@artdico.co');
  const initial = await (await second.api(request('/api/admin/content', { headers }))).json();
  initial.draft.content.sessions[0].title = '合成修改后的公开场次';
  initial.draft.content.sessions[0].internalNotes = 'SYNTHETIC_PRIVATE_NOTE';
  const save = await second.api(request('/api/admin/content', { method: 'PUT', headers, body: { expectedRevision: 0, content: initial.draft.content } }));
  assert.equal(save.status, 200);
  assert.equal((await first.api(request('/api/public/content'))).status, 404);
  const publish = await first.api(request('/api/admin/content/publish', { method: 'POST', headers, body: { expectedRevision: 1 } }));
  assert.equal(publish.status, 200);
  const published = await second.api(request('/api/public/content', { origin: PUBLIC_SITE_ORIGIN }));
  assert.equal(published.headers.get('access-control-allow-origin'), PUBLIC_SITE_ORIGIN);
  assert.equal(published.headers.get('access-control-allow-credentials'), null);
  const text = await published.text();
  assert.match(text, /合成修改后的公开场次/u); assert.doesNotMatch(text, /SYNTHETIC_PRIVATE_NOTE|passwordHash|csrfToken/u);
  const logout = await second.api(request('/api/admin/logout', { method: 'POST', headers })); assert.equal(logout.status, 200);
  assert.equal((await first.api(request('/api/admin/content', { headers }))).status, 401);
});

test('cloud Origin, CSRF and server roles protect content and reject cross-origin management', async () => {
  const { api } = setup(); const headers = await login(api);
  assert.equal((await api(request('/api/admin/content', { headers, origin: PUBLIC_SITE_ORIGIN }))).status, 403);
  assert.equal((await api(request('/api/admin/content', { headers, origin: 'https://untrusted.invalid' }))).status, 403);
  assert.equal((await api(request('/api/admin/content/publish', { method: 'POST', headers: { Cookie: headers.Cookie }, body: { expectedRevision: 0 } }))).status, 403);
  const editor = setup(undefined, [{ ...accounts[0], roles: ['editor'] }]);
  const editorHeaders = await login(editor.api);
  assert.equal((await editor.api(request('/api/admin/content/publish', { method: 'POST', headers: editorHeaders, body: { expectedRevision: 0 } }))).status, 403);
  const preflight = await api(request('/api/public/content', { method: 'OPTIONS', origin: PUBLIC_SITE_ORIGIN, headers: { 'Access-Control-Request-Method': 'GET' } }));
  assert.equal(preflight.status, 204);
  assert.equal((await api(request('/api/admin/login', { method: 'OPTIONS', origin: PUBLIC_SITE_ORIGIN, headers: { 'Access-Control-Request-Method': 'POST' } }))).status, 403);
});

test('cloud body limits, invalid encodings and opaque storage failures never claim success', async () => {
  const { api, objects } = setup(); const headers = await login(api);
  for (const body of ['{', '[]', 'null', Uint8Array.of(0xff)]) {
    assert.equal((await api(request('/api/admin/content', { method: 'PUT', headers, body }))).status, 400);
  }
  assert.equal((await api(request('/api/admin/content', { method: 'PUT', headers, body: 'x'.repeat(MAX_CLOUD_BODY_BYTES + 1) }))).status, 413);
  assert.equal((await api(request('/api/admin/content', { method: 'PUT', headers: { ...headers, 'Content-Encoding': 'gzip' }, body: '{}' }))).status, 415);
  objects.setFailure('get');
  const response = await api(request('/api/admin/content', { headers }));
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /SYNTHETIC_PRIVATE_PROVIDER_DETAIL|cms\/v1|passwordHash/u);
});

test('configuration gates remain closed and private contacts and preview readiness require outreach', async () => {
  const disabled = createCloudContentApi();
  assert.equal((await disabled(request('/api/admin/login', { method: 'POST', body: {} }))).status, 503);
  assert.throws(() => createCloudContentApi({ enabled: 'false' }), TypeError);
  const { api } = setup(); const headers = await login(api);
  assert.equal((await api(request('/api/registrations', { method: 'POST', body: {} }))).status, 503);
  for (const path of ['/api/admin/contacts', '/api/admin/communications']) assert.equal((await api(request(path, { headers }))).status, 403);
  for (const path of ['/api/admin/wallet', '/healthz']) assert.equal((await api(request(path, { headers }))).status, 404);
});

test('aborted streams and mismatched body lengths cannot consume a login or commit content', async () => {
  const { api, objects } = setup();
  const before = objects.calls.length;
  const controller = new AbortController();
  let cancel = 0;
  const stream = new ReadableStream({ cancel() { cancel++; } });
  const pending = api(new Request(CLOUD_API_ORIGIN + '/api/admin/login', { method: 'POST', headers: { Origin: CLOUD_API_ORIGIN, 'Content-Type': 'application/json' }, body: stream, duplex: 'half', signal: controller.signal }));
  controller.abort();
  const aborted = await pending;
  assert.equal(aborted.status, 400);
  assert.equal(cancel, 1);
  for (const length of ['1', '999']) {
    const result = await api(request('/api/admin/login', { method: 'POST', headers: { 'Content-Length': length }, body: '{}' }));
    assert.equal(result.status, 400);
  }
  assert.equal(objects.calls.length, before);
});

test('only currently published, consenting guest portraits can be read through the public API', async () => {
  const first = setup(); const second = setup(first.objects);
  const headers = await login(first.api);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
  const upload = await first.api(request('/api/admin/portraits', { method: 'POST', headers, body: { contentType: 'image/png', dataBase64: png } }));
  assert.equal(upload.status, 201);
  const { portrait } = await upload.json();
  const publicPath = '/api/public/portraits/' + portrait.id;
  assert.equal((await second.api(request(publicPath, { origin: PUBLIC_SITE_ORIGIN }))).status, 404);
  const { draft } = await (await first.api(request('/api/admin/content', { headers }))).json();
  draft.content.guests = [{ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: portrait.id, status: 'confirmed', publicConsent: true, internalNotes: 'SYNTHETIC_PRIVATE_GUEST_NOTE' }];
  assert.equal((await first.api(request('/api/admin/content', { method: 'PUT', headers, body: { expectedRevision: 0, content: draft.content } }))).status, 200);
  assert.equal((await second.api(request('/api/admin/content/publish', { method: 'POST', headers, body: { expectedRevision: 1 } }))).status, 200);
  const photo = await first.api(request(publicPath, { origin: PUBLIC_SITE_ORIGIN }));
  assert.equal(photo.status, 200); assert.equal(photo.headers.get('content-type'), 'image/png');
  assert.equal(photo.headers.get('access-control-allow-origin'), PUBLIC_SITE_ORIGIN);
  assert.equal(photo.headers.get('cache-control'), 'no-store');
  assert.ok((await photo.arrayBuffer()).byteLength > 0);
  draft.content.guests[0].publicConsent = false;
  assert.equal((await second.api(request('/api/admin/content', { method: 'PUT', headers, body: { expectedRevision: 1, content: draft.content } }))).status, 200);
  assert.equal((await first.api(request('/api/admin/content/publish', { method: 'POST', headers, body: { expectedRevision: 2 } }))).status, 200);
  assert.equal((await second.api(request(publicPath, { origin: PUBLIC_SITE_ORIGIN }))).status, 404);
  assert.equal((await second.api(request('/api/admin/portraits/' + portrait.id, { headers }))).status, 200);
});
