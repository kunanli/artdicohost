import test from 'node:test';
import assert from 'node:assert/strict';
import { createEntryTicketService, EntryTicketError } from '../functions/entry-ticket/service.mjs';
import { createEntryTicketApi } from '../functions/entry-ticket/handler.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';

const API = 'https://api.artdico.host', SITE = 'https://artdico.host';
const actor = { id: 'synthetic-door-staff', roles: ['reviewer'] }, op = 'o'.repeat(43), id = 'i'.repeat(43);
const at = Date.parse('2026-11-03T00:00:00.000Z'), secret = 'synthetic-entry-token-secret-only-12345678';
const event = { id: 'synthetic-entry-event', date: { value: '2026-12-05' } };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=', 'base64');
function fixture() {
  const remote = objectFixture(), state = { now: at, status: 'confirmed', accessRevision: 0, lostAck: false, group: true, groupVersion: 1, fail: false };
  const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
  const objects = { ...base, async append(...args) { const saved = await base.append(...args); if (state.lostAck) { state.lostAck = false; throw new Error('PRIVATE_SYNTHETIC_ACK'); } return saved; } };
  const current = async registrationId => {
    if (state.fail) throw new Error('PRIVATE_SYNTHETIC_SOURCE');
    if (registrationId !== id) throw new Error('PRIVATE_SYNTHETIC_ID');
    return { registrationId, referenceCode: registrationId, admissionStatus: state.status, accessRevision: state.accessRevision,
      name: 'Synthetic Attendee', organization: 'Synthetic Studio', event: { id: event.id }, submittedAt: new Date(at).toISOString() };
  };
  function service() {
    return createEntryTicketService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), tokenSecret: secret, event, clock: () => state.now,
      authorizedRegistration: current,
      groupInviteProvider: async () => state.group ? { platform: 'wechat', qrImageUrl: API + '/api/admin/registration/group-invite/synthetic-' + state.groupVersion,
        expiresAt: new Date(state.now + 600_000).toISOString(), groupExpiresAt: new Date(at + 86400_000).toISOString() } : null,
      groupImageProvider: async token => ({ data: Buffer.concat([PNG, Buffer.from(token)]), contentType: 'image/png' }) });
  }
  const writes = () => remote.calls.filter(call => call.method !== 'GET').length;
  return { remote, state, service, writes };
}
const receiptCode = issued => new URL(issued.confirmationUrl).hash.slice(1);
const entryCode = issued => new URL(issued.admissionUrl).hash.slice('#ticket='.length);
const failure = (promise, code) => assert.rejects(promise, error => error instanceof EntryTicketError && error.code === code && !String(error).includes('PRIVATE_'));

test('short codes are independent purposes, durable across clients and do not expose attendee IDs', async () => {
  const f = fixture(), first = await f.service().issue({ registrationId: id }), again = await f.service().issue({ registrationId: id });
  assert.equal(first.confirmationUrl, again.confirmationUrl);
  assert.match(receiptCode(first), /^[A-Za-z0-9_-]{22}$/u); assert.match(entryCode(first), /^[A-Za-z0-9_-]{22}$/u);
  assert.notEqual(receiptCode(first), entryCode(first)); assert.equal(JSON.stringify(first).includes(id), false);
  assert.equal(first.groupExpiresAt, new Date(at + 86400_000).toISOString());
  const before = f.writes(), result = await f.service().resolve({ code: receiptCode(first) });
  assert.match(result.confirmationUrl, /^https:\/\/artdico\.host\/registration\/confirmation\/#r=c1\./u);
  assert.deepEqual(Object.keys(result), ['confirmationUrl']); assert.equal(f.writes(), before);
  await failure(f.service().resolve({ code: entryCode(first) }), 'ENTRY_NOT_FOUND');
  await failure(f.service().inspect({ code: receiptCode(first), actor }), 'ENTRY_NOT_FOUND');
});

test('issue is explicit, missing or unconfirmed groups do not invent an email QR', async () => {
  const f = fixture(); f.state.group = false;
  const issued = await f.service().issue({ registrationId: id }); assert.equal(Object.hasOwn(issued, 'groupQrImageUrl'), false);
  f.state.status = 'waitlisted'; const waitlisted = await f.service().issue({ registrationId: id });
  assert.equal(Object.hasOwn(waitlisted, 'admissionUrl'), false);
  await failure(f.service().entryImage({ code: receiptCode(issued) }), 'ENTRY_NOT_FOUND');
  await failure(f.service().checkIn({ code: entryCode(issued), actor, operationId: op, expectedRevision: 0 }), 'ENTRY_NOT_FOUND');
});

test('current group bytes change behind stable attendee-bound URL and old images are not cached by service', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), code = receiptCode(issued), before = f.writes();
  const first = await f.service().groupImage({ code }); f.state.groupVersion = 2;
  const second = await f.service().groupImage({ code }); assert.notDeepEqual(first.data, second.data);
  f.state.group = false; await failure(f.service().groupImage({ code }), 'ENTRY_NOT_FOUND'); assert.equal(f.writes(), before);
});

