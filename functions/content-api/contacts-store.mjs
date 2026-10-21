import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ContentError } from './store.mjs';
import {
  CONTACT_SCHEMA_VERSION, MAX_IMPORT_ROWS, MAX_CONTACTS, INVITATION_CHANNELS,
  validateImportedContact, validateContactOperations, validateInvitationSettings, preserveContactOperationDefaults, validateContactOrganizationMembershipChanges,
  validateStoredContact, createEmptyContactOperations,
} from '../../shared/contacts-schema.mjs';
import { validateManualContactProfile, validateContactProfileEdit, guestPrefillFromContact } from '../../shared/contact-editor.mjs';

const queues = new Map();
const PREVIEW_TTL_MS = 15 * 60 * 1000;
const MAX_PREVIEWS = 100;

function checkRevision(expected, actual) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new ContentError('INVALID_REVISION', '请提供有效的预期修订号。');
  if (expected !== actual) throw new ContentError('REVISION_CONFLICT', '联系人资料已更新，请重新载入后再决定。', 409);
}
function sourceKey(input) {
  if (typeof input !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(input)) throw new ContentError('INVALID_SOURCE', '请提供稳定的来源标识。', 422);
  return input;
}
function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceIdentity(key, rowId) { return key + '\0' + rowId; }
function contactId(key, rowId) { return 'c_' + createHash('sha256').update(sourceIdentity(key, rowId)).digest('hex').slice(0, 32); }
function profileFrom(value) {
  const { sourceRowId, ...profile } = value;
  return profile;
}
function contactEnvelope(state) { return structuredClone({ revision: state.revision, contacts: state.contacts }); }
function contactResult(state, contact) { return structuredClone({ revision: state.revision, contact }); }
function duplicateKeys(profile) {
  return [profile.email ? 'email:' + profile.email.trim().toLowerCase() : '', profile.wechat ? 'wechat:' + profile.wechat.trim().toLowerCase() : ''].filter(Boolean);
}
function validationError(result, message = '资料未通过校验。') {
  if (!result.valid) throw new ContentError('VALIDATION_ERROR', message, 422, result.errors);
  return result.value;
}

/**
 * A separate private local file. It never publishes or returns data to public
 * content. Writes are atomic and serialized only within one Node process.
 */
