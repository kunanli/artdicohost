import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { peopleRuntimeFixture, PEOPLE_FIXTURE_EVENT, PEOPLE_FIXTURE_PUBLIC } from './helpers/people-runtime-fixture.mjs';

const operation = () => randomBytes(32).toString('base64url');
async function json(response, expected = 200) {
  const value = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
}
async function application(f, app = f.app, fields = {}) {
  const key = operation(), metadata = await app.registrationService.metadata();
  const token = await json(await app.handle(f.request('/api/admin/registration/token', { method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC,
    body: { eventId: PEOPLE_FIXTURE_EVENT, idempotencyKey: key } })));
  return { key, token: token.submissionToken, payload: { eventId: PEOPLE_FIXTURE_EVENT,
    fields: { intake: 'general-v2', name: '合成自动入场参会者', email: 'synthetic.auto@example.invalid', categories: ['industry'], participationInterests: ['attend'], ...fields },
    consent: { accepted: true, version: metadata.privacy.version } } };
}
const submit = (f, app, input) => app.handle(f.request('/api/admin/registration/submit', { method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC,
  headers: { 'Idempotency-Key': input.key, 'X-Registration-Token': input.token }, body: input.payload }));
const page = (f, app, receipt) => app.handle(f.request('/api/admin/registration/confirmation', { method: 'POST', origin: PEOPLE_FIXTURE_PUBLIC,
  body: { receiptToken: receipt.confirmation.receiptToken } })).then(response => json(response));
const history = (f, app, receipt) => app.confirmationService.staffHistory({ actor: f.users[0], registrationId: receipt.reference_code });
async function withdrawReview(f, app, receipt) {
  const detail = await app.reviewStore.detail(receipt.reference_code), review = { ...detail.review, status: 'withdrawn' };
  delete review.deletionRequested;
  await app.reviewStore.saveReview(receipt.reference_code, detail.revision, review, f.users[0].id);
}

test('optional public phone and WeChat persist to staff detail and can be corrected without rewriting the original',async()=>{
  const f=await peopleRuntimeFixture({attendeeReviewRequired:false}),phone='+852 0012 3456',wechat='synthetic-contact';
  const input=await application(f,f.app,{phone,wechat}),receipt=await json(await submit(f,f.app,input),201),id=receipt.reference_code;
  const original=(await f.app.registrationService.repository.list()).registrations.find(row=>row.id===id);
  assert.equal(original.fields.phone,phone);assert.equal(original.fields.wechat,wechat);
  const headers=await f.login(),person=await json(await f.app.handle(f.request('/api/admin/people/registrations/'+id,{headers})));
  assert.equal(person.registration.fields.phone,phone);assert.equal(person.registration.fields.wechat,wechat);
  const detail=await f.app.reviewStore.detail(id),profile=Object.fromEntries(['name','email','organization','position','city','wechat','phone'].map(key=>[key,detail.registration.fields[key]??'']));
  profile.phone='0086 001 2345';
  const result=await f.app.reviewStore.saveProfile(id,detail.revision,operation(),profile,f.users[0].id);assert.equal(result.outcome,'updated');
  const restarted=f.make(),after=await json(await restarted.handle(f.request('/api/admin/people/registrations/'+id,{headers})));
  assert.equal(after.registration.fields.phone,profile.phone);assert.equal(after.registration.fields.wechat,wechat);
  assert.equal((await restarted.registrationService.repository.list()).registrations.find(row=>row.id===id).fields.phone,phone,'the immutable original remains intact');
  assert.equal(f.messages.length,0,'read and contact correction never send confirmation mail');
});

