import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readSheet } from 'read-excel-file/node';
import { createVolunteerService } from '../functions/volunteers/service.mjs';
import { createVolunteersApi, isVolunteersPath, MAX_VOLUNTEER_BODY_BYTES } from '../functions/volunteers/handler.mjs';
import { createVolunteerRepository } from '../functions/volunteers/repository.mjs';
import { XLSX_MIME } from '../shared/xlsx-workbook.mjs';
import { volunteerFixture, fixtureVolunteer, fixturePosition, fixtureShift, VOLUNTEER_FIXTURE_ORIGIN as ORIGIN,
  VOLUNTEER_FIXTURE_REGISTRATION as REGISTRATION, VOLUNTEER_FIXTURE_SECRET as SECRET } from './volunteer-api-fixture.mjs';

const ROOT = ORIGIN + '/api/admin/volunteers';
const request = (f, path = '', { method = 'GET', body, headers = {}, ...options } = {}) => new Request(ROOT + path, {
  method, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  headers: { ...(method === 'GET' ? {} : { origin: ORIGIN, 'x-csrf-token': f.csrfToken, 'content-type': 'application/json' }), ...headers }, ...options,
});
const command = (payload, action = 'volunteer_upsert', expectedRevision = 0, operationId = 'http_synthetic_operation_00001') => ({ expectedRevision, operationId, action, payload });
async function seeded() {
  const f = volunteerFixture();
  await f.operate('volunteer_upsert', fixtureVolunteer());
  await f.operate('position_upsert', fixturePosition());
  await f.operate('shift_upsert', fixtureShift());
  await f.operate('assignment_upsert', { id: 'assignment_01', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'confirmed' });
  return f;
}
async function errorCode(response, status, code) { assert.equal(response.status, status); const body = await response.json(); assert.equal(body.error.code, code); assert.ok(!JSON.stringify(body).includes(SECRET)); }

test('complete volunteer role gate precedes any journal or source I/O', async () => {
  for (const roles of [[], ['editor'], ['outreach'], ['reviewer'], ['publisher']]) {
    const f = volunteerFixture(); f.actor.roles = roles;
    for (const [path, options] of [['', {}], ['/sources', {}], ['/operations', { method: 'POST', body: command(fixtureVolunteer()) }], ['/export.xlsx', { method: 'POST', body: {} }]])
      await errorCode(await f.api(request(f, path, options)), 403, 'FORBIDDEN');
    assert.equal(f.sourceReads, 0); assert.equal(f.objects.calls.length, 0);
    await assert.rejects(f.service.read({ actor: f.actor }), { code: 'FORBIDDEN' });
    await assert.rejects(f.service.readPerson({ actor: f.actor, contactId: 'contact_01' }), { code: 'FORBIDDEN' });
    assert.equal(f.sourceReads, 0); assert.equal(f.objects.calls.length, 0);
  }
  const f = volunteerFixture(); f.actor.roles = ['superadmin'];
  assert.equal((await f.api(request(f))).status, 200);
  const unauthenticated = volunteerFixture({ authenticate: async () => null });
  await errorCode(await unauthenticated.api(request(unauthenticated)), 401, 'AUTH_REQUIRED');
  assert.equal(unauthenticated.sourceReads, 0);
});

test('strict same-origin HTTP, CSRF, methods, query and bounded JSON checks', async () => {
  const f = volunteerFixture();
  assert.ok(isVolunteersPath('/api/admin/volunteers')); assert.ok(isVolunteersPath('/api/admin/volunteers/operations')); assert.equal(isVolunteersPath('/api/admin/volunteers-other'), false);
  await errorCode(await f.api(new Request('https://attacker.invalid/api/admin/volunteers')), 403, 'ORIGIN_REJECTED');
  await errorCode(await f.api(request(f, '', { headers: { origin: 'https://attacker.invalid' } })), 403, 'ORIGIN_REJECTED');
  const wrongMethod = await f.api(request(f, '/operations')); assert.equal(wrongMethod.headers.get('allow'), 'POST'); await errorCode(wrongMethod, 405, 'METHOD_NOT_ALLOWED');
  await errorCode(await f.api(request(f, '/missing')), 404, 'NOT_FOUND');
  for (const suffix of ['?limit=2', '/sources?limit=201', '/sources?limit=-1', '/sources?query=a&query=b', '/sources?unknown=a', '/sources?id=contact_01'])
    await errorCode(await f.api(request(f, suffix)), 400, 'INVALID_REQUEST');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: command(fixtureVolunteer()), headers: { origin: '' } })), 403, 'ORIGIN_REJECTED');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: command(fixtureVolunteer()), headers: { 'x-csrf-token': 'wrong' } })), 403, 'CSRF_REJECTED');
  for (const headers of [{ 'content-type': 'text/plain' }, { 'content-type': 'application/json; charset=iso-8859-1' }, { 'content-encoding': 'gzip' }])
    await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: '{}', headers })), 415, 'UNSUPPORTED_MEDIA_TYPE');
  for (const body of ['[1]', '{', JSON.stringify({ ...command(fixtureVolunteer()), getSources: 'untrusted' }), JSON.stringify(command({ ...fixtureVolunteer(), name: 'manual duplicate profile' }))])
    await errorCode(await f.api(request(f, '/operations', { method: 'POST', body })), 400, 'INVALID_REQUEST');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: ' '.repeat(MAX_VOLUNTEER_BODY_BYTES + 1) })), 413, 'BODY_TOO_LARGE');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: '{}', headers: { 'content-length': '3' } })), 400, 'INVALID_REQUEST');
  assert.equal((await f.repository.read()).revision, 0); assert.equal(f.sourceReads, 0);
});

