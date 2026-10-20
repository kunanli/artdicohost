import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { own, plainObject, parseTimestamp } from './policy.mjs';
import { AdmissionError, admissionDefaults, admissionView, validateAdmissions, admissionSnapshot, admissionFor,
  transitionAdmission, appendAdmissionAudit, addAdmission, releaseWithdrawn, promoteEligible, operationResult, validAdmissionOperation } from './admissions.mjs';

export const MAX_REGISTRATIONS = 1000;
const LIST_READ_CONCURRENCY = 8;
const LIST_TIMEOUT_MS = 12000;
const HASH = /^[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9_-]{43}$/u;
const EVENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fieldsEqual = (value, fields) => plainObject(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');

export class RegistrationStorageError extends Error {
  constructor() { super('Registration storage is unavailable.'); this.name = 'RegistrationStorageError'; }
}
const unavailable = () => new RegistrationStorageError();

/** Stable own-data JSON only; never invokes getters or silently discards unsupported values. */
export function registrationJson(value, { maxBytes = 128 * 1024 } = {}) {
  const seen = new Set();
  let nodes = 0;
  function copy(item, depth) {
    if (++nodes > 200_000 || depth > 20) throw unavailable();
    if (item === null || typeof item === 'boolean' || typeof item === 'string') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (!Array.isArray(item) && !plainObject(item) || seen.has(item)) throw unavailable();
    if (Array.isArray(item) && Object.getPrototypeOf(item) !== Array.prototype) throw unavailable();
    seen.add(item);
    const keys = Reflect.ownKeys(item).filter(key => !Array.isArray(item) || key !== 'length');
    if (Array.isArray(item) && (keys.length !== item.length || keys.some(key => typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)))) throw unavailable();
    const result = Array.isArray(item) ? [] : Object.create(null);
    for (const key of Array.isArray(item) ? keys : keys.sort()) {
      const field = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !field?.enumerable || !Object.hasOwn(field, 'value') || ['__proto__', 'constructor', 'prototype'].includes(key)) throw unavailable();
      result[key] = copy(field.value, depth + 1);
    }
    seen.delete(item);
    return result;
  }
  const bytes = Buffer.from(JSON.stringify(copy(value, 0)));
  if (!bytes.length || bytes.length > maxBytes) throw unavailable();
  return bytes;
}

function indexValue(value, eventId, cursor, defaults) {
  if (!plainObject(cursor) || !Number.isSafeInteger(cursor.version) || cursor.version < 0 || !Number.isSafeInteger(cursor.position) || cursor.position < 0
    || (cursor.version === 0 ? cursor.position !== 0 || cursor.hash !== null : cursor.position < 1 || typeof cursor.hash !== 'string' || !HASH.test(cursor.hash))) throw unavailable();
  if (value === null) {
    if (cursor?.version !== 0 || cursor.position !== 0 || cursor.hash !== null) throw unavailable();
    return { schemaVersion: 1, kind: 'registration_index', eventId, revision: 0, entries: [] };
  }
  if (!fieldsEqual(value, value.schemaVersion === 2 ? ['schemaVersion', 'kind', 'eventId', 'revision', 'entries', 'admissions'] : ['schemaVersion', 'kind', 'eventId', 'revision', 'entries']) || ![1, 2].includes(value.schemaVersion) || value.kind !== 'registration_index'
    || value.eventId !== eventId || !Array.isArray(value.entries) || value.entries.length > MAX_REGISTRATIONS
    || !Number.isSafeInteger(value.revision) || value.revision < value.entries.length || value.schemaVersion === 1 && value.revision !== value.entries.length || cursor?.version !== value.revision) throw unavailable();
  const ids = new Set(), keys = new Set();
  for (const entry of value.entries) {
    if (!fieldsEqual(entry, ['id', 'keyHash', 'payloadHash', 'recordHash', 'committedAt']) || typeof entry.id !== 'string' || !ID.test(entry.id)
      || !['keyHash', 'payloadHash', 'recordHash'].every(key => typeof entry[key] === 'string' && HASH.test(entry[key]))
      || parseTimestamp(entry.committedAt) === null || ids.has(entry.id) || keys.has(entry.keyHash)) throw unavailable();
    ids.add(entry.id); keys.add(entry.keyHash);
  }
  if (value.schemaVersion === 2) validateAdmissions(value, defaults);
  registrationJson(value, { maxBytes: 1024 * 1024 });
  return value;
}

