import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';
import { createConfirmationTokens } from '../functions/registration-confirmation/tokens.mjs';
import { createRegistrationConfirmationService } from '../functions/registration-confirmation/service.mjs';
import { createAppleWalletService } from '../functions/apple-wallet/service.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { cardCollectorPrefix, cardCommunityPrefix, cardManagementPrefix, createConfirmationRepository } from '../functions/registration-confirmation/repository.mjs';
import { collectJournalBackupKeys } from '../functions/registration-admin/maintenance.mjs';
import { createWalletFixture, passFiles } from './apple-wallet-fixture.mjs';
import { confirmationView } from '../src/lib/confirmation-client.mjs';
import { CARD_COLLECTOR_ACCEPT, CARD_FORMATS_ACCEPT } from '../shared/confirmation-delivery.mjs';
import { cardIdentityHeadline } from '../shared/general-application.mjs';

const root = '/api/admin/registration-confirmation/cards';
const operationId = () => randomBytes(32).toString('base64url');

async function setup({ mailResult = 'accepted', clock, preferences = {} } = {}) {
  const isCardEmail = message => /电子纪念卡|Your commemorative card/u.test(message.template_params.email_subject);
  const f = await peopleRuntimeFixture({ clock, mail: true, mailResult: message => {
    if (!isCardEmail(message)) return 'accepted';
    return typeof mailResult === 'function' ? mailResult() : mailResult;
  } });
  const cardMessages = () => f.messages.filter(isCardEmail);
  const headers = await f.login();
  const fields = {
    name: '合成电子纪念卡申请人', huodongxingReference: '0000001234', email: 'card-test@example.invalid',
  };
  const id = await f.seedWallet({ ...fields, ...preferences }), path = root + '/' + id;
  assert.equal(f.messages.length, 0, 'new commemorative card applications never send general receipt mail');
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
  async function prepare(selectedIdentity = 'guest') {
    const before = await read();
    const approval = { primaryId: id, expectedRevision: before.admissionRevision, operationId: operationId() };
    for (let repetition = 0; repetition < 2; repetition++) {
      const response = await f.app.handle(f.request(path + '/approve', { method: 'POST', headers, body: approval }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'confirmed');
    }
    const view = await read();
    const identity = await call('PATCH', { primaryId: id, expectedRevision: view.reviewRevision, identity: selectedIdentity });
    assert.equal(identity.status, 200);
    const identitySaved = await read();
    assert.equal(identitySaved.identity, selectedIdentity);
    assert.equal(identitySaved.stage, 'send');
    assert.equal(cardMessages().length, 0, 'confirmation and identity do not send a card');
    const latest = await read();
    return { primaryId: id, expectedRevision: latest.deliveryRevision, expectedAccessRevision: latest.accessRevision, identity: latest.identity, format: 'jpeg' };
  }
  return { ...f, cardMessages, fields, headers, id, path, call, read, directory, prepare };
}

const collectorPath = '/api/registration/confirmation';
function recipientCard(f, receiptToken, options = {}) {
  const { app = f.app, claimCard, path = collectorPath, origin = PEOPLE_FIXTURE_PUBLIC } = options;
  return app.handle(f.request(path, { method: 'POST', origin, headers: { Accept: CARD_COLLECTOR_ACCEPT },
    body: { receiptToken, ...(claimCard === undefined ? {} : { claimCard }) } }));
}
async function sendCollectorFixture(f, id) {
  const path = root + '/' + id;
  const call = (method, body, suffix = '') => f.app.handle(f.request(path + suffix, { method, body, headers: f.headers }));
  let view = await (await call('GET')).json();
  if (view.admissionStatus === 'pending_review') {
    assert.equal((await call('POST', { primaryId: id, expectedRevision: view.admissionRevision, operationId: operationId() }, '/approve')).status, 200);
    view = await (await call('GET')).json();
  }
  if (!view.identity) {
    assert.equal((await call('PATCH', { primaryId: id, expectedRevision: view.reviewRevision, identity: 'guest' })).status, 200);
    view = await (await call('GET')).json();
  }
  const sent = await call('POST', { primaryId: id, expectedRevision: view.deliveryRevision,
    expectedAccessRevision: view.accessRevision, identity: view.identity, format: 'jpeg' });
  assert.equal(sent.status, 200);
  assert.equal((await sent.json()).status, 'provider_accepted');
  const mail = f.cardMessages().at(-1).template_params;
  return /#r=([A-Za-z0-9_.-]+)/u.exec(mail.confirmation_actions)[1];
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
    status: 'not_sent', stage: 'pending_review', format: null, sentAt: null, collectorNumber: null }]);
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
  assert.equal(template.event_title, '电子纪念卡');
  assert.equal(template.invitation_text, '纪念卡供长期收藏。现场签到请使用活动行原电子票。');
  assert.match(template.confirmation_actions, /打开电子纪念卡/u);
  assert.ok(template.confirmation_actions.includes('/wallet/host-card-banner.png'));
  assert.ok(template.confirmation_actions.includes(f.fields.name));
  assert.doesNotMatch(template.confirmation_actions, /下载 JPEG|add-to-apple-wallet|entry-links/u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(template.confirmation_actions)[1];
  const publicCall = (path, headers) => f.app.handle(f.request(path, { method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken }, headers }));
  const offer = await publicCall('/api/admin/registration/confirmation');
  assert.equal(offer.status, 200);
  const view = confirmationView(await offer.json());
  assert.deepEqual(view.card, { format: 'jpeg', identity: '嘉宾', ready: true });
  const before = f.objects.calls.length;
  const both = confirmationView(await (await publicCall('/api/admin/registration/confirmation', { Accept: CARD_FORMATS_ACCEPT })).json());
  const canonical = confirmationView(await (await publicCall('/api/registration/confirmation')).json());
  const numbered = confirmationView(await (await publicCall('/api/registration/confirmation', { Accept: CARD_COLLECTOR_ACCEPT })).json());
  assert.deepEqual(canonical, both, 'the canonical route combines formats even if the browser omits the profile');
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'), 'redemption does not write entry credentials');
  assert.deepEqual(both.card, { ...view.card, format: 'both' });
  assert.deepEqual(numbered.card, { ...both.card, collectorNumber: null });
  assert.equal(both.wallet.ready, false);
  assert.equal(view.wallet.ready, false);
  assert.equal((await publicCall('/api/admin/registration/wallet')).status, 503);
  assert.equal((await f.read()).status, 'provider_accepted');
  await f.call('POST', { ...body, format: 'wallet' }, f.make());
  assert.equal(f.cardMessages().length, 1);
});

