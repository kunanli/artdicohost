import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_VERSION,
  registrationSchema,
  createEmptyRegistration,
  getActiveBranches,
  normalizeRegistration,
  validateRegistration,
  completeMockRegistration,
} from '../shared/registration-schema.mjs';
import { eventConfig, agenda, zones, recruitment, faqItems } from '../src/config/event.mjs';

/** Synthetic data, never real contacts or a submission to any environment. */
function example() {
  return {
    name: '示例来宾', city: '示例城市', organization: '示例创作团队', position: '独立开发者',
    email: 'preview@example.invalid', wechat: '', website: 'https://example.invalid',
    categories: ['industry'], participationInterests: ['attend'], background: '仅用于本地交互测试。',
    caseLinks: '', attendance: 'uncertain', accommodationChoice: 'not_needed', topics: '',
    cooperationInterest: 'learn_more', cooperationForms: [], consentAccepted: true,
  };
}

test('empty form has no preselected consent, categories, participation or attendance', () => {
  const empty = createEmptyRegistration();
  assert.equal(empty.consentAccepted, false);
  assert.equal(empty.attendance, '');
  assert.equal(empty.accommodationChoice, '');
  assert.equal(empty.cooperationInterest, '');
  assert.deepEqual(empty.categories, []);
  assert.deepEqual(empty.participationInterests, []);
  assert.equal(validateRegistration(empty).valid, false);
  assert.equal(registrationSchema.baseFields.length, 18);
});

test('valid email is the alternative contact when WeChat is omitted; short background remains a recommendation', () => {
  const result = validateRegistration(example());
  assert.equal(result.valid, true);
  assert.equal(result.value.wechat, '');
  assert.ok(String(result.value.background).length < 30);
  const withoutEmail = validateRegistration({ ...example(), email: '', wechat: 'demonstration-only' });
  assert.equal(withoutEmail.valid, false);
  assert.ok(withoutEmail.errors.email);
});

test('consent requires a real boolean true and cannot be provided by a truthy form string', () => {
  for (const consentAccepted of [false, 'on', 'true', 1, null, undefined]) {
    const result = validateRegistration({ ...example(), consentAccepted });
    assert.ok(result.errors.consentAccepted, `reject ${String(consentAccepted)}`);
  }
  const value = normalizeRegistration({ ...example(), consentVersion: 'attacker-version' });
  assert.equal(value.consentVersion, CONSENT_VERSION);
});

test('all role and participation branches can coexist in one registration', () => {
  const input = {
    ...example(),
    categories: ['so', 'ro', 'new_site', 'partner'],
    participationInterests: ['talk', 'exhibition', 'partnership'],
    accommodationChoice: 'needed', departureCity: '示例出发城市', accommodationNights: 99,
    soRo: { siteName: '示例站点', city: '示例城市', firstYear: '2020', role: '历史 SO', shareCase: 'yes' },
    newSite: { city: '示例城市', organization: '示例团队', venueReady: 'uncertain', teamReady: 'yes', participating2027: 'yes', supportNeeded: '组织经验交流' },
    speaker: { topic: '示例分享主题', summary: '示例摘要', language: '简体中文', caseLinks: 'https://example.invalid/work' },
    exhibitor: { projectType: '游戏试玩', summary: '示例作品', links: '', attendeeCount: '2', equipment: '暂不确定' },
    partner: { direction: '教育交流', resources: '', background: '示例机构背景' },
  };
  const result = validateRegistration(input);
  assert.deepEqual(getActiveBranches(input), ['soRo', 'newSite', 'speaker', 'exhibitor', 'partner', 'accommodation']);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.value.accommodationNights, 1);
  assert.deepEqual(result.value.categories, ['so', 'ro', 'new_site', 'partner']);
  assert.equal(Array.isArray(result.value), false);
});

test('branch activation is driven by roles and interests, including partner interest without partner identity', () => {
  assert.deepEqual(getActiveBranches({ ...example(), categories: ['so', 'ro'] }), ['soRo']);
  assert.deepEqual(getActiveBranches({ ...example(), participationInterests: ['partnership'] }), ['partner']);
  assert.deepEqual(getActiveBranches({ ...example(), categories: ['partner'] }), ['partner']);
  assert.deepEqual(getActiveBranches({ ...example(), categories: ['sponsor'] }), ['partner']);
  assert.deepEqual(getActiveBranches({ ...example(), participationInterests: ['sponsorship'] }), ['partner']);
  assert.deepEqual(getActiveBranches({ ...example(), participationInterests: ['talk', 'exhibition'] }), ['speaker', 'exhibitor']);
  const missing = validateRegistration({ ...example(), participationInterests: ['talk'] });
  assert.ok(missing.errors['speaker.topic']);
  assert.ok(missing.errors['speaker.summary']);
  assert.ok(missing.errors['speaker.language']);
});

