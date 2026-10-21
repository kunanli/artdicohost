import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { parseTimestamp } from '../registration-api/policy.mjs';

export const MAX_CONFIRMATION_AUDIT = 4000;
export const MAX_CONFIRMATION_BATCH = 100;
const ID = /^[A-Za-z0-9_-]{43}$/u, HASH = /^[a-f0-9]{64}$/u, OP = /^[A-Za-z0-9_-]{32,128}$/u;
const ACTOR = /^[A-Za-z0-9_-]{1,80}$/u;
const EMAIL_STATUSES = ['reserved', 'provider_accepted', 'rejected', 'unknown'];
const RESULT_STATUSES = ['provider_accepted', 'rejected', 'unknown', 'disabled', 'not_configured', 'not_applicable', 'not_public', 'withdrawn', 'unavailable', 'not_attempted'];
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field?.enumerable && Object.hasOwn(field, 'value'); });
const at = value => typeof value === 'string' && parseTimestamp(value) !== null && new Date(value).toISOString() === value;
const fail = () => { throw new ConfirmationStorageError(); };
export class ConfirmationStorageError extends Error { constructor() { super('Confirmation storage is unavailable.'); this.code = 'CONFIRMATION_UNAVAILABLE'; } }
export const confirmationNoticeId = (eventId, registrationId, kind = 'registration') => 'c_' + createHash('sha256').update(eventId + '\0' + registrationId + '\0' + kind).digest('hex');
export const confirmationRequestHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const validConfirmationOperation = value => typeof value === 'string' && OP.test(value);

// A confirmed message has one durable identity across intake and promotion.
// Preserve a distinct promotion only when a waitlist notice already exists.
export function canonicalConfirmationKind(state, registrationId, admissionStatus) {
  if (admissionStatus !== 'confirmed') return 'registration';
  const notices = state.notices.filter(item => item.registrationId === registrationId);
  return notices.find(item => item.admissionStatus === 'confirmed')?.kind
    ?? (notices.some(item => item.kind === 'registration' && item.admissionStatus === 'waitlisted') ? 'promotion' : 'registration');
}

