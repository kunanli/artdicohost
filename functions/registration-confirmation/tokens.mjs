import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { CARD_FORMATS } from '../../shared/general-application.mjs';

const ID = /^[A-Za-z0-9_-]{43}$/u;
const EVENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const TOKEN = /^c1\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/u;
const PURPOSE = 'artdico-registration-confirmation-v1';
const MAX_LIFETIME = 180 * 24 * 60 * 60 * 1000;
function encoded(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function instant(value) { return Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime()); }
const revision = value => Number.isSafeInteger(value) && value >= 0;

/** Receipt capabilities contain an opaque person ID only and use their own HMAC purpose. */
export function createConfirmationTokens({ tokenSecret, eventId, expiresAt, clock = Date.now } = {}) {
  if (typeof tokenSecret !== 'string' || Buffer.byteLength(tokenSecret) < 32 || Buffer.byteLength(tokenSecret) > 4096
    || !EVENT.test(eventId ?? '') || !instant(expiresAt) || typeof clock !== 'function') throw new TypeError('Confirmation token configuration is unavailable.');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(tokenSecret), Buffer.from(eventId), Buffer.from(PURPOSE), 32));
  const sign = value => createHmac('sha256', key).update(value).digest('base64url');
  function now() { const value = clock(); if (!instant(value)) throw new TypeError('Confirmation clock is unavailable.'); return value; }
  return Object.freeze({
    issue(registrationId, accessRevision = 0, cardFormat) {
      const at = now();
      if (!ID.test(registrationId ?? '') || !revision(accessRevision) || expiresAt <= at || expiresAt - at > MAX_LIFETIME) throw new TypeError('Confirmation token is unavailable.');
      if (cardFormat !== undefined && !CARD_FORMATS.includes(cardFormat)) throw new TypeError('Invalid card format.');
      const payload = encoded({ eventId, registrationId, expiresAt, purpose: PURPOSE, ...(accessRevision === 0 ? {} : { accessRevision }),
        ...(cardFormat ? { cardFormat } : {}) });
      const unsigned = 'c1.' + payload;
      return { receiptToken: unsigned + '.' + sign(unsigned), expiresAt: new Date(expiresAt).toISOString() };
    },
    verify(token) {
      try {
        if (typeof token !== 'string' || token.length > 4096 || !TOKEN.test(token)) return null;
        const [version, payload, supplied] = token.split('.'), unsigned = version + '.' + payload;
        const expected = Buffer.from(sign(unsigned)), actual = Buffer.from(supplied);
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
        const bytes = Buffer.from(payload, 'base64url');
        if (bytes.toString('base64url') !== payload) return null;
        const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        const accessRevision = Object.hasOwn(claims, 'accessRevision') ? claims.accessRevision : 0;
        const cardFormat = claims.cardFormat;
        const keys = Object.keys(claims).filter(key => key !== 'cardFormat').sort().join(',');
        if (!['eventId,expiresAt,purpose,registrationId', 'accessRevision,eventId,expiresAt,purpose,registrationId'].includes(keys) || !revision(accessRevision)
          || Object.hasOwn(claims, 'cardFormat') && !CARD_FORMATS.includes(cardFormat)
          || claims.eventId !== eventId || claims.purpose !== PURPOSE || !ID.test(claims.registrationId ?? '')
          || claims.expiresAt !== expiresAt || expiresAt <= now() || expiresAt - now() > MAX_LIFETIME) return null;
        return { registrationId: claims.registrationId, expiresAt: new Date(expiresAt).toISOString(), accessRevision, ...(cardFormat ? { cardFormat } : {}) };
      } catch { return null; }
    },
  });
}
