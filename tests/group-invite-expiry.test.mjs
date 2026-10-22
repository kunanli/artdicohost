import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_INVITE_MAX_AGE_MS, groupInviteExpiryBounds, groupInviteExpiryPreset, validateGroupInviteExpiry } from '../src/lib/group-invite-expiry.mjs';

const state = { serverTime: '2026-10-22T01:05:35.123Z', maxExpiresAt: '2026-10-29T01:05:35.123Z' };

test('group expiry uses server time and explicit UTC+8 minute precision', () => {
  const bounds = groupInviteExpiryBounds(state);
  assert.equal(bounds.now, Date.parse(state.serverTime));
  assert.equal(bounds.latest - bounds.now, GROUP_INVITE_MAX_AGE_MS);
  assert.equal(bounds.min, '2026-10-22T09:06');
  assert.equal(bounds.max, '2026-10-29T09:05');
  assert.equal(bounds.defaultValue, bounds.max);
  assert.equal(bounds.maxLabel, '2026-10-29 09:05（UTC+8）');
  assert.deepEqual(validateGroupInviteExpiry(bounds.defaultValue, bounds), { valid: true, expiresAt: '2026-10-29T01:05:00.000Z', message: '' });
});

test('group expiry presets stay within the rolling cap and do not infer calendar end-of-day', () => {
  const bounds = groupInviteExpiryBounds(state);
  for (const [days, value] of [[1, '2026-10-23T09:05'], [3, '2026-10-25T09:05'], [7, '2026-10-29T09:05']]) {
    assert.equal(groupInviteExpiryPreset(bounds, days), value);
    assert.equal(validateGroupInviteExpiry(value, bounds).valid, true);
  }
  const rejected = validateGroupInviteExpiry('2026-10-29T23:59', bounds);
  assert.equal(rejected.valid, false);
  assert.match(rejected.message, /2026-10-29 09:05/u);
  assert.match(rejected.message, /当前时刻/u);
  for (const days of [0, 8, -1, 1.5, NaN, '7']) assert.equal(groupInviteExpiryPreset(bounds, days), '');
});

test('monotonic elapsed time advances both boundaries without using a browser wall clock', () => {
  const elapsed = 2 * 86_400_000 + 30_000, bounds = groupInviteExpiryBounds(state, elapsed);
  assert.equal(bounds.min, '2026-10-24T09:07');
  assert.equal(bounds.max, '2026-10-31T09:06');
  assert.equal(validateGroupInviteExpiry('2026-10-23T09:05', bounds).valid, false);
  assert.equal(validateGroupInviteExpiry(groupInviteExpiryPreset(bounds, 7), bounds).valid, true);
  assert.equal(state.serverTime, '2026-10-22T01:05:35.123Z');
});

test('invalid or absent server metadata cannot grant an invented expiry window', () => {
  for (const value of [null, {}, { ...state, serverTime: undefined }, { ...state, serverTime: '2026-02-30T01:05:35.123Z' },
    { ...state, maxExpiresAt: '2026-10-30T01:05:35.123Z' }, { ...state, maxExpiresAt: '2026-10-29T01:05:35Z' }]) assert.equal(groupInviteExpiryBounds(value), null);
  for (const elapsed of [-1, NaN, Infinity, '1']) assert.equal(groupInviteExpiryBounds(state, elapsed), null);
  assert.equal(validateGroupInviteExpiry('2026-10-23T09:05', null).valid, false);
  assert.match(validateGroupInviteExpiry('2026-10-23T09:05', null).message, /服务器时间/u);
});

test('invalid calendar dates, implicit timezones and past minutes fail without changing the input', () => {
  const bounds = groupInviteExpiryBounds(state);
  for (const value of ['', '2026-10-23', '2026-10-23T09:05:00', '2026-10-23T09:05Z', '2026-02-30T09:05', '2026-10-22T09:05', '2026-10-21T09:05']) {
    const original = value, result = validateGroupInviteExpiry(value, bounds);
    assert.equal(result.valid, false, value);assert.equal(result.expiresAt, null);assert.equal(value, original);
  }
  assert.equal(validateGroupInviteExpiry(bounds.min, bounds).valid, true);
});
