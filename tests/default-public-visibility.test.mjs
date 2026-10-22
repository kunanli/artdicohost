import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInitialContent } from '../src/config/content.mjs';
import { validateContent, toPublicContent, isContentVisible } from '../shared/content-schema.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { contentPublicationReadiness } from '../src/lib/admin-save-state.mjs';

const AT = '2026-10-22T00:00:00.000Z', actor = 'synthetic-editor';
const collections = ['guests', 'organizations', 'showcases', 'booths'];
function fixture() {
  const content = createInitialContent();
  content.sessions = [];
  content.guests = [{ id: 'synthetic-guest', name: '合成嘉宾', company: '', ggjRole: '', portraitId: '', status: 'pending', publicConsent: false, contactId: 'private-contact', internalNotes: 'PRIVATE-GUEST' }];
  content.organizations = [{ id: 'synthetic-organization', name: '合成组织', logoId: '', website: '', participation: 'undecided', status: 'pending', publicConsent: false, internalNotes: 'PRIVATE-ORGANIZATION' }];
  content.showcases = [{ id: 'synthetic-work', title: '合成作品', teamName: '', school: 'PRIVATE-SCHOOL', contactName: 'PRIVATE-CONTACT', email: 'private@example.invalid', wechat: 'PRIVATE-WECHAT', memberCount: 3, participationForms: [], responseStatus: 'pending', materialLinks: 'https://example.invalid/PRIVATE-MATERIAL', summary: '', coverId: '', status: 'pending', publicConsent: false, sessionId: '', boothId: '', internalNotes: 'PRIVATE-WORK', organizationId: 'synthetic-organization' }];
  content.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '', project: '', zone: 'C', status: 'pending', slotNumber: 1, contactName: 'PRIVATE-BOOTH-CONTACT', contactMethods: 'private@example.invalid', internalNotes: 'PRIVATE-BOOTH' }];
  assert.deepEqual(validateContent(content).errors, {});
  return content;
}
function journal(initial = null) {
  let value = structuredClone(initial), version = initial ? 1 : 0;
  const cursor = () => ({ position: version, version, hash: version ? 'a'.repeat(64) : null });
  return {
    read: async () => structuredClone({ value, cursor: cursor() }),
    commit: async (expected, next) => {
      assert.deepEqual(expected, cursor());
      value = structuredClone(next); version++;
      return structuredClone({ value, cursor: cursor() });
    },
    snapshot: () => structuredClone(value),
  };
}
async function stores(t, initialContent = fixture(), state = null) {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-public-visibility-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  if (state) await writeFile(join(directory, 'content.json'), JSON.stringify(state));
  const remoteJournal = journal(state), file = () => createFileContentStore({ directory, initialContent, now: () => Date.parse(AT) }),
    cloud = () => createOssContentStore({ journal: remoteJournal, initialContent, now: () => Date.parse(AT) });
  return [{ name: 'file', create: file }, { name: 'cloud', create: cloud, journal: remoteJournal }];
}

test('absent visibility defaults public without backfilling fields or falsifying pending facts', () => {
  const content = fixture(), before = structuredClone(content), normalized = validateContent(content).value, projected = toPublicContent(content);
  for (const kind of collections) {
    assert.equal(isContentVisible(normalized[kind][0]), true);
    assert.equal(Object.hasOwn(normalized[kind][0], 'visibility'), false);
    assert.equal(projected[kind].length, 1);
    assert.equal(projected[kind][0].status, 'pending');
    assert.equal(Object.hasOwn(projected[kind][0], 'visibility'), false);
  }
  assert.equal(projected.showcases[0].responseStatus, 'pending');
  for (const kind of ['guests','organizations','showcases']) assert.equal(projected[kind][0].publicConsent, false);
  assert.equal(projected.guests[0].portraitUrl, ''); assert.equal(projected.showcases[0].coverUrl, '');
  assert.deepEqual(toPublicContent(projected), projected);
  assert.deepEqual(content, before);
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE-|private@example|private-contact|internalNotes|contactMethods|materialLinks|memberCount|school|wechat/u);
});

test('only explicit private hides a record, and its links disappear from the same public snapshot', () => {
  const content = fixture(); content.organizations[0].visibility = 'private';
  let projected = toPublicContent(content);
  assert.equal(projected.organizations.length, 0); assert.equal(Object.hasOwn(projected.showcases[0], 'organizationId'), false);
  for (const kind of collections) content[kind][0].visibility = 'private';
  projected = toPublicContent(content);
  for (const kind of collections) assert.deepEqual(projected[kind], []);
  for (const kind of collections) content[kind][0].visibility = 'public';
  projected = toPublicContent(content);
  for (const kind of collections) assert.equal(projected[kind][0].visibility, 'public');
  assert.deepEqual(toPublicContent(projected), projected);
});

test('visibility is an exact own enumerable enum, never a truthy value or accessor', () => {
  for (const kind of collections) {
    for (const value of ['', null, undefined, false, true, 'PUBLIC', ' public ', 'private\n', {}]) {
      const content = fixture(); content[kind][0].visibility = value;
      assert.ok(validateContent(content).errors[`${kind}.0.visibility`], `${kind}:${String(value)}`);
    }
    for (const enumerable of [true, false]) {
      const content = fixture();
      Object.defineProperty(content[kind][0], 'visibility', { enumerable, get() { assert.fail('visibility getter must not execute'); } });
      assert.ok(validateContent(content).errors[`${kind}.0.visibility`]);
    }
  }
});

