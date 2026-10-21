import { validateContent, toPublicContent, PORTRAIT_ID_PATTERN } from '../../shared/content-schema.mjs';
import { createInitialContent } from '../../src/config/content.mjs';
import { CloudContentError } from './errors.mjs';
import { isDeepStrictEqual } from 'node:util';

export const MAX_CONTENT_STATE_BYTES = 1024 * 1024;
export const MAX_CONTENT_AUDIT_ENTRIES = 1000;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, allowed) => record(value) && !Object.getOwnPropertySymbols(value).length
  && Object.getOwnPropertyNames(value).length === allowed.length
  && allowed.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field && 'value' in field && field.enumerable; });
const revision = value => Number.isSafeInteger(value) && value >= 0;
const actor = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/u.test(value);
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const unavailable = () => new CloudContentError('STORAGE_ERROR', '云端内容未能读取或保存，请重新载入后再检查。', 503);
const capacity = () => new CloudContentError('CONTENT_CAPACITY_EXCEEDED', '内容记录已达到容量上限，请联系维护人员归档后再继续。', 503);
const conflict = () => new CloudContentError('REVISION_CONFLICT', '内容已被更新，请重新载入后再决定。', 409);
function checkedContent(input) {
  const checked = validateContent(input);
  if (!checked.valid) throw new CloudContentError('VALIDATION_ERROR', '内容未通过校验。', 422, checked.errors);
  return checked.value;
}
function checkRevision(expected, actual) {
  if (!revision(expected)) throw new CloudContentError('INVALID_REVISION', '请提供有效的预期修订号。', 400);
  if (expected !== actual) throw conflict();
}
function checkActor(value) {
  if (!actor(value)) throw new CloudContentError('INVALID_ACTOR', '操作账号标识无效。', 400);
}
function envelope(state) { return structuredClone({ draft: state.draft, published: state.published }); }
function bytes(value) { return Buffer.byteLength(JSON.stringify(value)); }

function preserveArrangementFields(input, current) {
  const copy = (value, field) => {
    if (!record(value)) throw new CloudContentError('VALIDATION_ERROR', '请提供完整的内容资料。', 422, { [field]: '请提供普通资料对象。' });
    const result = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable) continue;
      if (!('value' in descriptor)) throw new CloudContentError('VALIDATION_ERROR', '内容字段无效。', 422, { [field]: '请提供明确的资料值。' });
      result[key] = descriptor.value;
    }
    return result;
  };
  const result = copy(input, 'content');
  if (!Object.hasOwn(result, 'organizations') && Object.hasOwn(current, 'organizations')) result.organizations = structuredClone(current.organizations);
  if (Array.isArray(result.organizations)) result.organizations = result.organizations.map(item => {
    const row = copy(item, 'organizations');
    const id = typeof row.id === 'string' ? row.id.normalize('NFC').trim() : '';
    const existing = current.organizations?.find(candidate => candidate.id === id);
    if (!Object.hasOwn(row, 'internalNotes') && existing) row.internalNotes = existing.internalNotes;
    return row;
  });
  for (const [collection, field, fallback] of [['sessions', 'format', 'other'], ['booths', 'slotNumber', 0]]) {
    if (!Array.isArray(result[collection])) continue;
    result[collection] = result[collection].map(item => {
      const row = copy(item, collection);
      const id = typeof row.id === 'string' ? row.id.normalize('NFC').trim() : '';
      const existing = current[collection].find(candidate => candidate.id === id);
      if (row[field] === undefined) {
        row[field] = existing?.[field] ?? fallback;
      }
      if (collection === 'booths' && existing) for (const name of ['contactName', 'contactMethods', 'description', 'website']) {
        if (!Object.hasOwn(row, name) && Object.hasOwn(existing, name)) row[name] = existing[name];
      }
      return row;
    });
  }
  if (Array.isArray(result.guests)) result.guests = result.guests.map(item => {
    const row = copy(item, 'guests');
    const id = typeof row.id === 'string' ? row.id.normalize('NFC').trim() : '';
    const existing = current.guests.find(candidate => candidate.id === id);
    for (const name of ['title','bio','website','publicRoles']) {
      if (!Object.hasOwn(row,name) && existing && Object.hasOwn(existing,name)) row[name] = structuredClone(existing[name]);
    }
    return row;
  });
  return result;
}

