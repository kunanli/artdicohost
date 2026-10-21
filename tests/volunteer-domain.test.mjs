import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyVolunteerState, validateVolunteerState, validateVolunteer, validateVolunteerPosition, validateVolunteerShift,
  validateVolunteerAssignment, VOLUNTEER_LIMITS } from '../shared/volunteer-schema.mjs';
import { createVolunteerRepository } from '../functions/volunteers/repository.mjs';
import { projectVolunteerCoverage, assertVolunteerPlanChange, volunteerAvailableFor } from '../functions/volunteers/planning.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';

const EVENT = 'synthetic-event', AT = Date.parse('2026-10-21T10:00:00.000Z');
const REG = 'r'.repeat(43), HASH = 'a'.repeat(64), PREFIX = 'cms/v1/volunteers/' + EVENT;
const errorCode = (code, status) => error => error.code === code && (status === undefined || error.status === status);
function checked(validator, input) { const result = validator(input); assert.equal(result.valid, true, JSON.stringify(result.errors)); return result.value; }
const volunteer = (id = 'person-one', overrides = {}) => checked(validateVolunteer, { id, source: { kind: 'contact', id: 'contact-' + id }, workflowStatus: 'confirmed',
  owner: '', followUpAt: '', lastContactAt: '', notes: '', availability: [{ start: '09:00', end: '18:00' }], ...overrides });
const position = (id = 'welcome', overrides = {}) => checked(validateVolunteerPosition, { id, name: '合成岗位', zone: 'A', location: '', lead: '', description: '', status: 'active', ...overrides });
const shift = (id = 'morning', overrides = {}) => checked(validateVolunteerShift, { id, positionId: 'welcome', start: '10:00', end: '11:00', required: 1, status: 'active', sessionId: '', boothId: '', ...overrides });
const assignment = (id = 'allocation-one', overrides = {}) => checked(validateVolunteerAssignment, { id, volunteerId: 'person-one', shiftId: 'morning', status: 'confirmed', ...overrides });
function state(overrides = {}) { return validateVolunteerState({ ...emptyVolunteerState(EVENT), volunteers: [volunteer()], positions: [position()], shifts: [shift()], assignments: [assignment()], ...overrides }); }
function context(value, overrides = {}) {
  const identities = Object.fromEntries(value.volunteers.map(person => [person.source.kind + ':' + person.source.id,
    { canonicalId: 'c:' + person.source.id, eligible: true, admissionStatus: 'confirmed', name: 'SYNTHETIC_PRIVATE_NAME', email: 'synthetic@example.invalid' }]));
  return { identities, content: { sessions: [], booths: [] }, ...overrides };
}
function request(revision = 0, operation = 'synthetic_operation_0001', overrides = {}) {
  return { actorId: 'synthetic-staff', expectedRevision: revision, operationId: operation, action: 'volunteer_upsert', payload: { id: 'person-one' }, ...overrides };
}
function fixture() {
  const objects = memoryObjects();
  const makeJournal = () => createObjectJournal({ objects, prefix: PREFIX });
  const build = (journal = makeJournal(), options = {}) => createVolunteerRepository({ journal, eventId: EVENT, clock: () => AT, ...options });
  return { objects, makeJournal, build, repository: build() };
}
const addOne = value => ({ ...value, volunteers: [volunteer()] });

