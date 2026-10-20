import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { own, plainObject, parseTimestamp } from './policy.mjs';

export const MAX_REGISTRATIONS = 1000;
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
    if (++nodes > 20_000 || depth > 20) throw unavailable();
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

function indexValue(value, eventId, cursor) {
  if (value === null) {
    if (cursor?.version !== 0 || cursor.position !== 0 || cursor.hash !== null) throw unavailable();
    return { schemaVersion: 1, kind: 'registration_index', eventId, revision: 0, entries: [] };
  }
  if (!fieldsEqual(value, ['schemaVersion', 'kind', 'eventId', 'revision', 'entries']) || value.schemaVersion !== 1 || value.kind !== 'registration_index'
    || value.eventId !== eventId || !Array.isArray(value.entries) || value.entries.length > MAX_REGISTRATIONS
    || value.revision !== value.entries.length || cursor?.version !== value.revision) throw unavailable();
  const ids = new Set(), keys = new Set();
  for (const entry of value.entries) {
    if (!fieldsEqual(entry, ['id', 'keyHash', 'payloadHash', 'recordHash', 'committedAt']) || typeof entry.id !== 'string' || !ID.test(entry.id)
      || !['keyHash', 'payloadHash', 'recordHash'].every(key => typeof entry[key] === 'string' && HASH.test(entry[key]))
      || parseTimestamp(entry.committedAt) === null || ids.has(entry.id) || keys.has(entry.keyHash)) throw unavailable();
    ids.add(entry.id); keys.add(entry.keyHash);
  }
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
  } else if (value.provenance.kind === 'staff_assisted') {
    const source = value.provenance;
    if (!fieldsEqual(source, ['kind', 'sourceContactId', 'actorId', 'recordedAt', 'permissionReference'])
      || typeof source.sourceContactId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(source.sourceContactId)
      || typeof source.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(source.actorId) || source.recordedAt !== value.submittedAt
      || typeof source.permissionReference !== 'string' || !source.permissionReference.trim() || source.permissionReference.length > 1000
      || /[\u0000-\u001f\u007f]/u.test(source.permissionReference)
      || value.consent.accepted !== false || value.consent.version !== null || value.consent.acceptedAt !== null) throw unavailable();
  } else throw unavailable();
  registrationJson(value, { maxBytes: 160 * 1024 });
  return value;
}

/** One index append is the atomic acceptance/capacity point; records are immutable private blobs. */
export function createRegistrationRepository({ objects, journalFor, eventId } = {}) {
  if (!objects || typeof objects.get !== 'function' || typeof objects.putImmutable !== 'function' || typeof journalFor !== 'function'
    || typeof eventId !== 'string' || !EVENT.test(eventId)) throw unavailable();
  const prefix = `cms/v1/registrations/${eventId}`;
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
      const value = indexValue(state?.value, eventId, state?.cursor);
      return { value: structuredClone(value), cursor: state.cursor };
    } catch { throw unavailable(); }
  }
  async function readRecord(entry) {
    try {
      if (!plainObject(entry) || !ID.test(entry.id ?? '') || !HASH.test(entry.recordHash ?? '') || parseTimestamp(entry.committedAt) === null) throw unavailable();
      const saved = await objects.get(`${prefix}/records/${entry.recordHash}.json`, { maxBytes: 160 * 1024 });
      if (!saved || !(saved.data instanceof Uint8Array) || digest(saved.data) !== entry.recordHash) throw unavailable();
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(saved.data));
      return structuredClone(checkedRecord(value, entry, eventId));
    } catch { throw unavailable(); }
  }
  return Object.freeze({
    prefix, readIndex, readRecord,
    async list() {
      const state = await readIndex();
      const registrations = [];
      for (const entry of state.value.entries) {
        const value = await readRecord(entry);
        registrations.push({ id: value.id, referenceCode: value.id, eventId: value.eventId, submittedAt: value.submittedAt, fields: value.fields, consent: value.consent, provenance: value.provenance });
      }
      return { registrations, revision: state.value.revision };
    },
    async find(keyHash, payloadHash) {
      if (!HASH.test(keyHash ?? '') || !HASH.test(payloadHash ?? '')) throw unavailable();
      const state = await readIndex(), entry = state.value.entries.find(item => item.keyHash === keyHash);
      if (!entry) return null;
      if (entry.payloadHash !== payloadHash) return { outcome: 'conflict' };
      await readRecord(entry);
      return { outcome: 'replayed', receipt: { committed: true, eventId, registrationId: entry.id, referenceCode: entry.id, committedAt: entry.committedAt } };
    },
    async accept({ value, keyHash, payloadHash, capacity }) {
      if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > MAX_REGISTRATIONS || !HASH.test(keyHash ?? '') || !HASH.test(payloadHash ?? '')
        || !plainObject(value) || value.eventId !== eventId || !plainObject(value.fields) || !plainObject(value.consent)) throw unavailable();
      const submittedAt = value.provenance?.kind === 'staff_assisted' ? value.submittedAt : value.consent.acceptedAt;
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
          await readRecord(previous);
          return { outcome: 'replayed', receipt: { committed: true, eventId, registrationId: previous.id, referenceCode: previous.id, committedAt: previous.committedAt } };
        }
        if (current.value.entries.length >= capacity) return { outcome: 'closed' };
        try {
          await objects.putImmutable(`${prefix}/records/${recordHash}.json`, bytes, { contentType: 'application/json' });
          await readRecord(entry);
        } catch { throw unavailable(); }
        const next = { ...current.value, revision: current.value.revision + 1, entries: [...current.value.entries, entry] };
        try {
          const saved = await journal.commit(current.cursor, next);
          if (!isDeepStrictEqual(saved?.value, next) || saved?.cursor?.version !== current.cursor.version + 1) throw unavailable();
        } catch (error) {
          // Only a definitive CAS rejection may retry. A lost ACK must be retried by the caller with the same key.
          if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) continue;
          throw unavailable();
        }
        const after = await readIndex(), verified = after.value.entries.find(item => item.keyHash === keyHash);
        if (!verified || !isDeepStrictEqual(verified, entry)) throw unavailable();
        await readRecord(verified);
        return { outcome: 'created', receipt: { committed: true, eventId, registrationId: id, referenceCode: id, committedAt: entry.committedAt } };
      }
      throw unavailable();
    },
  });
}
