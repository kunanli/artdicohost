import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePersonSelection, personWorkspacePath, personWorkspaceView, personWorkspaceActions, personWorkspaceSteps } from '../src/lib/person-workspace.mjs';

const CONTACT = 'synthetic-person', REGISTRATION = 'a'.repeat(43), AT = '2026-10-21T00:00:00.000Z';
const selection = { kind: 'contact', id: CONTACT };
function fixture() {
  return {
    schemaVersion: 1, selected: { ...selection }, person: { name: '合成人员', displayName: '合成人员', organization: '合成机构', position: '研发', city: '深圳' },
    linkage: { state: 'linked', contactId: CONTACT, registrationId: REGISTRATION },
    permissions: { contact: true, registration: true, invitations: true, confirmations: true, arrangements: true },
    availability: { contact: 'available', registration: 'available', admission: 'available', arrangements: 'available', invitations: 'available', confirmations: 'available', publicProfile: 'available' },
    revisions: { contacts: 3, content: 5, invitations: 7, registration: 8, admission: 12, confirmations: 9 },
    contact: { id: CONTACT, profile: { name: '合成人员', displayName: '合成人员', organization: '合成机构', position: '研发', city: '深圳', email: 'contact@example.invalid', wechat: 'synthetic-contact', phone: '', contactConsent: 'consented', categories: ['developer'], interests: ['talk'] },
      operations: { owner: '合成同事', priority: 'high', followUpAt: '2026-11-01', responseStatus: 'pending', notes: '已核对拟任讲者。', participationForms: ['speaker', 'attendee'], sessionIds: ['synthetic-session'], boothIds: ['synthetic-booth'], sessionRoles: [{ sessionId: 'synthetic-session', roles: ['speaker'] }] } },
    registration: { id: REGISTRATION, referenceCode: REGISTRATION, submittedAt: AT, provenance: { kind: 'staff_assisted' }, fields: { name: '合成人员', organization: '合成报名机构', position: '开发', city: '深圳', email: 'registration@example.invalid', wechat: 'synthetic-registration', phone: '', categories: ['industry'], participationInterests: ['workshop'], attendance: 'uncertain', accommodationChoice: 'needed' }, review: { status: 'in_review', accommodationStatus: 'pending', assignedTo: '合成审核人', nextStep: '核对场次', invitationStatus: 'not_sent', deletionRequested: false } },
    admission: { status: 'confirmed', kind: 'attendee', revision: 12 },
    arrangements: { sessions: [{ id: 'synthetic-session', title: '合成分享', start: '10:00', end: '11:00', zone: 'A', status: 'scheduled', roles: ['speaker'], missing: false }], booths: [{ id: 'synthetic-booth', code: 'C01', organization: '合成机构', project: '合成作品', position: '1', status: 'confirmed', missing: false }] },
    communications: { historyLimit: 200, invitationTotal: 1, confirmationTotal: 1, timelineTotal: 2, historyTruncated: false,
      invitations: [{ id: 'synthetic-invite', channel: 'email', status: 'provider_accepted', sentChannel: null, createdAt: AT, updatedAt: AT }],
      confirmations: [{ id: 'synthetic-confirmation', kind: 'registration', status: 'provider_accepted', admissionStatus: 'confirmed', attempt: 1, createdAt: AT, updatedAt: AT }],
      timeline: [{ source: 'invitation', id: 'synthetic-invite', at: AT, status: 'provider_accepted', channel: 'email', kind: null }, { source: 'confirmation', id: 'synthetic-confirmation', at: AT, status: 'provider_accepted', channel: 'email', kind: 'registration' }] },
    publicProfile: { state: 'available', profiles: [{ id: 'synthetic-guest', name: '合成人员', company: '合成机构', title: '研发', status: 'confirmed', publicConsent: true, hasPortrait: true, publicRoles: ['speaker'], published: true, publishedMatchesDraft: true }], publishedRevision: 4, publishedAt: AT },
  };
}
const steps = value => new Map(personWorkspaceSteps(value, ['superadmin', 'outreach', 'editor']).map(step => [step.key, step]));

