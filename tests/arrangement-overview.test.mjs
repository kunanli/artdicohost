import test from 'node:test';
import assert from 'node:assert/strict';
import { buildArrangementOverview } from '../shared/arrangement-overview.mjs';

const content = (overrides = {}) => ({ sessions: [], booths: [], guests: [], showcases: [], ...overrides });
const session = (id, overrides = {}) => ({ id, start: '10:00', end: '11:00', zone: 'A', title: '合成场次', format: 'talk', status: 'scheduled', guestId: '', speakerName: '', speakerStatus: 'pending', ...overrides });
const booth = (id, overrides = {}) => ({ id, code: 'C-01', zone: 'C', organization: '合成组织', project: '合成作品', status: 'confirmed', slotNumber: 1, ...overrides });
const guest = (id, overrides = {}) => ({ id, name: '合成嘉宾', company: '合成公司', status: 'confirmed', contactId: '', ...overrides });
const contact = (id, overrides = {}) => ({ id, profile: { name: '合成人员', displayName: '合成称呼', organization: '合成人员机构' }, operations: { responseStatus: 'pending', participationForms: [], sessionIds: [], boothIds: [], ...overrides } });
const team = (id, overrides = {}) => ({ id, title: '合成作品', teamName: '合成团队', school: 'SYNTHETIC_PRIVATE_SCHOOL', memberCount: 4, responseStatus: 'attending', status: 'confirmed', participationForms: ['share', 'booth'], sessionId: 'share', boothId: 'placed', ...overrides });
const overview = (value = content(), contacts = [], contentRevision = 3, contactsRevision = 9) => buildArrangementOverview({ content: value, contacts, contentRevision, contactsRevision });
const codes = row => row.warnings.map(item => item.code);

test('empty saved records create fifteen unassigned positions without fabricated booths or people', () => {
  const result = overview();
  assert.equal(result.boothRows.length, 15);
  assert.deepEqual(result.boothRows.map(row => row.slotNumber), Array.from({ length: 15 }, (_, index) => index + 1));
  assert.ok(result.boothRows.every(row => row.booth === null && !row.people.length && !row.teams.length));
  assert.equal(result.boothRows[0].label, '01号位置'); assert.equal(result.boothRows[14].label, '15号位置');
  assert.deepEqual(result.summary.booths, { capacity: 15, activePlaced: 0, confirmedPlaced: 0, pendingPlaced: 0, unassignedPositions: 15, unplacedRecords: 0 });
  assert.deepEqual(result.revisions, { content: 3, contacts: 9 });
  assert.equal(result.summary.people.attendingContacts, 0); assert.equal(result.summary.studentTeams.reportedAttendingMembers, 0);
});

test('fixed capacity counts pending and confirmed placed records and keeps unplaced and cancelled records separate', () => {
  const result = overview(content({ booths: [booth('confirmed'), booth('pending', { slotNumber: 15, status: 'pending' }), booth('unplaced', { slotNumber: 0 }), booth('cancelled', { slotNumber: 1, status: 'cancelled' })] }));
  assert.deepEqual(result.summary.booths, { capacity: 15, activePlaced: 2, confirmedPlaced: 1, pendingPlaced: 1, unassignedPositions: 13, unplacedRecords: 1 });
  assert.equal(result.boothRows[0].booth.id, 'confirmed'); assert.equal(result.boothRows[14].booth.id, 'pending');
  assert.equal(result.unplacedBooths[0].booth.id, 'unplaced'); assert.ok(codes(result.unplacedBooths[0]).includes('BOOTH_POSITION_UNASSIGNED'));
  assert.equal(result.cancelledBooths[0].booth.id, 'cancelled');
  const legacy = booth('legacy'); delete legacy.slotNumber;
  assert.equal(overview(content({ booths: [legacy] })).unplacedBooths[0].slotNumber, 0);
});

test('contact and linked guest are one stable person with guest display data and the separate actual contact reply', () => {
  const result = overview(content({
    sessions: [session('main', { guestId: 'linked' }), session('secondary', { start: '11:00', end: '12:00', zone: 'B', format: 'workshop' }), session('unlinked', { start: '12:00', end: '13:00', guestId: 'standalone' }), session('stale', { start: '13:00', end: '14:00', guestId: 'stale-guest' })],
    booths: [booth('placed')], guests: [guest('linked', { name: '合成嘉宾称呼', company: '合成嘉宾机构', status: 'pending', contactId: 'person' }), guest('standalone'), guest('stale-guest', { contactId: 'missing-person' })],
  }), [contact('person', { responseStatus: 'attending', sessionIds: ['main', 'secondary'], boothIds: ['placed'], participationForms: ['host', 'speaker'] }), contact('pending', { sessionIds: ['secondary'] }), contact('declined', { boothIds: ['placed'], responseStatus: 'declined' })]);
  const main = result.sessions.A.find(row => row.id === 'main');
  assert.equal(main.people.length, 1);
  assert.deepEqual(main.people[0], { id: 'contact:person', name: '合成嘉宾称呼', organization: '合成嘉宾机构', contactId: 'person', guestId: 'linked', responseStatus: 'attending', guestStatus: 'pending', participationForms: ['host', 'speaker'] });
  assert.equal(main.primarySpeaker.personId, 'contact:person');
  assert.equal(result.sessions.B[0].primarySpeaker, null); // Global host/speaker forms do not assign an official role in this session.
  assert.deepEqual(result.summary.people, { assignedContacts: 3, attendingContacts: 1, pendingContacts: 1, declinedContacts: 1, unlinkedConfirmedGuests: 2 });
  const stale = result.sessions.A.find(row => row.id === 'stale');
  assert.equal(stale.people[0].responseStatus, null); assert.ok(codes(stale).includes('MISSING_CONTACT_REFERENCE'));
  assert.ok(codes(result.boothRows[0]).includes('PERSON_DECLINED'));
});

