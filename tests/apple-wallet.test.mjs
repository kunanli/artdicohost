import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { validateSigningIdentity, buildAppleWalletPass } from '../functions/apple-wallet/pkpass.mjs';
import { createAppleWalletService, WALLET_CONFIG_FIELDS } from '../functions/apple-wallet/service.mjs';
import { createAppleWalletApi } from '../functions/apple-wallet/handler.mjs';
import { derChildren } from '../functions/apple-wallet/der.mjs';
import { createWalletFixture, passFiles } from './apple-wallet-fixture.mjs';

const fixture = await createWalletFixture(); after(() => fixture.cleanup());
const id = 'a'.repeat(43), token = 'synthetic.receipt.' + 'b'.repeat(43), secret = 'SYNTHETIC_INDEPENDENT_REGISTRATION_SECRET_1234567890';
const eventDate = new Date(fixture.now + 7 * 86400000).toISOString().slice(0, 10);
const record = { registrationId: id, referenceCode: id, admissionStatus: 'confirmed', admissionKind: 'attendee', admissionRevision: 1,
  name: '合成参加人', organization: '合成机构', event: { id: 'synthetic-event', title: '合成测试活动', date: eventDate, time: '10:00–18:00', venue: '合成测试地点', timezone: 'Asia/Shanghai', checkIn: '09:30' } };
function service(overrides = {}) { return createAppleWalletService({ env: fixture.env, authorize: async ({ receiptToken }) => { assert.equal(receiptToken, token); return structuredClone(record); },
  authorizedRegistration: async registrationId => { assert.equal(registrationId, id); return structuredClone(record); }, tokenSecret: secret, clock: () => fixture.now, trustedRootFingerprints: [fixture.rootHash], ...overrides }); }

test('no Apple credentials is an explicit setup state without exposing secrets, reading files or issuing unsigned passes', async () => {
  let calls = 0; const missing = service({ env: { APPLE_WALLET_KEY_PATH: '/private/never-read', APPLE_WALLET_CERT_PATH: '/private/never-read' }, authorize: async () => { calls++; return record; } });
  const readiness = await missing.readiness();
  assert.equal(readiness.ready, false); assert.equal(readiness.reason, 'WALLET_NOT_CONFIGURED'); assert.deepEqual(readiness.missing, [...WALLET_CONFIG_FIELDS]);
  assert.equal((await missing.download({ receiptToken: token })).outcome, 'not_ready'); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(readiness), /private\/|CERTIFICATE-----|PRIVATE|SYNTH12345|pass\.org/u);
});

test('production identity refuses synthetic roots even when env asks to trust them and verifies certificate/key/id/chain/time', async () => {
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, trustedRootFingerprints: undefined }), { code: 'WALLET_CERTIFICATE_CHAIN_INVALID' });
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, passTypeIdentifier: 'pass.org.other.event' }), { code: 'WALLET_CERTIFICATE_ID_MISMATCH' });
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, teamId: 'OTHER12345' }), { code: 'WALLET_CERTIFICATE_ID_MISMATCH' });
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, now: fixture.now + 130 * 86400000 }), { code: 'WALLET_CERTIFICATE_EXPIRED' });
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, key: Buffer.from(other) }), { code: 'WALLET_PRIVATE_KEY_INVALID' });
  const production = service({ trustedRootFingerprints: undefined, env: { ...fixture.env, APPLE_WALLET_TRUST_ROOT: fixture.rootHash } });
  assert.equal((await production.readiness()).ready, false); assert.equal((await production.download({ receiptToken: token })).outcome, 'not_ready');
});

test('real pkpass contains bounded ZIP, exact manifest hashes and a detached CMS signature independently verified by OpenSSL', async () => {
  const wallet = service(), readiness = await wallet.readiness(); assert.equal(readiness.ready, true); assert.equal(readiness.deviceTestRequired, true);
  const result = await wallet.download({ receiptToken: token }); assert.equal(result.outcome, 'issued'); assert.equal(result.contentType, 'application/vnd.apple.pkpass');
  const files = passFiles(result.data); assert.deepEqual([...files.keys()].sort(), ['icon.png','icon@2x.png','manifest.json','pass.json','signature'].sort());
  const pass = JSON.parse(files.get('pass.json')), manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(pass.passTypeIdentifier, fixture.fields.passTypeIdentifier); assert.equal(pass.teamIdentifier, fixture.fields.teamId);
  assert.equal(pass.eventTicket.secondaryFields[0].value, record.name); assert.equal(pass.eventTicket.headerFields[0].value, '已确认');
  assert.equal(pass.sharingProhibited, true); assert.equal(pass.webServiceURL, undefined); assert.equal(pass.authenticationToken, undefined);
  assert.doesNotMatch(JSON.stringify(pass), /email|wechat|permissionReference|internalNotes|synthetic\.receipt/u);
  for (const [name, expected] of Object.entries(manifest)) assert.equal(createHash('sha1').update(files.get(name)).digest('hex'), expected);
  assert.deepEqual(Object.keys(manifest).sort(), ['icon.png', 'icon@2x.png', 'pass.json'].sort());
  await writeFile(resolve(fixture.directory, 'manifest.json'), files.get('manifest.json')); await writeFile(resolve(fixture.directory, 'signature'), files.get('signature'));
  assert.doesNotThrow(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'verified-manifest.json']));
  await writeFile(resolve(fixture.directory, 'manifest.json'), Buffer.from('tampered'));
  assert.throws(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'tampered-output.json']));
  assert.equal(files.get('icon.png').readUInt32BE(16), 29); assert.equal(files.get('icon@2x.png').readUInt32BE(16), 58);
});

