import test from 'node:test';
import assert from 'node:assert/strict';
import { readSheet } from 'read-excel-file/node';
import { fixture as personFixture } from './person-workspace-fixture.mjs';
import { personWorkspaceView, personWorkspaceActions, personWorkspaceSteps } from '../src/lib/person-workspace.mjs';
import { volunteerFixture, fixtureVolunteer, fixturePosition, fixtureShift } from './volunteer-api-fixture.mjs';
import { volunteerWorkspaceView } from '../src/lib/volunteer-workspace.mjs';
import { contactProgress, buildOrganizerTasks, invitationProgressLabels } from '../shared/organizer-progress.mjs';
import { createOrganizerTasksApi } from '../functions/organizer-tasks/handler.mjs';
import { registrationWorkbook, contactsWorkbook } from '../functions/registration-admin/xlsx-export.mjs';
import { eventConfig } from '../src/config/event.mjs';

const statuses = ['pending_review', 'rejected'];
const column = (rows, label, index = 1) => rows[index][rows[0].indexOf(label)];

test('known pending and rejected admissions preserve person facts without invitation actions or admission claims', async () => {
  for (const status of statuses) {
    const f = personFixture(); f.data.admission.status = status;
    f.data.contacts.contacts[0].operations.participationForms = ['attendee'];
    f.data.contacts.contacts[0].operations.sessionIds = []; f.data.contacts.contacts[0].operations.sessionRoles = []; f.data.contacts.contacts[0].operations.boothIds = [];
    f.data.contacts.contacts[0].operations.responseStatus = 'attending';
    const before = structuredClone(f.data), { response, body } = await f.read();
    assert.equal(response.status, 200); assert.equal(body.availability.admission, 'available'); assert.equal(body.admission.status, status);
    const view = personWorkspaceView(body, body.selected); assert.ok(view);
    assert.equal(personWorkspaceActions(view, ['superadmin', 'outreach', 'editor']).some(action => action.key === 'invitation'), false);
    const arranged = personWorkspaceSteps(view, ['superadmin', 'outreach', 'editor']).find(step => step.key === 'arrangements');
    assert.match(arranged.detail, /参会名额仍需单独核对/u); assert.doesNotMatch(arranged.detail, /可直接参加/u);
    assert.equal(body.contact.operations.responseStatus, 'attending', 'staff rejection does not pretend the applicant declined');
    assert.equal(body.registration.review.status, 'in_review', 'internal review opinion remains independent');
    assert.deepEqual(f.data, before);
  }
  const f = personFixture(); f.data.admission.status = 'unrecognized-status';
  const { body } = await f.read(); assert.equal(body.availability.admission, 'unavailable'); assert.equal(body.admission, null);
});

test('person identity projection keeps editable student categories separate from the original source snapshot', async () => {
  const f = personFixture(), contact = f.data.contacts.contacts[0]; contact.sourceProfile = structuredClone(contact.profile);
  contact.profile.categories = ['student'];
  const { body } = await f.read(); assert.deepEqual(body.contact.profile.categories, ['student']); assert.deepEqual(body.contact.sourceCategories, ['developer']);
  assert.equal(Object.hasOwn(body.contact, 'sourceProfile'), false); assert.doesNotMatch(JSON.stringify(body.contact), /PRIVATE-QUESTIONNAIRE/u);
  const view = personWorkspaceView(body, body.selected); assert.deepEqual(view.contact.sourceCategories, ['developer']);
  delete body.contact.sourceCategories;
  assert.deepEqual(personWorkspaceView(body, body.selected).contact.sourceCategories, ['student'], 'legacy API shape stays readable');
  body.contact.sourceCategories = 'student'; assert.equal(personWorkspaceView(body, body.selected), null, 'string serialization cannot pose as a category array');
});

test('private pending volunteer proposals remain tentative while pending and rejected admissions cannot confirm coverage', async () => {
  for (const status of statuses) {
    const f = volunteerFixture(); await f.operate('volunteer_upsert', fixtureVolunteer());
    await f.operate('position_upsert', fixturePosition()); await f.operate('shift_upsert', fixtureShift());
    f.sources.admissions.people[0].status = status;
    const response = await f.api(new Request('https://api.artdico.host/api/admin/volunteers'));
    assert.equal(response.status, 200); const view = volunteerWorkspaceView(await response.json());
    assert.equal(view.volunteers[0].person.admissionStatus, status); assert.equal(view.summary.unverifiableSources, 0);
    assert.equal(view.summary.confirmedSlots, 0); assert.equal(view.summary.admissionConfirmedPeopleCount, 0); assert.equal(view.summary.gapSlots, 1);
    assert.equal(view.volunteers[0].person.eligible, status === 'pending_review');
    assert.equal(view.volunteers[0].workflowStatus, 'confirmed', 'application decision never rewrites the recorded volunteer reply');
    await assert.rejects(f.operate('assignment_upsert', { id: 'application_assignment', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'confirmed' }), { code: 'PLAN_CONFLICT' });
    assert.equal((await f.repository.read()).assignments.length, 0);
    if (status === 'pending_review') {
      // Preserve phase-one private planning: a proposal reserves tentative time,
      // never a seat or confirmed staffing coverage.
      const proposed = await f.operate('assignment_upsert', { id: 'application_assignment', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'proposed' });
      assert.equal(proposed.summary.proposedSlots, 1); assert.equal(proposed.summary.confirmedSlots, 0);
    } else {
      await assert.rejects(f.operate('assignment_upsert', { id: 'application_assignment', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'proposed' }), { code: 'PLAN_CONFLICT' });
      assert.ok(view.volunteers[0].person.issues.includes('SOURCE_INELIGIBLE'));
    }
  }
});