test('volunteer validators keep distinct source identity, canonical defaults, and bounded local-day availability', () => {
  const normalized = validateVolunteer({ id: 'person', source: { kind: 'registration', id: REG }, notes: '  合成记录\n第二行  ', availability: [{ start: '11:00', end: '12:00' }, { start: '10:00', end: '11:00' }] });
  assert.equal(normalized.valid, true); assert.equal(normalized.value.workflowStatus, 'pending');
  assert.deepEqual(normalized.value.availability, [{ start: '10:00', end: '11:00' }, { start: '11:00', end: '12:00' }]);
  assert.equal(normalized.value.notes, '合成记录\n第二行');
  for (const patch of [
    { id: 123 }, { source: { kind: 'registration', id: 'short' } }, { source: { kind: 'contact', id: 'person', name: 'extra' } },
    { followUpAt: '2026-02-29' }, { lastContactAt: '2026-2-01' }, { workflowStatus: 'yes' }, { owner: '\n名字' },
    { notes: 'x'.repeat(2001) }, { owner: '\ud800' }, { notes: 'private\u0000' }, { autoRegister: true },
    { availability: [{ start: '23:00', end: '24:00' }] }, { availability: [{ start: '11:00', end: '10:00' }] },
    { availability: [{ start: '10:00', end: '11:00' }, { start: '10:59', end: '12:00' }] },
    { availability: Array.from({ length: 13 }, () => ({ start: '10:00', end: '11:00' })) },
  ]) assert.equal(validateVolunteer({ ...volunteer(), ...patch }).valid, false, JSON.stringify(patch));
  assert.equal(validateVolunteerPosition({ ...position(), name: '', lead: 'x'.repeat(121) }).valid, false);
  for (const required of [0, 301, 1.2, '1', null]) assert.equal(validateVolunteerShift({ ...shift(), required }).valid, false);
  assert.equal(validateVolunteerAssignment({ ...assignment(), status: 'deleted' }).valid, false);
  assert.throws(() => emptyVolunteerState(123), TypeError);
});

test('strict snapshots reject unknown schema, duplicate sources/pairs, broken links and forged audit', () => {
  for (const mutate of [
    value => { value.schemaVersion = 2; }, value => { value.extra = 'not allowed'; }, value => { value.eventId = 123; },
    value => { value.volunteers.push(volunteer('other', { source: value.volunteers[0].source })); },
    value => { value.assignments.push(assignment('other')); }, value => { value.shifts[0].positionId = 'missing'; },
    value => { value.assignments[0].volunteerId = 'missing'; }, value => { value.revision = 1; },
    value => { value.volunteers[0].owner = '  not canonical  '; },
  ]) { const value = state(); mutate(value); assert.throws(() => validateVolunteerState(value), errorCode('STORAGE_UNAVAILABLE', 503)); }
});

test('empty and restarted repository reads never initialize or write private storage', async () => {
  const f = fixture();
  for (const repository of [f.repository, f.build(), f.build()]) assert.deepEqual(await repository.read(), emptyVolunteerState(EVENT));
  assert.equal(f.objects.files.size, 0); assert.equal(f.objects.calls.some(item => ['append', 'putImmutable'].includes(item.operation)), false);
  const saved = await f.repository.mutate(request(), addOne);
  assert.equal(saved.outcome, 'updated'); assert.equal(saved.state.revision, 1);
  const writes = f.objects.calls.filter(item => ['append', 'putImmutable'].includes(item.operation)).length;
  const restarted = await f.build().read(); assert.deepEqual(restarted, saved.state);
  restarted.volunteers[0].notes = 'mutated local copy'; assert.equal((await f.build().read()).volunteers[0].notes, '');
  assert.equal(f.objects.calls.filter(item => ['append', 'putImmutable'].includes(item.operation)).length, writes);
});

test('independent repositories race through actual append CAS with exactly one winner and complete audit', async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.repository.mutate(request(0, 'synthetic_operation_left'), addOne),
    f.build().mutate(request(0, 'synthetic_operation_right'), value => ({ ...value, volunteers: [volunteer('person-two')] })),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  const persisted = await f.build().read(); assert.equal(persisted.revision, 1); assert.equal(persisted.audit.length, 1); assert.equal(persisted.volunteers.length, 1);
  assert.deepEqual(results.find(item => item.status === 'fulfilled').value.state, persisted);
});

