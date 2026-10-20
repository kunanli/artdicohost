import { EDITABLE_CONTACT_FIELDS, validateImportedContact } from './contacts-schema.mjs';

export { EDITABLE_CONTACT_FIELDS } from './contacts-schema.mjs';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const singleLine = new Set(EDITABLE_CONTACT_FIELDS.filter(key => !['topics', 'background'].includes(key)));
const profileFrom = value => { const { sourceRowId, ...profile } = value; return profile; };
const result = (errors, value) => ({ valid: Object.keys(errors).length === 0, errors, value });

function editableInput(input, manual) {
  const errors = {}, value = {};
  if (!plain(input) || Object.getOwnPropertySymbols(input).length) return { errors: { profile: '请提供可编辑的基本资料。' }, value };
  const allowed = manual ? [...EDITABLE_CONTACT_FIELDS, 'contactConsent'] : EDITABLE_CONTACT_FIELDS;
  const names = Object.getOwnPropertyNames(input);
  if (!names.length || names.some(key => !allowed.includes(key))) errors.profile = '只能修改基本资料，不能更改来源、历史答案、联络同意或内部操作记录。';
  for (const key of names) {
    if (!allowed.includes(key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable || typeof descriptor.value !== 'string') {
      errors[key] = '请提供文字。'; continue;
    }
    const text = descriptor.value.normalize('NFC').trim();
    if (singleLine.has(key) && /[\u0000-\u001f\u007f]/u.test(descriptor.value)) errors[key] = '请填写不含换行或控制字符的单行文字。';
    if (key === 'website' && text) {
      try {
        const url = new URL(text);
        if (!/^https?:\/\//iu.test(text) || !['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
      } catch { errors.website = '网站只接受完整的 HTTP 或 HTTPS 地址。'; }
    }
    value[key] = text;
  }
  if (manual && Object.hasOwn(value, 'contactConsent') && !['unknown', 'consented', 'declined'].includes(value.contactConsent)) errors.contactConsent = '请明确选择未知、已同意联络或不同意联络。';
  return { errors, value };
}

/** Manual entry records a staff assertion, never permission inferred from an email or a historical answer. */
export function validateManualContactProfile(input) {
  const checked = editableInput(input, true);
  const imported = validateImportedContact({ ...checked.value, sourceRowId: 'manual', contactConsent: checked.value.contactConsent ?? 'unknown' });
  return result({ ...imported.errors, ...checked.errors }, profileFrom(imported.value));
}

/** Applies a basic-field patch while preserving every noneditable answer and consent value. */
export function validateContactProfileEdit(input, currentProfile) {
  const checked = editableInput(input, false);
  if (!plain(currentProfile)) return result({ profile: '原联系人资料不可读取，请重新载入。' }, null);
  const original = validateImportedContact({ ...currentProfile, sourceRowId: 'existing' });
  if (!original.valid) return result({ profile: '原联系人资料未通过校验，不能覆盖。' }, null);
  const imported = validateImportedContact({ ...profileFrom(original.value), ...checked.value, sourceRowId: 'existing' });
  return result({ ...imported.errors, ...checked.errors }, profileFrom(imported.value));
}

/** Consented invitees can prepare a draft while their attendance is pending.
 * The caller must separately recheck actual attendance and public consent before publication.
 */
export function guestPrefillFromContact(contact) {
  if (plain(contact) && contact.profile?.contactConsent !== 'consented') return result({ contactConsent: '对象未明确同意联络，不能准备嘉宾草稿。' }, null);
  if (!plain(contact) || !['pending', 'attending'].includes(contact.operations?.responseStatus)) return result({ responseStatus: '对象已婉拒或回复状态无效，不能准备本次嘉宾草稿。' }, null);
  if (!plain(contact.profile)) return result({ profile: '联系人资料不可读取，请重新载入。' }, null);
  const profile = contact.profile;
  const value = { name: profile.displayName || profile.name, company: profile.organization, ggjRole: profile.siteRole || '', contactId: contact.id };
  const errors = {};
  if (typeof contact.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(contact.id)) errors.contactId = '联系人关联标识无效，请重新载入。';
  for (const [key, max] of [['name', 120], ['company', 160], ['ggjRole', 160]]) {
    const text = value[key];
    if (typeof text !== 'string' || !text.trim() && key !== 'ggjRole' || typeof text === 'string' && ([...text].length > max || /[\u0000-\u001f\u007f]/u.test(text))) errors[key] = '请先核对嘉宾称呼、机构和 GGJ 职务的完整单行资料。';
  }
  return { ...result(errors, value), responseStatus: contact.operations.responseStatus };
}

/** Scheduling choices for outreach. No guest identities, private notes or event draft envelope. */
export function toContactPlanningContent(content) {
  if (!plain(content) || !Array.isArray(content.sessions) || !Array.isArray(content.booths)) throw new TypeError('场次或展位资料不可读取。');
  return {
    sessions: content.sessions.map(({ id, start, end, zone, title, status }) => ({ id, start, end, zone, title, status })),
    booths: content.booths.map(({ id, code, zone, organization, project, status }) => ({ id, code, zone, organization, project, status })),
  };
}