test('an existing volunteer assignment keeps its history after a pending/rejected admission change and exports the current decision', async () => {
  for (const status of statuses) {
    const f = volunteerFixture(); await f.operate('volunteer_upsert', fixtureVolunteer()); await f.operate('position_upsert', fixturePosition());
    await f.operate('shift_upsert', fixtureShift()); await f.operate('assignment_upsert', { id: 'historical_assignment', volunteerId: 'volunteer_01', shiftId: 'shift_01', status: 'confirmed' });
    f.sources.admissions.people[0].status = status;
    const before = await f.repository.read(), view = volunteerWorkspaceView(await f.service.read({ actor: f.actor }));
    assert.equal(view.assignments[0].status, 'confirmed'); assert.equal(view.assignments[0].valid, false);
    assert.ok(view.assignments[0].issues.includes('ADMISSION_NOT_CONFIRMED')); assert.equal(view.summary.confirmedSlots, 0);
    assert.deepEqual(await f.repository.read(), before, 'read never deletes or rewrites a saved arrangement');
    const exported = await f.service.exportXlsx({ actor: f.actor, expectedRevision: before.revision, operationId: 'application_export_' + status,
      volunteerIds: ['volunteer_01'], includeContact: false });
    const rows = await readSheet(Buffer.from(exported.workbook), '志愿者名册', { trim: false });
    assert.match(column(rows, '参会状态'), status === 'pending_review' ? /申请待审核/u : /申请未通过/u);
    assert.doesNotMatch(Buffer.from(exported.workbook).toString(), /volunteer-one@example.invalid/u);
  }
});

test('organizer tasks distinguish pending review and rejection from unavailable admissions and formal invitation work', async () => {
  for (const status of statuses) {
    const f = personFixture(), contacts = f.data.contacts.contacts, intent = f.data.intent;
    const options = { intent, event: eventConfig, content: f.data.content.content, now: Date.parse('2026-10-21T05:00:00.000Z'),
      admissionStatuses: [{ registrationId: f.data.registration.registration.id, status }] };
    const progress = contactProgress(contacts[0], options); assert.equal(progress.admissionStatus, status); assert.equal(progress.state, status);
    assert.equal(progress.admissionPending, status === 'pending_review'); assert.equal(progress.inactive, status === 'rejected');
    assert.match(invitationProgressLabels[progress.state], status === 'pending_review' ? /申请待审核/u : /申请未通过/u);
    const result = buildOrganizerTasks({ contacts, ...options });
    assert.equal(result.metrics.admissionUnknown, 0);
    assert.equal(result.tasks.some(row => row.contactId && ['unsent', 'unassigned', 'unreplied'].includes(row.kind)), false);
    if (status === 'pending_review') assert.ok(result.tasks.some(row => row.kind === 'admission_pending' && /待工作人员审核/u.test(row.detail)));
    const handle = createOrganizerTasksApi({ authenticate: async () => ({ user: { id: 'synthetic-staff', roles: ['outreach', 'reviewer'] } }),
      getSources: async () => ({ contacts, contactRevision: 3, content: options.content, contentRevision: 5, intent, inactiveRegistrationIds: [], admissionStatuses: options.admissionStatuses }), now: () => options.now });
    assert.equal((await handle(new Request('https://api.artdico.host/api/admin/tasks'))).status, 200);
  }
});

test('registration and contacts Excel retain pending/rejected decisions and separate current student identity from original answers', async () => {
  for (const status of statuses) {
    const f = personFixture(), registration = { ...f.data.registration.registration, review: f.data.registration.review }, contact = f.data.contacts.contacts[0];
    contact.sourceProfile = structuredClone(contact.profile); contact.profile.categories = ['student'];
    const result = registrationWorkbook({ registrations: [registration], admissions: { revision: 8, people: [{ registrationId: registration.id, status, kind: 'attendee', teamId: '' }], teams: [] },
      arrangements: { contactRevision: 3, contentRevision: 5, contacts: [contact], content: f.data.content.content,
        conversions: [{ registrationId: registration.id, sourceContactId: contact.id }] }, includeArrangements: true, applicationRevision: 8, reviewRevision: 0, exportedAt: '2026-10-21T05:00:00.000Z' });
    const rows = await readSheet(Buffer.from(result.workbook), '报名与参会', { trim: false }), duties = await readSheet(Buffer.from(result.workbook), '当前参与职责与安排', { trim: false });
    assert.equal(column(rows, '有效参会状态'), status); assert.equal(column(rows, '原填写身份'), 'industry');
    assert.equal(column(duties, '联系人当前身份'), 'student'); assert.equal(column(duties, '联系人原始身份／意向'), 'developer');
    const workbook = contactsWorkbook({ contacts: [contact], content: f.data.content.content, contactRevision: 3, contentRevision: 5, exportedAt: '2026-10-21T05:00:00.000Z' });
    const people = await readSheet(Buffer.from(workbook), '全部筹备人员', { trim: false });
    assert.equal(column(people, '当前身份'), 'student'); assert.equal(column(people, '原始身份／意向'), 'developer');
    assert.doesNotMatch(Buffer.from(workbook).toString(), /contact@example.invalid|PRIVATE-QUESTIONNAIRE/u);
  }
});
