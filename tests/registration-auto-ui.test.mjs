import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationUiCopy, PUBLIC_REGISTRATION_URL } from '../src/config/event.mjs';
import { publicFaqItems } from '../src/lib/public-faq.mjs';
import { createRegistrationClient } from '../src/lib/registration-client.mjs';
import { applicationDraftFromFields, applicationPendingValue } from '../src/lib/application-draft.mjs';
import { renderRegistrationSuccess } from '../src/scripts/registration-success.mjs';

test('automatic presentation requires an explicit false server review flag; legacy and malformed metadata retain review', () => {
  for (const metadata of [undefined, null, {}, { attendeeReviewRequired: true }, { attendeeReviewRequired: 'false' }, { attendeeReviewRequired: 0 }]) {
    assert.equal(registrationUiCopy(metadata).automatic, false);
    assert.match(registrationUiCopy(metadata).faq, /人工审核/u);
  }
  const metadata = Object.freeze({ attendeeReviewRequired: false });
  const copy = registrationUiCopy(metadata);
  assert.equal(copy.automatic, true);
  assert.doesNotMatch([copy.notice, copy.disclaimer, copy.availability, copy.emailHint, copy.faq].join(' '), /人工审核|等待审核|审核后的通知/u);
  assert.match(copy.faq, /分享提案另行审选/u);
  assert.deepEqual(metadata, { attendeeReviewRequired: false });
  assert.match(registrationUiCopy({ attendeeReviewRequired: false, admissions: { waitlistEnabled: true } }).disclaimer, /名额用完将登记候补/u);
  assert.doesNotMatch(registrationUiCopy({ attendeeReviewRequired: false, admissions: { waitlistEnabled: false } }).disclaimer, /将登记候补/u);
});

test('external general registration stays independent of local admission mode without rewriting unrelated FAQ content', () => {
  const input = [{ id: 'registration-status', question: '现在可以报名吗？', answer: '合成旧审核说明' },
    { id: 'custom-help', question: '合成活动问题', answer: '合成自订说明' }];
  const original = structuredClone(input), copy = registrationUiCopy({ attendeeReviewRequired: false });
  const rows = publicFaqItems(input, { availability: { message: copy.faq } });
  assert.match(rows.find(row => row.id === 'registration-status').answer,/活动行/u);
  assert.equal(rows.find(row => row.id === 'registration-status').registrationUrl,PUBLIC_REGISTRATION_URL);
  assert.notEqual(rows.find(row => row.id === 'registration-status').answer,copy.faq);
  assert.equal(rows.find(row => row.id === 'custom-help').answer, original[1].answer);
  assert.deepEqual(input, original);
});

class Element {
  constructor() { this.hidden = false; this.textContent = ''; this.children = []; }
  matches(selector) { return selector === '[data-registration-success]'; }
  querySelector(selector) { return this.fields?.[selector] ?? null; }
  querySelectorAll(selector) { return selector === 'img' ? this.children : []; }
  replaceChildren(...children) { this.children = children; }
  append(...children) { this.children.push(...children); }
  removeAttribute() {}
  addEventListener() {}
  get firstElementChild() { return this.children[0] ?? null; }
}
function receiptView() {
  const container = new Element(); container.fields = {};
  for (const key of ['success-heading', 'reference', 'group-status', 'group-image', 'group-help']) container.fields['[data-registration-' + key + ']'] = new Element();
  let images = 0; container.ownerDocument = { createElement() { images++; return new Element(); } };
  return { container, fields: container.fields, get images() { return images; } };
}

test('automatic mode never upgrades waitlisted, legacy pending or rejected receipts into confirmed tickets', () => {
  const previous = globalThis.HTMLElement; globalThis.HTMLElement = Element;
  try {
    assert.equal(registrationUiCopy({ attendeeReviewRequired: false }).automatic, true);
    for (const status of ['waitlisted', 'pending_review', 'rejected']) {
      const view = receiptView();
      assert.equal(renderRegistrationSuccess(view.container, { httpStatus: 201, body: { status, admissionStatus: status, reference_code: 'r'.repeat(43) } }), true);
      assert.doesNotMatch(view.fields['[data-registration-success-heading]'].textContent, /报名成功|名额已确认/u);
      assert.equal(view.fields['[data-registration-group-image]'].hidden, true);
      assert.equal(view.images, 0);
    }
    const confirmed = receiptView();
    assert.equal(renderRegistrationSuccess(confirmed.container, { httpStatus: 201, body: { status: 'registered', admissionStatus: 'confirmed', reference_code: 'r'.repeat(43) } }), true);
    assert.match(confirmed.fields['[data-registration-success-heading]'].textContent, /报名成功.*名额已确认/u);
    assert.equal(confirmed.images, 0, 'a confirmed seat does not fabricate a group QR or require one');
    const invalid = receiptView();
    assert.equal(renderRegistrationSuccess(invalid.container, { httpStatus: 201, body: { status: 'pending_review', admissionStatus: 'confirmed', reference_code: 'r'.repeat(43) } }), false);
    assert.equal(invalid.container.hidden, true);
  } finally { if (previous === undefined) delete globalThis.HTMLElement; else globalThis.HTMLElement = previous; }
});

test('a legacy pending proposal replays its exact body and key after metadata changes to automatic admission', async () => {
  const now = Date.parse('2026-10-21T09:00:00.000Z'), eventId = 'ggj-cn-2026';
  const fields = { intake: 'general-v2', name: '合成报名人', email: 'synthetic.auto@example.invalid', categories: ['student'],
    participationInterests: ['attend', 'talk'], speaker: { topic: '合成提案', summary: '合成提案简介' } };
  const pending = applicationPendingValue({ eventId, idempotencyKey: 'a'.repeat(64), attempted: true, uncertain: true,
    payloadJson: JSON.stringify({ eventId, fields, consent: { accepted: true, version: 'notice-original-v1' } }) });
  const original = structuredClone(pending), calls = [];
  const policy = { enabled: true, eventId, opensAt: '2026-10-01T00:00:00.000Z', closesAt: '2026-12-05T04:00:00.000Z', capacity: 300,
    attendeeReviewRequired: false, privacy: { version: 'notice-current-v2', processor: '合成处理者', contactEmail: 'privacy@example.invalid',
      purpose: '合成报名', storageRegion: '合成地区', retention: '合成期限', rightsRequest: '合成权利', sharing: '合成范围' } };
  const client = createRegistrationClient({ apiOrigin: 'https://api.artdico.host', pageOrigin: 'https://artdico.host', clock: () => now,
    randomBytes: () => assert.fail('recovery must not create another identity'), fetchFn: async (url, options) => {
      calls.push({ url, options });
      const body = url.endsWith('/config') ? policy : url.endsWith('/token')
        ? { eventId, submissionToken: 'synthetic.token.signature', expiresAt: '2026-10-21T10:00:00.000Z' }
        : { status: 'pending_review', admissionStatus: 'pending_review', reference_code: 'r'.repeat(43) };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    } });
  assert.equal(registrationUiCopy(await client.configure()).automatic, true);
  client.restorePending(pending);
  assert.equal(applicationDraftFromFields(JSON.parse(client.pendingSnapshot.payloadJson).fields).proposal, true);
  const receipt = await client.resume(), sent = calls.find(call => call.url.endsWith('/submit'));
  assert.equal(sent.options.body, original.payloadJson);
  assert.equal(sent.options.headers['Idempotency-Key'], original.idempotencyKey);
  assert.equal(receipt.body.admissionStatus, 'pending_review');
  assert.deepEqual(pending, original);
});
