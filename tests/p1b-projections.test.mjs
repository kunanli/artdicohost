import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { matchesPublishedContent, normalizeGuestAttendance, toPublicContent, validateContent } from '../shared/content-schema.mjs';
import { publicContentEnvelope } from '../src/lib/public-content-refresh.mjs';

const PRIVATE = 'PRIVATE-SYNTHETIC-P1B';
const guest = (id, changes = {}) => ({ id, name: '合成人物 ' + id, company: '合成机构', ggjRole: '', portraitId: '', status: 'confirmed',
  publicConsent: false, contactId: 'contact-' + id, internalNotes: PRIVATE, ...changes });
const session = changes => ({ id: 'synthetic-session', start: '10:00', end: '11:00', zone: 'A', title: '合成圆桌', format: 'roundtable',
  guestId: 'person-a', speakerName: PRIVATE, speakerStatus: 'pending', status: 'scheduled', internalNotes: PRIVATE, ...changes });
function fixture() {
  const content = createInitialContent();
  content.sessions = [session()]; content.booths = []; content.showcases = []; content.guests = [guest('person-a'), guest('person-b'), guest('person-c', { status: 'pending' })];
  return content;
}
const proof = (changes = {}) => ({ schemaVersion: 1, sourceRevision: 12, confirmedGuestIds: ['person-a'], ...changes });

test('legacy public session bytes keep their original shape without implicit participants or attendance', () => {
  const content = fixture(), original = structuredClone(content), projected = toPublicContent(content);
  assert.deepEqual(projected.sessions, [{ id: 'synthetic-session', start: '10:00', end: '11:00', zone: 'A', title: '合成圆桌', guestId: 'person-a',
    speakerName: '合成人物 person-a', speakerStatus: 'confirmed', status: 'scheduled', format: 'roundtable' }]);
  assert.equal(Object.hasOwn(projected, 'guestAttendance'), false);
  assert.equal(Object.hasOwn(validateContent(content).value.sessions[0], 'participants'), false);
  const frozen = JSON.stringify(projected);
  assert.equal(JSON.stringify(toPublicContent(JSON.parse(frozen))), frozen);
  assert.deepEqual(content, original);
  assert.ok(publicContentEnvelope({ revision: 1, publishedAt: '2026-11-01T01:00:00.000Z', content: JSON.parse(frozen) }));
});

test('multiple public session roles remain independent from the confirmed-attendance card evidence', () => {
  const content = fixture(); content.sessions[0].participants = [{ guestId: 'person-b', roles: ['moderator','organizer'] }, { guestId: 'person-c', roles: ['panelist'] }];
  const original = structuredClone(content), projected = toPublicContent(content, { guestAttendance: proof() });
  assert.deepEqual(projected.sessions[0].participants, content.sessions[0].participants);
  assert.equal(projected.sessions[0].guestId, 'person-a');
  assert.deepEqual(projected.guests.map(item => item.id), ['person-a','person-b','person-c']);
  assert.deepEqual(projected.guestAttendance, proof());
  for (const guestAttendance of [proof({ confirmedGuestIds: [] }), proof({ sourceRevision: null, confirmedGuestIds: [] })]) {
    assert.deepEqual(toPublicContent(content, { guestAttendance }).sessions, projected.sessions, 'a timetable is not filtered by guest-card eligibility');
  }
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE-|contact-person|contactId|internalNotes/u);
  assert.deepEqual(toPublicContent(projected), projected);
  assert.ok(publicContentEnvelope({ revision: 2, publishedAt: '2026-11-01T01:00:00.000Z', content: projected }));
  assert.deepEqual(content, original);
});

test('private profiles disappear from participant references without removing the actual session', () => {
  const content = fixture(); content.sessions[0].participants = [{ guestId: 'person-b', roles: ['moderator'] }, { guestId: 'person-c', roles: ['panelist'] }];
  content.guests[0].visibility = 'private'; content.guests[1].visibility = 'private';
  const projected = toPublicContent(content, { guestAttendance: proof({ confirmedGuestIds: [] }) });
  assert.equal(projected.sessions.length, 1); assert.equal(projected.sessions[0].guestId, ''); assert.equal(projected.sessions[0].speakerName, '');
  assert.deepEqual(projected.sessions[0].participants, [{ guestId: 'person-c', roles: ['panelist'] }]);
  assert.deepEqual(toPublicContent(projected), projected);
  content.sessions[0].status = 'cancelled';
  const cancelled = toPublicContent(content, { guestAttendance: proof({ confirmedGuestIds: [] }) });
  assert.equal(cancelled.sessions[0].status, 'cancelled');
  assert.deepEqual(cancelled.sessions[0].participants, projected.sessions[0].participants);
});

test('an absent participant field stays absent while an explicit empty list stays an explicit clearing', () => {
  const content = fixture();
  assert.equal(Object.hasOwn(validateContent(content).value.sessions[0], 'participants'), false);
  content.sessions[0].participants = [];
  assert.deepEqual(validateContent(content).value.sessions[0].participants, []);
  assert.deepEqual(toPublicContent(content).sessions[0].participants, []);
  assert.deepEqual(toPublicContent(toPublicContent(content)), toPublicContent(content));
});

