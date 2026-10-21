import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonWorkspaceApi, isPersonWorkspacePath } from '../functions/person-workspace/handler.mjs';

import { fixture, ORIGIN, CONTACT, REGISTRATION, OTHER_REGISTRATION, AT, actor } from './person-workspace-fixture.mjs';

test('owner projection keeps admission, review, actual response and historical intent distinct without leaking source documents', async () => {
  const f = fixture(), before = structuredClone(f.data), { response, body } = await f.read();
  assert.equal(response.status, 200);
  assert.deepEqual(body.linkage, { state: 'linked', contactId: CONTACT, registrationId: REGISTRATION });
  assert.equal(body.person.organization, '合成机构', 'current outreach profile supplies the heading');
  assert.equal(body.admission.status, 'confirmed'); assert.equal(body.admission.kind, 'attendee');
  assert.equal(body.registration.review.status, 'in_review'); assert.equal(body.registration.review.accommodationStatus, 'pending');
  assert.equal(body.registration.fields.attendance, 'uncertain'); assert.equal(body.contact.operations.responseStatus, 'pending');
  assert.deepEqual(body.contact.operations.participationForms, ['speaker', 'attendee']);
  assert.deepEqual(body.arrangements.sessions[0].roles, ['speaker']);
  assert.deepEqual(body.arrangements.sessions[1], { id: 'removed-session', title: '', start: '', end: '', zone: '', status: 'missing', roles: [], missing: true });
  assert.equal(body.arrangements.booths[0].position, '1');
  assert.equal(body.communications.invitations[0].status, 'provider_accepted');
  assert.equal(body.communications.confirmations[0].status, 'provider_accepted');
  assert.equal(body.communications.timeline.some(item => item.source === 'legacy_invitation'), true);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-|receiptToken|confirmationUrl|rawAnswers|"consent"/u);
  assert.equal(Object.hasOwn(body.contact, 'source'), false); assert.equal(Object.hasOwn(body.registration, 'consent'), false);
  assert.deepEqual(f.data, before, 'projection never mutates trusted sources');
  assert.deepEqual(f.calls.map(item => item.source), ['contacts', 'intent', 'registration', 'admission', 'confirmations', 'content']);
  for (const [name, value] of [['cache-control', 'no-store'], ['x-content-type-options', 'nosniff'], ['referrer-policy', 'no-referrer']]) assert.equal(response.headers.get(name), value);
});

test('outreach reads only its contact, arrangements, invitation metadata and existing minimal admission', async () => {
  const f = fixture({ roles: ['outreach'] });
  const deny = async () => assert.fail('private reviewer repository must not be touched');
  const { response, body } = await f.read({ loadRegistration: deny, loadConfirmations: deny });
  assert.equal(response.status, 200); assert.equal(body.registration, null); assert.equal(body.admission.status, 'confirmed');
  assert.equal(body.availability.registration, 'restricted'); assert.equal(body.availability.confirmations, 'restricted');
  assert.deepEqual(body.permissions, { contact: true, registration: false, invitations: true, confirmations: false, arrangements: true });
  assert.equal(body.contact.profile.email, 'contact@example.invalid');
  assert.doesNotMatch(JSON.stringify(body), /registration@example|PRIVATE-|in_review|accommodationChoice/u);
  assert.deepEqual(f.calls.map(item => item.source), ['contacts', 'intent', 'admission', 'content']);
  const rejected = await f.api()(f.request('/api/admin/people/registrations/' + REGISTRATION));
  assert.equal(rejected.status, 403);
});

