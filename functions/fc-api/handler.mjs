/** FC startup preflight only. No storage, registration service, authentication or private data. */
const NOT_READY = { status: 'not_ready', registration: 'closed', storage: 'not_verified' };
const ERRORS = {
  NOT_FOUND: '接口不存在。',
  METHOD_NOT_ALLOWED: '此接口只接受 GET 或 HEAD。',
  INTERNAL_ERROR: '请求未完成。',
};

function json(value, status, head, extra = {}) {
  const body = JSON.stringify(value);
  return new Response(head ? null : body, { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-length': String(new TextEncoder().encode(body).byteLength), ...extra,
  } });
}

/** @param {Pick<Request, 'method'|'url'>} request */
export function handleFcRequest(request, { sourceCommit = null } = {}) {
  let head = false;
  try {
    head = request.method === 'HEAD';
    const path = new URL(request.url).pathname;
    if (path === '/api/registrations' || path.startsWith('/api/registrations/')
      || path === '/admin' || path.startsWith('/admin/') || path === '/api/admin' || path.startsWith('/api/admin/')) return json(NOT_READY, 503, head);
    if (path !== '/healthz' && path !== '/api/health') return json({ error: { code: 'NOT_FOUND', message: ERRORS.NOT_FOUND } }, 404, head);
    if (request.method !== 'GET' && !head) return json({ error: { code: 'METHOD_NOT_ALLOWED', message: ERRORS.METHOD_NOT_ALLOWED } }, 405, false, { allow: 'GET, HEAD' });
    const commit = typeof sourceCommit === 'string' && /^[a-f0-9]{40}$/u.test(sourceCommit) ? sourceCommit : null;
    return path === '/healthz' ? json({ status: 'ok', scope: 'process-only', sourceCommit: commit }, 200, head) : json(NOT_READY, 503, head);
  } catch { return json({ error: { code: 'INTERNAL_ERROR', message: ERRORS.INTERNAL_ERROR } }, 500, head); }
}
