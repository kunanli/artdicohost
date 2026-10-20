import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createFileContentStore } from '../functions/content-api/store.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';

const now = () => Date.parse('2026-10-20T00:00:00Z');
const actor = 'synthetic-editor';
const details = { contactName: 'PRIVATE-RESPONSIBLE', contactMethods: 'PRIVATE-CONTACT', description: '合成展位描述' };

for (const kind of ['local', 'cloud']) test(`${kind} booth saves preserve omitted optional fields, allow explicit clearing and retain revision conflicts`, async t => {
  let make;
  if (kind === 'local') {
    const directory = await mkdtemp(join(tmpdir(), 'artdico-booth-fields-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    make = () => createFileContentStore({ directory, now });
  } else {
    let value = null, cursor = { position: 0, version: 0, hash: null };
    make = () => createOssContentStore({ now, journal: {
      async read() { return structuredClone({ value, cursor }); },
      async commit(expected, next) {
        if (JSON.stringify(expected) !== JSON.stringify(cursor)) throw new CloudContentError('WRITE_CONFLICT', 'conflict', 409);
        value = structuredClone(next); cursor = { position: cursor.position + 1, version: cursor.version + 1, hash: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
        return structuredClone({ value, cursor });
      },
    } });
  }
  const first = make(), initial = await first.read();
  const content = initial.draft.content;
  content.booths.push({ id: 'synthetic-booth', code: 'C01', zone: 'C', organization: '合成组织', project: '合成项目', status: 'confirmed', slotNumber: 1, internalNotes: '', ...details });
  const saved = await first.save(initial.draft.revision, content, actor);
  const legacy = structuredClone(saved.content);
  for (const name of Object.keys(details)) delete legacy.booths[0][name];
  legacy.booths[0].project = '合成旧客户端修改';
  const preserved = await make().save(saved.revision, legacy, actor);
  for (const [name, value] of Object.entries(details)) assert.equal(preserved.content.booths[0][name], value);
  await assert.rejects(first.save(saved.revision, legacy, actor), error => error.code === 'REVISION_CONFLICT' && error.status === 409);
  const clear = structuredClone(preserved.content);
  for (const name of Object.keys(details)) clear.booths[0][name] = '';
  const cleared = await make().save(preserved.revision, clear, actor);
  const reloaded = await make().read();
  for (const name of Object.keys(details)) assert.equal(reloaded.draft.content.booths[0][name], '');
  const publication = await first.publish(cleared.revision, actor);
  assert.equal(Object.hasOwn(publication.content.booths[0], 'contactName'), false);
  assert.equal(Object.hasOwn(publication.content.booths[0], 'contactMethods'), false);
  assert.equal(publication.content.booths[0].description, '');
});