test('lost acknowledgement never reports success and exact operation replay survives restart without repeating mutation', async () => {
  const f = fixture(), base = f.makeJournal(); let lost = true, applied = 0;
  const repository = f.build({ read: base.read, async commit(cursor, value) { const ack = await base.commit(cursor, value); if (lost) { lost = false; throw new Error('SYNTHETIC_PRIVATE_PROVIDER_DETAIL'); } return ack; } });
  const original = request(0, 'synthetic_operation_lost', { payload: { b: 2, a: 1 } });
  await assert.rejects(repository.mutate(original, value => { applied++; return addOne(value); }), error => errorCode('STORAGE_UNAVAILABLE', 503)(error) && !error.message.includes('PRIVATE_PROVIDER'));
  assert.equal((await f.build().read()).revision, 1);
  const replay = await f.build().mutate({ ...original, payload: { a: 1, b: 2 } }, () => assert.fail('replay cannot reapply'));
  assert.equal(replay.outcome, 'replayed'); assert.equal(replay.state.revision, 1); assert.equal(applied, 1);
  for (const patch of [{ actorId: 'other-staff' }, { payload: { a: 1, b: 3 } }, { expectedRevision: 1 }, { action: 'position_upsert' }])
    await assert.rejects(f.build().mutate({ ...original, ...patch }, addOne), errorCode('OPERATION_CONFLICT', 409));
  await assert.rejects(f.build().mutate(request(0, 'synthetic_operation_stale'), addOne), errorCode('REVISION_CONFLICT', 409));
});

test('an operation replay finds its receipt after later independent commits', async () => {
  const f = fixture(), first = request(); await f.repository.mutate(first, addOne);
  await f.build().mutate(request(1, 'synthetic_operation_0002', { action: 'position_upsert', payload: { id: 'welcome' } }), value => ({ ...value, positions: [position()] }));
  const replay = await f.build().mutate(first, () => assert.fail('must not mutate again'));
  assert.equal(replay.outcome, 'replayed'); assert.equal(replay.state.revision, 2); assert.equal(replay.state.audit.find(item => item.operationId === first.operationId).revision, 1);
});

test('bad storage acknowledgement, corrupt cursors and failed writes remain fail-closed', async () => {
  for (const alter of [() => null, () => ({}), ack => ({ ...ack, cursor: { ...ack.cursor, version: 0 } }), ack => ({ ...ack, value: { ...ack.value, revision: 8 } })]) {
    const f = fixture(), base = f.makeJournal();
    const repository = f.build({ read: base.read, async commit(cursor, value) { return alter(await base.commit(cursor, value)); } });
    await assert.rejects(repository.mutate(request(), addOne), errorCode('STORAGE_UNAVAILABLE', 503));
    assert.equal((await f.build().mutate(request(), () => assert.fail('already committed'))).outcome, 'replayed');
  }
  for (const response of [
    { value: null, cursor: { position: 1, version: 0, hash: null } },
    { value: emptyVolunteerState(EVENT), cursor: { position: 1, version: 0, hash: HASH } },
    { value: null, cursor: { position: 0, version: 0, hash: null }, extra: true },
    { value: state(), cursor: { position: 1, version: 1, hash: HASH } },
  ]) await assert.rejects(createVolunteerRepository({ journal: { read: async () => response, commit: () => assert.fail('read cannot write') }, eventId: EVENT }).read(), errorCode('STORAGE_UNAVAILABLE', 503));
  const f = fixture(); f.objects.setFailure('append'); await assert.rejects(f.repository.mutate(request(), addOne), errorCode('STORAGE_UNAVAILABLE', 503));
  assert.equal((await f.build().read()).revision, 0);
});

