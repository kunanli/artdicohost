import { equalToken } from '../content-api/auth.mjs';
import { canCheckIn, EntryTicketError } from './service.mjs';

const API = 'https://api.artdico.host', SITE = 'https://artdico.host';
const PUBLIC = /^\/api\/admin\/registration\/entry-links\/([A-Za-z0-9_-]{22})(?:\/(entry|group)\.png)?$/u;
const STAFF = /^\/api\/admin\/checkin\/([A-Za-z0-9_-]{22})(?:\/operation\/([A-Za-z0-9_-]{43}))?$/u;
const SECURITY = { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', vary: 'Origin' };
const ERRORS = { AUTH_REQUIRED: [401, '请登录后核对入场券。'], FORBIDDEN: [403, '当前账号没有签到权限。'], INVALID_REQUEST: [400, '请求格式无效。'],
  ENTRY_NOT_FOUND: [404, '入场券已失效，请联系主办方。'], ENTRY_CONFLICT: [409, '状态已更新，请重新核对。'], ENTRY_UNAVAILABLE: [503, '结果暂未确认，请核对原操作。'],
  METHOD_NOT_ALLOWED: [405, '请求方法不支持。'], ORIGIN_REJECTED: [403, '请求来源不被允许。'], CSRF_REJECTED: [403, '请重新登录后操作。'] };
const error = code => { const value = new Error(); value.entryCode = code; throw value; };
export const isEntryTicketPath = path => typeof path === 'string' && (path.startsWith('/api/admin/registration/entry-links/') || path.startsWith('/api/admin/checkin/'));
async function body(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) error('INVALID_REQUEST');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(?:0|[1-9]\d*)$/u.test(length) || Number(length) > 2048)) error('INVALID_REQUEST');
  const reader = request.body?.getReader(); if (!reader) error('INVALID_REQUEST');
  let timer, bytes = 0;
  const chunks = [], timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error()), 5000); }); timeout.catch(() => {});
  try {
    for (;;) { const part = await Promise.race([reader.read(), timeout]); if (part.done) break; bytes += part.value.byteLength; if (bytes > 2048) error('INVALID_REQUEST'); chunks.push(part.value); }
    if (length !== null && Number(length) !== bytes) error('INVALID_REQUEST');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'expectedRevision,operationId') error('INVALID_REQUEST');
    return value;
  } catch { error('INVALID_REQUEST'); }
  finally { clearTimeout(timer); try { reader.cancel().catch(() => {}); reader.releaseLock(); } catch {} }
}
export function createEntryTicketApi({ service, authenticate } = {}) {
  if (typeof authenticate !== 'function' || !['resolve', 'entryImage', 'groupImage', 'inspect', 'checkIn', 'operation'].every(name => typeof service?.[name] === 'function')) throw new TypeError('Trusted entry API dependencies required.');
  return async request => {
    let cors = {};
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...SECURITY, ...cors, 'content-type': 'application/json; charset=utf-8' } });
    try {
      const url = new URL(request.url), origin = request.headers.get('origin');
      if (url.origin !== API || url.username || url.password || url.search || url.hash) error('ENTRY_NOT_FOUND');
      const publicMatch = PUBLIC.exec(url.pathname), staffMatch = STAFF.exec(url.pathname);
      if (!publicMatch && !staffMatch) error('ENTRY_NOT_FOUND');
      if (publicMatch) {
        if (origin !== null && origin !== SITE) error('ORIGIN_REJECTED');
        if (origin === SITE) cors = { 'access-control-allow-origin': SITE };
        if (request.method === 'OPTIONS') {
          if (origin !== SITE || !['GET', 'HEAD', null].includes(request.headers.get('access-control-request-method')) || request.headers.get('access-control-request-headers')) error('ORIGIN_REJECTED');
          return new Response(null, { status: 204, headers: { ...SECURITY, ...cors, 'access-control-allow-methods': 'GET, HEAD, OPTIONS', 'access-control-max-age': '0' } });
        }
        if (!['GET', 'HEAD'].includes(request.method)) error('METHOD_NOT_ALLOWED');
        const [, code, image] = publicMatch;
        if (!image) {
          const result = await service.resolve({ code }), response = json(result);
          return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
        }
        const result = await service[image === 'entry' ? 'entryImage' : 'groupImage']({ code });
        if (!(result?.data instanceof Uint8Array) || !result.data.length || result.data.length > 2 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(result.contentType)) error('ENTRY_UNAVAILABLE');
        return new Response(request.method === 'HEAD' ? null : result.data, { status: 200, headers: { ...SECURITY, ...cors, 'content-type': result.contentType, 'content-length': String(result.data.length) } });
      }
      if (!['GET', 'POST'].includes(request.method) || staffMatch[2] && request.method !== 'GET') error('METHOD_NOT_ALLOWED');
      if (origin !== null && origin !== API || request.method === 'POST' && origin !== API) error('ORIGIN_REJECTED');
      const session = await authenticate(request);
      if (!session?.user) error('AUTH_REQUIRED');
      if (!canCheckIn(session.user)) error('FORBIDDEN');
      const [, code, operationId] = staffMatch;
      if (operationId) return json(await service.operation({ code, operationId, actor: session.user }));
      if (request.method === 'GET') return json(await service.inspect({ code, actor: session.user }));
      if (!equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) error('CSRF_REJECTED');
      return json(await service.checkIn({ ...await body(request), code, actor: session.user }));
    } catch (cause) {
      const code = cause instanceof EntryTicketError ? cause.code : Object.hasOwn(ERRORS, cause?.entryCode ?? '') ? cause.entryCode
        : cause?.code === 'AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'ENTRY_UNAVAILABLE';
      const [status, message] = ERRORS[code]; return json({ error: { code, message } }, status);
    }
  };
}