test('entry QR is a locally generated PNG containing only dedicated staff entry capability', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), before = f.writes();
  const image = await f.service().entryImage({ code: receiptCode(issued) });
  assert.equal(image.contentType, 'image/png'); assert.deepEqual(image.data.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.ok(image.data.length < 1024 * 1024); assert.equal(f.writes(), before);
});

test('current withdrawal and access correction revoke both email images, resolution and staff entry', async () => {
  for (const change of ['withdrawn', 'revision']) {
    const f = fixture(), issued = await f.service().issue({ registrationId: id });
    if (change === 'withdrawn') f.state.status = 'withdrawn'; else f.state.accessRevision++;
    const before = f.writes();
    for (const name of ['resolve', 'entryImage', 'groupImage']) await failure(f.service()[name]({ code: receiptCode(issued) }), 'ENTRY_NOT_FOUND');
    await failure(f.service().inspect({ code: entryCode(issued), actor }), 'ENTRY_NOT_FOUND'); assert.equal(f.writes(), before);
  }
});

test('read-only scan precedes explicit durable check-in, re-scan/repeated operations never write twice', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), code = entryCode(issued), before = f.writes();
  const initial = await f.service().inspect({ code, actor }); assert.equal(initial.checkedInAt, null); assert.equal(initial.canCheckIn, true); assert.equal(f.writes(), before);
  const saved = await f.service().checkIn({ code, actor, operationId: op, expectedRevision: 0 });
  assert.equal(saved.outcome, 'checked_in'); assert.equal(saved.revision, 1); assert.equal(saved.checkedInAt, new Date(at).toISOString());
  const committedWrites = f.writes(), replay = await f.service().checkIn({ code, actor, operationId: op, expectedRevision: 0 });
  assert.equal(replay.outcome, 'checked_in');
  const duplicate = await f.service().checkIn({ code, actor, operationId: 'p'.repeat(43), expectedRevision: 0 }); assert.equal(duplicate.outcome, 'already_checked_in');
  assert.equal((await f.service().inspect({ code, actor })).canCheckIn, false); assert.equal(f.writes(), committedWrites);
  const receipt = await f.service().operation({ code, actor, operationId: op }); assert.equal(receipt.found, true); assert.equal(receipt.result.outcome, 'checked_in');
  assert.equal((await f.service().operation({ code, actor: { ...actor, id: 'synthetic-other' }, operationId: op })).found, false);
});

test('lost write acknowledgment is resolved by reading exact operation; source failures never imply admission', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), code = entryCode(issued);
  f.state.lostAck = true;
  await failure(f.service().checkIn({ code, actor, operationId: op, expectedRevision: 0 }), 'ENTRY_UNAVAILABLE');
  const before = f.writes(), found = await f.service().operation({ code, actor, operationId: op });
  assert.equal(found.found, true); assert.equal(f.writes(), before);
  f.state.fail = true; await failure(f.service().inspect({ code, actor }), 'ENTRY_UNAVAILABLE');
});

test('simultaneous door staff cannot commit two check-ins', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), code = entryCode(issued);
  const results = await Promise.allSettled([f.service().checkIn({ code, actor, operationId: op, expectedRevision: 0 }),
    f.service().checkIn({ code, actor: { ...actor, id: 'synthetic-other' }, operationId: 'p'.repeat(43), expectedRevision: 0 })]);
  assert.equal(results.filter(value => value.status === 'fulfilled' && value.value.outcome === 'checked_in').length, 1);
  assert.equal((await f.service().inspect({ code, actor })).revision, 1);
});

test('permissions precede all source/storage I/O and entry validity expires at event end of day', async () => {
  const f = fixture(), issued = await f.service().issue({ registrationId: id }), before = f.remote.calls.length;
  await failure(f.service().inspect({ code: entryCode(issued), actor: { id: 'synthetic-reader', roles: ['outreach'] } }), 'FORBIDDEN');
  assert.equal(f.remote.calls.length, before);
  f.state.now = Date.parse('2026-12-06T00:00:00+08:00');
  await failure(f.service().inspect({ code: entryCode(issued), actor }), 'ENTRY_NOT_FOUND');
  assert.ok((await f.service().resolve({ code: receiptCode(issued) })).confirmationUrl);
});

