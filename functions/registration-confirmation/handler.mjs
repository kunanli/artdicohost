import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { plainObject } from '../registration-api/policy.mjs';
import { ConfirmationError } from './service.mjs';
import { canManageEventOperations } from '../../shared/staff-permissions.mjs';

const SECURITY = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const MAX_BODY = 16 * 1024;
const PUBLIC_PATHS = ['/api/registration/confirmation', '/api/admin/registration/confirmation'];
const SETTINGS = '/api/admin/registration-confirmation/settings';
const DISPATCH = '/api/admin/registration-confirmation/dispatch';
const reject = (code = 'INVALID_REQUEST', status = 400) => { throw new ConfirmationError(code, status); };
const originValid = value => { try { return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).origin === value; } catch { return false; } };
function keys(value, allowed, required) {
  if (!plainObject(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) reject();
}
async function body(request) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(request.headers.get('content-type') ?? '')
    || ![null, 'identity'].includes(request.headers.get('content-encoding'))) reject('UNSUPPORTED_MEDIA_TYPE', 415);
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) reject();
  if (declared !== null && Number(declared) > MAX_BODY) reject('BODY_TOO_LARGE', 413);
  const reader = request.body?.getReader(); if (!reader) reject();
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, request.signal]);
  let rejectAbort;
  const aborted = new Promise((_, rejectPromise) => { rejectAbort = rejectPromise; });
  const onAbort = () => { reader.cancel().catch(() => {}); rejectAbort(new ConfirmationError('REQUEST_TIMEOUT', 408)); };
  const timer = setTimeout(() => controller.abort(), 10_000); timer.unref();
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks = []; let length = 0;
  try {
    if (signal.aborted) reject();
    while (true) {
      const next = await Promise.race([reader.read(), aborted]); if (next.done) break;
      if (!(next.value instanceof Uint8Array) || (length += next.value.byteLength) > MAX_BODY) reject('BODY_TOO_LARGE', 413);
      chunks.push(Buffer.from(next.value));
    }
    if (declared !== null && Number(declared) !== length) reject();
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    if (!plainObject(value)) reject();
    return value;
  } catch (error) { if (error instanceof ConfirmationError) throw error; reject(); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Receipt reads never authenticate a staff session or send a message. */
export function createRegistrationConfirmationApi({ service, auth, apiOrigin = 'https://api.artdico.host', publicOrigins = ['https://artdico.host'] } = {}) {
  if (!originValid(apiOrigin) || !Array.isArray(publicOrigins) || !publicOrigins.length || !publicOrigins.every(originValid)) throw new TypeError('Explicit confirmation origins required.');
  const origins = new Set(publicOrigins);
  return async request => {
    let cors = {};
    const json = (value, status = 200, extra = {}) => new Response(JSON.stringify(value), { status,
      headers: { ...SECURITY, ...cors, 'content-type': 'application/json; charset=utf-8', ...extra } });
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== apiOrigin || url.username || url.password || url.search || url.hash) reject('NOT_FOUND', 404);
      if (PUBLIC_PATHS.includes(url.pathname)) {
        if (!origins.has(origin)) reject('ORIGIN_REJECTED', 403);
        cors = { 'access-control-allow-origin': origin, vary: 'Origin' };
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...SECURITY, ...cors,
          'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '600' } });
        if (request.method !== 'POST') reject('METHOD_NOT_ALLOWED', 405);
        if (typeof service?.confirmation !== 'function') reject('CONFIRMATION_UNAVAILABLE', 503);
        const input = await body(request); keys(input, ['receiptToken'], ['receiptToken']);
        if (typeof input.receiptToken !== 'string' || input.receiptToken.length > 4096) reject();
        if (request.signal.aborted) reject();
        return json(await service.confirmation(input));
      }
      if (![SETTINGS, DISPATCH].includes(url.pathname)) reject('NOT_FOUND', 404);
      cors = { vary: 'Cookie, Origin' };
      if (origin !== null && origin !== apiOrigin) reject('ORIGIN_REJECTED', 403);
      if (url.pathname === SETTINGS && !['GET', 'PUT'].includes(request.method) || url.pathname === DISPATCH && request.method !== 'POST') reject('METHOD_NOT_ALLOWED', 405);
      if (typeof auth?.authenticate !== 'function' || !service) reject('CONFIRMATION_UNAVAILABLE', 503);
      const session = await auth.authenticate(request);
      if (!session?.user) reject('AUTH_REQUIRED', 401);
      if (!canManageEventOperations(session.user)) reject('FORBIDDEN', 403);
      if (request.method === 'GET') return json(await service.settings({ actor: session.user }));
      if (origin !== apiOrigin || !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) reject('CSRF_REJECTED', 403);
      const input = await body(request);
      if (request.signal.aborted) reject();
      if (url.pathname === SETTINGS) {
        keys(input, ['expectedRevision', 'operationId', 'enabled'], ['expectedRevision', 'operationId', 'enabled']);
        return json(await service.setSettings({ ...input, actor: session.user }));
      }
      keys(input, ['expectedRevision', 'operationId', 'registrationIds', 'retryRejected'], ['expectedRevision', 'operationId', 'registrationIds']);
      return json(await service.dispatch({ ...input, actor: session.user }));
    } catch (error) {
      if (error instanceof CloudContentError && ['AUTH_REQUIRED', 'FORBIDDEN'].includes(error.code)) return json({ error: {
        code: error.code, message: error.code === 'AUTH_REQUIRED' ? '请先登录后台。' : '当前账号没有权限。' } }, error.code === 'AUTH_REQUIRED' ? 401 : 403);
      const safe = error instanceof ConfirmationError ? error : new ConfirmationError();
      const messages = { CONFIRMATION_NOT_FOUND: '确认链接无效或已到期，请联系工作人员核对。', AUTH_REQUIRED: '请先登录后台。',
        FORBIDDEN: '当前账号没有管理确认通知的权限。', ORIGIN_REJECTED: '请求来源不被允许。', CSRF_REJECTED: '安全校验未通过，请重新读取后台。',
        INVALID_REQUEST: '请求格式无效。', UNSUPPORTED_MEDIA_TYPE: '请发送 UTF-8 JSON。', BODY_TOO_LARGE: '请求超过长度限制。',
        REQUEST_TIMEOUT: '请求读取未完成。', REVISION_CONFLICT: '通知记录已变化，请重新读取后核对。', METHOD_NOT_ALLOWED: '此接口不支持该方法。', NOT_FOUND: '接口不存在。' };
      return json({ error: { code: safe.code, message: messages[safe.code] ?? '确认资料暂时无法核对，请稍后重试。' } }, safe.status);
    }
  };
}