test('person links accept only explicit bounded identifiers and never a name/search or mixed fragment', () => {
  assert.deepEqual(parsePersonSelection('#contact=synthetic-person'), selection);
  assert.deepEqual(parsePersonSelection('#registration=' + REGISTRATION), { kind: 'registration', id: REGISTRATION });
  assert.equal(personWorkspacePath(selection), '/api/admin/people/contacts/synthetic-person');
  for (const hash of ['', '#contact=', '#contact=_leading', '#contact=' + 'a'.repeat(81), '#contact=姓名', '#contact=abc&email=contact@example.invalid', '#contact=abc?other=x', '#contact=%', '#contact=a%2Fb', '#registration=short', '#name=synthetic-person']) assert.equal(parsePersonSelection(hash), null, hash);
  for (const value of [null, { kind: 'name', id: CONTACT }, { kind: 'contact', id: '../contact' }, { kind: 'registration', id: 'short' }]) assert.equal(personWorkspacePath(value), null);
});

test('valid aggregate keeps name, admission, reply and review independent and accepts legacy nullable dates', () => {
  const value = fixture(); value.communications.timeline[0].at = null;
  assert.ok(personWorkspaceView(value, selection));
  assert.equal(value.admission.status, 'confirmed'); assert.equal(value.contact.operations.responseStatus, 'pending');
  assert.equal(steps(value).get('reply').state, 'pending');
  assert.match(steps(value).get('reply').detail, /待本人回复.*不代表邮件已送达/u);
});

test('foreign selected/payload identities, restricted payloads and contradictory availability fail closed', () => {
  const changes = [value => value.selected.id = 'different-person', value => { value.contact.id = 'different-person'; value.linkage.contactId = 'different-person'; }, value => value.linkage.registrationId = 'b'.repeat(43), value => value.availability.contact = 'restricted', value => value.permissions.contact = false, value => value.availability.publicProfile = 'restricted', value => value.publicProfile.state = 'unavailable', value => value.availability.invitations = 'restricted'];
  for (const change of changes) { const value = fixture(); change(value); assert.equal(personWorkspaceView(value, selection), null); }
});

test('all saved notes up to 6000 codepoints survive, including emoji; excessive or malformed text fails closed', () => {
  for (const notes of ['x'.repeat(6000), '🎮'.repeat(6000)]) { const value = fixture(); value.contact.operations.notes = notes; assert.ok(personWorkspaceView(value, selection)); }
  for (const notes of ['x'.repeat(6001), '🎮'.repeat(6001), 'unpaired\ud800', 'hidden\u0000text']) { const value = fixture(); value.contact.operations.notes = notes; assert.equal(personWorkspaceView(value, selection), null); }
});

test('history metadata and bounded list sizes are validated, with explicit truncation retained', () => {
  const value = fixture(); value.communications.historyTruncated = true; value.communications.invitationTotal = 201; value.communications.timelineTotal = 202;
  assert.equal(personWorkspaceView(value, selection).communications.historyTruncated, true);
  for (const change of [item => item.communications.historyLimit = 0, item => item.communications.invitationTotal = 0, item => item.communications.historyTruncated = undefined, item => item.communications.timeline = Array(201).fill(item.communications.timeline[0]), item => item.communications.timeline[0].at = 'invalid date']) { const invalid = fixture(); change(invalid); assert.equal(personWorkspaceView(invalid, selection), null); }
});

test('saved manual invitation history stays visible when the separate invitation source is unavailable', () => {
  const value = fixture();
  value.availability.invitations = 'unavailable';
  value.communications.invitations = []; value.communications.invitationTotal = 0;
  value.communications.timeline[0] = { source: 'legacy_invitation', id: 'legacy-sent', at: AT, status: 'manually_sent', channel: 'wechat', kind: null };
  assert.ok(personWorkspaceView(value, selection), 'contact and its manual history remain readable');
  value.communications.timeline[0].source = 'invitation';
  assert.equal(personWorkspaceView(value, selection), null, 'unavailable separate-source entries remain forbidden');
});

test('links reuse the original editors and never create a save/send request', () => {
  const value = fixture(), actions = personWorkspaceActions(value, ['outreach', 'editor', 'superadmin']);
  assert.deepEqual(actions.map(action => action.key), ['profile', 'arrangements', 'invitation', 'guest', 'review', 'settings']);
  assert.equal(actions.find(action => action.key === 'profile').href, '/admin/contacts/#profile=' + CONTACT);
  assert.equal(actions.find(action => action.key === 'review').href, '/admin/registrations/#registration=' + REGISTRATION);
  assert.ok(actions.every(action => action.href.startsWith('/admin/') && !action.href.includes('?') && !action.href.includes('@')));
  assert.equal(personWorkspaceActions(value, ['outreach']).some(action => ['guest', 'settings'].includes(action.key)), false);
  value.admission.status = 'waitlisted'; assert.equal(personWorkspaceActions(value, ['outreach']).some(action => action.key === 'invitation'), false);
  value.admission.status = 'confirmed'; value.contact.profile.contactConsent = 'unknown'; assert.equal(personWorkspaceActions(value, ['editor']).some(action => ['invitation', 'guest'].includes(action.key)), false);
});

