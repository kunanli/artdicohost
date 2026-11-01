import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CONTACT } from './person-workspace-fixture.mjs';
import { buildArrangementOverview } from '../shared/arrangement-overview.mjs';
import { personWorkspaceView, personWorkspaceSteps } from '../src/lib/person-workspace.mjs';

function savedProfile(f) {
  const row = structuredClone(f.data.content.content.guests[0]);
  delete row.contactId; delete row.internalNotes;
  row.ggjRole = ''; row.portraitUrl = '/api/public/portraits/' + row.portraitId;
  f.data.content.published.content.guests = [row];
  return row;
}

test('person workspace finds additional editorial participants without granting private duties or admission', async () => {
  const f = fixture(), contact = f.data.contacts.contacts[0];
  contact.operations.sessionIds = []; contact.operations.sessionRoles = [];
  f.data.content.content.sessions[0].participants = [{guestId: 'synthetic-guest', roles: ['moderator', 'panelist']}];
  const before = structuredClone(f.data), {response, body} = await f.read();
  assert.equal(response.status, 200);
  assert.deepEqual(body.arrangements.sessions.map(row => row.id), ['synthetic-session']);
  assert.deepEqual(body.arrangements.sessions[0].roles, [], 'editorial roles never become private assignments');
  assert.equal(body.admission.status, 'confirmed');
  assert.deepEqual(f.data, before);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-|rawAnswers/u);
});

test('actual response changes require a frontend update while reads preserve the frozen publication', async () => {
  const f = fixture(); savedProfile(f);
  const contact = f.data.contacts.contacts[0];
  contact.operations.responseStatus = 'attending';
  const old = structuredClone(f.data.content.published);
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, false, 'legacy profile confirmation alone proves no attendance');
  assert.deepEqual(f.data.content.published, old);
  f.data.content.published.content.guestAttendance = {schemaVersion: 1, sourceRevision: 3, confirmedGuestIds: ['synthetic-guest']};
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, true);
  contact.operations.responseStatus = 'declined';
  const frozen = structuredClone(f.data), {body} = await f.read();
  assert.equal(body.publicProfile.profiles[0].published, true, 'saved publication remains historical fact');
  assert.equal(body.publicProfile.profiles[0].publishedMatchesDraft, false);
  const view = personWorkspaceView(body, body.selected);
  const step = personWorkspaceSteps(view, ['superadmin', 'editor', 'outreach']).find(row => row.key === 'public');
  assert.equal(step.state, 'review'); assert.match(step.detail, /更新前台/u);
  assert.deepEqual(f.data, frozen, 'read never publishes the withdrawal or sends a notice');
});

test('unrelated contact notes and revision changes do not invent a changed public attendance state', async () => {
  const f = fixture(); savedProfile(f);
  f.data.contacts.contacts[0].operations.responseStatus = 'attending';
  f.data.content.published.content.guestAttendance = {schemaVersion: 1, sourceRevision: 1, confirmedGuestIds: ['synthetic-guest']};
  f.data.contacts.revision += 9;
  f.data.contacts.contacts[0].operations.notes = 'PRIVATE-UNRELATED';
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, true);
});

test('overview deduplicates a person and keeps editorial roles separate from internal session duties', () => {
  const contact = {id: CONTACT, profile: {name: '合成人员', organization: '合成机构'},
    operations: {responseStatus: 'pending', participationForms: ['attendee'], sessionIds: ['panel'], boothIds: [], sessionRoles: [{sessionId: 'panel', roles: ['attendee']}]} };
  const content = {guests: [{id: 'guest', name: '合成嘉宾', company: '合成机构', status: 'confirmed', contactId: CONTACT}], booths: [], showcases: [],
    sessions: [{id: 'panel', start: '10:00', end: '11:00', zone: 'B', title: '合成圆桌', format: 'roundtable', status: 'scheduled',
      guestId: '', speakerName: '', speakerStatus: 'pending', participants: [{guestId: 'guest', roles: ['moderator', 'panelist']}]}]};
  const before = structuredClone({content, contact});
  const result = buildArrangementOverview({content, contacts: [contact], contentRevision: 2, contactsRevision: 3});
  const row = result.sessions.B[0];
  assert.equal(row.people.length, 1);
  assert.deepEqual(row.people[0].rolesInSession, ['attendee']);
  assert.deepEqual(row.people[0].publicRolesInSession, ['moderator', 'panelist']);
  assert.equal(row.people[0].responseStatus, 'pending');
  assert.equal(result.summary.people.assignedContacts, 1);
  assert.deepEqual({content, contact}, before);
});
