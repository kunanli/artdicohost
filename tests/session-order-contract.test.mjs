import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent, toPublicContent } from '../shared/content-schema.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const AT = '2026-11-03T09:00:00.000Z', clock = () => Date.parse(AT), ACTOR = 'synthetic-order-editor';
const PASSWORD = 'synthetic-session-order-password', passwordHash = await hashPassword(PASSWORD);
const user = { id: ACTOR, username: ACTOR, label: '合成排序编辑', roles: ['editor', 'publisher'], passwordHash };
const invalidValues = [null, undefined, '', 'TIME', 'Manual', ' time ', 'manual\n', false, true, 0, {}, []];
function legacyContent() {
  const content = createInitialContent(); delete content.sessionOrder;
  content.guests = []; content.showcases = []; content.organizations = []; content.booths = [];
  const session = (id, start, end) => ({ id, start, end, zone: 'A', title: '合成日程 ' + id, speakerName: '', speakerStatus: 'pending', status: 'scheduled', format: 'other', internalNotes: '' });
  // Physical array order is intentional, distinct from chronological order.
  content.sessions = [session('synthetic-late', '10:00', '10:30'), session('synthetic-early', '09:00', '09:30')];
  assert.equal(validateContent(content).valid, true); return content;
}
async function fixture(mode, t) {
  const initialContent = legacyContent();
  if (mode === 'file') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-session-order-synthetic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return { build: () => createFileContentStore({ directory, initialContent, now: clock }), bytes: () => readFile(join(directory, 'content.json'), 'utf8') };
  }
  const objects = memoryObjects();
  return { build: () => createOssContentStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }), initialContent, now: clock }),
    bytes: async () => JSON.stringify([...objects.files].map(([key, item]) => [key, item.objectType, item.contentType, item.data.toString('base64')])) };
}
async function apiFixture(mode, f) {
  const store = f.build();
  if (mode === 'file') {
    const origin = 'http://127.0.0.1:8787', api = createContentApi({ store, users: [user], allowedOrigin: origin, now: clock });
    const response = await api(new Request(origin + '/api/admin/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: ACTOR, password: PASSWORD }) }));
    assert.equal(response.status, 200); const session = await response.json();
    return { store, api, origin, headers: { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': session.csrfToken } };
  }
  const origin = 'https://api.artdico.host', csrfToken = 'synthetic-session-order-csrf';
  const unused = () => assert.fail('session-order tests never upload/read images or log in to an external service');
  const api = createCloudContentApi({ enabled: true, store, portraitStore: { read: unused, upload: unused },
    auth: { login: unused, logout: unused, authenticate: async request => { assert.equal(request.headers.get('cookie'), 'synthetic-order-session'); return { user, csrfToken }; } } });
  return { store, api, origin, headers: { Cookie: 'synthetic-order-session', 'X-CSRF-Token': csrfToken } };
}
function request(f, path, method = 'GET', body) {
  return f.api(new Request(f.origin + path, { method, headers: { Origin: f.origin, ...f.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));
}
async function responseJson(response, expected = 200) {
  const body = await response.json(); assert.equal(response.status, expected, JSON.stringify(body)); return body;
}

test('sessionOrder is optional without synthesizing legacy own-properties; explicit modes survive public projection', () => {
  const legacy = legacyContent(), before = JSON.stringify(legacy), checked = validateContent(legacy);
  assert.equal(checked.valid, true); assert.equal(Object.hasOwn(checked.value, 'sessionOrder'), false);
  assert.equal(Object.hasOwn(toPublicContent(legacy), 'sessionOrder'), false); assert.equal(JSON.stringify(legacy), before);
  for (const sessionOrder of ['time', 'manual']) {
    const content = { ...legacy, sessionOrder }, copy = structuredClone(content), normalized = validateContent(content);
    assert.equal(normalized.valid, true, JSON.stringify(normalized.errors)); assert.equal(normalized.value.sessionOrder, sessionOrder);
    const publicContent = toPublicContent(content); assert.equal(publicContent.sessionOrder, sessionOrder);
    assert.deepEqual(toPublicContent(publicContent), publicContent); assert.deepEqual(content, copy);
  }
});

test('sessionOrder rejects present invalid values and descriptors without coercion or executing getters', () => {
  for (const value of invalidValues) {
    const content = legacyContent(); content.sessionOrder = value;
    assert.equal(Object.hasOwn(content, 'sessionOrder'), true);
    const result = validateContent(content); assert.equal(result.valid, false, String(value)); assert.ok(result.errors.sessionOrder);
  }
  let getters = 0;
  for (const descriptor of [{ value: 'manual', enumerable: false }, { get() { getters++; return 'manual'; }, enumerable: true }]) {
    const content = legacyContent(); Object.defineProperty(content, 'sessionOrder', descriptor);
    assert.equal(validateContent(content).valid, false); assert.throws(() => toPublicContent(content), TypeError);
  }
  assert.equal(getters, 0);
});

for (const mode of ['file', 'cloud']) {
  test(`${mode} legacy frozen content remains absent and byte-stable through reads, restart and legacy saves`, async t => {
    const f = await fixture(mode, t), store = f.build(), published = await store.publish(0, ACTOR), before = await f.bytes();
    assert.equal(Object.hasOwn(published.content, 'sessionOrder'), false);
    const restarted = f.build(), read = await restarted.read();
    assert.deepEqual(read.published, published); assert.equal(Object.hasOwn(read.draft.content, 'sessionOrder'), false); assert.equal(await f.bytes(), before);
    const input = structuredClone(read.draft.content); input.event.title = '合成旧客户端修改'; const unchangedInput = structuredClone(input);
    const saved = await restarted.save(0, input, ACTOR); assert.equal(saved.revision, 1);
    assert.equal(Object.hasOwn(saved.content, 'sessionOrder'), false); assert.deepEqual(input, unchangedInput);
    assert.deepEqual((await f.build().read()).published, published, 'draft edits never rewrite a frozen public snapshot');
    const nextPublic = await restarted.publish(1, ACTOR); assert.equal(Object.hasOwn(nextPublic.content, 'sessionOrder'), false);
  });

  test(`${mode} an old client omission preserves manual while explicit time changes only the new draft until publication`, async t => {
    const f = await fixture(mode, t), store = f.build(), first = await store.save(0, { ...legacyContent(), sessionOrder: 'manual' }, ACTOR);
    const frozen = await store.publish(1, ACTOR), oldClient = structuredClone(first.content); delete oldClient.sessionOrder;
    oldClient.event.title = '合成旧客户端编辑保留手动排序'; const before = structuredClone(oldClient);
    const saved = await store.save(1, oldClient, ACTOR); assert.equal(saved.content.sessionOrder, 'manual'); assert.deepEqual(oldClient, before);
    assert.equal((await f.build().read()).draft.content.sessionOrder, 'manual'); assert.deepEqual((await f.build().read()).published, frozen);
    const explicit = { ...saved.content, sessionOrder: 'time' }, changed = await f.build().save(2, explicit, ACTOR);
    assert.equal(changed.content.sessionOrder, 'time'); assert.deepEqual(changed.content.sessions.map(row => row.id), ['synthetic-late', 'synthetic-early']);
    assert.equal((await f.build().read()).draft.content.sessionOrder, 'time'); assert.deepEqual((await f.build().read()).published, frozen);
    const published = await f.build().publish(3, ACTOR); assert.equal(published.content.sessionOrder, 'time'); assert.deepEqual((await f.build().read()).published, published);
    const absentAgain = structuredClone(changed.content); delete absentAgain.sessionOrder;
    assert.equal((await f.build().save(3, absentAgain, ACTOR)).content.sessionOrder, 'time', 'omission also preserves an explicit stored time mode');
  });

  test(`${mode} invalid sessionOrder including own undefined fails 422 before writes, guards, revision or audit changes`, async t => {
    const f = await fixture(mode, t), store = f.build(), saved = await store.save(0, { ...legacyContent(), sessionOrder: 'manual' }, ACTOR);
    const before = await f.bytes(), snapshot = await f.build().read(); let guarded = 0;
    for (const value of invalidValues) {
      const input = { ...saved.content, sessionOrder: value };
      await assert.rejects(store.save(1, input, ACTOR, { beforeCommit() { guarded++; } }), error => error.code === 'VALIDATION_ERROR' && error.status === 422 && Boolean(error.fields?.sessionOrder));
      assert.equal(await f.bytes(), before, 'invalid values must leave the entire stored state and audit bytes unchanged');
      assert.deepEqual(await f.build().read(), snapshot); assert.equal(snapshot.draft.revision, 1);
    }
    assert.equal(guarded, 0, 'invalid ordering never reaches the mutation guard or a commit');
  });

  test(`${mode} authenticated content HTTP API preserves omission, exposes published mode and rejects invalid JSON values without writes`, async t => {
    const f = await fixture(mode, t), api = await apiFixture(mode, f), initial = await responseJson(await request(api, '/api/admin/content'));
    assert.equal(Object.hasOwn(initial.draft.content, 'sessionOrder'), false);
    const manual = await responseJson(await request(api, '/api/admin/content', 'PUT', { expectedRevision: 0, content: { ...initial.draft.content, sessionOrder: 'manual' } }));
    assert.equal(manual.draft.content.sessionOrder, 'manual'); const before = await f.bytes();
    // Own undefined cannot be represented in JSON; its strict rejection is
    // exercised directly against both stores above, distinct from omission.
    for (const value of invalidValues.filter(value => value !== undefined)) {
      const response = await request(api, '/api/admin/content', 'PUT', { expectedRevision: 1, content: { ...manual.draft.content, sessionOrder: value } });
      const body = await responseJson(response, 422); assert.equal(body.error.code, 'VALIDATION_ERROR'); assert.ok(body.error.fields?.sessionOrder);
      assert.equal(await f.bytes(), before); assert.equal((await f.build().read()).draft.revision, 1);
    }
    const oldClient = structuredClone(manual.draft.content); delete oldClient.sessionOrder;
    const preserved = await responseJson(await request(api, '/api/admin/content', 'PUT', { expectedRevision: 1, content: oldClient }));
    assert.equal(preserved.draft.content.sessionOrder, 'manual');
    await responseJson(await request(api, '/api/admin/content/publish', 'POST', { expectedRevision: 2 }));
    const manualPublic = await responseJson(await request(api, '/api/public/content')); assert.equal(manualPublic.content.sessionOrder, 'manual');
    const time = await responseJson(await request(api, '/api/admin/content', 'PUT', { expectedRevision: 2, content: { ...preserved.draft.content, sessionOrder: 'time' } }));
    assert.equal(time.draft.content.sessionOrder, 'time'); assert.deepEqual(await responseJson(await request(api, '/api/public/content')), manualPublic);
    await responseJson(await request(api, '/api/admin/content/publish', 'POST', { expectedRevision: 3 }));
    assert.equal((await responseJson(await request(api, '/api/public/content'))).content.sessionOrder, 'time');
  });
}
