import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createRegistrationService } from '../functions/registration-api/service.mjs';
import { admissionView, addAdmission, appendAdmissionAudit, transitionAdmission, operationResult } from '../functions/registration-api/admissions.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const EVENT = 'synthetic-application-review', ORIGIN = 'https://application.example.invalid';
const actor = { id: 'synthetic-reviewer', roles: ['reviewer'] };
const admin = { id: 'synthetic-admin', roles: ['superadmin'] };
const key = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const policy = { enabled: true, eventId: EVENT, opensAt: '2026-10-19T00:00:00Z', closesAt: '2026-12-05T04:00:00Z', privacy: {
  version: 'synthetic-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成申请', storageRegion: '合成地区',
  retention: '合成期限', rightsRequest: '通过合成邮箱申请更正及撤回', sharing: '合成资料不对外分享' } };
const fields = { name: '合成申请人', city: '合成城市', email: 'synthetic@example.invalid', categories: ['industry'],
  participationInterests: ['attend'], attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' };
function fixture(options = {}) {
  const base = memoryObjects(), state = { now: Date.parse('2026-10-20T04:00:00Z'), loseAck: false, indexWrites: 0, callbacks: [], invites: 0, withdrawn: new Set() };
  const objects = { ...base, async append(path, position, bytes) {
    const ack = await base.append(path, position, bytes);
    if (path.endsWith('/index/commits.jsonl')) {
      state.indexWrites++;
      if (state.loseAck) { state.loseAck = false; throw new Error('SYNTHETIC_PRIVATE_LOST_ACK'); }
    }
    return ack;
  } };
  const journalFor = prefix => createObjectJournal({ objects, prefix });
  const service = (patch = {}) => createRegistrationService({ objects, journalFor, eventId: EVENT, policy, capacity: 1, waitlistEnabled: true,
    tokenSecret: 'SYNTHETIC-APPLICATION-PRIVATE-KEY-ONLY', allowedOrigins: [ORIGIN], clock: () => state.now,
    isWithdrawn: async id => state.withdrawn.has(id),
    onSaved: async value => { state.callbacks.push(value); return { confirmationUrl: 'https://application.example.invalid/private-synthetic-link' }; },
    groupInviteProvider: async () => { state.invites++; return { marker: 'synthetic-confirmed-only' }; }, ...options, ...patch });
  return { objects, base, state, service, journalFor };
}
async function apply(service) {
  const idempotencyKey = key(), issued = await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey });
  assert.equal(issued.outcome, 'issued');
  const input = { origin: ORIGIN, idempotencyKey, submissionToken: issued.submissionToken,
    payload: { eventId: EVENT, fields, consent: { accepted: true, version: policy.privacy.version } } };
  const saved = await service.submit(input);
  assert.equal(saved.outcome, 'created'); assert.equal(saved.receipt.admissionStatus, 'pending_review');
  return { id: saved.receipt.registrationId, saved, input };
}
async function command(service, registrationId, method = 'approveApplication', operationId = key()) {
  const snapshot = await service.getAdmissions({ actor });
  const input = { actor, registrationId, expectedRevision: snapshot.revision, operationId };
  return { input, result: await service[method](input) };
}
const writes = objects => objects.calls.filter(call => call.operation !== 'get').length;

async function seedV2(f) {
  const prefix = `cms/v1/registrations/${EVENT}`, at = new Date(f.state.now).toISOString();
  const journal = f.journalFor(prefix + '/index'), originalRecords = new Map();
  const value = { schemaVersion: 2, kind: 'registration_index', eventId: EVENT, revision: 0, entries: [],
    admissions: { baseRevision: 0, settings: { capacity: 1, staffReserve: 0, waitlistEnabled: true }, people: {}, teams: [], audit: [] } };
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = key(), record = { schemaVersion: 1, kind: 'registration', id, eventId: EVENT, submittedAt: at, fields,
      consent: { accepted: true, version: policy.privacy.version, acceptedAt: at }, provenance: { kind: 'public' } };
    const bytes = Buffer.from(JSON.stringify(record)), recordHash = hash(bytes), path = prefix + '/records/' + recordHash + '.json';
    await f.objects.putImmutable(path, bytes, { contentType: 'application/json' }); originalRecords.set(path, bytes); ids.push(id);
    value.entries.push({ id, keyHash: hash('legacy-key-' + i), payloadHash: hash('legacy-payload-' + i), recordHash, committedAt: at });
    const status = i === 0 ? 'confirmed' : 'waitlisted';
    value.admissions.people[id] = { kind: 'attendee', status, queueNumber: i + 1, changedAt: at };
    value.revision++;
    value.admissions.audit.push({ revision: value.revision, action: 'intake', actorId: 'public', at, operationId: null,
      requestHash: hash('legacy-request-' + i), details: { kind: 'attendee', status },
      result: { registrationId: id, teamId: null, promotedIds: [], releasedIds: [] } });
    await journal.commit((await journal.read()).cursor, value);
  }
  value.revision++; value.admissions.people[ids[2]].status = 'withdrawn';
  value.admissions.audit.push({ revision: value.revision, action: 'withdraw', actorId: actor.id, at, operationId: key(), requestHash: hash('legacy-withdraw'), details: {},
    result: { registrationId: ids[2], teamId: null, promotedIds: [], releasedIds: [] } });
  await journal.commit((await journal.read()).cursor, value);
  return { ids, originalRecords, originalIndex: structuredClone(value) };
}