test('only the explicit private claim assigns one durable order across retries, lost acknowledgements and concurrent recipients', async () => {
  const f = await setup();
  const two = await f.seedWallet({ huodongxingReference: '214' });
  const three = await f.seedWallet({ huodongxingReference: '307' });
  const four = await f.seedWallet({ huodongxingReference: '498' });
  const first = await sendCollectorFixture(f, f.id), second = await sendCollectorFixture(f, two), third = await sendCollectorFixture(f, three);
  const fourth = await sendCollectorFixture(f, four);
  const prefix = cardCollectorPrefix(PEOPLE_FIXTURE_EVENT);
  const before = f.objects.calls.length;
  const unclaimed = await recipientCard(f, first);
  assert.equal(unclaimed.status, 200);
  assert.equal((await unclaimed.json()).card.collectorNumber, null);
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
  assert.ok(!f.objects.files.has(prefix + '/commits.jsonl'));
  const beforeInvalid = f.objects.calls.length;
  assert.equal((await recipientCard(f, 'invalid', { claimCard: true })).status, 404);
  assert.equal((await recipientCard(f, first, { claimCard: false })).status, 400);
  assert.equal((await recipientCard(f, first, { claimCard: true, path: '/api/admin/registration/confirmation' })).status, 400);
  assert.equal((await recipientCard(f, first, { claimCard: true, origin: 'https://untrusted.example' })).status, 403);
  assert.equal(f.objects.calls.length, beforeInvalid);

  let lost = false;
  const lostApp = f.make({ objects: { ...f.objects, append: async (...args) => {
    const written = await f.objects.append(...args);
    if (!lost && args[0] === prefix + '/commits.jsonl') {
      lost = true;
      throw new Error('Synthetic lost collector append acknowledgement');
    }
    return written;
  } } });
  const recovered = await recipientCard(f, first, { claimCard: true, app: lostApp });
  assert.equal(recovered.status, 200);
  assert.equal(lost, true);
  const oneView = await recovered.json();
  assert.deepEqual(oneView.card.collectorNumber, { sequence: 1, test: false });
  const responses = await Promise.all([
    recipientCard(f, second, { claimCard: true, app: f.make() }),
    recipientCard(f, third, { claimCard: true, app: f.make() }),
    recipientCard(f, second, { claimCard: true, app: f.make() }),
  ]);
  for (const response of responses) assert.equal(response.status, 200);
  const [twoView, threeView, duplicateView] = await Promise.all(responses.map(response => response.json()));
  assert.deepEqual(twoView.card.collectorNumber, duplicateView.card.collectorNumber);
  assert.deepEqual([twoView.card.collectorNumber.sequence, threeView.card.collectorNumber.sequence].sort(), [2, 3]);
  assert.equal(oneView.card.collectorNumber.claimedAt, undefined);
  assert.equal(f.cardMessages().length, 4);
  const saved = await f.read();
  assert.equal(saved.collector.sequence, oneView.card.collectorNumber.sequence);
  assert.equal(saved.collector.claimedAt, '2026-10-21T09:00:00.000Z');
  const repeatOffset = f.objects.calls.length;
  assert.deepEqual((await (await recipientCard(f, first, { claimCard: true })).json()).card.collectorNumber, oneView.card.collectorNumber);
  assert.ok(f.objects.calls.slice(repeatOffset).every(call => call.operation === 'get'));
  assert.deepEqual((await f.app.confirmationService.authorize({ receiptToken: first })).cardCollectorNumber, oneView.card.collectorNumber);
  assert.deepEqual((await f.app.confirmationService.authorizedRegistration(f.id, { includeCardCommunity: true })).cardCollectorNumber, oneView.card.collectorNumber);
  assert.equal((await f.call('DELETE', { primaryId: f.id })).status, 200);
  assert.equal((await recipientCard(f, first, { claimCard: true })).status, 404);
  assert.deepEqual((await (await recipientCard(f, fourth, { claimCard: true })).json()).card.collectorNumber, { sequence: 4, test: false });
  const backup = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [prefix] });
  assert.ok(backup.includes(prefix + '/commits.jsonl') && backup.some(key => key.startsWith(prefix + '/blobs/')));
});

