import { createHash } from 'node:crypto';
import { clockTime, own, plainObject, validateRegistrationPolicy } from './policy.mjs';
import { validateRegistrationSubmission, validateStaffRegistrationFields } from './validation.mjs';
import { createRegistrationRepository, registrationJson, MAX_REGISTRATIONS } from './repository.mjs';
import { createRegistrationTokens } from './tokens.mjs';
import { createRegistrationRateLimit } from './rate-limit.mjs';

const KEY = /^[A-Za-z0-9_-]{32,128}$/u;
const digest = value => createHash('sha256').update(value).digest('hex');
const validOrigin = value => {
  try { return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).origin === value; }
  catch { return false; }
};
const result = outcome => ({ outcome });
const staffActor = actor => typeof own(actor, 'id') === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(own(actor, 'id'))
  && Array.isArray(own(actor, 'roles')) && own(actor, 'roles').some(role => ['reviewer', 'superadmin'].includes(role));
const staffSource = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);

/** Real storage is required. Invalid or absent policy never opens collection or invents notice facts. */
export function createRegistrationService({ objects, journalFor, policy, capacity, tokenSecret, allowedOrigins, clock = () => Date.now(), groupInviteProvider,
  tokenLimit = 120, submissionLimit = 60 } = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_REGISTRATIONS
    || !Array.isArray(allowedOrigins) || !allowedOrigins.length || !allowedOrigins.every(validOrigin)) throw new TypeError('Registration configuration is unavailable.');
  let configured;
  try { configured = JSON.parse(registrationJson(policy).toString()); } catch { throw new TypeError('Registration policy is unavailable.'); }
  const eventId = own(configured, 'eventId'), origins = new Set(allowedOrigins);
  const repository = createRegistrationRepository({ objects, journalFor, eventId });
  const tokens = createRegistrationTokens({ secret: tokenSecret, eventId });
  const budgets = createRegistrationRateLimit({ journalFor, eventId, tokenLimit, submissionLimit });
  const current = () => { const value = clockTime(clock()); if (value === null || value < 0) throw new Error(); return value; };
  const policyAt = now => validateRegistrationPolicy(configured, { now });
  async function decorate(saved, origin) {
    if (!['created', 'replayed'].includes(saved.outcome)) return saved;
    let groupInvite = null;
    if (typeof groupInviteProvider === 'function') {
      try { groupInvite = await groupInviteProvider({ receipt: saved.receipt, origin }); } catch { /* A saved registration remains saved if the invite is unavailable. */ }
    }
    return { ...saved, groupInvite };
  }
  return Object.freeze({
    repository,
    async metadata() {
      try {
        const checked = policyAt(current());
        if (!checked.valid) return { enabled: false, reason: Object.keys(checked.errors).some(key => !['enabled', 'window'].includes(key)) ? 'unavailable' : 'closed' };
        const state = await repository.readIndex();
        if (state.value.entries.length >= capacity) return { enabled: false, reason: 'closed' };
        return { ...checked.value, capacity };
      } catch { return { enabled: false, reason: 'unavailable' }; }
    },
    async issueToken(input) {
      try {
        const origin = own(input, 'origin'), idempotencyKey = own(input, 'idempotencyKey');
        if (!origins.has(origin) || own(input, 'eventId') !== eventId || !KEY.test(idempotencyKey ?? '')) return result('forbidden');
        const now = current(), checked = policyAt(now);
        const state = await repository.readIndex();
        const previous = state.value.entries.some(entry => entry.keyHash === digest('public\0' + eventId + '\0' + idempotencyKey));
        if (!previous && (!checked.valid || state.value.entries.length >= capacity)) return result('closed');
        const budget = await budgets.consume('tokens', now);
        if (!budget.allowed) return { outcome: 'rate_limited', retryAfter: budget.retryAfter };
        return { outcome: 'issued', ...tokens.issue({ origin, idempotencyKey, now }) };
      } catch { return result('unavailable'); }
    },
    async submit(input) {
      try {
        const payload = own(input, 'payload'), origin = own(input, 'origin'), idempotencyKey = own(input, 'idempotencyKey'), submissionToken = own(input, 'submissionToken');
        if (!origins.has(origin) || !KEY.test(idempotencyKey ?? '') || own(payload, 'eventId') !== eventId) return result('forbidden');
        const now = current();
        if (!tokens.verify({ token: submissionToken, origin, idempotencyKey, now, allowExpired: true })) return result('forbidden');
        let bytes;
        try { bytes = registrationJson(payload); } catch { return result('invalid'); }
        const keyHash = digest('public\0' + eventId + '\0' + idempotencyKey), payloadHash = digest(bytes);
        // A proven saved replay survives closure and token expiry; it can never create a new record.
        const replay = await repository.find(keyHash, payloadHash);
        if (replay) return decorate(replay, origin);
        if (!tokens.verify({ token: submissionToken, origin, idempotencyKey, now })) return result('forbidden');
        const checked = policyAt(now);
        if (!checked.valid) return result('closed');
        const budget = await budgets.consume('submissions', now);
        if (!budget.allowed) return { outcome: 'rate_limited', retryAfter: budget.retryAfter };
        const validation = validateRegistrationSubmission(payload, { policy: configured, now });
        if (!validation.valid) return result('invalid');
        return decorate(await repository.accept({ value: { ...validation.value, provenance: { kind: 'public' } }, keyHash, payloadHash, capacity }), origin);
      } catch { return result('unavailable'); }
    },
    async submitStaffRegistration(input) {
      try {
        const sourceContactId = own(input, 'sourceContactId'), actor = own(input, 'actor'), supplied = own(input, 'input');
        const actorId = own(actor, 'id');
        if (!staffSource(sourceContactId) || !staffActor(actor)) return result('forbidden');
        const permissionReference = own(supplied, 'permissionReference');
        if (typeof permissionReference !== 'string' || !permissionReference.trim() || permissionReference.length > 1000 || /[\u0000-\u001f\u007f]/u.test(permissionReference)) return result('invalid');
        const fields = own(supplied, 'fields'), keyHash = digest('staff\0' + eventId + '\0' + sourceContactId);
        const payloadHash = digest(registrationJson({ fields, permissionReference: permissionReference.trim() }));
        const replay = await repository.find(keyHash, payloadHash);
        if (replay) return replay;
        const now = current(), checked = policyAt(now);
        if (!checked.valid) return result('closed');
        const validation = validateStaffRegistrationFields(fields);
        if (!validation.valid) return { outcome: 'invalid', fieldErrors: Object.keys(validation.errors) };
        const recordedAt = new Date(now).toISOString();
        const value = { eventId, fields: validation.value, submittedAt: recordedAt,
          consent: { accepted: false, version: null, acceptedAt: null },
          provenance: { kind: 'staff_assisted', sourceContactId, actorId, recordedAt, permissionReference: permissionReference.trim() } };
        return repository.accept({ value, keyHash, payloadHash, capacity });
      } catch { return result('unavailable'); }
    },
    async getStaffRegistrationBySource(input) {
      try {
        const sourceContactId = own(input, 'sourceContactId');
        if (!staffSource(sourceContactId) || !staffActor(own(input, 'actor'))) return result('forbidden');
        const keyHash = digest('staff\0' + eventId + '\0' + sourceContactId), state = await repository.readIndex();
        const entry = state.value.entries.find(value => value.keyHash === keyHash);
        if (!entry) return result('not_found');
        const record = await repository.readRecord(entry);
        if (record.provenance.kind !== 'staff_assisted' || record.provenance.sourceContactId !== sourceContactId) return result('unavailable');
        return { outcome: 'found', receipt: { committed: true, eventId, registrationId: entry.id, referenceCode: entry.id, committedAt: entry.committedAt } };
      } catch { return result('unavailable'); }
    },
  });
}