test('API enforces private no-store, fixed origin, login, CSRF, bounded exact bodies and separate capabilities', async () => {
  const f = fixture(), service = f.service(), issued = await service.issue({ registrationId: id });
  let loggedIn = false, requests = 0;
  const handle = createEntryTicketApi({ service, authenticate: async () => { requests++; return loggedIn ? { user: actor, csrfToken: 'synthetic-csrf' } : null; } });
  const staff = API + '/api/admin/checkin/' + entryCode(issued), publicLink = API + '/api/admin/registration/entry-links/' + receiptCode(issued);
  let response = await handle(new Request(publicLink, { headers: { origin: SITE } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store'); assert.equal(response.headers.get('access-control-allow-origin'), SITE); assert.equal(requests, 0);
  assert.equal((await handle(new Request(staff))).status, 401); loggedIn = true;
  assert.equal((await handle(new Request(staff))).status, 200);
  assert.equal((await handle(new Request(publicLink, { headers: { origin: 'https://external.invalid' } }))).status, 403);
  const payload = JSON.stringify({ operationId: op, expectedRevision: 0 });
  assert.equal((await handle(new Request(staff, { method: 'POST', headers: { origin: API, 'content-type': 'application/json' }, body: payload }))).status, 403);
  response = await handle(new Request(staff, { method: 'POST', headers: { origin: API, 'content-type': 'application/json', 'x-csrf-token': 'synthetic-csrf' }, body: payload }));
  assert.equal(response.status, 200); assert.equal((await response.json()).outcome, 'checked_in');
  assert.equal((await handle(new Request(staff + '/operation/' + op))).status, 200);
  assert.equal((await handle(new Request(staff + '?unexpected=1'))).status, 404);
  assert.equal((await handle(new Request(staff, { method: 'POST', headers: { origin: API, 'content-type': 'application/json', 'x-csrf-token': 'synthetic-csrf' }, body: '{}'.repeat(3000) }))).status, 400);
});


test('actual composed runtime routes short links and staff check-in; deletion invalidates all attendee capabilities', async () => {
  const { peopleRuntimeFixture } = await import('./helpers/people-runtime-fixture.mjs');
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false }), saved = await f.seedPublic({ intake: 'general-v2' });
  const issued = await f.app.entryService.issue({ registrationId: saved.reference_code }), code = entryCode(issued);
  const short = await f.app.handle(f.request('/api/admin/registration/entry-links/' + receiptCode(issued), { origin: SITE }));
  assert.equal(short.status, 200); assert.match((await short.json()).confirmationUrl, /#r=c1\./u);
  assert.equal((await f.app.handle(f.request('/api/admin/checkin/' + code))).status, 401);
  const staff = await f.login('reviewer');
  assert.equal((await f.app.handle(f.request('/api/admin/checkin/' + code, { headers: staff }))).status, 200);
  const response = await f.app.handle(f.request('/api/admin/checkin/' + code, { method: 'POST', headers: staff, body: { operationId: op, expectedRevision: 0 } }));
  assert.equal(response.status, 200); assert.equal((await response.json()).outcome, 'checked_in');
  const owner = await f.login();
  const status = await f.app.reviewStore.list();
  const deleted = await f.app.handle(f.request('/api/admin/registrations/' + saved.reference_code + '/deletion-request', { method: 'POST', headers: owner, body: { expectedRevision: status.revision, reason: 'request' } }));
  assert.equal(deleted.status, 200);
  assert.equal((await f.app.handle(f.request('/api/admin/registration/entry-links/' + receiptCode(issued)))).status, 404);
  assert.equal((await f.app.handle(f.request('/api/admin/checkin/' + code, { headers: staff }))).status, 404);
  assert.equal(f.messages.length, 0);
});


test('concurrent short-link issuance and lost map acknowledgment resolve exact immutable mappings without appending twice', async () => {
  const f = fixture(); f.state.lostAck = true;
  const results = await Promise.all([f.service().issue({ registrationId: id }), f.service().issue({ registrationId: id })]);
  assert.equal(results[0].confirmationUrl, results[1].confirmationUrl);
  const maps = [...f.remote.stored].filter(([key]) => key.endsWith('/mapping.jsonl'));
  assert.equal(maps.length, 2);
  for (const [, value] of maps) { assert.equal(value.objectType, 'Appendable'); assert.equal(value.data.toString().split('\n').length, 2); }
  const before = f.writes(); await f.service().resolve({ code: receiptCode(results[0]) }); assert.equal(f.writes(), before);
});

test('a corrupt or appended mapping cannot resolve, serve a QR, or silently replace stored bytes', async () => {
  for (const alteration of ['tamper', 'append']) {
    const f = fixture(), issued = await f.service().issue({ registrationId: id }), code = receiptCode(issued);
    const [key, stored] = [...f.remote.stored].find(([path]) => path.includes('/links/l-' + code + '/'));
    const original = Buffer.from(stored.data);
    stored.data = alteration === 'append' ? Buffer.concat([original, original]) : Buffer.from(original.toString().replace('"accessRevision":0', '"accessRevision":1'));
    const corrupt = Buffer.from(stored.data), before = f.writes();
    await assert.rejects(f.service().resolve({ code }), error => error instanceof EntryTicketError);
    await assert.rejects(f.service().entryImage({ code }), error => error instanceof EntryTicketError);
    await assert.rejects(f.service().issue({ registrationId: id }), error => error instanceof EntryTicketError);
    assert.deepEqual(f.remote.stored.get(key).data, corrupt); assert.equal(f.writes(), before);
  }
});

test('merging an already checked alias into an unchecked primary preserves one physical entry', async () => {
  const { peopleRuntimeFixture } = await import('./helpers/people-runtime-fixture.mjs');
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false }), a = await f.seedPublic({ intake: 'general-v2', name: 'Synthetic A' }),
    b = await f.seedPublic({ intake: 'general-v2', name: 'Synthetic B' });
  const first = await f.app.entryService.issue({ registrationId: a.reference_code }), alias = await f.app.entryService.issue({ registrationId: b.reference_code });
  await f.app.entryService.checkIn({ code: entryCode(alias), actor: f.users[0], operationId: op, expectedRevision: 0 });
  const headers = await f.login(), keys = ['registration:' + a.reference_code, 'registration:' + b.reference_code];
  const preview = await f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers, body: { action: 'preview', keys } }));
  assert.equal(preview.status, 200); const proposal = await preview.json();
  const merged = await f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers, body: {
    action: 'merge', keys: proposal.keys, primaryKey: 'registration:' + a.reference_code, roles: proposal.roles,
    expectedRevision: proposal.expectedRevision, expectedContactRevision: proposal.expectedContactRevision, operationId: 'm'.repeat(43), confirmSamePerson: true } }));
  assert.equal(merged.status, 200); const result = await merged.json(); assert.equal(result.person.primaryRegistrationId, a.reference_code);
  await failure(f.app.entryService.inspect({ code: entryCode(alias), actor: f.users[0] }), 'ENTRY_NOT_FOUND');
  const inspect = await f.app.entryService.inspect({ code: entryCode(first), actor: f.users[0] });
  assert.ok(inspect.checkedInAt); assert.equal(inspect.canCheckIn, false);
  const before = f.objects.calls.length, repeated = await f.app.entryService.checkIn({ code: entryCode(first), actor: f.users[0], operationId: 'n'.repeat(43), expectedRevision: 1 });
  assert.equal(repeated.outcome, 'already_checked_in');
  assert.equal(f.objects.calls.slice(before).some(call => call.operation !== 'get'), false);
  assert.equal(f.messages.length, 0);
});

