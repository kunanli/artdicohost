import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, createHmac, generateKeyPairSync, hkdfSync } from 'node:crypto';
import { validateSigningIdentity, buildAppleWalletPass } from '../functions/apple-wallet/pkpass.mjs';
import { createAppleWalletService, WALLET_CONFIG_FIELDS } from '../functions/apple-wallet/service.mjs';
import { createAppleWalletApi } from '../functions/apple-wallet/handler.mjs';
import { derChildren } from '../functions/apple-wallet/der.mjs';
import { createWalletFixture, passFiles } from './apple-wallet-fixture.mjs';
import { eventConfig, PUBLIC_AGENDA_URL, PUBLIC_EVENT_DETAILS_URL, PUBLIC_REGISTRATION_URL, PUBLIC_SHOWCASE_URL } from '../src/config/event.mjs';

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
  assert.equal((await service({ env: { ...fixture.env, APPLE_WALLET_KEY_PASSPHRASE: '' } }).readiness()).ready, true, 'empty optional dotenv placeholder means no key password');
});

test('real pkpass contains bounded ZIP, exact manifest hashes and a detached CMS signature independently verified by OpenSSL', async () => {
  const wallet = service(), readiness = await wallet.readiness(); assert.equal(readiness.ready, true); assert.equal(readiness.deviceTestRequired, true);
  const result = await wallet.download({ receiptToken: token }); assert.equal(result.outcome, 'issued'); assert.equal(result.contentType, 'application/vnd.apple.pkpass');
  const files = passFiles(result.data); assert.deepEqual([...files.keys()].sort(), ['icon.png','icon@2x.png','background.png','background@2x.png','artwork.png','artwork@2x.png','manifest.json','pass.json','signature'].sort());
  const pass = JSON.parse(files.get('pass.json')), manifest = JSON.parse(files.get('manifest.json'));
  assert.equal(pass.passTypeIdentifier, fixture.fields.passTypeIdentifier); assert.equal(pass.teamIdentifier, fixture.fields.teamId);
  assert.equal(pass.eventTicket.secondaryFields[0].value, record.name); assert.equal(pass.eventTicket.headerFields[0].value, '已确认');
  assert.deepEqual(pass.preferredStyleSchemes,['posterEventTicket','eventTicket']);
  assert.equal(pass.featuredActions, undefined);
  assert.equal(pass.semantics.eventName,record.event.title);assert.equal(pass.semantics.venueName,record.event.venue);
  assert.equal(pass.semantics.seats,undefined,'no invented seat entitlement');
  assert.equal(files.get('artwork@2x.png').readUInt32BE(16),750);assert.equal(files.get('artwork@2x.png').readUInt32BE(20),1000);
  assert.ok(result.data.length<1024*1024);
  assert.equal(pass.sharingProhibited, true); assert.equal(pass.webServiceURL, undefined); assert.equal(pass.authenticationToken, undefined);
  assert.doesNotMatch(JSON.stringify(pass), /email|wechat|permissionReference|internalNotes|synthetic\.receipt/u);
  for (const [name, expected] of Object.entries(manifest)) assert.equal(createHash('sha1').update(files.get(name)).digest('hex'), expected);
  assert.deepEqual(Object.keys(manifest).sort(), ['icon.png','icon@2x.png','background.png','background@2x.png','artwork.png','artwork@2x.png','pass.json'].sort());
  await writeFile(resolve(fixture.directory, 'manifest.json'), files.get('manifest.json')); await writeFile(resolve(fixture.directory, 'signature'), files.get('signature'));
  assert.doesNotThrow(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'verified-manifest.json']));
  await writeFile(resolve(fixture.directory, 'manifest.json'), Buffer.from('tampered'));
  assert.throws(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'tampered-output.json']));
  assert.equal(files.get('icon.png').readUInt32BE(16), 29); assert.equal(files.get('icon@2x.png').readUInt32BE(16), 58);
});