test('new legacy-form public submissions stay pending with zero seat allocation, FIFO effects, invitations or notification authority', async () => {
  const f = fixture({ waitlistEnabled: false }), service = f.service();
  const a = await apply(service), b = await apply(service);
  const snapshot = await service.getAdmissions({ actor });
  assert.equal(snapshot.summary.confirmedCount, 0); assert.equal(snapshot.summary.pendingReviewCount, 2); assert.equal(snapshot.summary.rejectedCount, 0);
  assert.equal(snapshot.summary.remainingPublic, 1); assert.equal(f.state.invites, 0);
  assert.ok(f.state.callbacks.every(value => value.notify === false));
  assert.ok(a.saved.confirmation.confirmationUrl); assert.ok(b.saved.confirmation.confirmationUrl);
  await service.promoteAdmissions({ actor, expectedRevision: snapshot.revision, operationId: key() });
  assert.equal((await service.getAdmissionStatus(a.id)).status, 'pending_review');
  const approved = await command(service, a.id); assert.equal(approved.result.outcome, 'updated');
  assert.equal((await service.metadata()).enabled, true); assert.equal((await service.metadata()).attendeeReviewRequired, true);
  assert.equal((await command(service, b.id)).result.outcome, 'capacity_conflict');
  assert.equal((await service.getAdmissionStatus(b.id)).status, 'pending_review');
  await apply(service);
});

test('two reviewers contend for the last seat without overselling; losing approval leaves its application pending when waitlist disabled', async () => {
  const f = fixture({ waitlistEnabled: false }), a = f.service(), b = f.service();
  const first = await apply(a), second = await apply(b), before = await a.getAdmissions({ actor });
  const commands = [first, second].map(item => ({ actor, expectedRevision: before.revision, operationId: key(), registrationId: item.id }));
  const results = await Promise.all([a.approveApplication(commands[0]), b.approveApplication(commands[1])]);
  assert.deepEqual(results.map(item => item.outcome).sort(), ['conflict', 'updated']);
  const loser = results.findIndex(item => item.outcome === 'conflict');
  assert.equal((await command(a, commands[loser].registrationId)).result.outcome, 'capacity_conflict');
  const after = await a.getAdmissions({ actor });
  assert.equal(after.summary.confirmedCount, 1); assert.equal(after.summary.pendingReviewCount, 1); assert.equal(after.summary.waitlistCount, 0);
});

test('approved waitlist entry order wins over original application order across later vacancies', async () => {
  const f = fixture(), service = f.service();
  const seat = await apply(service), olderPending = await apply(service), newer = await apply(service);
  await command(service, seat.id);
  await command(service, newer.id);
  await command(service, olderPending.id);
  const released = await command(service, seat.id, 'withdrawAdmission');
  assert.deepEqual(released.result.promotedIds, [newer.id]);
  assert.equal((await service.getAdmissionStatus(olderPending.id)).status, 'waitlisted');
  const next = await command(service, newer.id, 'withdrawAdmission');
  assert.deepEqual(next.result.promotedIds, [olderPending.id]);
});

