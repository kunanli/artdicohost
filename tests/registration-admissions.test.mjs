import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const EVENT = 'synthetic-admissions', ORIGIN = 'https://admissions.example.invalid';
const actor = { id: 'synthetic-admin', roles: ['superadmin'] }, reviewer = { id: 'synthetic-reviewer', roles: ['reviewer'] };
const key = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00Z', closesAt: '2026-12-05T04:00:00Z', privacy: {
  version: 'synthetic-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成参会登记', storageRegion: '合成地区',
  retention: '合成期限', rightsRequest: '通过合成邮箱申请查阅、更正及删除', sharing: '合成资料不对外分享' } };
const fields = { name: '合成来宾', city: '合成城市', organization: '合成团队', position: '开发者', email: 'synthetic@example.invalid', categories: ['industry'],
  participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' };
function fixture(options = {}) {
  const remote = objectFixture(), state = { now: Date.parse('2026-10-20T04:00:00Z'), loseAck: false, indexWrites: 0, withdrawn: new Set(), reviewFailure: false };
  const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
  const objects = { ...base, async append(path, position, bytes) {
    const ack = await base.append(path, position, bytes);
    if (path.endsWith('/index/commits.jsonl')) { state.indexWrites++; if (state.loseAck) { state.loseAck = false; throw new Error('PRIVATE-UNKNOWN-ACK'); } }
    return ack;
  } };
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  function service(patch = {}) { return createRegistrationService({ objects, journalFor, policy, capacity: 2, waitlistEnabled: true,
    allowedOrigins: [ORIGIN], tokenSecret: 'SYNTHETIC-PRIVATE-ADMISSIONS-SHARED-KEY-ONLY', clock: () => state.now,
    isWithdrawn: async id => { if (state.reviewFailure) throw new Error('PRIVATE-REVIEW'); return state.withdrawn.has(id); },
    groupInviteProvider: async () => ({ marker: 'synthetic-confirmed-only' }), ...options, ...patch }); }
  return { state, remote, objects, journalFor, service };
}
async function prepare(service, idempotencyKey = key()) {
  const token = await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey });
  assert.equal(token.outcome, 'issued');
  return { origin: ORIGIN, idempotencyKey, submissionToken: token.submissionToken, payload: { eventId: EVENT, fields, consent: { accepted: true, version: policy.privacy.version } } };
}
async function register(service) { const input = await prepare(service); return { input, saved: await service.submit(input) }; }
async function mutate(service, method, patch = {}, operationId = key()) {
  const current = await service.getAdmissions({ actor });
  return service[method]({ actor, expectedRevision: current.revision, operationId, ...patch });
}

test('independent instances race for one actual seat; full waitlist is durably saved and gets no group invite', async () => {
  const f = fixture({ capacity: 1 }), a = f.service(), b = f.service();
  const inputs = await Promise.all([prepare(a), prepare(b)]);
  const saved = await Promise.all([a.submit(inputs[0]), b.submit(inputs[1])]);
  assert.deepEqual(saved.map(x => x.receipt.admissionStatus).sort(), ['confirmed', 'waitlisted']);
  for (const value of saved) { assert.equal(value.outcome, 'created'); assert.equal(value.receipt.committed, true); assert.equal(value.groupInvite === null, value.receipt.admissionStatus === 'waitlisted'); }
  const snapshot = await f.service().getAdmissions({ actor });
  assert.equal(snapshot.summary.confirmedCount, 1); assert.equal(snapshot.summary.waitlistCount, 1); assert.equal(snapshot.summary.totalRegistered, 2);
  assert.equal((await a.metadata()).enabled, true);
  assert.equal(JSON.stringify(snapshot).includes(fields.email), false);
});

