import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';
import { createConfirmationTokens } from '../functions/registration-confirmation/tokens.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createAppleWalletService } from '../functions/apple-wallet/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { cardCommunityPrefix, createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { collectJournalBackupKeys } from '../functions/registration-admin/maintenance.mjs';
import { createWalletFixture, passFiles } from './apple-wallet-fixture.mjs';
import { confirmationView } from '../src/lib/confirmation-client.mjs';
import { CARD_FORMATS_ACCEPT } from '../shared/confirmation-delivery.mjs';

const root = '/api/admin/registration-confirmation/cards';
const operationId = () => randomBytes(32).toString('base64url');

async function setup({ mailResult = 'accepted', clock } = {}) {
  const f = await peopleRuntimeFixture({ clock, mail: true, mailResult: message => {
    if (!/电子纪念卡/u.test(message.template_params.email_subject)) return 'accepted';
    return typeof mailResult === 'function' ? mailResult() : mailResult;
  } });
  const cardMessages = () => f.messages.filter(message => /电子纪念卡/u.test(message.template_params.email_subject));
  const headers = await f.login();
  const fields = {
    name: '合成电子纪念卡申请人', huodongxingReference: '0000001234', email: 'card-test@example.invalid',
  };
  const id = await f.seedWallet(fields), path = root + '/' + id;
  const call = (method, body, app = f.app) => app.handle(f.request(path, { method, headers, body }));
  const read = async () => {
    const response = await call('GET');
    assert.equal(response.status, 200);
    return response.json();
  };
  const directory = async () => {
    const response = await f.app.handle(f.request(root, { headers }));
    assert.equal(response.status, 200);
    return (await response.json()).applications;
  };
  async function prepare() {
    const before = await read();
    const approval = { primaryId: id, expectedRevision: before.admissionRevision, operationId: operationId() };
    for (let repetition = 0; repetition < 2; repetition++) {
      const response = await f.app.handle(f.request(path + '/approve', { method: 'POST', headers, body: approval }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'confirmed');
    }
    const view = await read();
    const identity = await call('PATCH', { primaryId: id, expectedRevision: view.reviewRevision, identity: 'guest' });
    assert.equal(identity.status, 200);
    const identitySaved = await read();
    assert.equal(identitySaved.identity, 'guest');
    assert.equal(identitySaved.stage, 'send');
    assert.equal(cardMessages().length, 0, 'confirmation and identity do not send a card');
    const latest = await read();
    return { primaryId: id, expectedRevision: latest.deliveryRevision, expectedAccessRevision: latest.accessRevision, identity: latest.identity, format: 'jpeg' };
  }
  return { ...f, cardMessages, fields, headers, id, path, call, read, directory, prepare };
}

test('staff send one commemorative card email and recipients can still save the JPEG when Wallet is unavailable', async () => {
  const f = await setup();
  await f.seedPublic();
  assert.equal((await f.app.handle(f.request(root))).status, 401);
  const editor = await f.login('editor');
  assert.equal((await f.app.handle(f.request(root, { headers: editor }))).status, 403);
  const list = await f.directory();
  const application = { id: f.id, name: f.fields.name, bookingReference: f.fields.huodongxingReference };
  assert.deepEqual(list, [{ ...application, submittedAt: '2026-10-21T09:00:00.000Z', sources: [application],
    status: 'not_sent', stage: 'pending_review', format: null, sentAt: null }]);
  const body = await f.prepare();
  const reviewer = await f.login('reviewer');
  assert.equal((await f.app.handle(f.request(f.path, { method: 'POST', headers: reviewer, body }))).status, 403);
  assert.equal((await f.app.handle(f.request(f.path, { method: 'POST', headers: { Cookie: f.headers.Cookie }, body }))).status, 403);

  const responses = await Promise.all([
    f.call('POST', body),
    f.call('POST', { ...body, format: 'wallet' }, f.make()),
  ]);
  assert.ok(responses.every(item => [200, 409].includes(item.status)));
  assert.equal(f.cardMessages().length, 1);
  const state = await f.read();
  assert.equal(state.status, 'provider_accepted');
  assert.equal(state.format, 'jpeg');
  assert.equal(state.stage, 'submitted');
  const [submitted] = await f.directory();
  assert.equal(submitted.stage, state.stage);
  assert.equal(submitted.sentAt, state.sentAt);
  const template = f.cardMessages()[0].template_params;
  assert.equal(template.to_email, f.fields.email);
  assert.match(template.email_subject, /电子纪念卡/u);
  assert.match(template.confirmation_actions, /领取电子纪念卡/u);
  assert.match(template.invitation_text, /JPEG.*Apple Wallet/u);
  assert.doesNotMatch(template.confirmation_actions, /add-to-apple-wallet|entry-links/u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(template.invitation_text)[1];
  const publicCall = (path, headers) => f.app.handle(f.request(path, { method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken }, headers }));
  const offer = await publicCall('/api/admin/registration/confirmation');
  assert.equal(offer.status, 200);
  const view = confirmationView(await offer.json());
  const { entryQr, ...card } = view.card;
  assert.deepEqual(card, { format: 'jpeg', identity: '嘉宾', ready: true });
  assert.deepEqual([...Buffer.from(entryQr, 'base64').subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const before = f.objects.calls.length;
  const both = confirmationView(await (await publicCall('/api/admin/registration/confirmation', { Accept: CARD_FORMATS_ACCEPT })).json());
  const canonical = confirmationView(await (await publicCall('/api/registration/confirmation')).json());
  assert.deepEqual(canonical, both, 'the canonical route combines formats even if the browser omits the profile');
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'), 'redemption only reads the existing QR');
  assert.deepEqual(both.card, { ...view.card, format: 'both' });
  assert.equal(both.wallet.ready, false);
  assert.equal(view.wallet.ready, false);
  assert.equal((await publicCall('/api/admin/registration/wallet')).status, 503);
  assert.equal((await f.read()).status, 'provider_accepted');
  await f.call('POST', { ...body, format: 'wallet' }, f.make());
  assert.equal(f.cardMessages().length, 1);
});

test('staff can update or clear the optional GGJ role on an already issued card without resending mail', async () => {
  const f = await setup();
  const send = await f.prepare();
  assert.equal((await (await f.call('POST', send)).json()).status, 'provider_accepted');
  const token = /#r=([A-Za-z0-9_.-]+)/u.exec(f.cardMessages()[0].template_params.invitation_text)[1];
  const readCard = async () => {
    const response = await f.app.handle(f.request('/api/registration/confirmation', {
      method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken: token },
    }));
    assert.equal(response.status, 200);
    return confirmationView(await response.json());
  };
  const original = await f.read();
  assert.equal((await readCard()).cardCommunity, undefined);
  const body = { primaryId: f.id, expectedCommunityRevision: original.communityRevision,
    cardCommunity: { site: ' GGJ 合成站 ', role: '站点组织者' } };
  const editor = await f.login('editor');
  assert.equal((await f.app.handle(f.request(f.path, { method: 'PATCH', headers: editor, body }))).status, 403);
  assert.equal((await f.call('PATCH', { ...body, cardCommunity: { ...body.cardCommunity, role: 'a\nb' } })).status, 400);
  const patched = await f.call('PATCH', body);
  assert.equal(patched.status, 200);
  const saved = await patched.json();
  assert.deepEqual(saved.cardCommunity, { site: 'GGJ 合成站', role: '站点组织者' });
  assert.deepEqual((await f.read()).cardCommunity, saved.cardCommunity);
  const latest = await readCard();
  assert.equal(latest.card.identity, '嘉宾');
  assert.deepEqual(latest.cardCommunity, saved.cardCommunity);
  const prefix = cardCommunityPrefix(PEOPLE_FIXTURE_EVENT);
  const backup = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [prefix] });
  assert.ok(backup.includes(prefix + '/commits.jsonl') && backup.some(key => key.startsWith(prefix + '/blobs/')));
  assert.equal((await f.call('PATCH', body, f.make())).status, 409);
  assert.equal((await f.call('PATCH', { ...body, expectedCommunityRevision: saved.communityRevision, cardCommunity: { site: '', role: '' } })).status, 200);
  assert.equal((await readCard()).cardCommunity, undefined);
  assert.equal(f.cardMessages().length, 1);
});

test('an uncertain send can be explicitly resent to the current address, without a second send from stale tabs', async () => {
  let outcome = 'unknown';
  const f = await setup({ mailResult: () => outcome });
  const body = await f.prepare();
  const sent = await f.call('POST', body);
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).status, 'unknown');
  const persisted = await f.read();
  assert.equal(persisted.canResend, true);
  const retried = await f.call('POST', { ...body, expectedRevision: persisted.deliveryRevision, format: 'wallet' }, f.make());
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).status, 'unknown');
  assert.equal(f.cardMessages().length, 1);
  await changeEmail(f);
  const updated = await f.read();
  assert.equal(updated.stage, 'check_delivery');
  assert.equal((await f.directory())[0].stage, 'check_delivery');
  outcome = 'accepted';
  const resend = { ...body, expectedRevision: updated.deliveryRevision, expectedAccessRevision: updated.accessRevision, resend: true };
  const responses = await Promise.all([f.call('POST', resend), f.call('POST', resend, f.make())]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  assert.equal((await responses.find(response => response.ok).json()).status, 'provider_accepted');
  assert.equal(f.cardMessages().length, 2);
  assert.equal(f.cardMessages().at(-1).template_params.to_email, updated.recipient);
  assert.equal((await f.read()).stage, 'submitted');
  assert.equal((await f.directory())[0].stage, 'submitted');
});