test('source links and allocation pair identity are immutable; states are archived instead of deleted', async () => {
  const f = fixture(); await f.repository.mutate(request(), () => state());
  for (const mutate of [
    value => { value.volunteers[0].source.id = 'another-contact'; return value; },
    value => { value.volunteers = []; value.assignments = []; return value; },
    value => { value.assignments = []; return value; },
    value => { value.shifts.push(shift('second')); value.assignments[0].shiftId = 'second'; return value; },
  ]) await assert.rejects(f.repository.mutate(request(1, 'synthetic_operation_archive'), mutate), errorCode('INVALID_REQUEST', 400));
  const saved = await f.repository.mutate(request(1, 'synthetic_operation_archive'), value => {
    value.volunteers[0].workflowStatus = 'inactive'; value.positions[0].status = 'inactive'; value.shifts[0].status = 'cancelled'; value.assignments[0].status = 'cancelled'; return value;
  });
  assert.equal(saved.state.volunteers.length, 1); assert.equal(saved.state.assignments.length, 1); assert.equal(saved.state.audit.length, 2);
});

test('request binding and state capacity are bounded without untrusted actor coercion or unsafe clock dates', async () => {
  const f = fixture();
  for (const patch of [{ actorId: 123 }, { operationId: 1234567890123456 }, { expectedRevision: '0' }, { payload: undefined }, { payload: { enormous: 'x'.repeat(65536) } }, { action: 'unknown' }, { details: {} }])
    await assert.rejects(f.repository.mutate(request(0, 'synthetic_operation_invalid', patch), addOne), errorCode('INVALID_REQUEST', 400));
  const sparse = []; sparse.length = 2;
  await assert.rejects(f.repository.mutate(request(0, 'synthetic_operation_sparse', { payload: sparse }), addOne), errorCode('INVALID_REQUEST', 400));
  const withExtra = [1]; withExtra.extra = 2;
  await assert.rejects(f.repository.mutate(request(0, 'synthetic_operation_extra', { payload: withExtra }), addOne), errorCode('INVALID_REQUEST', 400));
  await assert.rejects(f.build(undefined, { clock: () => Number.MAX_SAFE_INTEGER }).mutate(request(), addOne), errorCode('STORAGE_UNAVAILABLE', 503));
  await assert.rejects(f.repository.mutate(request(), value => ({ ...value, volunteers: Array.from({ length: 501 }, (_, index) => volunteer('person-' + index)) })), errorCode('CAPACITY_EXCEEDED', 409));
  assert.equal(f.objects.files.size, 0);
});

test('audit is bounded, contiguous, safe, and export details retain only explicit scope/hash', async () => {
  const f = fixture(); await f.repository.mutate(request(), addOne);
  const exportRequest = request(1, 'synthetic_export_operation', { action: 'export', payload: { volunteerIds: ['person-one'], includeContact: false },
    details: { volunteerIds: ['person-one'], includeContact: false, sha256: HASH } });
  const saved = await f.repository.mutate(exportRequest, value => value);
  assert.equal(saved.state.audit.at(-1).revision, 2); assert.deepEqual(saved.state.audit.at(-1).details, exportRequest.details);
  assert.equal(JSON.stringify(saved.state.audit).includes('synthetic@example.invalid'), false);
  assert.equal((await f.build().mutate({ ...exportRequest, details: { ...exportRequest.details, sha256: 'b'.repeat(64) } }, () => assert.fail('replay'))).state.audit.at(-1).details.sha256, HASH);
  const full = emptyVolunteerState(EVENT); full.revision = VOLUNTEER_LIMITS.audit;
  full.audit = Array.from({ length: full.revision }, (_, index) => ({ revision: index + 1, operationId: 'synthetic_full_' + String(index).padStart(8, '0'), action: 'export', actorId: 'synthetic', fingerprint: HASH, at: new Date(AT).toISOString() }));
  const bounded = createVolunteerRepository({ eventId: EVENT, clock: () => AT, journal: { read: async () => ({ value: full, cursor: { version: full.revision, position: 100, hash: HASH } }), commit: () => assert.fail('full journal cannot write') } });
  assert.equal((await bounded.read()).revision, 1000);
  await assert.rejects(bounded.mutate(request(1000, 'synthetic_full_rejected'), value => value), errorCode('CAPACITY_EXCEEDED', 409));
  for (const mutate of [value => { value.audit[5].revision = 1; }, value => { value.audit[5].operationId = value.audit[4].operationId; }, value => { value.audit[5].actorId = 123; }, value => { value.audit[5].at = '2020-01-01T00:00:00.000Z'; }]) {
    const invalid = structuredClone(full); mutate(invalid); assert.throws(() => validateVolunteerState(invalid), errorCode('STORAGE_UNAVAILABLE', 503));
  }
});

