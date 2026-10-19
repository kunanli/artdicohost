import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistrationPolicy } from '../functions/registration-api/policy.mjs';
import { MAX_REGISTRATION_BYTES, validateRegistrationSubmission } from '../functions/registration-api/validation.mjs';

const now = '2026-10-19T12:00:00+08:00';

function policy(overrides = {}) {
  return {
    enabled: true, eventId: 'synthetic-event-2026', opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T10:00:00+08:00',
    privacy: {
      version: 'privacy-2026-v1', processor: '合成活动处理者', contactEmail: 'privacy@example.invalid',
      purpose: '合成资料的参会登记与联络', storageRegion: '合成存储地区', retention: '合成保留期限',
      rightsRequest: '通过上述合成邮箱提出查阅、更正、撤回与删除请求', sharing: '合成方案不向第三方分享',
    }, ...overrides,
  };
}

function fields(overrides = {}) {
  return {
    name: '合成来宾', city: '合成城市', organization: '合成团队', position: '开发者', email: 'attendee@example.invalid',
    categories: ['industry'], participationInterests: ['attend'], background: '合成经历', attendance: 'expected',
    accommodationChoice: 'not_needed', cooperationInterest: 'none', ...overrides,
  };
}

function submission(overrides = {}) {
  return { eventId: 'synthetic-event-2026', fields: fields(), consent: { accepted: true, version: 'privacy-2026-v1' }, ...overrides };
}

function validate(payload, config = policy(), clock = now) {
  return validateRegistrationSubmission(payload, { policy: config, now: clock });
}

function rejected(result, key) {
  assert.equal(result.valid, false);
  assert.ok(Object.keys(result.errors).length);
  if (key) assert.ok(result.errors[key], key);
  assert.equal(Object.hasOwn(result, 'value'), false);
  assert.equal(Object.hasOwn(result, 'reference_code'), false);
}

test('policy preflight has no enabled, privacy or clock defaults and strips unrelated configuration', () => {
  rejected(validateRegistrationPolicy());
  rejected(validateRegistrationPolicy({}, { now }), 'enabled');
  rejected(validateRegistrationPolicy(policy(), {}), 'now');
  for (const enabled of [undefined, false, 'true', 1]) rejected(validateRegistrationPolicy(policy({ enabled }), { now }), 'enabled');
  for (const key of Object.keys(policy().privacy)) {
    const config = policy();
    delete config.privacy[key];
    rejected(validateRegistrationPolicy(config, { now }), `privacy.${key}`);
    config.privacy[key] = '   ';
    rejected(validateRegistrationPolicy(config, { now }), `privacy.${key}`);
  }
  for (const version of ['frontend-demo-v1', 'DEMO-v1', 'mock-2026', 'frontend-2026']) {
    const config = policy(); config.privacy.version = version;
    rejected(validateRegistrationPolicy(config, { now }), 'privacy.version');
  }
  const invalidEmail = policy(); invalidEmail.privacy.contactEmail = 'PRIVATE-INVALID-EMAIL';
  rejected(validateRegistrationPolicy(invalidEmail, { now }), 'privacy.contactEmail');
  const result = validateRegistrationPolicy(policy({ arbitraryCredential: 'SYNTHETIC-NOT-A-SECRET' }), { now });
  assert.equal(result.valid, true);
  assert.equal(Object.hasOwn(result.value, 'arbitraryCredential'), false);
  assert.deepEqual(Object.keys(result), ['valid', 'errors', 'value']);
});

test('preflight rejects malformed clocks, impossible dates, implicit timezone and reversed windows', () => {
  for (const invalid of ['2026-02-30T12:00:00+08:00', '2026-13-01T12:00:00Z', '2026-10-19T24:00:00Z', '2026-10-19T12:60:00Z', '2026-10-19T12:00:60Z', '2026-10-19T12:00:00', '2026-10-19', '2026-10-19T12:00:00+15:00', '2026-10-19T12:00:00+14:01', '2026-10-19T12:00:00+08:99', '0000-01-01T00:00:00+14:00', '9999-12-31T23:59:59-14:00']) {
    rejected(validateRegistrationPolicy(policy({ opensAt: invalid }), { now }), 'opensAt');
    rejected(validateRegistrationPolicy(policy(), { now: invalid }), 'now');
  }
  for (const invalid of [NaN, Infinity, 1.5, null, {}, new Date(now), () => Date.now()]) rejected(validateRegistrationPolicy(policy(), { now: invalid }), 'now');
  rejected(validateRegistrationPolicy(policy({ closesAt: '2026-10-18T00:00:00Z' }), { now }), 'closesAt');
  rejected(validateRegistrationPolicy(policy({ closesAt: policy().opensAt }), { now }), 'closesAt');
  assert.equal(validateRegistrationPolicy(policy({ opensAt: '2024-02-29T12:00:00.123Z' }), { now }).valid, true);
  assert.equal(validateRegistrationPolicy(policy(), { now: Date.parse(now) }).valid, true);
});