test('staff can reserve and clear a custom number while official and test claims retain their own original order', async () => {
  const f = await setup();
  const another = await f.seedWallet({ huodongxingReference: '6789' });
  const added = await f.app.handle(f.request(root, { method: 'POST', headers: f.headers, body: {
    name: '合成编号测试', email: 'collector-test@example.invalid', identity: 'guest', operationId: operationId(),
  } }));
  assert.equal(added.status, 200);
  const testId = (await added.json()).registrationId;
  const get = async id => (await f.app.handle(f.request(root + '/' + id, { headers: f.headers }))).json();
  const edit = (id, manualSequence, expectedCollectorRevision, headers = f.headers) => f.app.handle(f.request(root + '/' + id, {
    method: 'PATCH', headers, body: { primaryId: id, manualSequence, expectedCollectorRevision },
  }));
  const initial = await f.read();
  assert.deepEqual(initial.collector, { sequence: null, claimedAt: null, manualSequence: null, revision: 0, number: null });
  assert.equal(initial.canEditCollector, true);
  assert.equal((await edit(f.id, 42, 0, await f.login('reviewer'))).status, 403);
  assert.equal((await edit(f.id, 42, 0, { Cookie: f.headers.Cookie })).status, 403);
  assert.equal((await edit(f.id, 1_000_000, 0)).status, 400);
  const reserved = await edit(f.id, 42, 0);
  assert.equal(reserved.status, 200);
  assert.deepEqual((await reserved.json()).collector, { ...initial.collector, manualSequence: 42, revision: 1,
    number: { sequence: 42, test: false, manual: true } });
  assert.equal((await edit(another, 42, 0)).status, 409);
  const duplicate = await edit(another, 42, (await get(another)).collector.revision);
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, 'CARD_NUMBER_TAKEN');
  const testLink = await sendCollectorFixture(f, testId);
  assert.deepEqual((await (await recipientCard(f, testLink, { claimCard: true })).json()).card.collectorNumber, { sequence: 1, test: true });
  const official = await sendCollectorFixture(f, f.id);
  assert.deepEqual((await f.read()).preview.card.collectorNumber, { sequence: 42, test: false, manual: true });
  assert.equal((await (await recipientCard(f, official)).json()).card.collectorNumber, null);
  const claim = await recipientCard(f, official, { claimCard: true });
  assert.equal(claim.status, 200);
  assert.deepEqual((await claim.json()).card.collectorNumber, { sequence: 42, test: false, manual: true });
  const claimed = (await f.read()).collector;
  assert.equal(claimed.sequence, 1);
  const cleared = await edit(f.id, null, claimed.revision);
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).collector, { ...claimed, manualSequence: null, revision: claimed.revision + 1, number: { sequence: 1, test: false } });
  assert.deepEqual((await (await recipientCard(f, official)).json()).card.collectorNumber, { sequence: 1, test: false });
  assert.deepEqual((await f.directory()).find(row => row.id === f.id).collectorNumber, { sequence: 1, test: false });
  assert.equal((await edit(another, 42, (await get(another)).collector.revision)).status, 409, 'a cleared special number stays reserved');
  const ledger = await createObjectJournal({ objects: f.objects, prefix: cardCollectorPrefix(PEOPLE_FIXTURE_EVENT) }).read();
  assert.equal(ledger.value.official.manual[f.id].actorId, f.users[0].id);
  assert.equal(ledger.value.official.manual[f.id].updatedAt, '2026-10-21T09:00:00.000Z');
  assert.equal(f.cardMessages().length, 2);
});

test('a removal observed before allocation stops the claim and a concurrent durable claim stays hidden after removal', async () => {
  const f = await setup();
  const secondId = await f.seedWallet({ huodongxingReference: '202' });
  const lastId = await f.seedWallet({ huodongxingReference: '303' });
  const before = await sendCollectorFixture(f, f.id), during = await sendCollectorFixture(f, secondId), after = await sendCollectorFixture(f, lastId);
  const key = cardCollectorPrefix(PEOPLE_FIXTURE_EVENT) + '/commits.jsonl';
  async function remove(id) {
    const response = await f.app.handle(f.request(root + '/' + id, { method: 'DELETE', headers: f.headers, body: { primaryId: id } }));
    assert.equal(response.status, 200);
  }
  const removedBeforeWrite = f.make({ objects: { ...f.objects, get: async (name, options) => {
    if (name === key) await remove(f.id);
    return f.objects.get(name, options);
  } } });
  assert.equal((await recipientCard(f, before, { claimCard: true, app: removedBeforeWrite })).status, 404);
  assert.equal(f.objects.files.has(key), false);
  const removedDuringWrite = f.make({ objects: { ...f.objects, append: async (...args) => {
    const saved = await f.objects.append(...args);
    if (args[0] === key) await remove(secondId);
    return saved;
  } } });
  assert.equal((await recipientCard(f, during, { claimCard: true, app: removedDuringWrite })).status, 404);
  assert.equal((await recipientCard(f, during)).status, 404);
  assert.deepEqual((await (await recipientCard(f, after, { claimCard: true })).json()).card.collectorNumber, { sequence: 2, test: false });
});

