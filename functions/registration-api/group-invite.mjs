import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { MAX_PORTRAIT_BYTES, PORTRAIT_TYPES, PORTRAIT_ID_PATTERN, normalizePortraitBytes } from '../../shared/portrait-codec.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { own, plainObject, parseTimestamp, clockTime } from './policy.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';

const PURPOSE = 'artdico-registration-group-invite-v1';
const MAX_TTL = 10 * 60 * 1000, MAX_EXPIRY = 7 * 24 * 60 * 60 * 1000;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const TOKEN_PART = /^[A-Za-z0-9_-]+$/u;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = (value, names) => plainObject(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const ERRORS = {
  FORBIDDEN: [403, '当前账号没有管理入群码的权限。'],
  GROUP_INVITE_UNAVAILABLE: [503, '入群码操作未确认完成，请重新载入后核对。'],
  INVALID_GROUP_INVITE: [422, '请上传有效的静态 PNG、JPEG 或 WebP 图片，并明确填写含时区的未来到期时间（七天以内）。'],
  GROUP_INVITE_CONFLICT: [409, '入群码已被更新，请重新载入后再决定。'],
  GROUP_INVITE_NOT_FOUND: [404, '入群码链接已失效，请返回报名结果页查看。'],
};
export class GroupInviteError extends Error {
  constructor(code = 'GROUP_INVITE_UNAVAILABLE') { super(ERRORS[code][1]); this.name = 'GroupInviteError'; this.code = code; this.status = ERRORS[code][0]; }
}
const failure = code => new GroupInviteError(code);
const validOrigin = value => { try { return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).origin === value; } catch { return false; } };

