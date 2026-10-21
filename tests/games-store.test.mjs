import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialContent } from '../src/config/content.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const now = () => Date.parse('2026-10-21T16:00:00.000Z');
const coverId = 'b'.repeat(64) + '.png';
function content() {
  const value = createInitialContent(); value.sessions = [];
  value.guests = [{ id: 'synthetic-guest', name: '合成嘉宾', company: '合成机构', ggjRole: '', portraitId: '', status: 'confirmed', publicConsent: true, internalNotes: '' }];
  value.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '合成展位占用组织', project: '合成作品', zone: 'C', status: 'confirmed', slotNumber: 1, internalNotes: '' }];
  value.organizations = [{ id: 'synthetic-organization', name: '合成作品创作者组织', logoId: '', website: '', participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: '' }];
  value.showcases = [{ id: 'synthetic-work', title: '合成作品', teamName: '合成团队', school: '', contactName: 'PRIVATE-CONTACT', email: 'private@example.invalid',
    wechat: 'PRIVATE-WECHAT', memberCount: 3, participationForms: ['booth'], responseStatus: 'attending', materialLinks: '', summary: '合成作品简介', coverId,
    status: 'confirmed', publicConsent: true, sessionId: '', boothId: 'synthetic-booth', internalNotes: 'PRIVATE-NOTE' }];
  return value;
}
const failure = (code = 'VALIDATION_ERROR', status = 422) => error => error.code === code && error.status === status;
async function fixture(mode, t, { seed = content(), persistedSeed = true } = {}) {
  const checkedImages = [], portraitStore = { async verify(id) { checkedImages.push(id); assert.equal(id, coverId); return { id, bytes: 1 }; } };
  const state = { storageVersion: 1, draft: { revision: 0, content: seed }, published: null, audit: [] };
  if (mode === 'file') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-games-synthetic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    if (persistedSeed) await writeFile(join(directory, 'content.json'), JSON.stringify(state));
    const build = () => createFileContentStore({ directory, portraitStore, initialContent: seed, now });
    return { first: build(), second: build(), checkedImages, persisted: () => readFile(join(directory, 'content.json'), 'utf8') };
  }
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  if (persistedSeed) await journal.commit((await journal.read()).cursor, state);
  const build = () => createOssContentStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }), portraitStore, initialContent: seed, now });
  return { first: build(), second: build(), checkedImages, objects, journal,
    persisted: async () => JSON.stringify([...objects.files].map(([key, item]) => [key, item.data.toString('base64')])) };
}

