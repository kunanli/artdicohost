import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';

const ORIGIN = 'https://api.artdico.host';
const ROOT = '/api/admin/admissions';
export const MAX_ADMISSIONS_BODY_BYTES = 32 * 1024;
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const routes = new Map([
  [ROOT + '/settings', ['PUT', 'setAdmissionSettings', ['settings'], true]],
  [ROOT + '/kind', ['POST', 'setAdmissionKind', ['registrationId', 'kind'], true]],
  [ROOT + '/approve', ['POST', 'approveApplication', ['registrationId'], false]],
  [ROOT + '/reject', ['POST', 'rejectApplication', ['registrationId'], false]],
  [ROOT + '/withdraw', ['POST', 'withdrawAdmission', ['registrationId'], false]],
  [ROOT + '/promote', ['POST', 'promoteAdmissions', [], false]],
  [ROOT + '/teams', ['POST', 'saveAdmissionTeam', ['team'], false]],
  [ROOT + '/teams/remove', ['POST', 'removeAdmissionTeam', ['teamId'], false]],
  [ROOT + '/staff', ['POST', 'addStaffMember', ['input'], true]],
]);
const specs = {
  AUTH_REQUIRED: [401, '会话已结束，请重新登录。'], FORBIDDEN: [403, '当前账号没有此操作权限。'],
  ORIGIN_REJECTED: [403, '请求来源不被允许。'], CSRF_REJECTED: [403, '安全校验未通过，请重新载入后台。'],
  INVALID_REQUEST: [400, '名额管理请求格式无效。'], NOT_FOUND: [404, '名额管理接口不存在。'],
  METHOD_NOT_ALLOWED: [405, '此接口不接受该方法。'], BODY_TOO_LARGE: [413, '请求内容过大。'],
  UNSUPPORTED_MEDIA_TYPE: [415, '请发送 UTF-8 JSON 请求。'], CONFLICT: [409, '资料已更新，请重新载入后再决定。'],
  CAPACITY_CONFLICT: [409, '当前名额安排无法容纳这项变更。'], UNAVAILABLE: [503, '名额管理暂不可用，请稍后重新检查。'],
  CLOSED: [409, '当前未开放新增人员登记。'],
};
const safe = new WeakSet();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => plain(value) && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const snapshot = value => Number.isSafeInteger(value?.revision) && value.revision >= 0 && plain(value.settings) && plain(value.summary)
  && Array.isArray(value.people) && Array.isArray(value.teams) && Number.isSafeInteger(value.auditCount) && value.auditCount >= 0;
const registrationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value);
const ids = value => Array.isArray(value) && value.length <= 1000 && new Set(value).size === value.length && value.every(registrationId);
function decisionReceipt(result, input, action) {
  const receipt = result.operation;
  return registrationId(input.registrationId) && result.registrationId === input.registrationId
    && exact(receipt, ['operationId', 'action', 'registrationId', 'revision'])
    && receipt.operationId === input.operationId && receipt.action === action && receipt.registrationId === input.registrationId
    && receipt.revision === input.expectedRevision + 1 && receipt.revision <= result.revision
    && ids(result.promotedIds) && ids(result.releasedIds) && !result.promotedIds.includes(input.registrationId)
    && result.people.filter(person => person?.registrationId === input.registrationId).length === 1
    && ['pending_review', 'confirmed', 'waitlisted', 'rejected', 'withdrawn'].includes(result.people.find(person => person?.registrationId === input.registrationId)?.status);
}
function emailProjection(value, count) {
  return ['not_configured', 'pending', 'completed'].includes(value?.status)
    && Number.isSafeInteger(value.attemptedCount) && value.attemptedCount >= 0 && value.attemptedCount <= count
    && value.pendingCount === count - value.attemptedCount
    ? { status: value.status, attemptedCount: value.attemptedCount, pendingCount: value.pendingCount } : null;
}
function approvalEmailProjection(value) {
  return value?.status === 'not_applicable' && value.attemptedCount === 0 && value.pendingCount === 0
    ? { status: 'not_applicable', attemptedCount: 0, pendingCount: 0 } : emailProjection(value, 1);
}
const failures = { invalid: 'INVALID_REQUEST', conflict: 'CONFLICT', forbidden: 'FORBIDDEN', not_found: 'NOT_FOUND', capacity_conflict: 'CAPACITY_CONFLICT', unavailable: 'UNAVAILABLE', closed: 'CLOSED' };
const resultFailure = result => Object.hasOwn(failures, result?.outcome) ? failures[result.outcome] : 'UNAVAILABLE';
function fail(code = 'UNAVAILABLE') { const error = new Error(code); error.code = code; safe.add(error); throw error; }
const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status, headers: { ...SECURITY, ...extra, 'content-type': 'application/json; charset=utf-8' } });
async function inputBody(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) fail('UNSUPPORTED_MEDIA_TYPE');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) fail('INVALID_REQUEST');
  if (Number(declared) > MAX_ADMISSIONS_BODY_BYTES) fail('BODY_TOO_LARGE');
  const reader = request.body?.getReader(), chunks = [];
  const timeout = new AbortController(), signal = AbortSignal.any([request.signal, timeout.signal]);
  let bytes = 0, onAbort;
  const aborted = new Promise((_, reject) => { onAbort = () => { reader?.cancel().catch(() => {}); reject(new Error()); }; signal.addEventListener('abort', onAbort, { once: true }); });
  const timer = setTimeout(() => timeout.abort(), 10_000); timer.unref();
  try {
    if (signal.aborted) fail('INVALID_REQUEST');
    if (reader) while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_ADMISSIONS_BODY_BYTES) fail('BODY_TOO_LARGE');
      chunks.push(next.value);
    }
    if (declared !== null && Number(declared) !== bytes) fail('INVALID_REQUEST');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plain(value)) fail('INVALID_REQUEST');
    return value;
  } catch (error) { if (safe.has(error)) throw error; fail('INVALID_REQUEST'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}

/** Exact same-origin private boundary; service mutations retain their journal CAS and operation ID. */
export function createAdmissionsApi({ enabled = false, auth, service, onCommitted } = {}) {
  if (typeof enabled !== 'boolean' || onCommitted !== undefined && typeof onCommitted !== 'function') throw new TypeError('名额管理配置无效。');
  if (enabled && (typeof auth?.authenticate !== 'function' || !['getAdmissions', ...[...routes.values()].map(value => value[1])].every(name => typeof service?.[name] === 'function'))) throw new TypeError('名额管理依赖未配置。');
  return async request => {
    let allow;
    try {
      const url = new URL(request.url), route = routes.get(url.pathname), reading = url.pathname === ROOT;
      if (url.origin !== ORIGIN || url.username || url.password || url.hash) fail('ORIGIN_REJECTED');
      if (!enabled) fail();
      if (!reading && !route) fail('NOT_FOUND');
      if (url.search) fail('INVALID_REQUEST');
      const method = reading ? 'GET' : route[0];
      if (request.method !== method) { allow = method; fail('METHOD_NOT_ALLOWED'); }
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== ORIGIN || !reading && origin !== ORIGIN) fail('ORIGIN_REJECTED');
      const session = await auth.authenticate(request), roles = session?.user?.roles;
      if (!Array.isArray(roles) || !roles.some(role => ['reviewer', 'superadmin'].includes(role))) fail('FORBIDDEN');
      if (reading) {
        const result = await service.getAdmissions({ actor: session.user });
        if (!snapshot(result)) fail(resultFailure(result));
        return json(result);
      }
      if (route[3] && !canManageEventOperations(session.user)) fail('FORBIDDEN');
      if (!equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) fail('CSRF_REJECTED');
      const input = await inputBody(request);
      if (!exact(input, ['expectedRevision', 'operationId', ...route[2]]) || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
        || typeof input.operationId !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/u.test(input.operationId)) fail('INVALID_REQUEST');
      const action = url.pathname.slice(ROOT.length + 1), decision = ['approve', 'reject'].includes(action);
      if (decision && !registrationId(input.registrationId)) fail('INVALID_REQUEST');
      const result = await service[route[1]]({ ...input, actor: session.user });
      if (!['updated', 'replayed'].includes(result?.outcome) || !snapshot(result)) fail(resultFailure(result));
      if (decision && !decisionReceipt(result, input, action)) fail();
      const confirmedStaff = action === 'staff' && result.receipt?.committed === true
        && registrationId(result.registrationId) && result.receipt.registrationId === result.registrationId
        && result.receipt.referenceCode === result.registrationId && result.receipt.admissionStatus === 'confirmed'
        && result.people.some(person => person.registrationId === result.registrationId && person.status === 'confirmed');
      const promotionCount = ids(result.promotedIds) ? result.promotedIds.length : 0;
      let promotionEmail, approvalEmail;
      if (onCommitted && (action === 'approve' || confirmedStaff || promotionCount > 0)) {
        if (promotionCount) promotionEmail = { status: 'pending', attemptedCount: 0, pendingCount: promotionCount };
        if (confirmedStaff || action === 'approve' && result.people.find(person => person?.registrationId === input.registrationId)?.status === 'confirmed') {
          approvalEmail = { status: 'pending', attemptedCount: 0, pendingCount: 1 };
        }
        try {
          const value = await onCommitted({ action, result: structuredClone(result), actor: session.user });
          if (action === 'approve' || confirmedStaff) {
            approvalEmail = approvalEmailProjection(value?.approvalEmail) ?? approvalEmail;
            if (promotionCount) promotionEmail = emailProjection(value?.promotionEmail, promotionCount) ?? promotionEmail;
          } else if (promotionCount) promotionEmail = emailProjection(value, promotionCount) ?? promotionEmail;
        } catch { /* A proven admission commit remains successful even when delivery is unavailable. */ }
      }
      return json({ ...result, ...(approvalEmail ? { approvalEmail } : {}), ...(promotionEmail ? { promotionEmail } : {}) });
    } catch (error) {
      let code = safe.has(error) ? error.code : 'UNAVAILABLE';
      if (error instanceof CloudContentError && error.code === 'AUTH_REQUIRED' && error.status === 401) code = 'AUTH_REQUIRED';
      const [status, message] = specs[code];
      return json({ error: { code, message } }, status, allow ? { allow } : {});
    }
  };
}
