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

test('private actual image upload survives independent clients and only a committed receipt obtains a short link', async () => {
  const f = fixture(), service = f.service();
  assert.equal((await service.adminRead()).configured, false);
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
  assert.equal((await first.adminRead()).revision, 3);
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
  assert.equal((await service.adminRead()).expired, true);
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
  assert.equal((await service.adminImage()).contentType, 'image/webp');
});

test('two concurrent replacements have one winner, and an unknown ACK never automatically retries', async () => {
  const f = fixture(), first = f.service(), second = f.service();
  const results = await Promise.allSettled([first.replace(f.upload(), actor), second.replace(f.upload(), actor)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(results.find(value => value.status === 'rejected').reason.code, 'GROUP_INVITE_CONFLICT');
  const g = fixture(); g.state.lostAck = true;
  await expectError(g.service().replace(g.upload(), actor), 'GROUP_INVITE_UNAVAILABLE');
  assert.equal(g.state.appends, 1);
  assert.equal((await g.service().adminRead()).revision, 1);
  assert.equal(g.state.appends, 1);
});

test('hash or structural corruption never returns an image or silently replaces state', async () => {
  const f = fixture(), service = f.service(); await service.replace(f.upload(), actor);
  const invite = await service.forReceipt({ receipt: receipt() });
  const key = [...f.remote.stored.keys()].find(value => value.includes('/images/'));
  f.remote.stored.get(key).data = Buffer.from('PRIVATE-SYNTHETIC-CORRUPTION');
  await expectError(service.publicImage(extractToken(invite)), 'GROUP_INVITE_UNAVAILABLE');
  await expectError(service.adminImage(), 'GROUP_INVITE_UNAVAILABLE');
});

test('HTTP admin requires superadmin, exact Origin and CSRF before upload; public image requires signed link only', async () => {
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