function checkedRecord(value, entry, eventId) {
  if (!fieldsEqual(value, ['schemaVersion', 'kind', 'id', 'eventId', 'submittedAt', 'fields', 'consent', 'provenance'])
    || value.schemaVersion !== 1 || value.kind !== 'registration' || value.id !== entry.id || value.eventId !== eventId
    || value.submittedAt !== entry.committedAt || !plainObject(value.fields) || !plainObject(value.provenance)
    || !fieldsEqual(value.consent, ['accepted', 'version', 'acceptedAt'])) throw unavailable();
  if (value.provenance.kind === 'public') {
    if (!fieldsEqual(value.provenance, ['kind']) || value.consent.accepted !== true
      || typeof value.consent.version !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value.consent.version)
      || value.consent.acceptedAt !== value.submittedAt) throw unavailable();
  } else if (['staff_assisted', 'staff_entry'].includes(value.provenance.kind)) {
    const source = value.provenance;
    if (!fieldsEqual(source, source.kind === 'staff_entry' ? ['kind', 'actorId', 'recordedAt', 'permissionReference', 'operationId'] : ['kind', 'sourceContactId', 'actorId', 'recordedAt', 'permissionReference'])
      || source.kind === 'staff_assisted' && (typeof source.sourceContactId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(source.sourceContactId))
      || source.kind === 'staff_entry' && !validAdmissionOperation(source.operationId)
      || typeof source.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(source.actorId) || source.recordedAt !== value.submittedAt
      || typeof source.permissionReference !== 'string' || !source.permissionReference.trim() || source.permissionReference.length > 1000
      || /[\u0000-\u001f\u007f]/u.test(source.permissionReference)
      || value.consent.accepted !== false || value.consent.version !== null || value.consent.acceptedAt !== null) throw unavailable();
  } else throw unavailable();
  registrationJson(value, { maxBytes: 160 * 1024 });
  return value;
}

