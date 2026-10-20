import { isDeepStrictEqual } from 'node:util';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { plainObject } from './policy.mjs';
import { RegistrationStorageError } from './repository.mjs';

/** Deliberately shared fixed-window budgets; no untrusted client-IP headers or local cache. */
export function createRegistrationRateLimit({ journalFor, eventId, windowMs = 15 * 60 * 1000, tokenLimit = 120, submissionLimit = 60 } = {}) {
  if (typeof journalFor !== 'function' || typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)
    || !Number.isSafeInteger(windowMs) || windowMs < 1000 || windowMs > 24 * 60 * 60 * 1000
    || ![tokenLimit, submissionLimit].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 10000)) throw new RegistrationStorageError();
  return Object.freeze({
    async consume(bucket, now) {
      try {
        if (!['tokens', 'submissions'].includes(bucket) || !Number.isSafeInteger(now) || now < 0) throw new RegistrationStorageError();
        const window = Math.floor(now / windowMs), limit = bucket === 'tokens' ? tokenLimit : submissionLimit;
        const journal = await journalFor(`cms/v1/registrations/${eventId}/limits/${bucket}/${window}`);
        if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function') throw new RegistrationStorageError();
        for (let attempt = 0; attempt < 8; attempt++) {
          const state = await journal.read(), value = state?.value;
          if (!plainObject(state) || !plainObject(state.cursor) || value === null && state.cursor.version !== 0
            || value !== null && (!plainObject(value) || Object.keys(value).sort().join(',') !== 'bucket,count,eventId,kind,schemaVersion,window'
              || value.schemaVersion !== 1 || value.kind !== 'registration_budget' || value.eventId !== eventId
              || value.bucket !== bucket || value.window !== window || !Number.isSafeInteger(value.count) || value.count < 1 || value.count > limit
              || state.cursor.version !== value.count)) throw new RegistrationStorageError();
          const count = value?.count ?? 0;
          if (count >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil(((window + 1) * windowMs - now) / 1000)) };
          const next = { schemaVersion: 1, kind: 'registration_budget', eventId, bucket, window, count: count + 1 };
          try {
            const saved = await journal.commit(state.cursor, next);
            if (!isDeepStrictEqual(saved?.value, next) || saved?.cursor?.version !== state.cursor.version + 1) throw new RegistrationStorageError();
            return { allowed: true };
          } catch (error) {
            if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) continue;
            throw new RegistrationStorageError();
          }
        }
        throw new RegistrationStorageError();
      } catch { throw new RegistrationStorageError(); }
    },
  });
}