test('ordinary attendance needs no speaker, sponsor or invitation approval', () => {
  const result = validateRegistration(example());
  assert.equal(result.valid, true);
  assert.deepEqual(getActiveBranches(result.value), []);
  assert.equal(registrationSchema.attendeeReviewRequired, false);
  assert.equal(registrationSchema.attendanceAcceptance, 'after_successful_persistence');
  assert.equal(eventConfig.registration.attendeeReviewRequired, false);
  assert.equal(eventConfig.registration.acceptancePolicy, 'after_successful_persistence');
  assert.equal(Object.hasOwn(result.value, 'review_status'), false);
  assert.equal(Object.hasOwn(result.value, 'invitation_status'), false);
  assert.equal(completeMockRegistration(result.value).submissionStatus, 'not_submitted');
});

test('existing site leaders and prospective GGJ sites remain independent multiselect branches', () => {
  const input = {
    ...example(), categories: ['so', 'ro', 'new_site'],
    soRo: { siteName: '示例既有站点', city: '示例城市', firstYear: '2020', role: '现任 SO，曾任 RO', history: '合成的组织历史说明', shareCase: 'yes' },
    newSite: { city: '示例新城市', organization: '示例筹备机构', venueReady: 'no', teamReady: 'uncertain', participating2027: 'yes', supportNeeded: '场地与组织经验支持' },
  };
  const result = validateRegistration(input);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(getActiveBranches(result.value), ['soRo', 'newSite']);
  assert.equal(/** @type {Record<string,unknown>} */ (result.value.soRo).history, '合成的组织历史说明');
  assert.equal(/** @type {Record<string,unknown>} */ (result.value.newSite).venueReady, 'no');
  assert.equal(Object.hasOwn(result.value, 'official_site_approved'), false);
  assert.equal(Object.hasOwn(result.value, 'service_award'), false);
  assert.deepEqual(eventConfig.siteRegistration.existing.categories, ['so', 'ro']);
  assert.deepEqual(eventConfig.siteRegistration.prospective.categories, ['new_site']);
  assert.ok(faqItems.some((item) => item.question.includes('已经是站点负责人')));
});

test('speaker and sponsorship recruitment stays unconfirmed and separate from attendance acceptance', () => {
  assert.equal(recruitment.speakers.status, 'recruiting');
  assert.equal(recruitment.speakers.interestValue, 'talk');
  assert.equal(recruitment.sponsors.status, 'recruiting');
  assert.equal(recruitment.sponsors.interestValue, 'sponsorship');
  assert.equal(Object.hasOwn(recruitment.sponsors, 'price'), false);
  assert.equal(Object.hasOwn(recruitment.sponsors, 'benefits'), false);
  assert.equal(Object.hasOwn(recruitment.sponsors, 'confirmedSponsors'), false);
  assert.deepEqual(eventConfig.guests.people, []);
  for (const id of ['speaker-one', 'speaker-two', 'speaker-three']) {
    assert.match(agenda.find((slot) => slot.id === id)?.A ?? '', /讲者待定/u);
  }
});

test('deselecting branches discards stale hidden answers and cannot preserve administrator fields', () => {
  const result = validateRegistration({
    ...example(), soRo: { siteName: 'stale', firstYear: 'not a year' },
    'speaker.topic': 'stale topic', speaker: { summary: 'stale summary' },
    exhibitor: { attendeeCount: '-1' }, partner: { resources: 'stale private material' },
    departureCity: 'stale city', accommodationNights: 50,
    review_status: 'approved', accommodation_status: 'approved', role: 'superadmin',
  });
  assert.equal(result.valid, true);
  for (const key of ['soRo', 'speaker', 'exhibitor', 'partner', 'departureCity', 'review_status', 'accommodation_status', 'role']) {
    assert.equal(Object.hasOwn(result.value, key), false, key);
  }
  assert.equal(result.value.accommodationNights, 0);
});

test('accommodation is conditional and always one night, never an approval', () => {
  const needsCity = validateRegistration({ ...example(), accommodationChoice: 'needed' });
  assert.ok(needsCity.errors.departureCity);
  const requested = validateRegistration({ ...example(), accommodationChoice: 'needed', departureCity: '示例城市', accommodationNights: 2 });
  assert.equal(requested.valid, true);
  assert.equal(requested.value.accommodationNights, 1);
  const uncertain = normalizeRegistration({ ...example(), accommodationChoice: 'uncertain', departureCity: 'stale' });
  assert.equal(Object.hasOwn(uncertain, 'departureCity'), false);
  assert.equal(uncertain.accommodationNights, 0);
  assert.equal(Object.hasOwn(requested.value, 'accommodationApproved'), false);
});