function initial(eventId) { return { schemaVersion: 1, eventId, revision: 0, settings: { enabled: true }, notices: [], operations: [], audit: [] }; }
function apply(state, audit) {
  const d = audit.details;
  if (audit.action === 'reserve') {
    if (!exact(d, ['registrationId', 'kind', 'admissionStatus', 'admissionRevision', 'retryRejected']) || !ID.test(d.registrationId ?? '')
      || !['registration', 'promotion'].includes(d.kind) || !['confirmed', 'waitlisted'].includes(d.admissionStatus)
      || !Number.isSafeInteger(d.admissionRevision) || d.admissionRevision < 0 || typeof d.retryRejected !== 'boolean') fail();
    if (d.kind !== canonicalConfirmationKind(state, d.registrationId, d.admissionStatus)) fail();
    const id = confirmationNoticeId(state.eventId, d.registrationId, d.kind), existing = state.notices.find(n => n.id === id);
    if (existing && (!d.retryRejected || existing.status !== 'rejected' || existing.attempt >= 5 || existing.admissionStatus !== d.admissionStatus)) fail();
    if (d.admissionStatus === 'confirmed' && state.notices.some(item => item.registrationId === d.registrationId
      && item.admissionStatus === 'confirmed' && item.id !== id)) fail();
    if (!existing && state.notices.length >= 2000) fail();
    const notice = { id, registrationId: d.registrationId, kind: d.kind, status: 'reserved', admissionStatus: d.admissionStatus,
      admissionRevision: d.admissionRevision, createdAt: existing?.createdAt ?? audit.at, updatedAt: audit.at,
      actorId: audit.actorId, attempt: (existing?.attempt ?? 0) + 1 };
    if (existing) state.notices.splice(state.notices.indexOf(existing), 1, notice); else state.notices.push(notice);
  } else if (audit.action === 'result') {
    if (!exact(d, ['noticeId', 'status']) || !EMAIL_STATUSES.slice(1).includes(d.status)) fail();
    const notice = state.notices.find(n => n.id === d.noticeId);
    if (!notice || notice.status !== 'reserved' || notice.actorId !== audit.actorId) fail();
    notice.status = d.status; notice.updatedAt = audit.at;
  } else if (audit.action === 'settings') {
    if (!exact(d, ['operationId', 'requestHash', 'enabled']) || !OP.test(d.operationId ?? '') || !HASH.test(d.requestHash ?? '')
      || typeof d.enabled !== 'boolean' || state.operations.some(op => op.operationId === d.operationId)) fail();
    state.settings.enabled = d.enabled;
    state.operations.push({ operationId: d.operationId, requestHash: d.requestHash, actorId: audit.actorId,
      action: 'settings', at: audit.at, status: 'completed', registrationIds: [], retryRejected: false, results: [] });
  } else if (audit.action === 'dispatch_started') {
    if (!exact(d, ['operationId', 'requestHash', 'registrationIds', 'retryRejected']) || !OP.test(d.operationId ?? '') || !HASH.test(d.requestHash ?? '')
      || !Array.isArray(d.registrationIds) || !d.registrationIds.length || d.registrationIds.length > MAX_CONFIRMATION_BATCH
      || new Set(d.registrationIds).size !== d.registrationIds.length || d.registrationIds.some(id => !ID.test(id))
      || typeof d.retryRejected !== 'boolean' || state.operations.some(op => op.operationId === d.operationId)) fail();
    state.operations.push({ operationId: d.operationId, requestHash: d.requestHash, actorId: audit.actorId,
      action: 'dispatch', at: audit.at, status: 'started', registrationIds: [...d.registrationIds], retryRejected: d.retryRejected, results: [] });
  } else if (audit.action === 'dispatch_completed') {
    if (!exact(d, ['operationId', 'results']) || !Array.isArray(d.results)) fail();
    const operation = state.operations.find(op => op.operationId === d.operationId);
    if (!operation || operation.action !== 'dispatch' || operation.status !== 'started' || operation.actorId !== audit.actorId
      || d.results.length !== operation.registrationIds.length || d.results.some((result, i) => !exact(result, ['registrationId', 'status'])
        || result.registrationId !== operation.registrationIds[i] || !RESULT_STATUSES.includes(result.status))) fail();
    operation.status = 'completed'; operation.results = structuredClone(d.results);
  } else fail();
}
function validate(value, eventId, cursor) {
  if (value === null) { if (cursor?.version !== 0 || cursor.position !== 0 || cursor.hash !== null) fail(); return initial(eventId); }
  if (!exact(value, ['schemaVersion', 'eventId', 'revision', 'settings', 'notices', 'operations', 'audit']) || value.schemaVersion !== 1
    || value.eventId !== eventId || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision !== cursor?.version
    || !Array.isArray(value.audit) || value.audit.length !== value.revision || value.audit.length > MAX_CONFIRMATION_AUDIT) fail();
  const expected = initial(eventId); let previous = -Infinity;
  for (const [i, item] of value.audit.entries()) {
    if (!exact(item, ['revision', 'action', 'actorId', 'at', 'details']) || item.revision !== i + 1 || !ACTOR.test(item.actorId ?? '')
      || !at(item.at) || Date.parse(item.at) < previous) fail();
    apply(expected, item); previous = Date.parse(item.at);
  }
  expected.revision = value.revision; expected.audit = structuredClone(value.audit);
  if (!isDeepStrictEqual(expected, value)) fail();
  return structuredClone(value);
}

/** One private journal; every mutable fact is reconstructed from its bounded audit. */
export function createConfirmationRepository({ journal, eventId, clock = Date.now } = {}) {
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId ?? '')
    || typeof clock !== 'function') throw new TypeError('Explicit confirmation journal required.');
  async function read() { try { const current = await journal.read(); return { value: validate(current.value, eventId, current.cursor), cursor: current.cursor }; } catch { throw new ConfirmationStorageError(); } }
  async function append(current, action, details, actorId) {
    try {
      const next = structuredClone(current.value), when = new Date(clock()).toISOString();
      if (next.audit.length >= MAX_CONFIRMATION_AUDIT || !ACTOR.test(actorId ?? '') || !at(when)
        || next.audit.length && when < next.audit.at(-1).at) fail();
      const audit = { revision: next.revision + 1, action, actorId, at: when, details: structuredClone(details) };
      apply(next, audit); next.revision++; next.audit.push(audit);
      validate(next, eventId, { version: next.revision });
      if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024) fail();
      const ack = await journal.commit(current.cursor, next);
      if (ack?.cursor?.version !== next.revision || !isDeepStrictEqual(ack?.value, next)) fail();
      return { value: next, cursor: ack.cursor };
    } catch (error) {
      if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) throw error;
      throw new ConfirmationStorageError();
    }
  }
  return Object.freeze({ read, append });
}