test('sources are minimal, bounded and deduplicate only explicit conversion/provenance links', async () => {
  const f = volunteerFixture(), response = await f.api(request(f, '/sources?limit=1'));
  assert.equal(response.status, 200); const first = await response.json(); assert.equal(first.total, 2); assert.equal(first.nextCursor, '1');
  assert.equal(first.candidates[0].source.id, 'contact_01'); assert.equal(first.candidates[0].canonicalId, 'r:' + REGISTRATION);
  assert.equal(first.candidates[0].email, 'volunteer-one@example.invalid'); assert.equal(first.candidates[0].admissionStatus, 'confirmed');
  const second = await (await f.api(request(f, '/sources?cursor=1&limit=1'))).json(); assert.equal(second.candidates[0].source.id, 'contact_02');
  const exact = await f.service.sources({ actor: f.actor, kind: 'registration', id: REGISTRATION }); assert.equal(exact.candidates[0].contactId, 'contact_01');
  assert.equal((await f.service.sources({ actor: f.actor, query: '合成院校' })).total, 1);
  assert.ok(!JSON.stringify([first, second, exact]).includes(SECRET));
  f.sources.contacts.contacts[1].profile.name = f.sources.contacts.contacts[0].profile.name;
  f.sources.contacts.contacts[1].profile.email = f.sources.contacts.contacts[0].profile.email;
  assert.equal((await f.service.sources({ actor: f.actor })).total, 2, 'same names/emails do not merge');
  assert.equal(f.objects.calls.length, 0, 'candidate read does not initialize volunteer storage');
});

test('trusted snapshot mismatch/failure is unavailable, never zero roster success', async () => {
  const f = volunteerFixture(); f.sources.admissions.revision = 99;
  await errorCode(await f.api(request(f)), 503, 'UNAVAILABLE');
  f.sources.admissions.revision = 1; f.setSourceFailure(true);
  await errorCode(await f.api(request(f)), 503, 'UNAVAILABLE');
  f.setSourceFailure(false); f.objects.setFailure('get');
  await errorCode(await f.api(request(f)), 503, 'UNAVAILABLE');
  assert.equal(f.objects.files.size, 0);
});

test('mismatched conversion cannot create a canonical volunteer or claim admission', async () => {
  const f = volunteerFixture(); f.sources.registrations.registrations[0].provenance.sourceContactId = 'contact_02';
  const candidates = await f.service.sources({ actor: f.actor });
  assert.equal(candidates.candidates[0].canonicalId, null); assert.equal(candidates.candidates[0].eligible, false);
  assert.deepEqual(candidates.candidates[0].issues, ['SOURCE_UNAVAILABLE']);
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: command(fixtureVolunteer()) })), 422, 'SOURCE_NOT_ELIGIBLE');
  assert.equal((await f.repository.read()).revision, 0);
});

test('durable operation receipt, exact replay, canonical duplicate and conflict boundaries', async () => {
  const f = volunteerFixture(), input = command(fixtureVolunteer());
  const first = await (await f.api(request(f, '/operations', { method: 'POST', body: input }))).json();
  assert.equal(first.outcome, 'updated'); assert.deepEqual(first.operation, { operationId: input.operationId, action: input.action, revision: 1 });
  const replay = await (await f.api(request(f, '/operations', { method: 'POST', body: input }))).json();
  assert.equal(replay.outcome, 'replayed'); assert.deepEqual(replay.operation, first.operation); assert.equal(replay.revision, 1);
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: { ...input, payload: { ...input.payload, notes: 'changed' } } })), 409, 'CONFLICT');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: command(fixtureVolunteer('other', { kind: 'registration', id: REGISTRATION }), 'volunteer_upsert', 1, 'canonical_duplicate_000001') })), 409, 'DUPLICATE_SOURCE');
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: command(fixturePosition(), 'position_upsert', 0, 'stale_revision_0000000001') })), 409, 'CONFLICT');
  const reopened = createVolunteerService({ repository: createVolunteerRepository({ journal: f.journal, eventId: 'ggj-cn-2026' }), getSources: async () => structuredClone(f.sources) });
  assert.equal((await reopened.read({ actor: f.actor })).volunteers[0].notes, input.payload.notes);
  assert.equal((await f.repository.read()).audit.length, 1);
  assert.ok(!JSON.stringify(first).includes(SECRET));
});

