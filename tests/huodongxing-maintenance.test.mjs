import test from 'node:test';
import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { validateHuodongxingLedger } from '../functions/intent-invitations/importer.mjs';
import { createEncryptedObjectBackup, collectJournalBackupKeys, generateBackupKey, inspectEncryptedObjectBackup, restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { createMaintenanceApi, createMaintenanceAuditStore } from '../functions/registration-admin/maintenance-handler.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const PREFIX = 'cms/v1/external-registrations/8884819113200', ORIGIN = 'https://api.artdico.host';
const AT = '2026-11-03T09:00:00.000Z', now = () => Date.parse(AT);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const empty = () => validateHuodongxingLedger({ schemaVersion: 1, kind: 'huodongxing_ticket_ledger', eventId: 'ggj-cn-2026', sourceEventId: '8884819113200', revision: 0, tickets: [], operations: [], audit: [] });
function history() {
  const tid = '0000000000000000000001', actorId = 'synthetic-ledger-staff', operationId = 'a'.repeat(64), registrationId = 'R'.repeat(43);
  const contactId = 'c_' + digest('huodongxing-8884819113200\0' + tid).slice(0, 32), sourceFileSha256 = digest('SYNTHETIC-SOURCE-BYTES');
  const row = { tid, registrationNumber: '000101', orderNumber: '000202', name: '合成活动行参与者', email: 'synthetic.ledger@example.invalid',
    phone: '+852 0012 3456', wechat: 'synthetic-ledger', registeredAt: '2026-11-03 09:00:00', lastVerifiedAt: '', status: '有效票' };
  const permissionReference = '合成人员核对授权';
  const operation = { operationId, requestHash: 'b'.repeat(64), actorId, startedAt: AT, updatedAt: AT, finished: false, status: 'pending', reservedBytes: 10_240,
    resume: { sourceEventId: '8884819113200', originalSha256: sourceFileSha256, expectedRevision: 0, expectedTicketRevision: 0,
      expectedAdmissionRevision: 0, previewToken: 'c'.repeat(64), selectedTids: [tid], links: [], separateTids: [], confirmSource: true, confirmPermission: true, permissionReference }, results: [] };
  const pending = { ...empty(), revision: 1, operations: [operation], audit: [{ revision: 1, action: 'started', operationId, actorId, at: AT, tid: null }] };
  const completed = structuredClone(pending); completed.revision = 2;
  completed.operations[0].finished = true; completed.operations[0].status = 'completed';
  completed.operations[0].results.push({ tid, status: 'imported', contactId, registrationId, reason: null });
  completed.tickets.push({ tid, row, rowDigest: digest(JSON.stringify(row)), contactId, registrationId, sourceFileSha256, permissionReference, actorId, recordedAt: AT });
  completed.audit.push({ revision: 2, action: 'ticket_result', operationId, actorId, at: AT, tid });
  return [pending, completed].map(validateHuodongxingLedger);
}
const request = (path, body, role = 'superadmin') => new Request(ORIGIN + path, { method: 'POST', headers: {
  Origin: ORIGIN, Cookie: role, 'X-CSRF-Token': 'synthetic-maintenance-csrf', 'Content-Type': 'application/json',
}, body: JSON.stringify(body) });
async function fixture(value, prefix = PREFIX) {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix });
  for (const state of value === undefined ? history() : [value]) await journal.commit((await journal.read()).cursor, state);
  const key = generateBackupKey(), audit = createMaintenanceAuditStore({ journal: createObjectJournal({ objects, prefix: 'cms/v1/maintenance' }), clock: now });
  const auth = { authenticate: async input => ({ user: { id: 'synthetic-ledger-superadmin', roles: [input.headers.get('cookie')] }, csrfToken: 'synthetic-maintenance-csrf' }) };
  const options = { enabled: true, auth, objects, journalPrefixes: [PREFIX], audit, clock: now };
  return { objects, journal, key, options, api: createMaintenanceApi(options) };
}
const rejects = operation => assert.rejects(operation, error => error.code === 'BACKUP_INVALID' && !error.cause);
// Deliberately create authenticated but semantically invalid bundles. This uses
// only test-owned memory bytes and lets inspect/restore exercise their reader,
// rather than being blocked earlier by the normal backup writer.
function authenticatedBundle(objects, key, mutate = value => value) {
  const entries = [...objects.files].map(([name, item]) => ({ key: name, contentType: item.contentType, objectType: item.objectType,
    bytes: item.data.length, sha256: digest(item.data), dataBase64: item.data.toString('base64') }));
  const manifest = mutate({ schemaVersion: 1, kind: 'artdico-private-object-backup', createdAt: AT, bucket: 'artdicohost-data-hk', region: 'cn-hongkong', objects: entries });
  const magic = Buffer.from('ARTDICO-BKP1\n'), nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(manifest))), cipher.final()]);
  return Buffer.concat([magic, nonce, cipher.getAuthTag(), ciphertext]);
}

