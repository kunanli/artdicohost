const safe = new WeakSet();
const TEXT = Object.freeze({
  INVALID_REQUEST: ['请求格式或筛选条件无效。', 400],
  AUTH_REQUIRED: ['会话已结束，请重新登录。', 401],
  INVALID_REVIEW: ['审核资料无效，请核对后重试。', 422],
  NOT_FOUND: ['申请记录不存在。', 404],
  FORBIDDEN: ['当前账号没有此操作权限。', 403],
  ORIGIN_REJECTED: ['请求来源不被允许。', 403],
  CSRF_REJECTED: ['安全校验未通过，请重新载入后台。', 403],
  REVISION_CONFLICT: ['审核资料已被更新，请重新载入后再决定。', 409],
  REVIEW_NOT_READY: ['报名审核后台尚未开放。', 503],
  STORAGE_UNAVAILABLE: ['报名资料暂时不可用，请稍后重新载入。', 503],
  CAPACITY_REACHED: ['审核记录已达维护上限，请联系管理员。', 503],
  BODY_TOO_LARGE: ['请求内容过大。', 413],
  UNSUPPORTED_MEDIA_TYPE: ['请发送 JSON 请求。', 415],
});

export class RegistrationAdminError extends Error {
  constructor(code = 'STORAGE_UNAVAILABLE') {
    const [message, status] = TEXT[code] ?? TEXT.STORAGE_UNAVAILABLE;
    super(message);
    this.code = Object.hasOwn(TEXT, code) ? code : 'STORAGE_UNAVAILABLE';
    this.status = status;
    safe.add(this);
  }
}

export function isRegistrationAdminError(error) { return safe.has(error); }