test('staff reserve and crew share total capacity; no name change can overfill the public pool', async () => {
  const f = fixture({ capacity: 3, staffReserve: 1 }), service = f.service();
  const attendees = await Promise.all([register(service), register(service), register(service)]);
  const pending = attendees.find(x => x.saved.receipt.admissionStatus === 'waitlisted').saved.receipt.registrationId;
  const result = await mutate(service, 'setAdmissionKind', { registrationId: pending, kind: 'crew' });
  assert.equal(result.outcome, 'updated'); assert.deepEqual(result.promotedIds, [pending]);
  assert.equal(result.summary.confirmedCount, 3); assert.equal(result.summary.crewConfirmedCount, 1);
  assert.equal((await mutate(service, 'setAdmissionKind', { registrationId: pending, kind: 'attendee' })).outcome, 'capacity_conflict');
  assert.equal((await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 2, waitlistEnabled: true } })).outcome, 'capacity_conflict');
  assert.equal((await service.getAdmissions({ actor })).summary.confirmedCount, 3);
});

test('cancellation releases once and promotes FIFO, and old immutable payload replays its latest admission status', async () => {
  const f = fixture({ capacity: 1 }), service = f.service();
  const first = await register(service), second = await register(service), third = await register(service);
  const before = await service.getAdmissions({ actor }), operationId = key();
  const command = { actor: reviewer, expectedRevision: before.revision, operationId, registrationId: first.saved.receipt.registrationId };
  const released = await service.withdrawAdmission(command);
  assert.equal(released.outcome, 'updated'); assert.deepEqual(released.promotedIds, [second.saved.receipt.registrationId]);
  const writes = f.state.indexWrites;
  assert.equal((await f.service().withdrawAdmission(command)).outcome, 'replayed'); assert.equal(f.state.indexWrites, writes);
  assert.equal((await mutate(service, 'withdrawAdmission', { registrationId: first.saved.receipt.registrationId })).promotedIds.length, 0);
  const replay = await service.submit(second.input);
  assert.equal(replay.outcome, 'replayed'); assert.equal(replay.receipt.admissionStatus, 'confirmed'); assert.ok(replay.groupInvite);
  assert.equal((await service.submit(first.input)).outcome, 'withdrawn');
  assert.equal((await service.getAdmissionStatus(third.saved.receipt.registrationId)).status, 'waitlisted');
});

test('concurrent cancellation and settings update have one CAS winner; manual operation replay cannot double promote', async () => {
  const f = fixture({ capacity: 1 }), a = f.service(), b = f.service(), first = await register(a), second = await register(a);
  const before = await a.getAdmissions({ actor });
  const results = await Promise.all([a.withdrawAdmission({ actor, expectedRevision: before.revision, operationId: key(), registrationId: first.saved.receipt.registrationId }),
    b.setAdmissionSettings({ actor, expectedRevision: before.revision, operationId: key(), settings: { staffReserve: 0, waitlistEnabled: false } })]);
  assert.deepEqual(results.map(x => x.outcome).sort(), ['conflict', 'updated']);
  const after = await a.getAdmissions({ actor }); assert.equal(after.summary.confirmedCount, 1);
  if ((await a.getAdmissionStatus(first.saved.receipt.registrationId)).status === 'confirmed') {
    const done = await mutate(a, 'withdrawAdmission', { registrationId: first.saved.receipt.registrationId }); assert.deepEqual(done.promotedIds, [second.saved.receipt.registrationId]);
  }
});

test('unknown cancellation ACK never retries automatically and same durable operation recovers the committed FIFO result', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(), first = await register(service), second = await register(service);
  const before = await service.getAdmissions({ actor }), command = { actor, expectedRevision: before.revision, operationId: key(), registrationId: first.saved.receipt.registrationId };
  f.state.loseAck = true; const writes = f.state.indexWrites;
  assert.deepEqual(await service.withdrawAdmission(command), { outcome: 'unavailable' }); assert.equal(f.state.indexWrites, writes + 1);
  const recovered = await f.service().withdrawAdmission(command);
  assert.equal(recovered.outcome, 'replayed'); assert.deepEqual(recovered.promotedIds, [second.saved.receipt.registrationId]); assert.equal(f.state.indexWrites, writes + 1);
  assert.equal((await service.withdrawAdmission({ ...command, registrationId: second.saved.receipt.registrationId })).outcome, 'conflict');
});

