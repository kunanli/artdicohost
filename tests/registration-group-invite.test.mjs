import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createGroupInviteService, GroupInviteError } from '../functions/registration-api/group-invite.mjs';
import { createGroupInviteApi } from '../functions/registration-api/group-invite-handler.mjs';
import { createRegistrationTokens } from '../functions/registration-api/tokens.mjs';
import { createOssObjectClient } from '../functions/cloud-content/oss-client.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { objectFixture, fakeCredentials } from './cloud-oss-fixture.mjs';
import { COLLABORATOR_ROLES } from '../shared/staff-permissions.mjs';

const API = 'https://api.example.invalid', SITE = 'https://example.invalid', EVENT = 'synthetic-qr-event';
const SECRET = 'PRIVATE-SYNTHETIC-INDEPENDENT-GROUP-KEY';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const WEBP = 'UklGRjYAAABXRUJQVlA4ICoAAACwAQCdASoCAAMAAUAmJZgCdLoABDAAAP7tBy/8Q50OdDmYz/uOwN13iAA=';
const actor = { id: 'synthetic-owner', roles: ['superadmin'] };
const at = Date.parse('2026-10-20T00:00:00Z');
const receipt = () => { const id = randomBytes(32).toString('base64url'); return { committed: true, eventId: EVENT, registrationId: id, referenceCode: id, committedAt: new Date(at).toISOString() }; };
const extractToken = invite => new URL(invite.qrImageUrl).pathname.split('/').at(-1);
function fixture() {
  const remote = objectFixture(), state = { now: at, lostAck: false, withdrawn: false, withdrawalFailure: false, appends: 0 };
  function service() {
    const base = createOssObjectClient({ credentials: async () => fakeCredentials, clock: () => new Date(state.now), fetchFn: remote.fetchFn });
    const objects = { ...base, async append(...args) { state.appends++; const value = await base.append(...args); if (state.lostAck) { state.lostAck = false; throw new Error('PRIVATE-SYNTHETIC-LOST-ACK'); } return value; } };
    return createGroupInviteService({ objects, journalFor: prefix => createObjectJournal({ objects, prefix }), eventId: EVENT, tokenSecret: SECRET, apiOrigin: API,
      clock: () => state.now, isWithdrawn: async () => { if (state.withdrawalFailure) throw new Error('PRIVATE-SYNTHETIC-REVIEW-FAILURE'); return state.withdrawn; } });
  }
  const upload = (expectedRevision = 0, patch = {}) => ({ expectedRevision, contentType: 'image/png', dataBase64: PNG, expiresAt: new Date(state.now + 3600000).toISOString(), ...patch });
  return { remote, state, service, upload };
}
async function expectError(promise, code) {
  await assert.rejects(promise, error => error instanceof GroupInviteError && error.code === code && !error.stack.includes('PRIVATE-') && !error.cause);
}
function pngChunk(type, body) {
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(type), body])) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ crc >>> 1 : crc >>> 1; }
  const result = Buffer.alloc(body.length + 12); result.writeUInt32BE(body.length); result.write(type, 4); body.copy(result, 8); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}

test('private group status exposes an exact server-owned seven-day input window without changing stored state', async () => {
  const f = fixture(), service = f.service(), empty = await service.adminRead(actor);
  assert.equal(empty.serverTime, new Date(at).toISOString());
  assert.equal(empty.maxExpiresAt, new Date(at + 7 * 86400000).toISOString());
  assert.equal(f.remote.calls.filter(call => call.method !== 'GET').length, 0);
  const saved = await service.replace(f.upload(0, { expiresAt: empty.maxExpiresAt }), actor);
  assert.equal(saved.expiresAt, empty.maxExpiresAt, 'the exact rolling limit remains accepted');
  assert.equal(saved.serverTime, empty.serverTime);assert.equal(saved.maxExpiresAt, empty.maxExpiresAt);
  const writes = f.remote.calls.filter(call => call.method !== 'GET').length;
  f.state.now += 65_000;
  const next = await f.service().adminRead(actor);
  assert.equal(next.serverTime, new Date(f.state.now).toISOString());
  assert.equal(Date.parse(next.maxExpiresAt) - Date.parse(next.serverTime), 7 * 86400000);
  assert.equal(next.revision, saved.revision);assert.equal(next.expiresAt, saved.expiresAt);
  assert.equal(f.remote.calls.filter(call => call.method !== 'GET').length, writes, 'refresh never extends or replaces the QR');
});