test('new automatic public intake sends one formal confirmation; replay, reads and optional proposal never add review or mail', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true });
  const input = await application(f, f.app, { participationInterests: ['attend', 'talk'], speaker: { topic: '合成提案', summary: '合成摘要' } });
  const original = JSON.stringify(input.payload), receipt = await json(await submit(f, f.app, input), 201);
  assert.equal(receipt.admissionStatus, 'confirmed');
  assert.equal(receipt.confirmation.email.status, 'provider_accepted');
  assert.equal(f.messages.length, 1);
  assert.match(f.messages[0].template_params.invitation_text, /你的参会名额已确认/u);
  assert.doesNotMatch(f.messages[0].template_params.invitation_text, /待主办方人工审核|申请已收到，待审核/u);
  assert.match(f.messages[0].template_params.invitation_text, /https:\/\/artdico\.host\/r\/#[A-Za-z0-9_-]{22}/u);
  const view = await page(f, f.app, receipt);
  assert.equal(view.admission.status, 'confirmed');
  const stored = (await f.app.registrationService.repository.list()).registrations[0];
  assert.deepEqual(stored.fields.speaker, input.payload.fields.speaker, 'entry confirmation does not grant or discard a speaking proposal');
  const replay = await json(await submit(f, f.make(), input));
  assert.equal(replay.admissionStatus, 'confirmed');
  assert.equal((await page(f, f.make(), replay)).email.status, 'provider_accepted');
  assert.equal(f.messages.length, 1);
  assert.equal(JSON.stringify(input.payload), original);
  assert.deepEqual((await history(f, f.app, receipt)).notices.map(notice => notice.kind), ['registration']);
});

test('full automatic intake waits without a formal invitation, then a new durable intake notifies the eligible promotion once', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true, capacity: 1 });
  const first = await json(await submit(f, f.app, await application(f, f.app, { email: 'synthetic.first@example.invalid' })), 201);
  const waitingInput = await application(f, f.app, { email: 'synthetic.waiter@example.invalid' });
  const waiting = await json(await submit(f, f.app, waitingInput), 201);
  assert.equal(waiting.admissionStatus, 'waitlisted');
  assert.equal(waiting.confirmation.email.status, 'not_applicable');
  assert.equal(f.messages.length, 1);
  const before = await page(f, f.app, waiting);
  assert.equal(before.admission.status, 'waitlisted');
  assert.equal(before.groupInvite, null); assert.equal(before.wallet.ready, false);
  assert.equal((await history(f, f.app, waiting)).notices.length, 0);
  // The review journal can prove withdrawal before the shared seat journal is
  // reconciled. The next actual intake owns that release/promotion commit.
  await withdrawReview(f, f.app, first);
  const latestInput = await application(f, f.app, { email: 'synthetic.latest@example.invalid' });
  const latest = await json(await submit(f, f.app, latestInput), 201);
  assert.equal(latest.admissionStatus, 'waitlisted');
  assert.equal((await page(f, f.app, waiting)).admission.status, 'confirmed');
  assert.equal(f.messages.length, 2);
  assert.equal(f.messages[1].template_params.to_email, 'synthetic.waiter@example.invalid');
  assert.equal((await history(f, f.app, waiting)).notices.length, 1);
  await json(await submit(f, f.make(), waitingInput));
  await json(await submit(f, f.make(), latestInput));
  assert.equal(f.messages.length, 2, 'old receipt replays never backfill a new confirmed or promotion notice');
});

test('paused automatic email keeps a confirmed seat and private page without replay backfill after resuming', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true });
  const settings = await f.app.confirmationService.settings({ actor: f.users[0] });
  await f.app.confirmationService.setSettings({ actor: f.users[0], expectedRevision: settings.revision, operationId: operation(), enabled: false });
  const input = await application(f), receipt = await json(await submit(f, f.app, input), 201);
  assert.equal(receipt.admissionStatus, 'confirmed'); assert.equal(receipt.confirmation.email.status, 'disabled');
  assert.equal(f.messages.length, 0); assert.equal((await page(f, f.app, receipt)).admission.status, 'confirmed');
  await f.app.confirmationService.setSettings({ actor: f.users[0], expectedRevision: (await f.app.confirmationService.settings({ actor: f.users[0] })).revision,
    operationId: operation(), enabled: true });
  await json(await submit(f, f.make(), input)); await page(f, f.make(), receipt);
  assert.equal(f.messages.length, 0, 'reenabling automatic mail does not turn a read/replay into a new dispatch');
});