test('withdrawn waitlist is never promoted or revived; review failure blocks an otherwise eligible promotion', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(), first = await register(service), second = await register(service), third = await register(service);
  f.state.withdrawn.add(second.saved.receipt.registrationId);
  const release = await mutate(service, 'withdrawAdmission', { registrationId: first.saved.receipt.registrationId });
  assert.deepEqual(release.promotedIds, [third.saved.receipt.registrationId]);
  assert.equal((await service.getAdmissionStatus(second.saved.receipt.registrationId)).status, 'withdrawn');
  assert.equal((await mutate(service, 'setAdmissionKind', { registrationId: second.saved.receipt.registrationId, kind: 'crew' })).outcome, 'forbidden');
  assert.equal((await service.submit(second.input)).outcome, 'withdrawn');
  f.state.reviewFailure = true;
  assert.equal((await mutate(service, 'setAdmissionKind', { registrationId: third.saved.receipt.registrationId, kind: 'crew' })).outcome, 'unavailable');
  await assert.rejects(service.getAdmissionStatus(third.saved.receipt.registrationId), /storage is unavailable/u);
});

test('review withdrawal immediately denies confirmed receipt and invitation even before conservative seat release', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(), first = await register(service);
  f.state.withdrawn.add(first.saved.receipt.registrationId);
  assert.equal((await service.getAdmissionStatus(first.saved.receipt.registrationId)).status, 'withdrawn');
  assert.equal((await service.submit(first.input)).outcome, 'withdrawn');
  assert.equal((await service.getAdmissions({ actor })).summary.confirmedCount, 1);
  assert.equal((await mutate(service, 'withdrawAdmission', { registrationId: first.saved.receipt.registrationId })).summary.confirmedCount, 0);
});

test('individual team links neither create anonymous seats nor duplicate membership', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(), first = await register(service), second = await register(service);
  const ids = [first.saved.receipt.registrationId, second.saved.receipt.registrationId];
  const team = await mutate(service, 'saveAdmissionTeam', { team: { name: '合成团队', memberIds: ids } });
  assert.equal(team.outcome, 'updated'); assert.equal(team.summary.totalRegistered, 2); assert.equal(team.summary.confirmedCount, 1);
  assert.equal(team.people.every(person => person.teamId === team.teamId), true);
  assert.equal((await mutate(service, 'saveAdmissionTeam', { team: { name: '重复成员', memberIds: [ids[0]] } })).outcome, 'conflict');
  assert.equal((await mutate(service, 'saveAdmissionTeam', { team: { name: '虚构成员', memberIds: [key()] } })).outcome, 'invalid');
  const removed = await mutate(service, 'removeAdmissionTeam', { teamId: team.teamId });
  assert.equal(removed.people.every(person => person.teamId === ''), true); assert.equal(removed.summary.confirmedCount, 1);
});

test('manual staff entry uses durable operation provenance and actual partial facts, without public consent', async () => {
  const f = fixture({ capacity: 2, staffReserve: 1 }), service = f.service(); await register(service);
  const before = await service.getAdmissions({ actor }), command = { actor, expectedRevision: before.revision, operationId: key(),
    input: { fields: { name: '合成工作人员', wechat: 'synthetic-contact' }, permissionReference: '合成线下登记授权', kind: 'crew' } };
  const added = await service.addStaffMember(command); assert.equal(added.outcome, 'updated'); assert.equal(added.receipt.admissionStatus, 'confirmed');
  const writes = f.state.indexWrites; assert.equal((await f.service().addStaffMember(command)).outcome, 'replayed'); assert.equal(f.state.indexWrites, writes);
  const record = (await service.repository.list()).registrations.find(person => person.id === added.registrationId);
  assert.deepEqual(record.consent, { accepted: false, acceptedAt: null, version: null });
  assert.equal(record.provenance.kind, 'staff_entry'); assert.equal(record.provenance.operationId, command.operationId); assert.equal(Object.hasOwn(record.fields, 'organization'), false);
  f.state.withdrawn.add(added.registrationId);
  assert.equal((await service.addStaffMember(command)).receipt.admissionStatus, 'withdrawn');
  assert.equal((await service.addStaffMember({ ...command, actor: reviewer, operationId: key() })).outcome, 'forbidden');
  assert.equal((await mutate(service, 'setAdmissionSettings', { actor: reviewer, settings: { staffReserve: 0, waitlistEnabled: true } })).outcome, 'forbidden');
});

