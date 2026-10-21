import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudApplication } from '../functions/cloud-content/runtime.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const ORIGIN = 'https://api.artdico.host';
const PASSWORD = 'synthetic-booth-save-password';
const request = (path, { method = 'GET', headers = {}, body } = {}) => new Request(ORIGIN + path, {
  method, headers: { ...headers, ...(body === undefined ? {} : { Origin: ORIGIN, 'Content-Type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('unsent booth edits stay in the page while an acknowledged cloud save survives application reconstruction', async () => {
  const objects = memoryObjects();
  const env = { ADMIN_USERS_JSON: JSON.stringify([{ id: 'synthetic-editor', username: 'synthetic.editor',
    label: '合成编辑', roles: ['editor'], passwordHash: await hashPassword(PASSWORD) }]) };
  const make = () => createCloudApplication({ objects, env, now: () => Date.parse('2026-10-21T00:00:00Z'),
    fetchFn() { throw new Error('No external service is allowed in the synthetic content-save test.'); } });
  const first = make();
  const login = await first.handle(request('/api/admin/login', { method: 'POST', body: { username: 'synthetic.editor', password: PASSWORD } }));
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await login.json()).csrfToken };
  const read = async application => {
    const response = await application.handle(request('/api/admin/content', { headers }));
    assert.equal(response.status, 200);
    return response.json();
  };

  const page = await read(first);
  const booth = { id: 'synthetic-save-booth', code: 'C-01', slotNumber: 1, zone: 'C', organization: '合成组织',
    project: '合成作品', status: 'confirmed', contactName: '合成负责人', contactMethods: 'synthetic@example.invalid',
    description: '合成展位展示内容', internalNotes: 'SYNTHETIC_PRIVATE_BOOTH_NOTE' };
  page.draft.content.booths.push(booth);

  // An applied editor form still needs a PUT; a fresh application only sees
  // committed objects, regardless of what the page's mutable JSON now contains.
  const beforeSave = await read(make());
  assert.equal(beforeSave.draft.revision, page.draft.revision);
  assert.deepEqual(beforeSave.draft.content.booths, []);
  assert.equal([...objects.files.keys()].some(key => key.startsWith('cms/v1/content/')), false);

  const response = await first.handle(request('/api/admin/content', { method: 'PUT', headers,
    body: { expectedRevision: page.draft.revision, content: page.draft.content } }));
  assert.equal(response.status, 200);
  const acknowledged = await response.json();
  assert.equal(acknowledged.draft.revision, page.draft.revision + 1);
  assert.deepEqual(acknowledged.draft.content.booths, [booth]);

  const reloaded = await read(make());
  assert.equal(reloaded.draft.revision, acknowledged.draft.revision);
  assert.deepEqual(reloaded.draft.content.booths, [booth]);
  assert.equal(reloaded.published, null);
});