test('an issued card displays its application site and discipline until staff replace or clear them', async t => {
  const f = await setup({ preferences: { locale: 'en', ggjSite: 'Ggj Artdico', ggjRole: '站点组织者・程序' } });
  const send = await f.prepare('organizer');
  const initial = await f.read();
  assert.equal(initial.cardCommunitySaved, false);
  assert.deepEqual(initial.cardCommunity, { site: 'Ggj Artdico', role: '站点组织者・程序' });
  assert.equal((await (await f.call('POST', send)).json()).status, 'provider_accepted');
  const email = f.cardMessages()[0].template_params.confirmation_actions;
  assert.match(email, /GGJ ARTDICO/u);
  assert.match(email, /Site Organizer · Programming/u);
  assert.doesNotMatch(email, /站点组织者・程序/u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(email)[1];
  const service = f.app.confirmationService;
  const readCard = async () => confirmationView(await (await f.app.handle(f.request('/api/registration/confirmation', {
    method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken },
  }))).json());
  const signing = await createWalletFixture();
  t.after(signing.cleanup);
  const wallet = createAppleWalletService({ env: signing.env, tokenSecret: 'synthetic-card-community-signing-secret',
    clock: () => signing.now, trustedRootFingerprints: signing.fields.trustedRootFingerprints,
    authorize: service.authorize, authorizedRegistration: service.authorizedRegistration });
  const readPass = async () => {
    const issued = await wallet.download({ receiptToken });
    assert.equal(issued.outcome, 'issued');
    return JSON.parse(passFiles(issued.data).get('pass.json'));
  };
  const firstPass = await readPass();
  assert.deepEqual(firstPass.posterGeneric.primaryFields.slice(0, 2), [
    { key: 'poster-site', value: 'GGJ ARTDICO' },
    { key: 'poster-identity', value: 'Site Organizer · Programming' },
  ]);
  assert.equal(firstPass.eventTicket.auxiliaryFields.find(field => field.key === 'ggj-site-short').value, 'GGJ ARTDICO');
  assert.equal(firstPass.posterGeneric.additionalInfoFields.find(field => field.key === 'poster-info-ggj-site').value, 'GGJ ARTDICO');
  const firstCard = await readCard();
  assert.equal(firstCard.cardLocale, 'en');
  assert.deepEqual(firstCard.cardCommunity, initial.cardCommunity);
  assert.deepEqual(firstPass.posterGeneric.backFields.find(field => field.key === 'poster-details-details-identity'),
    { key: 'poster-details-details-identity', label: 'Role at This Event', value: 'GGJ Organizer' });
  const revised = { site: 'GGJ 复核站', role: '美术' };
  const saveCommunity = (revision, cardCommunity) => f.call('PATCH', {
    primaryId: f.id, expectedCommunityRevision: revision, cardCommunity,
  });
  const update = await saveCommunity(initial.communityRevision, revised);
  assert.equal(update.status, 200);
  const pass = await readPass();
  assert.equal(pass.serialNumber, firstPass.serialNumber);
  assert.deepEqual(pass.posterGeneric.primaryFields.slice(0, 2), [
    { key: 'poster-site', value: 'GGJ 复核站' },
    { key: 'poster-identity', value: 'Organizer · Art' },
  ]);
  assert.deepEqual((await readCard()).cardCommunity, revised);
  assert.equal((await saveCommunity((await update.json()).communityRevision, { site: '', role: '' })).status, 200);
  assert.equal((await readCard()).cardCommunity, undefined);
  assert.deepEqual((await readPass()).posterGeneric.primaryFields[0], { key: 'poster-identity', value: 'GGJ Organizer' });
  assert.equal(f.cardMessages().length, 1);
});