test('lost commit ACK remains inspectable and same operation safely replays once', async () => {
  const f = volunteerFixture(), original = f.objects.append;
  let loseAck = true;
  f.objects.append = async (...args) => { const ack = await original(...args); if (loseAck) { loseAck = false; throw new Error(SECRET); } return ack; };
  const input = command(fixtureVolunteer());
  await errorCode(await f.api(request(f, '/operations', { method: 'POST', body: input })), 503, 'UNAVAILABLE');
  assert.equal((await f.repository.read()).revision, 1);
  const replay = await (await f.api(request(f, '/operations', { method: 'POST', body: input }))).json(); assert.equal(replay.outcome, 'replayed'); assert.equal(replay.operation.revision, 1);
  assert.equal((await f.repository.read()).audit.length, 1);
});

test('live source withdrawal invalidates coverage, preserves history, readonly person projection is minimal', async () => {
  const f = await seeded(), before = await f.service.read({ actor: f.actor });
  assert.equal(before.summary.confirmedSlots, 1); assert.equal(before.summary.gapSlots, 0);
  const person = await f.service.readPerson({ actor: f.actor, contactId: 'contact_01', registrationId: REGISTRATION });
  assert.equal(person.entries[0].assignments[0].eligible, true); assert.equal(person.entries[0].assignments[0].positionName, '签到接待');
  assert.deepEqual(Object.keys(person.entries[0]).sort(), ['assignments', 'availability', 'id', 'workflowStatus']);
  assert.ok(!JSON.stringify(person).includes('volunteer-one@example.invalid')); assert.ok(!JSON.stringify(person).includes('沟通记录'));
  assert.deepEqual((await f.service.readPerson({ actor: f.actor, contactId: 'contact_02' })).entries, []);
  f.sources.inactiveRegistrationIds.push(REGISTRATION);
  const after = await f.service.read({ actor: f.actor });
  assert.equal(after.summary.confirmedSlots, 0); assert.equal(after.summary.gapSlots, 1); assert.equal(after.assignments[0].status, 'confirmed'); assert.equal(after.assignments[0].valid, false);
  assert.ok(after.assignments[0].issues.includes('SOURCE_INELIGIBLE')); assert.equal(after.volunteers[0].person.admissionStatus, 'withdrawn');
  await f.operate('assignment_upsert', { ...after.assignments[0], valid: undefined, issues: undefined }).then(() => assert.fail('extra fields must reject'), error => assert.equal(error.code, 'INVALID_REQUEST'));
  await f.operate('assignment_upsert', { id: 'assignment_01', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'cancelled' });
  const state = await f.repository.read(); assert.equal(state.assignments.length, 1); assert.equal(state.assignments[0].status, 'cancelled');
});

test('late explicit linkage duplicates are flagged without auto-merge or double coverage', async () => {
  const f = volunteerFixture();
  f.sources.intent.conversions = []; f.sources.registrations.registrations[0].provenance = { kind: 'public' }; f.sources.registrations.registrations[0].consent.accepted = true;
  await f.operate('volunteer_upsert', fixtureVolunteer());
  await f.operate('volunteer_upsert', fixtureVolunteer('volunteer_02', { kind: 'registration', id: REGISTRATION }));
  f.sources.intent.conversions = [{ sourceContactId: 'contact_01', registrationId: REGISTRATION }];
  f.sources.registrations.registrations[0].provenance = { kind: 'staff_assisted', sourceContactId: 'contact_01', permissionReference: SECRET };
  const view = await f.service.read({ actor: f.actor });
  assert.equal(view.volunteers.length, 2); assert.equal(view.summary.activePeopleCount, 1); assert.ok(view.volunteers.every(row => row.issues.includes('DUPLICATE_PERSON')));
  assert.equal((await f.repository.read()).revision, 2, 'read neither merges nor writes');
});

