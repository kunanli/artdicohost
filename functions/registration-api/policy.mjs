/** Pure configuration preflight only. This does not open an API or establish cloud readiness. */
export function plainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  try { const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }
  catch { return false; }
}

/** Read only own data properties; inherited values and accessors cannot satisfy the contract. */
export function own(value, key) {
  if (!plainObject(value)) return undefined;
  try { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor?.enumerable && 'value' in descriptor ? descriptor.value : undefined; }
  catch { return undefined; }
}

/** Explicit-offset ISO timestamps, with real calendar dates and no rollover or implicit timezone. */
export function parseTimestamp(value) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!parts) return null;
  const [, y, m, d, h, minutes, seconds, fraction = '', offset] = parts;
  const [year, month, day, hour, minute, second] = [y, m, d, h, minutes, seconds].map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, Number(fraction.padEnd(3, '0')));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  const offsetHours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHours > 14 || offsetMinutes > 59 || offsetHours === 14 && offsetMinutes !== 0) return null;
  const delta = (offsetHours * 60 + offsetMinutes) * (offset.startsWith('-') ? -1 : 1);
  const instant = date.getTime() - delta * 60_000;
  const utcYear = new Date(instant).getUTCFullYear();
  return utcYear >= 0 && utcYear <= 9999 ? instant : null;
}

/** A caller must supply a clock reading, never a client timestamp or an implicit system clock. */
export function clockTime(now) {
  if (typeof now === 'number') return Number.isSafeInteger(now) && Number.isFinite(new Date(now).getTime()) ? now : null;
  return parseTimestamp(now);
}

function policyText(value, maximum = 4000) {
  if (typeof value !== 'string') return null;
  const text = value.normalize('NFC').trim();
  return text && [...text].length <= maximum && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) ? text : null;
}

/**
 * Validates server-owned policy and its registration window, not deployment or data persistence.
 * No default policy, formal consent version, privacy facts, or clock is invented.
 */
export function validateRegistrationPolicy(config, { now } = {}) {
  const errors = {};
  if (!plainObject(config)) return { valid: false, errors: { policy: '请提供完整的服务端报名配置。' } };
  const eventId = own(config, 'eventId');
  const opening = parseTimestamp(own(config, 'opensAt'));
  const closing = parseTimestamp(own(config, 'closesAt'));
  const current = clockTime(now);
  if (own(config, 'enabled') !== true) errors.enabled = '正式报名开关尚未启用。';
  if (typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)) errors.eventId = '请配置有效的活动 ID。';
  if (opening === null) errors.opensAt = '请配置含时区偏移的有效开放时间。';
  if (closing === null) errors.closesAt = '请配置含时区偏移的有效截止时间。';
  if (opening !== null && closing !== null && closing <= opening) errors.closesAt = '截止时间须晚于开放时间。';
  if (current === null) errors.now = '请提供有效的服务端时钟读数。';
  else if (opening !== null && closing !== null && (current < opening || current >= closing)) errors.window = '当前不在报名开放时间内。';
  const source = own(config, 'privacy');
  const privacy = {};
  for (const key of ['version', 'processor', 'contactEmail', 'purpose', 'storageRegion', 'retention', 'rightsRequest', 'sharing']) {
    const value = policyText(own(source, key), key === 'version' ? 100 : 4000);
    if (!value) errors[`privacy.${key}`] = '请完整配置正式个人信息处理告知。';
    else privacy[key] = value;
  }
  if (privacy.version && (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(privacy.version) || /demo|frontend|mock/iu.test(privacy.version))) errors['privacy.version'] = '请配置正式告知版本，不能使用演示版本。';
  if (privacy.contactEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(privacy.contactEmail)) errors['privacy.contactEmail'] = '请配置有效的隐私联系邮箱。';
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, errors, value: { enabled: true, eventId, opensAt: new Date(opening).toISOString(), closesAt: new Date(closing).toISOString(), privacy } };
}
