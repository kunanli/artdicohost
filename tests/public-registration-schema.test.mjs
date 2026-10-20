import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationSchema, getActiveBranches, validateRegistration } from '../shared/registration-schema.mjs';
import { publicRegistrationSchema, getRecruitmentChoices } from '../shared/public-registration-schema.mjs';

const example = () => ({
  name: '合成来宾', city: '合成城市', organization: '合成团队', position: '开发者',
  email: 'example@example.com', wechat: '', website: '', background: '合成交流经历', caseLinks: '',
  categories: ['other'], participationInterests: ['attend'], attendance: 'expected',
  accommodationChoice: 'not_needed', topics: '', cooperationInterest: 'learn_more', cooperationForms: [], consentAccepted: true,
});

test('public projection removes discontinued offers while preserving historical validation values', () => {
  const original = JSON.stringify(registrationSchema);
  const fields = publicRegistrationSchema.baseFields;
  for (const name of ['categories', 'participationInterests', 'cooperationForms']) {
    const projected = fields.find(field => field.name === name);
    const historical = registrationSchema.baseFields.find(field => field.name === name);
    assert.ok(projected.options.every(option => historical.options.some(previous => previous.value === option.value)));
    assert.equal(projected.options.some(option => ['sponsor', 'sponsorship', 'funding'].includes(option.value)), false);
  }
  assert.doesNotMatch(JSON.stringify(publicRegistrationSchema), /赞助|资金|sponsor|sponsorship|funding/u);
  assert.ok(registrationSchema.identityOptions.some(option => option.value === 'sponsor'));
  assert.ok(registrationSchema.participationOptions.some(option => option.value === 'sponsorship'));
  assert.ok(registrationSchema.baseFields.find(field => field.name === 'cooperationForms').options.some(option => option.value === 'funding'));
  assert.deepEqual(getActiveBranches({ categories: ['sponsor'] }), ['partner']);
  assert.equal(JSON.stringify(registrationSchema), original);
});

test('public labels preserve every field, required answer and existing validation constraint', () => {
  const constraints = ({ label, hint, options, ...field }) => field;
  assert.deepEqual(publicRegistrationSchema.baseFields.map(constraints), registrationSchema.baseFields.map(constraints));
  for (const [name, branch] of Object.entries(publicRegistrationSchema.branches)) {
    assert.deepEqual(branch.fields.map(constraints), registrationSchema.branches[name].fields.map(constraints));
  }
  assert.equal(publicRegistrationSchema.branches.partner.label, '社群交流（另行沟通）');
  assert.equal(validateRegistration(example()).valid, true);
  const partner = { ...example(), categories: ['partner'] };
  assert.deepEqual(Object.keys(validateRegistration(partner).errors).sort(), ['partner.background', 'partner.direction']);
  assert.equal(validateRegistration({ ...partner, partner: { direction: '合成社群交流', background: '合成机构背景' } }).valid, true);
  assert.equal(publicRegistrationSchema.mode, 'mock');
  assert.equal(publicRegistrationSchema.submissionEnabled, false);
});

test('speaker, site and student CTAs select only their explicit supported interests', () => {
  assert.deepEqual(getRecruitmentChoices('speaker'), { categories: [], participationInterests: ['talk'] });
  assert.deepEqual(getRecruitmentChoices('site'), { categories: ['new_site'], participationInterests: ['site_support'] });
  assert.deepEqual(getRecruitmentChoices('student'), { categories: [], participationInterests: ['student_exchange', 'exhibition'] });
  assert.deepEqual(getActiveBranches({ ...example(), ...getRecruitmentChoices('site') }), ['newSite']);
  const student = { ...example(), participationInterests: getRecruitmentChoices('student').participationInterests };
  assert.deepEqual(getActiveBranches(student), ['exhibitor']);
  assert.ok(Object.hasOwn(validateRegistration(student).errors, 'exhibitor.summary'));
  assert.equal(validateRegistration({ ...student, exhibitor: { projectType: '合成游戏', summary: '合成作品说明', attendeeCount: '2' } }).valid, true);
  const first = getRecruitmentChoices('student');
  first.participationInterests.push('talk');
  assert.deepEqual(getRecruitmentChoices('student').participationInterests, ['student_exchange', 'exhibition']);
  for (const unknown of [undefined, null, '', 'sponsor', 'unexpected', '__proto__', 'constructor', {}, ['student']]) {
    assert.equal(getRecruitmentChoices(unknown), null);
  }
});
