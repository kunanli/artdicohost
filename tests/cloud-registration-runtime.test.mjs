import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readSheet } from 'read-excel-file/node';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudContentRuntime, createCloudApplication } from '../functions/cloud-content/runtime.mjs';
import { objectFixture, fakeCredentials, fixedClock } from './cloud-oss-fixture.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { encodeSigningBundle, walletSigningObjectKey } from '../functions/apple-wallet/bundle.mjs';
import { encodeConfirmationMailBundle, confirmationMailObjectKey } from '../functions/registration-confirmation/config-bundle.mjs';
import { inspectEncryptedObjectBackup } from '../functions/registration-admin/maintenance.mjs';

const API = 'https://api.artdico.host', PUBLIC = 'https://artdico.host', EVENT = 'ggj-cn-2026';
const PASSWORD = 'synthetic-runtime-password-only', SECRET = 'synthetic-registration-token-key-with-enough-entropy';
const passwordHash = await hashPassword(PASSWORD);
const users = [{ id: 'synthetic-owner', username: 'synthetic.owner', email: 'synthetic.owner@artdico.co', label: '合成管理员', roles: ['editor', 'publisher', 'outreach', 'reviewer', 'superadmin'], passwordHash },
  { id: 'synthetic-editor', username: 'synthetic.editor', label: '合成编辑', roles: ['editor'], passwordHash }];
const POLICY = { enabled: true, eventId: EVENT, capacity: 3, opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00',
  privacy: { version: 'synthetic-runtime-notice-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成测试的报名及联络', storageRegion: '合成储存地区',
    retention: '合成测试保留规则', rightsRequest: '通过合成联络方式申请查阅、更正、删除', sharing: '合成测试不对外分享' } };
const ENV = { NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'true', ARTDICO_CONTENT_API_ORIGIN: API, ARTDICO_PUBLIC_SITE_ORIGIN: PUBLIC,
  ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong', ADMIN_USERS_JSON: JSON.stringify(users),
  ALIBABA_CLOUD_ACCESS_KEY_ID: fakeCredentials.accessKeyId, ALIBABA_CLOUD_ACCESS_KEY_SECRET: fakeCredentials.accessKeySecret, ALIBABA_CLOUD_SECURITY_TOKEN: fakeCredentials.securityToken,
  ARTDICO_REGISTRATION_ENABLED: 'true', ARTDICO_REGISTRATION_CAPACITY: '3', ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify(POLICY), ARTDICO_REGISTRATION_TOKEN_SECRET: SECRET };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAFElEQVR4nGN0KFjAwMDAxMDAgKAAGOQBVgs9CEsAAAAASUVORK5CYII=';
