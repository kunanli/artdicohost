/** Only fixed application diagnostics cross the invitation boundary. */
export class IntentInvitationError extends Error {
  constructor(code, status = 503) {
    const messages = {
      INVALID_INPUT: '请求资料无效，请重新核对。', FORBIDDEN: '当前账号没有此操作权限。',
      REVISION_CONFLICT: '名单或邀请记录已变化，请重新载入后核对。', CONTACT_NOT_FOUND: '联系人不存在。',
      CONTACT_DECLINED: '对象已拒绝联系或婉拒参加，不能自动转报名或邀请。',
      CONTACT_NOT_CONSENTED: '对象未明确同意联系，不能发出邀请。',
      REGISTRATION_REQUIRED: '请先完成此联系人的报名转换。', REGISTRATION_CHANGED: '报名关联已变化，请重新核对。',
      REGISTRATION_WAITLISTED: '报名仍在候补，确认名额前不能准备正式邀请。',
      REGISTRATION_INACTIVE: '报名已撤回或申请删除，不能继续邀请或安排。',
      INVITATION_CHANGED: '邀请内容已变化，请核对原版本，不自动重复发出。',
      EMAIL_NOT_READY: '发信服务尚未配置或本次操作未明确确认发送。',
      INVALID_ASSIGNMENT: '场次或展位已取消、删除或时间冲突，请重新选择。',
      CAPACITY_EXCEEDED: '邀请记录达到容量上限，请联系维护人员处理。',
      STORAGE_UNAVAILABLE: '操作未确认完成，请重新载入后核对，不要重复发送。',
    };
    super(messages[code] ?? messages.STORAGE_UNAVAILABLE);
    this.name = 'IntentInvitationError'; this.code = Object.hasOwn(messages, code) ? code : 'STORAGE_UNAVAILABLE'; this.status = status;
  }
}
export const failure = (code = 'STORAGE_UNAVAILABLE', status = 503) => new IntentInvitationError(code, status);

export function plainData(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Object.getOwnPropertySymbols(value).length) return false;
  return Object.getOwnPropertyNames(value).every(key => {
    const field = Object.getOwnPropertyDescriptor(value, key);
    return !['__proto__', 'constructor', 'prototype'].includes(key) && field && Object.hasOwn(field, 'value') && field.enumerable;
  });
}
export const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
export const revision = value => Number.isSafeInteger(value) && value >= 0;
export const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