test('registration window opens inclusively and closes exclusively, and submissions recheck it', () => {
  const config = policy();
  assert.equal(validateRegistrationPolicy(config, { now: config.opensAt }).valid, true);
  rejected(validateRegistrationPolicy(config, { now: Date.parse(config.opensAt) - 1 }), 'window');
  assert.equal(validate(submission(), config, Date.parse(config.closesAt) - 1).valid, true);
  rejected(validate(submission(), config, config.closesAt), 'policy');
  rejected(validate(submission(), policy({ enabled: false })), 'policy');
});

test('formal envelope requires the configured event and exact, affirmative formal consent', () => {
  rejected(validate(submission({ eventId: 'different-event' })), 'eventId');
  for (const accepted of [false, 'true', 1, null, undefined]) rejected(validate(submission({ consent: { accepted, version: 'privacy-2026-v1' } })), accepted === undefined ? 'payload' : 'consent.accepted');
  for (const version of ['frontend-demo-v1', 'privacy-2026-v2', ' privacy-2026-v1 ', undefined, 1]) rejected(validate(submission({ consent: { accepted: true, version } })), version === undefined ? 'payload' : 'consent.version');
  rejected(validate(submission({ consent: [] })), 'consent.accepted');
  rejected(validate(submission({ fields: [] })), 'fields');
  rejected(validateRegistrationSubmission(submission()), 'policy');
});

test('valid business fields normalize independently, derive one night and use only the server clock', () => {
  const input = submission({
    fields: fields({
      name: '  合成来宾  ', organization: 'Cafe\u0301', categories: ['so', 'new_site', 'sponsor', 'so'],
      participationInterests: ['roundtable', 'talk', 'exhibition', 'sponsorship', 'student_exchange'], accommodationChoice: 'needed', departureCity: ' 合成出发城市 ',
      soRo: { siteName: '合成站点', city: '合成城市', firstYear: 2024, role: 'SO', shareCase: 'yes' },
      newSite: { city: '合成城市', organization: '合成机构', venueReady: 'yes', teamReady: 'uncertain', participating2027: 'yes', supportNeeded: '合成支持需求' },
      speaker: { topic: '合成主题', summary: '合成摘要', language: '中文' },
      exhibitor: { projectType: '合成游戏', summary: '合成作品', attendeeCount: 2 },
      partner: { direction: '合成技术资源', background: '合成机构背景' },
      consentAccepted: true, consentVersion: 'frontend-demo-v1', accommodationNights: 99, accommodationApproval: 'approved', review: { approved: true },
    }),
    consent: { accepted: true, version: 'privacy-2026-v1', acceptedAt: '1900-01-01T00:00:00Z' }, id: 'CLIENT-ID', reference_code: 'CLIENT-REF', admin: true,
  });
  const snapshot = structuredClone(input);
  const result = validate(input);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.value.fields.name, '合成来宾');
  assert.equal(result.value.fields.organization, 'Café');
  assert.deepEqual(result.value.fields.categories, ['so', 'new_site', 'sponsor']);
  assert.equal(result.value.fields.accommodationNights, 1);
  assert.equal(result.value.fields.departureCity, '合成出发城市');
  assert.equal(result.value.fields.soRo.firstYear, 2024);
  assert.equal(result.value.fields.exhibitor.attendeeCount, 2);
  assert.equal(result.value.consent.acceptedAt, '2026-10-19T04:00:00.000Z');
  for (const forbidden of ['id', 'reference_code', 'admin', 'review', 'accommodationApproval', 'consentAccepted', 'consentVersion', 'submissionStatus', 'success']) assert.equal(JSON.stringify(result.value).includes('"' + forbidden + '"'), false, forbidden);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(Object.keys(result.value), ['eventId', 'fields', 'consent']);
});

test('inactive branches and unknown client approvals are discarded, not turned into official outcomes', () => {
  const result = validate(submission({ fields: fields({ speaker: { topic: 'HIDDEN-PRIVATE-TOPIC' }, newSite: { organization: 'HIDDEN-ORG' }, departureCity: 'HIDDEN-CITY', accommodation: { approved: true }, attendeeReviewRequired: true, role: 'admin' }) }));
  assert.equal(result.valid, true);
  assert.equal(result.value.fields.accommodationNights, 0);
  for (const key of ['speaker', 'newSite', 'departureCity', 'accommodation', 'attendeeReviewRequired', 'role']) assert.equal(Object.hasOwn(result.value.fields, key), false);
  assert.equal(JSON.stringify(result).includes('HIDDEN-'), false);
  const active = fields({ participationInterests: ['talk'], speaker: [] });
  rejected(validate(submission({ fields: active })), 'fields.speaker');
});

