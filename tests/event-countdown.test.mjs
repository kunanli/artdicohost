import test from 'node:test';
import assert from 'node:assert/strict';
import { eventCountdown } from '../shared/event-countdown.mjs';

const opening = Date.parse('2026-12-05T10:00:00+08:00');
const closing = Date.parse('2026-12-05T18:00:00+08:00');

test('countdown uses the confirmed opening instant in Beijing time and carries day/hour boundaries', () => {
  assert.equal(opening, Date.parse('2026-12-05T02:00:00Z'));
  assert.deepEqual(eventCountdown(opening - (2 * 86_400 + 3 * 3600 + 4 * 60 + 5) * 1000, opening, closing), {
    phase: 'upcoming', totalSeconds: 183845, days: 2, hours: 3, minutes: 4, seconds: 5,
  });
  assert.deepEqual(eventCountdown(opening - 86_400_000, opening, closing), {
    phase: 'upcoming', totalSeconds: 86400, days: 1, hours: 0, minutes: 0, seconds: 0,
  });
  assert.deepEqual(eventCountdown(opening - 86_399_000, opening, closing), {
    phase: 'upcoming', totalSeconds: 86399, days: 0, hours: 23, minutes: 59, seconds: 59,
  });
});

test('the final fractional second never becomes a fake zero or a negative countdown', () => {
  assert.deepEqual(eventCountdown(opening - 1, opening, closing), {
    phase: 'upcoming', totalSeconds: 1, days: 0, hours: 0, minutes: 0, seconds: 1,
  });
  assert.deepEqual(eventCountdown(opening, opening, closing), { phase: 'live' });
  assert.deepEqual(eventCountdown(closing - 1, opening, closing), { phase: 'live' });
  assert.deepEqual(eventCountdown(closing, opening, closing), { phase: 'ended' });
  assert.deepEqual(eventCountdown(closing + 86_400_000, opening, closing), { phase: 'ended' });
});

test('missing or invalid instants are unavailable instead of invented display values', () => {
  for (const invalid of [undefined, null, '2026-12-05', NaN, Infinity, -Infinity, Number.MAX_VALUE, -Number.MAX_VALUE, {}, []]) {
    assert.deepEqual(eventCountdown(invalid, opening, closing), { phase: 'unavailable' });
    assert.deepEqual(eventCountdown(opening - 1, invalid, closing), { phase: 'unavailable' });
    assert.deepEqual(eventCountdown(opening - 1, opening, invalid), { phase: 'unavailable' });
  }
  assert.deepEqual(eventCountdown(opening - 1, opening, opening), { phase: 'unavailable' });
  assert.deepEqual(eventCountdown(opening - 1, closing, opening), { phase: 'unavailable' });
});