test('uncertain new-intake mail leaves the same commit promotion for explicit dispatch instead of starting another send', async () => {
  let providerResult = 'accepted';
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true, capacity: 2, mailResult: () => providerResult });
  const a = await json(await submit(f, f.app, await application(f, f.app, { email: 'synthetic.seat-a@example.invalid' })), 201);
  const b = await json(await submit(f, f.app, await application(f, f.app, { email: 'synthetic.seat-b@example.invalid' })), 201);
  const waitingInput = await application(f, f.app, { email: 'synthetic.old-waiter@example.invalid' });
  const waiting = await json(await submit(f, f.app, waitingInput), 201);
  assert.equal(waiting.admissionStatus, 'waitlisted'); assert.equal(f.messages.length, 2);
  await withdrawReview(f, f.app, a); await withdrawReview(f, f.app, b);
  providerResult = 'unknown';
  const input = await application(f, f.app, { email: 'synthetic.new-intake@example.invalid' });
  const fresh = await json(await submit(f, f.app, input), 201);
  assert.equal(fresh.admissionStatus, 'confirmed'); assert.equal(fresh.confirmation.email.status, 'unknown');
  assert.equal((await page(f, f.app, waiting)).admission.status, 'confirmed', 'the promotion remains durable despite deferred notification');
  assert.equal((await history(f, f.app, waiting)).notices.length, 0);
  assert.equal(f.messages.length, 3, 'the uncertain first send stops subsequent automatic recipients');
  await json(await submit(f, f.make(), waitingInput)); await json(await submit(f, f.make(), input));
  assert.equal(f.messages.length, 3);
});

test('an unknown automatic provider result never resends across restarts and a later withdrawal revokes the ticket', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true, mailResult: 'unknown' });
  const input = await application(f), receipt = await json(await submit(f, f.app, input), 201);
  assert.equal(receipt.admissionStatus, 'confirmed'); assert.equal(receipt.confirmation.email.status, 'unknown');
  assert.equal(f.messages.length, 1);
  await json(await submit(f, f.make(), input));
  assert.equal((await page(f, f.make(), receipt)).email.status, 'unknown');
  assert.equal(f.messages.length, 1);
  const before = await f.app.registrationService.getAdmissions({ actor: f.users[0] });
  const withdrawn = await f.app.registrationService.withdrawAdmission({ actor: f.users[0], registrationId: receipt.reference_code,
    expectedRevision: before.revision, operationId: operation() });
  assert.equal(withdrawn.outcome, 'updated');
  assert.equal((await submit(f, f.make(), input)).status, 410);
  const denied = await page(f, f.make(), receipt);
  assert.equal(denied.admission.status, 'withdrawn'); assert.equal(denied.groupInvite, null); assert.equal(denied.wallet.ready, false);
  assert.equal(f.messages.length, 1);
});

test('lost durable registration acknowledgement recovers an automatic ticket without sending historical mail', async () => {
  let now = Date.parse('2026-10-21T09:00:00Z');
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true, clock: () => now });
  let lose = true;
  const uncertainObjects = { ...f.objects, async append(key, position, data) {
    const result = await f.objects.append(key, position, data);
    if (lose && key === 'cms/v1/registrations/' + PEOPLE_FIXTURE_EVENT + '/index/commits.jsonl') { lose = false; throw new Error('Synthetic registration ACK lost'); }
    return result;
  } };
  const app = f.make({ objects: uncertainObjects }), input = await application(f, app), original = JSON.stringify(input.payload);
  assert.equal((await submit(f, app, input)).status, 503); assert.equal(f.messages.length, 0);
  now += 24 * 60 * 60 * 1000;
  const recovered = await json(await submit(f, f.make(), input));
  assert.equal(recovered.admissionStatus, 'confirmed');
  assert.equal((await page(f, f.make(), recovered)).admission.status, 'confirmed');
  assert.equal(f.messages.length, 0); assert.equal(JSON.stringify(input.payload), original);
  assert.equal((await f.app.registrationService.repository.list()).registrations.length, 1);
});

