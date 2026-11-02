import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';
import { publicGuestCards, publicGuestSessions, publicSessionParticipants } from '../shared/guest-display.mjs';

const person = (id, patch = {}) => ({ id, name: '合成人物 ' + id, company: '合成机构', ggjRole: '', portraitId: '', status: 'confirmed', publicConsent: false,
  internalNotes: 'PRIVATE-NOTES', contactId: 'PRIVATE-CONTACT-' + id, ...patch });
const proof = (confirmedGuestIds = ['person-a'], patch = {}) => ({ schemaVersion: 1, sourceRevision: 10, confirmedGuestIds, ...patch });
const session = (patch = {}) => ({ id: 'synthetic-session', title: '合成圆桌', start: '10:00', end: '11:00', zone: 'A', status: 'scheduled',
  guestId: 'person-a', speakerName: 'PRIVATE-COPIED-NAME', speakerStatus: 'confirmed', internalNotes: 'PRIVATE-SESSION', ...patch });

test('invalid attendance proofs fail closed regardless of profile confirmation and legacy consent', () => {
  const guests = [person('person-a', { publicConsent: true })];
  for (const evidence of [null, {}, proof(['missing']), proof(['person-a'], { sourceRevision: -1 }),
    { ...proof(), email: 'private@example.invalid' }, proof(['person-a','person-a'])]) {
    assert.deepEqual(publicGuestCards(guests, evidence), []);
  }
  const content = createInitialContent(); content.guests = guests;
  const frozen = toPublicContent(content), before = JSON.stringify(frozen);
  const cards = publicGuestCards(frozen.guests, frozen.guestAttendance);
  assert.deepEqual(cards.map(item => ({ id: item.id, attendance: item.attendance })), [{ id: 'person-a', attendance: 'pending' }]);
  assert.equal(JSON.stringify(frozen), before, 'displaying a legacy profile does not migrate a frozen snapshot');
  assert.deepEqual(toPublicContent(frozen), frozen, 'the entire legacy public payload remains readable');
});

test('public card IDs are independent from attendance while replies remain truthful and private sources stay hidden', () => {
  const guests = [person('person-a', { status: 'pending', publicConsent: false }), person('person-b')], evidence = proof(['person-a']);
  const before = structuredClone({ guests, evidence }), cards = publicGuestCards(guests, evidence);
  assert.deepEqual(cards.map(item => [item.id, item.attendance]), [['person-a', 'attending'], ['person-b', 'pending']]);
  assert.equal(cards[0].status, 'pending');
  assert.equal(Object.hasOwn(cards[0], 'sourceRevision'), false);
  assert.doesNotMatch(JSON.stringify(cards), /PRIVATE-|contactId|internalNotes|email|sourceRevision/u);
  assert.deepEqual({ guests, evidence }, before);
});

test('valid empty attendance evidence keeps all public cards pending without fabricating confirmation', () => {
  const guests = [person('person-a'), person('person-b', { status: 'pending', publicConsent: false })];
  for (const evidence of [proof([]), proof([], { sourceRevision: null })]) {
    const before = structuredClone({ guests, evidence }), cards = publicGuestCards(guests, evidence);
    assert.deepEqual(cards.map(item => [item.id, item.attendance]), [['person-a', 'pending'], ['person-b', 'pending']]);
    assert.equal(cards[1].status, 'pending');
    assert.deepEqual({ guests, evidence }, before);
  }
});

test('explicitly private profiles are never guest cards or named session participants', () => {
  const guests = [person('person-a', { visibility: 'private' }), person('person-b')];
  const current = session({ participants: [{ guestId: 'person-b', roles: ['moderator'] }] });
  assert.deepEqual(publicGuestCards(guests, proof(['person-b'])).map(item => item.id), ['person-b']);
  assert.deepEqual(publicSessionParticipants(current, guests, proof(['person-b'])), [{ guestId: 'person-b', name: '合成人物 person-b', roles: ['moderator'], attendance: 'attending' }]);
  assert.deepEqual(publicGuestCards(guests, proof(['person-a'])), [], 'a proof naming a hidden profile is invalid rather than a privacy override');
});

test('a full session retains each public role while attendance only qualifies the corresponding person', () => {
  const guests = [person('person-a'), person('person-b', { status: 'pending' }), person('person-c')];
  const current = session({ participants: [{ guestId: 'person-b', roles: ['moderator','organizer'] }, { guestId: 'person-c', roles: ['panelist'] }] });
  const original = structuredClone({ guests, current }), actual = publicSessionParticipants(current, guests, proof(['person-a','person-c']));
  assert.deepEqual(actual, [
    { guestId: 'person-a', name: '合成人物 person-a', roles: ['speaker'], attendance: 'attending' },
    { guestId: 'person-b', name: '合成人物 person-b', roles: ['moderator','organizer'], attendance: 'pending' },
    { guestId: 'person-c', name: '合成人物 person-c', roles: ['panelist'], attendance: 'attending' },
  ]);
  assert.doesNotMatch(JSON.stringify(actual), /PRIVATE-|contactId|internalNotes|speakerStatus|sourceRevision/u);
  assert.deepEqual({ guests, current }, original);
  actual[1].roles.push('speaker'); assert.deepEqual(current.participants[0].roles, ['moderator','organizer']);
});

