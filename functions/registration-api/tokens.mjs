import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { plainObject } from './policy.mjs';

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'artdico-registration-v1' })).toString('base64url');
const ID = /^[A-Za-z0-9_-]{32,128}$/u;
const PART = /^[A-Za-z0-9_-]+$/u;
const originValid = value => {
  try { return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).origin === value; }
  catch { return false; }
};

/** Tokens are shared-secret HMAC proofs, bound to one event, exact origin and idempotency key. */
export function createRegistrationTokens({ secret, eventId, ttlMs = 10 * 60 * 1000 } = {}) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 1024
    || typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)
    || !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 10 * 60 * 1000) throw new TypeError('Registration token configuration is unavailable.');
  const signature = value => createHmac('sha256', secret).update(value).digest();
  return Object.freeze({
    issue({ origin, idempotencyKey, now }) {
      if (!originValid(origin) || !ID.test(idempotencyKey ?? '') || !Number.isSafeInteger(now) || now < 0 || now > 8640000000000000 - ttlMs) throw new TypeError('Registration token input is invalid.');
      const payload = { eventId, origin, key: idempotencyKey, iat: now, exp: now + ttlMs, nonce: randomBytes(32).toString('base64url') };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url'), value = HEADER + '.' + encoded;
      return { submissionToken: value + '.' + signature(value).toString('base64url'), expiresAt: new Date(payload.exp).toISOString(), eventId };
    },
    verify({ token, origin, idempotencyKey, now, allowExpired = false }) {
      try {
        if (typeof token !== 'string' || token.length > 4096 || !originValid(origin) || !ID.test(idempotencyKey ?? '') || !Number.isSafeInteger(now) || now < 0) return false;
        const parts = token.split('.');
        if (parts.length !== 3 || parts[0] !== HEADER || !parts.every(part => PART.test(part) && Buffer.from(part, 'base64url').toString('base64url') === part)) return false;
        const supplied = Buffer.from(parts[2], 'base64url'), expected = signature(parts[0] + '.' + parts[1]);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
        const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[1], 'base64url')));
        return plainObject(value) && Object.keys(value).sort().join(',') === 'eventId,exp,iat,key,nonce,origin'
          && value.eventId === eventId && value.origin === origin && value.key === idempotencyKey
          && typeof value.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value.nonce)
          && Number.isSafeInteger(value.iat) && value.iat >= 0 && Number.isSafeInteger(value.exp) && value.exp - value.iat === ttlMs
          && value.iat <= now && (allowExpired === true || now < value.exp);
      } catch { return false; }
    },
  });
}