const request = (path, { method = 'GET', headers = {}, body, origin } = {}) => new Request(API + path, { method,
  headers: { ...(origin === undefined ? {} : { Origin: origin }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const payload = () => ({ eventId: EVENT, fields: { name: '合成报名人', city: '合成城市', organization: '合成团队', position: '开发者', email: 'private.synthetic@example.invalid',
  categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none' },
consent: { accepted: true, version: POLICY.privacy.version } });
function fixture(env = ENV) {
  const remote = objectFixture();
  const make = override => createCloudContentRuntime({ env: { ...env, ...override }, fetchFn: remote.fetchFn, now: () => fixedClock().getTime() });
  return { remote, make, first: make(), second: make() };
}
async function login(runtime, username = 'synthetic.owner') {
  const response = await runtime.handle(request('/api/admin/login', { method: 'POST', origin: API, body: { username, password: PASSWORD } }));
  assert.equal(response.status, 200);
  const value = await response.json();
  return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': value.csrfToken };
}
async function issued(runtime, key = randomBytes(32).toString('base64url')) {
  const response = await runtime.handle(request('/api/admin/registration/token', { method: 'POST', origin: PUBLIC, body: { eventId: EVENT, idempotencyKey: key } }));
  assert.equal(response.status, 200);
  return { 'Idempotency-Key': key, 'X-Registration-Token': (await response.json()).submissionToken };
}
async function approveApplication(runtime, headers, registrationId, expectedRevision) {
  const operationId = randomBytes(32).toString('base64url');
  const response = await runtime.handle(request('/api/admin/admissions/approve', { method: 'POST', origin: API, headers,
    body: { registrationId, expectedRevision, operationId } }));
  assert.equal(response.status, 200, await response.clone().text());
  const result = await response.json();
  assert.deepEqual(result.operation, { operationId, action: 'approve', registrationId, revision: expectedRevision + 1 });
  return result;
}

test('exact public aliases compose the real durable service while protected plural review routes retain authorization', async () => {
  const f = fixture();
  assert.equal(f.first.configured, true); assert.equal(f.first.registrationEnabled, true); assert.equal(f.first.storageVerified, false);
  assert.equal(f.remote.calls.length, 0, 'constructors do not initialize or publish production data');
  const config = await f.first.handle(request('/api/admin/registration/config', { origin: PUBLIC }));
  assert.equal(config.status, 200); assert.equal(config.headers.get('access-control-allow-origin'), PUBLIC);
  assert.equal(config.headers.get('access-control-allow-credentials'), null);
  assert.deepEqual(await config.json(), { ...POLICY, attendeeReviewRequired: true, opensAt: new Date(POLICY.opensAt).toISOString(), closesAt: new Date(POLICY.closesAt).toISOString(),
    admissions: { capacity: 3, staffReserve: 0, waitlistEnabled: false, confirmedCount: 0, attendeeConfirmedCount: 0, crewConfirmedCount: 0, waitlistCount: 0,
      pendingReviewCount: 0, rejectedCount: 0, remainingPublic: 3, remainingTotal: 3 } });
  const preflight = await f.first.handle(request('/api/admin/registration/token', { method: 'OPTIONS', origin: PUBLIC, headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }));
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  for (const path of ['/api/admin/registration/config', '/api/admin/registration/token']) {
    assert.equal((await f.first.handle(request(path, { origin: 'https://foreign.example.invalid' }))).status, 403);
  }
  assert.equal((await f.first.handle(request('/api/admin/registrations', { origin: PUBLIC }))).status, 403);
  const headers = await issued(f.first), submission = { method: 'POST', origin: PUBLIC, headers, body: payload() };
  const saved = await f.first.handle(request('/api/admin/registration/submit', submission));
  assert.equal(saved.status, 201);
  const receipt = await saved.json(); assert.deepEqual(Object.keys(receipt).sort(), ['admissionKind', 'admissionRevision', 'admissionStatus', 'confirmation', 'groupInvite', 'reference_code', 'status']);
  assert.equal(receipt.status, 'pending_review'); assert.equal(receipt.admissionStatus, 'pending_review'); assert.equal(receipt.groupInvite, null);
  assert.equal(receipt.confirmation.email.status, 'not_applicable');
  assert.equal(receipt.confirmation.confirmationUrl, PUBLIC + '/registration/confirmation/#r=' + receipt.confirmation.receiptToken);
  assert.doesNotMatch(JSON.stringify(receipt), /private\.synthetic|passwordHash|scrypt\$|cms\/v1/u);
  const replay = await f.second.handle(request('/api/admin/registration/submit', submission));
  assert.equal(replay.status, 200); assert.equal((await replay.json()).reference_code, receipt.reference_code);
  assert.equal((await f.second.handle(request('/api/registrations', { ...submission, body: { ...payload(), fields: { ...payload().fields, name: '合成不同资料' } } }))).status, 409);
  const editor = await login(f.first, 'synthetic.editor');
  assert.equal((await f.second.handle(request('/api/admin/registrations', { headers: editor }))).status, 403);
  assert.equal((await f.second.handle(request('/api/admin/users', { headers: editor }))).status, 403);
  assert.equal((await f.second.handle(request('/api/admin/maintenance', { headers: editor }))).status, 403);
  assert.equal((await f.second.handle(request('/api/admin/contacts/import/preview', { method: 'POST', origin: API, headers: editor, body: {} }))).status, 403);
  const owner = await login(f.second);
  const approved = await approveApplication(f.second, owner, receipt.reference_code, 1);
  assert.equal(approved.summary.confirmedCount, 1); assert.equal(approved.summary.pendingReviewCount, 0);
  const admitted = await (await f.first.handle(request('/api/admin/registration/submit', submission))).json();
  assert.equal(admitted.status, 'registered'); assert.equal(admitted.confirmation.email.status, 'not_applicable', 'saved public replay never initiates formal mail');
  const listed = await f.first.handle(request('/api/admin/registrations', { headers: owner }));
  assert.equal(listed.status, 200); const list = await listed.json(); assert.equal(list.total, 1);
  assert.equal(JSON.stringify(list).includes('private.synthetic@example.invalid'), false);
  const planning = await f.first.handle(request('/api/admin/planning', { headers: owner }));
  const features = (await planning.json()).features;
  assert.equal(features.intentInvitations, true); assert.equal(features.contactImport, true); assert.equal(features.protectedContactImport, true); assert.equal(features.batchInvitations, true);
  assert.equal(Number(planning.headers.get('content-length')) > 0, true);
  assert.equal((await f.second.handle(new Request('https://foreign.example.invalid/api/admin/registration/config', { headers: { Origin: PUBLIC } }))).status, 403);
  assert.equal((await f.second.handle(request('/api/admin/registration/config?unexpected=1', { origin: PUBLIC }))).status, 404);
  assert.notEqual((await f.second.handle(request('/api/admin/registration/submit/', submission))).status, 201);
  assert.equal(f.remote.calls.some(value => value.key.startsWith('cms/v1/registrations/' + EVENT + '/records/')), true);
});

test('missing, inconsistent or disabled formal configuration cannot open aliases or leak a configured token key', async () => {
  for (const patch of [{ ARTDICO_REGISTRATION_POLICY_JSON: '{' }, { ARTDICO_REGISTRATION_TOKEN_SECRET: '' }, { ARTDICO_REGISTRATION_CAPACITY: '4' },
    { ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify({ ...POLICY, eventId: 'another-event' }) },
    { ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify({ ...POLICY, privacy: { ...POLICY.privacy, processor: '' } }) }, { ARTDICO_REGISTRATION_ENABLED: 'TRUE' }, { ARTDICO_REGISTRATION_WAITLIST_ENABLED: 'TRUE' }]) {
    const f = fixture({ ...ENV, ...patch });
    assert.equal(f.first.configured, true); assert.equal(f.first.registrationEnabled, false);
    const config = await f.first.handle(request('/api/admin/registration/config', { origin: PUBLIC }));
    assert.deepEqual(await config.json(), { enabled: false, reason: 'unavailable' });
    assert.equal((await f.first.handle(request('/api/admin/registration/token', { method: 'POST', origin: PUBLIC, body: { eventId: EVENT, idempotencyKey: randomBytes(32).toString('base64url') } }))).status, 503);
    assert.equal(f.remote.calls.length, 0);
  }
  const disabled = fixture({ ...ENV, ARTDICO_REGISTRATION_ENABLED: 'false', ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify({ ...POLICY, enabled: false }) });
  assert.equal(disabled.first.registrationEnabled, false);
  const closedNotice = await (await disabled.first.handle(request('/api/admin/registration/config', { origin: PUBLIC }))).json();
  assert.equal(closedNotice.enabled, false); assert.equal(closedNotice.reason, 'closed');
  assert.deepEqual(closedNotice.privacy, POLICY.privacy);
  const closed = createCloudContentRuntime({ env: { ...ENV, ARTDICO_CLOUD_CONTENT_ENABLED: 'false' }, fetchFn: () => { throw new Error('unexpected'); } });
  assert.equal((await closed.handle(request('/api/admin/registration/config', { origin: PUBLIC }))).status, 503);
});

test('receipt-bound group aliases, review withdrawal and deletion requests share the same private registration state', async () => {
  const f = fixture(), owner = await login(f.first);
  const upload = await f.first.handle(request('/api/admin/group-invite', { method: 'POST', origin: API, headers: owner,
    body: { expectedRevision: 0, contentType: 'image/png', dataBase64: PNG, expiresAt: '2026-10-25T00:00:00Z' } }));
  assert.equal(upload.status, 200);
  const headers = await issued(f.first), submission = { method: 'POST', origin: PUBLIC, headers, body: payload() };
  const saved = await f.second.handle(request('/api/admin/registration/submit', submission));
  assert.equal(saved.status, 201); const receipt = await saved.json();
  assert.equal(receipt.status, 'pending_review'); assert.equal(receipt.groupInvite, null);
  await approveApplication(f.first, owner, receipt.reference_code, 1);
  const admitted = await (await f.second.handle(request('/api/admin/registration/submit', submission))).json();
  const imagePath = new URL(admitted.groupInvite.qrImageUrl).pathname;
  assert.match(imagePath, /^\/api\/admin\/registration\/group-invite\//u);
  const image = await f.first.handle(request(imagePath, { origin: PUBLIC }));
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.equal((await f.second.handle(request('/api/admin/registration/group-invite/unsigned', { origin: PUBLIC }))).status, 404);
  const detail = await f.second.handle(request('/api/admin/registrations/' + receipt.reference_code, { headers: owner }));
  const { review, revision } = await detail.json(); delete review.deletionRequested;
  const withdrawn = await f.first.handle(request('/api/admin/registrations/' + receipt.reference_code + '/review', { method: 'PATCH', origin: API, headers: owner, body: { expectedRevision: revision, review: { ...review, status: 'withdrawn' } } }));
  assert.equal(withdrawn.status, 200);
  assert.equal((await f.second.handle(request(imagePath, { origin: PUBLIC }))).status, 404);
  assert.equal((await f.first.handle(request('/api/admin/registration/submit', submission))).status, 410);
  const maintenance = await f.first.handle(request('/api/admin/maintenance', { headers: owner }));
  assert.equal(maintenance.status, 200);
  const safe = await maintenance.json();
  assert.equal(safe.backup.accountDirectoryIncluded, false); assert.equal(safe.sessionsRestored, false);
  assert.doesNotMatch(JSON.stringify(safe), /passwordHash|scrypt\$|synthetic-role-secret|cms\/v1/u);
});

test('shared admission reservation, reviewed public waitlist, actual crew, teams and cancellation govern old and new QR links', async () => {
  const f = fixture({ ...ENV, ARTDICO_REGISTRATION_WAITLIST_ENABLED: 'true' }), owner = await login(f.first);
  const mutate = async (path, method, expectedRevision, input) => {
    const response = await f.first.handle(request('/api/admin/admissions/' + path, { method, origin: API, headers: owner,
      body: { expectedRevision, operationId: randomBytes(32).toString('base64url'), ...input } }));
    assert.equal(response.status, 200, await response.clone().text()); return response.json();
  };
  const settings = await mutate('settings', 'PUT', 0, { settings: { staffReserve: 2, waitlistEnabled: true } });
  assert.equal(settings.revision, 1); assert.equal(settings.summary.remainingPublic, 1);
  assert.equal((await f.first.handle(request('/api/admin/group-invite', { method: 'POST', origin: API, headers: owner,
    body: { expectedRevision: 0, contentType: 'image/png', dataBase64: PNG, expiresAt: '2026-10-21T00:00:00.000Z' } }))).status, 200);
  const firstInput = { method: 'POST', origin: PUBLIC, headers: await issued(f.first), body: payload() };
  const firstApplication = await (await f.first.handle(request('/api/admin/registration/submit', firstInput))).json();
  assert.equal(firstApplication.status, 'pending_review'); assert.equal(firstApplication.groupInvite, null);
  const firstApproval = await approveApplication(f.second, owner, firstApplication.reference_code, 2);
  assert.equal(firstApproval.summary.confirmedCount, 1);
  const confirmed = await (await f.first.handle(request('/api/admin/registration/submit', firstInput))).json();
  assert.equal(confirmed.status, 'registered'); const oldImage = new URL(confirmed.groupInvite.qrImageUrl).pathname;
  const secondInput = { method: 'POST', origin: PUBLIC, headers: await issued(f.second), body: { ...payload(), fields: { ...payload().fields, name: '合成候补人' } } };
  const waitingResponse = await f.second.handle(request('/api/admin/registration/submit', secondInput)), waiting = await waitingResponse.json();
  assert.equal(waitingResponse.status, 201); assert.equal(waiting.status, 'pending_review'); assert.equal(waiting.groupInvite, null);
  const waitingApproval = await approveApplication(f.first, owner, waiting.reference_code, 4);
  assert.equal(waitingApproval.people.find(person => person.registrationId === waiting.reference_code).status, 'waitlisted');
  assert.equal(waitingApproval.approvalEmail, undefined, 'approved waitlist has no formal invitation send');
  const waitingReplay = await (await f.second.handle(request('/api/admin/registration/submit', secondInput))).json();
  assert.equal(waitingReplay.status, 'waitlisted'); assert.equal(waitingReplay.groupInvite, null);
  const crew = await mutate('staff', 'POST', 5, { input: { kind: 'crew', fields: { name: '合成工作人员', wechat: 'synthetic-staff' }, permissionReference: '合成线下登记授权' } });
  assert.equal(crew.summary.confirmedCount, 2); assert.equal(crew.summary.crewConfirmedCount, 1);
  const team = await mutate('teams', 'POST', 6, { team: { name: '合成已登记团队', memberIds: [confirmed.reference_code, crew.registrationId] } });
  assert.equal(team.teams[0].memberIds.length, 2); assert.equal(team.summary.confirmedCount, 2);
  const editor = await login(f.second, 'synthetic.editor'), before = f.remote.calls.length;
  assert.equal((await f.second.handle(request('/api/admin/admissions', { headers: editor }))).status, 403);
  assert.equal((await f.second.handle(request('/api/admin/tasks', { headers: editor }))).status, 403);
  assert.ok(f.remote.calls.slice(before).every(call => !/\/(?:registrations|contacts|intent-invitations)\//u.test(call.key)));
  const cancelled = await mutate('withdraw', 'POST', 7, { registrationId: confirmed.reference_code });
  assert.ok(cancelled.promotedIds.includes(waiting.reference_code)); assert.equal(cancelled.summary.confirmedCount, 2);
  assert.deepEqual(cancelled.promotionEmail, { status: 'not_configured', attemptedCount: 0, pendingCount: 1 });
  assert.equal((await f.second.handle(request(oldImage, { origin: PUBLIC }))).status, 404);
  assert.equal((await f.first.handle(request('/api/admin/registration/submit', firstInput))).status, 410);
  const promoted = await (await f.second.handle(request('/api/admin/registration/submit', secondInput))).json();
  assert.equal(promoted.status, 'registered'); assert.equal(promoted.admissionStatus, 'confirmed'); assert.ok(promoted.groupInvite?.qrImageUrl);
  const daily = await f.first.handle(request('/api/admin/tasks', { headers: owner }));
  assert.equal(daily.status, 200); assert.doesNotMatch(await daily.text(), /private\.synthetic@example|permissionReference|passwordHash/u);
});

test('composed capability reads current withdrawal, protected readiness and real Excel exports without sending email', async () => {
  const f = fixture(), owner = await login(f.first), editor = await login(f.first, 'synthetic.editor');
  const saved = await f.first.handle(request('/api/admin/registration/submit', { method: 'POST', origin: PUBLIC, headers: await issued(f.first), body: payload() }));
  assert.equal(saved.status, 201); const receipt = await saved.json(), input = { receiptToken: receipt.confirmation.receiptToken };
  for (const path of ['/api/registration/confirmation', '/api/admin/registration/confirmation']) {
    const before = f.remote.calls.length;
    const response = await f.second.handle(request(path, { method: 'POST', origin: PUBLIC, headers: { Cookie: 'irrelevant-public-cookie' }, body: input }));
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('access-control-allow-origin'), PUBLIC); assert.equal(response.headers.get('access-control-allow-credentials'), null);
    const value = await response.json(); assert.equal(value.referenceCode, receipt.reference_code); assert.equal(value.attendee.name, payload().fields.name);
    assert.equal(value.admission.status, 'pending_review'); assert.equal(value.email.status, 'not_applicable'); assert.equal(value.wallet.ready, false); assert.equal(value.groupInvite, null);
    assert.doesNotMatch(JSON.stringify(value), /private\.synthetic|privacy@example|tokenSecret|cms\/v1|passwordHash/u);
    assert.ok(f.remote.calls.slice(before).every(call => call.method === 'GET'), 'confirmation reads do not send or mutate');
  }
  await approveApplication(f.second, owner, receipt.reference_code, 1);
  const admittedResponse = await f.first.handle(request('/api/registration/confirmation', { method: 'POST', origin: PUBLIC, body: input }));
  const admitted = await admittedResponse.json();
  assert.equal(admitted.admission.status, 'confirmed'); assert.equal(admitted.email.status, 'not_configured');
  const rejectedAt = f.remote.calls.length;
  assert.equal((await f.first.handle(request('/api/admin/registration/confirmation', { method: 'POST', origin: 'https://foreign.invalid', body: input }))).status, 403);
  assert.equal((await f.first.handle(request('/api/admin/registration/confirmation?receiptToken=private', { method: 'POST', origin: PUBLIC, body: input }))).status, 404);
  assert.equal(f.remote.calls.length, rejectedAt, 'rejected capability requests do no object work');
  assert.equal((await f.first.handle(request('/api/admin/registration/wallet', { method: 'POST', origin: PUBLIC, body: input }))).status, 503);
  assert.ok(f.remote.calls.slice(rejectedAt).every(call => call.method === 'GET'), 'unconfigured Wallet only revalidates the current admission');
  for (const path of ['/api/admin/registration-confirmation/settings', '/api/admin/registrations/export.xlsx', '/api/admin/contacts/export.xlsx']) {
    const response = await f.first.handle(request(path, { method: path.endsWith('.xlsx') ? 'POST' : 'GET', origin: API, headers: editor,
      ...(path.endsWith('.xlsx') ? { body: { expectedRevision: 0 } } : {}) }));
    assert.equal(response.status, 403);
  }
  const readiness = await f.second.handle(request('/api/admin/registration-confirmation/settings', { headers: owner }));
  assert.equal(readiness.status, 200); const settings = await readiness.json();
  assert.equal(settings.email.ready, false); assert.equal(settings.wallet.ready, false); assert.equal(settings.wallet.deviceTestRequired, true);
  assert.doesNotMatch(JSON.stringify(settings), /synthetic-registration|private\.synthetic|scrypt\$|BEGIN |cms\/v1/u);
  const exported = await f.first.handle(request('/api/admin/registrations/export.xlsx', { method: 'POST', origin: API, headers: owner,
    body: { expectedRevision: 0, includeContact: true, includeAnswers: true, includeArrangements: true } }));
  assert.equal(exported.status, 200, await exported.clone().text()); assert.equal(exported.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const rows = await readSheet(Buffer.from(await exported.arrayBuffer()), '报名与参会', { trim: false });
  assert.ok(rows.flat().includes(payload().fields.name)); assert.ok(rows.flat().includes(payload().fields.email));
  const contactExport = await f.second.handle(request('/api/admin/contacts/export.xlsx', { method: 'POST', origin: API, headers: owner, body: { expectedRevision: 0 } }));
  assert.equal(contactExport.status, 200, await contactExport.clone().text()); assert.equal(contactExport.headers.get('x-export-count'), '0');
  const withdrawal = await f.second.handle(request('/api/admin/admissions/withdraw', { method: 'POST', origin: API, headers: owner,
    body: { expectedRevision: 2, operationId: randomBytes(32).toString('base64url'), registrationId: receipt.reference_code } }));
  assert.equal(withdrawal.status, 200);
  const after = await f.first.handle(request('/api/admin/registration/confirmation', { method: 'POST', origin: PUBLIC, body: input }));
  assert.equal(after.status, 200); const revoked = await after.json();
  assert.equal(revoked.admission.status, 'withdrawn'); assert.deepEqual(revoked.attendee, { name: '', organization: '' }); assert.equal(revoked.wallet.ready, false); assert.equal(revoked.groupInvite, null);
});

test('runtime backup closes over all confirmation journal revisions and only encrypted current delivery bundles', async () => {
  const objects = memoryObjects();
  const wallet = encodeSigningBundle({ secret: SECRET, eventId: EVENT, config: { APPLE_WALLET_TEAM_ID: 'SYNTHETIC1', APPLE_WALLET_PASS_TYPE_ID: 'pass.example.invalid.synthetic',
    APPLE_WALLET_ORGANIZATION_NAME: '合成组织', APPLE_WALLET_CERT_BASE64: 'U1lOVEhFVElDLUNFUlQ=', APPLE_WALLET_KEY_BASE64: 'U1lOVEhFVElDLVBSSVZBVEUtS0VZ',
    APPLE_WALLET_WWDR_CERT_BASE64: 'U1lOVEhFVElDLVdXRFI=', APPLE_WALLET_ROOT_CERT_BASE64: 'U1lOVEhFVElDLVJPT1Q=' } });
  const mail = encodeConfirmationMailBundle({ secret: SECRET, eventId: EVENT, config: { EMAILJS_SERVICE_ID: 'synthetic-service', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic-confirmation',
    EMAILJS_PUBLIC_KEY: 'SYNTHETIC-PUBLIC', EMAILJS_PRIVATE_KEY: 'SYNTHETIC-PRIVATE-PROVIDER-KEY', EMAIL_FROM_ADDRESS: 'synthetic@artdico.co', EMAIL_FROM_NAME: '合成团队' } });
  const walletKey = walletSigningObjectKey({ eventId: EVENT, bundleId: wallet.bundleId }), mailKey = confirmationMailObjectKey({ eventId: EVENT, bundleId: mail.bundleId });
  await objects.putImmutable(walletKey, wallet.data); await objects.putImmutable(mailKey, mail.data);
  const app = createCloudApplication({ objects, env: { ...ENV, APPLE_WALLET_BUNDLE_ID: wallet.bundleId, ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID: mail.bundleId }, now: () => fixedClock().getTime(),
    fetchFn: () => { throw new Error('No external mail may be sent in this test.'); } });
  const owner = await login(app);
  for (const [expectedRevision, enabled] of [[0, false], [1, true]]) {
    const saved = await app.handle(request('/api/admin/registration-confirmation/settings', { method: 'PUT', origin: API, headers: owner,
      body: { expectedRevision, enabled, operationId: randomBytes(32).toString('base64url') } }));
    assert.equal(saved.status, 200, await saved.clone().text());
  }
  const key = randomBytes(32), response = await app.handle(request('/api/admin/maintenance/backup', { method: 'POST', origin: API, headers: owner,
    body: { encryptionKey: key.toString('base64url'), confirmation: 'CREATE_ENCRYPTED_BACKUP' } }));
  assert.equal(response.status, 200, await response.clone().text());
  const bundle = Buffer.from(await response.arrayBuffer()), inspection = inspectEncryptedObjectBackup({ bundle, key, includeObjects: true });
  const entries = inspection.objects;
  assert.ok(entries.some(item => item.key === walletKey)); assert.ok(entries.some(item => item.key === mailKey));
  assert.equal(entries.filter(item => item.key.startsWith(`cms/v1/registration-confirmations/${EVENT}/blobs/`)).length, 2);
  assert.ok(entries.some(item => item.key === `cms/v1/registration-confirmations/${EVENT}/commits.jsonl`));
  assert.doesNotMatch(JSON.stringify(inspection), /SYNTHETIC-PRIVATE-PROVIDER-KEY|synthetic-registration-token|BEGIN PRIVATE KEY|scrypt\$/u);
  const restored = await app.handle(request('/api/admin/maintenance/restore', { method: 'POST', origin: API, headers: owner,
    body: { encryptionKey: key.toString('base64url'), bundleBase64: bundle.toString('base64'), restoreId: 'synthetic-delivery-restore-01', confirmation: 'RESTORE_TO_ISOLATED_NAMESPACE' } }));
  assert.equal(restored.status, 200, await restored.clone().text()); assert.equal((await restored.json()).active, false);
  assert.equal((await objects.get('cms/v1/restores/synthetic-delivery-restore-01/' + walletKey.slice('cms/v1/'.length))).data.equals(wallet.data), true);
});