test('Wallet refuses waitlist, withdrawn and lost-authority outcomes, including cancellation while signing', async () => {
  for (const admissionStatus of ['waitlisted', 'withdrawn']) {
    const wallet = service({ authorize: async () => ({ ...record, admissionStatus }) }); assert.equal((await wallet.download({ receiptToken: token })).outcome, 'inactive');
  }
  assert.equal((await service({ authorizedRegistration: async () => ({ ...record, admissionStatus: 'withdrawn' }) }).download({ receiptToken: token })).outcome, 'inactive');
  const error = new Error('PRIVATE_PROVIDER_DIAGNOSTIC');
  const result = await service({ authorizedRegistration: async () => { throw error; } }).download({ receiptToken: token }); assert.deepEqual(result, { outcome: 'unavailable' });
  assert.equal((await service().download({ receiptToken: '../invalid' })).outcome, 'invalid');
});

test('barcode is a separate bounded purpose, rechecks current admission and reveals no personal or reusable receipt details', async () => {
  let status = 'confirmed', now = fixture.now;
  const wallet = service({ clock: () => now, authorizedRegistration: async () => ({ ...record, admissionStatus: status }) });
  const result = await wallet.download({ receiptToken: token }), pass = JSON.parse(passFiles(result.data).get('pass.json'));
  const url = new URL(pass.barcodes[0].message), validityToken = url.pathname.split('/').at(-1);
  assert.equal(url.origin, 'https://api.artdico.host'); assert.ok(url.pathname.startsWith('/api/admin/registration/wallet/verify/'));
  const good = await wallet.verify({ token: validityToken }); assert.equal(good.valid, true); assert.equal(good.eventId, record.event.id);
  assert.doesNotMatch(JSON.stringify(good), /合成|a{43}|reference|name|organization/u);
  assert.deepEqual(await wallet.verify({ token }), { valid: false }); assert.deepEqual(await wallet.verify({ token: validityToken + 'x' }), { valid: false });
  status = 'withdrawn'; assert.deepEqual(await wallet.verify({ token: validityToken }), { valid: false }); status = 'confirmed';
  now += 20 * 86400000; assert.deepEqual(await wallet.verify({ token: validityToken }), { valid: false });
});

test('encrypted bundle loader is refreshed, enabled stays trusted outside the bundle, and load failure never uses stale credentials', async () => {
  let calls = 0, available = true;
  const wallet = service({ env: { APPLE_WALLET_ENABLED: 'true', APPLE_WALLET_BUNDLE_ID: 'd'.repeat(64) }, loadSigningBundle: async ({ bundleId }) => { assert.equal(bundleId, 'd'.repeat(64)); calls++; if (!available) throw new Error('PRIVATE_BUNDLE_ERROR'); return fixture.env; } });
  assert.equal((await wallet.readiness()).ready, true); assert.equal((await wallet.download({ receiptToken: token })).outcome, 'issued'); assert.equal(calls, 2);
  available = false; assert.equal((await wallet.readiness()).reason, 'WALLET_BUNDLE_UNAVAILABLE'); assert.deepEqual(await wallet.download({ receiptToken: token }), { outcome: 'not_ready' });
  const disabled = service({ env: { APPLE_WALLET_BUNDLE_ID: 'd'.repeat(64) }, loadSigningBundle: async () => fixture.env }); assert.equal((await disabled.readiness()).ready, false); assert.equal((await disabled.download({ receiptToken: token })).outcome, 'not_ready');
});

test('strict DER parser rejects indefinite, oversized and trailing encodings rather than accepting a different issuer', () => {
  for (const bytes of [[0x30,0x80,0,0], [0x30,0x81,1,0], [0x30,0,0], [0x30,3,2,2,1]]) assert.throws(() => derChildren(Buffer.from(bytes)));
});