test('missing or invalid proof keeps editorial session associations visible as pending', () => {
  const guests = [person('person-a'), person('person-b')], current = session({ participants: [{ guestId: 'person-b', roles: ['panelist'] }] });
  for (const evidence of [undefined, proof([], { sourceRevision: null }), proof(['missing']), { ...proof(), contactId: 'PRIVATE' }]) {
    const people = publicSessionParticipants(current, guests, evidence);
    assert.equal(people.length, 2); assert.ok(people.every(item => item.attendance === 'pending'));
    const cards = publicGuestCards(guests, evidence);
    if (evidence === undefined || evidence.sourceRevision === null) assert.deepEqual(cards.map(item => item.attendance), ['pending', 'pending']);
    else assert.deepEqual(cards, []);
  }
});

test('legacy unlinked speaker text remains an unconfirmed editorial arrangement even with confirmed profile text', () => {
  const guests = [person('person-a')], current = session({ guestId: '', speakerName: '合成历史文字讲者', participants: [{ guestId: 'person-a', roles: ['moderator'] }] });
  assert.deepEqual(publicSessionParticipants(current, guests, proof()), [
    { guestId: '', name: '合成历史文字讲者', roles: ['speaker'], attendance: 'pending' },
    { guestId: 'person-a', name: '合成人物 person-a', roles: ['moderator'], attendance: 'attending' },
  ]);
  assert.deepEqual(publicSessionParticipants({ ...current, speakerStatus: 'pending' }, guests, proof()), [
    { guestId: 'person-a', name: '合成人物 person-a', roles: ['moderator'], attendance: 'attending' },
  ]);
});

test('cancelled sessions clear their participation display and missing references do not drop the valid remaining people', () => {
  const guests = [person('person-b')], current = session({ participants: [{ guestId: 'missing', roles: ['moderator'] }, { guestId: 'person-b', roles: ['panelist'] }] });
  assert.deepEqual(publicSessionParticipants(current, guests, proof(['person-b'])), [{ guestId: 'person-b', name: '合成人物 person-b', roles: ['panelist'], attendance: 'attending' }]);
  for (const status of ['cancelled','draft']) assert.deepEqual(publicSessionParticipants({ ...current, status }, guests, proof(['person-b'])), []);
});

test('public participant display ignores unsupported roles and never executes supplied field getters', () => {
  const guests = [person('person-a'), person('person-b')], current = session({ participants: [{ guestId: 'person-b', roles: ['host'] }] });
  assert.deepEqual(publicSessionParticipants(current, guests, proof()).map(item => item.guestId), ['person-a']);
  current.participants[0].roles = ['panelist','panelist'];
  assert.deepEqual(publicSessionParticipants(current, guests, proof()).map(item => item.guestId), ['person-a']);
  const participant = { guestId: 'person-b', roles: ['moderator'] };
  Object.defineProperty(participant, 'guestId', { enumerable: true, get() { assert.fail('participant getters must not execute'); } });
  current.participants = [participant];
  assert.deepEqual(publicSessionParticipants(current, guests, proof()).map(item => item.guestId), ['person-a']);
  const accessor = session(); Object.defineProperty(accessor, 'status', { get() { assert.fail('session getters must not execute'); } });
  assert.deepEqual(publicSessionParticipants(accessor, guests, proof()), []);
});

test('guest session links retain scheduled primary and additional associations independently of profile confirmation', () => {
  const first = session({ speakerStatus: 'pending', participants: [{ guestId: 'person-b', roles: ['moderator','organizer'] }] });
  const second = session({ id: 'synthetic-second', start: '11:00', end: '12:00', guestId: 'person-b' });
  const original = structuredClone([second, first]), links = publicGuestSessions([second, first], 'person-b');
  assert.deepEqual(links.map(item => item.id), ['synthetic-session','synthetic-second']);
  assert.doesNotMatch(JSON.stringify(links), /PRIVATE-|guestId|speakerStatus|roles|internalNotes/u);
  assert.deepEqual(publicGuestSessions([first], 'person-a').map(item => item.id), ['synthetic-session']);
  assert.deepEqual(publicGuestSessions([{ ...first, status: 'cancelled' }], 'person-b'), []);
  assert.deepEqual(publicGuestSessions([{ ...first, participants: [{ guestId: 'person-b', roles: ['host'] }] }], 'person-b'), []);
  assert.deepEqual([second, first], original);
});
