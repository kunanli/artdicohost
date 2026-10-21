import { createHash } from 'node:crypto';
import { clockTime, own, plainObject, validateRegistrationPolicy } from './policy.mjs';
import { validateRegistrationSubmission, validateStaffRegistrationFields } from './validation.mjs';
import { createRegistrationRepository, registrationJson, MAX_REGISTRATIONS } from './repository.mjs';
import { createRegistrationTokens } from './tokens.mjs';
import { createRegistrationRateLimit } from './rate-limit.mjs';
import { createAdmissionOperations } from './admission-service.mjs';

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
  isWithdrawn, getWithdrawnIds, tokenLimit = 120, submissionLimit = 60, waitlistEnabled = false, staffReserve = 0 } = {}) {
  if (typeof clock !== 'function' || !Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_REGISTRATIONS
    || !Array.isArray(allowedOrigins) || !allowedOrigins.length || !allowedOrigins.every(validOrigin)
    || isWithdrawn !== undefined && typeof isWithdrawn !== 'function'
    || getWithdrawnIds !== undefined && typeof getWithdrawnIds !== 'function') throw new TypeError('Registration configuration is unavailable.');
  let configured;
  try { configured = JSON.parse(registrationJson(policy).toString()); } catch { throw new TypeError('Registration policy is unavailable.'); }
  if (Object.hasOwn(configured, 'capacity') && configured.capacity !== capacity) throw new TypeError('Registration capacity configuration does not match.');
  const eventId = own(configured, 'eventId'), origins = new Set(allowedOrigins);
  const repository = createRegistrationRepository({ objects, journalFor, eventId, capacity, waitlistEnabled, staffReserve });
  const tokens = createRegistrationTokens({ secret: tokenSecret, eventId });
  const budgets = createRegistrationRateLimit({ journalFor, eventId, tokenLimit, submissionLimit });
  const current = () => { const value = clockTime(clock()); if (value === null || value < 0) throw new Error(); return value; };
  const policyAt = now => validateRegistrationPolicy(configured, { now });
  const admissions = createAdmissionOperations({ repository, eventId, current, policyAt, isWithdrawn, getWithdrawnIds });
  // Validate public notice facts independently of the current intake window, without opening writes.
  const noticeCheck = validateRegistrationPolicy({ ...configured, enabled: true }, { now: configured.opensAt });
  const publicNotice = noticeCheck.valid ? { ...noticeCheck.value, capacity } : null;
  async function decorate(saved, origin, includeInvite = true) {
    if (!['created', 'replayed'].includes(saved.outcome)) return saved;
    const admission = await admissions.getAdmissionStatus(saved.receipt.registrationId);
    if (admission.status === 'withdrawn') return result('withdrawn');
    saved = { ...saved, receipt: { ...saved.receipt, admissionStatus: admission.status, admissionKind: admission.kind, admissionRevision: admission.revision } };
    let groupInvite = null;
    if (includeInvite && admission.status === 'confirmed' && typeof groupInviteProvider === 'function') {
      try { groupInvite = await groupInviteProvider({ receipt: saved.receipt, origin }); } catch { /* A saved registration remains saved if the invite is unavailable. */ }
    }
    return includeInvite ? { ...saved, groupInvite } : saved;
  }
  return Object.freeze({
    repository,
    ...Object.fromEntries(Object.entries(admissions).filter(([key]) => key !== 'getExcluded')),
    async metadata() {
      if (!publicNotice) return { enabled: false, reason: 'unavailable' };
      try {
        const checked = policyAt(current());
        const snapshot = await repository.getAdmissions(), summary = snapshot.summary;
        if (!checked.valid) return { ...publicNotice, admissions: summary, enabled: false, reason: Object.keys(checked.errors).some(key => !['enabled', 'window'].includes(key)) ? 'unavailable' : 'closed' };
        if (summary.totalRegistered >= MAX_REGISTRATIONS || summary.remainingPublic === 0 && !summary.waitlistEnabled) return { ...publicNotice, admissions: summary, enabled: false, reason: 'closed' };
        return { ...checked.value, capacity, admissions: summary };
      } catch { return { ...publicNotice, enabled: false, reason: 'unavailable' }; }
    },
    async issueToken(input) {
      try {
        const origin = own(input, 'origin'), idempotencyKey = own(input, 'idempotencyKey');
        if (!origins.has(origin) || own(input, 'eventId') !== eventId || !KEY.test(idempotencyKey ?? '')) return result('forbidden');
        const now = current(), checked = policyAt(now);
        const state = await repository.readIndex();
        const previous = state.value.entries.some(entry => entry.keyHash === digest('public\0' + eventId + '\0' + idempotencyKey));
        const summary = (await repository.getAdmissions()).summary;
        if (!previous && (!checked.valid || summary.totalRegistered >= MAX_REGISTRATIONS || summary.remainingPublic === 0 && !summary.waitlistEnabled)) return result('closed');
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
        if (replay) return await decorate(replay, origin);
        if (!tokens.verify({ token: submissionToken, origin, idempotencyKey, now })) return result('forbidden');
        const checked = policyAt(now);
        if (!checked.valid) return result('closed');
        const budget = await budgets.consume('submissions', now);
        if (!budget.allowed) return { outcome: 'rate_limited', retryAfter: budget.retryAfter };
        const validation = validateRegistrationSubmission(payload, { policy: configured, now });
        if (!validation.valid) return result('invalid');
        return await decorate(await repository.accept({ value: { ...validation.value, provenance: { kind: 'public' } }, keyHash, payloadHash, capacity, getExcluded: admissions.getExcluded(),
          beforeCommit: () => { const at = current(); return policyAt(at).valid && tokens.verify({ token: submissionToken, origin, idempotencyKey, now: at }); } }), origin);
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
        if (replay) return await decorate(replay, undefined, false);
        const now = current(), checked = policyAt(now);
        if (!checked.valid) return result('closed');
        const validation = validateStaffRegistrationFields(fields);
        if (!validation.valid) return { outcome: 'invalid', fieldErrors: Object.keys(validation.errors) };
        const recordedAt = new Date(now).toISOString();
        const value = { eventId, fields: validation.value, submittedAt: recordedAt,
          consent: { accepted: false, version: null, acceptedAt: null },
          provenance: { kind: 'staff_assisted', sourceContactId, actorId, recordedAt, permissionReference: permissionReference.trim() } };
        return await decorate(await repository.accept({ value, keyHash, payloadHash, capacity, actorId, getExcluded: admissions.getExcluded(), beforeCommit: () => policyAt(current()).valid }), undefined, false);
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
        const receipt = { committed: true, eventId, registrationId: entry.id, referenceCode: entry.id, committedAt: entry.committedAt };
        const access = await decorate({ outcome: 'replayed', receipt }, undefined, false);
        return access.outcome === 'replayed' ? { outcome: 'found', receipt: access.receipt } : access;
      } catch { return result('unavailable'); }
    },
  });
}