test('approval prioritizes an existing approved waitlist even when its withdrawn seat is discovered during that approval', async () => {
  const f = fixture(), service = f.service(), seat = await apply(service), waiting = await apply(service), pending = await apply(service);
  await command(service, seat.id); await command(service, waiting.id);
  f.state.withdrawn.add(seat.id);
  const result = await command(f.service({ getWithdrawnIds: async () => [seat.id] }), pending.id);
  assert.deepEqual(result.result.releasedIds, [seat.id]);
  assert.deepEqual(result.result.promotedIds, [waiting.id]);
  assert.equal((await service.getAdmissionStatus(waiting.id)).status, 'confirmed');
  assert.equal(result.result.people.find(item => item.registrationId === pending.id).status, 'waitlisted');
});

test('decision ACK loss is unavailable once; exact retry proves original audit while returning current state after withdrawal', async () => {
  const f = fixture(), service = f.service(), application = await apply(service), snapshot = await service.getAdmissions({ actor });
  const input = { actor, registrationId: application.id, expectedRevision: snapshot.revision, operationId: key() };
  f.state.loseAck = true; const before = f.state.indexWrites;
  assert.deepEqual(await service.approveApplication(input), { outcome: 'unavailable' }); assert.equal(f.state.indexWrites, before + 1);
  const replay = await f.service().approveApplication(input);
  assert.equal(replay.outcome, 'replayed');
  assert.deepEqual(replay.operation, { operationId: input.operationId, action: 'approve', registrationId: application.id, revision: snapshot.revision + 1 });
  await command(service, application.id, 'withdrawAdmission');
  const latest = await f.service().approveApplication(input);
  assert.equal(latest.outcome, 'replayed'); assert.equal(latest.people.find(item => item.registrationId === application.id).status, 'withdrawn');
  assert.deepEqual(latest.operation, replay.operation);
  assert.equal((await service.approveApplication({ ...input, actor: admin })).outcome, 'conflict');
  assert.equal((await service.rejectApplication(input)).outcome, 'conflict');
  assert.equal(f.state.indexWrites, before + 2);
});

test('rejection retains original records and private receipts, cannot be approved or automatically revived, and review remains open after cutoff', async () => {
  const f = fixture(), service = f.service(), application = await apply(service), laterApproved = await apply(service);
  const records = new Map([...f.objects.files].filter(([path]) => path.includes('/records/')).map(([path, object]) => [path, Buffer.from(object.data)]));
  f.state.now = Date.parse(policy.closesAt) + 1000;
  const rejected = await command(service, application.id, 'rejectApplication'); assert.equal(rejected.result.outcome, 'updated');
  assert.equal(rejected.result.summary.rejectedCount, 1); assert.equal(rejected.result.summary.confirmedCount, 0);
  const approved = await command(service, laterApproved.id); assert.equal(approved.result.outcome, 'updated');
  assert.equal(approved.result.summary.confirmedCount, 1); assert.equal(approved.result.summary.pendingReviewCount, 0);
  assert.equal((await command(service, application.id)).result.outcome, 'conflict');
  const replay = await service.submit(application.input); assert.equal(replay.outcome, 'replayed'); assert.equal(replay.receipt.admissionStatus, 'rejected');
  assert.equal(replay.groupInvite, null); assert.ok(replay.confirmation.confirmationUrl);
  assert.equal((await service.issueToken({ eventId: EVENT, origin: ORIGIN, idempotencyKey: key() })).outcome, 'closed');
  for (const [path, bytes] of records) assert.deepEqual(f.objects.files.get(path).data, bytes);
  assert.ok(f.state.callbacks.every(value => value.notify === false));
});

test('legacy v2 statuses and immutable bytes survive read-only interpretation, v3 mutation and restart', async () => {
  const f = fixture(), legacy = await seedV2(f), service = f.service(), before = writes(f.objects);
  const snapshot = await service.getAdmissions({ actor });
  assert.deepEqual(snapshot.people.map(person => person.status), ['confirmed', 'waitlisted', 'withdrawn']);
  assert.equal(snapshot.summary.pendingReviewCount, 0); assert.equal(snapshot.summary.rejectedCount, 0);
  assert.deepEqual((await service.repository.readIndex()).value, legacy.originalIndex); assert.equal(writes(f.objects), before);
  const pending = await apply(service); assert.equal((await service.repository.readIndex()).value.schemaVersion, 3);
  assert.deepEqual((await service.getAdmissions({ actor })).people.slice(0, 3), snapshot.people);
  assert.equal((await f.service().getAdmissionStatus(pending.id)).status, 'pending_review');
  for (const [path, bytes] of legacy.originalRecords) assert.deepEqual(f.objects.files.get(path).data, bytes);
  assert.deepEqual((await service.repository.readIndex()).value.admissions.audit.slice(0, 4), legacy.originalIndex.admissions.audit);
});