test('Wallet refuses pending, rejected, waitlist, withdrawn and lost-authority outcomes, including cancellation while signing', async () => {
  for (const admissionStatus of ['pending_review', 'rejected', 'waitlisted', 'withdrawn']) {
    const wallet = service({ authorize: async () => ({ ...record, admissionStatus }) }); assert.equal((await wallet.download({ receiptToken: token })).outcome, 'inactive');
    assert.equal((await service({ authorizedRegistration: async () => ({ ...record, admissionStatus }) }).download({ receiptToken: token })).outcome, 'inactive');
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
  for (const value of ['pending_review', 'rejected', 'waitlisted', 'withdrawn']) { status = value; assert.deepEqual(await wallet.verify({ token: validityToken }), { valid: false }); }
  status = 'confirmed';
  now += 20 * 86400000; assert.deepEqual(await wallet.verify({ token: validityToken }), { valid: false });
});

test('email corrections invalidate old and legacy Wallet barcodes and an access change during signing returns no pass', async () => {
  let revision = 0;
  const wallet = service({ authorize: async () => ({ ...record, accessRevision: revision }),
    authorizedRegistration: async () => ({ ...record, accessRevision: revision }) });
  const original = await wallet.download({ receiptToken: token });
  assert.equal(original.outcome, 'issued');
  const barcode = result => JSON.parse(passFiles(result.data).get('pass.json')).barcodes[0].message.split('/').at(-1);
  const originalToken = barcode(original), originalClaims = JSON.parse(Buffer.from(originalToken.split('.')[0], 'base64url'));
  assert.equal(originalClaims.accessRevision, 0);
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('artdico/apple-wallet-verification-v1'), 32));
  const signed = claims => { const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'); return payload + '.' + createHmac('sha256', key).update(payload).digest('base64url'); };
  const { accessRevision: omitted, ...legacyClaims } = originalClaims, legacyToken = signed(legacyClaims);
  assert.equal((await wallet.verify({ token: legacyToken })).valid, true, 'an unchanged person keeps the existing six-field barcode');
  revision = 1;
  assert.deepEqual(await wallet.verify({ token: originalToken }), { valid: false });
  assert.deepEqual(await wallet.verify({ token: legacyToken }), { valid: false });
  const corrected = await wallet.download({ receiptToken: token });
  assert.equal(corrected.outcome, 'issued');
  assert.equal((await wallet.verify({ token: barcode(corrected) })).valid, true);
  for (const value of [-1, null, '1', 0.5]) assert.deepEqual(await wallet.verify({ token: signed({ ...originalClaims, accessRevision: value }) }), { valid: false });
  assert.deepEqual(await wallet.verify({ token: signed({ ...originalClaims, accessRevision: 1, unexpected: true }) }), { valid: false });
  assert.deepEqual(await service({ authorize: async () => ({ ...record, accessRevision: 1 }),
    authorizedRegistration: async () => ({ ...record, accessRevision: 2 }) }).download({ receiptToken: token }), { outcome: 'inactive' });
  assert.deepEqual(await service({ authorize: async () => ({ ...record, accessRevision: null }) }).download({ receiptToken: token }), { outcome: 'invalid' });
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

test('encoded Wallet requests are rejected before parsing or invoking the signing service', async () => {
  let calls = 0;
  const handle = createAppleWalletApi({ service: { download: async () => { calls++; return { outcome: 'not_ready' }; }, verify: async () => ({ valid: false }) } });
  for (const encoding of ['gzip', 'br', 'deflate', 'identity, gzip']) {
    const request = new Request('https://api.artdico.host/api/admin/registration/wallet', { method: 'POST', headers: { origin: 'https://artdico.host', 'content-type': 'application/json', 'content-encoding': encoding }, body: JSON.stringify({ receiptToken: token }) });
    const response = await handle(request); assert.equal(response.status, 415); assert.equal(calls, 0);
    assert.doesNotMatch(await response.text(), /synthetic\.receipt|b{43}/u);
  }
  for (const encoding of [undefined, 'identity']) {
    const response = await handle(new Request('https://api.artdico.host/api/admin/registration/wallet', { method: 'POST', headers: { origin: 'https://artdico.host', 'content-type': 'application/json', ...(encoding ? { 'content-encoding': encoding } : {}) }, body: JSON.stringify({ receiptToken: token }) }));
    assert.equal(response.status, 503);
  }
  assert.equal(calls, 2, 'only absent or identity encoding reaches the trusted service');
});

test('new Wallet passes use the same dedicated short staff check-in capability and preserve legacy verification reads', async () => {
  const admissionUrl = 'https://api.artdico.host/admin/checkin/#ticket=' + 'x'.repeat(22); let calls = 0;
  const wallet = service({ admissionUrlProvider: async input => { calls++; assert.deepEqual(input, { registrationId: id, accessRevision: 0 }); return { admissionUrl }; } });
  assert.equal(calls, 0); await wallet.readiness(); assert.equal(calls, 0, 'readiness does not create short mappings');
  const issued = await wallet.download({ receiptToken: token }); assert.equal(issued.outcome, 'issued'); assert.equal(calls, 1);
  const pass = JSON.parse(passFiles(issued.data).get('pass.json')); assert.equal(pass.barcodes[0].message, admissionUrl);
  assert.equal(JSON.stringify(pass).includes('synthetic.receipt'), false);
  assert.equal((await service({ admissionUrlProvider: async () => ({ admissionUrl: 'https://external.invalid/' }) }).download({ receiptToken: token })).outcome, 'unavailable');
  assert.equal((await service({ admissionUrlProvider: async () => { throw new Error('PRIVATE_SYNTHETIC_LINK'); } }).download({ receiptToken: token })).outcome, 'unavailable');
  calls = 0;
  assert.equal((await service({ authorize: async () => ({ ...record, admissionStatus: 'withdrawn' }), admissionUrlProvider: async () => { calls++; return { admissionUrl }; } }).download({ receiptToken: token })).outcome, 'inactive');
  assert.equal(calls, 0);
});

test('commemorative passes sign the full poster and a compatible native strip without a barcode', async () => {
  const pendingIdentity={...record,walletRequested:true};
  const waiting=service({authorize:async()=>pendingIdentity,authorizedRegistration:async()=>pendingIdentity});
  assert.equal((await waiting.download({receiptToken:token})).outcome,'inactive');
  const selected={...pendingIdentity,walletIdentity:'guest',event:{...record.event,id:'ggj-cn-2026'}};
  const afterEvent = Date.parse(record.event.date + 'T23:59:59+08:00') + 60_000;
  let entryRequests = 0;
  const issued=await service({authorize:async()=>selected,authorizedRegistration:async()=>selected,clock:()=>afterEvent,
    admissionUrlProvider:async()=>{entryRequests++;throw new Error('Keepsake should not request a check-in code');}}).download({receiptToken:token});
  assert.equal(issued.outcome,'issued');
  assert.equal(entryRequests,0);
  const files=passFiles(issued.data),pass=JSON.parse(files.get('pass.json'));
  const manifest=JSON.parse(files.get('manifest.json'));
  assert.equal(pass.preferredStyleSchemes, undefined, 'Wallet selects the supported style from the two dictionaries');
  assert.deepEqual(pass.posterGeneric.primaryFields.map(({ label, value }) => [label, value]), [[undefined, '嘉宾'], [undefined, record.name]]);
  assert.equal(pass.posterGeneric.footerFields[0].label, '活动时间与地点 · UTC+8');
  assert.equal(pass.posterGeneric.footerFields[0].value, [record.event.date, record.event.time, record.event.venue].join(' · '));
  const program = pass.posterGeneric.additionalInfoFields.slice(0, 2);
  assert.deepEqual(program.map(({ label }) => label), ['GGJ 中国交流聚会', 'ARTDiCO HOST 学生嘉年华']);
  assert.match(program[0].value, /Maria Burns Ortiz.+主题演讲.+专题研讨、圆桌交流与 GGJ 站点咨询。$/u);
  assert.match(program[1].value, /学生作品、独立游戏试玩和产品展示.+面对面交流.+招募与预录取机会。$/u);
  assert.deepEqual(pass.posterGeneric.additionalInfoFields.slice(2, 5).map(({ value }) => value),
    [record.event.date, record.event.time, record.event.venue]);
  const schedule = pass.posterGeneric.additionalInfoFields.slice(5);
  assert.deepEqual(schedule.map(({ label }) => label), ['A 区 · 阶梯展示厅｜上午', 'A 区 · 阶梯展示厅｜下午',
    'B 区 · 咖啡厅', 'C 区 · 外围展位', 'C-10 至 C-15 · 独立游戏试玩']);
  assert.match(schedule[0].value, /10:15–11:00　主题演讲：At the Forefront of the Future: How Jammers Are Leading Innovation/u);
  assert.match(schedule[0].value, /12:30–13:30　午餐休息$/u);
  assert.deepEqual(schedule[1].value.split('\n'), [
    '13:30–14:30　AI × Houdini：从自然语言到 Unreal Engine 程序化构建',
    '14:30–14:50　提赛德大学宣讲',
    '14:50–15:10　伯恩茅斯大学宣讲',
    '15:10–17:00　ARTDiCO 学生展示',
    '17:00–17:10　闭幕合影',
    '17:10–18:00　自由交流、自由参观及离场（无正式议程）',
  ]);
  assert.match(schedule[2].value, /15:00–15:30　GGJ 站点咨询（南方站）\n15:40–16:40　圆桌会议/u);
  assert.match(schedule[3].value, /09:30–18:00　共 16 个展位/u);
  assert.match(schedule[4].value, /妖殿奇谭.+人是不能飞的/u);
  assert.ok(schedule.every(field => !Object.hasOwn(field, 'attributedValue') && !field.value.includes('https://')));
  assert.equal(pass.serialNumber, selected.event.id + '-' + record.registrationId);
  assert.equal(pass.logoText, undefined);
  assert.equal(pass.eventTicket.backFields[0].value, 'GGJ China Meetup 2026 x ARTDiCO HOST');
  assert.equal(pass.eventTicket.primaryFields, undefined, 'primary fields would overlap the strip');
  assert.deepEqual(pass.eventTicket.secondaryFields.map(({ label, value }) => [label, value]), [[undefined, '嘉宾'], [undefined, record.name]]);
  assert.deepEqual(pass.eventTicket.auxiliaryFields.map(({value})=>value),[record.event.date,record.event.time,'讲座・站点交流・游戏展',record.event.venue]);
  assert.deepEqual(pass.eventTicket.backFields.filter(({ key }) => key.endsWith('-program')).map(({ label, value }) => [label, value]),
    program.map(({ label, value }) => [label, value]));
  assert.equal(pass.eventTicket.backFields.find(field=>field.key==='venue').value,record.event.venue);
  assert.deepEqual(pass.eventTicket.backFields.filter(({key})=>key.startsWith('details-')).map(({value})=>value), [record.name,'嘉宾',record.event.title,record.event.date,record.event.time]);
  assert.deepEqual(pass.eventTicket.backFields.slice(1, 6).map(({ key }) => key), ['venue', 'directions', 'agenda', 'showcase', 'huodongxing']);
  assert.deepEqual(pass.eventTicket.backFields.slice(3, 6).map(({ value }) => value), [PUBLIC_AGENDA_URL, PUBLIC_SHOWCASE_URL, PUBLIC_REGISTRATION_URL]);
  assert.equal(pass.featuredActions, undefined);
  assert.deepEqual(pass.eventTicket.backFields.filter(({ key }) => key.startsWith('schedule-')).map(({ label, value }) => [label, value]),
    schedule.map(({ label, value }) => [label, value]));
  assert.equal(pass.eventTicket.backFields.find(({ key }) => key === 'event-details').value, PUBLIC_EVENT_DETAILS_URL);
  assert.deepEqual(pass.posterGeneric.backFields.map(({ key, ...field }) => ({ key: key.slice('poster-details-'.length), ...field })),
    pass.eventTicket.backFields);
  const directions = pass.eventTicket.backFields.find(({ key }) => key === 'directions'), map = new URL(directions.value);
  assert.equal(map.origin, 'https://maps.apple.com');
  assert.equal(map.pathname, '/directions');
  assert.deepEqual([...map.searchParams], [['destination', record.event.venue]]);
  assert.equal(directions.attributedValue, `<a href="${map.href}">在 Apple 地图中查看路线</a>`);
  const keys = [...Object.values(pass.eventTicket), ...Object.values(pass.posterGeneric)].flat().map(field => field.key);
  assert.equal(new Set(keys).size,keys.length);
  assert.equal(pass.semantics.attendeeName, record.name);
  assert.equal(pass.semantics.admissionLevel, undefined);
  for (const field of ['barcode','barcodes','expirationDate','relevantDate']) assert.equal(Object.hasOwn(pass,field),false);
  assert.match(pass.eventTicket.backFields.find(field=>field.key==='notice').value,/现场签到请使用活动行原电子票/u);
  assert.deepEqual([...files.keys()].sort(), ['icon.png','icon@2x.png','logo.png','logo@2x.png','logo@3x.png',
    'strip.png','strip@2x.png','strip@3x.png','artwork@2x.png','artwork@3x.png','primaryLogo@2x.png','primaryLogo@3x.png',
    'pass.json','manifest.json','signature'].sort());
  for (const [name, width, height, scales] of [
    ['strip', 375, 98, [1, 2, 3]], ['logo', 160, 50, [1, 2, 3]],
    ['artwork', 358, 448, [2, 3]], ['primaryLogo', 126, 30, [2, 3]],
  ]) {
    for (const scale of scales) {
      const path = name + (scale === 1 ? '' : '@' + scale + 'x') + '.png';
      const image = files.get(path);
      assert.equal(image.readUInt32BE(16), width * scale);
      assert.equal(image.readUInt32BE(20), height * scale);
      assert.equal(manifest[path], createHash('sha1').update(image).digest('hex'));
    }
  }
  assert.deepEqual(Object.keys(manifest).sort(), [...files.keys()].filter(name => name !== 'manifest.json' && name !== 'signature').sort());
  await writeFile(resolve(fixture.directory, 'poster-manifest.json'), files.get('manifest.json'));
  await writeFile(resolve(fixture.directory, 'poster-signature'), files.get('signature'));
  assert.doesNotThrow(() => fixture.run(['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'poster-signature',
    '-content', 'poster-manifest.json', '-CAfile', 'root.pem', '-purpose', 'any', '-out', 'verified-poster-manifest.json']));
});

test('keepsake reissues show each saved GGJ field independently and keep full values in details', async () => {
  const selected = { ...record, walletRequested: true, walletIdentity: 'organizer', event: { ...record.event, id: eventConfig.id, venue: eventConfig.venue.address } };
  const site = '很长的合成站点名称'.repeat(4), role = '站点组织者';
  const brand = 'Ggj Artdico';
  let cardCommunity = { site: '', role: '' };
  const load = async () => ({ ...selected, cardCommunity,
    ...(cardCommunity.site === brand ? { cardProfile: { organization: '合成机构', phone: '' } } : {}) });
  const wallet = service({ authorize: load, authorizedRegistration: load });
  let serial;
  for (const values of [{ site: '', role: '' }, { site, role: '' }, { site: '', role }, { site, role }, { site: brand, role }]) {
    cardCommunity = values;
    const result = await wallet.download({ receiptToken: token });
    assert.equal(result.outcome, 'issued');
    const pass = JSON.parse(passFiles(result.data).get('pass.json'));
    serial ??= pass.serialNumber;
    assert.equal(pass.serialNumber, serial);
    assert.equal(pass.semantics.venueName, eventConfig.venue.name);
    assert.equal(pass.semantics.venueRegionName, eventConfig.venue.city);
    const { headerFields, secondaryFields, auxiliaryFields, backFields } = pass.eventTicket;
    assert.deepEqual(headerFields?.map(({ value }) => value), values.site || values.role ? ['前海5号楼'] : undefined);
    const siteValue = values.site === brand ? 'GGJ ARTDICO' : values.site;
    const posterSite = values.site === brand ? siteValue : siteValue && 'GGJ ' + siteValue;
    const identityValue = values.role ? '站点组织者' : values.site ? '组织者' : 'GGJ 组织者';
    assert.deepEqual(pass.posterGeneric.primaryFields, [
      ...(posterSite ? [{ key: 'poster-site', value: posterSite }] : []),
      { key: 'poster-identity', value: identityValue },
      { key: 'poster-name', value: record.name, semantics: { attendeeName: record.name } },
    ]);
    assert.deepEqual(secondaryFields.map(({ label, value }) => [label, value]), [[undefined, identityValue], [undefined, record.name]]);
    for (const [key, value] of [['ggj-site', siteValue], ['ggj-role', values.role]]) {
      assert.equal(backFields.find(field => field.key === key)?.value, value || undefined);
      assert.equal(pass.posterGeneric.additionalInfoFields.find(field => field.key === 'poster-info-' + key)?.value, value || undefined);
      const shortened = auxiliaryFields.find(field => field.key === key + '-short');
      assert.equal(shortened?.value, value === site ? [...site].slice(0, 13).join('') + '…' : value || undefined);
      if (shortened) assert.equal(shortened.row, 1);
    }
  }
});

test('a changed staff card identity during signing prevents returning a stale pass',async()=>{
  const selected={...record,walletRequested:true,walletIdentity:'speaker'};
  const result=await service({authorize:async()=>selected,authorizedRegistration:async()=>({...selected,walletIdentity:'attendee'})}).download({receiptToken:token});
  assert.equal(result.outcome,'inactive');
});

test('the signed keepsake presents a saved organization and detail phone without copying email or WeChat', async () => {
  const cardProfile = { organization: '合成的学校', phone: '+86 010 0000 0000' };
  const selected = { ...record, walletRequested: true, walletIdentity: 'student', cardProfile,
    cardCommunity: { site: '合成站', role: '组织者' }, email: 'excluded@example.invalid', wechat: 'excluded-wechat' };
  const wallet = service({ authorize: async () => selected, authorizedRegistration: async () => selected });
  const result = await wallet.download({ receiptToken: token });
  assert.equal(result.outcome, 'issued');
  const bytes = passFiles(result.data).get('pass.json').toString();
  const { auxiliaryFields, backFields } = JSON.parse(bytes).eventTicket;
  assert.ok(auxiliaryFields.some(field => field.key === 'organization-short' && field.value === cardProfile.organization));
  assert.ok(backFields.some(field => field.key === 'phone' && field.value === cardProfile.phone));
  assert.equal(auxiliaryFields.some(field => field.key === 'phone'), false);
  assert.doesNotMatch(bytes, /excluded@example|excluded-wechat/u);
  const changed = service({ authorize: async () => selected, authorizedRegistration: async () => ({ ...selected, cardProfile: undefined }) });
  assert.equal((await changed.download({ receiptToken: token })).outcome, 'inactive');
});
