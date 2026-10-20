import { registrationSchema, getActiveBranches, isRegistrationFieldRequired } from '../../shared/registration-schema.mjs';
import { plainObject, own, clockTime, validateRegistrationPolicy } from './policy.mjs';

export const MAX_REGISTRATION_BYTES = 128 * 1024;

/** Decoded JSON guard; a future HTTP adapter must additionally limit bytes before parsing. */
function boundedJson(input) {
  const pending = [{ value: input, depth: 0 }];
  const seen = new Set();
  let nodes = 0;
  try {
    while (pending.length) {
      const { value, depth } = pending.pop();
      if (++nodes > 20_000 || depth > 16) return false;
      if (value === null || typeof value === 'boolean') continue;
      if (typeof value === 'string') { if (value.length > MAX_REGISTRATION_BYTES) return false; continue; }
      if (typeof value === 'number') { if (!Number.isFinite(value)) return false; continue; }
      if ((!Array.isArray(value) && !plainObject(value)) || seen.has(value)) return false;
      if (Array.isArray(value) && Object.getPrototypeOf(value) !== Array.prototype) return false;
      seen.add(value);
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors).filter(key => !Array.isArray(value) || key !== 'length');
      if (Array.isArray(value) && (value.length > 20_000 || keys.length !== value.length)) return false;
      for (const key of keys) {
        const descriptor = descriptors[key];
        if (typeof key !== 'string' || !descriptor.enumerable || !('value' in descriptor)) return false;
        if (Array.isArray(value) && !/^(0|[1-9]\d*)$/u.test(key)) return false;
        pending.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
    return new TextEncoder().encode(JSON.stringify(input)).byteLength <= MAX_REGISTRATION_BYTES;
  } catch { return false; }
}

function httpUrl(value) {
  if (/\s/u.test(value)) return false;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !!url.hostname && !url.username && !url.password; }
  catch { return false; }
}

/** Strict API types; normalization never discards malformed array members to make them valid. */
function fieldValue(source, field) {
  const raw = own(source, field.name);
  if (raw === undefined) return field.required ? { error: '请填写必填项目。' } : { value: field.type === 'checkbox-group' ? [] : '' };
  if (field.type === 'checkbox-group') {
    if (!Array.isArray(raw) || raw.length > 64 || raw.some(item => typeof item !== 'string')) return { error: '请提供有效的选项数组。' };
    const choices = raw.map(item => item.normalize('NFC').trim());
    if (choices.some(item => !field.options?.some(option => option.value === item)) || field.required && !choices.length) return { error: '请选择提供的选项。' };
    return { value: [...new Set(choices)] };
  }
  if (field.type === 'number') {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < field.min || raw > field.max) return { error: '请提供范围内的整数。' };
    return { value: raw };
  }
  if (typeof raw !== 'string') return { error: '请提供文本值。' };
  const value = raw.normalize('NFC').trim();
  const length = [...value].length;
  if (field.required && !length) return { error: '请填写必填项目。' };
  if (field.minLength && length < field.minLength || field.maxLength && length > field.maxLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) return { error: '文本长度或格式无效。' };
  if (!value) return { value };
  if (field.options && !field.options.some(option => option.value === value)) return { error: '请选择提供的选项。' };
  if (field.type === 'email' && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value)) return { error: '请提供有效的邮箱。' };
  if (field.type === 'url' && !httpUrl(value)) return { error: '请提供不含登录凭据的 http/https 链接。' };
  if (field.type === 'url-list') {
    const urls = value.split(/\r?\n/u).map(item => item.trim()).filter(Boolean);
    if (urls.length > 5 || urls.some(item => !httpUrl(item))) return { error: '最多提供五个有效的 http/https 链接。' };
  }
  return { value };
}

/**
 * Pure server-boundary preparation. A valid value is NOT an accepted or persisted registration.
 * Caller supplies trusted policy and clock; client approvals, IDs and timestamps are discarded.
 */