test('provider acceptance, unknown send results and confirmed admission never become actual replies', () => {
  const value = fixture(); assert.equal(steps(value).get('reply').state, 'pending');
  value.communications.timeline[0].status = 'unknown'; assert.equal(steps(value).get('reply').state, 'review');
  value.contact.operations.responseStatus = 'attending'; assert.equal(steps(value).get('reply').state, 'complete');
  value.contact.operations.responseStatus = 'declined'; assert.match(steps(value).get('reply').detail, /停止邀约/u);
});

test('ordinary attendees need no speaker session or booth; selected duties require the matching scheduled role', () => {
  const value = fixture(); value.contact.operations.participationForms = ['attendee']; value.arrangements = { sessions: [], booths: [] };
  assert.equal(steps(value).get('arrangements').state, 'complete'); assert.match(steps(value).get('arrangements').detail, /不要求讲者场次或展位/u);
  value.contact.operations.participationForms = ['speaker']; assert.equal(steps(value).get('arrangements').state, 'pending');
  value.arrangements.sessions = fixture().arrangements.sessions; assert.equal(steps(value).get('arrangements').state, 'complete');
  value.arrangements.sessions[0].roles = ['attendee']; assert.equal(steps(value).get('arrangements').state, 'pending');
  value.arrangements.sessions[0].roles = ['speaker']; value.arrangements.sessions[0].status = 'draft'; assert.equal(steps(value).get('arrangements').state, 'pending');
  value.arrangements.sessions[0].status = 'cancelled'; assert.equal(steps(value).get('arrangements').state, 'review');
  value.contact.operations.participationForms = ['booth']; value.arrangements = { sessions: [], booths: [] }; assert.equal(steps(value).get('arrangements').state, 'pending');
  value.arrangements.booths = fixture().arrangements.booths; assert.equal(steps(value).get('arrangements').state, 'complete');
});

test('restricted or unavailable sources produce no completed steps from missing facts', () => {
  const value = fixture(); value.selected = { kind: 'registration', id: REGISTRATION }; value.linkage = { state: 'restricted', contactId: null, registrationId: REGISTRATION };
  value.contact = null; value.availability.contact = value.availability.arrangements = value.availability.invitations = value.availability.publicProfile = 'restricted';
  value.permissions.contact = value.permissions.arrangements = value.permissions.invitations = false; value.arrangements = { sessions: [], booths: [] };
  value.communications.invitations = []; value.communications.invitationTotal = 0; value.communications.timeline = value.communications.timeline.filter(item => item.source === 'confirmation'); value.communications.timelineTotal = 1;
  value.publicProfile = { state: 'restricted', profiles: [], publishedRevision: null, publishedAt: null };
  assert.ok(personWorkspaceView(value, value.selected));
  assert.ok(personWorkspaceSteps(value, ['reviewer']).every(step => step.state === 'restricted'));
  const unavailable = fixture(); unavailable.availability.arrangements = 'unavailable'; unavailable.arrangements = { sessions: [], booths: [] };
  assert.equal(steps(unavailable).get('arrangements').state, 'review');
});

test('public completion requires a published, confirmed, consented profile with a portrait; withdrawn draft warns about a live old version', () => {
  const value = fixture(); assert.equal(steps(value).get('public').state, 'complete'); assert.match(steps(value).get('public').detail, /不代表最新草稿已同步/u);
  value.publicProfile.profiles[0].publishedMatchesDraft = false; assert.equal(steps(value).get('public').state, 'review');
  value.publicProfile.profiles[0].publishedMatchesDraft = true;
  value.publicProfile.profiles[0].hasPortrait = false; assert.equal(steps(value).get('public').state, 'pending');
  value.publicProfile.profiles[0].hasPortrait = true; value.publicProfile.profiles[0].published = false; assert.equal(steps(value).get('public').state, 'pending');
  value.publicProfile.profiles[0].published = true; value.publicProfile.profiles[0].publicConsent = false; value.publicProfile.profiles[0].publishedMatchesDraft = false;
  value.contact.operations.participationForms = ['attendee']; assert.equal(steps(value).get('public').state, 'review'); assert.match(steps(value).get('public').detail, /旧版公开资料仍在.*显示/u);
  value.publicProfile = { state: 'unavailable', profiles: [], publishedRevision: null, publishedAt: null }; value.availability.publicProfile = 'unavailable'; assert.equal(steps(value).get('public').state, 'review');
});