test('private actual image upload survives independent clients and only a committed receipt obtains a short link', async () => {
  const f = fixture(), service = f.service();
  assert.equal((await service.adminRead(actor)).configured, false);
  const changed = await service.replace(f.upload(), actor);
  assert.equal(changed.revision, 1); assert.equal(changed.configured, true); assert.equal(changed.expired, false);
  assert.equal(changed.imageUrl, API + '/api/admin/group-invite/image');
  await expectError(service.forReceipt({ receipt: { eventId: EVENT, committed: false } }), 'GROUP_INVITE_UNAVAILABLE');
  const invite = await f.service().forReceipt({ receipt: receipt(), origin: SITE });
  assert.equal(invite.platform, 'wechat'); assert.equal(Date.parse(invite.expiresAt), at + 600000);
  assert.equal(new URL(invite.qrImageUrl).pathname.startsWith('/api/admin/registration/group-invite/'), true);
  const image = await f.service().publicImage(extractToken(invite));
  assert.equal(image.contentType, 'image/png'); assert.deepEqual(image.data, Buffer.from(PNG, 'base64'));
  assert.equal(JSON.stringify(invite).includes('PRIVATE-'), false);
  assert.equal([...f.remote.stored.keys()].every(key => key.startsWith(`cms/v1/group-invites/${EVENT}/`)), true);
});

test('group replacement ACK binds the original selected file while stored image metadata remains stripped', async () => {
  const f = fixture(), service = f.service(), clean = Buffer.from(PNG, 'base64');
  const privateText = Buffer.from('synthetic-source\0PRIVATE-SYNTHETIC-QR-LOCATION');
  const tagged = Buffer.concat([clean.subarray(0, 33), pngChunk('tEXt', privateText), clean.subarray(33)]);
  const selectedDigest = createHash('sha256').update(tagged).digest('hex'), cleanDigest = createHash('sha256').update(clean).digest('hex');
  assert.notEqual(selectedDigest, cleanDigest);
  const saved = await service.replace(f.upload(0, { dataBase64: tagged.toString('base64') }), actor);
  assert.equal(saved.sourceSha256, selectedDigest, 'the actual write ACK proves the exact original file, not only its normalized pixels');
  assert.equal(saved.contentType, 'image/png');assert.equal(saved.bytes, clean.length);
  assert.deepEqual((await service.adminImage(actor)).data, clean);
  assert.equal(JSON.stringify(saved).includes('PRIVATE-'), false);
  assert.equal(Object.hasOwn(await f.service().adminRead(actor), 'sourceSha256'), false, 'a later GET cannot stand in for the original file ACK');
  const storedImage = [...f.remote.stored.entries()].find(([key]) => key.endsWith('/images/' + cleanDigest + '.png'));
  assert.ok(storedImage);assert.equal(storedImage[1].data.includes(privateText), false);
  for (const [key, object] of f.remote.stored) if (!key.includes('/images/')) assert.equal(object.data.includes(Buffer.from('sourceSha256')), false, 'source binding is not a new persistent field');
  const disabled = await service.disable({ expectedRevision: saved.revision, enabled: false }, actor);
  assert.equal(Object.hasOwn(disabled, 'sourceSha256'), false);
});

test('replacement and disable invalidate older links across clients even when reusing the same image', async () => {
  const f = fixture(), first = f.service();
  await first.replace(f.upload(), actor);
  const old = await first.forReceipt({ receipt: receipt() });
  await f.service().replace(f.upload(1), actor);
  await expectError(first.publicImage(extractToken(old)), 'GROUP_INVITE_NOT_FOUND');
  const fresh = await first.forReceipt({ receipt: receipt() });
  await f.service().disable({ expectedRevision: 2, enabled: false }, actor);
  await expectError(first.publicImage(extractToken(fresh)), 'GROUP_INVITE_NOT_FOUND');
  assert.equal(await first.forReceipt({ receipt: receipt() }), null);
  assert.equal((await first.adminRead(actor)).revision, 3);
});