test('staff preview the saved card and must reload after a change before sending', async () => {
  const f = await setup({ preferences: { locale: 'en', ggjSite: 'GGJ ARTDICO', ggjRole: 'Jammer' } });
  const pending = await f.read();
  assert.equal(pending.preview, null);
  assert.equal(pending.previewProof, null);
  assert.equal(pending.deliveryReceiptId, null);
  assert.equal(pending.deliveryAttempt, null);
  const send = await f.prepare('organizer');
  const before = f.objects.calls.length;
  const initial = await f.read();
  assert.ok(f.objects.calls.slice(before).every(call => call.operation === 'get'));
  assert.match(initial.previewProof, /^[a-f0-9]{64}$/u);
  assert.deepEqual(initial.preview.attendee, { name: f.fields.name });
  assert.deepEqual(initial.preview.cardCommunity, { site: 'GGJ ARTDICO', role: 'Jammer' });
  assert.equal(initial.preview.cardLocale, 'en');
  assert.equal(initial.preview.cardProfile, undefined);
  assert.equal(initial.preview.receiptToken, undefined);
  const cardCommunity = { site: 'GGJ ARTDICO', role: 'Mentor' };
  const cardProfile = { organization: '合成院校', phone: '+86 010 0000 0000' };
  assert.equal((await f.call('PATCH', { primaryId: f.id, expectedCommunityRevision: initial.communityRevision,
    cardCommunity, cardProfile })).status, 200);
  assert.equal((await f.call('POST', { ...send, expectedPreviewProof: initial.previewProof })).status, 409);
  assert.equal(f.cardMessages().length, 0);
  const updated = await f.read();
  assert.equal(updated.deliveryRevision, initial.deliveryRevision);
  assert.notEqual(updated.previewProof, initial.previewProof);
  const checkedSend = { ...send, expectedPreviewProof: updated.previewProof };
  assert.equal((await (await f.call('POST', checkedSend)).json()).status, 'provider_accepted');
  const first = await f.read();
  assert.match(first.deliveryReceiptId, /^c_[a-f0-9]{64}$/u);
  assert.equal(first.deliveryAttempt, 1);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(f.cardMessages()[0].template_params.confirmation_actions)[1];
  const claim = confirmationView(await (await f.app.handle(f.request('/api/registration/confirmation', {
    method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken },
  }))).json());
  const { title, date, time, venue, timezone } = claim.event;
  assert.deepEqual(updated.preview, { attendee: { name: claim.attendee.name }, event: { title, date, time, venue, timezone },
    card: { identity: claim.card.identity }, cardCommunity: claim.cardCommunity, cardProfile: claim.cardProfile, cardLocale: claim.cardLocale });
  assert.equal((await (await f.call('POST', { ...checkedSend, expectedRevision: first.deliveryRevision, resend: true })).json()).status, 'provider_accepted');
  const second = await f.read();
  assert.equal(second.sentAt, first.sentAt, 'the synthetic sends share a timestamp');
  assert.equal(second.deliveryReceiptId, first.deliveryReceiptId);
  assert.equal(second.deliveryAttempt, 2);
});

test('card profile changes between preview and transport prevent delivery', async () => {
  const f = await setup();
  const send = await f.prepare();
  const initial = await f.read();
  let transportChecks = 0;
  const service = createRegistrationConfirmationService({ registrationService: f.app.registrationService,
    tokenSecret: 'synthetic-card-preview-test-secret', clock: () => Date.parse('2026-10-21T09:00:00Z'),
    journalFor: prefix => createObjectJournal({ objects: f.objects, prefix }),
    currentRegistration: record => f.app.reviewStore.projectRegistration(record),
    emailProvider: { readiness: () => ({ ready: true }), send: async ({ canStart }) => {
      transportChecks++;
      assert.equal((await f.call('PATCH', { primaryId: f.id, expectedCommunityRevision: initial.communityRevision,
        cardCommunity: { site: 'GGJ ARTDICO', role: 'Mentor' } })).status, 200);
      assert.equal(await canStart(), false);
      return { status: 'rejected', diagnostic: { code: 'DELIVERY_GUARD_BLOCKED', transportStarted: false } };
    } },
  });
  const result = await service.staffSendCard({ ...send, actor: f.users[0], registrationId: f.id, expectedPreviewProof: initial.previewProof });
  assert.equal(transportChecks, 1);
  assert.equal(result.status, 'rejected');
  const updated = await f.read();
  assert.equal(updated.status, 'rejected');
  assert.notEqual(updated.previewProof, initial.previewProof);
  assert.equal(f.cardMessages().length, 0);
});

test('card headlines prioritize GGJ involvement and keep free text and event-only roles meaningful in both languages', () => {
  const supported = { site: 'GGJ São Paulo', role: '導師・評審・社群夥伴' };
  assert.deepEqual(cardIdentityHeadline('嘉宾', supported, 'en'),
    { site: 'GGJ São Paulo', label: 'GGJ São Paulo', identity: 'Mentor · Juror · Community Partner' });
  assert.deepEqual(cardIdentityHeadline('嘉宾', { site: '', role: 'Volunteer・Audio outreach, 2024' }),
    { site: '', label: 'GGJ 参与经历', identity: '志愿者 · Audio outreach, 2024' });
  assert.deepEqual(cardIdentityHeadline('志愿者', { site: 'Ggj Artdico', role: '' }, 'en'),
    { site: 'GGJ ARTDICO', label: 'GGJ ARTDICO', identity: 'Event Volunteer' });
  assert.deepEqual(cardIdentityHeadline('GGJ 组织者', { site: 'GGJ China Community', role: 'Regional Organizer' }, 'en'),
    { site: 'GGJ China Community', label: 'GGJ China Community', identity: 'Regional Organizer' });
  assert.equal(cardIdentityHeadline('嘉宾', { site: '', role: '参与者' }, 'en').identity, 'Participant');
  assert.deepEqual(cardIdentityHeadline('一般来宾', undefined, 'en'),
    { site: '', label: '', identity: 'Attendee' });
});

