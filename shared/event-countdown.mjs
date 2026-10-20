/** Derive display values from actual instants; this module performs no I/O. */
export function eventCountdown(now, startsAt, endsAt) {
  if (![now, startsAt, endsAt].every(value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8_640_000_000_000_000) || endsAt <= startsAt) {
    return { phase: 'unavailable' };
  }
  if (now >= endsAt) return { phase: 'ended' };
  if (now >= startsAt) return { phase: 'live' };
  // A partial last second remains one second until the opening instant arrives.
  const totalSeconds = Math.ceil((startsAt - now) / 1000);
  return {
    phase: 'upcoming', totalSeconds,
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
  };
}