test('persisted settings override later constructor defaults; waitlist-off blocks only new full intake', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(); const first = await register(service), second = await register(service);
  await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 0, waitlistEnabled: false } });
  const restarted = f.service({ waitlistEnabled: true });
  assert.equal((await restarted.metadata()).enabled, false);
  assert.equal((await restarted.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: key() })).outcome, 'closed');
  const release = await mutate(restarted, 'withdrawAdmission', { registrationId: first.saved.receipt.registrationId });
  assert.deepEqual(release.promotedIds, [second.saved.receipt.registrationId]);
  await mutate(restarted, 'withdrawAdmission', { registrationId: second.saved.receipt.registrationId });
  assert.equal((await restarted.metadata()).enabled, true);
});

test('old v1 accepted records remain immutable and readable when the shared admission index upgrades', async () => {
  const f = fixture({ capacity: 2 }), id = key(), at = new Date(f.state.now).toISOString();
  const record = { schemaVersion: 1, kind: 'registration', id, eventId: EVENT, submittedAt: at, fields, consent: { accepted: true, version: policy.privacy.version, acceptedAt: at }, provenance: { kind: 'public' } };
  const bytes = Buffer.from(JSON.stringify(record)), recordHash = hash(bytes), prefix = `cms/v1/registrations/${EVENT}`;
  await f.objects.putImmutable(`${prefix}/records/${recordHash}.json`, bytes, { contentType: 'application/json' });
  const second = { ...record, id: key() }, secondBytes = Buffer.from(JSON.stringify(second)), secondHash = hash(secondBytes);
  await f.objects.putImmutable(`${prefix}/records/${secondHash}.json`, secondBytes, { contentType: 'application/json' });
  const journal = f.journalFor(prefix + '/index'), empty = await journal.read();
  await journal.commit(empty.cursor, { schemaVersion: 1, kind: 'registration_index', eventId: EVENT, revision: 1,
    entries: [{ id, keyHash: hash('old-key'), payloadHash: hash('old-payload'), recordHash, committedAt: at }] });
  const v1 = await journal.read();
  await journal.commit(v1.cursor, { ...v1.value, revision: 2, entries: [...v1.value.entries,
    { id: second.id, keyHash: hash('old-key-2'), payloadHash: hash('old-payload-2'), recordHash: secondHash, committedAt: at }] });
  const before = Buffer.from(f.remote.stored.get(`${prefix}/records/${recordHash}.json`).data);
  const service = f.service({ staffReserve: 2 }); assert.equal((await service.getAdmissionStatus(id)).status, 'confirmed');
  assert.equal((await service.getAdmissions({ actor })).settings.staffReserve, 0);
  assert.equal((await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 2, waitlistEnabled: true } })).outcome, 'capacity_conflict');
  const upgraded = await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 0, waitlistEnabled: true } });
  assert.equal(upgraded.outcome, 'updated'); assert.equal(upgraded.revision, 3);
  assert.equal((await service.repository.readIndex()).value.schemaVersion, 2);
  assert.deepEqual(f.remote.stored.get(`${prefix}/records/${recordHash}.json`).data, before);
  assert.equal((await service.repository.list()).registrations[0].fields.email, fields.email);
});

test('restored malformed or oversized admission state fails closed without leaking partial registration data', async () => {
  const f = fixture(), service = f.service(); await register(service);
  const journal = f.journalFor(`cms/v1/registrations/${EVENT}/index`), current = await journal.read();
  current.value.admissions.people[Object.keys(current.value.admissions.people)[0]].status = 'invented';
  current.value.revision++;
  await journal.commit(current.cursor, current.value);
  assert.deepEqual(await service.getAdmissions({ actor }), { outcome: 'unavailable' });
  assert.equal((await service.metadata()).enabled, false);
  await assert.rejects(service.repository.list(), /storage is unavailable/u);
  await assert.rejects(service.getAdmissionStatus(key()), error => !error.message.includes(fields.email));
});