test('unauthorized decisions touch no private storage and missing immutable applications cannot receive an admission decision', async () => {
  const f = fixture(), service = f.service(), application = await apply(service), before = f.objects.calls.length;
  assert.deepEqual(await service.approveApplication({ actor: { id: 'synthetic-editor', roles: ['editor'] }, registrationId: application.id, expectedRevision: 1, operationId: key() }), { outcome: 'forbidden' });
  assert.deepEqual(await service.rejectApplication({ actor: { id: 'synthetic-outreach', roles: ['outreach'] }, registrationId: application.id, expectedRevision: 1, operationId: key() }), { outcome: 'forbidden' });
  assert.equal(f.objects.calls.length, before);
  const entry = (await service.repository.readIndex()).value.entries[0], count = f.state.indexWrites;
  f.objects.files.delete(`cms/v1/registrations/${EVENT}/records/${entry.recordHash}.json`);
  assert.deepEqual((await command(service, application.id)).result, { outcome: 'unavailable' }); assert.equal(f.state.indexWrites, count);
  assert.equal((await service.getAdmissions({ actor })).summary.pendingReviewCount, 1);
});


test('a decision exceeding the bounded snapshot size stages no state and leaves its prior durable application readable', async () => {
  const f = fixture(), at = new Date(f.state.now).toISOString(), prefix = `cms/v1/registrations/${EVENT}`;
  let index = admissionView({ schemaVersion: 1, kind: 'registration_index', eventId: EVENT, revision: 0, entries: [] }, { capacity: 1 });
  for (let i = 0; i < 1000; i++) {
    const id = key(), record = { schemaVersion: 1, kind: 'registration', id, eventId: EVENT, submittedAt: at, fields,
      consent: { accepted: true, version: policy.privacy.version, acceptedAt: at }, provenance: { kind: 'public' } };
    const bytes = Buffer.from(JSON.stringify(record)), recordHash = hash(bytes);
    await f.objects.putImmutable(`${prefix}/records/${recordHash}.json`, bytes, { contentType: 'application/json' });
    const entry = { id, keyHash: hash('bounded-key-' + i), payloadHash: hash('bounded-payload-' + i), recordHash, committedAt: at };
    const status = addAdmission(index, entry, 'attendee', at, { reviewRequired: true });
    appendAdmissionAudit(index, { action: 'intake', actorId: 'public', at, requestHash: entry.payloadHash,
      details: { kind: 'attendee', status }, result: operationResult({ registrationId: id }) });
  }
  let decisions = 0;
  for (; decisions < 1000; decisions++) {
    const next = structuredClone(index), change = transitionAdmission(next, 'reject', { registrationId: index.entries[decisions].id }, at);
    appendAdmissionAudit(next, { action: 'reject', actorId: actor.id, at, operationId: key(), requestHash: hash('bounded-decision-' + decisions), ...change });
    if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024) break;
    index = next;
  }
  assert.ok(decisions > 300 && decisions < 1000); assert.ok(Buffer.byteLength(JSON.stringify(index)) <= 1024 * 1024);
  let commits = 0;
  // A pure synthetic durable cursor avoids generating gigabytes of redundant
  // full-state history. Real repository validators and the decision path run.
  const cursor = { version: index.revision, position: 512, hash: hash('bounded-cursor') };
  const journal = { read: async () => ({ value: structuredClone(index), cursor: { ...cursor } }),
    commit: async () => { commits++; assert.fail('Oversize decision must fail before journal staging or append.'); } };
  const service = f.service({ journalFor: path => path === prefix + '/index' ? journal : f.journalFor(path) });
  const before = await service.getAdmissions({ actor }), target = index.entries[decisions], original = Buffer.from(f.objects.files.get(`${prefix}/records/${target.recordHash}.json`).data);
  const storedWrites = writes(f.objects);
  const result = await service.rejectApplication({ actor, registrationId: target.id, expectedRevision: before.revision, operationId: key() });
  assert.deepEqual(result, { outcome: 'unavailable' }); assert.equal(commits, 0); assert.equal(writes(f.objects), storedWrites);
  assert.deepEqual(await f.service({ journalFor: () => journal }).getAdmissions({ actor }), before);
  assert.equal((await service.getAdmissionStatus(target.id)).status, 'pending_review');
  assert.deepEqual(f.objects.files.get(`${prefix}/records/${target.recordHash}.json`).data, original);
});
