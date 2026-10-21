import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CONTACT, REGISTRATION } from './person-workspace-fixture.mjs';
import { personWorkspaceView } from '../src/lib/person-workspace.mjs';

const ORGANIZATION = 'synthetic-organization';
function setup(options) {
  const f = fixture(options);
  f.data.content.content.organizations = [{ id: ORGANIZATION, name: '合成组织', status: 'confirmed', participation: 'exhibitor',
    internalNotes: 'PRIVATE-ORGANIZATION-NOTES', logoId: '', website: '', publicConsent: false }];
  f.data.contacts.contacts[0].operations.organizationMemberships = [{ organizationId: ORGANIZATION, role: 'lead', title: '技术联系' },
    { organizationId: 'missing-historical-org', role: 'member', title: '' }];
  return f;
}

test('person organizations join only saved membership IDs and preserve missing historical relations', async () => {
  const f = setup(), before = structuredClone(f.data), { response, body } = await f.read();
  assert.equal(response.status, 200); assert.equal(body.availability.organizations, 'available');
  assert.deepEqual(body.organizations, { state: 'available', memberships: [
    { organizationId: ORGANIZATION, role: 'lead', title: '技术联系', name: '合成组织', organizationStatus: 'confirmed', participation: 'exhibitor', missing: false },
    { organizationId: 'missing-historical-org', role: 'member', title: '', name: '', organizationStatus: 'missing', participation: '', missing: true },
  ] });
  assert.ok(personWorkspaceView(body, body.selected)); assert.equal(body.contact.id, CONTACT);
  assert.equal(body.contact.operations.responseStatus, 'pending'); assert.equal(body.admission.status, 'confirmed');
  assert.deepEqual(body.contact.operations.boothIds, ['synthetic-booth'], 'organization membership does not add a personal booth allocation');
  assert.doesNotMatch(JSON.stringify(body.organizations), /PRIVATE|publicConsent|email|internalNotes|logoId|website/u);
  assert.deepEqual(f.data, before); assert.equal(f.calls.filter(call => call.source === 'content').length, 1, 'organizations reuse the same authorized content snapshot');
});

test('matching organization text never becomes a membership and legacy absence is known unlinked', async () => {
  const f = setup(); delete f.data.contacts.contacts[0].operations.organizationMemberships;
  f.data.contacts.contacts[0].profile.organization = '合成组织';
  const { body } = await f.read(); assert.equal(body.availability.organizations, 'unlinked');
  assert.deepEqual(body.organizations, { state: 'unlinked', memberships: [] }); assert.ok(personWorkspaceView(body, body.selected));
});

test('organization member status cannot rewrite independent reply, attendance, admission or public speaker state', async () => {
  const f = setup(); f.data.admission.status = 'waitlisted'; f.data.content.content.organizations[0].status = 'withdrawn';
  const { body } = await f.read(); assert.equal(body.organizations.memberships[0].organizationStatus, 'withdrawn');
  assert.equal(body.contact.operations.responseStatus, 'pending'); assert.equal(body.registration.fields.attendance, 'uncertain');
  assert.equal(body.admission.status, 'waitlisted'); assert.deepEqual(body.publicProfile.profiles[0].publicRoles, ['speaker', 'organizer']);
});

test('review-only person lookup never loads organization content or reveals outreach memberships', async () => {
  const f = setup({ roles: ['reviewer'] }), { response, body } = await f.read({ loadContent: async () => assert.fail('reviewer cannot load content or organization membership') },
    '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(response.status, 200); assert.equal(body.availability.organizations, 'restricted');
  assert.deepEqual(body.organizations, { state: 'restricted', memberships: [] }); assert.ok(personWorkspaceView(body, body.selected));
  assert.doesNotMatch(JSON.stringify(body), /synthetic-organization|missing-historical-org|合成组织|技术联系/u);
});

test('malformed organization relations are partial unavailable and preserve other saved person sections', async () => {
  for (const change of [f => { f.data.contacts.contacts[0].operations.organizationMemberships = null; },
    f => { f.data.contacts.contacts[0].operations.organizationMemberships = undefined; },
    f => { f.data.contacts.contacts[0].operations.organizationMemberships[0].role = 'owner'; },
    f => { f.data.contacts.contacts[0].operations.organizationMemberships[0].title = 'hidden\u0000text'; },
    f => { f.data.contacts.contacts[0].operations.organizationMemberships.push({ ...f.data.contacts.contacts[0].operations.organizationMemberships[0] }); },
    f => { f.data.content.content.organizations = null; },
    f => { f.data.content.content.organizations[0].status = 'unknown'; }]) {
    const f = setup(); change(f);
    const { response, body } = await f.read(); assert.equal(response.status, 200);
    assert.equal(body.availability.organizations, 'unavailable'); assert.deepEqual(body.organizations, { state: 'unavailable', memberships: [] });
    assert.equal(body.contact.id, CONTACT); assert.equal(body.availability.arrangements, 'available'); assert.equal(body.admission.status, 'confirmed');
    assert.ok(personWorkspaceView(body, body.selected));
  }
});

test('uncertain secondary contact identity never reads or adopts another contact organization membership', async () => {
  const f = setup(); f.data.intent.conversions[0].registrationId = 'b'.repeat(43); f.data.intent.invitations = [];
  const { body } = await f.read({ loadContacts: async () => assert.fail('mismatched contact not loaded'), loadContent: async () => assert.fail('mismatched contact arrangements not loaded') },
    '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(body.linkage.state, 'unavailable'); assert.equal(body.availability.organizations, 'unavailable');
  assert.deepEqual(body.organizations, { state: 'unavailable', memberships: [] }); assert.ok(personWorkspaceView(body, body.selected));
});
