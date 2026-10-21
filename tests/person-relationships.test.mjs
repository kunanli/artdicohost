import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersonRelationshipsApi, isPersonRelationshipsPath, personRelationshipsProjection } from '../functions/person-workspace/relationships.mjs';
import { publicProfileProjection, contentSource } from '../functions/person-workspace/projection.mjs';
import { createInitialContent } from '../src/config/content.mjs';
import { toPublicContent } from '../shared/content-schema.mjs';
import { fixture, actor, ORIGIN, CONTACT } from './person-workspace-fixture.mjs';

const ROOT = '/api/admin/people/', ORGANIZATION = 'synthetic-organization';
function setup(roles = ['outreach', 'editor']) {
  const f = fixture({ roles }), calls = [];
  f.data.content.content.organizations = [{ id: ORGANIZATION, name: '合成组织', status: 'confirmed', participation: 'exhibitor',
    logoId: '', website: '', publicConsent: true, internalNotes: 'PRIVATE-ORGANIZATION-NOTE' }];
  f.data.content.content.booths[0].organizationId = ORGANIZATION;
  f.data.contacts.contacts[0].operations.organizationMemberships = [{ organizationId: ORGANIZATION, role: 'lead', title: '现场联络人' }];
  const options = { authenticate: async () => ({ user: actor(roles) }),
    loadContent: async staff => { calls.push({ source: 'content', staff }); return f.data.content; },
    loadContacts: async staff => { calls.push({ source: 'contacts', staff }); return f.data.contacts; } };
  const request = (path = ROOT + 'relationships', init = {}) => new Request(ORIGIN + path, init);
  const api = extra => createPersonRelationshipsApi({ ...options, ...extra });
  const read = async (path, extra) => { const response = await api(extra)(request(path)); return { response, body: await response.json() }; };
  return { ...f, calls, options, request, api, read };
}

test('catalog reads content once and emits only exact link metadata with existing public equality semantics', async () => {
  const f = setup(), before = structuredClone(f.data), { response, body } = await f.read();
  assert.equal(response.status, 200); assert.equal(body.schemaVersion, 1); assert.equal(body.contentRevision, 5); assert.equal(body.publishedRevision, 4);
  assert.deepEqual(body.organizations, [{ id: ORGANIZATION, name: '合成组织', status: 'confirmed', participation: 'exhibitor' }]);
  assert.deepEqual(body.boothOrganizations, [{ boothId: 'synthetic-booth', organizationId: ORGANIZATION }]);
  const profile = publicProfileProjection(CONTACT, contentSource(f.data.content)).profiles[0];
  assert.deepEqual(body.profiles, [{ ...Object.fromEntries(['id', 'publicRoles', 'status', 'publicConsent', 'hasPortrait', 'published', 'publishedMatchesDraft'].map(key => [key, profile[key]])), contactId: CONTACT }]);
  assert.equal(body.publicationAttributionUnavailable, false);
  assert.deepEqual(f.calls.map(call => call.source), ['content']); assert.deepEqual(f.data, before);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-|合成甲|开发者|contact@example|portraitId|internalNotes|receiptToken/u);
  for (const [key, value] of [['cache-control', 'no-store'], ['referrer-policy', 'no-referrer'], ['x-content-type-options', 'nosniff']]) assert.equal(response.headers.get(key), value);
});

