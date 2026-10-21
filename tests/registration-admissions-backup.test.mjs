import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { collectJournalBackupKeys, createEncryptedObjectBackup, generateBackupKey,
  inspectEncryptedObjectBackup, restoreEncryptedBackupIsolated } from '../functions/registration-admin/maintenance.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const EVENT = 'synthetic-admission-backup', ORIGIN = 'https://backup.example.invalid';
const PREFIX = `cms/v1/registrations/${EVENT}`, INDEX = PREFIX + '/index';
const actor = { id: 'synthetic-backup-admin', roles: ['superadmin'] };
const now = () => Date.parse('2026-10-20T04:00:00.000Z');
const hash = value => createHash('sha256').update(value).digest('hex');
const operationId = () => randomBytes(32).toString('base64url');
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00Z', closesAt: '2026-12-05T04:00:00Z', privacy: {
  version: 'synthetic-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成登记测试',
  storageRegion: '合成地区', retention: '合成期限', rightsRequest: '通过合成渠道提出申请', sharing: '合成资料不对外分享' } };
const fields = { name: '合成历史来宾', city: '合成城市', organization: '合成团队', position: '开发者', email: 'synthetic@example.invalid',
  categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' };
function serviceFor(objects) {
  return createRegistrationService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), policy, capacity: 3,
    staffReserve: 1, waitlistEnabled: true, allowedOrigins: [ORIGIN], clock: now,
    tokenSecret: 'SYNTHETIC-ADMISSION-BACKUP-TOKEN-KEY-ONLY', isWithdrawn: async () => false });
}
const writeCount = objects => objects.calls.filter(call => call.operation !== 'get').length;
const copyFiles = objects => new Map([...objects.files].map(([key, object]) => [key, { ...object, data: Buffer.from(object.data) }]));
async function mutate(service, method, input) {
  const current = await service.getAdmissions({ actor });
  const result = await service[method]({ actor, expectedRevision: current.revision, operationId: operationId(), ...input });
  assert.equal(result.outcome, 'updated');
  return result;
}
async function publicRegistration(service, name) {
  const idempotencyKey = operationId(), token = await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey });
  assert.equal(token.outcome, 'issued');
  const saved = await service.submit({ origin: ORIGIN, idempotencyKey, submissionToken: token.submissionToken,
    payload: { eventId: EVENT, fields: { ...fields, name }, consent: { accepted: true, version: policy.privacy.version } } });
  assert.equal(saved.outcome, 'created');
  return saved.receipt;
}

