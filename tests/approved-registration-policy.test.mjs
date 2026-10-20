import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedRegistrationPolicy } from '../scripts/approved-registration-policy.mjs';
import { validateRegistrationPolicy } from '../functions/registration-api/policy.mjs';

test('approved policy uses the confirmed noon cutoff, event capacity and protected contact', () => {
  const policy = approvedRegistrationPolicy({ contactEmail: 'synthetic@artdico.co' });
  assert.equal(policy.capacity, 300);
  assert.equal(Date.parse(policy.closesAt), Date.parse('2026-12-05T04:00:00Z'));
  assert.equal(validateRegistrationPolicy(policy, { now: '2026-12-05T03:59:59Z' }).valid, true);
  assert.equal(validateRegistrationPolicy(policy, { now: '2026-12-05T04:00:00Z' }).valid, false);
  for (const contactEmail of [undefined, '', 'synthetic@example.invalid', 'bad\n@artdico.co']) assert.throws(() => approvedRegistrationPolicy({ contactEmail }));
  assert.equal(approvedRegistrationPolicy({ contactEmail: 'synthetic@artdico.co', enabled: false }).enabled, false);
});