test('cooperating student teams attach to both views once and group sizes never become unique attendance', () => {
  const result = overview(content({ sessions: [session('share', { format: 'showcase' })], booths: [booth('placed'), booth('cancelled', { slotNumber: 2, status: 'cancelled' })], showcases: [
    team('confirmed-team'), team('pending-team', { responseStatus: 'pending', status: 'pending', memberCount: 5 }),
    team('declined-team', { responseStatus: 'declined', memberCount: 3 }), team('cancelled-team', { sessionId: '', boothId: 'cancelled', participationForms: ['booth'], memberCount: 2 }),
  ] }));
  assert.equal(result.boothRows[0].teams.length, 3); assert.equal(result.sessions.A[0].teams.length, 3);
  assert.equal(result.summary.studentTeams.assignedTeams, 3); assert.equal(result.summary.studentTeams.attendingTeams, 1);
  assert.equal(result.summary.studentTeams.reportedAttendingMembers, 4); assert.equal(result.summary.studentTeams.reportedConfirmedAttendingMembers, 4);
  assert.equal(result.summary.people.assignedContacts, 0); assert.equal(result.summary.people.attendingContacts, 0);
  assert.equal(result.summary.sessions.missingPrimarySpeaker, 0); // A valid allocated sharing team is enough; no invented mandatory host.
  assert.equal(codes(result.sessions.A[0]).includes('MISSING_PRIMARY_SPEAKER'), false);
  assert.ok(codes(result.boothRows[0]).includes('TEAM_DECLINED')); assert.ok(codes(result.cancelledBooths[0]).includes('CANCELLED_TEAM_BOOTH_ASSIGNMENT'));
});

test('equal display names never merge distinct saved people or turn a guest confirmation into an attending reply', () => {
  const result = overview(content({ sessions: [session('same-names', { guestId: 'standalone' })], guests: [guest('standalone', { name: '相同合成称呼' })] }),
    [contact('one', { responseStatus: 'attending', sessionIds: ['same-names'] }), contact('two', { responseStatus: 'attending', sessionIds: ['same-names'] })]);
  assert.equal(result.sessions.A[0].people.length, 3);
  assert.equal(result.summary.people.attendingContacts, 2); assert.equal(result.summary.people.unlinkedConfirmedGuests, 1);
  assert.equal(new Set(result.sessions.A[0].people.map(person => person.id)).size, 3);
});

test('missing or cancelled references remain warnings and do not synthesize participants or fallback speakers', () => {
  const result = overview(content({ sessions: [session('missing-guest', { guestId: 'removed', speakerName: '不可代入的旧名字', speakerStatus: 'confirmed' }), session('cancelled-session', { status: 'cancelled' })],
    booths: [booth('cancelled-booth', { status: 'cancelled' })], showcases: [team('orphan-team', { sessionId: 'missing-session', boothId: 'missing-booth' })] }),
  [contact('orphan-contact', { responseStatus: 'attending', sessionIds: ['missing-session', 'cancelled-session'], boothIds: ['missing-booth', 'cancelled-booth'] })]);
  assert.equal(result.sessions.A.find(row => row.id === 'missing-guest').primarySpeaker, null);
  for (const code of ['MISSING_GUEST_REFERENCE', 'MISSING_SESSION_REFERENCE', 'MISSING_BOOTH_REFERENCE', 'CANCELLED_SESSION_ASSIGNMENT', 'CANCELLED_BOOTH_ASSIGNMENT', 'MISSING_TEAM_SESSION_REFERENCE', 'MISSING_TEAM_BOOTH_REFERENCE']) assert.ok(result.warnings.some(item => item.code === code), code);
  assert.equal(result.summary.people.assignedContacts, 0); assert.equal(result.summary.studentTeams.assignedTeams, 0);
});