async function historyFixture() {
  const objects = memoryObjects(), at = new Date(now()).toISOString(), legacyId = 'L'.repeat(43);
  const legacyRecord = { schemaVersion: 1, kind: 'registration', id: legacyId, eventId: EVENT, submittedAt: at, fields,
    consent: { accepted: true, version: policy.privacy.version, acceptedAt: at }, provenance: { kind: 'public' } };
  const legacyBytes = Buffer.from(JSON.stringify(legacyRecord)), legacyHash = hash(legacyBytes), legacyKey = PREFIX + '/records/' + legacyHash + '.json';
  await objects.putImmutable(legacyKey, legacyBytes, { contentType: 'application/json' });
  const journal = createObjectJournal({ objects, prefix: INDEX });
  await journal.commit((await journal.read()).cursor, { schemaVersion: 1, kind: 'registration_index', eventId: EVENT, revision: 1,
    entries: [{ id: legacyId, keyHash: hash('synthetic-old-key'), payloadHash: hash('synthetic-old-payload'), recordHash: legacyHash, committedAt: at }] });
  const original = copyFiles(objects), originalWrites = writeCount(objects), service = serviceFor(objects);
  assert.equal((await service.metadata()).enabled, true);
  assert.equal((await service.getAdmissionStatus(legacyId)).status, 'confirmed');
  assert.equal((await service.getAdmissions({ actor })).people.length, 1);
  assert.equal((await service.repository.readIndex()).value.schemaVersion, 1);
  assert.equal(writeCount(objects), originalWrites); assert.deepEqual(copyFiles(objects), original);

  await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 1, waitlistEnabled: true } });
  const confirmed = await publicRegistration(service, '合成已确认来宾');
  const pending = await publicRegistration(service, '合成候补来宾');
  assert.equal(confirmed.admissionStatus, 'confirmed'); assert.equal(pending.admissionStatus, 'waitlisted');
  const staffOperation = operationId(), beforeStaff = await service.getAdmissions({ actor });
  const staff = await service.addStaffMember({ actor, expectedRevision: beforeStaff.revision, operationId: staffOperation,
    input: { fields: { name: '合成工作人员', wechat: 'synthetic-staff-contact' }, kind: 'crew', permissionReference: '合成线下登记明确授权' } });
  assert.equal(staff.outcome, 'updated'); assert.equal(staff.receipt.admissionStatus, 'confirmed');
  const team = await mutate(service, 'saveAdmissionTeam', { team: { name: '合成协作团队', memberIds: [legacyId, staff.registrationId] } });
  await mutate(service, 'setAdmissionKind', { registrationId: pending.registrationId, kind: 'crew' });
  const withdrawn = await mutate(service, 'withdrawAdmission', { registrationId: legacyId });
  assert.deepEqual(withdrawn.promotedIds, [pending.registrationId]);
  await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 0, waitlistEnabled: false } });
  const latest = await service.repository.readIndex(), admissions = await service.getAdmissions({ actor });
  assert.equal(latest.value.schemaVersion, 2); assert.equal(latest.value.entries.length, 4);
  assert.ok(latest.value.revision > latest.value.entries.length);
  assert.equal(admissions.summary.confirmedCount, 3); assert.equal(admissions.summary.withdrawnCount, 1);
  assert.deepEqual(admissions.settings, { capacity: 3, staffReserve: 0, waitlistEnabled: false });
  assert.deepEqual(admissions.teams, [{ id: team.teamId, name: '合成协作团队', memberIds: [legacyId, staff.registrationId] }]);
  assert.deepEqual(objects.files.get(legacyKey).data, legacyBytes);
  const records = await service.repository.list(), staffRecord = records.registrations.find(record => record.id === staff.registrationId);
  assert.deepEqual(staffRecord.consent, { accepted: false, version: null, acceptedAt: null });
  assert.deepEqual(staffRecord.provenance, { kind: 'staff_entry', actorId: actor.id, recordedAt: at,
    permissionReference: '合成线下登记明确授权', operationId: staffOperation });
  assert.deepEqual(staffRecord.fields, { name: '合成工作人员', wechat: 'synthetic-staff-contact' });
  // Unrelated session state and the real service's rate-limit journals are deliberately outside the inventory.
  await objects.putImmutable('cms/v1/sessions/synthetic-revoked-session.json', Buffer.from('{"revoked":true}'), { contentType: 'application/json' });
  assert.ok([...objects.files.keys()].some(key => key.includes('/limits/')));
  const lines = objects.files.get(INDEX + '/commits.jsonl').data.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  const snapshotKeys = lines.map(entry => INDEX + '/blobs/' + entry.valueHash + '.json');
  assert.equal(snapshotKeys.length, latest.value.revision);
  const snapshots = snapshotKeys.map(key => JSON.parse(objects.files.get(key).data.toString('utf8')));
  assert.equal(snapshots[0].schemaVersion, 1);
  assert.ok(snapshots.some(snapshot => snapshot.admissions?.people[pending.registrationId]?.status === 'waitlisted'));
  assert.ok(snapshots.some(snapshot => snapshot.admissions?.audit.some(entry => entry.action === 'team_save')));
  const recordKeys = latest.value.entries.map(entry => PREFIX + '/records/' + entry.recordHash + '.json');
  return { objects, latest, admissions, records, legacyKey, legacyBytes, snapshotKeys, recordKeys };
}