test('half-open shifts and adjacent availability permit two slots while counting one real person', () => {
  const value = state({ volunteers: [volunteer('person-one', { availability: [{ start: '10:00', end: '10:30' }, { start: '10:30', end: '12:00' }] })],
    shifts: [shift(), shift('afternoon', { start: '11:00', end: '12:00' })], assignments: [assignment(), assignment('allocation-two', { shiftId: 'afternoon' })] });
  const snapshot = structuredClone(value), result = projectVolunteerCoverage(value, context(value));
  assert.equal(result.summary.activeVolunteerCount, 1); assert.equal(result.summary.confirmedVolunteerCount, 1); assert.equal(result.summary.assignedVolunteerCount, 1);
  assert.equal(result.summary.requiredSlots, 2); assert.equal(result.summary.confirmedSlots, 2); assert.equal(result.summary.unfilledSlots, 0);
  assert.equal(result.issues.length, 0); assert.deepEqual(value, snapshot);
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_NAME'), false); assert.equal(JSON.stringify(result).includes('synthetic@example.invalid'), false);
  assert.equal(volunteerAvailableFor([{ start: '10:00', end: '10:30' }, { start: '10:31', end: '12:00' }], shift()), false);
});

test('proposals before admission are retained but never count confirmed staffing', () => {
  const value = state({ volunteers: [volunteer('person-one', { workflowStatus: 'invited' })], assignments: [assignment('allocation-one', { status: 'proposed' })] });
  const sources = context(value); sources.identities['contact:contact-person-one'].admissionStatus = 'waitlisted';
  const proposal = assertVolunteerPlanChange(state({ assignments: [] }), value, { action: 'assignment_upsert', id: 'allocation-one' }, sources);
  assert.equal(proposal.assignments[0].valid, true); assert.equal(proposal.summary.proposedSlots, 1); assert.equal(proposal.summary.confirmedSlots, 0); assert.equal(proposal.summary.unfilledSlots, 1);
  const confirmed = structuredClone(value); confirmed.assignments[0].status = 'confirmed';
  assert.throws(() => assertVolunteerPlanChange(value, confirmed, { action: 'assignment_upsert', id: 'allocation-one' }, sources), error => errorCode('PLAN_CONFLICT', 422)(error) && error.details.some(item => item.code === 'VOLUNTEER_NOT_CONFIRMED') && error.details.some(item => item.code === 'ADMISSION_NOT_CONFIRMED'));
});

test('overlapping proposals reserve time even before confirmed admission, and moving a shift cannot introduce overlaps', () => {
  const before = state({ shifts: [shift(), shift('next', { start: '11:00', end: '12:00' })], assignments: [assignment('allocation-one', { status: 'proposed' }), assignment('allocation-two', { shiftId: 'next', status: 'proposed' })] });
  const sources = context(before); sources.identities['contact:contact-person-one'].admissionStatus = 'waitlisted';
  assert.equal(projectVolunteerCoverage(before, sources).summary.proposedSlots, 2);
  const after = structuredClone(before); after.shifts[1].start = '10:59';
  assert.throws(() => assertVolunteerPlanChange(before, after, { action: 'shift_upsert', id: 'next' }, sources), errorCode('PLAN_CONFLICT', 422));
  const result = projectVolunteerCoverage(after, sources); assert.equal(result.assignments.filter(item => item.issues.includes('TIME_CONFLICT')).length, 2);
  assert.equal(result.summary.proposedSlots, 0); assert.equal(result.summary.unfilledSlots, 2);
  assert.throws(() => assertVolunteerPlanChange(state({ assignments: [before.assignments[0]], shifts: after.shifts }), after, { action: 'assignment_upsert', id: 'allocation-two' }, sources), errorCode('PLAN_CONFLICT', 422));
});

