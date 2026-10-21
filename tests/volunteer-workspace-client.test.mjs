import test from 'node:test';
import assert from 'node:assert/strict';
import { canManageVolunteers, parseVolunteerSelection, sourceToken, parseSourceToken, personWorkspacePath, volunteerWorkspaceView, volunteerSourceView, filterVolunteerRows, operationBody, operationReceipt, issueLabel } from '../src/lib/volunteer-workspace.mjs';

const registrationId = 'r'.repeat(43);
const source = { kind: 'contact', id: 'contact_1' };
const person = () => ({ canonicalId: 'r:' + registrationId, contactId: source.id, registrationId, name: '合成人员😀', organization: '合成机构', email: 'fixture@example.invalid', wechat: '', phone: '', eligible: true, admissionStatus: 'confirmed', issues: [] });
function fixture() {
  return { schemaVersion: 1, event: { id: 'event_2026', title: '合成活动', date: '2026-12-05', timezone: 'Asia/Shanghai' }, revision: 7,
    revisions: { volunteers: 7, contacts: 3, registrations: 4, admissions: 4, intent: 2, content: 6 },
    volunteers: [{ id: 'volunteer_1', source, workflowStatus: 'confirmed', owner: '合成同事', followUpAt: '2026-11-01', lastContactAt: '', notes: '保持原记录\n合成备注', availability: [{ start: '09:00', end: '10:00' }, { start: '10:00', end: '12:00' }], person: person(), issues: [] }],
    positions: [{ id: 'position_1', name: '签到', zone: 'A', location: '入口', lead: '合成同事', description: '', status: 'active' }],
    shifts: [{ id: 'shift_1', positionId: 'position_1', start: '09:00', end: '10:00', required: 2, status: 'active', sessionId: '', boothId: '', positionName: '签到', proposedCount: 0, confirmedCount: 1, gap: 1, issues: [] }],
    assignments: [{ id: 'assignment_1', volunteerId: 'volunteer_1', shiftId: 'shift_1', status: 'confirmed', valid: true, issues: [] }],
    summary: { rosterCount: 1, activePeopleCount: 1, confirmedPeopleCount: 1, admissionConfirmedPeopleCount: 1, assignedPeopleCount: 1, requiredSlots: 2, confirmedSlots: 1, proposedSlots: 0, gapSlots: 1, issueCount: 0, unverifiableSources: 0 },
    planning: { sessions: [], booths: [] } };
}
test('volunteer role gate requires complete pair or administrator', () => {
  for (const roles of [null, [], ['outreach'], ['reviewer'], ['editor'], ['volunteer']]) assert.equal(canManageVolunteers(roles), false);
  assert.equal(canManageVolunteers(['outreach', 'reviewer']), true); assert.equal(canManageVolunteers(['superadmin']), true);
});
test('source links require explicit bounded IDs and never match by personal text', () => {
  assert.deepEqual(parseVolunteerSelection('#contact=contact_1'), source);
  assert.deepEqual(parseVolunteerSelection('#registration=' + registrationId), { kind: 'registration', id: registrationId });
  for (const value of ['#contact=姓名', '#email=fixture@example.invalid', '#contact=contact_1&registration=' + registrationId, '#registration=x', '#contact=%ED%A0%80', '#contact=contact_1/other', '#contact=contact_1?name=x']) assert.equal(parseVolunteerSelection(value), null);
  assert.deepEqual(parseSourceToken(sourceToken(source)), source); assert.equal(parseSourceToken('contact:fixture@example.invalid'), null);
  assert.equal(personWorkspacePath(source), '/admin/person/#contact=contact_1');
});
test('workspace projection strips unrelated private fields and retains distinct staffing metrics', () => {
  const input = fixture(); input.secret = 'never copy'; input.volunteers[0].rawQuestionnaire = 'never copy'; input.volunteers[0].person.capabilityUrl = 'never copy';
  const view = volunteerWorkspaceView(input); assert.equal(view.secret, undefined); assert.equal(view.volunteers[0].rawQuestionnaire, undefined); assert.equal(view.volunteers[0].person.capabilityUrl, undefined);
  assert.equal(view.summary.activePeopleCount, 1); assert.equal(view.summary.requiredSlots, 2); assert.equal(view.summary.gapSlots, 1); assert.equal(view.volunteers[0].person.name, '合成人员😀');
  input.volunteers[0].notes = 'changed outside'; assert.notEqual(view.volunteers[0].notes, input.volunteers[0].notes);
});
test('malformed or dangling snapshots fail closed instead of showing zero', () => {
  const changes = [view => { delete view.summary.gapSlots; }, view => { view.summary.unverifiableSources = '0'; }, view => { view.revisions.volunteers = 8; }, view => { view.assignments[0].volunteerId = 'unknown'; }, view => { view.shifts[0].positionId = 'unknown'; }, view => { view.volunteers[0].availability[1].start = '09:30'; }, view => { view.volunteers[0].followUpAt = '2026-02-30'; }, view => { view.volunteers[0].person.name = '\ud800'; }, view => { view.volunteers[0].issues = ['<script>']; }, view => { view.volunteers.push(structuredClone(view.volunteers[0])); }, view => { view.summary.rosterCount = 0; }, view => { view.planning.sessions = Array.from({ length: 201 }, (_, id) => ({ id: 's' + id })); }];
  for (const change of changes) { const value = fixture(); change(value); assert.throws(() => volunteerWorkspaceView(value)); }
});
test('missing source is explicit and never inferred as eligible or admitted', () => {
  const value = fixture(); Object.assign(value.volunteers[0].person, { canonicalId: null, registrationId: null, eligible: false, admissionStatus: 'unavailable', issues: ['SOURCE_UNAVAILABLE'] }); value.volunteers[0].issues = ['SOURCE_UNAVAILABLE']; value.summary.unverifiableSources = 1;
  const view = volunteerWorkspaceView(value); assert.equal(view.summary.unverifiableSources, 1); assert.equal(view.volunteers[0].person.admissionStatus, 'unavailable'); assert.match(issueLabel('SOURCE_UNAVAILABLE'), /无法核对/u); assert.equal(issueLabel('FUTURE_SAFE_CODE'), '资料或安排需核对');
});
test('source picker validates bounded pagination and keeps canonical identity separate from source', () => {
  const value = { schemaVersion: 1, candidates: [{ source, ...person(), rawQuestionnaire: 'never copy' }], total: 201, nextCursor: '100' };
  const parsed = volunteerSourceView(value); assert.equal(parsed.nextCursor, '100'); assert.equal(parsed.candidates[0].rawQuestionnaire, undefined); assert.equal(parsed.candidates[0].canonicalId, 'r:' + registrationId);
  for (const mutate of [input => { input.total = 0; }, input => { input.nextCursor = '201'; }, input => { input.nextCursor = 'https://example.invalid'; }, input => { input.candidates[0].eligible = 1; }, input => { input.candidates.push(structuredClone(input.candidates[0])); }]) { const input = structuredClone(value); mutate(input); assert.throws(() => volunteerSourceView(input)); }
});
test('filters combine communication ownership, workflow and active arrangement issues', () => {
  const view = volunteerWorkspaceView(fixture()); assert.equal(filterVolunteerRows(view, { query: '合成同事', status: 'confirmed', assignment: 'assigned' }).length, 1); assert.equal(filterVolunteerRows(view, { assignment: 'unassigned' }).length, 0); assert.equal(filterVolunteerRows(view, { assignment: 'issues' }).length, 0);
  view.assignments[0].issues = ['TIME_CONFLICT']; view.assignments[0].valid = false; assert.equal(filterVolunteerRows(view, { assignment: 'issues' }).length, 1);
  view.assignments[0].status = 'cancelled'; assert.equal(filterVolunteerRows(view, { assignment: 'unassigned' }).length, 1);
});
test('operation snapshot is detached and only matching original audit receipt clears pending', () => {
  const payload = { id: 'position_1', name: '签到', zone: 'A', location: '', lead: '', description: '', status: 'active' };
  const body = operationBody({ expectedRevision: 6, operationId: 'operation_1234567890', action: 'position_upsert', payload }); payload.name = 'changed'; assert.equal(body.payload.name, '签到');
  const response = { ...fixture(), outcome: 'updated', operation: { operationId: body.operationId, action: body.action, revision: 7 } }; assert.equal(operationReceipt(response, body).revision, 7);
  const replay = structuredClone(response); replay.outcome = 'replayed'; replay.revision = 9; replay.revisions.volunteers = 9; assert.equal(operationReceipt(replay, body).revision, 9);
  for (const mutate of [value => { delete value.operation; }, value => { value.operation.operationId = 'foreign_1234567890'; }, value => { value.operation.action = 'volunteer_upsert'; }, value => { value.operation.revision = 6; }, value => { value.operation.revision = 9; }, value => { value.outcome = 'sent'; }]) { const value = structuredClone(replay); mutate(value); assert.throws(() => operationReceipt(value, body)); }
});