test('FIFO chooses oldest eligible people while reserved capacity may admit pending crew ahead of ineligible attendees', async () => {
  const f = fixture({ capacity: 3, staffReserve: 1 }), service = f.service();
  await register(service); await register(service);
  const attendee = await register(service), crew = await register(service);
  const changed = await mutate(service, 'setAdmissionKind', { registrationId: crew.saved.receipt.registrationId, kind: 'crew' });
  assert.deepEqual(changed.promotedIds, [crew.saved.receipt.registrationId]);
  assert.equal((await service.getAdmissionStatus(attendee.saved.receipt.registrationId)).status, 'waitlisted');
  await mutate(service, 'withdrawAdmission', { registrationId: crew.saved.receipt.registrationId });
  const promoted = await mutate(service, 'setAdmissionSettings', { settings: { staffReserve: 0, waitlistEnabled: true } });
  assert.deepEqual(promoted.promotedIds, [attendee.saved.receipt.registrationId]);
});

test('unknown manual staff ACK recovers one person with the same provenance, and operation collisions cannot create another', async () => {
  const f = fixture({ capacity: 1 }), service = f.service(), command = { actor, expectedRevision: 0, operationId: key(),
    input: { fields: { name: '合成工作人员', email: 'staff@example.invalid' }, permissionReference: '合成登记授权', kind: 'crew' } };
  f.state.loseAck = true;
  assert.deepEqual(await service.addStaffMember(command), { outcome: 'unavailable' }); assert.equal(f.state.indexWrites, 1);
  const retry = await f.service().addStaffMember(command); assert.equal(retry.outcome, 'replayed'); assert.equal(retry.summary.totalRegistered, 1);
  assert.equal(f.state.indexWrites, 1);
  assert.equal((await service.addStaffMember({ ...command, input: { ...command.input, kind: 'attendee' } })).outcome, 'conflict');
  const current = await service.getAdmissions({ actor });
  assert.equal((await service.promoteAdmissions({ actor, expectedRevision: current.revision, operationId: command.operationId })).outcome, 'conflict');
});

test('one missing immutable person blocks authoritative admission proof and public receipt without false success', async () => {
  const f = fixture(), service = f.service(), registered = await register(service);
  const index = (await service.repository.readIndex()).value, entry = index.entries[0];
  f.remote.stored.delete(`cms/v1/registrations/${EVENT}/records/${entry.recordHash}.json`);
  await assert.rejects(service.getAdmissionStatus(registered.saved.receipt.registrationId), /storage is unavailable/u);
  assert.deepEqual(await service.submit(registered.input), { outcome: 'unavailable' });
});

test('review checks for candidate promotions are bounded to eight in flight and failure returns no partial mutation', async () => {
  const f = fixture({ capacity: 1 }), normal = f.service(), first = await register(normal);
  for (let i = 0; i < 12; i++) await register(normal);
  let active = 0, maximum = 0, started = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const checked = f.service({ isWithdrawn: async () => { started++; maximum = Math.max(maximum, ++active); await gate; active--; return false; } });
  const before = await normal.getAdmissions({ actor }), writes = f.state.indexWrites;
  const pending = checked.withdrawAdmission({ actor, expectedRevision: before.revision, operationId: key(), registrationId: first.saved.receipt.registrationId });
  for (let i = 0; i < 20 && started < 8; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(started, 8); assert.equal(maximum, 8); release();
  assert.equal((await pending).outcome, 'updated'); assert.equal(maximum, 8);
  assert.equal(f.state.indexWrites, writes + 1);
  const failing = f.service({ isWithdrawn: async () => { throw new Error('PRIVATE-REVIEW'); } });
  const after = await normal.getAdmissions({ actor });
  assert.deepEqual(await failing.promoteAdmissions({ actor, expectedRevision: after.revision, operationId: key() }), { outcome: 'unavailable' });
  assert.equal(f.state.indexWrites, writes + 1);
});
