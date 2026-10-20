import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaintenanceApi, createMaintenanceAuditStore, MAX_MAINTENANCE_BODY_BYTES, MAX_BROWSER_BACKUP_BYTES } from '../functions/registration-admin/maintenance-handler.mjs';
import { createEncryptedObjectBackup, generateBackupKey, inspectEncryptedObjectBackup } from '../functions/registration-admin/maintenance.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const ORIGIN = 'https://api.artdico.host', PRIVATE = 'PRIVATE-SYNTHETIC-MAINTENANCE-DATA';
const AT = '2026-10-20T09:00:00.000Z';
const now = () => Date.parse(AT);
const auth = { authenticate: async request => ({ user: { id: 'synthetic-superadmin', roles: [request.headers.get('cookie') ?? 'editor'] }, csrfToken: 'synthetic-csrf' }) };
const request = (path, { method = 'GET', role = 'superadmin', origin = method === 'GET' ? undefined : ORIGIN, csrf = 'synthetic-csrf', body, headers = {} } = {}) =>
  new Request(ORIGIN + path, { method, headers: { Cookie: role, ...(origin ? { Origin: origin } : {}), 'X-CSRF-Token': csrf,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
async function fixture({ seeded = true, auditOverride } = {}) {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: 'cms/v1/content' });
  if (seeded) await journal.commit((await journal.read()).cursor, { version: 1, note: PRIVATE });
  const auditJournal = createObjectJournal({ objects, prefix: 'cms/v1/maintenance' });
  const audit = createMaintenanceAuditStore({ journal: auditJournal, clock: now });
  const key = generateBackupKey(), encryptionKey = key.toString('base64url');
  const options = { enabled: true, auth, objects, journalPrefixes: ['cms/v1/content', 'cms/v1/maintenance'], audit: auditOverride ?? audit, clock: now };
  return { objects, journal, auditJournal, audit, key, encryptionKey, options, api: createMaintenanceApi(options) };
}
const backupInput = f => ({ encryptionKey: f.encryptionKey, confirmation: 'CREATE_ENCRYPTED_BACKUP' });
const restoreInput = (f, bytes, restoreId = 'synthetic-restore-01') => ({ encryptionKey: f.encryptionKey, bundleBase64: Buffer.from(bytes).toString('base64'), restoreId, confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' });

test('superadmin downloads encrypted backup only after durable audit, then restores to an inactive isolated namespace', async () => {
  const f = await fixture();
  const ready = await f.api(request('/api/admin/maintenance'));
  assert.equal(ready.status, 200); const info = await ready.json();
  assert.equal(info.backup.maxEncryptedBytes, MAX_BROWSER_BACKUP_BYTES); assert.equal(info.backup.accountDirectoryIncluded, false); assert.equal(info.audit.count, 0);
  assert.doesNotMatch(JSON.stringify(info), /PRIVATE|cms\/v1|synthetic-superadmin|encryptionKey/u);
  const response = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(f) }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/octet-stream');
  assert.equal(response.headers.get('cache-control'), 'no-store'); assert.match(response.headers.get('content-disposition'), /attachment/u);
  const bundle = Buffer.from(await response.arrayBuffer());
  assert.equal(bundle.includes(Buffer.from(PRIVATE)), false); assert.equal(bundle.includes(Buffer.from(f.encryptionKey)), false);
  const verified = inspectEncryptedObjectBackup({ bundle, key: f.key });
  assert.equal(verified.backupHash, response.headers.get('x-backup-sha256')); assert.equal(verified.manifestHash, response.headers.get('x-backup-manifest-sha256'));
  assert.equal((await f.audit.readSafe()).count, 1); assert.equal((await f.audit.readSafe()).lastBackupAt, AT);
  const auditText = JSON.stringify((await f.auditJournal.read()).value); assert.doesNotMatch(auditText, /PRIVATE|encryptionKey|dataBase64|cms\/v1/u); assert.equal(auditText.includes(f.encryptionKey), false);
  const restored = await f.api(request('/api/admin/maintenance/restore', { method: 'POST', body: restoreInput(f, bundle) }));
  assert.equal(restored.status, 200); const result = await restored.json();
  assert.equal(result.restored, true); assert.equal(result.active, false); assert.equal(result.sessionsRestored, false);
  assert.equal(result.namespace, 'cms/v1/restores/synthetic-restore-01');
  const isolated = createObjectJournal({ objects: f.objects, prefix: result.namespace + '/content' });
  assert.deepEqual((await isolated.read()).value, (await f.journal.read()).value);
  assert.equal((await f.audit.readSafe()).count, 3); assert.equal((await f.audit.readSafe()).lastRestoreAt, AT); assert.equal((await f.audit.readSafe()).incompleteRestoreCount, 0);
});

test('maintenance denies ordinary staff, cross-origin and CSRF requests before reading any private inventory', async () => {
  const f = await fixture(), start = f.objects.calls.length;
  for (const role of ['editor', 'publisher', 'outreach', 'reviewer']) {
    assert.equal((await f.api(request('/api/admin/maintenance', { role }))).status, 403);
    assert.equal((await f.api(request('/api/admin/maintenance/backup', { method: 'POST', role, body: backupInput(f) }))).status, 403);
  }
  assert.equal((await f.api(request('/api/admin/maintenance/backup', { method: 'POST', origin: 'https://artdico.host', body: backupInput(f) }))).status, 403);
  assert.equal((await f.api(request('/api/admin/maintenance/backup', { method: 'POST', csrf: 'wrong', body: backupInput(f) }))).status, 403);
  assert.equal(f.objects.calls.length, start);
  const unsafeQuery = await f.api(request('/api/admin/maintenance?encryptionKey=PRIVATE'));
  assert.equal(unsafeQuery.status, 403); assert.doesNotMatch(await unsafeQuery.text(), /PRIVATE/u);
});

test('invalid confirmations, keys, files, oversized and compressed bodies do not begin restoration or leak input', async () => {
  const f = await fixture();
  const backup = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(f) }));
  const bundle = Buffer.from(await backup.arrayBuffer());
  for (const [input, expected] of [[{ ...backupInput(f), confirmation: 'PRIVATE' }, 400], [{ ...backupInput(f), encryptionKey: PRIVATE }, 422], [{ ...backupInput(f), objectKeys: ['cms/v1/users'] }, 400]]) {
    const result = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', body: input }));
    assert.equal(result.status, expected); assert.doesNotMatch(await result.text(), /PRIVATE|cms\/v1/u);
  }
  for (const input of [{ ...restoreInput(f, bundle), encryptionKey: generateBackupKey().toString('base64url') }, { ...restoreInput(f, bundle), bundleBase64: 'PRIVATE' }, { ...restoreInput(f, bundle), restoreId: '../live' }]) {
    const result = await f.api(request('/api/admin/maintenance/restore', { method: 'POST', body: input })); assert.equal(result.status, 422);
  }
  assert.equal((await f.audit.readSafe()).count, 1);
  const tooBig = await f.api(request('/api/admin/maintenance/restore', { method: 'POST', body: 'x'.repeat(MAX_MAINTENANCE_BODY_BYTES + 1) })); assert.equal(tooBig.status, 413);
  const compressed = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', headers: { 'Content-Encoding': 'gzip' }, body: backupInput(f) })); assert.equal(compressed.status, 400);
  const badLength = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', headers: { 'Content-Length': '1' }, body: backupInput(f) })); assert.equal(badLength.status, 400);
  assert.equal((await f.audit.readSafe()).count, 1);
});