/** Private current image plus short-lived receipt-bound links; no anonymous current-QR endpoint. */
export function createGroupInviteService({ objects, journalFor, eventId, tokenSecret, apiOrigin = 'https://api.artdico.host',
  publicPath = '/api/admin/registration/group-invite/', clock = () => Date.now(), isWithdrawn } = {}) {
  if (!objects || !['get', 'putImmutable'].every(key => typeof objects[key] === 'function') || typeof journalFor !== 'function'
    || typeof eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)
    || typeof tokenSecret !== 'string' || Buffer.byteLength(tokenSecret) < 32 || Buffer.byteLength(tokenSecret) > 1024
    || !validOrigin(apiOrigin) || !['/api/registration/group-invite/', '/api/admin/registration/group-invite/'].includes(publicPath)
    || typeof clock !== 'function' || isWithdrawn !== undefined && typeof isWithdrawn !== 'function') throw failure();
  const prefix = `cms/v1/group-invites/${eventId}`;
  const signingKey = createHmac('sha256', tokenSecret).update(PURPOSE).digest();
  const sign = text => createHmac('sha256', signingKey).update(text).digest();
  function now() { let value; try { value = clockTime(clock()); } catch { throw failure(); } if (value === null || value < 0) throw failure(); return value; }
  function actorId(actor) {
    if (!canManageEventOperations(actor)) throw failure('FORBIDDEN');
    const id = own(actor, 'id'); if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(id)) throw failure('INVALID_GROUP_INVITE'); return id;
  }
  async function journal() { try { const value = await journalFor(prefix + '/state'); if (!value || !['read', 'commit'].every(key => typeof value[key] === 'function')) throw failure(); return value; } catch { throw failure(); } }
  function checkedActive(value) {
    if (!fields(value, ['imageId', 'contentType', 'bytes', 'expiresAt', 'updatedAt', 'updatedBy']) || !PORTRAIT_ID_PATTERN.test(value.imageId ?? '')
      || !Object.hasOwn(PORTRAIT_TYPES, value.contentType) || PORTRAIT_TYPES[value.contentType] !== value.imageId.split('.').at(-1)
      || !Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > MAX_PORTRAIT_BYTES
      || parseTimestamp(value.expiresAt) === null || parseTimestamp(value.updatedAt) === null
      || parseTimestamp(value.expiresAt) <= parseTimestamp(value.updatedAt) || parseTimestamp(value.expiresAt) - parseTimestamp(value.updatedAt) > MAX_EXPIRY
      || typeof value.updatedBy !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value.updatedBy)) throw failure();
    return value;
  }
  async function read() {
    try {
      const state = await (await journal()).read();
      if (!plainObject(state) || !plainObject(state.cursor) || !Number.isSafeInteger(state.cursor.version) || state.cursor.version < 0) throw failure();
      if (state.value === null) {
        if (state.cursor.version !== 0 || state.cursor.position !== 0 || state.cursor.hash !== null) throw failure();
        return { value: { schemaVersion: 1, kind: 'registration_group_invite', eventId, revision: 0, active: null, audit: [] }, cursor: state.cursor };
      }
      const value = state.value;
      if (!fields(value, ['schemaVersion', 'kind', 'eventId', 'revision', 'active', 'audit']) || value.schemaVersion !== 1 || value.kind !== 'registration_group_invite'
        || value.eventId !== eventId || value.revision !== state.cursor.version || !Array.isArray(value.audit) || value.audit.length !== value.revision || value.audit.length > 1000) throw failure();
      if (value.active !== null) checkedActive(value.active);
      for (const entry of value.audit) if (!fields(entry, ['action', 'actorId', 'at', 'imageId', 'expiresAt'])
        || !['replace', 'disable'].includes(entry.action) || typeof entry.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(entry.actorId)
        || parseTimestamp(entry.at) === null || entry.action === 'replace' && (!PORTRAIT_ID_PATTERN.test(entry.imageId ?? '') || parseTimestamp(entry.expiresAt) === null)
        || entry.action === 'disable' && (entry.imageId !== null || entry.expiresAt !== null)) throw failure();
      return { value, cursor: state.cursor };
    } catch { throw failure(); }
  }
  function projection(state) {
    const active = state.value.active, at = now();
    return { revision: state.value.revision, configured: active !== null, expired: active === null || parseTimestamp(active.expiresAt) <= at,
      expiresAt: active?.expiresAt ?? null, updatedAt: active?.updatedAt ?? null, contentType: active?.contentType ?? null, bytes: active?.bytes ?? null,
      imageUrl: active ? apiOrigin + '/api/admin/group-invite/image' : null,
      serverTime: new Date(at).toISOString(), maxExpiresAt: new Date(at + MAX_EXPIRY).toISOString() };
  }
  async function image(active) {
    try {
      const value = checkedActive(active), saved = await objects.get(prefix + '/images/' + value.imageId, { maxBytes: MAX_PORTRAIT_BYTES });
      if (!saved || saved.objectType !== 'Normal' || saved.contentType !== value.contentType || !(saved.data instanceof Uint8Array)
        || saved.data.length !== value.bytes || digest(saved.data) !== value.imageId.slice(0, 64)
        || !normalizePortraitBytes(Buffer.from(saved.data), value.contentType).equals(Buffer.from(saved.data))) throw failure();
      return { data: Buffer.from(saved.data), contentType: value.contentType, bytes: value.bytes };
    } catch { throw failure(); }
  }
  async function commit(state, active, actor, action, at) {
    if (state.value.audit.length >= 1000) throw failure();
    const next = { ...state.value, revision: state.value.revision + 1, active, audit: [...state.value.audit,
      { action, actorId: actor, at, imageId: active?.imageId ?? null, expiresAt: active?.expiresAt ?? null }] };
    try {
      const saved = await (await journal()).commit(state.cursor, next);
      if (!isDeepStrictEqual(saved?.value, next) || saved?.cursor?.version !== next.revision) throw failure();
      const verified = await read();
      if (verified.value.revision < next.revision || verified.value.audit[next.revision - 1]?.at !== at) throw failure();
      return projection(verified);
    } catch (error) {
      if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) throw failure('GROUP_INVITE_CONFLICT');
      throw failure();
    }
  }
  async function withdrawn(id) {
    if (!isWithdrawn) return false;
    try { const value = await isWithdrawn(id); if (typeof value !== 'boolean') throw failure(); return value; } catch { throw failure(); }
  }
  return Object.freeze({
    async adminRead(actor) { actorId(actor); return projection(await read()); },
    async adminImage(actor) { actorId(actor); const state = await read(); if (!state.value.active) throw failure('GROUP_INVITE_NOT_FOUND'); return image(state.value.active); },
    async replace(input, actor) {
      const id = actorId(actor), revision = own(input, 'expectedRevision'), contentType = own(input, 'contentType'), dataBase64 = own(input, 'dataBase64');
      const expires = parseTimestamp(own(input, 'expiresAt')), at = now();
      if (!Number.isSafeInteger(revision) || revision < 0 || typeof contentType !== 'string' || !Object.hasOwn(PORTRAIT_TYPES, contentType)
        || typeof dataBase64 !== 'string' || !dataBase64 || dataBase64.length > Math.ceil(MAX_PORTRAIT_BYTES / 3) * 4 || !BASE64.test(dataBase64)
        || expires === null || expires <= at || expires - at > MAX_EXPIRY) throw failure('INVALID_GROUP_INVITE');
      let data, sourceSha256;
      try { const raw = Buffer.from(dataBase64, 'base64'); if (raw.toString('base64') !== dataBase64) throw failure(); sourceSha256 = digest(raw); data = normalizePortraitBytes(raw, contentType); }
      catch { throw failure('INVALID_GROUP_INVITE'); }
      const state = await read();
      if (state.value.revision !== revision) throw failure('GROUP_INVITE_CONFLICT');
      const active = { imageId: `${digest(data)}.${PORTRAIT_TYPES[contentType]}`, contentType, bytes: data.length,
        expiresAt: new Date(expires).toISOString(), updatedAt: new Date(at).toISOString(), updatedBy: id };
      try { await objects.putImmutable(prefix + '/images/' + active.imageId, data, { contentType }); await image(active); } catch { throw failure(); }
      if (expires <= now()) throw failure('INVALID_GROUP_INVITE');
      return { ...await commit(state, active, id, 'replace', active.updatedAt), sourceSha256 };
    },
    async disable(input, actor) {
      const id = actorId(actor), revision = own(input, 'expectedRevision');
      if (!Number.isSafeInteger(revision) || revision < 0 || own(input, 'enabled') !== false) throw failure('INVALID_GROUP_INVITE');
      const state = await read(); if (state.value.revision !== revision) throw failure('GROUP_INVITE_CONFLICT');
      return commit(state, null, id, 'disable', new Date(now()).toISOString());
    },
    async forReceipt(input) {
      const receipt = own(input, 'receipt'), registrationId = own(receipt, 'registrationId') ?? own(receipt, 'referenceCode');
      if (own(receipt, 'committed') !== true || own(receipt, 'eventId') !== eventId || typeof registrationId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(registrationId)
        || own(receipt, 'referenceCode') !== registrationId || parseTimestamp(own(receipt, 'committedAt')) === null) throw failure();
      // Legacy receipts without admission facts retain their trusted current-state
      // hook. A supplied non-confirmed state can never mint a new QR capability.
      if (own(receipt, 'admissionStatus') !== undefined && own(receipt, 'admissionStatus') !== 'confirmed') return null;
      if (await withdrawn(registrationId)) return null;
      const state = await read(), at = now(), active = state.value.active;
      if (!active || parseTimestamp(active.expiresAt) <= at) return null;
      await image(active);
      const expiresAt = Math.min(at + MAX_TTL, parseTimestamp(active.expiresAt));
      const payload = { purpose: PURPOSE, eventId, registrationId, revision: state.value.revision, imageId: active.imageId, iat: at, exp: expiresAt };
      const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = encoded + '.' + sign(encoded).toString('base64url');
      return { platform: 'wechat', qrImageUrl: apiOrigin + publicPath + token, expiresAt: new Date(expiresAt).toISOString() };
    },
    async publicImage(token) {
      let payload;
      try {
        if (typeof token !== 'string' || token.length > 2048) throw failure();
        const parts = token.split('.');
        if (parts.length !== 2 || !parts.every(value => TOKEN_PART.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value)) throw failure();
        const supplied = Buffer.from(parts[1], 'base64url'), expected = sign(parts[0]);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw failure();
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(parts[0], 'base64url')));
        const at = now();
        if (!fields(payload, ['purpose', 'eventId', 'registrationId', 'revision', 'imageId', 'iat', 'exp']) || payload.purpose !== PURPOSE || payload.eventId !== eventId
          || typeof payload.registrationId !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(payload.registrationId)
          || !Number.isSafeInteger(payload.revision) || payload.revision < 1 || !PORTRAIT_ID_PATTERN.test(payload.imageId ?? '')
          || !Number.isSafeInteger(payload.iat) || payload.iat < 0 || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat || payload.exp - payload.iat > MAX_TTL
          || payload.iat > at || payload.exp <= at) throw failure();
      } catch { throw failure('GROUP_INVITE_NOT_FOUND'); }
      if (await withdrawn(payload.registrationId)) throw failure('GROUP_INVITE_NOT_FOUND');
      const state = await read(), active = state.value.active;
      if (!active || state.value.revision !== payload.revision || active.imageId !== payload.imageId || parseTimestamp(active.expiresAt) < payload.exp || parseTimestamp(active.expiresAt) <= now()) throw failure('GROUP_INVITE_NOT_FOUND');
      const result = await image(active), final = await read();
      if (final.value.revision !== state.value.revision || final.value.active?.imageId !== active.imageId || parseTimestamp(final.value.active?.expiresAt) <= now()
        || await withdrawn(payload.registrationId)) throw failure('GROUP_INVITE_NOT_FOUND');
      return result;
    },
  });
}
