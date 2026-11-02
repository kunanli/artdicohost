import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedRegistrationPolicy, approvedAdmissionDefaults } from '../scripts/approved-registration-policy.mjs';
import { validateRegistrationPolicy } from '../functions/registration-api/policy.mjs';

test('approved policy preserves event terms and uses public contact independently of staff identity', () => {
  const policy = approvedRegistrationPolicy();
  assert.equal(policy.enabled, true);
  assert.equal(policy.eventId, 'ggj-cn-2026');
  assert.equal(policy.opensAt, '2026-10-20T00:00:00+08:00');
  assert.equal(policy.privacy.version, 'artdico-registration-2026-10-20-v1');
  assert.equal(policy.privacy.contactEmail, 'kunan@globalgamejam.org');
  assert.equal(policy.capacity, 300);
  assert.equal(policy.attendeeReviewRequired, false);
  assert.equal(validateRegistrationPolicy(policy, { now: policy.opensAt }).value.attendeeReviewRequired, false);
  assert.equal(Date.parse(policy.closesAt), Date.parse('2026-12-05T04:00:00Z'));
  assert.equal(validateRegistrationPolicy(policy, { now: '2026-12-05T03:59:59Z' }).valid, true);
  assert.equal(validateRegistrationPolicy(policy, { now: '2026-12-05T04:00:00Z' }).valid, false);
  assert.equal(approvedRegistrationPolicy({ enabled: false }).enabled, false);
  assert.equal(approvedRegistrationPolicy({ enabled: false }).privacy.contactEmail, 'kunan@globalgamejam.org');
  assert.deepEqual(approvedAdmissionDefaults(), { staffReserve: 0, waitlistEnabled: true });
  assert.deepEqual(approvedAdmissionDefaults({ enabled: false }), { staffReserve: 0, waitlistEnabled: false });
});