test('full v2 admission history and staff provenance survive encrypted backup and read-only isolated restore', async () => {
  const f = await historyFixture(), sourceBefore = copyFiles(f.objects), sourceWrites = writeCount(f.objects);
  const keys = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [INDEX] });
  const expectedKeys = [INDEX + '/commits.jsonl', ...f.snapshotKeys, ...f.recordKeys].sort();
  assert.deepEqual(keys, expectedKeys);
  assert.ok(keys.every(key => !/(?:^|\/)(?:sessions|limits)(?:\/|$)/u.test(key)));
  const key = generateBackupKey(), backup = await createEncryptedObjectBackup({ objects: f.objects, keys, key, clock: now });
  assert.equal(backup.encrypted, true); assert.equal(backup.independentBackup, false); assert.equal(backup.objectCount, expectedKeys.length);
  assert.equal(backup.backupHash, hash(backup.bundle));
  assert.equal(backup.bundle.includes(Buffer.from('synthetic-staff-contact')), false);
  const manifest = inspectEncryptedObjectBackup({ bundle: backup.bundle, key, includeObjects: true });
  assert.deepEqual(manifest.objects.map(item => item.key), expectedKeys);
  for (const item of manifest.objects) {
    assert.equal(item.sha256, hash(sourceBefore.get(item.key).data));
    assert.deepEqual(Buffer.from(item.dataBase64, 'base64'), sourceBefore.get(item.key).data);
  }

  const destination = memoryObjects();
  const result = await restoreEncryptedBackupIsolated({ objects: destination, bundle: backup.bundle, key, restoreId: 'synthetic-admission-v2-restore' });
  assert.equal(result.restored, true); assert.equal(result.active, false); assert.equal(result.sessionsRestored, false);
  assert.equal(result.objectCount, expectedKeys.length); assert.equal(result.manifestHash, backup.manifestHash);
  assert.equal(destination.files.size, expectedKeys.length + 1); // Atomic namespace claim plus the complete inventory.
  assert.ok([...destination.files.keys()].every(name => name.startsWith(result.namespace + '/')));
  assert.ok([...destination.files.keys()].every(name => !/(?:^|\/)(?:sessions|limits)(?:\/|$)/u.test(name)));
  const restoredKey = name => result.namespace + '/' + name.slice('cms/v1/'.length);
  for (const name of expectedKeys) assert.deepEqual(destination.files.get(restoredKey(name)), sourceBefore.get(name));
  assert.deepEqual(destination.files.get(restoredKey(f.legacyKey)).data, f.legacyBytes);

  // Only a test-side read mapping addresses the isolated namespace; production prefixes and activation are untouched.
  const readOnly = { get: (name, options) => destination.get(restoredKey(name), options),
    putImmutable: async () => assert.fail('Reading restored history must not write or activate it.'),
    append: async () => assert.fail('Reading restored history must not append or activate it.') };
  const restoredService = serviceFor(readOnly), destinationWrites = writeCount(destination);
  assert.deepEqual(await restoredService.repository.readIndex(), f.latest);
  assert.deepEqual(await restoredService.getAdmissions({ actor }), f.admissions);
  assert.deepEqual(await restoredService.repository.list(), f.records);
  for (const person of f.admissions.people) assert.equal((await restoredService.getAdmissionStatus(person.registrationId)).status, person.status);
  assert.equal(writeCount(destination), destinationWrites);
  assert.equal(writeCount(f.objects), sourceWrites); assert.deepEqual(copyFiles(f.objects), sourceBefore);
});

test('v2 backup cannot discard an old index snapshot or immutable person while retaining the latest view', async () => {
  const f = await historyFixture(), keys = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [INDEX] }), key = generateBackupKey();
  const rejectIncomplete = missing => assert.rejects(createEncryptedObjectBackup({ objects: f.objects,
    keys: keys.filter(name => name !== missing), key, clock: now }), error => error.code === 'BACKUP_INVALID');
  await rejectIncomplete(f.snapshotKeys[0]);
  await rejectIncomplete(f.recordKeys[0]);
  assert.deepEqual(f.objects.files.get(f.legacyKey).data, f.legacyBytes);
});
