import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { generateBackupKey, createEncryptedObjectBackup, inspectEncryptedObjectBackup, collectJournalBackupKeys, restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const PRIVATE = 'PRIVATE-SYNTHETIC-BACKUP-CONTENT';
const now = () => Date.parse('2026-10-20T08:00:00.000Z');
const prefix = 'cms/v1/registration-reviews/ggj-cn-2026';
async function fixture() {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix });
  let current = await journal.read();
  current = await journal.commit(current.cursor, { version: 1, note: PRIVATE });
  current = await journal.commit(current.cursor, { version: 2, note: PRIVATE, value: 'latest' });
  const portraitKey = 'cms/v1/portraits/' + 'a'.repeat(64) + '.png';
  await objects.putImmutable(portraitKey, Buffer.from('SYNTHETIC-IMAGE-BYTES'), { contentType: 'image/png' });
  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: [prefix], additionalKeys: [portraitKey] });
  return { objects, journal, keys, portraitKey, key: generateBackupKey() };
}
async function rejects(operation, code) { await assert.rejects(operation, error => error.code === code && !error.message.includes(PRIVATE) && !error.message.includes('SYNTHETIC_PRIVATE_PROVIDER_DETAIL') && !error.cause); }

test('encrypted backup includes every historical journal snapshot, verifies hashes and hides private plaintext and keys', async () => {
  const f = await fixture(); assert.equal(f.keys.length, 4);
  const backup = await createEncryptedObjectBackup({ ...f, clock: now });
  assert.equal(backup.objectCount, 4); assert.equal(backup.encrypted, true); assert.equal(backup.independentBackup, false);
  assert.equal(backup.bundle.includes(Buffer.from(PRIVATE)), false); assert.equal(backup.bundle.includes(Buffer.from(prefix)), false);
  const inspection = inspectEncryptedObjectBackup({ ...f, bundle: backup.bundle });
  assert.equal(inspection.valid, true); assert.equal(inspection.manifestHash, backup.manifestHash); assert.equal(Object.hasOwn(inspection, 'objects'), false);
  const trusted = inspectEncryptedObjectBackup({ ...f, bundle: backup.bundle, includeObjects: true });
  assert.equal(trusted.objects.length, 4);
  const withoutBlob = f.keys.filter(key => key.includes('commits') || key === f.portraitKey);
  await rejects(createEncryptedObjectBackup({ ...f, keys: withoutBlob, clock: now }), 'BACKUP_INVALID');
});

test('wrong keys, tampered ciphertext and malformed formats are rejected before any restore write', async () => {
  const f = await fixture(), backup = await createEncryptedObjectBackup({ ...f, clock: now });
  for (const [bundle, key] of [[backup.bundle, generateBackupKey()], [Buffer.from('invalid'), f.key], [backup.bundle, Buffer.alloc(31)]]) {
    assert.throws(() => inspectEncryptedObjectBackup({ bundle, key }), error => error.code === 'BACKUP_INVALID' && !error.cause);
  }
  const tampered = Buffer.from(backup.bundle); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => inspectEncryptedObjectBackup({ bundle: tampered, key: f.key }), error => error.code === 'BACKUP_INVALID');
  const destination = memoryObjects();
  await rejects(restoreEncryptedBackupIsolated({ objects: destination, bundle: tampered, key: f.key, restoreId: 'synthetic-restore-01' }), 'BACKUP_INVALID');
  assert.equal(destination.calls.length, 0);
});

test('isolated restore re-creates immutable snapshots before logs, reads back all objects and never activates live state or sessions', async () => {
  const f = await fixture(), backup = await createEncryptedObjectBackup({ ...f, clock: now }), destination = memoryObjects();
  const result = await restoreEncryptedBackupIsolated({ objects: destination, bundle: backup.bundle, key: f.key, restoreId: 'synthetic-restore-01' });
  assert.equal(result.restored, true); assert.equal(result.active, false); assert.equal(result.sessionsRestored, false); assert.equal(result.objectCount, 4);
  assert.ok([...destination.files.keys()].every(key => key.startsWith('cms/v1/restores/synthetic-restore-01/')));
  const restored = createObjectJournal({ objects: destination, prefix: result.namespace + '/registration-reviews/ggj-cn-2026' });
  assert.deepEqual((await restored.read()).value, (await f.journal.read()).value);
  const writes = destination.calls.filter(call => call.operation !== 'get');
  assert.equal(writes.at(-1).operation, 'append');
  await rejects(restoreEncryptedBackupIsolated({ objects: destination, bundle: backup.bundle, key: f.key, restoreId: 'synthetic-restore-01' }), 'RESTORE_NOT_EMPTY');
  assert.equal(destination.calls.filter(call => call.operation !== 'get').length, writes.length);
});