/** One index append is the atomic acceptance/capacity point; records are immutable private blobs. */
export function createRegistrationRepository({ objects, journalFor, eventId, capacity, staffReserve = 0, waitlistEnabled = false } = {}) {
  if (!objects || typeof objects.get !== 'function' || typeof objects.putImmutable !== 'function' || typeof journalFor !== 'function'
    || typeof eventId !== 'string' || !EVENT.test(eventId)) throw unavailable();
  const prefix = `cms/v1/registrations/${eventId}`;
  const defaults = admissionDefaults({ capacity: capacity ?? MAX_REGISTRATIONS, staffReserve, waitlistEnabled });
  const pinned = capacity === undefined ? undefined : { capacity };
  async function target() {
    try {
      const value = await journalFor(prefix + '/index');
      if (!value || typeof value.read !== 'function' || typeof value.commit !== 'function') throw unavailable();
      return value;
    } catch { throw unavailable(); }
  }
  async function readIndex() {
    try {
      const journal = await target(), state = await journal.read();
      const value = indexValue(state?.value, eventId, state?.cursor, pinned);
      return { value: structuredClone(value), cursor: state.cursor };
    } catch { throw unavailable(); }
  }
  async function readRecord(entry) {
    try {
      if (!plainObject(entry) || !ID.test(entry.id ?? '') || !HASH.test(entry.recordHash ?? '') || parseTimestamp(entry.committedAt) === null) throw unavailable();
      const saved = await objects.get(`${prefix}/records/${entry.recordHash}.json`, { maxBytes: 160 * 1024 });
      if (!saved || saved.objectType !== 'Normal' || saved.contentType !== 'application/json' || !(saved.data instanceof Uint8Array) || digest(saved.data) !== entry.recordHash) throw unavailable();
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(saved.data));
      return structuredClone(checkedRecord(value, entry, eventId));
    } catch { throw unavailable(); }
  }
  const view = index => admissionView(index, defaults);
  const snapshot = index => admissionSnapshot(index, defaults);
  function receipt(index, entry) {
    const admission = admissionFor(index, entry.id, defaults);
    return { committed: true, eventId, registrationId: entry.id, referenceCode: entry.id, committedAt: entry.committedAt,
      admissionStatus: admission.status, admissionKind: admission.kind, admissionRevision: admission.revision };
  }
  async function saved(index, entry, outcome, operationId = null) {
    await readRecord(entry);
    const operation = operationId === null ? null : view(index).admissions.audit.find(item => item.operationId === operationId);
    return { outcome, receipt: receipt(index, entry), ...(operation ? { promotedIds: operation.result.promotedIds, releasedIds: operation.result.releasedIds } : {}) };
  }
  async function exclusions(index, getExcluded) {
    if (getExcluded === undefined) return [];
    if (typeof getExcluded !== 'function') throw unavailable();
    return await getExcluded(index.entries.filter(entry => index.admissions.people[entry.id].status === 'waitlisted').map(entry => entry.id));
  }
  const safeAdmissionFailure = error => error instanceof AdmissionError && ['invalid', 'conflict', 'forbidden', 'not_found', 'capacity_conflict'].includes(error.code)
    ? { outcome: error.code } : { outcome: 'unavailable' };
  return Object.freeze({
    prefix, readIndex, readRecord,
    async getAdmissions() { return snapshot((await readIndex()).value); },
    async getAdmissionStatus(id) {
      try {
        const index = (await readIndex()).value, entry = index.entries.find(item => item.id === id);
        if (!entry) throw unavailable();
        await readRecord(entry);
        return admissionFor(index, id, defaults);
      } catch { throw unavailable(); }
    },
    async mutateAdmission({ action, input, actorId, expectedRevision, operationId, requestHash, at, getExcluded }) {
      try {
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !validAdmissionOperation(operationId) || !HASH.test(requestHash ?? '')
          || !/^[A-Za-z0-9_-]{1,80}$/u.test(actorId ?? '') || parseTimestamp(at) === null) return { outcome: 'invalid' };
        const current = await readIndex(), next = view(current.value);
        const previous = next.admissions.audit.find(entry => entry.operationId === operationId);
        if (previous) return previous.action === action && previous.actorId === actorId && previous.requestHash === requestHash
          ? { outcome: 'replayed', ...snapshot(next), ...previous.result } : { outcome: 'conflict' };
        if (current.value.revision !== expectedRevision) return { outcome: 'conflict' };
        const change = transitionAdmission(next, action, input, at, await exclusions(next, getExcluded));
        appendAdmissionAudit(next, { action, actorId, at, operationId, requestHash, ...change });
        validateAdmissions(next, pinned); registrationJson(next, { maxBytes: 1024 * 1024 });
        try {
          const ack = await (await target()).commit(current.cursor, next);
          if (!isDeepStrictEqual(ack?.value, next) || ack?.cursor?.version !== next.revision) throw unavailable();
        } catch (error) {
          if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) return { outcome: 'conflict' };
          throw unavailable();
        }
        const after = await readIndex(), verified = view(after.value).admissions.audit.find(entry => entry.operationId === operationId);
        if (!isDeepStrictEqual(verified, next.admissions.audit.at(-1))) throw unavailable();
        return { outcome: 'updated', ...snapshot(after.value), ...verified.result };
      } catch (error) { return safeAdmissionFailure(error); }
    },
    async list(options = {}) {
      const timeoutMs = own(options, 'timeoutMs') ?? LIST_TIMEOUT_MS, signal = own(options, 'signal');
      if (!plainObject(options) || Object.keys(options).some(key => !['timeoutMs', 'signal'].includes(key))
        || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > LIST_TIMEOUT_MS
        || signal !== undefined && !(signal instanceof AbortSignal)) throw unavailable();
      let stopped = false, rejectStopped;
      const interrupted = new Promise((_, reject) => { rejectStopped = reject; });
      const stop = () => { stopped = true; rejectStopped(unavailable()); };
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener('abort', stop, { once: true });
      const operation = async () => {
        if (stopped) throw unavailable();
        const state = await readIndex();
        if (stopped) throw unavailable();
        const registrations = Array(state.value.entries.length);
        let position = 0;
        async function worker() {
          while (!stopped && position < state.value.entries.length) {
            const index = position++;
            let value;
            try { value = await readRecord(state.value.entries[index]); }
            catch { stopped = true; throw unavailable(); }
            if (stopped) throw unavailable();
            registrations[index] = { id: value.id, referenceCode: value.id, eventId: value.eventId, submittedAt: value.submittedAt, fields: value.fields, consent: value.consent, provenance: value.provenance };
          }
        }
        await Promise.all(Array.from({ length: Math.min(LIST_READ_CONCURRENCY, registrations.length) }, () => worker()));
        if (stopped) throw unavailable();
        return { registrations, revision: state.value.revision };
      };
      try {
        if (signal?.aborted) stop();
        return await Promise.race([operation(), interrupted]);
      } catch { throw unavailable(); }
      finally { stopped = true; clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    },
    async find(keyHash, payloadHash, { operationId = null } = {}) {
      if (!HASH.test(keyHash ?? '') || !HASH.test(payloadHash ?? '')) throw unavailable();
      const state = await readIndex(), entry = state.value.entries.find(item => item.keyHash === keyHash);
      if (!entry) return null;
      if (entry.payloadHash !== payloadHash) return { outcome: 'conflict' };
      return saved(state.value, entry, 'replayed', operationId);
    },
    async accept({ value, keyHash, payloadHash, capacity: requestedCapacity = defaults.capacity, beforeCommit, admissionKind = 'attendee', actorId = 'public', operationId = null, expectedRevision, requestHash = payloadHash, getExcluded }) {
      const capacity = requestedCapacity;
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_REGISTRATIONS || !HASH.test(keyHash ?? '') || !HASH.test(payloadHash ?? '')
        || !plainObject(value) || value.eventId !== eventId || !plainObject(value.fields) || !plainObject(value.consent)
        || beforeCommit !== undefined && typeof beforeCommit !== 'function') throw unavailable();
      if (pinned && capacity !== defaults.capacity) throw unavailable();
      const submittedAt = ['staff_assisted', 'staff_entry'].includes(value.provenance?.kind) ? value.submittedAt : value.consent.acceptedAt;
      if (parseTimestamp(submittedAt) === null) throw unavailable();
      const id = randomBytes(32).toString('base64url');
      const record = { schemaVersion: 1, kind: 'registration', id, eventId, submittedAt, fields: value.fields, consent: value.consent, provenance: value.provenance ?? { kind: 'public' } };
      const bytes = registrationJson(record, { maxBytes: 160 * 1024 }), recordHash = digest(bytes);
      const entry = { id, keyHash, payloadHash, recordHash, committedAt: record.submittedAt };
      checkedRecord(record, entry, eventId);
      const journal = await target();
      for (let attempt = 0; attempt < 8; attempt++) {
        const current = await readIndex(), previous = current.value.entries.find(item => item.keyHash === keyHash);
        if (previous) {
          if (previous.payloadHash !== payloadHash) return { outcome: 'conflict' };
          return saved(current.value, previous, 'replayed', operationId);
        }
        const next = admissionView(current.value, { ...defaults, capacity });
        if (operationId !== null && (!validAdmissionOperation(operationId) || next.admissions.audit.some(item => item.operationId === operationId))) return { outcome: 'conflict' };
        if (expectedRevision !== undefined && expectedRevision !== current.value.revision) return { outcome: 'conflict' };
        if (current.value.entries.length >= MAX_REGISTRATIONS) return { outcome: 'closed' };
        const changedAt = new Date(Math.max(parseTimestamp(submittedAt), parseTimestamp(next.admissions.audit.at(-1)?.at) ?? -Infinity)).toISOString();
        const releasedIds = releaseWithdrawn(next, await exclusions(next, getExcluded), changedAt);
        const promotedIds = promoteEligible(next, changedAt);
        const status = addAdmission(next, entry, admissionKind, changedAt);
        if (status === null) return { outcome: 'closed' };
        try {
          await objects.putImmutable(`${prefix}/records/${recordHash}.json`, bytes, { contentType: 'application/json' });
          await readRecord(entry);
        } catch { throw unavailable(); }
        appendAdmissionAudit(next, { action: value.provenance?.kind === 'public' ? 'intake' : 'staff_intake', actorId, at: changedAt,
          operationId, requestHash, details: { kind: admissionKind, status }, result: operationResult({ registrationId: id, promotedIds, releasedIds }) });
        validateAdmissions(next, pinned); registrationJson(next, { maxBytes: 1024 * 1024 });
        // Slow record staging must not silently extend the accepted registration window.
        if (beforeCommit !== undefined && await beforeCommit() !== true) return { outcome: 'closed' };
        try {
          const saved = await journal.commit(current.cursor, next);
          if (!isDeepStrictEqual(saved?.value, next) || saved?.cursor?.version !== current.cursor.version + 1) throw unavailable();
        } catch (error) {
          // Only a definitive CAS rejection may retry. A lost ACK must be retried by the caller with the same key.
          if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) { if (expectedRevision !== undefined) return { outcome: 'conflict' }; continue; }
          throw unavailable();
        }
        const after = await readIndex(), verified = after.value.entries.find(item => item.keyHash === keyHash);
        if (!verified || !isDeepStrictEqual(verified, entry)) throw unavailable();
        return saved(after.value, verified, 'created', operationId);
      }
      throw unavailable();
    },
  });
}
