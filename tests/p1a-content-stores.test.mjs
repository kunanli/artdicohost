import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createInitialContent } from '../src/config/content.mjs';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { publicContentEnvelope } from '../src/lib/public-content-refresh.mjs';

const clock = () => Date.parse('2026-11-01T06:00:00.000Z');
const work = patch => ({ id: 'synthetic-work', title: '合成作品', teamName: '合成团队', school: '', contactName: '', email: '', wechat: '',
  memberCount: 1, participationForms: [], responseStatus: 'pending', materialLinks: '', summary: '', coverId: '', status: 'pending',
  publicConsent: false, sessionId: '', boothId: '', internalNotes: '', ...patch });
const booth = (id, slotNumber, patch = {}) => ({ id, slotNumber, code: 'C-' + slotNumber, organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '',
  contactName: 'PRIVATE-SYNTHETIC', contactMethods: 'private@example.invalid', ...patch });
const invalid = error => error.code === 'VALIDATION_ERROR' && error.status === 422;

async function fixture(mode, t, initialContent) {
  if (mode === 'file') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-p1a-synthetic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    return { build: () => createFileContentStore({ directory, initialContent, now: clock }),
      bytes: async () => readFile(join(directory, 'content.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; }) };
  }
  const objects = memoryObjects();
  return { build: () => createOssContentStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }), initialContent, now: clock }),
    bytes: async () => JSON.stringify([...objects.files].map(([key, value]) => [key, value.data.toString('base64')])) };
}

for (const mode of ['file', 'cloud']) {
  test(`${mode} frozen legacy team publication remains readable without rewriting history`, async t => {
    const initial = createInitialContent(); initial.showcases = [work({ kind: 'team' })];
    const f = await fixture(mode, t, initial), store = f.build();
    const published = await store.publish(0, 'synthetic');
    const before = await f.bytes();
    assert.equal(published.content.showcases[0].kind, 'team');
    assert.ok(publicContentEnvelope(published));
    assert.deepEqual((await f.build().read()).published, published);
    assert.equal(await f.bytes(), before, 'read and public validation must not migrate the frozen snapshot');
    const input = (await store.read()).draft.content; delete input.showcases[0].kind;
    input.showcases[0].summary = '合成旧客户端修改'; const untouched = structuredClone(input);
    const saved = await store.save(0, input, 'synthetic');
    assert.deepEqual(input, untouched);
    assert.equal(saved.content.showcases[0].kind, 'team');
    assert.deepEqual((await f.build().read()).published, published, 'saving other fields cannot rewrite the existing publication');
    saved.content.showcases[0].kind = 'student';
    const classified = await store.save(1, saved.content, 'synthetic');
    assert.equal(classified.content.showcases[0].kind, 'student');
    assert.equal((await store.publish(2, 'synthetic')).content.showcases[0].kind, 'student');
  });

  test(`${mode} retired category cannot be added, copied or reintroduced and rejected edits have no writes`, async t => {
    const initial = createInitialContent(); initial.showcases = [work({ kind: 'indie' }), work({ id: 'legacy-team', kind: 'team' })];
    const f = await fixture(mode, t, initial), store = f.build(), before = await f.bytes();
    for (const edit of [
      content => { content.showcases[0].kind = 'team'; },
      content => { content.showcases.push(work({ id: 'new-team', kind: 'team' })); },
      content => { content.showcases.push({ ...content.showcases[1], id: 'copied-team' }); },
    ]) {
      const input = (await store.read()).draft.content; edit(input);
      await assert.rejects(store.save(0, input, 'synthetic'), invalid);
      assert.equal((await store.read()).draft.revision, 0);
      assert.equal(await f.bytes(), before);
    }
    const input = (await store.read()).draft.content;
    input.showcases[1].kind = 'indie'; const saved = await store.save(0, input, 'synthetic');
    saved.content.showcases[1].kind = 'team';
    await assert.rejects(store.save(1, saved.content, 'synthetic'), invalid);
  });

  test(`${mode} missing category remains the original student-shaped record for older clients`, async t => {
    const initial = createInitialContent(), f = await fixture(mode, t, initial), store = f.build();
    const input = (await store.read()).draft.content; input.showcases = [work()];
    const saved = await store.save(0, input, 'synthetic');
    assert.equal(Object.hasOwn(saved.content.showcases[0], 'kind'), false);
    const published = await store.publish(1, 'synthetic');
    assert.equal(Object.hasOwn(published.content.showcases[0], 'kind'), false);
    assert.ok(publicContentEnvelope(published));
    assert.deepEqual((await f.build().read()).published, published);
  });

  test(`${mode} positions beyond fifteen persist and publish while duplicate occupancy remains rejected`, async t => {
    const initial = createInitialContent(), f = await fixture(mode, t, initial), store = f.build();
    const input = (await store.read()).draft.content;
    input.booths = [booth('synthetic-16', 16), booth('synthetic-200', 200)];
    const saved = await store.save(0, input, 'synthetic');
    const published = await store.publish(1, 'synthetic');
    assert.deepEqual(published.content.booths.map(item => item.slotNumber), [16, 200]);
    assert.equal(JSON.stringify(published).includes('PRIVATE-SYNTHETIC'), false);
    assert.equal(JSON.stringify(published).includes('private@example.invalid'), false);
    assert.ok(publicContentEnvelope(published));
    assert.deepEqual((await f.build().read()).published, published);
    const before = await f.bytes();
    const duplicate = structuredClone(saved.content); duplicate.booths.push(booth('synthetic-conflict', 16, { code: 'CONFLICT' }));
    await assert.rejects(store.save(1, duplicate, 'synthetic'), invalid);
    const oversized = structuredClone(saved.content); oversized.booths[0].slotNumber = 201;
    await assert.rejects(store.save(1, oversized, 'synthetic'), invalid);
    assert.equal(await f.bytes(), before);
    saved.content.booths[0].status = 'cancelled';
    saved.content.booths.push(booth('synthetic-replacement', 16, { code: 'C-16-NEW' }));
    assert.equal((await store.save(1, saved.content, 'synthetic')).content.booths.length, 3);
  });
}