test('supplied pending and rejected receipts cannot mint QR links even if an older adapter lacks an admission guard', async () => {
  const f = fixture(), service = f.service(); await service.replace(f.upload(), actor);
  for (const admissionStatus of ['pending_review', 'rejected', 'waitlisted', 'withdrawn']) {
    assert.equal(await service.forReceipt({ receipt: { ...receipt(), admissionStatus } }), null);
  }
  assert.equal((await service.forReceipt({ receipt: { ...receipt(), admissionStatus: 'confirmed' } })).platform, 'wechat');
  assert.equal((await service.forReceipt({ receipt: receipt() })).platform, 'wechat', 'legacy receipt still uses the trusted current-state callback');
});

test('expired links, expired QR and withdrawn registrations cannot read an image; review failure stays opaque', async () => {
  const f = fixture(), service = f.service();
  await service.replace(f.upload(), actor);
  const invite = await service.forReceipt({ receipt: receipt() }), token = extractToken(invite);
  f.state.withdrawn = true;
  await expectError(service.publicImage(token), 'GROUP_INVITE_NOT_FOUND');
  assert.equal(await service.forReceipt({ receipt: receipt() }), null);
  f.state.withdrawn = false; f.state.withdrawalFailure = true;
  await expectError(service.publicImage(token), 'GROUP_INVITE_UNAVAILABLE');
  f.state.withdrawalFailure = false; f.state.now += 600000;
  await expectError(service.publicImage(token), 'GROUP_INVITE_NOT_FOUND');
  f.state.now = at + 3600000;
  assert.equal((await service.adminRead(actor)).expired, true);
  assert.equal(await service.forReceipt({ receipt: receipt() }), null);
});

test('purpose separation rejects submission tokens and tampered/noncanonical signed image links', async () => {
  const f = fixture(), service = f.service(); await service.replace(f.upload(), actor);
  const token = extractToken(await service.forReceipt({ receipt: receipt() }));
  const registrationToken = createRegistrationTokens({ secret: SECRET, eventId: EVENT }).issue({ origin: SITE, idempotencyKey: randomBytes(32).toString('base64url'), now: at }).submissionToken;
  for (const value of [registrationToken, token + '=', token.slice(0, -1) + '!', 'payload.signature', token.replace(/^./u, 'X')]) await expectError(service.publicImage(value), 'GROUP_INVITE_NOT_FOUND');
});

test('explicit expiry, static MIME and actual image structure are required before any write', async () => {
  const f = fixture(), service = f.service();
  for (const patch of [{ expiresAt: '2026-10-26' }, { expiresAt: new Date(at).toISOString() }, { expiresAt: new Date(at + 7 * 86400000 + 1).toISOString() },
    { dataBase64: PNG + '\n' }, { contentType: 'image/svg+xml', dataBase64: Buffer.from('<svg/>').toString('base64') }, { contentType: 'image/jpeg' }, { dataBase64: Buffer.from('PRIVATE-NOT-AN-IMAGE').toString('base64') }]) {
    await expectError(service.replace(f.upload(0, patch), actor), 'INVALID_GROUP_INVITE');
  }
  assert.equal(f.remote.calls.filter(call => call.method !== 'GET').length, 0);
  await service.replace(f.upload(0, { contentType: 'image/webp', dataBase64: WEBP }), actor);
  assert.equal((await service.adminImage(actor)).contentType, 'image/webp');
});

