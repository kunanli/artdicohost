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

const AT = '2026-10-20T09:00:00.000Z', now = () => Date.parse(AT);
function content() {
  const value = createInitialContent();
  value.sessions = [{ id: 'synthetic-session', start: '10:00', end: '10:30', zone: 'A', title: '合成演讲', format: 'talk', guestId: '', speakerName: '', speakerStatus: 'pending', status: 'scheduled', internalNotes: '' }];
  value.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '合成机构', project: '合成作品', zone: 'C', status: 'pending', slotNumber: 4, internalNotes: '' }];
  value.guests = []; value.showcases = [];
  return value;
}
const failure = (code, status = 422) => error => error.code === code && error.status === status;
async function fixture(mode, t, { legacy = false, seed = content() } = {}) {
  if (mode === 'local') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-arrangement-synthetic-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    if (legacy) await writeFile(join(directory, 'content.json'), JSON.stringify({ storageVersion: 1, draft: { revision: 0, content: seed }, published: null, audit: [] }));
    const build = () => createFileContentStore({ directory, initialContent: seed, now });
    return { first: build(), second: build(), persisted: () => readFile(join(directory, 'content.json'), 'utf8') };
  }
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  if (legacy) await journal.commit((await journal.read()).cursor, { storageVersion: 1, draft: { revision: 0, content: seed }, published: null, audit: [] });
  const build = () => createOssContentStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/content' }), initialContent: seed, now });
  return { first: build(), second: build(), persisted: async () => JSON.stringify([...objects.files].map(([key, item]) => [key, item.data.toString('base64')])) };
}

for (const mode of ['local', 'cloud']) {
  test(`${mode} old stored records normalize to unclassified and unassigned without rewriting storage`, async t => {
    const legacy = content(); delete legacy.sessions[0].format; delete legacy.booths[0].slotNumber;
    const { first, second, persisted } = await fixture(mode, t, { legacy: true, seed: legacy });
    const before = await persisted();
    for (const store of [first, second]) {
      const read = await store.read();
      assert.equal(read.draft.revision, 0); assert.equal(read.draft.content.sessions[0].format, 'other');
      assert.equal(read.draft.content.booths[0].slotNumber, 0);
    }
    assert.equal(await persisted(), before);
  });

  test(`${mode} old clients preserve saved arrangements by stable ID while new records receive schema defaults`, async t => {
    const { first, second } = await fixture(mode, t);
    const current = (await first.read()).draft.content, input = structuredClone(current);
    delete input.sessions[0].format; delete input.booths[0].slotNumber;
    input.sessions[0].id = ' synthetic-session '; // Match the schema's stable-ID normalization.
    input.sessions.push({ ...input.sessions[0], id: 'synthetic-new-session', start: '10:30', end: '11:00', title: '合成未分类场次' });
    input.booths.unshift({ ...input.booths[0], id: 'synthetic-new-booth', code: 'C02' });
    const originalInput = structuredClone(input), saved = await first.save(0, input, 'synthetic');
    assert.equal(saved.content.sessions.find(item => item.id === 'synthetic-session').format, 'talk');
    assert.equal(saved.content.sessions.find(item => item.id === 'synthetic-new-session').format, 'other');
    assert.equal(saved.content.booths.find(item => item.id === 'synthetic-booth').slotNumber, 4);
    assert.equal(saved.content.booths.find(item => item.id === 'synthetic-new-booth').slotNumber, 0);
    assert.deepEqual(input, originalInput);
    const undefinedFields = structuredClone(saved.content);
    undefinedFields.sessions[0].format = undefined; undefinedFields.booths.find(item => item.id === 'synthetic-booth').slotNumber = undefined;
    const next = await second.save(1, undefinedFields, 'synthetic');
    assert.equal(next.content.sessions[0].format, 'talk');
    assert.equal(next.content.booths.find(item => item.id === 'synthetic-booth').slotNumber, 4);
    for (const mutate of [
      value => { value.sessions[0] = Object.assign(Object.create({ format: 'other' }), value.sessions[0]); delete value.sessions[0].format; },
      value => { Object.defineProperty(value.booths[0], 'slotNumber', { enumerable: true, get() { assert.fail('arrangement getters must not run'); } }); },
    ]) {
      const invalid = structuredClone(next.content); mutate(invalid);
      await assert.rejects(first.save(2, invalid, 'synthetic'), failure('VALIDATION_ERROR'));
      assert.equal((await first.read()).draft.revision, 2);
    }
  });

  test(`${mode} only explicit reset values clear arrangements and duplicate active slots leave the revision intact`, async t => {
    const { first, second } = await fixture(mode, t);
    let draft = (await first.read()).draft.content;
    draft.sessions[0].format = 'other'; draft.booths[0].slotNumber = 0;
    const cleared = await first.save(0, draft, 'synthetic');
    assert.equal(cleared.content.sessions[0].format, 'other'); assert.equal(cleared.content.booths[0].slotNumber, 0);
    draft = structuredClone(cleared.content); draft.booths[0].slotNumber = 15;
    draft.booths.push({ ...draft.booths[0], id: 'synthetic-competing-booth', code: 'C02', status: 'confirmed' });
    await assert.rejects(second.save(1, draft, 'synthetic'), failure('VALIDATION_ERROR'));
    assert.equal((await first.read()).draft.revision, 1);
    assert.equal((await first.read()).draft.content.booths.length, 1);
    draft.booths[0].status = 'cancelled';
    const reused = await first.save(1, draft, 'synthetic');
    assert.equal(reused.content.booths.filter(item => item.status !== 'cancelled' && item.slotNumber === 15).length, 1);
    for (const slotNumber of [null, -1, 16, 1.5, '4']) {
      const invalid = structuredClone(reused.content); invalid.booths[1].slotNumber = slotNumber;
      await assert.rejects(second.save(2, invalid, 'synthetic'), failure('VALIDATION_ERROR'));
    }
    assert.equal((await second.read()).draft.revision, 2);
  });

  test(`${mode} independent editors competing for one free position have one revision winner`, async t => {
    const seed = content(); seed.booths[0].slotNumber = 0;
    seed.booths.push({ ...seed.booths[0], id: 'synthetic-other-booth', code: 'C02' });
    const { first, second } = await fixture(mode, t, { seed });
    const left = (await first.read()).draft.content, right = structuredClone(left);
    left.booths[0].slotNumber = 7; right.booths[1].slotNumber = 7;
    const outcomes = await Promise.allSettled([first.save(0, left, 'left'), second.save(0, right, 'right')]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
    const actual = (await first.read()).draft;
    assert.equal(actual.revision, 1); assert.equal(actual.content.booths.filter(item => item.slotNumber === 7).length, 1);
    assert.deepEqual(actual, outcomes.find(item => item.status === 'fulfilled').value);
  });
}
