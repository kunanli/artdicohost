import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { failure, plainData, identifier, revision, iso } from './errors.mjs';

const MAX_BYTES = 1024 * 1024;
const MAX_RECORDS = 1000;
const HASH = /^[a-f0-9]{64}$/u;
const STATUSES = ['prepared', 'issuing', 'provider_accepted', 'unknown', 'rejected', 'manually_sent'];
const exact = (value, names) => plainData(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));

function stateValue(value) {
  if (!exact(value, ['schemaVersion', 'revision', 'conversions', 'invitations', 'audit']) || value.schemaVersion !== 1 || !revision(value.revision)
    || !Array.isArray(value.conversions) || !Array.isArray(value.invitations) || !Array.isArray(value.audit)
    || value.conversions.length > MAX_RECORDS || value.invitations.length > MAX_RECORDS || value.audit.length > MAX_RECORDS
    || value.audit.length !== value.revision || Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw failure();
  const sources = new Set(), invitations = new Set();
  for (const item of value.conversions) {
    const optional = Object.hasOwn(item ?? {}, 'projectionWarnings') ? ['projectionWarnings'] : [];
    if (!exact(item, ['sourceContactId', 'registrationId', 'referenceCode', 'sourceDigest', 'sourceKey', 'sourceRowId', 'permissionReference', 'recordedAt', 'actorId', ...optional])
      || !identifier(item.sourceContactId) || !identifier(item.registrationId) || !identifier(item.referenceCode) || !HASH.test(item.sourceDigest)
      || !identifier(item.sourceKey) || typeof item.sourceRowId !== 'string' || !item.sourceRowId.length || item.sourceRowId.length > 100
      || typeof item.permissionReference !== 'string' || !item.permissionReference.trim() || item.permissionReference.length > 1000
      || !iso(item.recordedAt) || !identifier(item.actorId) || sources.has(item.sourceContactId)
      || optional.length && (!Array.isArray(item.projectionWarnings) || item.projectionWarnings.some(field => !['website', 'caseLinks'].includes(field)) || new Set(item.projectionWarnings).size !== item.projectionWarnings.length)) throw failure();
    sources.add(item.sourceContactId);
  }
  for (const item of value.invitations) {
    if (!exact(item, ['id', 'sourceContactId', 'registrationId', 'referenceCode', 'digest', 'channel', 'status', 'content', 'createdAt', 'updatedAt', 'actorId', 'sentChannel'])
      || !identifier(item.id) || !identifier(item.sourceContactId) || !identifier(item.registrationId) || !identifier(item.referenceCode)
      || !HASH.test(item.digest) || !['manual', 'email'].includes(item.channel) || !STATUSES.includes(item.status)
      || !plainData(item.content) || createHash('sha256').update(JSON.stringify(item.content)).digest('hex') !== item.digest
      || !iso(item.createdAt) || !iso(item.updatedAt) || item.updatedAt < item.createdAt
      || !identifier(item.actorId) || !(item.sentChannel === null || ['wechat', 'email', 'other'].includes(item.sentChannel))
      || item.status === 'manually_sent' && (!item.sentChannel || item.channel !== 'manual')
      || item.channel === 'manual' && !['prepared', 'manually_sent'].includes(item.status)
      || item.channel === 'email' && item.sentChannel !== null || invitations.has(item.id)) throw failure();
    const linked = value.conversions.find(conversion => conversion.sourceContactId === item.sourceContactId);
    if (!linked || linked.registrationId !== item.registrationId || linked.referenceCode !== item.referenceCode) throw failure();
    invitations.add(item.id);
  }
  let previous = '';
  for (const [index, entry] of value.audit.entries()) {
    const optional = entry?.action === 'convert_contact' && Object.hasOwn(entry, 'projectionWarnings') ? ['projectionWarnings'] : [];
    if (!exact(entry, ['revision', 'action', 'actorId', 'sourceContactId', 'invitationId', 'at', ...optional]) || entry.revision !== index + 1
      || !['convert_contact', 'prepare_invitation', 'reserve_email', 'email_result', 'manual_sent'].includes(entry.action)
      || !identifier(entry.actorId) || !identifier(entry.sourceContactId) || !sources.has(entry.sourceContactId)
      || !(entry.invitationId === null || invitations.has(entry.invitationId)) || !iso(entry.at) || entry.at < previous
      || optional.length && (!Array.isArray(entry.projectionWarnings) || entry.projectionWarnings.some(field => !['website', 'caseLinks'].includes(field))
        || !isDeepStrictEqual(entry.projectionWarnings, value.conversions.find(item => item.sourceContactId === entry.sourceContactId)?.projectionWarnings))) throw failure();
    previous = entry.at;
  }
  return structuredClone(value);
}

/** One private shared journal; no delivery cache or process-local deduplication. */
export function createIntentInvitationRepository({ journal } = {}) {
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function') throw new TypeError('Invitation journal required.');
  async function read() {
    try {
      const result = await journal.read();
      if (!exact(result, ['value', 'cursor']) || !exact(result.cursor, ['position', 'version', 'hash'])
        || !revision(result.cursor.position) || !revision(result.cursor.version)) throw failure();
      if (result.value === null) {
        if (result.cursor.position || result.cursor.version || result.cursor.hash !== null) throw failure();
        return { value: { schemaVersion: 1, revision: 0, conversions: [], invitations: [], audit: [] }, cursor: result.cursor };
      }
      if (!result.cursor.position || !HASH.test(result.cursor.hash)) throw failure();
      const value = stateValue(result.value);
      if (value.revision !== result.cursor.version) throw failure();
      return { value, cursor: structuredClone(result.cursor) };
    } catch { throw failure(); }
  }
  return Object.freeze({
    read,
    async commit(cursor, next) {
      const value = stateValue(next);
      if (value.audit.length >= MAX_RECORDS || Buffer.byteLength(JSON.stringify(value)) >= MAX_BYTES) throw failure('CAPACITY_EXCEEDED');
      if (!exact(cursor, ['position', 'version', 'hash']) || value.revision !== cursor.version + 1) throw failure();
      try {
        const ack = await journal.commit(structuredClone(cursor), value);
        if (!exact(ack, ['value', 'cursor']) || !exact(ack.cursor, ['position', 'version', 'hash']) || !isDeepStrictEqual(ack.value, value)
          || ack.cursor.version !== value.revision || !Number.isSafeInteger(ack.cursor.position) || ack.cursor.position <= cursor.position || !HASH.test(ack.cursor.hash)) throw failure();
        return { value: structuredClone(value), cursor: structuredClone(ack.cursor) };
      } catch (error) {
        if (error?.code === 'WRITE_CONFLICT' && error?.status === 409) throw failure('REVISION_CONFLICT', 409);
        throw failure();
      }
    },
  });
}
