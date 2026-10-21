import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, CONTACT, REGISTRATION, actor } from './person-workspace-fixture.mjs';
import { volunteersFixture } from './person-workspace-volunteers-fixture.mjs';
import { personWorkspaceView } from '../src/lib/person-workspace.mjs';

test('person volunteer loader receives only explicit selected identity after the combined role gate', async () => {
  for (const roles of [['superadmin'], ['outreach', 'reviewer']]) {
    for (const kind of ['contact', 'registration']) {
      const f = fixture({ roles }), before = structuredClone(f.data), calls = [];
      const { response, body } = await f.read({ loadVolunteers: async input => { calls.push(input); return volunteersFixture(); } },
        '/api/admin/people/' + (kind === 'contact' ? 'contacts/' + CONTACT : 'registrations/' + REGISTRATION));
      assert.equal(response.status, 200);
      assert.deepEqual(calls, [{ actor: actor(roles), contactId: CONTACT, registrationId: REGISTRATION }]);
      assert.equal(body.permissions.volunteers, true); assert.equal(body.availability.volunteers, 'available');
      assert.equal(body.revisions.volunteers, 4); assert.deepEqual(body.volunteers, volunteersFixture());
      assert.ok(personWorkspaceView(body, body.selected), 'new projection passes browser validation');
      assert.equal(body.admission.status, 'confirmed'); assert.equal(body.contact.operations.responseStatus, 'pending');
      assert.deepEqual(f.data, before, 'read-only projection never saves admission or contact changes');
    }
  }
});

test('outreach-only and reviewer-only roles cannot touch volunteer journal or reveal roster data', async () => {
  for (const roles of [['outreach'], ['reviewer'], ['outreach', 'editor'], ['reviewer', 'editor']]) {
    const f = fixture({ roles });
    const { response, body } = await f.read({ loadVolunteers: async () => assert.fail('combined volunteer role gate must precede loading') },
      '/api/admin/people/' + (roles.includes('outreach') ? 'contacts/' + CONTACT : 'registrations/' + REGISTRATION));
    assert.equal(response.status, 200); assert.equal(body.permissions.volunteers, false);
    assert.equal(body.availability.volunteers, 'restricted'); assert.equal(body.revisions.volunteers, null);
    assert.deepEqual(body.volunteers, { revision: null, entries: [] });
    assert.ok(personWorkspaceView(body, body.selected));
  }
});

test('unlinked selected sources pass their existing ID without matching on name or email', async () => {
  for (const kind of ['contact', 'registration']) {
    const f = fixture({ linked: false }), calls = [];
    if (kind === 'registration') f.data.registration.registration.provenance = { kind: 'public' };
    const { body } = await f.read({ loadVolunteers: async input => { calls.push(input); return { revision: 2, entries: [] }; } },
      '/api/admin/people/' + (kind === 'contact' ? 'contacts/' + CONTACT : 'registrations/' + REGISTRATION));
    assert.deepEqual(calls, [{ actor: actor(['superadmin']), contactId: kind === 'contact' ? CONTACT : null, registrationId: kind === 'registration' ? REGISTRATION : null }]);
    assert.equal(body.availability.volunteers, 'unlinked'); assert.equal(body.revisions.volunteers, 2);
    assert.deepEqual(body.volunteers, { revision: 2, entries: [] });
  }
});

test('unknown or conflicting linkage never loads a volunteer journal with a speculative second identity', async () => {
  for (const change of [f => { f.options.loadIntent = undefined; }, f => { f.data.registration.registration.provenance.sourceContactId = 'different-person'; }]) {
    const f = fixture(); change(f);
    const { response, body } = await f.read({ ...(f.options.loadIntent === undefined ? { loadIntent: undefined } : {}),
      loadVolunteers: async () => assert.fail('uncertain identity must not reach volunteer source') });
    assert.equal(response.status, 200); assert.equal(body.linkage.state, 'unavailable');
    assert.equal(body.availability.volunteers, 'unavailable'); assert.equal(body.revisions.volunteers, null);
    assert.deepEqual(body.volunteers, { revision: null, entries: [] });
  }
});

