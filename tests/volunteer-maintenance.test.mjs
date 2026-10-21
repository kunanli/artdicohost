import test from 'node:test';
import assert from 'node:assert/strict';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createVolunteerRepository } from '../functions/volunteers/repository.mjs';
import { createMaintenanceApi, createMaintenanceAuditStore } from '../functions/registration-admin/maintenance-handler.mjs';
import { collectJournalBackupKeys, createEncryptedObjectBackup, generateBackupKey, inspectEncryptedObjectBackup } from '../functions/registration-admin/maintenance.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const ORIGIN = 'https://api.artdico.host', EVENT = 'synthetic-volunteer-event';
const PREFIX = 'cms/v1/volunteers/' + EVENT, PRIVATE = 'PRIVATE-SYNTHETIC-VOLUNTEER-COMMUNICATION';
const now = () => Date.parse('2026-10-21T08:00:00.000Z');
const auth = { authenticate: async () => ({ user: { id: 'synthetic-superadmin', roles: ['superadmin'] }, csrfToken: 'synthetic-csrf' }) };
function request(path, body) {
  return new Request(ORIGIN + path, { method: 'POST', headers: { Origin: ORIGIN, 'X-CSRF-Token': 'synthetic-csrf', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function fixture() {
  const objects = memoryObjects(), journal = createObjectJournal({ objects, prefix: PREFIX });
  const repository = createVolunteerRepository({ journal, eventId: EVENT, clock: now }), history = [];
  async function change(action, payload, apply, details) {
    const current = await repository.read();
    const result = await repository.mutate({ actorId: 'synthetic-staff', expectedRevision: current.revision,
      operationId: 'synthetic-operation-' + String(current.revision + 1).padStart(3, '0'), action, payload, ...(details ? { details } : {}) }, apply);
    history.push(result.state);
  }
  const volunteer = { id: 'synthetic-volunteer', source: { kind: 'contact', id: 'synthetic-person' }, workflowStatus: 'pending', owner: '合成同事',
    followUpAt: '', lastContactAt: '', notes: '', availability: [{ start: '09:00', end: '12:00' }] };
  await change('volunteer_upsert', volunteer, state => ({ ...state, volunteers: [volunteer] }));
  const invited = { ...volunteer, workflowStatus: 'invited', followUpAt: '2026-11-01', lastContactAt: '2026-10-21', notes: PRIVATE };
  await change('volunteer_upsert', invited, state => ({ ...state, volunteers: [invited] }));
  const position = { id: 'synthetic-position', name: '合成接待岗位', zone: 'A', location: '合成位置', lead: '合成负责人', description: '', status: 'active' };
  await change('position_upsert', position, state => ({ ...state, positions: [position] }));
  const shift = { id: 'synthetic-shift', positionId: position.id, start: '09:00', end: '10:00', required: 2, status: 'active', sessionId: '', boothId: '' };
  await change('shift_upsert', shift, state => ({ ...state, shifts: [shift] }));
  const confirmed = { ...invited, workflowStatus: 'confirmed' };
  await change('volunteer_upsert', confirmed, state => ({ ...state, volunteers: [confirmed] }));
  const assignment = { id: 'synthetic-assignment', volunteerId: volunteer.id, shiftId: shift.id, status: 'confirmed' };
  await change('assignment_upsert', assignment, state => ({ ...state, assignments: [assignment] }));
  const cancelled = { ...shift, status: 'cancelled' };
  await change('shift_upsert', cancelled, state => ({ ...state, shifts: [cancelled] }));
  const declined = { ...confirmed, workflowStatus: 'declined', notes: PRIVATE + ': retained after withdrawal' };
  await change('volunteer_upsert', declined, state => ({ ...state, volunteers: [declined] }));
  const details = { volunteerIds: [volunteer.id], includeContact: false, sha256: 'a'.repeat(64) };
  await change('export', { volunteerIds: [volunteer.id], includeContact: false }, state => state, details);
  // Unrelated live state is deliberately outside the configured backup inventory.
  await objects.putImmutable('cms/v1/sessions/synthetic-session.json', Buffer.from(PRIVATE));
  await objects.putImmutable('cms/v1/volunteers/other-event/unrelated.json', Buffer.from(PRIVATE));
  const auditJournal = createObjectJournal({ objects, prefix: 'cms/v1/maintenance' });
  const audit = createMaintenanceAuditStore({ journal: auditJournal, clock: now });
  const key = generateBackupKey(), encryptionKey = key.toString('base64url');
  const options = { enabled: true, auth, objects, journalPrefixes: [PREFIX, 'cms/v1/maintenance'], audit, clock: now };
  const keys = await collectJournalBackupKeys({ objects, journalPrefixes: [PREFIX] });
  return { objects, journal, repository, history, key, encryptionKey, keys, audit, options, api: createMaintenanceApi(options) };
}

test('staff backup preserves volunteer communication, arrangements, cancellations and every audited history revision in encrypted isolated recovery', async () => {
  const f = await fixture();
  assert.equal(f.history.length, 9); assert.equal(f.keys.length, 10);
  const sourceBytes = new Map(f.keys.map(key => [key, Buffer.from(f.objects.files.get(key).data)]));
  const response = await f.api(request('/api/admin/maintenance/backup', { encryptionKey: f.encryptionKey, confirmation: 'CREATE_ENCRYPTED_BACKUP' }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('x-backup-object-count'), '10');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const bundle = Buffer.from(await response.arrayBuffer());
  assert.equal(bundle.includes(Buffer.from(PRIVATE)), false); assert.equal(bundle.includes(Buffer.from(PREFIX)), false);
  assert.equal(bundle.includes(Buffer.from(f.encryptionKey)), false);
  const inspection = inspectEncryptedObjectBackup({ bundle, key: f.key, includeObjects: true });
  assert.deepEqual(inspection.objects.map(item => item.key).sort(), f.keys);
  const oldNotes = inspection.objects.filter(item => item.key.includes('/blobs/')).map(item => JSON.parse(Buffer.from(item.dataBase64, 'base64')));
  assert.ok(oldNotes.some(state => state.volunteers[0].workflowStatus === 'invited' && state.volunteers[0].notes === PRIVATE));
  assert.ok(oldNotes.some(state => state.shifts[0]?.status === 'active' && state.assignments[0]?.status === 'confirmed'));
  assert.equal((await f.audit.readSafe()).count, 1);
  const beforeRestore = f.objects.calls.length;
  const restored = await f.api(request('/api/admin/maintenance/restore', { encryptionKey: f.encryptionKey, bundleBase64: bundle.toString('base64'),
    restoreId: 'synthetic-volunteer-recovery', confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' }));
  assert.equal(restored.status, 200);
  const result = await restored.json();
  assert.equal(result.active, false); assert.equal(result.sessionsRestored, false); assert.equal(result.objectCount, 10);
  assert.equal(result.namespace, 'cms/v1/restores/synthetic-volunteer-recovery');
  const isolatedPrefix = result.namespace + '/volunteers/' + EVENT;
  const recovered = createVolunteerRepository({ eventId: EVENT, clock: now, journal: createObjectJournal({ objects: f.objects, prefix: isolatedPrefix }) });
  assert.deepEqual(await recovered.read(), f.history.at(-1));
  // Re-open every historical cursor through the real repository, rather than only comparing the latest state.
  const logKey = isolatedPrefix + '/commits.jsonl', completeLog = f.objects.files.get(logKey);
  const lines = completeLog.data.toString('utf8').trimEnd().split('\n');
  assert.equal(lines.length, f.history.length);
  for (const [index, state] of f.history.entries()) {
    const historyObjects = { ...f.objects, async get(key, options) {
      if (key === logKey) return { ...completeLog, data: Buffer.from(lines.slice(0, index + 1).join('\n') + '\n') };
      return f.objects.get(key, options);
    } };
    const historical = createVolunteerRepository({ eventId: EVENT, clock: now, journal: createObjectJournal({ objects: historyObjects, prefix: isolatedPrefix }) });
    assert.deepEqual(await historical.read(), state);
  }
  for (const [key, bytes] of sourceBytes) {
    assert.deepEqual(f.objects.files.get(key).data, bytes);
    assert.deepEqual(f.objects.files.get(result.namespace + '/' + key.slice('cms/v1/'.length)).data, bytes);
  }
  assert.ok(f.objects.calls.slice(beforeRestore).filter(call => call.operation !== 'get')
    .every(call => call.key.startsWith(result.namespace + '/') || call.key.startsWith('cms/v1/maintenance/')));
  assert.equal([...f.objects.files.keys()].some(key => key.startsWith(result.namespace + '/sessions/')), false);
  assert.equal((await f.audit.readSafe()).count, 3);
});

test('volunteer backup refuses a missing historical snapshot and never records a completed backup', async () => {
  const f = await fixture();
  const firstBlob = f.keys.find(key => key.includes('/blobs/') && JSON.parse(f.objects.files.get(key).data).revision === 1);
  assert.ok(firstBlob); f.objects.files.delete(firstBlob);
  const response = await f.api(request('/api/admin/maintenance/backup', { encryptionKey: f.encryptionKey, confirmation: 'CREATE_ENCRYPTED_BACKUP' }));
  assert.equal(response.status, 422); assert.equal((await response.json()).error.code, 'BACKUP_INVALID');
  assert.equal((await f.audit.readSafe()).count, 0);
});

test('maintenance accepts only the configured exact volunteer event and rejects foreign-event recovery before writes', async () => {
  const f = await fixture();
  for (const prefix of ['cms/v1/volunteers', PREFIX + '/state', PREFIX + '/nested', 'cms/v1/volunteers/../content']) {
    assert.throws(() => createMaintenanceApi({ ...f.options, journalPrefixes: [prefix] }), TypeError);
  }
  const backup = await createEncryptedObjectBackup({ objects: f.objects, keys: f.keys, key: f.key, clock: now });
  const otherApi = createMaintenanceApi({ ...f.options, journalPrefixes: ['cms/v1/volunteers/other-event'] });
  const calls = f.objects.calls.length;
  const response = await otherApi(request('/api/admin/maintenance/restore', { encryptionKey: f.encryptionKey, bundleBase64: backup.bundle.toString('base64'),
    restoreId: 'synthetic-foreign-event', confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' }));
  assert.equal(response.status, 422); assert.equal((await response.json()).error.code, 'BACKUP_INVALID');
  assert.equal(f.objects.calls.length, calls); assert.equal((await f.audit.readSafe()).count, 0);
  assert.equal([...f.objects.files.keys()].some(key => key.startsWith('cms/v1/restores/')), false);
});