test('new arrangements enforce available hours, confirmed admission and demand', async () => {
  const f = await seeded();
  await f.operate('shift_upsert', { ...fixtureShift('shift_overlap'), start: '09:30', end: '10:30' });
  await assert.rejects(f.operate('assignment_upsert', { id: 'assignment_overlap', volunteerId: 'volunteer_01', shiftId: 'shift_overlap', status: 'confirmed' }), { code: 'PLAN_CONFLICT' });
  await assert.rejects(f.operate('shift_upsert', { ...fixtureShift(), positionId: 'missing' }), { code: 'INVALID_REQUEST' });
  await f.operate('volunteer_upsert', fixtureVolunteer('volunteer_02', { kind: 'contact', id: 'contact_02' }));
  await assert.rejects(f.operate('assignment_upsert', { id: 'assignment_no_admission', volunteerId: 'volunteer_02', shiftId: 'shift_overlap', status: 'confirmed' }), { code: 'PLAN_CONFLICT' });
  await f.operate('assignment_upsert', { id: 'assignment_proposed', volunteerId: 'volunteer_02', shiftId: 'shift_overlap', status: 'proposed' });
  const view = await f.service.read({ actor: f.actor }); assert.equal(view.summary.proposedSlots, 1); assert.equal(view.summary.confirmedSlots, 1); assert.equal(view.summary.gapSlots, 1);
});

test('XLSX export has explicit contact scope, true strings, audit, receipt and deterministic retry', async () => {
  const f = await seeded();
  await f.operate('volunteer_upsert', fixtureVolunteer('volunteer_02', { kind: 'contact', id: 'contact_02' }));
  const input = { expectedRevision: 5, operationId: 'synthetic_export_operation_0001', volunteerIds: ['volunteer_01'], includeContact: false };
  const response = await f.api(request(f, '/export.xlsx', { method: 'POST', body: input })); assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), XLSX_MIME);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(bytes.subarray(0, 2).toString(), 'PK'); assert.equal(response.headers.get('x-export-count'), '1');
  assert.equal(response.headers.get('x-volunteer-operation-id'), input.operationId); assert.equal(response.headers.get('x-volunteer-revision'), '6'); assert.equal(response.headers.get('x-export-sha256'), createHash('sha256').update(bytes).digest('hex'));
  const roster = await readSheet(bytes, '志愿者名册', { trim: false }); assert.equal(roster.length, 2); assert.equal(roster[1][3], '=合成人员一');
  const encoded = bytes.toString(); assert.ok(!encoded.includes('volunteer-one@example.invalid')); assert.ok(!encoded.includes('volunteer-two@example.invalid')); assert.ok(!encoded.includes(SECRET)); assert.ok(!encoded.includes('合成私密沟通记录')); assert.ok(!encoded.includes('<f>'));
  const replay = await f.api(request(f, '/export.xlsx', { method: 'POST', body: input })); assert.equal(replay.status, 200); assert.deepEqual(Buffer.from(await replay.arrayBuffer()), bytes); assert.equal((await f.repository.read()).revision, 6);
  const withContact = await f.api(request(f, '/export.xlsx', { method: 'POST', body: { ...input, expectedRevision: 6, operationId: 'synthetic_export_contact_0001', includeContact: true } })); assert.equal(withContact.status, 200);
  const contactBytes = Buffer.from(await withContact.arrayBuffer()); assert.ok(contactBytes.toString().includes('volunteer-one@example.invalid')); assert.ok(!contactBytes.toString().includes('volunteer-two@example.invalid'));
  const state = await f.repository.read(), audit = state.audit.at(-1); assert.equal(audit.action, 'export'); assert.deepEqual(audit.details.volunteerIds, ['volunteer_01']); assert.equal(audit.details.includeContact, true); assert.equal(audit.actorId, f.actor.id);
  f.sources.contacts.contacts[0].profile.displayName = '新的合成姓名'; f.sources.contacts.revision++;
  await errorCode(await f.api(request(f, '/export.xlsx', { method: 'POST', body: { ...input, expectedRevision: 6, operationId: 'synthetic_export_contact_0001', includeContact: true } })), 409, 'CONFLICT');
  assert.equal((await f.repository.read()).revision, 7);
});

test('export cannot omit selection/contact scope or bypass role, revision, or body boundaries', async () => {
  const f = await seeded(), input = { expectedRevision: 4, operationId: 'synthetic_export_denied_0001', volunteerIds: ['volunteer_01'], includeContact: false };
  for (const body of [{ ...input, includeContact: undefined }, { ...input, volunteerIds: [] }, { ...input, volunteerIds: ['missing'] }, { ...input, includeContact: 'false' }, { ...input, publicUrl: true }])
    await errorCode(await f.api(request(f, '/export.xlsx', { method: 'POST', body })), 400, 'INVALID_REQUEST');
  await errorCode(await f.api(request(f, '/export.xlsx', { method: 'POST', body: { ...input, expectedRevision: 0 } })), 409, 'CONFLICT');
  assert.equal((await f.repository.read()).audit.filter(row => row.action === 'export').length, 0);
});