test('a merge between final preflight and append cannot report a second successful physical entry', async () => {
  const remote = objectFixture(), base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(at), fetchFn: remote.fetchFn });
  const a = 'a'.repeat(43), b = 'b'.repeat(43); let merged = false, racing = false, service, bCode;
  const objects = { ...base, async append(...args) {
    if (racing && args[0].includes('/checkins/r-' + a + '/commits.jsonl')) {
      racing = false;
      const admitted = await service.checkIn({ code: bCode, actor, operationId: 'b'.repeat(43), expectedRevision: 0 });
      assert.equal(admitted.outcome, 'checked_in'); merged = true;
    }
    return base.append(...args);
  } };
  service = createEntryTicketService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), tokenSecret: secret, event, clock: () => at,
    authorizedRegistration: async registrationId => {
      if (registrationId === b && merged) throw new EntryTicketError('ENTRY_NOT_FOUND');
      return { registrationId, admissionStatus: 'confirmed', accessRevision: 0, name: 'Synthetic Door Race', organization: '', event: { id: event.id },
        relatedRegistrationIds: merged ? [a, b] : [registrationId] };
    } });
  const aCode = entryCode(await service.issueEntry({ registrationId: a })); bCode = entryCode(await service.issueEntry({ registrationId: b }));
  racing = true;
  await failure(service.checkIn({ code: aCode, actor, operationId: op, expectedRevision: 0 }), 'ENTRY_CONFLICT');
  const original = await service.operation({ code: aCode, actor, operationId: op });
  assert.equal(original.found, true); assert.equal(original.result.outcome, 'already_checked_in', 'reading the durable racing operation cannot turn it into a second success');
  assert.equal((await service.inspect({ code: aCode, actor })).canCheckIn, false);
});