for (const mode of ['file', 'cloud']) {
  test(`${mode} reads old work snapshots without adding category or relationship fields or rewriting bytes`, async t => {
    const { first, second, persisted } = await fixture(mode, t), before = await persisted();
    for (const store of [first, second]) {
      const state = await store.read(); assert.equal(state.draft.revision, 0);
      assert.equal(Object.hasOwn(state.draft.content.showcases[0], 'kind'), false);
      assert.equal(Object.hasOwn(state.draft.content.showcases[0], 'organizationId'), false);
    }
    assert.equal(await persisted(), before);
  });

  test(`${mode} old writers preserve known work metadata by stable ID, explicit unlink clears, and unrelated unknown fields stay dropped`, async t => {
    const { first, second, checkedImages } = await fixture(mode, t);
    const input = (await first.read()).draft.content;
    Object.assign(input.showcases[0], { kind: 'indie', organizationId: 'synthetic-organization', untrusted: 'PRIVATE-UNKNOWN' });
    const saved = await first.save(0, input, 'synthetic');
    assert.equal(saved.content.showcases[0].kind, 'indie'); assert.equal(Object.hasOwn(saved.content.showcases[0], 'untrusted'), false);
    const legacy = structuredClone(saved.content); delete legacy.showcases[0].kind; delete legacy.showcases[0].organizationId;
    legacy.showcases[0].id = ' synthetic-work '; legacy.showcases[0].summary = '合成旧客户端更新';
    legacy.showcases.push({ ...legacy.showcases[0], id: 'synthetic-other-work', title: '合成第二件作品' });
    const untouched = structuredClone(legacy), again = await second.save(1, legacy, 'synthetic');
    assert.deepEqual(legacy, untouched);
    const old = again.content.showcases.find(item => item.id === 'synthetic-work'), added = again.content.showcases.find(item => item.id === 'synthetic-other-work');
    assert.equal(old.kind, 'indie'); assert.equal(old.organizationId, 'synthetic-organization');
    assert.equal(Object.hasOwn(added, 'kind'), false); assert.equal(Object.hasOwn(added, 'organizationId'), false);
    old.organizationId = ''; old.kind = 'team';
    const cleared = await first.save(2, again.content, 'synthetic');
    assert.equal(cleared.content.showcases[0].organizationId, ''); assert.equal(cleared.content.showcases[0].kind, 'team');
    const publicState = await second.publish(3, 'synthetic');
    assert.equal(publicState.content.showcases.length, 2); // Multiple works legitimately share the one booth.
    assert.equal(Object.hasOwn(publicState.content.showcases[0], 'organizationId'), false);
    assert.deepEqual(publicState.content.guests.map(item => [item.portraitId, item.portraitUrl]), [['', '']]);
    assert.ok(checkedImages.length > 0); assert.ok(checkedImages.every(id => id === coverId));
    assert.deepEqual((await first.read()).published, publicState);
    assert.equal(JSON.stringify(publicState).includes('PRIVATE-'), false);
  });

  test(`${mode} changed/new organization links reject absent IDs while historical orphan links survive and can be cleared`, async t => {
    const seed = content(); seed.showcases[0].kind = 'student'; seed.showcases[0].organizationId = 'historical-orphan';
    const { first, second, persisted } = await fixture(mode, t, { seed });
    const initial = (await first.read()).draft.content, before = await persisted();
    for (const change of [
      input => { input.showcases[0].organizationId = 'new-orphan'; },
      input => { input.showcases.push({ ...input.showcases[0], id: 'synthetic-new-work' }); },
    ]) {
      const invalid = structuredClone(initial); change(invalid);
      await assert.rejects(first.save(0, invalid, 'synthetic'), failure());
      assert.equal(await persisted(), before);
    }
    initial.event.title += '合成更新'; delete initial.showcases[0].organizationId;
    const saved = await second.save(0, initial, 'synthetic');
    assert.equal(saved.content.showcases[0].organizationId, 'historical-orphan');
    assert.equal(Object.hasOwn((await first.publish(1, 'synthetic')).content.showcases[0], 'organizationId'), false);
    saved.content.showcases[0].organizationId = 'synthetic-organization';
    const linked = await first.save(1, saved.content, 'synthetic');
    assert.equal((await second.publish(2, 'synthetic')).content.showcases[0].organizationId, 'synthetic-organization');
    linked.content.organizations = []; // Removing an organization retains its unchanged private work relationship.
    const orphan = await second.save(2, linked.content, 'synthetic');
    assert.equal(orphan.content.showcases[0].organizationId, 'synthetic-organization');
    assert.equal(Object.hasOwn((await first.publish(3, 'synthetic')).content.showcases[0], 'organizationId'), false);
    orphan.content.showcases[0].organizationId = '';
    assert.equal((await first.save(3, orphan.content, 'synthetic')).content.showcases[0].organizationId, '');
  });

  test(`${mode} explicit malformed optional values, getters and incomplete work collections fail before commit`, async t => {
    const seed = content(); Object.assign(seed.showcases[0], { kind: 'team', organizationId: 'synthetic-organization' });
    const { first, persisted } = await fixture(mode, t, { seed }), before = await persisted();
    const changes = [input => { delete input.showcases; }];
    for (const [field, values] of [['kind', [null, undefined, '', 'unknown']], ['organizationId', [null, undefined, 1, '../org']]]) {
      for (const value of values) changes.push(input => { input.showcases[0][field] = value; });
      for (const enumerable of [true, false]) changes.push(input => { Object.defineProperty(input.showcases[0], field, { enumerable, get() { assert.fail('Work getters must not execute'); } }); });
      changes.push(input => { Object.defineProperty(input.showcases[0], field, { enumerable: false, value: null }); });
    }
    for (const change of changes) {
      const input = structuredClone(seed); change(input);
      await assert.rejects(first.save(0, input, 'synthetic'), failure());
      assert.equal(await persisted(), before);
    }
  });

  test(`${mode} competing work edits have one revision winner and preserve the full winning optional metadata`, async t => {
    const { first, second } = await fixture(mode, t), left = (await first.read()).draft.content, right = structuredClone(left);
    Object.assign(left.showcases[0], { kind: 'indie', organizationId: 'synthetic-organization' });
    Object.assign(right.showcases[0], { kind: 'team', organizationId: '' });
    const outcomes = await Promise.allSettled([first.save(0, left, 'synthetic-left'), second.save(0, right, 'synthetic-right')]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
    const actual = (await second.read()).draft;
    assert.deepEqual(actual, outcomes.find(item => item.status === 'fulfilled').value);
    assert.equal(actual.revision, 1);
  });
}

test('a lost cloud save acknowledgement does not claim success, and restart retains the committed work metadata exactly', async t => {
  const { first, objects } = await fixture('cloud', t), input = (await first.read()).draft.content;
  Object.assign(input.showcases[0], { kind: 'indie', organizationId: 'synthetic-organization' });
  const journal = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  const ambiguous = createOssContentStore({ initialContent: content(), now, portraitStore: { verify: async id => ({ id, bytes: 1 }) },
    journal: { read: () => journal.read(), async commit(...args) { await journal.commit(...args); throw new Error('SYNTHETIC-LOST-ACK'); } } });
  await assert.rejects(ambiguous.save(0, input, 'synthetic'), failure('STORAGE_ERROR', 503));
  const actual = (await first.read()).draft;
  assert.equal(actual.revision, 1); assert.equal(actual.content.showcases[0].kind, 'indie');
  assert.equal(actual.content.showcases[0].organizationId, 'synthetic-organization');
  await assert.rejects(first.save(0, input, 'synthetic'), failure('REVISION_CONFLICT', 409));
  assert.deepEqual((await first.read()).draft, actual);
});