test('audit failure or unknown acknowledgement prevents encrypted downloads and restoration never retries writes', async () => {
  const f = await fixture(); let records = 0;
  const brokenAudit = { readSafe: f.audit.readSafe, async record(input) { records++; await f.audit.record(input); throw new Error(PRIVATE); } };
  const api = createMaintenanceApi({ ...f.options, audit: brokenAudit });
  const response = await api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(f) }));
  assert.equal(response.status, 503); assert.match(response.headers.get('content-type'), /application\/json/u); assert.doesNotMatch(await response.text(), /PRIVATE/u); assert.equal(records, 1);
  const next = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(f) }));
  const bundle = Buffer.from(await next.arrayBuffer());
  let mutations = 0;
  const lost = { ...f.objects, async putImmutable(...args) { if (args[0].startsWith('cms/v1/restores/')) { mutations++; await f.objects.putImmutable(...args); throw new Error(PRIVATE); } return f.objects.putImmutable(...args); } };
  const restoreApi = createMaintenanceApi({ ...f.options, objects: lost });
  const failed = await restoreApi(request('/api/admin/maintenance/restore', { method: 'POST', body: restoreInput(f, bundle, 'synthetic-restore-02') }));
  assert.equal(failed.status, 503); assert.equal(mutations, 1); assert.equal((await f.audit.readSafe()).incompleteRestoreCount, 1);
  assert.equal((await f.journal.read()).value.note, PRIVATE);
});

