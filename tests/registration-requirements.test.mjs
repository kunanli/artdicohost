import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationSchema, isRegistrationFieldRequired, validateRegistration } from '../shared/registration-schema.mjs';
import { validateRegistrationSubmission } from '../functions/registration-api/validation.mjs';

const now = Date.parse('2026-10-20T10:00:00Z');
const policy = { enabled: true, eventId: 'synthetic-2026', opensAt: '2026-10-19T00:00:00+08:00', closesAt: '2026-12-05T12:00:00+08:00',
  privacy: { version: 'synthetic-policy-v1', processor: '合成处理者', contactEmail: 'privacy@example.invalid', purpose: '合成报名', storageRegion: '合成地区', retention: '合成期限', rightsRequest: '合成权利申请', sharing: '合成不分享' } };
const ordinary = () => ({ name: '合成观众', city: '深圳', email: 'synthetic@example.invalid', categories: ['other'], participationInterests: ['attend'],
  attendance: 'expected', accommodationChoice: 'not_needed', cooperationInterest: 'none', consentAccepted: true });
const server = fields => validateRegistrationSubmission({ eventId: policy.eventId, fields, consent: { accepted: true, version: policy.privacy.version } }, { policy, now });
const definition = name => registrationSchema.baseFields.find(field => field.name === name);

test('ordinary attendees can omit organization, position and background in both browser and strict server validation', () => {
  const input = ordinary();
  assert.equal(validateRegistration(input).valid, true); assert.equal(server(input).valid, true);
  for (const name of ['organization', 'position', 'background']) assert.equal(isRegistrationFieldRequired(definition(name), input), false);
  for (const name of ['name', 'city', 'email', 'categories', 'participationInterests']) {
    const value = ordinary(); delete value[name];
    assert.equal(validateRegistration(value).valid, false); assert.equal(server(value).valid, false);
  }
});

test('actual speaker, exhibitor and cooperation branches require the same relevant profile fields on both boundaries', () => {
  for (const [field, value, branch] of [['participationInterests', ['talk'], 'speaker'], ['participationInterests', ['exhibition'], 'exhibitor'], ['categories', ['partner'], 'partner']]) {
    const input = { ...ordinary(), [field]: value };
    for (const name of ['organization', 'position', 'background']) {
      assert.equal(isRegistrationFieldRequired(definition(name), input), true, branch + ':' + name);
      assert.ok(validateRegistration(input).errors[name]); assert.ok(server(input).errors['fields.' + name]);
    }
  }
  const input = { ...ordinary(), participationInterests: ['talk'], organization: '合成团队', position: '开发者', background: '合成经历',
    speaker: { topic: '合成主题', summary: '合成摘要', language: '中文' } };
  assert.equal(validateRegistration(input).valid, true); assert.equal(server(input).valid, true);
  assert.equal(isRegistrationFieldRequired(registrationSchema.branches.speaker.fields[0], ordinary(), 'speaker'), false);
  assert.equal(isRegistrationFieldRequired(registrationSchema.branches.speaker.fields[0], input, 'speaker'), true);
});

test('previously valid ordinary payloads preserve supplied details and branch switches do not turn optional malformed values valid', () => {
  const input = { ...ordinary(), organization: '已有机构', position: '已有职位', background: '已有简介' };
  const result = server(input); assert.equal(result.valid, true);
  for (const name of ['organization', 'position', 'background']) assert.equal(result.value.fields[name], input[name]);
  assert.equal(server({ ...ordinary(), organization: null }).valid, false);
  assert.equal(server({ ...ordinary(), website: 'javascript:alert(1)' }).valid, false);
  assert.equal(validateRegistration({ ...ordinary(), website: 'javascript:alert(1)' }).valid, false);
});