/** Private durable state. The journal, not a process mutex, owns atomic commit position. */
export function createOssContentStore({ journal, portraitStore, initialContent = createInitialContent(), now = () => Date.now() } = {}) {
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function' || typeof now !== 'function') {
    throw new TypeError('云端内容需要明确的持久日志与时钟。');
  }
  const seed = checkedContent(initialContent);
  const timestamp = () => {
    try { const value = new Date(now()).toISOString(); if (iso(value)) return value; } catch { /* Fixed failure below. */ }
    throw unavailable();
  };
  function checkedState(input) {
    if (!keys(input, ['storageVersion', 'draft', 'published', 'audit']) || input.storageVersion !== 1
      || !keys(input.draft, ['revision', 'content']) || !revision(input.draft.revision)
      || !Array.isArray(input.audit) || input.audit.length > MAX_CONTENT_AUDIT_ENTRIES || bytes(input) > MAX_CONTENT_STATE_BYTES) throw unavailable();
    const draft = { revision: input.draft.revision, content: checkedContent(input.draft.content) };
    if (draft.content.eventId !== seed.eventId) throw unavailable();
    let auditedRevision = 0, lastPublication = null;
    const audit = Array.from(input.audit).map(entry => {
      if (!record(entry) || !actor(entry.actorId) || !iso(entry.at)) throw unavailable();
      if (entry.action === 'save_draft') {
        if (!keys(entry, ['action', 'actorId', 'revision', 'at']) || entry.revision !== ++auditedRevision) throw unavailable();
      } else if (entry.action === 'publish') {
        if (!keys(entry, ['action', 'actorId', 'revision', 'at']) || entry.revision !== auditedRevision) throw unavailable();
        lastPublication = { revision: entry.revision, publishedAt: entry.at };
      } else if (entry.action === 'upload_portrait') {
        if (!keys(entry, ['action', 'actorId', 'portraitId', 'bytes', 'at']) || typeof entry.portraitId !== 'string'
          || !PORTRAIT_ID_PATTERN.test(entry.portraitId) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 || entry.bytes > 512 * 1024) throw unavailable();
      } else throw unavailable();
      return structuredClone(entry);
    });
    if (auditedRevision !== draft.revision) throw unavailable();
    let published = null;
    if (input.published !== null) {
      if (!keys(input.published, ['revision', 'publishedAt', 'content']) || !revision(input.published.revision)
        || input.published.revision > draft.revision || !iso(input.published.publishedAt)
        || !lastPublication || lastPublication.revision !== input.published.revision || lastPublication.publishedAt !== input.published.publishedAt) throw unavailable();
      const content = toPublicContent(checkedContent(input.published.content));
      if (content.eventId !== seed.eventId || input.published.revision === draft.revision
        && JSON.stringify(content) !== JSON.stringify(toPublicContent(draft.content))) throw unavailable();
      published = { revision: input.published.revision, publishedAt: input.published.publishedAt, content };
    } else if (lastPublication) throw unavailable();
    return { storageVersion: 1, draft, published, audit };
  }
  async function load() {
    try {
      const result = await journal.read();
      const cursor = result?.cursor;
      if (!record(result) || !record(cursor) || !revision(cursor.position) || !revision(cursor.version)) throw unavailable();
      if (result.value === null) {
        if (cursor.position !== 0 || cursor.version !== 0 || cursor.hash !== null) throw unavailable();
        return { cursor, state: { storageVersion: 1, draft: { revision: 0, content: structuredClone(seed) }, published: null, audit: [] } };
      }
      if (!cursor.position || !cursor.version || typeof cursor.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(cursor.hash)) throw unavailable();
      return { cursor, state: checkedState(result.value) };
    } catch { throw unavailable(); }
  }
  async function commit(cursor, state) {
    if (state.audit.length > MAX_CONTENT_AUDIT_ENTRIES || bytes(state) > MAX_CONTENT_STATE_BYTES) throw capacity();
    try {
      const ack = await journal.commit(cursor, structuredClone(state));
      if (!keys(ack, ['value', 'cursor']) || !keys(ack.cursor, ['position', 'version', 'hash'])
        || !isDeepStrictEqual(ack.value, state) || !revision(ack.cursor.position) || ack.cursor.position <= cursor.position
        || !revision(ack.cursor.version) || ack.cursor.version !== cursor.version + 1
        || typeof ack.cursor.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(ack.cursor.hash)) throw unavailable();
    }
    catch (error) {
      if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) throw conflict();
      throw unavailable();
    }
  }
  function audit(state, entry) {
    if (state.audit.length >= MAX_CONTENT_AUDIT_ENTRIES) throw capacity();
    state.audit.push(entry);
  }
  async function verifyPortraits(content) {
    const verified = new Set();
    const images = [
      ...content.guests.map((guest, index) => ({ id: guest.portraitId, field: `guests.${index}.portraitId` })),
      ...(content.showcases ?? []).map((showcase, index) => ({ id: showcase.coverId, field: `showcases.${index}.coverId` })),
      ...(content.organizations ?? []).map((organization, index) => ({ id: organization.logoId, field: `organizations.${index}.logoId` })),
    ];
    for (const image of images) {
      if (!image.id || verified.has(image.id)) continue;
      if (!portraitStore || typeof portraitStore.verify !== 'function') throw new CloudContentError('PORTRAITS_UNAVAILABLE', '云端头像存储未配置。', 503);
      try {
        const proof = await portraitStore.verify(image.id);
        if (proof?.id !== image.id) throw unavailable();
      } catch {
        throw new CloudContentError('VALIDATION_ERROR', '头像、作品图或组织图片不存在或不可读取，请重新上传。', 422, { [image.field]: '请选择已成功上传且仍可读取的图片。' });
      }
      verified.add(image.id);
    }
  }
  return {
    read: async () => envelope((await load()).state),
    save: async (expectedRevision, input, actorId) => {
      checkActor(actorId);
      const { state, cursor } = await load();
      checkRevision(expectedRevision, state.draft.revision);
      if (state.draft.content.guests.length && (!record(input) || !Object.hasOwn(input, 'guests'))) {
        throw new CloudContentError('VALIDATION_ERROR', '现有嘉宾资料不可因字段缺失被清空，请重新载入完整草稿。', 422, { guests: '请保留完整嘉宾数组；删除须明确提交修改。' });
      }
      if (state.draft.content.showcases?.length && (!record(input) || !Object.hasOwn(input, 'showcases'))) {
        throw new CloudContentError('VALIDATION_ERROR', '现有学生展示不可因字段缺失被清空，请重新载入完整草稿。', 422, { showcases: '请保留完整展示数组；删除须明确提交修改。' });
      }
      const content = checkedContent(preserveArrangementFields(input, state.draft.content));
      if (content.eventId !== seed.eventId) throw new CloudContentError('VALIDATION_ERROR', '本后台只维护当前活动。', 422, { eventId: '活动 ID 不可更改。' });
      await verifyPortraits(content);
      if (!Number.isSafeInteger(state.draft.revision + 1)) throw capacity();
      state.draft = { revision: state.draft.revision + 1, content };
      audit(state, { action: 'save_draft', actorId, revision: state.draft.revision, at: timestamp() });
      await commit(cursor, state);
      return structuredClone(state.draft);
    },
    publish: async (expectedRevision, actorId) => {
      checkActor(actorId);
      const { state, cursor } = await load();
      checkRevision(expectedRevision, state.draft.revision);
      await verifyPortraits(state.draft.content);
      if (state.published?.revision === state.draft.revision) return structuredClone(state.published);
      state.published = { revision: state.draft.revision, publishedAt: timestamp(), content: toPublicContent(state.draft.content) };
      audit(state, { action: 'publish', actorId, revision: state.draft.revision, at: state.published.publishedAt });
      await commit(cursor, state);
      return structuredClone(state.published);
    },
    recordPortraitUpload: async (portraitId, actorId) => {
      checkActor(actorId);
      if (!portraitStore || typeof portraitStore.verify !== 'function') throw new CloudContentError('PORTRAITS_UNAVAILABLE', '云端头像存储未配置。', 503);
      let portrait;
      try { portrait = await portraitStore.verify(portraitId); } catch { throw unavailable(); }
      if (portrait?.id !== portraitId || !Number.isSafeInteger(portrait.bytes) || portrait.bytes < 1 || portrait.bytes > 512 * 1024) throw unavailable();
      const { state, cursor } = await load();
      audit(state, { action: 'upload_portrait', actorId, portraitId: portrait.id, bytes: portrait.bytes, at: timestamp() });
      await commit(cursor, state);
    },
  };
}