test('empty data is accurately reported and web restore refuses credential-directory backups and non-whitelisted inventory', async () => {
  const empty = await fixture({ seeded: false });
  const response = await empty.api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(empty) }));
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'NO_BACKUP_DATA');
  for (const prefix of ['cms/v1/users', 'cms/v1/sessions', 'cms/v1/limits', 'cms/v1/restores/old', 'other/private']) assert.throws(() => createMaintenanceApi({ ...empty.options, journalPrefixes: [prefix] }), TypeError);
  const f = await fixture(), users = createObjectJournal({ objects: f.objects, prefix: 'cms/v1/users' });
  await users.commit((await users.read()).cursor, { syntheticCredentialHash: PRIVATE });
  const keys = [...f.objects.files.keys()].filter(key => key.startsWith('cms/v1/users/'));
  const encrypted = await createEncryptedObjectBackup({ objects: f.objects, keys, key: f.key, clock: now });
  const result = await f.api(request('/api/admin/maintenance/restore', { method: 'POST', body: restoreInput(f, encrypted.bundle) }));
  assert.equal(result.status, 422); assert.equal((await f.audit.readSafe()).count, 0);
  assert.equal([...f.objects.files.keys()].some(key => key.startsWith('cms/v1/restores/')), false);
});

test('audit uses shared journal CAS and validates operation metadata before recording', async () => {
  const f = await fixture(), second = createMaintenanceAuditStore({ journal: f.auditJournal, clock: now });
  const input = { action: 'backup', phase: 'completed', actorId: 'synthetic', manifestHash: 'a'.repeat(64), backupHash: 'b'.repeat(64), objectCount: 1, restoreId: null };
  const outcomes = await Promise.allSettled([f.audit.record(input), second.record(input)]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await f.audit.readSafe()).count, 1);
  await assert.rejects(f.audit.record({ ...input, encryptionKey: PRIVATE }));
  await assert.rejects(f.audit.record({ ...input, actorId: undefined }));
  await assert.rejects(f.audit.record({ ...input, action: 'restore', restoreId: 'synthetic-restore-unstarted' }));
  assert.equal((await f.audit.readSafe()).count, 1);
});

test('browser backup fails clearly above transfer limit and aborted body reads never begin maintenance', async () => {
  const f = await fixture();
  let state = await f.journal.read();
  await f.journal.commit(state.cursor, { version: 2, note: 'x'.repeat(900000) });
  state = await f.journal.read(); await f.journal.commit(state.cursor, { version: 3, note: 'y'.repeat(900000) });
  const response = await f.api(request('/api/admin/maintenance/backup', { method: 'POST', body: backupInput(f) }));
  assert.equal(response.status, 413); assert.equal((await response.json()).error.code, 'MAINTENANCE_TOO_LARGE');
  assert.equal((await f.audit.readSafe()).count, 0);
  let cancelled = 0; const controller = new AbortController();
  const stream = new ReadableStream({ cancel() { cancelled++; } });
  const pending = f.api(new Request(ORIGIN + '/api/admin/maintenance/restore', { method: 'POST', headers: { Cookie: 'superadmin', Origin: ORIGIN,
    'X-CSRF-Token': 'synthetic-csrf', 'Content-Type': 'application/json' }, body: stream, duplex: 'half', signal: controller.signal }));
  controller.abort();
  assert.equal((await pending).status, 400); assert.equal(cancelled, 1); assert.equal((await f.audit.readSafe()).count, 0);
});
