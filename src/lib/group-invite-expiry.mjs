const MINUTE = 60_000, DAY = 86_400_000, OFFSET = 8 * 3_600_000;
export const GROUP_INVITE_MAX_AGE_MS = 7 * DAY;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;
const instant = value => typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value ? Date.parse(value) : null;
const localMinute = value => new Date(value + OFFSET).toISOString().slice(0, 16);

/** Read-only display state uses the server clock, never the device wall clock. */
export function groupInviteStatus(state, elapsedMs = 0) {
  const unavailable = { kind: 'unavailable', expiresAt: null };
  if (!state || typeof state.configured !== 'boolean' || typeof state.expired !== 'boolean'
    || !Number.isFinite(elapsedMs) || elapsedMs < 0) return unavailable;
  if (!state.configured) return { kind: 'missing', expiresAt: null };
  const expiry = instant(state.expiresAt), server = instant(state.serverTime);
  if (expiry === null) return unavailable;
  if (state.expired) return { kind: 'expired', expiresAt: state.expiresAt };
  if (server === null) return unavailable;
  const remaining = expiry - server - elapsedMs;
  return { kind: remaining <= 0 ? 'expired' : remaining <= DAY ? 'expiring' : 'ready', expiresAt: state.expiresAt };
}

/** Server-owned rolling window, advanced only by measured monotonic elapsed time.
 * The browser wall clock and its timezone do not decide the accepted range. */
export function groupInviteExpiryBounds(state, elapsedMs = 0) {
  if (!state || typeof state !== 'object' || !Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  const server = instant(state.serverTime), maximum = instant(state.maxExpiresAt);
  if (server === null || server < 0 || maximum === null || maximum - server !== GROUP_INVITE_MAX_AGE_MS) return null;
  const now = server + elapsedMs, latest = maximum + elapsedMs;
  if (!Number.isFinite(new Date(latest + OFFSET).getTime())) return null;
  const min = localMinute(Math.floor(now / MINUTE) * MINUTE + MINUTE), max = localMinute(Math.floor(latest / MINUTE) * MINUTE);
  return { now, latest, min, max, defaultValue: max, maxLabel: max.replace('T', ' ') + '（UTC+8）' };
}

/** Floor each preset to the input's minute precision so the seven-day choice
 * can never overshoot the server's maximum by hidden seconds or milliseconds. */
export function groupInviteExpiryPreset(bounds, days = 7) {
  if (!bounds || !Number.isFinite(bounds.now) || !Number.isFinite(bounds.latest) || !Number.isInteger(days) || days < 1 || days > 7) return '';
  return localMinute(Math.floor(Math.min(bounds.now + days * DAY, bounds.latest) / MINUTE) * MINUTE);
}

/** Validation is read-only: rejected dates and the selected image stay in the form. */
export function validateGroupInviteExpiry(value, bounds) {
  if (!bounds || !Number.isFinite(bounds.now) || !Number.isFinite(bounds.latest)) return { valid: false, expiresAt: null, message: '请先刷新群码状态，读取服务器时间后再保存。' };
  if (typeof value !== 'string' || !LOCAL.test(value)) return { valid: false, expiresAt: null, message: '请填写准确的到期日期与时间（北京时间 UTC+8）。' };
  const at = Date.parse(value + ':00+08:00');
  if (!Number.isFinite(at) || localMinute(at) !== value) return { valid: false, expiresAt: null, message: '请填写有效的到期日期与时间（北京时间 UTC+8）。' };
  if (at <= bounds.now) return { valid: false, expiresAt: null, message: '到期时间须晚于服务器当前时间，请选择稍后的时间。' };
  if (at > bounds.latest) return { valid: false, expiresAt: null, message: '最晚可选 ' + bounds.maxLabel + '。七天从当前时刻计算，不能延长到第七天结束。' };
  return { valid: true, expiresAt: new Date(at).toISOString(), message: '' };
}