test('fixed Huodongxing ledger is encrypted, restored only in isolation and read with its original validator', async () => {
  const f = await fixture(), original = (await f.journal.read()).value;
  const sourceBytes = new Map([...f.objects.files].map(([name, item]) => [name, Buffer.from(item.data)]));
  const keys = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [PREFIX] });
  assert.equal(keys.length, 3); assert.ok(keys.includes(PREFIX + '/commits.jsonl'));
  assert.ok(keys.every(name => name === PREFIX + '/commits.jsonl' || /^cms\/v1\/external-registrations\/8884819113200\/blobs\/[a-f0-9]{64}\.json$/u.test(name)));
  const backup = await createEncryptedObjectBackup({ objects: f.objects, keys, key: f.key, clock: now });
  assert.equal(backup.encrypted, true); assert.equal(backup.bundle.includes(Buffer.from(PREFIX)), false);
  const inspected = inspectEncryptedObjectBackup({ bundle: backup.bundle, key: f.key }); assert.equal(inspected.objectCount, 3);
  const destination = memoryObjects(), result = await restoreEncryptedBackupIsolated({ objects: destination, bundle: backup.bundle, key: f.key, restoreId: 'synthetic-external-ledger' });
  assert.equal(result.active, false); assert.equal(result.sessionsRestored, false);
  const restored = createObjectJournal({ objects: destination, prefix: result.namespace + '/external-registrations/8884819113200' });
  assert.deepEqual(validateHuodongxingLedger((await restored.read()).value), original);
  assert.equal((await restored.read()).value.revision, (await restored.read()).cursor.version);
  assert.equal(original.tickets[0].row.phone, '+852 0012 3456'); assert.equal(original.operations[0].status, 'completed');
  const logKey = result.namespace + '/external-registrations/8884819113200/commits.jsonl', log = destination.files.get(logKey);
  const firstCommit = Buffer.from(log.data.toString('utf8').split('\n')[0] + '\n');
  const historicalObjects = { ...destination, async get(name, options) { return name === logKey ? { ...log, data: firstCommit } : destination.get(name, options); } };
  const historical = await createObjectJournal({ objects: historicalObjects, prefix: result.namespace + '/external-registrations/8884819113200' }).read();
  assert.deepEqual(validateHuodongxingLedger(historical.value), history()[0], 'the pending operation and its exact retry inputs remain readable in history');
  assert.ok([...destination.files.keys()].every(name => name.startsWith(result.namespace + '/')));
  for (const [name, bytes] of sourceBytes) assert.deepEqual(f.objects.files.get(name).data, bytes, 'live source bytes stay unchanged');
  assert.equal(destination.calls.some(call => /mail|email|wallet|registration-confirmations/u.test(call.key)), false);
});