test('volunteer source errors and malformed projections remain partial unavailable without losing the person', async () => {
  const malformed = [undefined, null, { revision: -1, entries: [] }];
  for (const change of [source => { source.entries[0].workflowStatus = 'attending'; }, source => { source.entries[0].availability[0].end = '09:00'; },
    source => { source.entries[0].assignments[0].eligible = 'yes'; }, source => { source.entries[0].assignments[0].shiftId = '../shift'; },
    source => { source.entries[0].assignments[0].start = '24:00'; }, source => { source.entries[0].assignments[0].location = 'hidden\u0000text'; },
    source => { source.entries[0].assignments[0].issues = ['PRIVATE-DIAGNOSTIC']; }, source => { delete source.entries[0].assignments[0].issues; },
    source => { source.entries[0].availability = Array(13).fill({ start: '09:00', end: '18:00' }); },
    source => { source.entries.push(structuredClone(source.entries[0])); }, source => { source.entries[0].assignments.push(structuredClone(source.entries[0].assignments[0])); }]) {
    const source = volunteersFixture(); change(source); malformed.push(source);
  }
  const loaders = [undefined, async () => { throw new Error('PRIVATE-VOLUNTEER-STORAGE'); }, ...malformed.map(source => async () => source)];
  for (const loadVolunteers of loaders) {
    const f = fixture(), { response, body } = await f.read({ loadVolunteers });
    assert.equal(response.status, 200); assert.equal(body.contact.id, CONTACT); assert.equal(body.admission.status, 'confirmed');
    assert.equal(body.availability.volunteers, 'unavailable'); assert.equal(body.revisions.volunteers, null);
    assert.deepEqual(body.volunteers, { revision: null, entries: [] });
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE-VOLUNTEER/u);
    assert.ok(personWorkspaceView(body, body.selected));
  }
});

test('minimal volunteer projection strips source extras and never changes waitlisted admission or actual reply', async () => {
  const f = fixture(), source = volunteersFixture(); f.data.admission.status = 'waitlisted';
  source.notes = 'PRIVATE-JOURNAL'; source.contacts = [{ email: 'PRIVATE-ROSTER-EMAIL' }];
  source.entries[0].notes = 'PRIVATE-VOLUNTEER-NOTES'; source.entries[0].profile = { email: 'PRIVATE-PERSON-EMAIL' };
  source.entries[0].assignments[0].owner = 'PRIVATE-OWNER'; source.entries[0].assignments[0].notes = 'PRIVATE-SHIFT-NOTES';
  const before = structuredClone(source), { body } = await f.read({ loadVolunteers: async () => source });
  assert.deepEqual(body.volunteers, volunteersFixture()); assert.equal(body.admission.status, 'waitlisted');
  assert.equal(body.contact.operations.responseStatus, 'pending'); assert.deepEqual(source, before);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-/u);
});

test('per-shift safe issues remain visible as unresolved facts without turning confirmed volunteering into admission', async () => {
  const f = fixture(), source = volunteersFixture(); f.data.admission.status = 'waitlisted';
  source.entries[0].assignments[0].eligible = false;
  source.entries[0].assignments[0].issues = ['ADMISSION_NOT_CONFIRMED', 'TIME_CONFLICT'];
  const { body } = await f.read({ loadVolunteers: async () => source });
  assert.equal(body.availability.volunteers, 'available'); assert.equal(body.admission.status, 'waitlisted');
  assert.deepEqual(body.volunteers.entries[0].assignments[0].issues, ['ADMISSION_NOT_CONFIRMED', 'TIME_CONFLICT']);
  assert.ok(personWorkspaceView(body, body.selected));
});

test('volunteer source has a global assignment bound and rejects duplicate IDs across linked entries', async () => {
  const source = volunteersFixture(), assignment = source.entries[0].assignments[0];
  source.entries[0].assignments = Array.from({ length: 1000 }, (_, index) => ({ ...assignment, id: 'assignment-' + index }));
  assert.equal((await fixture().read({ loadVolunteers: async () => source })).body.availability.volunteers, 'available');
  source.entries.push({ ...source.entries[0], id: 'another-volunteer', assignments: [{ ...assignment, id: 'assignment-1000' }] });
  assert.equal((await fixture().read({ loadVolunteers: async () => source })).body.availability.volunteers, 'unavailable');
  source.entries[0].assignments = [assignment]; source.entries[1].assignments = [{ ...assignment }];
  assert.equal((await fixture().read({ loadVolunteers: async () => source })).body.availability.volunteers, 'unavailable');
});

test('expired volunteer read clears the assembled person instead of returning stale private sections', async () => {
  const { response, body } = await fixture().read({ loadVolunteers: async () => { throw Object.assign(new Error('PRIVATE-SESSION'), { status: 401 }); } });
  assert.equal(response.status, 401); assert.equal(body.error.code, 'AUTH_REQUIRED');
  assert.doesNotMatch(JSON.stringify(body), /合成|PRIVATE|example.invalid/u);
});