export function createFileContactsStore({ directory, contentStore, now = () => Date.now() }) {
  if (!directory || !contentStore?.read) throw new TypeError('必须指定私密联系人目录和内容存储。');
  const root = resolve(directory);
  const file = join(root, 'contacts.json');
  const previews = new Map();

  async function load() {
    try {
      const state = JSON.parse(await readFile(file, 'utf8'));
      if (state.storageVersion !== CONTACT_SCHEMA_VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0 || !Array.isArray(state.contacts) || state.contacts.length > MAX_CONTACTS || !Array.isArray(state.audit)) throw new Error('Invalid state');
      const ids = new Set();
      const identities = new Set();
      for (const item of state.contacts) {
        const identity = sourceIdentity(item?.source?.key, item?.source?.rowId);
        if (!validateStoredContact(item) || Object.hasOwn(item, 'sourceProfile') && digest(item.sourceProfile) !== item.sourceProfileDigest
          || ids.has(item.id) || identities.has(identity)) throw new Error('Invalid contact');
        // Older private files have no verified choice labels. Normalize them to
        // unknown without inferring permission or replacing staff operations.
        item.profile = profileFrom(validateImportedContact({ ...item.profile, sourceRowId: item.source.rowId }).value);
        item.operations = validateContactOperations(item.operations).value;
        ids.add(item.id);
        identities.add(identity);
      }
      return state;
    } catch (error) {
      if (error.code === 'ENOENT') return { storageVersion: CONTACT_SCHEMA_VERSION, revision: 0, contacts: [], audit: [] };
      throw new ContentError('CONTACT_STORAGE_ERROR', '私密联系人文件不可读取；请先检查备份，不要覆盖原文件。', 503);
    }
  }

  async function commit(state) {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const temporary = join(root, '.contacts-' + randomBytes(12).toString('hex') + '.tmp');
    let handle;
    try {
      handle = await open(temporary, 'wx', 0o600);
      await handle.writeFile(JSON.stringify(state, null, 2) + '\n', 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temporary, file);
    } catch {
      throw new ContentError('CONTACT_STORAGE_ERROR', '私密联系人保存未完成，请重新载入确认，不要重复覆盖。', 503);
    } finally {
      if (handle) await handle.close().catch(() => {});
      await unlink(temporary).catch(() => {});
    }
  }
  function serial(operation) {
    const result = (queues.get(file) ?? Promise.resolve()).then(operation);
    queues.set(file, result.catch(() => {}));
    return result;
  }
  function purgePreviews() {
    for (const [token, preview] of previews) if (preview.expiresAt <= now()) previews.delete(token);
  }
  function audit(state, action, actorId, detail = {}) {
    state.audit.push({ action, actorId, revision: state.revision, at: new Date(now()).toISOString(), ...detail });
  }
  function findContact(state, id) {
    const contact = state.contacts.find((item) => item.id === id);
    if (!contact) throw new ContentError('CONTACT_NOT_FOUND', '此联系人不存在，请重新载入。', 404);
    return contact;
  }
  function permitInvitation(contact) {
    if (contact.profile.contactConsent !== 'consented') throw new ContentError('CONTACT_NOT_CONSENTED', '来源资料未明确同意后续联系，不能生成或记录发送邀请函。', 422);
  }

  return {
    read: () => serial(async () => contactEnvelope(await load())),
    recordExport: (expectedRevision, actorId, input) => serial(async () => {
      if (typeof actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(actorId)
        || !input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).length !== 4 || !['count','includeContact','includeAnswers','workbookSha256'].every(key => Object.hasOwn(input,key))
        || !Number.isSafeInteger(input.count) || input.count < 0 || input.count > MAX_CONTACTS
        || typeof input.includeContact !== 'boolean' || typeof input.includeAnswers !== 'boolean' || !/^[a-f0-9]{64}$/u.test(input.workbookSha256 ?? '')) {
        throw new ContentError('VALIDATION_ERROR', '导出范围或文件摘要无效。', 422);
      }
      const state = await load(); checkRevision(expectedRevision, state.revision);
      if (input.count !== state.contacts.length) throw new ContentError('REVISION_CONFLICT', '导出名单已变化，请重新载入。', 409);
      if (state.audit.length >= 1000 || !Number.isSafeInteger(state.revision + 1)) throw new ContentError('CONTACT_LIMIT', '私密审计已达上限，请联系维护人员。', 422);
      const at = new Date(now()).toISOString();
      if (!Number.isFinite(Date.parse(at)) || state.audit.at(-1)?.at > at) throw new ContentError('CONTACT_STORAGE_ERROR', '导出审计时间未能核对。', 503);
      state.revision++;
      state.audit.push({ action: 'export_contacts', actorId, revision: state.revision, at, ...input });
      await commit(state); return { revision: state.revision };
    }),
    createContact: (expectedRevision, profileInput, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      if (state.contacts.length >= MAX_CONTACTS) throw new ContentError('CONTACT_LIMIT', '本地联系人数量已达上限。', 422);
      const profile = validationError(validateManualContactProfile(profileInput), '手动联系人资料未通过校验。');
      const rowId = randomBytes(16).toString('hex'), key = 'manual';
      const timestamp = new Date(now()).toISOString();
      const contact = {
        id: contactId(key, rowId),
        source: { key, rowId, digest: digest(profile), importedAt: timestamp },
        profile, sourceProfile: structuredClone(profile), sourceProfileDigest: digest(profile), operations: createEmptyContactOperations(),
        invitation: { generatedAt: null, settings: null, sentAt: null, channel: null, sentGenerationAt: null },
        createdAt: timestamp, updatedAt: timestamp,
      };
      if (state.contacts.some(item => item.id === contact.id) || !validateStoredContact(contact)) throw new ContentError('CONTACT_STORAGE_ERROR', '手动联系人未能建立，请重新载入后核对。', 503);
      state.contacts.push(contact);
      state.revision += 1;
      audit(state, 'create_contact', actorId, { contactId: contact.id, consentSource: 'staff_assertion', contactConsent: profile.contactConsent });
      await commit(state);
      return contactResult(state, contact);
    }),
    saveProfile: (id, expectedRevision, profileInput, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      const contact = findContact(state, id);
      const profile = validationError(validateContactProfileEdit(profileInput, contact.profile), '基本资料修正未通过校验。');
      // The first correction retains the original source answers. Its stable
      // identity/digest continue to drive reimport matching, never this patch.
      if (!Object.hasOwn(contact, 'sourceProfile')) {
        contact.sourceProfile = structuredClone(contact.profile);
        contact.sourceProfileDigest = digest(contact.sourceProfile);
      }
      contact.profile = profile;
      contact.updatedAt = new Date(now()).toISOString();
      if (!validateStoredContact(contact)) throw new ContentError('CONTACT_STORAGE_ERROR', '原始来源资料未通过校验，不能覆盖。', 503);
      state.revision += 1;
      audit(state, 'save_contact_profile', actorId, { contactId: id });
      await commit(state);
      return contactResult(state, contact);
    }),
    guestPrefill: id => serial(async () => {
      const state = await load();
      const result = guestPrefillFromContact(findContact(state, id));
      if (!result.valid && result.errors.contactConsent) throw new ContentError('CONTACT_NOT_CONSENTED', '对象未明确同意联络，不能准备嘉宾草稿。', 422);
      if (!result.valid && result.errors.responseStatus) throw new ContentError('CONTACT_DECLINED', '对象已婉拒参加，不能准备本次嘉宾草稿。', 422);
      return { prefill: structuredClone(validationError(result, '嘉宾预填资料未通过校验，请先核对基本资料。')), contactRevision: state.revision, responseStatus: result.responseStatus, ...(result.omittedFields?.length ? { omittedFields: result.omittedFields } : {}) };
    }),
    previewImport: (keyInput, rows, actorId) => serial(async () => {
      const key = sourceKey(keyInput);
      if (!Array.isArray(rows) || !rows.length || rows.length > MAX_IMPORT_ROWS) throw new ContentError('INVALID_IMPORT', '每批请提供 1–' + MAX_IMPORT_ROWS + ' 条来源资料。', 422);
      purgePreviews();
      if (previews.size >= MAX_PREVIEWS) throw new ContentError('IMPORT_PREVIEW_LIMIT', '暂存预览过多，请稍后重试。', 429);
      const state = await load();
      const prepared = [];
      const seen = new Set();
      for (const row of rows) {
        const result = validateImportedContact(row);
        const profile = profileFrom(result.value);
        const rowId = result.value.sourceRowId;
        const id = contactId(key, rowId);
        const existing = state.contacts.find((item) => item.source.key === key && item.source.rowId === rowId);
        const messages = Object.values(result.errors);
        if (seen.has(rowId)) messages.push('同一批资料的来源序号重复，请先核对。');
        seen.add(rowId);
        const fingerprint = digest(profile);
        const status = messages.length ? 'invalid' : existing ? existing.source.digest === fingerprint ? 'unchanged' : 'source_changed' : 'new';
        if (status === 'source_changed') messages.push('此来源资料已导入且内容发生变化；本批不会覆盖，请人工核对。');
        prepared.push({ id, rowId, profile, fingerprint, status, messages, duplicateContactIds: [] });
      }
      const candidates = [...state.contacts.map((item) => ({ id: item.id, profile: item.profile })), ...prepared.filter((item) => item.status === 'new')];
      for (const row of prepared) {
        if (row.status !== 'new') continue;
        const keys = duplicateKeys(row.profile);
        row.duplicateContactIds = [...new Set(candidates.filter((item) => item.id !== row.id && duplicateKeys(item.profile).some((value) => keys.includes(value))).map((item) => item.id))];
        if (row.duplicateContactIds.length) row.messages.push('邮箱或微信与其他资料相同；只是重复提示，不会自动合并。');
      }
      const summary = {
        total: prepared.length,
        new: prepared.filter((item) => item.status === 'new').length,
        unchanged: prepared.filter((item) => item.status === 'unchanged').length,
        conflicts: prepared.filter((item) => item.status === 'source_changed').length,
        invalid: prepared.filter((item) => item.status === 'invalid').length,
        possibleDuplicates: prepared.filter((item) => item.duplicateContactIds.length > 0).length,
      };
      if (state.contacts.length + summary.new > MAX_CONTACTS) throw new ContentError('CONTACT_LIMIT', '本地联系人数量已达上限。', 422);
      const previewToken = randomBytes(32).toString('base64url');
      const expiresAt = now() + PREVIEW_TTL_MS;
      const canCommit = summary.invalid === 0 && summary.conflicts === 0;
      previews.set(previewToken, { actorId, key, revision: state.revision, expiresAt, prepared, summary, canCommit });
      return {
        previewToken, expiresAt: new Date(expiresAt).toISOString(), summary, canCommit,
        rows: prepared.map((item) => ({ sourceRowId: item.rowId, displayName: item.profile.displayName, status: item.status, messages: item.messages, duplicateContactIds: item.duplicateContactIds })),
      };
    }),
    importPreview: (expectedRevision, previewToken, allowPossibleDuplicates, actorId) => serial(async () => {
      purgePreviews();
      const preview = previews.get(previewToken);
      if (!preview || preview.actorId !== actorId) throw new ContentError('IMPORT_PREVIEW_EXPIRED', '导入预览已失效，请由当前账号重新预览。', 409);
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      checkRevision(preview.revision, state.revision);
      if (!preview.canCommit) throw new ContentError('IMPORT_BLOCKED', '此批资料有无效行或来源变更，请先核对；没有导入任何资料。', 422);
      if (preview.summary.possibleDuplicates > 0 && allowPossibleDuplicates !== true) throw new ContentError('DUPLICATE_REVIEW_REQUIRED', '请核对可能重复对象；明确选择保留为独立联系人后再导入。', 422);
      if (preview.summary.new > 0) {
        const timestamp = new Date(now()).toISOString();
        for (const row of preview.prepared.filter((item) => item.status === 'new')) {
          state.contacts.push({
            id: row.id,
            source: { key: preview.key, rowId: row.rowId, digest: row.fingerprint, importedAt: timestamp },
            profile: row.profile, operations: createEmptyContactOperations(),
            invitation: { generatedAt: null, settings: null, sentAt: null, channel: null, sentGenerationAt: null },
            createdAt: timestamp, updatedAt: timestamp,
          });
        }
        state.revision += 1;
        audit(state, 'import_contacts', actorId, { added: preview.summary.new, unchanged: preview.summary.unchanged, duplicateReviewAccepted: preview.summary.possibleDuplicates > 0 });
        await commit(state);
      }
      previews.delete(previewToken);
      return { ...contactEnvelope(state), summary: structuredClone(preview.summary) };
    }),
    saveOperations: (id, expectedRevision, input, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      const contact = findContact(state, id);
      const { draft } = await contentStore.read();
      const inputWithForms = preserveContactOperationDefaults(input, contact.operations);
      const operations = validationError(validateContactOperations(inputWithForms, draft.content), '跟进资料或安排未通过校验。');
      validationError(validateContactOrganizationMembershipChanges(operations, contact.operations, draft.content.organizations ?? []), '组织成员关系未通过校验。');
      contact.operations = operations;
      contact.updatedAt = new Date(now()).toISOString();
      state.revision += 1;
      audit(state, 'save_contact_operations', actorId, { contactId: id });
      await commit(state);
      return contactResult(state, contact);
    }),
    recordGenerated: (id, expectedRevision, settingsInput, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      const contact = findContact(state, id);
      permitInvitation(contact);
      const settings = validationError(validateInvitationSettings(settingsInput), '邀请函设置未通过校验。');
      const timestamp = new Date(now()).toISOString();
      contact.invitation.generatedAt = timestamp;
      contact.invitation.settings = settings;
      contact.updatedAt = timestamp;
      state.revision += 1;
      audit(state, 'record_invitation_generated', actorId, { contactId: id });
      await commit(state);
      return contactResult(state, contact);
    }),
    recordSent: (id, expectedRevision, channel, generatedAt, settingsInput, actorId) => serial(async () => {
      const state = await load();
      checkRevision(expectedRevision, state.revision);
      const contact = findContact(state, id);
      permitInvitation(contact);
      if (!INVITATION_CHANNELS.includes(channel)) throw new ContentError('VALIDATION_ERROR', '请选择微信、邮箱或其他发送渠道。', 422, { channel: '发送渠道无效。' });
      if (!contact.invitation.generatedAt) throw new ContentError('INVITATION_NOT_GENERATED', '请先生成邀请图片，再手动记录已经发送。', 422);
      const settings = validationError(validateInvitationSettings(settingsInput), '请提供当时生成邀请函的完整设置。');
      if (generatedAt !== contact.invitation.generatedAt || JSON.stringify(settings) !== JSON.stringify(contact.invitation.settings)) {
        throw new ContentError('INVITATION_GENERATION_MISMATCH', '邀请设置或生成版本已变化，请重新生成并核对实际发送的图片。', 409);
      }
      const timestamp = new Date(now()).toISOString();
      contact.invitation.sentAt = timestamp;
      contact.invitation.sentGenerationAt = contact.invitation.generatedAt;
      contact.invitation.channel = channel;
      contact.updatedAt = timestamp;
      state.revision += 1;
      audit(state, 'record_invitation_manually_sent', actorId, { contactId: id, channel });
      await commit(state);
      return contactResult(state, contact);
    }),
  };
}