test('maintenance API permits only the fixed source event and rejects unauthorized inventories before private reads', async () => {
  const f = await fixture(), reads = f.objects.calls.length;
  for (const prefix of ['cms/v1/external-registrations', 'cms/v1/external-registrations/8884819113201', PREFIX + '/raw', PREFIX + '/nested', PREFIX + '/../other']) {
    assert.throws(() => createMaintenanceApi({ ...f.options, journalPrefixes: [prefix] }), TypeError);
  }
  assert.throws(() => createMaintenanceApi({ ...f.options, additionalKeys: [PREFIX + '/raw.xlsx'] }), TypeError);
  assert.equal(f.objects.calls.length, reads);
  const denied = await f.api(request('/api/admin/maintenance/backup', { encryptionKey: f.key.toString('base64url'), confirmation: 'CREATE_ENCRYPTED_BACKUP' }, 'outreach'));
  assert.equal(denied.status, 403); assert.equal(f.objects.calls.length, reads);
  const response = await f.api(request('/api/admin/maintenance/backup', { encryptionKey: f.key.toString('base64url'), confirmation: 'CREATE_ENCRYPTED_BACKUP' }));
  assert.equal(response.status, 200); const bundle = Buffer.from(await response.arrayBuffer());
  assert.equal(inspectEncryptedObjectBackup({ bundle, key: f.key }).objectCount, 3);
  const restored = await f.api(request('/api/admin/maintenance/restore', { encryptionKey: f.key.toString('base64url'), bundleBase64: bundle.toString('base64'), restoreId: 'synthetic-handler-ledger', confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' }));
  assert.equal(restored.status, 200); assert.equal((await restored.json()).active, false);
  const unauthorized = await fixture({ kind: 'synthetic-unrelated-value' }, 'cms/v1/external-registrations/8884819113201');
  const foreign = authenticatedBundle(unauthorized.objects, f.key), before = f.objects.calls.length;
  const result = await f.api(request('/api/admin/maintenance/restore', { encryptionKey: f.key.toString('base64url'), bundleBase64: foreign.toString('base64'), restoreId: 'synthetic-foreign-ledger', confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' }));
  assert.equal(result.status, 422); assert.equal((await result.json()).error.code, 'BACKUP_INVALID'); assert.equal(f.objects.calls.length, before);
});

test('corrupt ledger schema, source binding and disguised kind fail both backup and authenticated restore before writes', async () => {
  const wrongTicketReference = history()[1]; wrongTicketReference.tickets[0].contactId = 'c_' + 'f'.repeat(32);
  for (const value of [ { ...empty(), sourceEventId: '8884819113201' }, { ...empty(), revision: -1 }, { ...empty(), kind: 'synthetic-disguised-ledger' }, { ...empty(), rawWorkbookKey: PREFIX + '/private-original.xlsx' }, { ...empty(), audit: [{}] }, wrongTicketReference ]) {
    const f = await fixture(value), keys = [...f.objects.files.keys()];
    await rejects(collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [PREFIX] }));
    await rejects(createEncryptedObjectBackup({ objects: f.objects, keys, key: f.key, clock: now }));
    const bundle = authenticatedBundle(f.objects, f.key);
    assert.throws(() => inspectEncryptedObjectBackup({ bundle, key: f.key }), error => error.code === 'BACKUP_INVALID' && !error.cause);
    const destination = memoryObjects(); await rejects(restoreEncryptedBackupIsolated({ objects: destination, bundle, key: f.key, restoreId: 'synthetic-corrupt-ledger' }));
    assert.equal(destination.calls.length, 0, 'schema rejection happens before namespace claim or any private read/write');
  }
});

test('ledger location, normal blob type and immutable reference closure are required without following raw file references', async () => {
  const misplaced = await fixture(empty(), 'cms/v1/content');
  await rejects(collectJournalBackupKeys({ objects: misplaced.objects, journalPrefixes: ['cms/v1/content'] }));
  await rejects(createEncryptedObjectBackup({ objects: misplaced.objects, keys: [...misplaced.objects.files.keys()], key: misplaced.key, clock: now }));
  const f = await fixture(), blobKey = [...f.objects.files.keys()].find(name => name.includes('/blobs/'));
  const missing = authenticatedBundle(f.objects, f.key, value => ({ ...value, objects: value.objects.filter(item => item.key !== blobKey) }));
  assert.throws(() => inspectEncryptedObjectBackup({ bundle: missing, key: f.key }), error => error.code === 'BACKUP_INVALID');
  const typed = authenticatedBundle(f.objects, f.key, value => ({ ...value, objects: value.objects.map(item => item.key === blobKey ? { ...item, objectType: 'Appendable' } : item) }));
  assert.throws(() => inspectEncryptedObjectBackup({ bundle: typed, key: f.key }), error => error.code === 'BACKUP_INVALID');
  for (const bundle of [missing, typed]) {
    const destination = memoryObjects(); await rejects(restoreEncryptedBackupIsolated({ objects: destination, bundle, key: f.key, restoreId: 'synthetic-invalid-reference' }));
    assert.equal(destination.calls.length, 0);
  }
  const rawKey = PREFIX + '/private-original.xlsx'; await f.objects.putImmutable(rawKey, Buffer.from('SYNTHETIC-NON-WORKBOOK-PRIVATE-BYTES'));
  await rejects(createEncryptedObjectBackup({ objects: f.objects, keys: [...f.objects.files.keys()], key: f.key, clock: now }));
  const raw = authenticatedBundle(f.objects, f.key);
  const destination = memoryObjects(); await rejects(restoreEncryptedBackupIsolated({ objects: destination, bundle: raw, key: f.key, restoreId: 'synthetic-raw-reference' }));
  assert.equal(destination.calls.length, 0);
});