test('literal outreach and editor requirements precede every relationship source read', async () => {
  for (const roles of [[], ['editor'], ['reviewer'], ['superadmin'], ['editor', 'superadmin']]) {
    const f = setup(roles);
    for (const path of [ROOT + 'relationships', ROOT + 'organizations/' + ORGANIZATION + '/members', ROOT + 'candidates']) assert.equal((await f.read(path)).response.status, 403);
    assert.equal(f.calls.length, 0);
  }
  for (const roles of [['outreach'], ['outreach', 'superadmin']]) {
    const f = setup(roles);
    assert.equal((await f.read()).response.status, 200);
    assert.equal((await f.read(ROOT + 'organizations/' + ORGANIZATION + '/members')).response.status, 200);
    const before = f.calls.length; assert.equal((await f.read(ROOT + 'candidates')).response.status, 403); assert.equal(f.calls.length, before);
  }
  const f = setup();
  for (const user of [null, { id: '', roles: ['outreach', 'editor'] }, { id: 'bad actor', roles: ['outreach'] }]) {
    assert.equal((await f.read(undefined, { authenticate: async () => ({ user }) })).response.status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('strict HTTPS, same-origin, exact routes and GET-only boundaries stop before authentication or source I/O', async () => {
  const f = setup(); let authentications = 0;
  const api = f.api({ authenticate: async () => { authentications++; return { user: actor(['outreach', 'editor']) }; } });
  assert.equal(isPersonRelationshipsPath(ROOT + 'relationships'), true); assert.equal(isPersonRelationshipsPath(ROOT + 'candidates'), true);
  assert.equal(isPersonRelationshipsPath(ROOT + 'organizations/x/members'), true); assert.equal(isPersonRelationshipsPath(ROOT + 'contacts/x'), false);
  for (const url of ['http://api.artdico.host' + ROOT + 'relationships', 'https://foreign.invalid' + ROOT + 'relationships', ORIGIN + ROOT + 'relationships#fragment']) assert.equal((await api(new Request(url))).status, 404);
  for (const path of [ROOT + 'relationships/', ROOT + 'organizations/x', ROOT + 'organizations/x/members/', ROOT + 'candidates/']) assert.equal((await api(f.request(path))).status, 404);
  assert.equal((await api(f.request(undefined, { headers: { origin: 'https://artdico.host' } }))).status, 403);
  for (const method of ['HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']) { const response = await api(f.request(undefined, { method })); assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET'); }
  assert.equal(authentications, 0); assert.equal(f.calls.length, 0);
});

test('query bounds and canonical organization IDs are checked after role authorization but before storage', async () => {
  const f = setup();
  for (const path of [ROOT + 'relationships?x=1', ROOT + 'candidates?limit=201', ROOT + 'candidates?limit=0', ROOT + 'candidates?cursor=5001',
    ROOT + 'candidates?cursor=01', ROOT + 'candidates?query=a&query=b', ROOT + 'candidates?id=x&query=', ROOT + 'candidates?id=x&cursor=0',
    ROOT + 'candidates?id=', ROOT + 'candidates?query=%00', ROOT + 'candidates?query=' + 'a'.repeat(201), ROOT + 'candidates?email=x',
    ROOT + 'organizations/%61/members', ROOT + 'organizations/_invalid/members', ROOT + 'organizations/' + 'a'.repeat(81) + '/members',
    ROOT + 'organizations/' + ORGANIZATION + '/members?limit=201', ROOT + 'organizations/' + ORGANIZATION + '/members?query=name']) {
    assert.equal((await f.read(path)).response.status, 400, path);
  }
  assert.equal(f.calls.length, 0);
});

test('member view uses only saved organization IDs and returns minimal current names and member roles', async () => {
  const f = setup(), sameName = structuredClone(f.data.contacts.contacts[0]); sameName.id = 'unlinked-same-name';
  delete sameName.operations.organizationMemberships; f.data.contacts.contacts.push(sameName);
  const { response, body } = await f.read(ROOT + 'organizations/' + ORGANIZATION + '/members');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { schemaVersion: 1, organizationId: ORGANIZATION, contentRevision: 5, contactsRevision: 3,
    members: [{ contactId: CONTACT, name: '合成甲', role: 'lead', title: '现场联络人' }], total: 1, nextCursor: null });
  assert.deepEqual(f.calls.map(call => call.source), ['content', 'contacts']);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|email|phone|wechat|notes|responseStatus|contactConsent|organizationMemberships/u);
  const before = f.calls.length;
  assert.equal((await f.read(ROOT + 'organizations/missing-organization/members')).response.status, 404);
  assert.deepEqual(f.calls.slice(before).map(call => call.source), ['content'], 'unknown organization never triggers a roster read');
});

test('minimal picker has independent full-role gate and uses the existing guestPrefill eligibility', async () => {
  const f = setup();
  const add = (id, change) => { const row = structuredClone(f.data.contacts.contacts[0]); row.id = id; change(row); f.data.contacts.contacts.push(row); };
  add('unknown-consent', row => { row.profile.contactConsent = 'unknown'; });
  add('declined', row => { row.operations.responseStatus = 'declined'; });
  add('company-needs-review', row => { row.profile.organization = 'x'.repeat(161); });
  const { response, body } = await f.read(ROOT + 'candidates');
  assert.equal(response.status, 200); assert.equal(body.contactsRevision, 3); assert.equal(body.total, 4);
  assert.deepEqual(body.candidates.map(row => [row.id, row.eligible]), [[CONTACT, true], ['unknown-consent', false], ['declined', false], ['company-needs-review', false]]);
  assert.deepEqual(f.calls.map(call => call.source), ['contacts']);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE-|email|wechat|phone|notes|background|participationForms|admissionStatus/u);
  const exact = await f.read(ROOT + 'candidates?id=declined'); assert.equal(exact.body.total, 1); assert.equal(exact.body.candidates[0].id, 'declined');
  assert.equal((await f.read(ROOT + 'candidates?query=unmatched')).body.total, 0);
});

test('member and picker pagination retain explicit totals without copying unrelated full source documents', async () => {
  const f = setup(), first = f.data.contacts.contacts[0];
  f.data.contacts.contacts = Array.from({ length: 201 }, (_, index) => ({ ...structuredClone(first), id: 'synthetic-member-' + index }));
  for (const [path, key] of [[ROOT + 'organizations/' + ORGANIZATION + '/members', 'members'], [ROOT + 'candidates', 'candidates']]) {
    const firstPage = (await f.read(path + '?limit=200')).body, lastPage = (await f.read(path + '?cursor=200&limit=200')).body;
    assert.equal(firstPage[key].length, 200); assert.equal(firstPage.total, 201); assert.equal(firstPage.nextCursor, '200');
    assert.equal(lastPage[key].length, 1); assert.equal(lastPage.total, 201); assert.equal(lastPage.nextCursor, null);
    assert.notEqual(firstPage[key][0].contactId ?? firstPage[key][0].id, lastPage[key][0].contactId ?? lastPage[key][0].id);
  }
});

test('publication equality remains per-profile and known absent snapshots differ from unavailable metadata', async () => {
  const f = setup(), guest = f.data.content.content.guests[0];
  f.data.content.published.content.guests = [{ ...structuredClone(guest), portraitUrl: '/api/public/portraits/' + guest.portraitId }];
  assert.equal((await f.read()).body.profiles[0].publishedMatchesDraft, true);
  guest.title = '已更新职位'; assert.equal((await f.read()).body.profiles[0].publishedMatchesDraft, false);
  guest.status = 'pending'; assert.equal((await f.read()).body.profiles[0].published, true);
  f.data.content.published = null;
  const noSnapshot = (await f.read()).body; assert.equal(noSnapshot.publishedRevision, null); assert.equal(noSnapshot.profiles[0].published, false);
  delete f.data.content.published;
  assert.equal((await f.read()).response.status, 503);
});

test('unattributable publication is a warning, never an invented person match from names', async () => {
  const f = setup();
  f.data.content.content.guests[0].contactId = '';
  const { body } = await f.read(); assert.deepEqual(body.profiles, []); assert.equal(body.publicationAttributionUnavailable, true);
  assert.doesNotMatch(JSON.stringify(body), /合成甲|PRIVATE/u);
});

test('catalog malformed IDs, duplicate relationships and unavailable snapshots produce opaque failure rather than no relationships', async () => {
  for (const change of [value => { value.revision = -1; }, value => { value.published.revision = 6; }, value => { value.published.publishedAt = 'bad'; },
    value => { value.content.organizations.push(structuredClone(value.content.organizations[0])); }, value => { value.content.guests[0].contactId = '../person'; },
    value => { value.content.guests.push({ ...value.content.guests[0], id: 'another-guest' }); }, value => { value.published.content.guests.push(structuredClone(value.published.content.guests[0])); },
    value => { value.content.booths[0].organizationId = null; }, value => { value.content.organizations = undefined; }]) {
    const f = setup(); change(f.data.content);
    const { response, body } = await f.read(); assert.equal(response.status, 503); assert.equal(body.error.code, 'RELATIONSHIPS_UNAVAILABLE');
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE|合成|revision|organizations|profiles/u);
  }
  const f = setup(); f.data.content.content.booths[0].organizationId = 'historical-missing-organization';
  assert.equal((await f.read()).body.boothOrganizations[0].organizationId, 'historical-missing-organization', 'historical dangling stable ID remains explicit for verification');
});

test('malformed memberships and roster failures never masquerade as an empty organization', async () => {
  for (const value of [undefined, null, [{ organizationId: ORGANIZATION, role: 'owner', title: '' }],
    [{ organizationId: ORGANIZATION, role: 'lead', title: '', privateNote: 'PRIVATE' }],
    [{ organizationId: ORGANIZATION, role: 'lead', title: '' }, { organizationId: ORGANIZATION, role: 'member', title: '' }]]) {
    const f = setup(); f.data.contacts.contacts[0].operations.organizationMemberships = value;
    assert.equal((await f.read(ROOT + 'organizations/' + ORGANIZATION + '/members')).response.status, 503);
  }
  const f = setup();
  assert.equal((await f.read(ROOT + 'organizations/' + ORGANIZATION + '/members', { loadContacts: undefined })).response.status, 503);
  assert.equal((await f.read(undefined, { loadContent: async () => { throw new Error('PRIVATE-BACKEND-KEY'); } })).response.status, 503);
  assert.throws(() => personRelationshipsProjection(null));
});

test('401 or aborted source reads discard assembled relationship data and stop later loading', async () => {
  const f = setup();
  const expired = await f.read(undefined, { loadContent: async () => { throw Object.assign(new Error('PRIVATE-SESSION'), { status: 401 }); } });
  assert.equal(expired.response.status, 401); assert.doesNotMatch(JSON.stringify(expired.body), /PRIVATE|合成|organization/u);
  const controller = new AbortController(), api = f.api({ loadContent: async () => { controller.abort(); return f.data.content; } });
  const response = await api(f.request(ROOT + 'organizations/' + ORGANIZATION + '/members', { signal: controller.signal }));
  assert.equal(response.status, 503); assert.equal(f.calls.length, 0); assert.doesNotMatch(await response.text(), /PRIVATE|合成/u);
});


test('catalog publication equality agrees with actual no-photo no-role public guest projection',async()=>{
  const f=setup(),guest={...f.data.content.content.guests[0],portraitId:''};delete guest.publicRoles;
  const content=createInitialContent();content.guests=[guest];f.data.content.content=content;f.data.content.published={revision:4,publishedAt:'2026-10-21T00:00:00Z',content:toPublicContent(content)};
  const {response,body}=await f.read();assert.equal(response.status,200);assert.equal(body.profiles[0].hasPortrait,false);assert.deepEqual(body.profiles[0].publicRoles,[]);assert.equal(body.profiles[0].published,true);assert.equal(body.profiles[0].publishedMatchesDraft,true);
});


test('an unrelated unassignable publication warns globally without erasing an exact linked guest publication fact',async()=>{
  const f=setup(),guest=f.data.content.content.guests[0];
  f.data.content.published.content.guests=[{...structuredClone(guest),portraitUrl:'/api/public/portraits/'+guest.portraitId},{id:'unassignable-history',name:'same display name proves nothing'}];
  const {response,body}=await f.read();assert.equal(response.status,200);assert.equal(body.publicationAttributionUnavailable,true);assert.equal(body.profiles.length,1);assert.equal(body.profiles[0].id,guest.id);assert.equal(body.profiles[0].contactId,CONTACT);assert.equal(body.profiles[0].published,true);assert.equal(body.profiles[0].publishedMatchesDraft,true);
});