test('new allocations reject outside availability and demand overbooking without deleting old arrangements', () => {
  const before = state({ volunteers: [volunteer(), volunteer('person-two')] }), sources = context(before);
  const after = structuredClone(before); after.assignments.push(assignment('allocation-two', { volunteerId: 'person-two' }));
  const projection = projectVolunteerCoverage(after, sources);
  assert.equal(projection.summary.confirmedSlots, 2); assert.equal(projection.summary.unfilledSlots, 0);
  assert.deepEqual(projection.shifts[0].issues, ['SHIFT_OVER_CAPACITY']);
  assert.throws(() => assertVolunteerPlanChange(before, after, { action: 'assignment_upsert', id: 'allocation-two' }, sources), error => errorCode('PLAN_CONFLICT', 422)(error) && error.details.some(item => item.code === 'SHIFT_OVER_CAPACITY'));
  const higherDemand = structuredClone(after); higherDemand.shifts[0].required = 2;
  assert.equal(assertVolunteerPlanChange(before, higherDemand, { action: 'shift_upsert', id: 'morning' }, sources).summary.unfilledSlots, 0);
  assert.throws(() => assertVolunteerPlanChange(higherDemand, after, { action: 'shift_upsert', id: 'morning' }, sources), errorCode('PLAN_CONFLICT', 422));
  const unavailable = structuredClone(before); unavailable.volunteers[0].availability = [{ start: '10:30', end: '11:00' }];
  const kept = assertVolunteerPlanChange(before, unavailable, { action: 'volunteer_upsert', id: 'person-one' }, sources);
  assert.equal(unavailable.assignments.length, 1); assert.equal(kept.summary.confirmedSlots, 0); assert.equal(kept.summary.unfilledSlots, 1);
  assert.throws(() => assertVolunteerPlanChange(before, unavailable, { action: 'assignment_upsert', id: 'allocation-one' }, sources), errorCode('PLAN_CONFLICT', 422));
});

test('only explicit stable identity links deduplicate people; unresolved duplicate roster records cannot staff shifts', () => {
  const value = state({ volunteers: [volunteer(), volunteer('same-person-registration', { source: { kind: 'registration', id: REG } })], shifts: [shift(), shift('next', { start: '11:00', end: '12:00' })],
    assignments: [assignment(), assignment('allocation-two', { volunteerId: 'same-person-registration', shiftId: 'next' })] });
  const sources = context(value); for (const identity of Object.values(sources.identities)) identity.canonicalId = 'r:' + REG;
  const duplicate = projectVolunteerCoverage(value, sources);
  assert.equal(duplicate.summary.rosterCount, 2); assert.equal(duplicate.summary.activeVolunteerCount, 1); assert.equal(duplicate.summary.confirmedVolunteerCount, 1);
  assert.equal(duplicate.summary.confirmedSlots, 0); assert.equal(duplicate.volunteers.every(item => item.issues.includes('DUPLICATE_PERSON')), true);
  assert.throws(() => assertVolunteerPlanChange(value, value, { action: 'assignment_upsert', id: 'allocation-one' }, sources), errorCode('PLAN_CONFLICT', 422));
  const resolved = structuredClone(value); resolved.volunteers[1].workflowStatus = 'inactive';
  const result = projectVolunteerCoverage(resolved, sources); assert.equal(result.summary.activeVolunteerCount, 1); assert.equal(result.summary.confirmedSlots, 1); assert.equal(result.summary.unfilledSlots, 1);
  const distinct = context(value); assert.equal(projectVolunteerCoverage(value, distinct).summary.activeVolunteerCount, 2, 'same synthetic names/email do not merge distinct IDs');
});