test('submitted cards can be explicitly resent with a fresh reservation and respect the existing attempt limit', async () => {
  const f = await setup();
  const body = await f.prepare();
  assert.equal((await (await f.call('POST', body)).json()).status, 'provider_accepted');
  for (let count = 1; count < 5; count++) {
    const state = await f.read();
    assert.equal(state.canResend, true);
    const resend = { ...body, expectedRevision: state.deliveryRevision, resend: true };
    assert.equal((await (await f.call('POST', resend)).json()).status, 'provider_accepted');
    assert.equal((await f.call('POST', resend, f.make())).status, 409);
    assert.equal(f.cardMessages().length, count + 1);
  }
  const state = await f.read();
  assert.equal(state.canResend, false);
  assert.equal(state.reason, 'RETRY_LIMIT');
  assert.equal((await (await f.call('POST', { ...body, expectedRevision: state.deliveryRevision, resend: true })).json()).status, 'not_attempted');
  assert.equal(f.cardMessages().length, 5);
});

test('a recent reservation blocks overlap, while an abandoned reservation can be explicitly recovered', async () => {
  let now = Date.parse('2026-10-21T09:00:00.000Z');
  const clock = () => now;
  const f = await setup({ clock });
  const body = await f.prepare(), state = await f.read();
  const repository = createConfirmationRepository({ cards: true, eventId: PEOPLE_FIXTURE_EVENT, clock,
    journal: createObjectJournal({ objects: f.objects, prefix: 'cms/v1/commemorative-cards/' + PEOPLE_FIXTURE_EVENT }) });
  const original = await repository.append(await repository.read(), 'reserve', {
    registrationId: f.id, kind: 'card_jpeg', admissionStatus: 'confirmed', admissionRevision: state.admissionRevision, retryRejected: true,
  }, f.users[0].id);
  const resend = { ...body, expectedRevision: original.value.revision, resend: true };
  assert.equal((await f.read()).sendInProgress, true);
  assert.equal((await f.read()).canResend, false);
  assert.equal((await (await f.call('POST', resend)).json()).status, 'not_attempted');
  assert.equal(f.cardMessages().length, 0);
  now += 60_000;
  assert.equal((await f.read()).canResend, true);
  assert.equal((await (await f.call('POST', resend)).json()).status, 'provider_accepted');
  assert.equal(f.cardMessages().length, 1);
  const saved = await repository.read();
  assert.equal(saved.value.notices[0].attempt, 2);
  assert.deepEqual(saved.value.audit.map(item => item.action), ['reserve', 'card_resend', 'result']);
});