test('staff can update or clear optional card details on an already issued card without resending mail', async () => {
  const f = await setup();
  const send = await f.prepare();
  assert.equal((await (await f.call('POST', send)).json()).status, 'provider_accepted');
  const token = /#r=([A-Za-z0-9_.-]+)/u.exec(f.cardMessages()[0].template_params.confirmation_actions)[1];
  const readCard = async () => {
    const response = await f.app.handle(f.request('/api/registration/confirmation', {
      method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken: token },
    }));
    assert.equal(response.status, 200);
    return confirmationView(await response.json());
  };
  const original = await f.read();
  assert.equal((await readCard()).cardCommunity, undefined);
  assert.equal((await readCard()).cardProfile, undefined);
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
  const cardProfile = { organization: '合成院校', phone: '+86 010 0000 0000' };
  const update = { ...body, expectedCommunityRevision: saved.communityRevision, cardProfile };
  assert.equal((await f.call('PATCH', { ...update, cardProfile: { ...cardProfile, email: 'not-a-card-field@example.invalid' } })).status, 400);
  const withProfile = await (await f.call('PATCH', update)).json();
  assert.deepEqual(withProfile.cardProfile, cardProfile);
  assert.deepEqual((await readCard()).cardProfile, cardProfile);
  const prefix = cardCommunityPrefix(PEOPLE_FIXTURE_EVENT);
  const backup = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [prefix] });
  assert.ok(backup.includes(prefix + '/commits.jsonl') && backup.some(key => key.startsWith(prefix + '/blobs/')));
  assert.equal((await f.call('PATCH', body, f.make())).status, 409);
  assert.equal((await f.call('PATCH', { ...body, expectedCommunityRevision: withProfile.communityRevision, cardCommunity: { site: '', role: '' } })).status, 200);
  assert.equal((await readCard()).cardCommunity, undefined);
  assert.deepEqual((await readCard()).cardProfile, cardProfile, 'an older client preserves saved personal details');
  const cleared = await f.read();
  assert.equal((await f.call('PATCH', { ...body, expectedCommunityRevision: cleared.communityRevision, cardProfile: { organization: '', phone: '' } })).status, 200);
  assert.equal((await readCard()).cardProfile, undefined);
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

test('explicit card resends stay available past five attempts, including after an uncertain result', async () => {
  let outcome = 'accepted';
  const f = await setup({ mailResult: () => outcome });
  const body = await f.prepare();
  assert.equal((await (await f.call('POST', body)).json()).status, 'provider_accepted');
  for (let count = 1; count < 7; count++) {
    const state = await f.read();
    assert.equal(state.canResend, true);
    const resend = { ...body, expectedRevision: state.deliveryRevision, resend: true };
    outcome = count === 4 ? 'unknown' : 'accepted';
    assert.equal((await (await f.call('POST', resend)).json()).status, outcome === 'unknown' ? 'unknown' : 'provider_accepted');
    assert.equal((await f.call('POST', resend, f.make())).status, 409);
    assert.equal(f.cardMessages().length, count + 1);
  }
  const state = await f.read();
  assert.equal(state.canResend, true);
  assert.equal(state.reason, '');
});

test('staff can add, send and remove a test card independently of formal registrations', async t => {
  const f = await setup();
  const snapshot = await f.app.registrationService.repository.readIndex();
  const reviewer = await f.login('reviewer');
  const body = { name: ' 测试卡合成姓名 ', email: 'test-recipient@example.invalid', identity: 'organizer', operationId: operationId() };
  const add = (fields, headers = f.headers, app = f.app) => app.handle(f.request(root, { method: 'POST', body: fields, headers }));
  assert.equal((await add(body, reviewer)).status, 403);
  assert.equal((await add(body, { Cookie: f.headers.Cookie })).status, 403);
  assert.equal((await add({ ...body, email: 'a@example.invalid\r\nb@example.invalid' })).status, 400);
  const created = await add(body);
  assert.equal(created.status, 200);
  const { registrationId } = await created.json();
  assert.deepEqual(await (await add(body, f.headers, f.make())).json(), { registrationId });
  assert.equal((await add({ ...body, email: 'different@example.invalid' })).status, 409);
  assert.equal(f.cardMessages().length, 0);
  const call = (method, body, headers = f.headers) => f.app.handle(f.request(root + '/' + registrationId, { method, body, headers }));
  const view = await (await call('GET')).json();
  assert.equal(view.test, true);
  assert.equal(view.name, body.name.trim());
  assert.equal(view.stage, 'send');
  assert.equal(view.canRemove, true);
  assert.equal((await (await call('GET', undefined, reviewer)).json()).canRemove, false);
  const directoryEntry = (await f.directory()).find(item => item.id === registrationId);
  assert.equal(directoryEntry.bookingReference, '测试卡');
  assert.equal(directoryEntry.test, true);
  assert.equal((await (await call('POST', { primaryId: registrationId, expectedRevision: view.deliveryRevision,
    expectedAccessRevision: view.accessRevision, identity: view.identity, format: 'jpeg' })).json()).status, 'provider_accepted');
  const message = f.cardMessages()[0].template_params;
  assert.match(message.email_subject, /^【测试】/u);
  assert.equal(message.to_email, body.email);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(message.confirmation_actions)[1];
  const privatePage = () => f.app.handle(f.request('/api/registration/confirmation', {
    method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken },
  }));
  assert.equal(confirmationView(await (await privatePage()).json()).card.format, 'both');
  const signing = await createWalletFixture();
  t.after(signing.cleanup);
  const wallet = createAppleWalletService({ env: signing.env, tokenSecret: 'synthetic-test-card-signing-secret', clock: () => signing.now,
    trustedRootFingerprints: signing.fields.trustedRootFingerprints,
    authorize: f.app.confirmationService.authorize, authorizedRegistration: f.app.confirmationService.authorizedRegistration });
  const pass = await wallet.download({ receiptToken });
  assert.equal(pass.outcome, 'issued');
  assert.equal(JSON.parse(passFiles(pass.data).get('pass.json')).barcodes, undefined);
  assert.equal((await call('DELETE', { primaryId: registrationId }, reviewer)).status, 403);
  assert.equal((await call('DELETE', { primaryId: f.id })).status, 409);
  for (let count = 0; count < 2; count++) {
    assert.deepEqual(await (await call('DELETE', { primaryId: registrationId })).json(), { removed: true });
  }
  assert.equal((await privatePage()).status, 404);
  assert.notEqual((await wallet.download({ receiptToken })).outcome, 'issued');
  assert.equal((await call('GET')).status, 404);
  assert.equal((await add(body)).status, 409);
  assert.equal((await f.directory()).some(item => item.id === registrationId), false);
  assert.deepEqual(await f.app.registrationService.repository.readIndex(), snapshot);
  const prefix = cardManagementPrefix(PEOPLE_FIXTURE_EVENT);
  const journal = createObjectJournal({ objects: f.objects, prefix });
  const { value } = await journal.read();
  assert.equal(value.tests[registrationId], undefined);
  assert.equal(value.removed[registrationId].actorId, f.users[0].id);
  const backup = await collectJournalBackupKeys({ objects: f.objects, journalPrefixes: [prefix] });
  assert.ok(backup.includes(prefix + '/commits.jsonl') && backup.some(key => key.startsWith(prefix + '/blobs/')));
});