test('explicit formats drive chronological A/B and all-workshop views with status-specific primary speaker gaps', () => {
  const legacy = session('legacy-title', { title: '工作坊 Workshop', zone: 'B', start: '13:00', end: '14:00' }); delete legacy.format;
  const result = overview(content({ sessions: [
    session('talk-with-speaker', { speakerName: '合成已保存讲者', speakerStatus: 'confirmed' }), session('talk-missing', { start: '11:00', end: '12:00' }),
    session('talk-draft', { status: 'draft' }), session('workshop-c', { format: 'workshop', zone: 'C', start: '09:00', end: '10:00' }),
    session('workshop-b', { format: 'workshop', zone: 'B', status: 'cancelled' }), legacy,
  ] }));
  assert.deepEqual(result.sessions.workshops.map(row => row.id), ['workshop-c', 'workshop-b']);
  assert.equal(result.sessions.other[0].id, 'workshop-c');
  assert.equal(result.sessions.B.find(row => row.id === 'legacy-title').format, 'other');
  assert.deepEqual(result.summary.sessions.byFormat.talk, { total: 3, draft: 1, scheduled: 2, cancelled: 0, withPrimarySpeaker: 1, missingPrimarySpeaker: 1 });
  assert.deepEqual(result.summary.sessions.byFormat.workshop, { total: 2, draft: 0, scheduled: 1, cancelled: 1, withPrimarySpeaker: 0, missingPrimarySpeaker: 1 });
  assert.equal(result.summary.people.unlinkedConfirmedGuests, 0); // Legacy speaker strings are not stable person identities.
  assert.ok(result.warnings.some(item => item.code === 'LEGACY_SPEAKER_UNLINKED'));
});

test('cross-zone scheduled overlap joins direct guest and contact assignments once without warning adjacent, draft or invalid intervals', () => {
  const result = overview(content({ sessions: [session('first', { guestId: 'linked' }), session('overlap', { zone: 'B', format: 'workshop', start: '10:30', end: '11:30' }),
    session('adjacent', { start: '11:30', end: '12:00' }), session('draft', { zone: 'B', status: 'draft' }), session('invalid-time', { start: 'wrong', end: '11:00' })], guests: [guest('linked', { contactId: 'person' })] }),
  [contact('person', { responseStatus: 'attending', sessionIds: ['first', 'overlap', 'adjacent', 'draft', 'invalid-time'] })]);
  const rows = [...result.sessions.A, ...result.sessions.B];
  for (const name of ['first', 'overlap']) assert.equal(rows.find(row => row.id === name).warnings.filter(warning => warning.code === 'PERSON_SCHEDULE_OVERLAP').length, 1);
  for (const name of ['adjacent', 'draft', 'invalid-time']) assert.equal(codes(rows.find(row => row.id === name)).includes('PERSON_SCHEDULE_OVERLAP'), false);
  assert.ok(codes(rows.find(row => row.id === 'invalid-time')).includes('INVALID_SESSION_TIME'));
  assert.equal(result.warnings.filter(warning => warning.code === 'PERSON_SCHEDULE_OVERLAP').length, 1);
  assert.equal(result.summary.people.attendingContacts, 1);
});

test('projection excludes private fields and never mutates or shares input records', () => {
  const secret = 'SYNTHETIC_PRIVATE_DO_NOT_PROJECT';
  const value = content({ sessions: [session('share', { format: 'showcase', internalNotes: secret })], booths: [booth('placed', { internalNotes: secret })],
    guests: [guest('linked', { contactId: 'person', portraitId: secret, internalNotes: secret })], showcases: [team('team', { school: secret, contactName: secret, email: secret, wechat: secret, materialLinks: secret, summary: secret, coverId: secret, internalNotes: secret })] });
  const person = contact('person', { responseStatus: 'attending', sessionIds: ['share'], notes: secret, owner: secret });
  Object.assign(person.profile, { email: secret, wechat: secret, phone: secret, background: secret }); Object.assign(person, { source: { key: secret }, sourceProfile: { name: secret }, invitation: { settings: secret } });
  const before = structuredClone({ value, person }), result = overview(value, [person]);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.deepEqual({ value, person }, before);
  result.sessions.A[0].people[0].name = 'caller mutation'; result.boothRows[0].teams[0].participationForms.push('caller-mutation');
  assert.deepEqual({ value, person }, before);
});

test('ambiguous slots, unsupported states and malformed snapshots fail rather than selecting a record or counting guessed people', () => {
  assert.throws(() => overview(content({ booths: [booth('one'), booth('two')] })), TypeError);
  for (const slotNumber of [-1, 16, 1.5, '1', null]) assert.throws(() => overview(content({ booths: [booth('invalid', { slotNumber })] })), TypeError);
  assert.throws(() => overview(content({ sessions: [session('one'), session('one')] })), TypeError);
  assert.throws(() => overview(content({ sessions: Array(1) })), TypeError);
  assert.throws(() => overview(content(), [], -1, 0), TypeError);
  assert.throws(() => overview(content(), [], 0, '1'), TypeError);
  assert.throws(() => overview(content({ guests: [guest('one', { contactId: 'same' }), guest('two', { contactId: 'same' })] })), TypeError);
  let accessed = false;
  const input = []; Object.defineProperty(input, 0, { get: () => { accessed = true; return session('getter'); } });
  assert.throws(() => overview(content({ sessions: input })), TypeError); assert.equal(accessed, false);
});