test('session participant syntax rejects invented identities, duplicate people, private extras and unsupported roles', () => {
  const entry = () => ({ guestId: 'person-b', roles: ['moderator'] });
  for (const participants of [null, {}, '', [null], [{}], [{ guestId: 'missing', roles: ['speaker'] }], [entry(), entry()],
    [{ guestId: 'person-a', roles: ['moderator'] }], [{ ...entry(), contactId: 'private' }], [{ ...entry(), name: 'untrusted copy' }],
    [{ ...entry(), roles: [] }], [{ ...entry(), roles: ['moderator','moderator'] }], [{ ...entry(), roles: ['host'] }],
    [{ ...entry(), roles: ['speaker', 1] }], [{ ...entry(), roles: null }], [{ ...entry(), roles: [' moderator'] }],
    [Object.assign(Object.create({ hidden: true }), entry())]]) {
    const content = fixture(); content.sessions[0].participants = participants;
    assert.equal(validateContent(content).valid, false, JSON.stringify(participants));
    assert.throws(() => toPublicContent(content), /校验/u);
  }
  for (const field of ['guestId','roles']) {
    const content = fixture(), person = entry();
    Object.defineProperty(person, field, { enumerable: true, get() { assert.fail('participant getters must not execute'); } });
    content.sessions[0].participants = [person]; assert.equal(validateContent(content).valid, false);
  }
  const content = fixture();
  Object.defineProperty(content.sessions[0], 'participants', { enumerable: true, get() { assert.fail('participant-list getters must not execute'); } });
  assert.equal(validateContent(content).valid, false);
});

test('participant lists are bounded without truncating an accepted list or inventing defaults', () => {
  const content = fixture();
  content.guests = [guest('person-a'), ...Array.from({ length: 21 }, (_, index) => guest('person-extra-' + index))];
  content.sessions[0].participants = content.guests.slice(1,21).map(person => ({ guestId: person.id, roles: ['speaker','moderator','panelist','organizer'] }));
  assert.equal(validateContent(content).valid, true);
  assert.equal(toPublicContent(content).sessions[0].participants.length, 20);
  content.sessions[0].participants.push({ guestId: 'person-extra-20', roles: ['panelist'] });
  assert.equal(validateContent(content).valid, false);
});

test('published attendance evidence is minimal, sorted, copied and never added to editable drafts', () => {
  const content = fixture(), evidence = proof({ confirmedGuestIds: ['person-c','person-a'] }), original = structuredClone(evidence);
  const normalized = normalizeGuestAttendance(evidence, new Set(content.guests.map(person => person.id)));
  assert.deepEqual(normalized, proof({ confirmedGuestIds: ['person-a','person-c'] })); assert.deepEqual(evidence, original);
  normalized.confirmedGuestIds.push('not-original'); assert.deepEqual(evidence, original);
  content.guestAttendance = evidence;
  assert.equal(Object.hasOwn(validateContent(content).value, 'guestAttendance'), false, 'caller-supplied proof is not an editable draft field');
  const projected = toPublicContent(content);
  assert.deepEqual(projected.guestAttendance.confirmedGuestIds, ['person-a','person-c']);
  const trusted = proof({ sourceRevision: 13, confirmedGuestIds: ['person-b'] });
  assert.deepEqual(toPublicContent(content, { guestAttendance: trusted }).guestAttendance, trusted, 'trusted publish options override stale input metadata');
  assert.equal(Object.hasOwn(toPublicContent(fixture()), 'guestAttendance'), false);
});

test('malformed evidence never becomes confirmed attendance and accessors cannot run', () => {
  const known = ['person-a','person-b'];
  for (const value of [undefined, null, {}, [], proof({ schemaVersion: 2 }), proof({ sourceRevision: undefined }), proof({ sourceRevision: -1 }),
    proof({ sourceRevision: 1.5 }), proof({ sourceRevision: Number.MAX_SAFE_INTEGER + 1 }), proof({ sourceRevision: null }),
    proof({ confirmedGuestIds: ['person-a','person-a'] }), proof({ confirmedGuestIds: ['missing'] }), proof({ confirmedGuestIds: [1] }),
    proof({ confirmedGuestIds: new Array(201).fill('person-a') }), { ...proof(), contactId: PRIVATE }, { ...proof(), email: 'private@example.invalid' }]) {
    assert.throws(() => normalizeGuestAttendance(value, known), TypeError);
    const content = fixture(); content.guestAttendance = value;
    assert.throws(() => toPublicContent(content), TypeError);
  }
  assert.deepEqual(normalizeGuestAttendance(proof({ sourceRevision: null, confirmedGuestIds: [] }), known), proof({ sourceRevision: null, confirmedGuestIds: [] }));
  const metadata = proof();
  Object.defineProperty(metadata, 'confirmedGuestIds', { enumerable: true, get() { assert.fail('evidence getters must not execute'); } });
  assert.throws(() => normalizeGuestAttendance(metadata, known), TypeError);
  const content = fixture(); Object.defineProperty(content, 'guestAttendance', { enumerable: true, get() { assert.fail('root evidence getters must not execute'); } });
  assert.throws(() => toPublicContent(content), TypeError);
  assert.throws(() => toPublicContent(fixture(), { guestAttendance: undefined }), TypeError);
});

test('same-revision matching uses the frozen evidence without regenerating it or rewriting the source snapshot', () => {
  const content = fixture(); content.sessions[0].participants = [{ guestId: 'person-b', roles: ['moderator'] }];
  const published = toPublicContent(content, { guestAttendance: proof() }), before = JSON.stringify(published);
  assert.equal(matchesPublishedContent(content, published), true);
  content.guests[0].internalNotes = 'different private note';
  assert.equal(matchesPublishedContent(content, published), true);
  content.sessions[0].participants[0].roles = ['panelist'];
  assert.equal(matchesPublishedContent(content, published), false);
  assert.equal(JSON.stringify(published), before);
  content.sessions[0].participants[0].roles = ['moderator']; content.guests[0].visibility = 'private';
  assert.equal(matchesPublishedContent(content, published), false, 'a hidden proved profile is a real publication difference');
  const malformed = structuredClone(published); malformed.guestAttendance.confirmedGuestIds = ['missing'];
  assert.throws(() => matchesPublishedContent(fixture(), malformed), TypeError);
});
