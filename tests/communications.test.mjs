import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';
import { buildWalletPreview, buildAttendanceConfirmationPreview, createPreviewCommunications, getCommunicationsReadiness } from '../functions/content-api/communications.mjs';

const settings = { recipientName: '合成邀请称呼', date: '2026-12-05', time: '10:00-18:00', venue: '合成场地（楼层暂定）', confirmed: false };
const synthetic = {
  id: 'synthetic-contact',
  profile: { contactConsent: 'consented', email: 'synthetic@example.invalid', attendanceIntent: 'expected' },
  operations: { responseStatus: 'pending' },
  invitation: { generatedAt: null, sentAt: null },
};
const ORIGIN = 'http://127.0.0.1:8787';
const PASSWORD = 'synthetic-communications-preview-password';
const passwordHash = await hashPassword(PASSWORD);
const users = [
  { id: 'synthetic-outreach', username: 'outreach', label: '合成联络账号', roles: ['outreach'], passwordHash },
  { id: 'synthetic-editor', username: 'editor', label: '合成编辑账号', roles: ['editor'], passwordHash },
  { id: 'synthetic-publisher', username: 'publisher', label: '合成发布账号', roles: ['publisher'], passwordHash },
];
function request(api, path, { method = 'GET', payload, session, origin = ORIGIN, csrf = session?.csrfToken } = {}) {
  const headers = {};
  if (origin !== null) headers.origin = origin;
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (session) headers.cookie = session.cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  return api(new Request(ORIGIN + path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload) }));
}
async function login(api, username = 'outreach') {
  const response = await request(api, '/api/admin/login', { method: 'POST', payload: { username, password: PASSWORD } });
  assert.equal(response.status, 200);
  return { ...await response.json(), cookie: response.headers.get('set-cookie').split(';')[0] };
}
function fixture(contact = structuredClone(synthetic)) {
  const state = { revision: 1, contacts: [contact] };
  const api = createContentApi({
    store: { read: async () => ({ published: null }) },
    contactsStore: { read: async () => structuredClone(state) },
    users, allowedOrigin: ORIGIN,
  });
  return { api, state, contact };
}
function error(code) { return (value) => value.code === code; }

test('communications readiness never exposes credentials or enables signing and delivery', () => {
  const env = Object.fromEntries([
    'APPLE_WALLET_TEAM_ID', 'APPLE_WALLET_PASS_TYPE_ID', 'APPLE_WALLET_ORGANIZATION_NAME',
    'APPLE_WALLET_CERT_PATH', 'APPLE_WALLET_KEY_PATH', 'APPLE_WALLET_WWDR_CERT_PATH',
    'APPLE_WALLET_KEY_PASSPHRASE', 'EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY',
  ].map((name) => [name, 'synthetic-secret-do-not-return']));
  for (const value of [{}, env]) {
    const result = getCommunicationsReadiness(value);
    assert.equal(result.mode, 'preview');
    assert.equal(result.wallet.ready, false);
    assert.equal(result.email.ready, false);
    assert.equal(JSON.stringify(result).includes('synthetic-secret-do-not-return'), false);
  }
  const adapter = createPreviewCommunications({ env });
  const first = adapter.readiness();
  first.wallet.ready = true;
  assert.equal(adapter.readiness().wallet.ready, false);
  assert.throws(() => adapter.sendEmail(), error('COMMUNICATIONS_PREVIEW_ONLY'));
  assert.throws(() => adapter.issueWalletPass(), error('COMMUNICATIONS_PREVIEW_ONLY'));
  assert.throws(() => createPreviewCommunications({ env: { COMMUNICATIONS_MODE: 'live' } }), /preview/u);
});

test('Wallet invitation is an unsigned data preview and can precede an attendance reply', () => {
  const before = structuredClone(synthetic);
  const result = buildWalletPreview(synthetic, settings);
  assert.equal(result.status, 'unsigned_preview');
  assert.equal(result.mode, 'preview');
  assert.equal(result.name, settings.recipientName);
  assert.equal(result.time, '10:00–18:00');
  assert.equal(result.confirmed, false);
  assert.match(result.notice, /未签名/u);
  assert.match(result.notice, /暂定/u);
  for (const key of ['barcode', 'barcodes', 'qr', 'serialNumber', 'authenticationToken', 'pkpass', 'downloadUrl']) assert.equal(key in result, false);
  assert.deepEqual(synthetic, before);
});

test('both previews require explicit contact consent, a valid contact and valid event settings', () => {
  for (const consent of ['declined', 'unknown', undefined]) {
    const contact = { ...synthetic, profile: { ...synthetic.profile, contactConsent: consent }, operations: { responseStatus: 'attending' } };
    for (const build of [buildWalletPreview, buildAttendanceConfirmationPreview]) assert.throws(() => build(contact, settings), error('CONTACT_NOT_CONSENTED'));
  }
  for (const build of [buildWalletPreview, buildAttendanceConfirmationPreview]) {
    assert.throws(() => build(undefined, settings), error('CONTACT_NOT_FOUND'));
    assert.throws(() => build({ ...synthetic, operations: { responseStatus: 'attending' } }, { ...settings, date: '2026-02-30' }), error('VALIDATION_ERROR'));
  }
});