test('restoring availability or confirmed collaboration cannot overfill a slot that was replaced during historical invalidation', () => {
  const original = state({ volunteers: [volunteer(), volunteer('person-two')] }), sources = context(original);
  const unavailable = structuredClone(original); unavailable.volunteers[0].availability = [{ start: '11:00', end: '12:00' }];
  assert.equal(assertVolunteerPlanChange(original, unavailable, { action: 'volunteer_upsert', id: 'person-one' }, sources).summary.confirmedSlots, 0);
  const replacement = structuredClone(unavailable); replacement.assignments.push(assignment('replacement', { volunteerId: 'person-two' }));
  assert.equal(assertVolunteerPlanChange(unavailable, replacement, { action: 'assignment_upsert', id: 'replacement' }, sources).summary.confirmedSlots, 1);
  const restored = structuredClone(replacement); restored.volunteers[0].availability = original.volunteers[0].availability;
  assert.throws(() => assertVolunteerPlanChange(replacement, restored, { action: 'volunteer_upsert', id: 'person-one' }, sources), error => errorCode('PLAN_CONFLICT', 422)(error) && error.details.some(item => item.code === 'SHIFT_OVER_CAPACITY'));
  const pending = structuredClone(original); pending.volunteers[0].workflowStatus = 'invited'; pending.assignments.push(assignment('replacement', { volunteerId: 'person-two' }));
  const accepted = structuredClone(pending); accepted.volunteers[0].workflowStatus = 'confirmed';
  assert.throws(() => assertVolunteerPlanChange(pending, accepted, { action: 'volunteer_upsert', id: 'person-one' }, sources), errorCode('PLAN_CONFLICT', 422));
  assert.equal(replacement.assignments.length, 2, 'failed restoration retains both historical rows');
  const corrected = structuredClone(restored); corrected.assignments[0].status = 'cancelled';
  assert.equal(assertVolunteerPlanChange(replacement, corrected, { action: 'assignment_upsert', id: 'allocation-one' }, sources).summary.confirmedSlots, 1);
});

test('restoring an inactive person or position cannot introduce an overlapping reservation', () => {
  const original = state({ positions: [position(), position('stage')], shifts: [shift(), shift('next', { positionId: 'stage', start: '10:30', end: '11:30' })],
    assignments: [assignment(), assignment('allocation-two', { shiftId: 'next', status: 'proposed' })] });
  const sources = context(original), inactive = structuredClone(original); inactive.positions[1].status = 'inactive';
  assert.equal(projectVolunteerCoverage(inactive, sources).summary.confirmedSlots, 1);
  assert.throws(() => assertVolunteerPlanChange(inactive, original, { action: 'position_upsert', id: 'stage' }, sources), error => errorCode('PLAN_CONFLICT', 422)(error) && error.details.some(item => item.code === 'TIME_CONFLICT'));
  const pending = structuredClone(original); pending.volunteers[0].workflowStatus = 'inactive';
  assert.equal(projectVolunteerCoverage(pending, sources).summary.confirmedSlots, 0);
  assert.throws(() => assertVolunteerPlanChange(pending, original, { action: 'volunteer_upsert', id: 'person-one' }, sources), errorCode('PLAN_CONFLICT', 422));
  const invalidated = assertVolunteerPlanChange(original, inactive, { action: 'position_upsert', id: 'stage' }, sources);
  assert.equal(invalidated.summary.confirmedSlots, 1); assert.equal(inactive.assignments.length, 2);
  const overstaffed = state({ volunteers: [volunteer(), volunteer('person-two')], assignments: [assignment(), assignment('allocation-two', { volunteerId: 'person-two' })] });
  const disabled = structuredClone(overstaffed); disabled.positions[0].status = 'inactive';
  assert.throws(() => assertVolunteerPlanChange(disabled, overstaffed, { action: 'position_upsert', id: 'welcome' }, context(overstaffed)), error => errorCode('PLAN_CONFLICT', 422)(error) && error.details.some(item => item.code === 'SHIFT_OVER_CAPACITY'));
});