async function changeEmail(f) {
  const detail = await f.app.reviewStore.detail(f.id);
  const fields = Object.fromEntries(['name', 'email', 'organization', 'position', 'city', 'wechat', 'phone']
    .map(key => [key, key === 'email' ? 'corrected-card@example.invalid' : detail.registration.fields[key] ?? '']));
  await f.app.reviewStore.saveProfile(f.id, detail.revision, operationId(), fields, f.users[0].id);
}

test('the queue groups explicitly related applications and ignores delivery to a previous address', async () => {
  const f = await setup();
  const body = await f.prepare();
  const sameAddress = await f.seedWallet({ name: f.fields.name, huodongxingReference: '0000004321' });
  assert.equal((await f.directory()).length, 2, 'a shared address does not establish identity');
  const keys = [f.id, sameAddress].map(id => 'registration:' + id);
  const resolve = body => f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers: f.headers, body }));
  const response = await resolve({ action: 'preview', keys });
  assert.equal(response.status, 200);
  const preview = await response.json();
  const merged = await resolve({ action: 'merge', keys: preview.keys, primaryKey: 'registration:' + f.id, roles: preview.roles,
    expectedRevision: preview.expectedRevision, expectedContactRevision: preview.expectedContactRevision, operationId: operationId(), confirmSamePerson: true });
  assert.equal(merged.status, 200);
  const before = f.objects.calls.length;
  const grouped = await f.directory();
  assert.equal(grouped.length, 1);
  assert.deepEqual(new Set(grouped[0].sources.map(item => item.bookingReference)), new Set(['0000004321', '0000001234']));
  assert.equal(grouped[0].stage, 'send');
  assert.doesNotMatch(JSON.stringify(grouped), /@example\.invalid|card_test_synthetic/u);
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
  assert.equal((await (await f.call('POST', body)).json()).status, 'provider_accepted');
  await changeEmail(f);
  assert.equal((await f.read()).stage, 'send');
  assert.equal((await f.directory())[0].stage, 'send');
  assert.equal(f.cardMessages().length, 1);
  const alias = await f.app.handle(f.request(root + '/' + sameAddress, { headers: f.headers }));
  assert.equal(alias.status, 200);
  assert.equal((await alias.json()).bookingReference, '0000004321');
});

