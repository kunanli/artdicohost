import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONTACT_SCHEMA_VERSION, MAX_CONTACTS, INVITATION_CHANNELS, validateImportedContact,
  validateStoredContact, validateContactOperations, validateInvitationSettings, createEmptyContactOperations, preserveContactOperationDefaults, validateContactOrganizationMembershipChanges } from '../../shared/contacts-schema.mjs';
import { validateManualContactProfile, validateContactProfileEdit, guestPrefillFromContact } from '../../shared/contact-editor.mjs';
import { CloudContentError } from './errors.mjs';
import { readMigrationSource } from '../intent-invitations/contact-snapshot.mjs';

export const MAX_CONTACT_STATE_BYTES = 1024 * 1024;
export const MAX_CONTACT_AUDIT_ENTRIES = 1000;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const ACTOR = /^[A-Za-z0-9_-]{1,80}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const keys = (value, allowed) => record(value) && !Object.getOwnPropertySymbols(value).length
  && Object.getOwnPropertyNames(value).length === allowed.length
  && allowed.every(key => { const field = Object.getOwnPropertyDescriptor(value, key); return field && 'value' in field && field.enumerable; });
const revision = value => Number.isSafeInteger(value) && value >= 0;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const hash = value => createHash('sha256').update(value).digest('hex');
const size = value => Buffer.byteLength(JSON.stringify(value));
const unavailable = () => new CloudContentError('CONTACT_STORAGE_ERROR', '私密联系人未能读取或保存，请重新载入后再检查。', 503);
const capacity = () => new CloudContentError('CONTACT_CAPACITY_EXCEEDED', '私密联系人记录已达到容量上限，请联系维护人员归档后再继续。', 503);
const conflict = () => new CloudContentError('REVISION_CONFLICT', '联系人资料已更新，请重新载入后再决定。', 409);
function checked(result, message = '资料未通过校验。') {
  if (!result.valid) throw new CloudContentError('VALIDATION_ERROR', message, 422, result.errors);
  return result.value;
}
function profileValue(profile, rowId) {
  const result = validateImportedContact({ ...profile, sourceRowId: rowId });
  const { sourceRowId: _, ...value } = result.value;
  if (!result.valid || !isDeepStrictEqual(value, profile)) throw unavailable();
  return value;
}