test('missing, restricted, declined and waitlisted sources cannot count confirmed coverage', () => {
  const value = state();
  for (const mutate of [sources => { sources.identities = {}; }, sources => { sources.identities['contact:contact-person-one'].eligible = false; }, sources => { sources.identities['contact:contact-person-one'].admissionStatus = 'withdrawn'; },
    sources => { sources.identities['contact:contact-person-one'].admissionStatus = 'waitlisted'; }, sources => { sources.identities['contact:contact-person-one'].canonicalId = 'unsafe:identity'; }]) {
    const sources = context(value); mutate(sources); const result = projectVolunteerCoverage(value, sources);
    assert.equal(result.summary.confirmedSlots, 0); assert.equal(result.summary.unfilledSlots, 1); assert.equal(result.assignments[0].valid, false);
  }
  const missing = projectVolunteerCoverage(value, { ...context(value), identities: {} }); assert.equal(missing.summary.activeVolunteerCount, 0); assert.equal(missing.summary.unverifiableSources, 1);
  for (const workflowStatus of ['declined', 'inactive', 'invited', 'pending']) {
    const after = structuredClone(value); after.volunteers[0].workflowStatus = workflowStatus;
    assert.equal(assertVolunteerPlanChange(value, after, { action: 'volunteer_upsert', id: 'person-one' }, context(value)).summary.confirmedSlots, 0);
    assert.equal(after.assignments.length, 1);
  }
});

test('canceled shifts, inactive positions and invalid content links keep history without claiming confirmed coverage', () => {
  const value = state();
  for (const [collection, status, issue] of [['shifts', 'cancelled', 'SHIFT_CANCELLED'], ['positions', 'inactive', 'POSITION_INACTIVE']]) {
    const after = structuredClone(value); after[collection][0].status = status;
    const projection = projectVolunteerCoverage(after, context(after)); assert.equal(projection.summary.confirmedSlots, 0); assert.equal(projection.summary.requiredSlots, 0); assert.equal(projection.shifts[0].gap, 0);
    assert.equal(projection.assignments[0].issues.includes(issue), true); assert.equal(after.assignments.length, 1);
  }
  const linked = structuredClone(value); linked.shifts[0].sessionId = 'linked-session'; linked.shifts[0].boothId = 'linked-booth';
  const sources = context(linked); sources.content = { sessions: [{ id: 'linked-session', status: 'draft' }], booths: [{ id: 'linked-booth', status: 'pending' }] };
  assert.equal(projectVolunteerCoverage(linked, sources).summary.confirmedSlots, 1);
  for (const content of [{ sessions: [], booths: sources.content.booths }, { sessions: sources.content.sessions, booths: [{ id: 'linked-booth', status: 'cancelled' }] }]) {
    const projection = projectVolunteerCoverage(linked, { ...sources, content }); assert.equal(projection.summary.confirmedSlots, 0); assert.equal(projection.summary.unfilledSlots, 1);
    assert.equal(projection.shifts[0].issues.includes('CONTENT_LINK_INVALID'), true);
    assert.throws(() => assertVolunteerPlanChange(value, linked, { action: 'shift_upsert', id: 'morning' }, { ...sources, content }), errorCode('PLAN_CONFLICT', 422));
  }
  const cancelled = structuredClone(value); cancelled.assignments[0].status = 'cancelled';
  assert.equal(assertVolunteerPlanChange(value, cancelled, { action: 'assignment_upsert', id: 'allocation-one' }, { ...context(value), identities: {} }).summary.confirmedSlots, 0);
  assert.throws(() => projectVolunteerCoverage(value, { identities: {} }), errorCode('STORAGE_UNAVAILABLE', 503));
});