test('removing an issued application revokes its keepsake link and preserves its independent admission', async () => {
  const f = await setup();
  const send = await f.prepare();
  assert.equal((await (await f.call('POST', send)).json()).status, 'provider_accepted');
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(f.cardMessages()[0].template_params.confirmation_actions)[1];
  const snapshot = await f.app.registrationService.repository.readIndex();
  assert.equal((await f.call('DELETE', { primaryId: f.id })).status, 200);
  assert.equal((await f.directory()).length, 0);
  assert.equal((await f.call('POST', send)).status, 404);
  const link = await f.app.handle(f.request('/api/registration/confirmation', {
    method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken },
  }));
  assert.equal(link.status, 404);
  assert.deepEqual(await f.app.registrationService.repository.readIndex(), snapshot);
  assert.equal((await f.app.registrationService.getAdmissionStatus(f.id)).status, 'pending_review');
});

test('souvenir approval can be replayed without changing a full admission ledger', async () => {
  const f = await peopleRuntimeFixture({ capacity: 1 });
  const headers = await f.login();
  const seat = await f.seedPublic();
  await f.approvePublic(seat.reference_code, { headers });
  const requests = [await f.seedWallet({ huodongxingReference: '1001' }), await f.seedWallet({ huodongxingReference: '1002' })];
  const index = await f.app.registrationService.repository.readIndex();
  for (const id of requests) {
    const call = (path, method = 'GET', body) => f.app.handle(f.request(root + '/' + id + path, { headers, method, body }));
    const detail = await (await call('')).json();
    const approval = { primaryId: id, expectedRevision: detail.admissionRevision, operationId: operationId() };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await call('/approve', 'POST', approval);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'confirmed' });
    }
    const approved = await (await call('')).json();
    assert.equal(approved.stage, 'set_identity');
    assert.equal((await f.app.registrationService.getAdmissionStatus(id)).status, 'pending_review');
  }
  assert.deepEqual(await f.app.registrationService.repository.readIndex(), index);
  assert.equal(f.messages.length, 0);
});

