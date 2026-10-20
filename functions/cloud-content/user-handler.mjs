import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from './errors.mjs';

const ORIGIN = 'https://api.artdico.host';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers });
const reject = (code, status) => { throw new CloudContentError(code, '账号管理请求未完成。', status); };

export function createCloudUserApi({ auth, store, enabled = false } = {}) {
  return async request => {
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.pathname !== '/api/admin/users' || url.search || url.hash) reject('NOT_FOUND', 404);
      if (!enabled || !auth || !store) reject('USERS_NOT_READY', 503);
      if (!['GET', 'POST'].includes(request.method)) reject('METHOD_NOT_ALLOWED', 405);
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== ORIGIN || request.method === 'POST' && origin !== ORIGIN) reject('ORIGIN_REJECTED', 403);
      const session = await auth.authenticate(request);
      if (!session.user.roles.includes('superadmin')) reject('FORBIDDEN', 403);
      if (request.method === 'GET') return json(await store.list());
      if (!equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) reject('CSRF_REJECTED', 403);
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) reject('INVALID_REQUEST', 415);
      const length = request.headers.get('content-length');
      if (length !== null && (!/^\d+$/u.test(length) || Number(length) > 16 * 1024)) reject('BODY_TOO_LARGE', 413);
      const reader = request.body?.getReader();
      const parts = []; let bytes = 0;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
      let onAbort;
      const aborted = new Promise((_, rejectRead) => { onAbort = () => rejectRead(new Error()); signal.addEventListener('abort', onAbort, { once: true }); });
      try {
        if (!reader || signal.aborted) reject('INVALID_REQUEST', 422);
        while (true) {
          const part = await Promise.race([reader.read(), aborted]);
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 16 * 1024) reject('BODY_TOO_LARGE', 413);
          parts.push(part.value);
        }
        if (length !== null && Number(length) !== bytes) reject('INVALID_REQUEST', 422);
        let input;
        try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); } catch { reject('INVALID_REQUEST', 422); }
        return json(await store.save(input, session.user.id));
      } finally { signal.removeEventListener('abort', onAbort); reader?.cancel().catch(() => {}); reader?.releaseLock(); }
    } catch (error) {
      const known = error instanceof CloudContentError;
      return json({ error: { code: known ? error.code : 'USERS_UNAVAILABLE', message: known ? error.message : '账号管理暂不可用。' } }, known ? error.status : 503);
    }
  };
}