test('ECDSA pass keys produce CMS that independently verifies, and an ordinary client certificate cannot pose as a pass signer', async () => {
  fixture.run(['req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ec.key', '-out', 'ec.csr', '-subj', '/C=ZZ/O=Synthetic Wallet Fixture/OU=SYNTH12345/UID=pass.org.artdico.fixture/CN=Synthetic EC Pass']);
  fixture.run(['x509', '-req', '-in', 'ec.csr', '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial', '-out', 'ec.pem', '-days', '100', '-extfile', 'leaf.ext']);
  const { readFile } = await import('node:fs/promises');
  const identity = validateSigningIdentity({ ...fixture.fields, certificate: await readFile(resolve(fixture.directory, 'ec.pem')), key: await readFile(resolve(fixture.directory, 'ec.key')), now: Date.now() });
  const archive = buildAppleWalletPass({ identity, attendee: record, organizationName: '合成团队', verificationUrl: 'https://api.artdico.host/api/admin/registration/wallet/verify/synthetic', now: Date.now() });
  const files = passFiles(archive); await writeFile(resolve(fixture.directory, 'ec-manifest.json'), files.get('manifest.json')); await writeFile(resolve(fixture.directory, 'ec-signature'), files.get('signature'));
  assert.doesNotThrow(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'ec-signature', '-content', 'ec-manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'ec-verified.json']));
  await writeFile(resolve(fixture.directory, 'ordinary.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=clientAuth\n');
  fixture.run(['x509', '-req', '-in', 'ec.csr', '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial', '-out', 'ordinary.pem', '-days', '100', '-extfile', 'ordinary.ext']);
  assert.throws(() => validateSigningIdentity({ ...fixture.fields, certificate: Buffer.from(fixture.run(['x509', '-in', 'ordinary.pem', '-outform', 'PEM'])), key: Buffer.from(fixture.run(['pkey', '-in', 'ec.key'])), now: Date.now() }), { code: 'WALLET_CERTIFICATE_TYPE_INVALID' });
});

test('HTTP capability routes use strict site Origin/CORS, bounded JSON and safe pass MIME with no staff authentication', async () => {
  const wallet = service(), handle = createAppleWalletApi({ service: wallet });
  const request = (path = '/api/admin/registration/wallet', options = {}) => new Request('https://api.artdico.host' + path, { method: 'POST', headers: { origin: 'https://artdico.host', 'content-type': 'application/json', cookie: 'staff=unused' }, body: JSON.stringify({ receiptToken: token }), ...options });
  const valid = await handle(request()); assert.equal(valid.status, 200); assert.equal(valid.headers.get('content-type'), 'application/vnd.apple.pkpass'); assert.equal(valid.headers.get('access-control-allow-origin'), 'https://artdico.host'); assert.equal(valid.headers.has('access-control-allow-credentials'), false); assert.equal(valid.headers.get('cache-control'), 'private, no-store');
  assert.match(valid.headers.get('content-disposition'), /^attachment; filename="artdico-[A-Za-z0-9_-]{12}\.pkpass"$/u);
  assert.equal((await handle(request('/api/registration/wallet'))).status, 200);
  assert.equal((await handle(request(undefined, { headers: { origin: 'https://evil.invalid', 'content-type': 'application/json' } }))).status, 403);
  assert.equal((await handle(request(undefined, { headers: { 'content-type': 'application/json' } }))).status, 403);
  assert.equal((await handle(request(undefined, { body: JSON.stringify({ receiptToken: token, name: 'not allowed' }) }))).status, 400);
  assert.equal((await handle(request(undefined, { body: '{"receiptToken":"' + 'x'.repeat(9000) + '"}' }))).status, 413);
  assert.equal((await handle(request('/api/admin/registration/wallet?secret=never'))).status, 404);
  const preflight = await handle(new Request('https://api.artdico.host/api/admin/registration/wallet', { method: 'OPTIONS', headers: { origin: 'https://artdico.host' } })); assert.equal(preflight.status, 204);
  const badPreflight = await handle(new Request('https://api.artdico.host/api/admin/registration/wallet', { method: 'OPTIONS', headers: { origin: 'https://artdico.host', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'Authorization' } })); assert.equal(badPreflight.status, 403);
  const pass = JSON.parse(passFiles(Buffer.from(await valid.arrayBuffer())).get('pass.json'));
  const verified = await handle(new Request(pass.barcodes[0].message)); assert.equal(verified.status, 200); assert.equal((await verified.json()).valid, true);
  const waiting = createAppleWalletApi({ service: service({ authorize: async () => ({ ...record, admissionStatus: 'waitlisted' }) }) }); assert.equal((await waiting(request())).status, 404);
});

test('a stalled public body is cancelled within the trusted deadline without reaching signing or leaking its data', async () => {
  let cancelled = false, calls = 0;
  const handle = createAppleWalletApi({ service: { download: async () => { calls++; throw new Error('PRIVATE_INPUT'); }, verify: async () => ({ valid: false }) }, bodyTimeoutMs: 10 });
  const request = new Request('https://api.artdico.host/api/admin/registration/wallet', { method: 'POST', duplex: 'half', headers: { origin: 'https://artdico.host', 'content-type': 'application/json' }, body: new ReadableStream({ cancel() { cancelled = true; } }) });
  const response = await handle(request); assert.equal(response.status, 503); assert.equal(calls, 0); assert.equal(cancelled, true); assert.doesNotMatch(await response.text(), /PRIVATE_INPUT|timeout|stack/u);
});
