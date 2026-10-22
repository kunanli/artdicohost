import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createFilePortraitStore } from '../functions/content-api/portrait-store.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN } from '../functions/cloud-content/handler.mjs';
import { createCloudAuth } from '../functions/cloud-content/auth.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createOssPortraitStore } from '../functions/cloud-content/portrait-store.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const PASSWORD = 'synthetic-showcase-password-only';
const passwordHash = await hashPassword(PASSWORD);
const users = [{ id: 'synthetic', username: 'synthetic', label: '合成工作人员', roles: ['editor', 'publisher'], passwordHash }];
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const showcase = (coverId, sessionId) => ({
  id: 'synthetic-showcase', title: '合成作品', teamName: '合成团队', summary: '合成作品简介',
  school: 'PRIVATE-SCHOOL', contactName: 'PRIVATE-STUDENT', email: 'private@example.invalid', wechat: 'PRIVATE-WECHAT',
  memberCount: 3, materialLinks: 'https://example.invalid/PRIVATE-MATERIAL', internalNotes: 'PRIVATE-NOTES',
  participationForms: ['share'], responseStatus: 'attending', status: 'confirmed', publicConsent: true,
  coverId, sessionId, boothId: '',
});

for (const mode of ['local', 'cloud']) {
  test(`${mode} student images stay private until publication, survive restart and close after withdrawal`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-showcase-synthetic-'));
    const origin = mode === 'cloud' ? CLOUD_API_ORIGIN : 'http://127.0.0.1:8787';
    const objects = memoryObjects();
    const journalFor = prefix => createObjectJournal({ objects, prefix });
    const build = () => {
      const portraitStore = mode === 'cloud' ? createOssPortraitStore({ objects }) : createFilePortraitStore({ directory });
      const store = mode === 'cloud' ? createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore }) : createFileContentStore({ directory, portraitStore });
      const api = mode === 'cloud' ? createCloudContentApi({ enabled: true, store, portraitStore, auth: createCloudAuth({ users, journalFor }) }) : createContentApi({ store, portraitStore, users, allowedOrigin: origin });
      return { api, store };
    };
    const request = (path, { method = 'GET', headers = {}, body } = {}) => new Request(origin + path, {
      method, headers: { ...headers, ...(method === 'GET' ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    try {
      const first = build();
      const login = await first.api(request('/api/admin/login', { method: 'POST', body: { username: 'synthetic', password: PASSWORD } }));
      assert.equal(login.status, 200);
      const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': (await login.json()).csrfToken };
      const uploaded = await first.api(request('/api/admin/portraits', { method: 'POST', headers, body: { contentType: 'image/png', dataBase64: PNG } }));
      assert.equal(uploaded.status, 201);
      const { portrait } = await uploaded.json();
      const imagePath = '/api/public/portraits/' + portrait.id;
      assert.equal((await first.api(request(imagePath))).status, 404);
      const { draft } = await first.store.read();
      draft.content.showcases = [showcase(portrait.id, draft.content.sessions[0].id)];
      const saveBody = { expectedRevision: 0, content: draft.content };
      assert.equal((await first.api(request('/api/admin/content', { method: 'PUT', headers, body: saveBody }))).status, 200);
      assert.equal((await first.api(request(imagePath))).status, 404);
      assert.equal((await first.api(request('/api/admin/content/publish', { method: 'POST', headers, body: { expectedRevision: 1 } }))).status, 200);
      const second = build();
      const response = await second.api(request('/api/public/content'));
      const publicText = await response.text();
      assert.equal(response.status, 200);
      assert.doesNotMatch(publicText, /PRIVATE-|private@example|memberCount|materialLinks|contactName|wechat|school/u);
      assert.equal(JSON.parse(publicText).content.showcases[0].title, '合成作品');
      const image = await second.api(request(imagePath));
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.ok((await image.arrayBuffer()).byteLength > 0);
      const withoutShowcases = structuredClone(draft.content); delete withoutShowcases.showcases;
      await assert.rejects(second.store.save(1, withoutShowcases, 'synthetic'), error => error.status === 422);
      const missingImage = structuredClone(draft.content); missingImage.showcases[0].coverId = 'b'.repeat(64) + '.png';
      await assert.rejects(second.store.save(1, missingImage, 'synthetic'), error => error.status === 422 && Boolean(error.fields?.['showcases.0.coverId']));
      assert.equal((await second.store.read()).draft.revision, 1);
      draft.content.showcases[0].visibility = 'private';
      await second.store.save(1, draft.content, 'synthetic');
      await second.store.publish(2, 'synthetic');
      assert.equal((await build().api(request(imagePath))).status, 404);
      assert.deepEqual((await second.store.read()).published.content.showcases, []);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
}