export function validateRegistrationSubmission(payload, { policy, now } = {}) {
  const checkedPolicy = validateRegistrationPolicy(policy, { now });
  if (!checkedPolicy.valid) return { valid: false, errors: { policy: '服务端报名配置未通过核验。' } };
  if (!plainObject(payload) || !boundedJson(payload)) return { valid: false, errors: { payload: '请提供大小、结构与类型有效的 JSON 对象。' } };
  const errors = {};
  const source = own(payload, 'fields');
  const consent = own(payload, 'consent');
  const configured = checkedPolicy.value;
  if (own(payload, 'eventId') !== configured.eventId) errors.eventId = '活动 ID 不匹配。';
  if (!plainObject(source)) errors.fields = '请提供报名资料对象。';
  if (own(consent, 'accepted') !== true) errors['consent.accepted'] = '请主动同意正式个人信息处理告知。';
  if (own(consent, 'version') !== configured.privacy.version) errors['consent.version'] = '个人信息处理告知版本不匹配。';
  const fields = {};
  function readField(input, field, target, key, branch = '') {
    const result = fieldValue(input, { ...field, required: isRegistrationFieldRequired(field, source, branch) });
    if (result.error) errors[key] = result.error;
    else target[field.name] = result.value;
  }
  for (const field of registrationSchema.baseFields) {
    if (field.name !== 'consentAccepted' && !field.conditional) readField(source, field, fields, `fields.${field.name}`);
  }
  const active = getActiveBranches(fields);
  for (const field of registrationSchema.baseFields.filter(field => field.conditional && active.includes(field.conditional))) readField(source, field, fields, `fields.${field.name}`);
  for (const name of active.filter(name => name !== 'accommodation')) {
    const branch = own(source, name);
    if (!plainObject(branch)) { errors[`fields.${name}`] = '请提供当前身份对应的资料对象。'; continue; }
    fields[name] = {};
    for (const field of registrationSchema.branches[name].fields) readField(branch, field, fields[name], `fields.${name}.${field.name}`, name);
  }
  fields.accommodationNights = active.includes('accommodation') ? 1 : 0;
  if (Object.keys(errors).length) return { valid: false, errors };
  return { valid: true, errors, value: { eventId: configured.eventId, fields, consent: { accepted: true, version: configured.privacy.version, acceptedAt: new Date(clockTime(now)).toISOString() } } };
}

/** Existing permission plus staff provenance is a distinct intake route, never public consent. */
export function validateStaffRegistrationFields(source) {
  if (!plainObject(source) || !boundedJson(source)) return { valid: false, errors: { fields: '请提供有效的已有联络资料。' } };
  const errors = {}, fields = {};
  function read(input, field, target, key) {
    if (own(input, field.name) === undefined && field.name !== 'name') return;
    const checked = fieldValue(input, { ...field, required: field.name === 'name' });
    if (checked.error) errors[key] = checked.error;
    else target[field.name] = checked.value;
  }
  for (const field of registrationSchema.baseFields) if (field.name !== 'consentAccepted') read(source, field, fields, `fields.${field.name}`);
  if (!fields.email && !fields.wechat) errors['fields.contact'] = '至少保留邮箱或微信联络方式。';
  for (const name of getActiveBranches(fields).filter(name => name !== 'accommodation')) {
    const branch = own(source, name);
    if (branch === undefined) continue;
    if (!plainObject(branch)) { errors[`fields.${name}`] = '请提供有效的已知分支资料。'; continue; }
    fields[name] = {};
    for (const field of registrationSchema.branches[name].fields) read(branch, field, fields[name], `fields.${name}.${field.name}`);
  }
  if (Object.hasOwn(fields, 'accommodationChoice')) fields.accommodationNights = fields.accommodationChoice === 'needed' ? 1 : 0;
  return Object.keys(errors).length ? { valid: false, errors } : { valid: true, errors, value: fields };
}
