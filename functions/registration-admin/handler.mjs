import { equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from '../cloud-content/errors.mjs';
import { RegistrationAdminError, isRegistrationAdminError } from './errors.mjs';
import { registrationFilters } from './store.mjs';

const ORIGIN = 'https://api.artdico.host';
const MAX_BODY = 32 * 1024;
const SECURITY = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
const writes = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const failure = code => { throw new RegistrationAdminError(code); };
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { ...SECURITY, 'content-type': 'application/json; charset=utf-8' } }); }
function keys(value, allowed, required) { if (!plain(value) || Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) failure('INVALID_REQUEST'); }
async function body(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/iu.test(request.headers.get('content-type') ?? '') || ![null, 'identity'].includes(request.headers.get('content-encoding'))) failure('UNSUPPORTED_MEDIA_TYPE');
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length)))) failure('INVALID_REQUEST');
  if (Number(length) > MAX_BODY) failure('BODY_TOO_LARGE');
  const reader = request.body?.getReader(), chunks = [];
  let bytes = 0, timer, onAbort;
  const timeout = new AbortController();
  const signal = AbortSignal.any([request.signal, timeout.signal]);
  const aborted = new Promise((_, reject) => { onAbort = () => { reader?.cancel().catch(() => {}); reject(new RegistrationAdminError('INVALID_REQUEST')); }; signal.addEventListener('abort', onAbort, { once: true }); });
  timer = setTimeout(() => timeout.abort(), 10_000); timer.unref();
  try {
    if (signal.aborted) failure('INVALID_REQUEST');
    if (reader) while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > MAX_BODY) failure('BODY_TOO_LARGE');
      chunks.push(result.value);
    }
    if (length !== null && Number(length) !== bytes) failure('INVALID_REQUEST');
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!plain(value)) failure('INVALID_REQUEST');
    return value;
  } catch (error) { if (isRegistrationAdminError(error)) throw error; failure('INVALID_REQUEST'); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } }
}

/** Route only /api/admin/registrations to this boundary; share the production auth instance. */
export function createRegistrationAdminApi({ enabled = false, auth, store, canExport = user => user.roles.includes('superadmin'), onWithdrawalCommitted } = {}) {
  if (typeof enabled !== 'boolean' || typeof canExport !== 'function' || onWithdrawalCommitted !== undefined && typeof onWithdrawalCommitted !== 'function') throw new TypeError('报名审核配置无效。');
  if (enabled && (typeof auth?.authenticate !== 'function' || !['list', 'detail', 'saveReview', 'exportCsv', 'requestDeletion'].every(name => typeof store?.[name] === 'function'))) throw new TypeError('报名审核依赖未配置。');
  async function afterCommit(result, registrationId, actor) {
    if (!onWithdrawalCommitted || result.review?.status !== 'withdrawn' && result.review?.deletionRequested == null) return result;
    // A review failure never reaches here. Capacity is a separate confirmed CAS;
    // an uncertain release keeps the review saved and reports pending honestly.
    let admissionRelease = { status: 'pending' };
    if (Number.isSafeInteger(result.revision) && result.revision > 0) {
      try {
        const release = await onWithdrawalCommitted({ registrationId, reviewRevision: result.revision, actor });
        if (release?.status === 'released' && Number.isSafeInteger(release.promotedCount) && release.promotedCount >= 0 && release.promotedCount <= 1000) {
          admissionRelease = { status: 'released', promotedCount: release.promotedCount };
          const email = release.promotionEmail;
          if (['not_configured', 'pending', 'completed'].includes(email?.status)
            && Number.isSafeInteger(email.attemptedCount) && email.attemptedCount >= 0 && email.attemptedCount <= release.promotedCount
            && email.pendingCount === release.promotedCount - email.attemptedCount) admissionRelease.promotionEmail = { status: email.status, attemptedCount: email.attemptedCount, pendingCount: email.pendingCount };
        }
      } catch { /* The saved review remains authoritative; do not retry writes. */ }
    }
    return { ...result, admissionRelease };
  }
  return async function handle(request) {
    try {
      const url = new URL(request.url);
      if (url.origin !== ORIGIN || url.username || url.password || url.hash) failure('ORIGIN_REJECTED');
      if (!enabled) failure('REVIEW_NOT_READY');
      const origin = request.headers.get('origin');
      if (origin !== null && origin !== ORIGIN || writes.has(request.method) && origin !== ORIGIN) failure('ORIGIN_REJECTED');
      const session = await auth.authenticate(request);
      if (!session?.user?.roles?.some(role => ['reviewer', 'superadmin'].includes(role))) failure('FORBIDDEN');
      if (writes.has(request.method) && !equalToken(request.headers.get('x-csrf-token'), session.csrfToken)) failure('CSRF_REJECTED');
      if (url.pathname === '/api/admin/registrations' && request.method === 'GET') {
        const allowed = ['query', 'category', 'status', 'accommodation', 'city', 'attendance', 'cursor', 'limit'];
        for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) failure('INVALID_REQUEST');
        const filters = Object.fromEntries([...url.searchParams].filter(([key]) => !['cursor', 'limit'].includes(key)));
        const limit = url.searchParams.get('limit');
        if (limit !== null && !/^[1-9]\d{0,2}$/u.test(limit)) failure('INVALID_REQUEST');
        return json(await store.list({ filters: registrationFilters(filters), cursor: url.searchParams.get('cursor') ?? '', limit: limit === null ? 25 : Number(limit) }));
      }
      if (url.search) failure('INVALID_REQUEST');
      if (url.pathname === '/api/admin/registrations/export' && request.method === 'POST') {
        if (!await canExport(session.user)) failure('FORBIDDEN');
        const input = await body(request);
        keys(input, ['expectedRevision', 'filters', 'includeContact'], ['expectedRevision']);
        const includeContact = input.includeContact ?? false;
        if (typeof includeContact !== 'boolean') failure('INVALID_REQUEST');
        if (includeContact && !session.user.roles.includes('superadmin')) failure('FORBIDDEN');
        const result = await store.exportCsv(input.expectedRevision, input.filters ?? {}, session.user.id, { includeContact });
        return new Response(result.csv, { headers: { ...SECURITY, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="artdico-registration-review.csv"', 'x-review-revision': String(result.revision) } });
      }
      const route = url.pathname.match(/^\/api\/admin\/registrations\/([A-Za-z0-9_-]{43})(?:\/(review|deletion-request))?$/u);
      if (!route) failure('NOT_FOUND');
      const [, id, action] = route;
      if (!action && request.method === 'GET') return json(await store.detail(id));
      if (action === 'review' && request.method === 'PATCH') {
        const input = await body(request); keys(input, ['expectedRevision', 'review'], ['expectedRevision', 'review']);
        return json(await afterCommit(await store.saveReview(id, input.expectedRevision, input.review, session.user.id), id, session.user));
      }
      if (action === 'deletion-request' && request.method === 'POST') {
        if (!session.user.roles.includes('superadmin')) failure('FORBIDDEN');
        const input = await body(request); keys(input, ['expectedRevision', 'reason'], ['expectedRevision', 'reason']);
        return json(await afterCommit(await store.requestDeletion(id, input.expectedRevision, input.reason, session.user.id), id, session.user));
      }
      failure('NOT_FOUND');
    } catch (error) {
      if (error instanceof CloudContentError && error.code === 'AUTH_REQUIRED' && error.status === 401) error = new RegistrationAdminError('AUTH_REQUIRED');
      const safe = isRegistrationAdminError(error) ? error : new RegistrationAdminError();
      return json({ error: { code: safe.code, message: safe.message } }, safe.status);
    }
  };
}