test('maintenance excludes active and nested session/limit prefixes, ambiguous restores and empty inventories', async () => {
  const f = await fixture();
  for (const name of ['cms/v1/sessions/private/commits.jsonl', 'cms/v1/limits/login/commits.jsonl', 'cms/v1/acceptance/synthetic/sessions/x', 'cms/v1/restores/old/content/x', 'outside/private.json']) {
    await rejects(createEncryptedObjectBackup({ ...f, keys: [name], clock: now }), 'BACKUP_INVALID');
  }
  await rejects(createEncryptedObjectBackup({ ...f, keys: [], clock: now }), 'BACKUP_INVALID');
  await rejects(collectJournalBackupKeys({ objects: f.objects, journalPrefixes: ['cms/v1/sessions/private'] }), 'BACKUP_INVALID');
  const backup = await createEncryptedObjectBackup({ ...f, clock: now });
  for (const restoreId of ['live', '../production', 'SYNTHETIC-RESTORE', '']) await rejects(restoreEncryptedBackupIsolated({ ...f, bundle: backup.bundle, restoreId }), 'BACKUP_INVALID');
});

test('changing source objects during backup and unknown restore acknowledgements fail without retries or false completion', async () => {
  const f = await fixture();
  let reads = 0;
  const unstable = { async get(...args) { const value = await f.objects.get(...args); if (++reads > f.keys.length && value) return { ...value, contentType: 'application/changed' }; return value; } };
  await rejects(createEncryptedObjectBackup({ ...f, objects: unstable, clock: now }), 'BACKUP_INVALID');
  const backup = await createEncryptedObjectBackup({ ...f, clock: now }), target = memoryObjects(); let appends = 0;
  const lost = { get: target.get, putImmutable: target.putImmutable, async append(...args) { if (args[0].endsWith('/claim')) return target.append(...args); appends++; await target.append(...args); throw new Error(PRIVATE); } };
  await rejects(restoreEncryptedBackupIsolated({ objects: lost, bundle: backup.bundle, key: f.key, restoreId: 'synthetic-restore-02' }), 'MAINTENANCE_FAILED');
  assert.equal(appends, 1);
  const restored = createObjectJournal({ objects: target, prefix: 'cms/v1/restores/synthetic-restore-02/registration-reviews/ggj-cn-2026' });
  assert.equal((await restored.read()).value.version, 2);
  f.objects.setFailure('get');
  await rejects(createEncryptedObjectBackup({ ...f, clock: now }), 'MAINTENANCE_FAILED');
});

test('backup inventory follows registration record and content portrait references rather than silently omitting private data', async () => {
  const objects = memoryObjects();
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  const record = Buffer.from(JSON.stringify({ kind: 'registration', fields: { name: PRIVATE } })), recordHash = digest(record);
  const recordKey = `cms/v1/registrations/ggj-cn-2026/records/${recordHash}.json`;
  await objects.putImmutable(recordKey, record, { contentType: 'application/json' });
  const index = createObjectJournal({ objects, prefix: 'cms/v1/registrations/ggj-cn-2026/index' });
  await index.commit((await index.read()).cursor, { schemaVersion: 1, kind: 'registration_index', eventId: 'ggj-cn-2026', revision: 1, entries: [{ recordHash }] });
  const portrait = Buffer.from('SYNTHETIC-PRIVATE-PORTRAIT'), portraitId = digest(portrait) + '.png', portraitKey = 'cms/v1/portraits/' + portraitId;
  await objects.putImmutable(portraitKey, portrait, { contentType: 'image/png' });
  const content = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  await content.commit((await content.read()).cursor, { storageVersion: 1, draft: { content: { guests: [{ portraitId }], showcases: [] } }, published: null, audit: [{ action: 'upload_portrait', portraitId }] });
  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: ['cms/v1/registrations/ggj-cn-2026/index', 'cms/v1/content'] });
  assert.equal(keys.length, 6); assert.ok(keys.includes(recordKey)); assert.ok(keys.includes(portraitKey));
  const key = generateBackupKey();
  assert.equal((await createEncryptedObjectBackup({ objects, keys, key, clock: now })).objectCount, 6);
  await rejects(createEncryptedObjectBackup({ objects, keys: keys.filter(item => item !== recordKey), key, clock: now }), 'BACKUP_INVALID');
  objects.files.delete(portraitKey);
  await rejects(collectJournalBackupKeys({ objects, journalPrefixes: ['cms/v1/content'] }), 'BACKUP_INVALID');
});