test('lost automatic notice reservation acknowledgement never starts an unproven external send', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true });
  let lose = true;
  const uncertainObjects = { ...f.objects, async append(key, position, data) {
    const result = await f.objects.append(key, position, data);
    if (lose && key === 'cms/v1/registration-confirmations/' + PEOPLE_FIXTURE_EVENT + '/commits.jsonl') { lose = false; throw new Error('Synthetic notice ACK lost'); }
    return result;
  } };
  const app = f.make({ objects: uncertainObjects }), input = await application(f, app), receipt = await json(await submit(f, app, input), 201);
  assert.equal(receipt.admissionStatus, 'confirmed'); assert.equal(receipt.confirmation.email.status, 'unknown');
  assert.equal(f.messages.length, 0);
  await json(await submit(f, f.make(), input));
  assert.equal((await page(f, f.make(), receipt)).email.status, 'unknown');
  assert.equal(f.messages.length, 0); assert.equal((await history(f, f.app, receipt)).notices.length, 1);
});

test('withdrawal after an automatic reservation is rechecked before the provider can start', async () => {
  const f = await peopleRuntimeFixture({ attendeeReviewRequired: false, mail: true });
  let app, withdrawNext = true;
  const racingObjects = { ...f.objects, async append(key, position, data) {
    const result = await f.objects.append(key, position, data);
    if (withdrawNext && key === 'cms/v1/registration-confirmations/' + PEOPLE_FIXTURE_EVENT + '/commits.jsonl') {
      withdrawNext = false;
      const current = await app.registrationService.getAdmissions({ actor: f.users[0] });
      assert.equal(current.people.length, 1);
      const saved = await app.registrationService.withdrawAdmission({ actor: f.users[0], registrationId: current.people[0].registrationId,
        expectedRevision: current.revision, operationId: operation() });
      assert.equal(saved.outcome, 'updated');
    }
    return result;
  } };
  app = f.make({ objects: racingObjects });
  const input = await application(f, app), receipt = await json(await submit(f, app, input), 201);
  assert.equal(f.messages.length, 0, 'a reserved notice is not authority to send after a later withdrawal');
  const denied = await page(f, f.make(), receipt);
  assert.equal(denied.admission.status, 'withdrawn'); assert.equal(denied.groupInvite, null); assert.equal(denied.wallet.ready, false);
  assert.equal((await submit(f, f.make(), input)).status, 410);
  assert.equal(f.messages.length, 0);
});

test('switching policy does not approve old pending records or replace their original consent and receipt history', async () => {
  const f = await peopleRuntimeFixture({ mail: true });
  const input = await application(f), old = await json(await submit(f, f.app, input), 201);
  assert.equal(old.admissionStatus, 'pending_review'); assert.equal(f.messages.length, 1);
  const stored = await f.app.registrationService.repository.list(), bytes = JSON.stringify(stored.registrations[0]);
  const automatic = f.make({ policyOverride: { attendeeReviewRequired: false } });
  const replay = await json(await submit(f, automatic, input));
  assert.equal(replay.admissionStatus, 'pending_review');
  const newReceipt = await json(await submit(f, automatic, await application(f, automatic, { email: 'synthetic.new@example.invalid' })), 201);
  assert.equal(newReceipt.admissionStatus, 'confirmed'); assert.equal(f.messages.length, 2);
  const oldView = await page(f, automatic, old);
  assert.equal(oldView.admission.status, 'pending_review'); assert.equal(oldView.groupInvite, null); assert.equal(oldView.wallet.ready, false);
  assert.equal(oldView.notifications.applicationReceived.status, 'provider_accepted');
  assert.equal(JSON.stringify((await automatic.registrationService.repository.list()).registrations.find(record => record.id === old.reference_code)), bytes);
  assert.equal((await history(f, automatic, old)).notices.length, 0);
});