test('reviewer registration lookup never reads outreach repositories or reveals its explicit source contact identifier', async () => {
  const f = fixture({ roles: ['reviewer'] }), deny = async () => assert.fail('outreach source must not be read');
  const { response, body } = await f.read({ loadContacts: deny, loadIntent: deny, loadContent: deny }, '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(response.status, 200); assert.equal(body.contact, null);
  assert.deepEqual(body.linkage, { state: 'restricted', contactId: null, registrationId: REGISTRATION });
  assert.equal(body.availability.contact, 'restricted'); assert.equal(body.availability.invitations, 'restricted'); assert.equal(body.availability.arrangements, 'restricted');
  assert.equal(body.publicProfile.state, 'restricted'); assert.equal(body.publicProfile.profiles.length, 0);
  assert.equal(body.registration.fields.email, 'registration@example.invalid');
  assert.equal(body.communications.confirmationTotal, 1);
  assert.doesNotMatch(JSON.stringify(body), new RegExp(CONTACT + '|contact@example|PRIVATE-', 'u'));
  assert.deepEqual(f.calls.map(item => item.source), ['registration', 'admission', 'confirmations']);
});

test('editor or malformed session cannot use a missing identifier to enumerate sources', async () => {
  for (const user of [actor(['editor']), actor([]), { id: '', roles: ['superadmin'] }, { id: 'invalid user', roles: ['superadmin'] }, null]) {
    const f = fixture(), handle = f.api({ authenticate: async () => ({ user }) });
    for (const path of ['/api/admin/people/contacts/missing-person', '/api/admin/people/registrations/' + OTHER_REGISTRATION]) {
      assert.equal((await handle(f.request(path))).status, user?.id && /^[A-Za-z0-9_-]+$/u.test(user.id) ? 403 : 401);
    }
    assert.equal(f.calls.length, 0);
  }
});

test('URL, origin and GET boundaries reject ambiguous requests before authentication or storage I/O', async () => {
  const f = fixture(), handle = f.api();
  assert.equal(isPersonWorkspacePath('/api/admin/people/contacts/x'), true);
  assert.equal(isPersonWorkspacePath('/api/admin/peopleish/contacts/x'), false);
  for (const path of ['/api/admin/people/', '/api/admin/people/contacts', '/api/admin/people/contacts/x/', '/api/admin/people/unknown/x',
    '/api/admin/people/contacts/x?includeContact=true', '/api/admin/people/contacts/x?x=1&x=2', '/api/admin/people/contacts/x#token']) {
    assert.equal((await handle(f.request(path))).status, 404, path);
  }
  for (const url of ['http://api.artdico.host/api/admin/people/contacts/x', 'https://foreign.invalid/api/admin/people/contacts/x'])
    assert.equal((await handle(new Request(url))).status, 404);
  assert.equal((await handle(f.request(undefined, { headers: { origin: 'https://artdico.host' } }))).status, 403);
  assert.equal((await handle(f.request(undefined, { headers: { origin: ORIGIN + '/' } }))).status, 403);
  for (const method of ['HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = await handle(f.request(undefined, { method })); assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET');
  }
  assert.equal(f.authentications, 0); assert.equal(f.calls.length, 0);
});

test('selected identifiers are canonical, bounded and checked after route authorization', async () => {
  const f = fixture();
  for (const path of ['/api/admin/people/contacts/%61', '/api/admin/people/contacts/a%2Fb', '/api/admin/people/contacts/_leading',
    '/api/admin/people/contacts/' + 'a'.repeat(81), '/api/admin/people/registrations/short', '/api/admin/people/registrations/' + 'a'.repeat(44)]) {
    assert.equal((await f.api()(f.request(path))).status, 400, path);
  }
  assert.equal(f.calls.length, 0);
  assert.equal((await fixture({ roles: ['reviewer'] }).api()(f.request('/api/admin/people/contacts/_invalid'))).status, 403);
});

test('authorized absence yields 404, but missing or failed required sources yield an opaque unavailable response', async () => {
  const f = fixture();
  assert.equal((await f.api()(f.request('/api/admin/people/contacts/absent'))).status, 404);
  for (const value of [null, undefined, { revision: 1, contacts: [{ id: 123 }] }]) {
    const { response, body } = await f.read({ loadContacts: async () => value }); assert.equal(response.status, 503);
    assert.equal(body.error.code, 'PERSON_UNAVAILABLE');
  }
  const absent = Object.assign(new Error('PRIVATE-NOT-FOUND'), { code: 'NOT_FOUND' });
  assert.equal((await f.api({ loadRegistration: async () => { throw absent; } })(f.request('/api/admin/people/registrations/' + REGISTRATION))).status, 404);
  for (const fail of [new Error('PRIVATE-STORAGE-DIAGNOSTIC'), Object.assign(new Error('PRIVATE-FORBIDDEN'), { status: 403 })]) {
    const { response, body } = await f.read({ loadContacts: async () => { throw fail; } });
    assert.equal(response.status, 503); assert.doesNotMatch(JSON.stringify(body), /PRIVATE|STORAGE|FORBIDDEN/u);
  }
});

test('equal names and email addresses never create a relationship without a stable conversion', async () => {
  const f = fixture({ linked: false });
  f.data.registration.registration.fields.name = f.data.contacts.contacts[0].profile.name;
  f.data.registration.registration.fields.email = f.data.contacts.contacts[0].profile.email;
  const { response, body } = await f.read({ loadRegistration: async () => assert.fail('cannot search unrelated registrations'), loadAdmission: async () => assert.fail('unlinked admission cannot be read') });
  assert.equal(response.status, 200); assert.deepEqual(body.linkage, { state: 'unlinked', contactId: CONTACT, registrationId: null });
  assert.equal(body.registration, null); assert.equal(body.admission, null); assert.equal(body.availability.registration, 'unlinked');
  assert.equal(body.availability.confirmations, 'unlinked'); assert.equal(body.communications.confirmationTotal, 0);
});

test('public registration never searches a roster for equal names or emails', async () => {
  const f = fixture(); f.data.registration.registration.provenance = { kind: 'public' };
  const deny = async () => assert.fail('an unlinked registration must not read any outreach source');
  const { response, body } = await f.read({ loadContacts: deny, loadIntent: deny, loadContent: deny }, '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(response.status, 200); assert.equal(body.linkage.state, 'unlinked'); assert.equal(body.contact, null);
  assert.equal(body.availability.contact, 'unlinked'); assert.equal(body.availability.invitations, 'unlinked');
});

test('optional source failures remain unavailable, preserve the selected record and never invent unlinked state', async () => {
  const f = fixture();
  const { response, body } = await f.read({ loadIntent: undefined, loadContent: async () => { throw new Error('PRIVATE-CONTENT-FAILURE'); } });
  assert.equal(response.status, 200); assert.equal(body.contact.id, CONTACT); assert.equal(body.linkage.state, 'unavailable');
  for (const key of ['invitations', 'registration', 'admission', 'confirmations', 'arrangements']) assert.equal(body.availability[key], 'unavailable');
  assert.equal(body.registration, null); assert.equal(body.admission, null); assert.equal(body.revisions.invitations, null);
  assert.deepEqual(f.calls.map(item => item.source), ['contacts']);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE/u);
});

test('registration and conversion disagreement fails closed without reading another admission or confirmation', async () => {
  const f = fixture(); f.data.registration.registration.provenance.sourceContactId = 'different-person';
  const { response, body } = await f.read({ loadAdmission: async () => assert.fail('mismatched relation'), loadConfirmations: async () => assert.fail('mismatched relation') });
  assert.equal(response.status, 200); assert.equal(body.linkage.state, 'unavailable'); assert.equal(body.registration, null);
  assert.equal(body.availability.registration, 'unavailable'); assert.equal(body.availability.admission, 'unavailable');
  assert.equal(body.availability.confirmations, 'unavailable');
  assert.equal(body.linkage.registrationId, null); assert.equal(body.availability.invitations, 'unavailable');
  assert.equal(body.communications.invitations.length, 0);
});

test('registration-entry relationship conflict never adopts another contact heading or follows its arrangements', async () => {
  const f = fixture(); f.data.intent.conversions[0].registrationId = OTHER_REGISTRATION; f.data.intent.invitations = [];
  const deny = async () => assert.fail('conflicting secondary identity must not trigger lookup');
  const { response, body } = await f.read({ loadContacts: deny, loadContent: deny, loadAdmission: deny, loadConfirmations: deny }, '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(response.status, 200); assert.equal(body.registration.id, REGISTRATION); assert.equal(body.contact, null);
  assert.equal(body.person.organization, '合成报名机构');
  assert.deepEqual(body.linkage, { state: 'unavailable', contactId: null, registrationId: REGISTRATION });
  for (const key of ['contact', 'invitations', 'admission', 'confirmations', 'arrangements', 'publicProfile']) assert.equal(body.availability[key], 'unavailable');
  assert.deepEqual(f.calls.map(item => item.source), ['registration', 'intent']);
});

test('a missing source contact on registration lookup is unavailable rather than an unrelated or unlinked contact', async () => {
  const f = fixture(); f.data.contacts.contacts = [];
  const { response, body } = await f.read({ loadAdmission: async () => assert.fail('uncertain association'), loadConfirmations: async () => assert.fail('uncertain association') }, '/api/admin/people/registrations/' + REGISTRATION);
  assert.equal(response.status, 200); assert.equal(body.registration.id, REGISTRATION); assert.equal(body.contact, null);
  assert.equal(body.linkage.state, 'unavailable'); assert.equal(body.availability.contact, 'unavailable'); assert.equal(body.availability.arrangements, 'unavailable');
});

test('effective withdrawal overrides only admission and does not rewrite independent review or response data', async () => {
  for (const withdraw of [review => { review.status = 'withdrawn'; }, review => { review.deletionRequested = { status: 'pending', reason: 'request' }; }]) {
    const f = fixture(); withdraw(f.data.registration.review);
    const { response, body } = await f.read(); assert.equal(response.status, 200); assert.equal(body.admission.status, 'withdrawn');
    assert.equal(body.admission.revision, 12); assert.equal(body.registration.review.accommodationStatus, 'pending');
    assert.equal(body.contact.operations.responseStatus, 'pending'); assert.equal(body.registration.fields.attendance, 'uncertain');
    assert.equal(f.data.admission.status, 'confirmed', 'projection does not reconcile by writing');
  }
});

test('unknown delivery remains unknown and bounded histories retain their total and explicit truncation', async () => {
  const f = fixture(); f.data.contacts.contacts[0].invitation = {};
  f.data.intent.invitations = Array.from({ length: 201 }, (_, index) => ({ ...f.data.intent.invitations[0], id: 'invite-' + index,
    status: index === 200 ? 'issuing' : 'provider_accepted', updatedAt: new Date(Date.parse(AT) + index * 1000).toISOString() }));
  f.data.confirmations.notices[0].status = 'reserved';
  const { response, body } = await f.read(); assert.equal(response.status, 200);
  assert.equal(body.communications.historyLimit, 200); assert.equal(body.communications.invitationTotal, 201);
  assert.equal(body.communications.confirmationTotal, 1); assert.equal(body.communications.timelineTotal, 202); assert.equal(body.communications.historyTruncated, true);
  assert.equal(body.communications.invitations.length, 200); assert.equal(body.communications.timeline.length, 200);
  assert.equal(body.communications.invitations[0].id, 'invite-200'); assert.equal(body.communications.invitations[0].status, 'unknown');
  assert.equal(body.communications.confirmations[0].status, 'unknown');
  assert.doesNotMatch(JSON.stringify(body.communications), /"issuing"|"reserved"|PRIVATE/u);
});

test('malformed optional history or arrangements fail only their source and never receive a revision', async () => {
  const f = fixture(); f.data.confirmations.notices[0].createdAt = '2026-02-31T00:00:00Z'; f.data.content.content.booths[0].slotNumber = 16;
  const { response, body } = await f.read(); assert.equal(response.status, 200);
  assert.equal(body.availability.confirmations, 'unavailable'); assert.equal(body.revisions.confirmations, null);
  assert.equal(body.availability.arrangements, 'unavailable'); assert.equal(body.revisions.content, null);
  assert.equal(body.contact.id, CONTACT); assert.equal(body.admission.status, 'confirmed');
});

test('public profile is attributed by exact contact ID and saved guest ID, independently of draft eligibility', async () => {
  const f = fixture(); f.data.content.content.guests[0].status = 'pending'; f.data.content.content.guests[0].publicConsent = false;
  f.data.content.content.guests.push({ ...f.data.content.content.guests[0], id: 'unrelated-profile', contactId: 'another-person', name: '合成甲' });
  const { response, body } = await f.read(); assert.equal(response.status, 200); assert.equal(body.availability.publicProfile, 'available');
  assert.equal(body.publicProfile.profiles.length, 1); assert.equal(body.publicProfile.profiles[0].id, 'synthetic-guest');
  assert.equal(body.publicProfile.profiles[0].status, 'pending'); assert.equal(body.publicProfile.profiles[0].publicConsent, false);
  assert.equal(body.publicProfile.profiles[0].published, true, 'pending draft withdrawal does not erase a saved publication');
  assert.equal(body.publicProfile.profiles[0].publishedMatchesDraft, false);
  assert.equal(body.publicProfile.publishedRevision, 4); assert.equal(body.publicProfile.publishedAt, AT);
  assert.deepEqual(body.publicProfile.profiles[0].publicRoles, ['speaker', 'organizer']);
});

test('stable guest linkage includes existing sessions without inventing roles or matching speaker names', async () => {
  const f = fixture();
  f.data.content.content.sessions[0].guestId = 'synthetic-guest';
  f.data.content.content.sessions.push({ id: 'guest-only-session', title: '明确嘉宾关联', start: '11:00', end: '12:00', zone: 'A', status: 'draft', guestId: 'synthetic-guest' },
    { id: 'same-name-session', title: '另一讲者', start: '12:00', end: '13:00', zone: 'A', status: 'scheduled', speakerName: '合成甲', guestId: '' });
  const { response, body } = await f.read(); assert.equal(response.status, 200);
  assert.deepEqual(body.arrangements.sessions.map(item => item.id), ['synthetic-session', 'removed-session', 'guest-only-session']);
  assert.deepEqual(body.arrangements.sessions[0].roles, ['speaker']); assert.deepEqual(body.arrangements.sessions[2].roles, []);
  assert.deepEqual(body.contact.operations.sessionIds, ['synthetic-session', 'removed-session'], 'read aggregate does not backfill saved assignments');
});

test('publication equality compares this guest public fields rather than the overall content revision', async () => {
  const f = fixture(), guest = f.data.content.content.guests[0];
  guest.ggjRole = '合成SO'; guest.bio = '公开介绍'; guest.website = 'https://example.invalid/profile';
  f.data.content.published.content.guests = [{ ...structuredClone(guest), portraitUrl: '/api/public/portraits/' + guest.portraitId }];
  delete f.data.content.published.content.guests[0].contactId; delete f.data.content.published.content.guests[0].internalNotes;
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, true);
  const savedPortraitUrl = f.data.content.published.content.guests[0].portraitUrl;
  f.data.content.published.content.guests[0].portraitUrl = '/api/public/portraits/other';
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, false);
  f.data.content.published.content.guests[0].portraitUrl = savedPortraitUrl;
  f.data.content.revision++; f.data.content.content.booths[0].project = '更正其他作品'; guest.internalNotes = 'PRIVATE-CHANGED-NOTE';
  assert.equal((await f.read()).body.publicProfile.profiles[0].publishedMatchesDraft, true, 'unrelated draft updates do not invent unpublished person changes');
  for (const [key, value] of Object.entries({ name: '另一公开名', company: '另一公司', title: '研究员', ggjRole: '合成RO', bio: '更新介绍',
    website: 'https://example.invalid/new', portraitId: 'e'.repeat(64) + '.png', publicRoles: ['guest'], status: 'pending', publicConsent: false })) {
    const previous = guest[key]; guest[key] = value;
    const profile = (await f.read()).body.publicProfile.profiles[0];
    assert.equal(profile.published, true, key + ' does not automatically withdraw saved publication');
    assert.equal(profile.publishedMatchesDraft, false, key + ' affects public rendering or eligibility'); guest[key] = previous;
  }
  guest.portraitId = '';
  const removedPhoto = (await f.read()).body.publicProfile.profiles[0]; assert.equal(removedPhoto.hasPortrait, false);
  assert.equal(removedPhoto.published, true); assert.equal(removedPhoto.publishedMatchesDraft, false);
});