test('group-invite backup follows current and historical private image IDs without public URLs or bucket listing', async () => {
  const objects = memoryObjects(), prefix = 'cms/v1/group-invites/ggj-cn-2026';
  const first = Buffer.from('SYNTHETIC-GROUP-QR-1'), second = Buffer.from('SYNTHETIC-GROUP-QR-2');
  const digest = value => createHash('sha256').update(value).digest('hex');
  const ids = [digest(first) + '.png', digest(second) + '.png'];
  await objects.putImmutable(prefix + '/images/' + ids[0], first, { contentType: 'image/png' });
  await objects.putImmutable(prefix + '/images/' + ids[1], second, { contentType: 'image/png' });
  const state = createObjectJournal({ objects, prefix: prefix + '/state' });
  await state.commit((await state.read()).cursor, { schemaVersion: 1, kind: 'registration_group_invite', eventId: 'ggj-cn-2026', revision: 2,
    active: { imageId: ids[1] }, audit: [{ action: 'replace', imageId: ids[0] }, { action: 'replace', imageId: ids[1] }] });
  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: [prefix + '/state'] });
  assert.equal(keys.length, 4); assert.ok(keys.includes(prefix + '/images/' + ids[0])); assert.ok(keys.includes(prefix + '/images/' + ids[1]));
  const key = generateBackupKey(); assert.equal((await createEncryptedObjectBackup({ objects, keys, key, clock: now })).objectCount, 4);
  await rejects(createEncryptedObjectBackup({ objects, keys: keys.filter(value => !value.endsWith(ids[0])), key, clock: now }), 'BACKUP_INVALID');
});

test('one restore ID atomically belongs to a single bundle even when object sets are disjoint or both restores race', async () => {
  const source = memoryObjects(), key = generateBackupKey();
  await source.putImmutable('cms/v1/content/first.json', Buffer.from('FIRST-SYNTHETIC-RECOVERY'), { contentType: 'application/json' });
  await source.putImmutable('cms/v1/contacts/second.json', Buffer.from('SECOND-SYNTHETIC-RECOVERY'), { contentType: 'application/json' });
  const first = await createEncryptedObjectBackup({ objects: source, keys: ['cms/v1/content/first.json'], key, clock: now });
  const second = await createEncryptedObjectBackup({ objects: source, keys: ['cms/v1/contacts/second.json'], key, clock: now });
  const target = memoryObjects(), restoreId = 'synthetic-disjoint-recovery';
  await restoreEncryptedBackupIsolated({ objects: target, bundle: first.bundle, key, restoreId });
  const mutations = target.calls.filter(call => call.operation !== 'get').length;
  await rejects(restoreEncryptedBackupIsolated({ objects: target, bundle: second.bundle, key, restoreId }), 'RESTORE_NOT_EMPTY');
  assert.equal(target.calls.filter(call => call.operation !== 'get').length, mutations);
  assert.equal(target.files.has(`cms/v1/restores/${restoreId}/contacts/second.json`), false);
  const racing = memoryObjects();
  const results = await Promise.allSettled([first, second].map(backup => restoreEncryptedBackupIsolated({ objects: racing, bundle: backup.bundle, key, restoreId: 'synthetic-concurrent-recovery' })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'RESTORE_NOT_EMPTY');
  assert.equal([...racing.files.keys()].filter(name => !name.endsWith('/claim')).length, 1);
  assert.equal(racing.calls.filter(call => call.operation === 'append' && call.key.endsWith('/claim')).length, 2);
});

test('a lost namespace-claim ACK leaves only the claim and never retries or reports recovery success', async () => {
  const f = await fixture(), backup = await createEncryptedObjectBackup({ ...f, clock: now }), target = memoryObjects();
  let claims = 0;
  const ambiguous = { ...target, async append(...args) { if (args[0].endsWith('/claim')) { claims++; await target.append(...args); throw new Error(PRIVATE); } return target.append(...args); } };
  const options = { objects: ambiguous, bundle: backup.bundle, key: f.key, restoreId: 'synthetic-claim-unknown' };
  await rejects(restoreEncryptedBackupIsolated(options), 'MAINTENANCE_FAILED');
  assert.equal(claims, 1); assert.equal(target.files.size, 1); assert.ok([...target.files.keys()][0].endsWith('/claim'));
  assert.equal(target.calls.some(call => call.operation === 'putImmutable'), false);
  await rejects(restoreEncryptedBackupIsolated(options), 'RESTORE_NOT_EMPTY'); assert.equal(claims, 1);
});
