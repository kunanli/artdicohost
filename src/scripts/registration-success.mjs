const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const GROUP_FALLBACK = '报名已完成，入群二维码暂时无法显示。请保留报名编号，无需重复报名。';

function own(value, key) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const property = Object.getOwnPropertyDescriptor(value, key);
    return property?.enumerable && 'value' in property ? property.value : undefined;
  } catch { return undefined; }
}

/** Expiry display only: explicit-offset ISO time with a real calendar date. */
function expiryTime(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, fraction = '', offset] = match;
  const numbers = [year, month, day, hour, minute, second].map(Number);
  const [y, m, d, h, minutes, seconds] = numbers;
  if (m < 1 || m > 12 || d < 1 || h > 23 || minutes > 59 || seconds > 59) return null;
  const calendar = new Date(0);
  calendar.setUTCFullYear(y, m - 1, d);
  calendar.setUTCHours(h, minutes, seconds, Number(fraction.padEnd(3, '0')));
  if (calendar.getUTCFullYear() !== y || calendar.getUTCMonth() !== m - 1 || calendar.getUTCDate() !== d) return null;
  const offsetHours = offset === 'Z' ? 0 : Number(offset.slice(1, 3));
  const offsetMinutes = offset === 'Z' ? 0 : Number(offset.slice(4, 6));
  if (offsetHours > 14 || offsetMinutes > 59 || offsetHours === 14 && offsetMinutes !== 0) return null;
  const instant = calendar.getTime() - (offsetHours * 60 + offsetMinutes) * (offset.startsWith('-') ? -1 : 1) * 60_000;
  const utcYear = new Date(instant).getUTCFullYear();
  return utcYear >= 0 && utcYear <= 9999 ? instant : null;
}

function qrUrl(value) {
  if (typeof value !== 'string' || value.length > 4096 || /[\s\\#\u0000-\u001f\u007f]/u.test(value) || !value.startsWith('https://')) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password && !url.hash ? url.href : null;
  } catch { return null; }
}

/**
 * Displays a future API receipt only; this does not submit, persist, or authenticate a registration.
 * The mock walkthrough never calls this helper. No QR image exists before a valid receipt/invite.
 */
export function renderRegistrationSuccess(container, response = {}) {
  if (typeof HTMLElement === 'undefined' || !(container instanceof HTMLElement) || !container.matches('[data-registration-success]')) return false;
  const heading = container.querySelector('[data-registration-success-heading]');
  const reference = container.querySelector('[data-registration-reference]');
  const status = container.querySelector('[data-registration-group-status]');
  const imageHolder = container.querySelector('[data-registration-group-image]');
  const help = container.querySelector('[data-registration-group-help]');
  container.hidden = true;
  if (imageHolder) {
    for (const previous of imageHolder.querySelectorAll('img')) previous.removeAttribute('src');
    imageHolder.replaceChildren();
    imageHolder.hidden = true;
  }
  if (heading) heading.textContent = '报名已完成';
  if (reference) reference.textContent = '';
  if (status) { status.textContent = ''; status.hidden = true; }
  if (help) help.hidden = true;
  if (!heading || !reference || !status || !imageHolder || !help) return false;

  const httpStatus = own(response, 'httpStatus');
  const body = own(response, 'body');
  const referenceCode = own(body, 'reference_code');
  if (![200, 201].includes(httpStatus) || own(body, 'status') !== 'registered' || typeof referenceCode !== 'string' || !REFERENCE_PATTERN.test(referenceCode)) return false;

  reference.textContent = referenceCode;
  container.hidden = false;
  const fallback = () => {
    heading.textContent = '报名已完成';
    status.textContent = GROUP_FALLBACK;
    status.hidden = false;
    imageHolder.hidden = true;
    help.hidden = true;
  };
  const invite = own(body, 'groupInvite');
  const imageUrl = qrUrl(own(invite, 'qrImageUrl'));
  const expiry = expiryTime(own(invite, 'expiresAt'));
  const suppliedNow = own(response, 'now');
  const current = suppliedNow === undefined ? Date.now() : typeof suppliedNow === 'number' && Number.isSafeInteger(suppliedNow) ? suppliedNow : expiryTime(suppliedNow);
  if (own(invite, 'platform') !== 'wechat' || !imageUrl || expiry === null || current === null || !Number.isFinite(current) || expiry <= current) {
    fallback();
    return true;
  }

  const image = container.ownerDocument.createElement('img');
  image.alt = '活动微信群入群二维码';
  image.referrerPolicy = 'no-referrer';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    if (imageHolder.firstElementChild !== image) return;
    image.removeAttribute('src');
    imageHolder.replaceChildren();
    fallback();
  }, { once: true });
  heading.textContent = '报名成功，扫码加入活动微信群';
  imageHolder.hidden = false;
  help.hidden = false;
  imageHolder.append(image);
  image.src = imageUrl;
  return true;
}