test('two concurrent replacements have one winner, and an unknown ACK never automatically retries', async () => {
  const f = fixture(), first = f.service(), second = f.service();
  const results = await Promise.allSettled([first.replace(f.upload(), actor), second.replace(f.upload(), actor)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'GROUP_INVITE_CONFLICT');
  const g = fixture(); g.state.lostAck = true;
  await expectError(g.service().replace(g.upload(), actor), 'GROUP_INVITE_UNAVAILABLE');
  assert.equal(g.state.appends, 1);
  assert.equal((await g.service().adminRead(actor)).revision, 1);
  assert.equal(g.state.appends, 1);
});

test('hash or structural corruption never returns an image or silently replaces state', async () => {
  const f = fixture(), service = f.service(); await service.replace(f.upload(), actor);
  const invite = await service.forReceipt({ receipt: receipt() });
  const key = [...f.remote.stored.keys()].find(value => value.includes('/images/'));
  f.remote.stored.get(key).data = Buffer.from('PRIVATE-SYNTHETIC-CORRUPTION');
  await expectError(service.publicImage(extractToken(invite)), 'GROUP_INVITE_UNAVAILABLE');
  await expectError(service.adminImage(actor), 'GROUP_INVITE_UNAVAILABLE');
});

test('HTTP admin requires full event operations, exact Origin and CSRF before upload; public image requires signed link only', async () => {
  const f = fixture(), service = f.service(), csrfToken = randomBytes(32).toString('base64url');
  let user = actor, loggedIn = false;
  const auth = { async authenticate() { if (!loggedIn) throw new CloudContentError('AUTH_REQUIRED', 'PRIVATE-AUTH', 401); return { user, csrfToken }; } };
  const handle = createGroupInviteApi({ service, auth, apiOrigin: API, publicOrigins: [SITE] });
  const post = headers => new Request(API + '/api/admin/group-invite', { method: 'POST', headers: { origin: API, 'content-type': 'application/json', ...headers }, body: JSON.stringify(f.upload()) });
  assert.equal((await handle(post())).status, 401);
  loggedIn = true; user = { ...actor, roles: ['editor', 'outreach'] };
  assert.equal((await handle(post({ 'x-csrf-token': csrfToken }))).status, 403);
  user = actor;
  assert.equal((await handle(post())).status, 403);
  assert.equal((await handle(post({ origin: SITE, 'x-csrf-token': csrfToken }))).status, 403);
  assert.equal(f.remote.calls.filter(call => call.method !== 'GET').length, 0);
  const saved = await handle(post({ 'x-csrf-token': csrfToken })); assert.equal(saved.status, 200);
  const invite = await service.forReceipt({ receipt: receipt() }); loggedIn = false;
  const publicImage = await handle(new Request(invite.qrImageUrl)); assert.equal(publicImage.status, 200);
  assert.deepEqual(Buffer.from(await publicImage.arrayBuffer()), Buffer.from(PNG, 'base64'));
  assert.equal(publicImage.headers.get('cache-control'), 'private, no-store');
  const foreign = await handle(new Request(invite.qrImageUrl, { headers: { origin: 'https://foreign.invalid' } })); assert.equal(foreign.status, 403);
  assert.equal((await handle(new Request(API + '/api/registration/group-invite/current'))).status, 404);
  assert.equal((await handle(new Request(API + '/api/admin/group-invite/image'))).status, 401);
});

test('complete collaborators can manage the private QR while incomplete role sets fail in the service before any private I/O', async () => {
  const f = fixture(), service = f.service(), collaborator = { id: 'synthetic-collaborator', roles: [...COLLABORATOR_ROLES] };
  const before = f.remote.calls.length;
  for (let mask = 0; mask < 15; mask++) {
    const user = { id: 'synthetic-partial', roles: COLLABORATOR_ROLES.filter((_, index) => mask & 1 << index) };
    await expectError(service.adminRead(user), 'FORBIDDEN'); await expectError(service.adminImage(user), 'FORBIDDEN');
    await expectError(service.replace(f.upload(), user), 'FORBIDDEN'); await expectError(service.disable({ expectedRevision: 0, enabled: false }, user), 'FORBIDDEN');
  }
  assert.equal(f.remote.calls.length, before);
  const handle = createGroupInviteApi({ service, apiOrigin: API, publicOrigins: [SITE], auth: { authenticate: async () => ({ user: collaborator, csrfToken: 'synthetic-csrf' }) } });
  const request = (method, input) => new Request(API + '/api/admin/group-invite', { method,
    headers: { origin: API, 'content-type': 'application/json', 'x-csrf-token': 'synthetic-csrf' },
    ...(input ? { body: JSON.stringify(input) } : {}) });
  assert.equal((await handle(request('GET'))).status, 200);
  assert.equal((await handle(request('POST', f.upload()))).status, 200);
  assert.equal((await service.adminRead(collaborator)).configured, true); assert.equal((await service.adminImage(collaborator)).contentType, 'image/png');
  assert.equal((await handle(request('PUT', { expectedRevision: 1, enabled: false }))).status, 200);
});