test('both stores retain explicit opt-out across older client omissions and require a save before changing it', async t => {
  for (const { name, create } of await stores(t)) {
    let store = create(), content = fixture();
    for (const kind of collections) content[kind][0].visibility = 'private';
    await store.save(0, content, actor);
    await store.publish(1, actor);
    const staleClient = structuredClone((await store.read()).draft.content);
    for (const kind of collections) { delete staleClient[kind][0].visibility; staleClient[kind][0].id = ' ' + staleClient[kind][0].id + ' '; }
    await store.save(1, staleClient, actor);
    store = create();
    const read = await store.read();
    for (const kind of collections) assert.equal(read.draft.content[kind][0].visibility, 'private', name + ':' + kind);
    for (const kind of collections) assert.equal(read.published.content[kind].length, 0);
    for (const kind of collections) read.draft.content[kind][0].visibility = 'public';
    await store.save(2, read.draft.content, actor);
    for (const kind of collections) assert.equal((await create().read()).published.content[kind].length, 0, 'save is not publish');
    await store.publish(3, actor);
    for (const kind of collections) assert.equal((await create().read()).published.content[kind].length, 1);
  }
});

test('both stores preserve absent optional fields through legacy saves and restart', async t => {
  for (const { create } of await stores(t)) {
    const saved = await create().save(0, fixture(), actor);
    for (const kind of collections) assert.equal(Object.hasOwn(saved.content[kind][0], 'visibility'), false);
    const published = await create().publish(1, actor);
    assert.deepEqual((await create().read()).published, published);
    for (const kind of collections) assert.equal(Object.hasOwn((await create().read()).draft.content[kind][0], 'visibility'), false);
  }
});

test('frozen legacy publication stays unchanged when policy changes at the same draft revision', async t => {
  const content = fixture(), oldContent = toPublicContent(content, { legacyVisibility: true }),
    state = { storageVersion: 1, draft: { revision: 1, content }, published: { revision: 1, publishedAt: AT, content: oldContent },
      audit: [{ action: 'save_draft', actorId: actor, revision: 1, at: AT }, { action: 'publish', actorId: actor, revision: 1, at: AT }] };
  const report = contentPublicationReadiness({ draft: state.draft, published: state.published });
  assert.ok(report); assert.equal(report.hasPublicChanges, true);
  for (const kind of collections) { assert.equal(report.items[kind][0].ready, true); assert.equal(report.items[kind][0].published, false); assert.equal(report.items[kind][0].change, 'new'); }
  for (const { create } of await stores(t, content, state)) {
    const initial = await create().read(); assert.deepEqual(initial.published.content, oldContent);
    await assert.rejects(create().publish(1, actor), error => error.code === 'PUBLICATION_SAVE_REQUIRED' && error.status === 409);
    assert.deepEqual((await create().read()).published, initial.published);
    await create().save(1, initial.draft.content, actor);
    const next = await create().publish(2, actor);
    assert.equal(next.revision, 2);
    for (const kind of collections) assert.equal(next.content[kind].length, 1);
  }
});

test('manual hidden state remains separate from an older live publication', () => {
  const content = fixture(), published = { revision: 1, publishedAt: AT, content: toPublicContent(content) };
  for (const kind of collections) content[kind][0].visibility = 'private';
  const report = contentPublicationReadiness({ draft: { revision: 2, content }, published });
  for (const kind of collections) {
    const item = report.items[kind][0];
    assert.equal(item.visibility, 'private'); assert.equal(item.visible, false); assert.equal(item.published, true);
    assert.equal(item.change, 'removed'); assert.deepEqual(item.reasons, ['visibility_private']);
  }
});


test('pending default-public images are readable only after publication, and manual hiding removes their routes', async () => {
  const content = fixture(), images = ['a','b','c'].map(letter => letter.repeat(64) + '.png');
  content.guests[0].portraitId = images[0]; content.organizations[0].logoId = images[1]; content.showcases[0].coverId = images[2];
  let published = null, imageReads = 0;
  const unused = () => assert.fail('Public image reads must not authenticate or mutate');
  const store = { read: async () => ({ draft: { revision: 1, content }, published }), save: unused, publish: unused, recordPortraitUpload: unused };
  const portraitStore = { read: async id => { imageReads++; assert.ok(images.includes(id)); const data = Buffer.from('SYNTHETIC-IMAGE'); return { id, data, contentType: 'image/png', bytes: data.length }; }, upload: unused };
  const users = [{ id: actor, username: actor, label: 'Synthetic', roles: ['editor'], passwordHash: 'scrypt$16384$8$1$' + 'a'.repeat(22) + '$' + 'a'.repeat(86) }];
  const apis = [
    { origin: 'http://127.0.0.1:8888', handle: createContentApi({ store, portraitStore, users, allowedOrigin: 'http://127.0.0.1:8888' }) },
    { origin: 'https://api.artdico.host', handle: createCloudContentApi({ enabled: true, store, portraitStore, auth: { login: unused, logout: unused, authenticate: unused } }) },
  ];
  for (const { origin, handle } of apis) for (const id of images) assert.equal((await handle(new Request(origin + '/api/public/portraits/' + id))).status, 404);
  assert.equal(imageReads, 0);
  published = { revision: 1, publishedAt: AT, content: toPublicContent(content) };
  for (const { origin, handle } of apis) for (const id of images) assert.equal((await handle(new Request(origin + '/api/public/portraits/' + id))).status, 200);
  assert.equal(imageReads, 6);
  for (const kind of collections) content[kind][0].visibility = 'private';
  published = { revision: 2, publishedAt: AT, content: toPublicContent(content) };
  for (const { origin, handle } of apis) for (const id of images) assert.equal((await handle(new Request(origin + '/api/public/portraits/' + id))).status, 404);
  assert.equal(imageReads, 6);
});