/** Private contacts only. The shared journal is the sole commit point; no local import token cache. */
export function createOssContactsStore({ journal, contentStore, now = () => Date.now() } = {}) {
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function'
    || typeof contentStore?.read !== 'function' || typeof now !== 'function') throw new TypeError('云端名单需要明确的持久日志、排程读取与时钟。');
  function timestamp(state) {
    try {
      const value = new Date(now()).toISOString();
      if (iso(value) && (!state.audit.length || value >= state.audit.at(-1).at)) return value;
    } catch { /* Fixed failure below. */ }
    throw unavailable();
  }
  function stateValue(input) {
    const archiveFields = Object.hasOwn(input ?? {}, 'migrationArchives') ? ['migrationArchives'] : [];
    if (!keys(input, ['storageVersion', 'revision', 'contacts', 'audit', ...archiveFields]) || input.storageVersion !== CONTACT_SCHEMA_VERSION
      || !revision(input.revision) || !Array.isArray(input.contacts) || input.contacts.length > MAX_CONTACTS
      || !Array.isArray(input.audit) || input.audit.length > MAX_CONTACT_AUDIT_ENTRIES
      || input.audit.length !== input.revision || size(input) > MAX_CONTACT_STATE_BYTES) throw unavailable();
    const ids = new Set(), identities = new Set();
    for (const contact of input.contacts) {
      const optional = Object.hasOwn(contact ?? {}, 'sourceProfile') ? ['sourceProfile', 'sourceProfileDigest'] : [];
      const operationFields = Object.keys(createEmptyContactOperations());
      const missingOperationDefaults = ['participationForms', 'sessionRoles', 'organizationMemberships'].filter(key => !Object.hasOwn(contact?.operations ?? {}, key));
      if (!keys(contact, ['id', 'source', 'profile', 'operations', 'invitation', 'createdAt', 'updatedAt', ...optional])
        || !keys(contact.source, ['key', 'rowId', 'digest', 'importedAt']) || !validateStoredContact(contact)
        || !iso(contact.createdAt) || !iso(contact.updatedAt) || !iso(contact.source.importedAt)
        || contact.createdAt !== contact.source.importedAt || contact.updatedAt < contact.createdAt
        || !keys(contact.operations, operationFields.filter(key => !missingOperationDefaults.includes(key)))
        || !keys(contact.invitation, ['settings', 'generatedAt', 'sentAt', 'sentGenerationAt', 'channel'])) throw unavailable();
      profileValue(contact.profile, contact.source.rowId);
      if (optional.length) {
        profileValue(contact.sourceProfile, contact.source.rowId);
        if (contact.sourceProfileDigest !== hash(JSON.stringify(contact.sourceProfile))) throw unavailable();
      }
      if (contact.id !== 'c_' + hash(contact.source.key + '\0' + contact.source.rowId).slice(0, 32)) throw unavailable();
      const expectedOperations = { ...contact.operations, ...Object.fromEntries(missingOperationDefaults.map(key => [key, []])) };
      if (!isDeepStrictEqual(validateContactOperations(contact.operations).value, expectedOperations)) throw unavailable();
      const invitation = contact.invitation;
      if (invitation.settings !== null && !isDeepStrictEqual(validateInvitationSettings(invitation.settings).value, invitation.settings)) throw unavailable();
      for (const name of ['generatedAt', 'sentAt', 'sentGenerationAt']) if (invitation[name] !== null
        && (!iso(invitation[name]) || invitation[name] < contact.createdAt || invitation[name] > contact.updatedAt)) throw unavailable();
      if (invitation.sentAt === null && (invitation.sentGenerationAt !== null || invitation.channel !== null)
        || invitation.sentAt !== null && invitation.sentGenerationAt > invitation.sentAt) throw unavailable();
      const identity = contact.source.key + '\0' + contact.source.rowId;
      if (ids.has(contact.id) || identities.has(identity)) throw unavailable();
      ids.add(contact.id); identities.add(identity);
    }
    const archives = new Map(), archivedIds = new Set();
    if (archiveFields.length) {
      if (!Array.isArray(input.migrationArchives) || input.migrationArchives.length > 20) throw unavailable();
      for (const archive of input.migrationArchives) {
        if (!keys(archive, ['digest', 'snapshot', 'sourceKind', 'sourceFileSha256', 'payloadSha256', 'importedAt', 'actorId', 'contactIds'])
          || !SHA.test(archive.digest) || typeof archive.snapshot !== 'string' || hash(archive.snapshot) !== archive.digest
          || !['snapshot', 'rows'].includes(archive.sourceKind) || !SHA.test(archive.sourceFileSha256) || !SHA.test(archive.payloadSha256)
          || !iso(archive.importedAt) || !ACTOR.test(archive.actorId) || !Array.isArray(archive.contactIds) || !archive.contactIds.length
          || archive.contactIds.some(id => !ID.test(id) || !ids.has(id)) || new Set(archive.contactIds).size !== archive.contactIds.length
          || archives.has(archive.digest)) throw unavailable();
        let original; try { original = readMigrationSource(archive.snapshot, archive.sourceKind, archive.sourceFileSha256, archive.payloadSha256); } catch { throw unavailable(); }
        const baselines = new Map(original.contacts.map(contact => [contact.id, contact]));
        for (const id of archive.contactIds) {
          const baseline = baselines.get(id), current = input.contacts.find(contact => contact.id === id);
          if (!baseline || archivedIds.has(id) || !isDeepStrictEqual(current.source, baseline.source) || current.createdAt !== baseline.createdAt
            || baseline.updatedAt > archive.importedAt || current.updatedAt < baseline.updatedAt) throw unavailable();
          archivedIds.add(id);
        }
        archives.set(archive.digest, { archive, baselines });
      }
    }
    const usedArchives = new Set(), created = new Set(), last = new Map(), generated = new Map(), sent = new Map(); let at = '';
    for (const [index, entry] of input.audit.entries()) {
      if (entry.action === 'export_contacts') {
        if (!keys(entry, ['action', 'actorId', 'revision', 'at', 'count', 'includeContact', 'includeAnswers', 'workbookSha256'])
          || entry.revision !== index + 1 || !ACTOR.test(entry.actorId ?? '') || !iso(entry.at) || entry.at < at
          || entry.count !== created.size || typeof entry.includeContact !== 'boolean' || typeof entry.includeAnswers !== 'boolean'
          || !SHA.test(entry.workbookSha256 ?? '')) throw unavailable();
        at = entry.at; continue;
      }
      if (entry.action === 'import_contacts') {
        if (!keys(entry, ['action', 'actorId', 'revision', 'at', 'archiveDigest', 'contactIds']) || entry.revision !== index + 1
          || !ACTOR.test(entry.actorId) || !iso(entry.at) || entry.at < at || !archives.has(entry.archiveDigest) || usedArchives.has(entry.archiveDigest)) throw unavailable();
        const { archive, baselines } = archives.get(entry.archiveDigest);
        if (archive.actorId !== entry.actorId || archive.importedAt !== entry.at || !isDeepStrictEqual(archive.contactIds, entry.contactIds)) throw unavailable();
        for (const id of archive.contactIds) {
          const baseline = baselines.get(id);
          if (created.has(id)) throw unavailable();
          created.add(id); last.set(id, baseline.updatedAt);
          if (baseline.invitation.generatedAt) generated.set(id, { at: baseline.invitation.generatedAt, settingsDigest: hash(JSON.stringify(baseline.invitation.settings)) });
          if (baseline.invitation.sentAt) sent.set(id, { at: baseline.invitation.sentAt, generatedAt: baseline.invitation.sentGenerationAt, channel: baseline.invitation.channel });
        }
        usedArchives.add(entry.archiveDigest); at = entry.at; continue;
      }
      const extra = entry.action === 'create_contact' ? ['consentSource', 'contactConsent', 'sourceDigest']
        : entry.action === 'record_invitation_manually_sent' ? ['channel']
          : entry.action === 'record_invitation_generated' ? ['settingsDigest'] : [];
      if (!keys(entry, ['action', 'actorId', 'revision', 'at', 'contactId', ...extra])
        || typeof entry.actorId !== 'string' || !ACTOR.test(entry.actorId) || !ids.has(entry.contactId) || entry.revision !== index + 1
        || !iso(entry.at) || entry.at < at) throw unavailable();
      const contact = input.contacts.find(item => item.id === entry.contactId);
      if (entry.action === 'create_contact') {
        if (created.has(entry.contactId) || entry.at !== contact.createdAt || entry.consentSource !== 'staff_assertion'
          || entry.contactConsent !== (contact.sourceProfile ?? contact.profile).contactConsent || entry.sourceDigest !== contact.source.digest) throw unavailable();
        created.add(entry.contactId);
      } else if (!created.has(entry.contactId) || !['save_contact_profile', 'save_contact_operations', 'record_invitation_generated', 'record_invitation_manually_sent'].includes(entry.action)) throw unavailable();
      if (entry.action === 'record_invitation_generated') {
        if (!SHA.test(entry.settingsDigest) || contact.profile.contactConsent !== 'consented') throw unavailable();
        generated.set(entry.contactId, { at: entry.at, settingsDigest: entry.settingsDigest });
      }
      if (entry.action === 'record_invitation_manually_sent') {
        if (!INVITATION_CHANNELS.includes(entry.channel) || !generated.has(entry.contactId) || contact.profile.contactConsent !== 'consented') throw unavailable();
        sent.set(entry.contactId, { at: entry.at, generatedAt: generated.get(entry.contactId).at, channel: entry.channel });
      }
      at = entry.at; last.set(entry.contactId, entry.at);
    }
    if (created.size !== ids.size || usedArchives.size !== archives.size || input.contacts.some(contact => last.get(contact.id) !== contact.updatedAt)) throw unavailable();
    for (const contact of input.contacts) {
      const invitation = contact.invitation, generation = generated.get(contact.id), delivery = sent.get(contact.id);
      if (invitation.generatedAt !== (generation?.at ?? null)
        || generation && hash(JSON.stringify(invitation.settings)) !== generation.settingsDigest
        || invitation.sentAt !== (delivery?.at ?? null) || invitation.sentGenerationAt !== (delivery?.generatedAt ?? null)
        || invitation.channel !== (delivery?.channel ?? null)) throw unavailable();
    }
    const normalized = structuredClone(input);
    // Old snapshots are interpreted conservatively, without a write or revision
    // change. A later explicit mutation persists the empty operations default.
    for (const contact of normalized.contacts) for (const field of ['participationForms', 'sessionRoles', 'organizationMemberships']) if (!Object.hasOwn(contact.operations, field)) contact.operations[field] = [];
    if (size(normalized) > MAX_CONTACT_STATE_BYTES) throw unavailable();
    return normalized;
  }
  async function load() {
    try {
      const result = await journal.read(), cursor = result?.cursor;
      if (!keys(result, ['value', 'cursor']) || !keys(cursor, ['position', 'version', 'hash'])
        || !revision(cursor.position) || !revision(cursor.version)) throw unavailable();
      if (result.value === null) {
        if (cursor.position || cursor.version || cursor.hash !== null) throw unavailable();
        return { cursor, state: { storageVersion: CONTACT_SCHEMA_VERSION, revision: 0, contacts: [], audit: [] } };
      }
      if (!cursor.position || !cursor.version || typeof cursor.hash !== 'string' || !SHA.test(cursor.hash)) throw unavailable();
      const state = stateValue(result.value);
      if (state.revision !== cursor.version) throw unavailable();
      return { cursor, state };
    } catch { throw unavailable(); }
  }
  async function commit(cursor, state) {
    if (state.audit.length > MAX_CONTACT_AUDIT_ENTRIES || size(state) > MAX_CONTACT_STATE_BYTES) throw capacity();
    try {
      stateValue(state);
      const ack = await journal.commit(cursor, structuredClone(state));
      if (!keys(ack, ['value', 'cursor']) || !keys(ack.cursor, ['position', 'version', 'hash'])
        || !isDeepStrictEqual(ack.value, state) || !revision(ack.cursor.position) || ack.cursor.position <= cursor.position
        || ack.cursor.version !== cursor.version + 1 || typeof ack.cursor.hash !== 'string' || !SHA.test(ack.cursor.hash)) throw unavailable();
    } catch (error) {
      if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409) throw conflict();
      throw unavailable();
    }
  }
  function find(state, id) {
    const contact = typeof id === 'string' && ID.test(id) ? state.contacts.find(item => item.id === id) : null;
    if (!contact) throw new CloudContentError('CONTACT_NOT_FOUND', '此联系人不存在，请重新载入。', 404);
    return contact;
  }
  function permitInvitation(contact) {
    if (contact.profile.contactConsent !== 'consented') throw new CloudContentError('CONTACT_NOT_CONSENTED', '来源资料未明确同意后续联系，不能生成或记录发送邀请函。', 422);
  }
  async function mutate(expected, actorId, update) {
    if (typeof actorId !== 'string' || !ACTOR.test(actorId)) throw new CloudContentError('INVALID_ACTOR', '操作账号标识无效。', 400);
    if (!revision(expected)) throw new CloudContentError('INVALID_REVISION', '请提供有效的预期修订号。', 400);
    const { state, cursor } = await load();
    if (expected !== state.revision) throw conflict();
    if (state.audit.length >= MAX_CONTACT_AUDIT_ENTRIES || !Number.isSafeInteger(state.revision + 1)) throw capacity();
    const at = timestamp(state), change = await update(state, at);
    change.contact.updatedAt = at; state.revision++;
    state.audit.push({ action: change.action, actorId, revision: state.revision, at, contactId: change.contact.id, ...(change.detail ?? {}) });
    await commit(cursor, state);
    return structuredClone({ revision: state.revision, contact: change.contact });
  }
  return {
    read: async () => { const { state } = await load(); return structuredClone({ revision: state.revision, contacts: state.contacts }); },
    recordExport: async (expected, actorId, input) => {
      if (!ACTOR.test(actorId ?? '') || !revision(expected) || !keys(input, ['count', 'includeContact', 'includeAnswers', 'workbookSha256'])
        || !revision(input.count) || input.count > MAX_CONTACTS || typeof input.includeContact !== 'boolean'
        || typeof input.includeAnswers !== 'boolean' || !SHA.test(input.workbookSha256 ?? '')) {
        throw new CloudContentError('VALIDATION_ERROR', '导出范围、修订号或文件摘要无效。', 422);
      }
      const { state, cursor } = await load();
      if (expected !== state.revision) throw conflict();
      if (input.count !== state.contacts.length) throw conflict();
      if (state.audit.length >= MAX_CONTACT_AUDIT_ENTRIES || !Number.isSafeInteger(state.revision + 1)) throw capacity();
      const at = timestamp(state); state.revision++;
      state.audit.push({ action: 'export_contacts', actorId, revision: state.revision, at, ...input });
      await commit(cursor, state);
      return { revision: state.revision };
    },
    importContacts: async ({ expectedRevision, snapshot, sourceKind, sourceFileSha256, sourceDigest, actorId, allowPossibleDuplicates = false } = {}) => {
      if (!revision(expectedRevision) || !ACTOR.test(actorId ?? '') || !['snapshot', 'rows'].includes(sourceKind)
        || !SHA.test(sourceFileSha256 ?? '') || !SHA.test(sourceDigest ?? '') || typeof allowPossibleDuplicates !== 'boolean') throw new CloudContentError('VALIDATION_ERROR', '导入来源或修订号无效。', 422);
      let original; try { original = readMigrationSource(snapshot, sourceKind, sourceFileSha256, sourceDigest); } catch { throw new CloudContentError('VALIDATION_ERROR', '原始名单、来源摘要或历史审计无效。', 422); }
      const { state, cursor } = await load();
      const prior = state.migrationArchives?.find(archive => archive.payloadSha256 === sourceDigest && archive.sourceFileSha256 === sourceFileSha256 && archive.sourceKind === sourceKind);
      if (prior) return { committed: true, revision: state.revision, sourceDigest, imported: false };
      if (state.revision !== expectedRevision) throw conflict();
      const additions = [];
      for (const contact of original.contacts) {
        const current = state.contacts.find(item => item.id === contact.id || item.source.key === contact.source.key && item.source.rowId === contact.source.rowId);
        if (current) {
          if (current.id !== contact.id || current.source.digest !== contact.source.digest) throw conflict();
        } else additions.push(contact);
      }
      if (!additions.length) return { committed: true, revision: state.revision, sourceDigest, imported: false };
      if (state.contacts.length + additions.length > MAX_CONTACTS || state.audit.length >= MAX_CONTACT_AUDIT_ENTRIES) throw capacity();
      for (const contact of additions) {
        const duplicate = [...state.contacts, ...additions].some(other => other.id !== contact.id
          && (contact.profile.email && other.profile.email.toLowerCase() === contact.profile.email.toLowerCase()
            || contact.profile.wechat && other.profile.wechat.toLowerCase() === contact.profile.wechat.toLowerCase()));
        if (duplicate && !allowPossibleDuplicates) throw new CloudContentError('DUPLICATE_REVIEW_REQUIRED', '请核对重复联络资料并明确保留为不同对象后再导入。', 422);
      }
      const at = timestamp(state), digest = hash(snapshot), contactIds = additions.map(contact => contact.id);
      if (additions.some(contact => contact.updatedAt > at)) throw new CloudContentError('VALIDATION_ERROR', '来源记录时间晚于受控服务器时间。', 422);
      state.contacts.push(...structuredClone(additions));
      state.migrationArchives ??= [];
      state.migrationArchives.push({ digest, snapshot, sourceKind, sourceFileSha256, payloadSha256: sourceDigest, importedAt: at, actorId, contactIds });
      state.revision++;
      state.audit.push({ action: 'import_contacts', actorId, revision: state.revision, at, archiveDigest: digest, contactIds });
      await commit(cursor, state);
      return { committed: true, revision: state.revision, sourceDigest, imported: true };
    },
    createContact: (expected, input, actorId) => mutate(expected, actorId, (state, at) => {
      if (state.contacts.length >= MAX_CONTACTS) throw capacity();
      const profile = checked(validateManualContactProfile(input));
      const rowId = randomBytes(16).toString('hex');
      const contact = { id: 'c_' + hash('manual\0' + rowId).slice(0, 32),
        source: { key: 'manual', rowId, digest: hash(JSON.stringify(profile)), importedAt: at },
        profile, sourceProfile: structuredClone(profile), sourceProfileDigest: hash(JSON.stringify(profile)), operations: createEmptyContactOperations(),
        invitation: { settings: null, generatedAt: null, sentAt: null, sentGenerationAt: null, channel: null }, createdAt: at, updatedAt: at };
      state.contacts.push(contact);
      return { contact, action: 'create_contact', detail: { consentSource: 'staff_assertion', contactConsent: profile.contactConsent, sourceDigest: contact.source.digest } };
    }),
    saveProfile: (id, expected, input, actorId) => mutate(expected, actorId, state => {
      const contact = find(state, id), profile = checked(validateContactProfileEdit(input, contact.profile));
      if (!contact.sourceProfile) {
        contact.sourceProfile = structuredClone(contact.profile); contact.sourceProfileDigest = hash(JSON.stringify(contact.sourceProfile));
      }
      contact.profile = profile;
      return { contact, action: 'save_contact_profile' };
    }),
    saveOperations: (id, expected, input, actorId) => mutate(expected, actorId, async state => {
      const contact = find(state, id);
      let content; try { content = (await contentStore.read()).draft.content; } catch { throw unavailable(); }
      const update = preserveContactOperationDefaults(input, contact.operations);
      const next = checked(validateContactOperations(update, content), '跟进资料或安排未通过校验。');
      checked(validateContactOrganizationMembershipChanges(next, contact.operations, content.organizations ?? []), '组织成员关系未通过校验。');
      contact.operations = next;
      return { contact, action: 'save_contact_operations' };
    }),
    recordGenerated: (id, expected, input, actorId) => mutate(expected, actorId, (state, at) => {
      const contact = find(state, id); permitInvitation(contact);
      contact.invitation.settings = checked(validateInvitationSettings(input), '邀请函设置未通过校验。');
      contact.invitation.generatedAt = at;
      return { contact, action: 'record_invitation_generated', detail: { settingsDigest: hash(JSON.stringify(contact.invitation.settings)) } };
    }),
    recordSent: (id, expected, channel, generatedAt, input, actorId) => mutate(expected, actorId, (state, at) => {
      const contact = find(state, id); permitInvitation(contact);
      if (!INVITATION_CHANNELS.includes(channel)) throw new CloudContentError('VALIDATION_ERROR', '发送渠道无效。', 422, { channel: '请选择微信、邮箱或其他发送渠道。' });
      if (!contact.invitation.generatedAt) throw new CloudContentError('INVITATION_NOT_GENERATED', '请先生成邀请图片，再手动记录已经发送。', 422);
      const settings = checked(validateInvitationSettings(input), '请提供当时生成邀请函的完整设置。');
      if (generatedAt !== contact.invitation.generatedAt || !isDeepStrictEqual(settings, contact.invitation.settings)) throw new CloudContentError('INVITATION_GENERATION_MISMATCH', '邀请设置或生成版本已变化，请重新生成并核对实际发送的图片。', 409);
      Object.assign(contact.invitation, { sentAt: at, sentGenerationAt: generatedAt, channel });
      return { contact, action: 'record_invitation_manually_sent', detail: { channel } };
    }),
    guestPrefill: async id => {
      const { state } = await load(), result = guestPrefillFromContact(find(state, id));
      if (!result.valid && result.errors.contactConsent) throw new CloudContentError('CONTACT_NOT_CONSENTED', '来源资料未明确同意后续联系，不能准备嘉宾草稿。', 422);
      if (!result.valid && result.errors.responseStatus) throw new CloudContentError('CONTACT_DECLINED', '对象已婉拒参加，不能准备本次嘉宾草稿。', 422);
      return { prefill: checked(result), contactRevision: state.revision, responseStatus: result.responseStatus, ...(result.omittedFields?.length ? { omittedFields: result.omittedFields } : {}) };
    },
  };
}