test('validates URL protocols, embedded credentials, URL lists, email, enum values and Unicode lengths', () => {
  for (const website of ['javascript:alert(1)', 'data:text/html,hello', 'ftp://example.invalid', 'https://name:password@example.invalid']) {
    assert.ok(validateRegistration({ ...example(), website }).errors.website, website);
  }
  assert.ok(validateRegistration({ ...example(), caseLinks: 'https://example.invalid\njavascript:alert(1)' }).errors.caseLinks);
  assert.ok(validateRegistration({ ...example(), caseLinks: Array(6).fill('https://example.invalid').join('\n') }).errors.caseLinks);
  assert.ok(validateRegistration({ ...example(), email: 'not-an-email' }).errors.email);
  assert.ok(validateRegistration({ ...example(), categories: ['superadmin'] }).errors.categories);
  assert.ok(validateRegistration({ ...example(), attendance: 'approved' }).errors.attendance);
  assert.ok(validateRegistration({ ...example(), participationInterests: ['unknown'] }).errors.participationInterests);
  assert.ok(validateRegistration({ ...example(), name: '李' }).errors.name);
  assert.equal(validateRegistration({ ...example(), name: '𠮷野' }).valid, true);
  assert.ok(validateRegistration({ ...example(), name: '李'.repeat(81) }).errors.name);
});

test('normalization deduplicates choices, trims values and supports dotted form branch names', () => {
  const result = validateRegistration({
    ...example(), name: '  示例来宾  ', categories: ['industry', 'industry'], participationInterests: ['exhibition'],
    'exhibitor.projectType': '游戏', 'exhibitor.summary': '示例作品', 'exhibitor.links': 'https://example.invalid',
    'exhibitor.attendeeCount': '2', 'exhibitor.equipment': '',
  });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.value.name, '示例来宾');
  assert.deepEqual(result.value.categories, ['industry']);
  assert.deepEqual(result.value.exhibitor, { projectType: '游戏', summary: '示例作品', links: 'https://example.invalid', attendeeCount: '2', equipment: '' });
  const invalid = validateRegistration({ ...result.value, 'exhibitor.attendeeCount': '1.5' });
  assert.ok(invalid.errors['exhibitor.attendeeCount']);
});

test('mock completion never claims a submission, emits personal data, or returns a reference number', () => {
  const complete = completeMockRegistration(example());
  assert.equal(complete.valid, true);
  assert.equal(complete.mode, 'mock');
  assert.equal(complete.submissionStatus, 'not_submitted');
  assert.match(complete.message, /没有发送或保存/u);
  assert.equal(Object.hasOwn(complete, 'value'), false);
  assert.equal(Object.hasOwn(complete, 'reference_code'), false);
  assert.equal(JSON.stringify(complete).includes('preview@example.invalid'), false);
  const invalid = completeMockRegistration({ ...example(), consentAccepted: false });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.submissionStatus, 'not_submitted');
  assert.equal(registrationSchema.submissionEnabled, false);
});

test('public event config keeps tentative facts, privacy, map and production registration disabled', () => {
  assert.equal(eventConfig.status, 'tentative');
  assert.equal(eventConfig.date.status, 'tentative');
  assert.equal(eventConfig.registration.productionSubmissionEnabled, false);
  assert.equal(eventConfig.registration.mode, 'mock');
  assert.equal(eventConfig.venue.mapUrl, null);
  assert.equal(eventConfig.privacy.contactEmail, null);
  assert.equal(eventConfig.accommodation.nights, 1);
  assert.deepEqual(eventConfig.guests.people, []);
  assert.equal(eventConfig.attribution.status, 'pending');
  assert.equal(JSON.stringify(eventConfig).includes('20 间'), false);
});

test('all 15 agenda slots cover three zones contiguously, retaining student showcase and feedback', () => {
  assert.equal(agenda.length, 15);
  assert.deepEqual(zones.map((zone) => zone.id), ['A', 'B', 'C']);
  assert.equal(agenda[0].start, '09:30');
  assert.equal(agenda.at(-1)?.end, '18:00');
  for (const [index, slot] of agenda.entries()) {
    assert.equal(slot.tentative, true);
    assert.ok(slot.A && slot.B && slot.C);
    assert.equal(slot.time, `${slot.start}–${slot.end}`);
    if (index > 0) assert.equal(agenda[index - 1].end, slot.start);
  }
  assert.equal(agenda.find((slot) => slot.start === '15:30')?.A, 'ARTDiCO HOST 学员作品分享');
  assert.equal(agenda.find((slot) => slot.start === '16:30')?.C, '学生作品体验与反馈');
  assert.equal(agenda.find((slot) => slot.start === '12:00')?.B, '暂停研讨');
});
