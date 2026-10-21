import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createInitialContent } from '../src/config/content.mjs';
import { createOssContentStore } from '../functions/cloud-content/store.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { collectJournalBackupKeys, createEncryptedObjectBackup, generateBackupKey, inspectEncryptedObjectBackup,
  restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const now = () => Date.parse('2026-10-21T16:00:00.000Z'), prefix = 'cms/v1/content';
const PRIVATE = 'PRIVATE-SYNTHETIC-WORK-HISTORY';
const digest = value => createHash('sha256').update(value).digest('hex');

test('encrypted isolated recovery preserves legacy snapshot bytes, new work relationships and all historical cover references', async () => {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix });
  const imageBytes = [Buffer.from('SYNTHETIC-OLD-WORK-COVER'), Buffer.from('SYNTHETIC-NEW-WORK-COVER')];
  const imageIds = imageBytes.map(data => digest(data) + '.png');
  for (const [index, id] of imageIds.entries()) await objects.putImmutable('cms/v1/portraits/' + id, imageBytes[index], { contentType: 'image/png' });
  const seed = createInitialContent(); seed.sessions = []; seed.guests = [];
  seed.booths = [{ id: 'synthetic-booth', code: 'C01', organization: '合成组织', project: '合成游戏与作品', zone: 'C', status: 'confirmed', internalNotes: '' }];
  seed.showcases = [{ id: 'synthetic-work', title: '合成游戏', teamName: '合成团队', school: '', contactName: '', email: '', wechat: '', memberCount: 2,
    participationForms: ['booth'], responseStatus: 'attending', materialLinks: '', summary: '合成说明', coverId: imageIds[0], status: 'confirmed',
    publicConsent: true, sessionId: '', boothId: 'synthetic-booth', internalNotes: PRIVATE }];
  // Genuine old version-one snapshot: neither new work field exists, and the
  // original immutable bytes must survive subsequent writes and recovery.
  const legacy = { storageVersion: 1, draft: { revision: 0, content: seed }, published: null, audit: [] };
  await journal.commit((await journal.read()).cursor, legacy);
  const legacyBlobKey = [...objects.files.keys()].find(key => key.includes('/blobs/'));
  const legacyBytes = Buffer.from(objects.files.get(legacyBlobKey).data);
  const portraitStore = { async verify(id) {
    const item = await objects.get('cms/v1/portraits/' + id); assert.ok(item); return { id, bytes: item.data.length };
  } };
  const build = (storageObjects = objects, storagePrefix = prefix) => createOssContentStore({ initialContent: seed, now, portraitStore,
    journal: createObjectJournal({ objects: storageObjects, prefix: storagePrefix }) });
  const store = build(), history = [(await store.read())];
  const next = structuredClone(history[0].draft.content);
  next.organizations = [{ id: 'synthetic-organization', name: '合成创作者组织', logoId: '', website: '', participation: 'attendee', status: 'confirmed', publicConsent: true, internalNotes: PRIVATE }];
  Object.assign(next.showcases[0], { kind: 'indie', organizationId: 'synthetic-organization', coverId: imageIds[1] });
  await store.save(0, next, 'synthetic'); history.push(await store.read());
  await store.publish(1, 'synthetic'); history.push(await store.read());
  const orphan = structuredClone(history.at(-1).draft.content); orphan.organizations = [];
  await store.save(1, orphan, 'synthetic'); history.push(await store.read());
  await store.publish(2, 'synthetic'); history.push(await store.read());
  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: [prefix] });
  assert.equal(keys.length, history.length + 1 + imageIds.length);
  for (const id of imageIds) assert.ok(keys.includes('cms/v1/portraits/' + id));
  const originalBytes = new Map(keys.map(key => [key, Buffer.from(objects.files.get(key).data)]));
  const key = generateBackupKey(), backup = await createEncryptedObjectBackup({ objects, keys, key, clock: now });
  assert.equal(backup.bundle.includes(Buffer.from(PRIVATE)), false);
  const inspection = inspectEncryptedObjectBackup({ bundle: backup.bundle, key, includeObjects: true });
  const old = inspection.objects.find(item => item.key === legacyBlobKey);
  assert.deepEqual(Buffer.from(old.dataBase64, 'base64'), legacyBytes);
  assert.equal(Object.hasOwn(JSON.parse(Buffer.from(old.dataBase64, 'base64')).draft.content.showcases[0], 'kind'), false);
  const destination = memoryObjects(), restored = await restoreEncryptedBackupIsolated({ objects: destination, bundle: backup.bundle, key, restoreId: 'synthetic-games-recovery' });
  assert.equal(restored.active, false); assert.equal(restored.sessionsRestored, false); assert.equal(restored.objectCount, keys.length);
  const isolatedPrefix = restored.namespace + '/content', recovered = build(destination, isolatedPrefix);
  assert.deepEqual(await recovered.read(), history.at(-1));
  assert.equal((await recovered.read()).draft.content.showcases[0].organizationId, 'synthetic-organization');
  assert.equal(Object.hasOwn((await recovered.read()).published.content.showcases[0], 'organizationId'), false);
  const logKey = isolatedPrefix + '/commits.jsonl', completeLog = destination.files.get(logKey);
  const lines = completeLog.data.toString('utf8').trimEnd().split('\n'); assert.equal(lines.length, history.length);
  for (const [index, expected] of history.entries()) {
    const historicalObjects = { ...destination, async get(name, options) {
      if (name === logKey) return { ...completeLog, data: Buffer.from(lines.slice(0, index + 1).join('\n') + '\n') };
      return destination.get(name, options);
    } };
    assert.deepEqual(await build(historicalObjects, isolatedPrefix).read(), expected);
  }
  for (const [name, bytes] of originalBytes) {
    assert.deepEqual(objects.files.get(name).data, bytes);
    assert.deepEqual(destination.files.get(restored.namespace + '/' + name.slice('cms/v1/'.length)).data, bytes);
  }
  const missingOldImage = imageIds[0]; objects.files.delete('cms/v1/portraits/' + missingOldImage);
  await assert.rejects(collectJournalBackupKeys({ objects, journalPrefixes: [prefix] }), error => error.code === 'BACKUP_INVALID');
});
