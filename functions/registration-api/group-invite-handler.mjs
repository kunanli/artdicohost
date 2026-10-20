import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { GroupInviteError } from './group-invite.mjs';
import { plainObject } from './policy.mjs';

const SECURITY = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const MAX_BODY = 720 * 1024;
const validOrigin = value => { try { return typeof value === 'string' && new URL(value).protocol === 'https:' && new URL(value).origin === value; } catch { return false; } };
class RequestFailure extends Error { constructor(code, status, message) { super(message); this.code = code; this.status = status; } }
const rejected = (code = 'GROUP_INVITE_UNAVAILABLE', status = 503, message = '入群码操作未确认完成，请重新载入后核对。') => new RequestFailure(code, status, message);
const notFound = () => rejected('GROUP_INVITE_NOT_FOUND', 404, '入群码链接已失效。');

async function body(request) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(request.headers.get('content-type') ?? '')
    || ![null, 'identity'].includes(request.headers.get('content-encoding'))) throw rejected('UNSUPPORTED_MEDIA_TYPE', 415, '请发送 UTF-8 JSON 请求。');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)))) throw rejected('INVALID_JSON', 400, '请求格式无效。');
  if (declared !== null && Number(declared) > MAX_BODY) throw rejected('BODY_TOO_LARGE', 413, '图片请求过大。');
  const reader = request.body?.getReader();
  if (!reader) throw rejected('INVALID_JSON', 400, '请求格式无效。');
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, request.signal]);
  let rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const onAbort = () => { reader.cancel().catch(() => {}); rejectAbort(rejected('REQUEST_TIMEOUT', 408, '请求读取未完成。')); };
  const timer = setTimeout(() => controller.abort(), 10000); timer.unref();
  signal.addEventListener('abort', onAbort, { once: true });
  let length = 0; const chunks = [];
  try {
    if (signal.aborted) throw rejected('INVALID_JSON', 400, '请求格式无效。');
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || (length += next.value.byteLength) > MAX_BODY) throw rejected('BODY_TOO_LARGE', 413, '图片请求过大。');
      chunks.push(Buffer.from(next.value));
    }
    if (declared !== null && Number(declared) !== length) throw rejected('INVALID_JSON', 400, '请求格式无效。');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length)));
    if (!plainObject(value)) throw rejected('INVALID_JSON', 400, '请求格式无效。');
    return value;
  } catch (error) { throw error instanceof RequestFailure ? error : rejected('INVALID_JSON', 400, '请求格式无效。'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Dedicated protected configuration and signed-image boundary; never exposes an unsigned current QR. */
export function createGroupInviteApi({ service, auth, apiOrigin = 'https://api.artdico.host', publicOrigins = ['https://artdico.host'] } = {}) {
  if (!validOrigin(apiOrigin) || !Array.isArray(publicOrigins) || !publicOrigins.every(validOrigin)) throw new TypeError('Group invite origins are unavailable.');
  const origins = new Set(publicOrigins);
  return async function handle(request) {
    let cors = {}, head = request.method === 'HEAD';
    const json = (value, status = 200, extra = {}) => new Response(head ? null : JSON.stringify(value), { status, headers: { ...SECURITY, ...cors, 'content-type': 'application/json; charset=utf-8', ...extra } });
    const image = value => new Response(head ? null : value.data, { headers: { ...SECURITY, ...cors, 'content-type': value.contentType, 'content-length': String(value.bytes), 'cross-origin-resource-policy': 'same-site' } });
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== apiOrigin || url.username || url.password || url.search || url.hash) throw notFound();
      const prefix = ['/api/registration/group-invite/', '/api/admin/registration/group-invite/'].find(value => url.pathname.startsWith(value));
      if (prefix) {
        if (origin !== null && !origins.has(origin) && origin !== apiOrigin) throw rejected('ORIGIN_REJECTED', 403, '请求来源不被允许。');
        if (origins.has(origin)) cors = { 'access-control-allow-origin': origin, vary: 'Origin' };
        if (!['GET', 'HEAD'].includes(request.method)) throw rejected('METHOD_NOT_ALLOWED', 405, '图片接口只接受 GET 或 HEAD。');
        const token = url.pathname.slice(prefix.length);
        if (!token || !service || typeof service.publicImage !== 'function') throw notFound();
        return image(await service.publicImage(token));
      }
      const root = url.pathname === '/api/admin/group-invite', preview = url.pathname === '/api/admin/group-invite/image';
      if (!root && !preview) throw notFound();
      if (origin !== null && origin !== apiOrigin) throw rejected('ORIGIN_REJECTED', 403, '请求来源不被允许。');
      if (preview && !['GET', 'HEAD'].includes(request.method) || root && !['GET', 'PUT', 'POST'].includes(request.method)) throw rejected('METHOD_NOT_ALLOWED', 405, '接口方法不被允许。');
      if (!service || !auth || typeof auth.authenticate !== 'function') throw rejected();
      const session = await auth.authenticate(request);
      if (!Array.isArray(session?.user?.roles) || !session.user.roles.includes('superadmin')) throw rejected('FORBIDDEN', 403, '仅管理员可管理入群码。');
      if (['PUT', 'POST'].includes(request.method)) {
        if (origin !== apiOrigin || !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) throw rejected('CSRF_REJECTED', 403, '安全校验未通过，请重新载入后台。');
        const input = await body(request);
        if (request.signal.aborted) throw rejected();
        const value = request.method === 'POST' ? await service.replace(input, session.user) : await service.disable(input, session.user);
        if (request.signal.aborted) throw rejected();
        return json(value);
      }
      return preview ? image(await service.adminImage()) : json(await service.adminRead());
    } catch (error) {
      if (error instanceof RequestFailure || error instanceof GroupInviteError) return json({ error: { code: error.code, message: error.message } }, error.status);
      // Only the fixed authentication failure shape may leave a trusted auth dependency.
      if (error instanceof CloudContentError && ['AUTH_REQUIRED', 'FORBIDDEN'].includes(error.code)) return json({ error: { code: error.code, message: error.code === 'AUTH_REQUIRED' ? '请先登录后台。' : '当前账号没有权限。' } }, error.code === 'AUTH_REQUIRED' ? 401 : 403);
      return json({ error: { code: 'GROUP_INVITE_UNAVAILABLE', message: '入群码暂不可用，请稍后重试。' } }, 503);
    }
  };
}