test('mixed arrays, invalid enums and wrong primitive types fail rather than being filtered into validity', () => {
  for (const categories of [['industry', 1], ['industry', null], ['industry', {}], ['industry', 'invented'], 'industry', [], null]) rejected(validate(submission({ fields: fields({ categories }) })), 'fields.categories');
  for (const cooperationForms of [['promotion', false], ['unknown'], 'promotion']) rejected(validate(submission({ fields: fields({ cooperationForms }) })), 'fields.cooperationForms');
  for (const name of [true, 123, [], {}]) rejected(validate(submission({ fields: fields({ name }) })), 'fields.name');
  rejected(validate(submission({ fields: fields({ attendance: 'approved' }) })), 'fields.attendance');
  rejected(validate(submission({ fields: fields({ organization: null }) })), 'fields.organization');
});

test('server validation enforces text lengths, email, URL protocols, credentials and URL-list limits', () => {
  for (const name of ['一', '字'.repeat(81), '合成\u0000来宾']) rejected(validate(submission({ fields: fields({ name }) })), 'fields.name');
  rejected(validate(submission({ fields: fields({ email: 'PRIVATE-INVALID-EMAIL' }) })), 'fields.email');
  for (const website of ['javascript:alert(1)', 'data:text/html,synthetic', 'file:///tmp/synthetic', 'https://user:pass@example.invalid', 'https://example.\ninvalid']) rejected(validate(submission({ fields: fields({ website }) })), 'fields.website');
  rejected(validate(submission({ fields: fields({ caseLinks: Array(6).fill('https://example.invalid').join('\n') }) })), 'fields.caseLinks');
  rejected(validate(submission({ fields: fields({ caseLinks: 'https://example.invalid\njavascript:alert(1)' }) })), 'fields.caseLinks');
  const valid = validate(submission({ fields: fields({ website: ' https://example.invalid/path ', caseLinks: 'https://example.invalid/a\nhttp://example.invalid/b' }) }));
  assert.equal(valid.valid, true);
  assert.equal(valid.value.fields.website, 'https://example.invalid/path');
});

test('active branches require all relevant fields and strictly bounded JSON integers', () => {
  const base = fields({ categories: ['so'], soRo: { siteName: '合成站点', city: '合成城市', firstYear: 2026, role: 'SO', shareCase: 'yes' } });
  for (const firstYear of ['2026', 2026.5, 1899, 2027, true, null]) rejected(validate(submission({ fields: { ...base, soRo: { ...base.soRo, firstYear } } })), 'fields.soRo.firstYear');
  rejected(validate(submission({ fields: fields({ categories: ['new_site'], newSite: {} }) })), 'fields.newSite.supportNeeded');
  rejected(validate(submission({ fields: fields({ accommodationChoice: 'needed' }) })), 'fields.departureCity');
  for (const attendeeCount of ['2', 1.5, 0, 1001]) rejected(validate(submission({ fields: fields({ participationInterests: ['exhibition'], exhibitor: { projectType: '合成游戏', summary: '合成作品', attendeeCount } }) })), 'fields.exhibitor.attendeeCount');
});

test('only own plain JSON data can satisfy envelope, policy and field requirements; getters never run', () => {
  rejected(validate(Object.create(submission())), 'payload');
  const inherited = Object.create({ enabled: true }); Object.assign(inherited, policy()); delete inherited.enabled;
  rejected(validateRegistrationPolicy(inherited, { now }), 'policy');
  const ownMissing = fields(); delete ownMissing.name;
  Object.defineProperty(ownMissing, 'name', { get() { assert.fail('Getter must never run'); }, enumerable: true });
  rejected(validate(submission({ fields: ownMissing })), 'payload');
  const jsonNullPrototype = Object.assign(Object.create(null), submission());
  assert.equal(validate(jsonNullPrototype).valid, true);
  rejected(validate(submission({ fields: new Date() })), 'payload');
  const cycle = submission(); cycle.unknown = cycle;
  rejected(validate(cycle), 'payload');
  const sparse = submission(); sparse.fields.categories = new Array(1);
  rejected(validate(sparse), 'payload');
});

test('decoded JSON size is bounded and invalid results contain fixed errors without input values', () => {
  rejected(validate(submission({ unknown: '字'.repeat(MAX_REGISTRATION_BYTES / 2) })), 'payload');
  const bad = validate(submission({ fields: fields({ email: 'PRIVATE-INVALID-EMAIL', topics: 'PRIVATE-' + 'X'.repeat(2100) }) }));
  rejected(bad, 'fields.email');
  assert.equal(JSON.stringify(bad).includes('PRIVATE-'), false);
  for (const value of [undefined, null, [], 'PRIVATE-RAW-STRING', 123]) rejected(validate(value), 'payload');
});
