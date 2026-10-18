import { randomBytes } from 'node:crypto';
import { parseAdminUsers, publicUser, verifyPassword, equalToken } from './auth.mjs';
import { ContentError } from './store.mjs';

export const MAX_BODY_BYTES = 1024 * 1024;
export const SESSION_COOKIE = 'artdico_local_session';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
}

function cookie(value, seconds) {
  return `${SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${seconds}`;
}

async function body(request) {
  if (!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type') ?? '')) throw new ContentError('UNSUPPORTED_MEDIA_TYPE', '请发送 JSON 请求。', 415);
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new ContentError('BODY_TOO_LARGE', '请求内容过大。', 413);
  const reader = request.body?.getReader();
  let length = 0;
  const parts = [];
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new ContentError('BODY_TOO_LARGE', '请求内容过大。', 413); }
      parts.push(Buffer.from(value));
    }
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ContentError('INVALID_JSON', '请求格式无效。'); }
}

/** Pure Request -> Response boundary. Sessions/rate limits are local to this process. */
export function createContentApi({ store, users, allowedOrigin, mode = 'local', now = () => Date.now(), sessionTtlMs = 8 * 60 * 60 * 1000, loginLimit = 10, loginWindowMs = 15 * 60 * 1000 }) {
  if (mode !== 'local') throw new TypeError('本内容 API 只支持本地模式，尚未接入生产鉴权或 OSS。');
  const origin = new URL(allowedOrigin);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.origin !== allowedOrigin) throw new TypeError('本地 API Origin 必须是 http://127.0.0.1:端口。');
  const accounts = parseAdminUsers(users);
  const sessions = new Map();
  const attempts = new Map();

  function authenticate(request) {
    const values = (request.headers.get('cookie') ?? '').split(';').map((value) => value.trim());
    const tokens = values.filter((value) => value.startsWith(`${SESSION_COOKIE}=`));
    if (tokens.length !== 1) throw new ContentError('AUTH_REQUIRED', '请先登录本地工作后台。', 401);
    const token = tokens[0].slice(SESSION_COOKIE.length + 1);
    const session = sessions.get(token);
    if (!session || session.expiresAt <= now()) {
      sessions.delete(token);
      throw new ContentError('AUTH_REQUIRED', '会话已结束，请重新登录。', 401);
    }
    return { ...session, token };
  }

  function permit(session, role) {
    if (!session.user.roles.includes(role)) throw new ContentError('FORBIDDEN', '当前账号没有此操作权限。', 403);
  }

  return async function handle(request, { clientAddress = '127.0.0.1' } = {}) {
    try {
      const url = new URL(request.url);
      if (url.origin !== allowedOrigin) throw new ContentError('ORIGIN_REJECTED', '请求来源不被允许。', 403);
      const givenOrigin = request.headers.get('origin');
      if ((givenOrigin !== null && givenOrigin !== allowedOrigin) || (WRITE_METHODS.has(request.method) && givenOrigin !== allowedOrigin)) throw new ContentError('ORIGIN_REJECTED', '请求来源不被允许。', 403);
      if (url.pathname === '/api/public/content' && request.method === 'GET') {
        const { published } = await store.read();
        return published ? json(published) : json({ error: { code: 'NOT_PUBLISHED', message: '尚未发布本地内容。' } }, 404);
      }
      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        for (const [key, value] of attempts) if (value.until <= now()) attempts.delete(key);
        for (const [key, value] of sessions) if (value.expiresAt <= now()) sessions.delete(key);
        const address = String(clientAddress).slice(0, 100);
        const budget = attempts.get(address) ?? { count: 0, until: now() + loginWindowMs };
        if (budget.count >= loginLimit || attempts.size >= 1000 && !attempts.has(address)) return json({ error: { code: 'LOGIN_RATE_LIMITED', message: '登录尝试过于频繁，请稍后重试。' } }, 429, { 'retry-after': String(Math.max(1, Math.ceil((budget.until - now()) / 1000))) });
        budget.count += 1;
        attempts.set(address, budget);
        const input = await body(request);
        const account = accounts.find((user) => user.username === input.username);
        const verified = await verifyPassword(input.password, (account ?? accounts[0]).passwordHash);
        if (!account || !verified) throw new ContentError('AUTH_FAILED', '账号或密码不正确。', 401);
        if (sessions.size >= 1000) throw new ContentError('SESSION_LIMIT', '本地会话暂不可用，请稍后重试。', 503);
        const token = randomBytes(32).toString('base64url');
        const csrfToken = randomBytes(32).toString('base64url');
        const user = publicUser(account);
        sessions.set(token, { user, csrfToken, expiresAt: now() + sessionTtlMs });
        return json({ user, csrfToken }, 200, { 'set-cookie': cookie(token, Math.floor(sessionTtlMs / 1000)) });
      }
      if (!url.pathname.startsWith('/api/admin/')) throw new ContentError('NOT_FOUND', '接口不存在。', 404);
      const session = authenticate(request);
      if (WRITE_METHODS.has(request.method) && !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) throw new ContentError('CSRF_REJECTED', '安全校验未通过，请重新载入后台。', 403);
      if (url.pathname === '/api/admin/session' && request.method === 'GET') return json({ user: session.user, csrfToken: session.csrfToken });
      if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
        sessions.delete(session.token);
        return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
      }
      if (url.pathname === '/api/admin/content' && request.method === 'GET') return json(await store.read());
      if (url.pathname === '/api/admin/content' && request.method === 'PUT') {
        permit(session, 'editor');
        const input = await body(request);
        return json({ draft: await store.save(input.expectedRevision, input.content, session.user.id) });
      }
      if (url.pathname === '/api/admin/content/publish' && request.method === 'POST') {
        permit(session, 'publisher');
        const input = await body(request);
        return json({ published: await store.publish(input.expectedRevision, session.user.id) });
      }
      throw new ContentError('NOT_FOUND', '接口或方法不存在。', 404);
    } catch (error) {
      if (error instanceof ContentError) return json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, error.status);
      return json({ error: { code: 'INTERNAL_ERROR', message: '本地操作未完成，请重新载入或联系维护人员。' } }, 500);
    }
  };
}