test('a card capability authenticates its selected format while existing receipts keep their shape', () => {
  const now = Date.parse('2026-11-19T00:00:00Z');
  const tokens = createConfirmationTokens({ tokenSecret: 'synthetic-test-token-purpose-secret-001', eventId: PEOPLE_FIXTURE_EVENT,
    clock: () => now, expiresAt: now + 86400000 });
  const id = operationId();
  const normal = tokens.issue(id, 2), card = tokens.issue(id, 2, 'wallet');
  assert.equal(tokens.verify(normal.receiptToken).cardFormat, undefined);
  assert.equal(tokens.verify(card.receiptToken).cardFormat, 'wallet');
  const [version, payload, signature] = card.receiptToken.split('.');
  const changed = JSON.parse(Buffer.from(payload, 'base64url').toString());
  const alternative = Buffer.from(JSON.stringify({ ...changed, cardFormat: 'jpeg' })).toString('base64url');
  assert.equal(tokens.verify([version, alternative, signature].join('.')), null);
});

test('an existing Wallet link and a JPEG link both redeem the same two formats and saved identity', async t => {
  const f = await setup(), body = await f.prepare();
  const signing = await createWalletFixture();
  t.after(signing.cleanup);
  const messages = [], tokenSecret = 'synthetic-wallet-card-signing-test-token-secret';
  const expiresAt = Date.parse('2027-01-01T00:00:00Z');
  const service = createRegistrationConfirmationService({ registrationService: f.app.registrationService, tokenSecret,
    clock: () => Date.parse('2026-10-21T09:00:00Z'), expiresAt,
    journalFor: prefix => createObjectJournal({ objects: f.objects, prefix }),
    currentRegistration: record => f.app.reviewStore.projectRegistration(record),
    walletReadiness: () => wallet.readiness(),
    cardEntry: { image: input => f.app.entryService.cardEntryImage(input), prepare: input => f.app.entryService.issueEntry(input) },
    emailProvider: { readiness: () => ({ ready: true }), send: async message => { messages.push(message); return { status: 'provider_accepted' }; } },
  });
  const wallet = createAppleWalletService({ env: signing.env, tokenSecret, clock: () => signing.now,
    trustedRootFingerprints: signing.fields.trustedRootFingerprints, authorize: service.authorize, authorizedRegistration: service.authorizedRegistration });
  const result = await service.staffSendCard({ ...body, actor: f.users[0], registrationId: f.id, format: 'wallet' });
  assert.equal(result.status, 'provider_accepted');
  assert.equal(messages.length, 1);
  assert.match(messages[0].templateVariables.confirmation_actions, /领取电子纪念卡/u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(messages[0].text)[1];
  assert.deepEqual(confirmationView(await service.confirmation({ receiptToken })).card, { format: 'wallet', identity: '嘉宾', ready: true });
  const first = confirmationView(await service.confirmation({ receiptToken, includeCardFormats: true }));
  assert.equal(first.card.format, 'both');
  assert.equal(first.card.ready, true);
  assert.equal(first.wallet.ready, true);
  assert.ok(first.card.entryQr);
  const tokens = createConfirmationTokens({ tokenSecret, eventId: PEOPLE_FIXTURE_EVENT, clock: () => Date.parse('2026-10-21T09:00:00Z'),
    expiresAt });
  for (const token of [receiptToken, tokens.issue(f.id, 0, 'jpeg').receiptToken]) {
    const view = confirmationView(await service.confirmation({ receiptToken: token, includeCardFormats: true }));
    assert.deepEqual(view.card, first.card);
    assert.equal(view.wallet.ready, true);
    const pass = await wallet.download({ receiptToken: token });
    assert.equal(pass.outcome, 'issued');
    const files = passFiles(pass.data);
    assert.ok(files.get('signature').length > 1024);
    assert.match(files.get('pass.json').toString(), /嘉宾/u);
  }
});