test('eligible draft guest is never called published without its saved guest ID', async () => {
  const f = fixture(); f.data.content.published = null;
  const { body } = await f.read(); assert.equal(body.publicProfile.state, 'available');
  assert.equal(body.publicProfile.profiles[0].publicConsent, true); assert.equal(body.publicProfile.profiles[0].hasPortrait, true);
  assert.equal(body.publicProfile.profiles[0].published, false); assert.equal(body.publicProfile.publishedRevision, null);
  f.data.content.published = { revision: 4, publishedAt: AT, content: { guests: [{ id: 'different-guest', name: '合成甲' }] } };
  assert.equal((await f.read()).body.publicProfile.profiles[0].published, false, 'equal public display name does not link a snapshot');
});

test('missing publication source and unassignable orphan snapshot require verification without breaking arrangements', async () => {
  for (const change of [source => { delete source.published; }, source => { source.content.guests = []; }, source => { source.published.publishedAt = 'bad-time'; }]) {
    const f = fixture(); change(f.data.content);
    const { response, body } = await f.read(); assert.equal(response.status, 200);
    assert.equal(body.availability.publicProfile, 'unavailable'); assert.equal(body.publicProfile.state, 'unavailable');
    assert.equal(body.availability.arrangements, 'available'); assert.equal(body.arrangements.sessions[0].id, 'synthetic-session');
    assert.equal(body.publicProfile.profiles.length, 0);
  }
  const f = fixture(); f.data.content.content.guests = []; f.data.content.published = null;
  assert.equal((await f.read()).body.publicProfile.state, 'unlinked', 'no explicit guest or saved publication is a known unlinked state');
});

test('expired authentication stops further source reads and never returns previously assembled data', async () => {
  const f = fixture(), { response, body } = await f.read({ loadIntent: async () => { throw Object.assign(new Error('PRIVATE-SESSION'), { status: 401 }); } });
  assert.equal(response.status, 401); assert.deepEqual(f.calls.map(item => item.source), ['contacts']);
  assert.doesNotMatch(JSON.stringify(body), /合成甲|PRIVATE|contact@example/u);
});

test('aborted reads do not continue to later sources or return the assembled private record', async () => {
  const f = fixture(), controller = new AbortController();
  const handle = f.api({ loadContacts: async () => { controller.abort(); return f.data.contacts; } });
  const response = await handle(f.request(undefined, { signal: controller.signal }));
  assert.equal(response.status, 503); assert.equal(f.calls.length, 0); assert.doesNotMatch(await response.text(), /合成甲|contact@example/u);
});