test('EmailJS confirmation requires an actual attending reply and returns only an unsent preview', () => {
  for (const responseStatus of ['pending', 'declined', undefined]) {
    assert.throws(() => buildAttendanceConfirmationPreview({ ...synthetic, operations: { responseStatus } }, settings), error('ATTENDANCE_NOT_CONFIRMED'));
  }
  const contact = { ...synthetic, operations: { responseStatus: 'attending' } };
  const before = structuredClone(contact);
  const result = buildAttendanceConfirmationPreview(contact, settings);
  assert.equal(result.kind, 'attendance_confirmation');
  assert.equal(result.mode, 'preview');
  assert.equal(result.status, 'not_sent');
  assert.equal(result.toEmail, 'synthetic@example.invalid');
  assert.deepEqual(result.variables, {
    to_name: settings.recipientName, event_title: 'GGJ 中国交流聚会', event_date: settings.date,
    event_time: '10:00–18:00', event_venue: settings.venue, event_status: '活动安排暂定，以筹备团队最终通知为准',
  });
  assert.match(result.text, /暂定/u);
  assert.match(result.text, /不代表讲者、展位/u);
  assert.deepEqual(contact, before);
  for (const email of ['', 'invalid', undefined]) assert.throws(() => buildAttendanceConfirmationPreview({ ...contact, profile: { ...contact.profile, email } }, settings), error('EMAIL_REQUIRED'));
});

test('communications API enforces session, outreach role, Origin and CSRF before rendering private previews', async () => {
  const { api } = fixture();
  const base = '/api/admin/contacts/synthetic-contact/';
  assert.equal((await request(api, '/api/admin/communications')).status, 401);
  assert.equal((await request(api, base + 'wallet/preview', { method: 'POST', payload: { settings } })).status, 401);
  for (const username of ['editor', 'publisher']) {
    const session = await login(api, username);
    assert.equal((await request(api, '/api/admin/communications', { session })).status, 403);
    for (const kind of ['wallet', 'email']) assert.equal((await request(api, base + kind + '/preview', { method: 'POST', session, payload: { settings } })).status, 403);
  }
  const session = await login(api);
  assert.equal((await request(api, base + 'wallet/preview', { method: 'POST', session, csrf: 'wrong', payload: { settings } })).status, 403);
  assert.equal((await request(api, base + 'wallet/preview', { method: 'POST', session, origin: null, payload: { settings } })).status, 403);
  assert.equal((await request(api, base + 'email/preview', { method: 'POST', session, origin: 'https://example.invalid', payload: { settings } })).status, 403);
  const readiness = await request(api, '/api/admin/communications', { session });
  assert.equal(readiness.status, 200);
  assert.equal(readiness.headers.get('cache-control'), 'no-store');
  assert.equal((await readiness.json()).email.ready, false);
});

test('authenticated preview routes do not mutate records and reject missing or nonconsenting contacts', async () => {
  const { api, state, contact } = fixture();
  const session = await login(api);
  const base = '/api/admin/contacts/' + contact.id + '/';
  const before = structuredClone(state);
  const wallet = await request(api, base + 'wallet/preview', { method: 'POST', session, payload: { settings } });
  assert.equal(wallet.status, 200);
  assert.equal((await wallet.json()).status, 'unsigned_preview');
  const pending = await request(api, base + 'email/preview', { method: 'POST', session, payload: { settings } });
  assert.equal(pending.status, 422);
  assert.equal((await pending.json()).error.code, 'ATTENDANCE_NOT_CONFIRMED');
  assert.deepEqual(state, before);
  contact.operations.responseStatus = 'attending';
  const email = await request(api, base + 'email/preview', { method: 'POST', session, payload: { settings } });
  assert.equal(email.status, 200);
  assert.equal(email.headers.get('cache-control'), 'no-store');
  assert.equal((await email.json()).status, 'not_sent');
  assert.equal(state.revision, 1);
  assert.equal(contact.invitation.sentAt, null);
  for (const kind of ['wallet', 'email']) {
    assert.equal((await request(api, '/api/admin/contacts/missing-contact/' + kind + '/preview', { method: 'POST', session, payload: { settings } })).status, 404);
    contact.profile.contactConsent = 'declined';
    const response = await request(api, base + kind + '/preview', { method: 'POST', session, payload: { settings } });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'CONTACT_NOT_CONSENTED');
  }
  assert.equal((await request(api, base + 'email/send', { method: 'POST', session, payload: { settings } })).status, 404);
  assert.equal((await request(api, base + 'wallet/issue', { method: 'POST', session, payload: { settings } })).status, 404);
});