test('an existing confirmed primary can collect the linked Wallet applicant’s details and saved blanks remain authoritative', async () => {
  const f = await setup({ preferences: { locale: 'en', ggjSite: 'GGJ ArtDiCO', ggjRole: '导师' } });
  const primary = (await f.seedPublic()).reference_code;
  await f.approvePublic(primary, { headers: f.headers });
  const resolve = body => f.app.handle(f.request('/api/admin/people/resolve', { method: 'POST', headers: f.headers, body }));
  const preview = await (await resolve({ action: 'preview', keys: [primary, f.id].map(id => 'registration:' + id) })).json();
  const merge = await resolve({ action: 'merge', keys: preview.keys, primaryKey: 'registration:' + primary, roles: preview.roles,
    expectedRevision: preview.expectedRevision, expectedContactRevision: preview.expectedContactRevision, operationId: operationId(), confirmSamePerson: true });
  assert.equal(merge.status, 200);
  let detail = await f.read();
  assert.deepEqual(detail.cardCommunity, { site: 'GGJ ArtDiCO', role: '导师' });
  assert.equal((await f.call('PATCH', { primaryId: primary, expectedRevision: detail.reviewRevision, identity: 'guest' })).status, 200);
  detail = await f.read();
  const sent = await f.call('POST', { primaryId: primary, expectedRevision: detail.deliveryRevision,
    expectedAccessRevision: detail.accessRevision, identity: 'guest', format: 'jpeg' });
  assert.equal((await sent.json()).status, 'provider_accepted');
  const email = f.cardMessages()[0].template_params.confirmation_actions;
  assert.match(email, /Mentor/u);
  assert.match(email, /GGJ ARTDICO/u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(email)[1];
  const claim = async () => confirmationView(await (await f.app.handle(f.request('/api/registration/confirmation', {
    method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC, body: { receiptToken },
  }))).json());
  const issued = await claim();
  assert.equal(issued.cardLocale, 'en');
  assert.deepEqual(issued.cardCommunity, { site: 'GGJ ArtDiCO', role: '导师' });
  assert.equal((await f.call('PATCH', { primaryId: primary, expectedCommunityRevision: detail.communityRevision,
    cardCommunity: { site: '', role: '' } })).status, 200);
  assert.equal((await claim()).cardCommunity, undefined);
  assert.equal(f.cardMessages().length, 1);
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

test('existing Wallet and JPEG links can redeem both keepsake formats after the event', async t => {
  const f = await setup(), body = await f.prepare();
  const signing = await createWalletFixture();
  t.after(signing.cleanup);
  const messages = [], tokenSecret = 'synthetic-wallet-card-signing-test-token-secret';
  const expiresAt = Date.parse('2027-01-01T00:00:00Z');
  let current = Date.parse('2026-10-21T09:00:00Z'), eventReady = true;
  let deliveryAllowed = true, revokeDuringSigning = false;
  const service = createRegistrationConfirmationService({ registrationService: f.app.registrationService, tokenSecret,
    clock: () => current, expiresAt,
    journalFor: prefix => createObjectJournal({ objects: f.objects, prefix }),
    currentRegistration: record => f.app.reviewStore.projectRegistration(record),
    walletReadiness: () => wallet.readiness(),
    eventFactsReadiness: () => ({ ready: eventReady, reason: 'EVENT_FACTS_MISMATCH', revision: 7 }),
    personDeliveryPermission: () => deliveryAllowed ? { eligible: true } : { eligible: false, reason: 'CONTACT_DECLINED' },
    emailProvider: { readiness: () => ({ ready: true }), send: async message => { messages.push(message); return { status: 'provider_accepted' }; } },
  });
  const wallet = createAppleWalletService({ env: signing.env, tokenSecret, clock: () => Math.max(signing.now, current),
    trustedRootFingerprints: signing.fields.trustedRootFingerprints, authorize: service.authorize,
    authorizedRegistration: (id, settings) => {
      if (revokeDuringSigning) deliveryAllowed = false;
      return service.authorizedRegistration(id, settings);
    } });
  const result = await service.staffSendCard({ ...body, actor: f.users[0], registrationId: f.id, format: 'wallet' });
  assert.equal(result.status, 'provider_accepted');
  assert.equal(messages.length, 1);
  assert.match(messages[0].templateVariables.confirmation_actions, /打开电子纪念卡/u);
  assert.doesNotMatch(messages[0].templateVariables.confirmation_actions, /下载 JPEG|add-to-apple-wallet/u);
  assert.doesNotMatch(messages[0].text, /https?:\/\//u);
  const receiptToken = /#r=([A-Za-z0-9_.-]+)/u.exec(messages[0].templateVariables.confirmation_actions)[1];
  assert.deepEqual(confirmationView(await service.confirmation({ receiptToken })).card, { format: 'wallet', identity: '嘉宾', ready: true, collectorNumber: null });
  const beforeClaim = await service.confirmation({ receiptToken, includeCardFormats: true });
  assert.equal(beforeClaim.wallet.ready, true, 'the signing capability is available to old clients');
  const first = confirmationView(beforeClaim);
  assert.equal(first.card.format, 'both');
  assert.equal(first.card.ready, true);
  assert.equal(first.wallet.ready, false);
  assert.equal(first.card.entryQr, undefined);
  assert.deepEqual(first.eventFacts, { ready: true, reason: 'EVENT_FACTS_VERIFIED', revision: 7 });
  eventReady = false;
  const blocked = confirmationView(await service.confirmation({ receiptToken, includeCardFormats: true }));
  assert.equal(blocked.card.ready, false);
  assert.deepEqual(blocked.eventFacts, { ready: false, reason: 'EVENT_FACTS_MISMATCH', revision: 7 });
  eventReady = true;
  const tokens = createConfirmationTokens({ tokenSecret, eventId: PEOPLE_FIXTURE_EVENT, clock: () => Date.parse('2026-10-21T09:00:00Z'),
    expiresAt });
  current = Date.parse('2026-12-06T00:00:00Z');
  for (const token of [receiptToken, tokens.issue(f.id, 0, 'jpeg').receiptToken]) {
    const view = confirmationView(await service.claimCard({ receiptToken: token, includeCardFormats: true }));
    assert.deepEqual(view.card, { ...first.card, collectorNumber: { sequence: 1, test: false } });
    assert.equal(view.wallet.ready, true);
    const pass = await wallet.download({ receiptToken: token });
    assert.equal(pass.outcome, 'issued');
    const files = passFiles(pass.data);
    assert.ok(files.get('signature').length > 1024);
    const passJson = JSON.parse(files.get('pass.json'));
    assert.equal(passJson.eventTicket.secondaryFields.find(field => field.key === 'identity').value, '嘉宾');
    assert.equal(passJson.posterGeneric.backFields.find(field => field.key === 'poster-details-collector-number').value, 'GGJ26-HOST-0001');
    assert.equal(passJson.barcodes, undefined);
    assert.equal(passJson.expirationDate, undefined);
  }
  revokeDuringSigning = true;
  assert.deepEqual(await wallet.download({ receiptToken }), { outcome: 'inactive' });
  assert.deepEqual(await wallet.download({ receiptToken }), { outcome: 'invalid' });
});
