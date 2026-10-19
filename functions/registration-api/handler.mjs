import { MAX_REGISTRATION_BYTES } from './validation.mjs';
import { own, plainObject, parseTimestamp, clockTime } from './policy.mjs';

const HEADER_NAMES = ['content-type', 'idempotency-key', 'x-registration-token'];
const KEY_PATTERN = /^[A-Za-z0-9_-]{32,128}$/u;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{32,}$/u;
const ERRORS = {
  UNAVAILABLE: [503, '报名服务暂不可用，请稍后重试。'],
  NOT_FOUND: [404, '接口不存在。'], METHOD_NOT_ALLOWED: [405, '此接口只接受 POST。'],
  ORIGIN_REJECTED: [403, '请求来源不被允许。'], PREFLIGHT_REJECTED: [403, '预检请求不被允许。'],
  UNSUPPORTED_MEDIA_TYPE: [415, '请发送 UTF-8 JSON 请求。'], INVALID_HEADERS: [400, '提交请求头格式无效。'],
  BODY_TOO_LARGE: [413, '请求内容过大。'], INVALID_JSON: [400, '请求正文格式无效。'],
  INVALID_SUBMISSION: [422, '报名资料未通过校验。'], CONFLICT: [409, '提交内容冲突，请核对后重试。'],
  CLOSED: [409, '当前未开放新报名。'], RATE_LIMITED: [429, '请求过于频繁，请稍后重试。'],
  FORBIDDEN: [403, '提交验证未通过。'], WITHDRAWN: [410, '此报名已撤回或删除。'],
};
const OUTCOMES = { invalid: 'INVALID_SUBMISSION', conflict: 'CONFLICT', closed: 'CLOSED', rate_limited: 'RATE_LIMITED', forbidden: 'FORBIDDEN', withdrawn: 'WITHDRAWN', unavailable: 'UNAVAILABLE' };

class HttpError extends Error { constructor(code) { super(code); this.code = code; } }

async function readPayload(request) {
  const declared = request.headers.get('content-length');
  if (declared !== null && !/^(0|[1-9]\d*)$/u.test(declared)) throw new HttpError('INVALID_HEADERS');
  if (declared !== null && Number(declared) > MAX_REGISTRATION_BYTES) throw new HttpError('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('INVALID_JSON');
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new HttpError('INVALID_JSON');
      length += value.byteLength;
      if (length > MAX_REGISTRATION_BYTES) {
        await reader.cancel().catch(() => {});
        throw new HttpError('BODY_TOO_LARGE');
      }
      chunks.push(new Uint8Array(value));
    }
  } catch (error) { throw error instanceof HttpError ? error : new HttpError('INVALID_JSON'); }
  finally { reader.releaseLock(); }
  if (declared !== null && Number(declared) !== length) throw new HttpError('INVALID_HEADERS');
  const bytes = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!plainObject(payload)) throw new Error();
    return payload;
  } catch { throw new HttpError('INVALID_JSON'); }
}

function originSet(values) {
  if (!Array.isArray(values) || !values.length) return null;
  try {
    return values.every(value => typeof value === 'string' && !value.includes('*') && new URL(value).protocol === 'https:' && new URL(value).origin === value) ? new Set(values) : null;
  } catch { return null; }
}

/** A receipt is the trusted service's commitment contract, not independent proof of an OSS write. */
function committedReceipt(result, payload) {
  const receipt = own(result, 'receipt');
  const eventId = own(receipt, 'eventId');
  const referenceCode = own(receipt, 'referenceCode');
  return own(receipt, 'committed') === true && typeof eventId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)
    && eventId === own(payload, 'eventId') && typeof referenceCode === 'string' && KEY_PATTERN.test(referenceCode)
    && parseTimestamp(own(receipt, 'committedAt')) !== null ? { referenceCode } : null;
}

/** Optional post-commit information; an unavailable invite never reverses a saved registration. */
function groupInvite(result, origins, clock) {
  try {
    const invite = own(result, 'groupInvite');
    if (!origins || typeof clock !== 'function' || own(invite, 'platform') !== 'wechat') return null;
    const qrImageUrl = own(invite, 'qrImageUrl');
    const expiresAt = own(invite, 'expiresAt');
    const expiry = parseTimestamp(expiresAt);
    if (typeof qrImageUrl !== 'string' || !qrImageUrl.startsWith('https://') || qrImageUrl.length > 4096 || /[\s\\#\u0000-\u001f\u007f]/u.test(qrImageUrl) || expiry === null) return null;
    const url = new URL(qrImageUrl);
    if (url.protocol !== 'https:' || !origins.has(url.origin) || url.username || url.password) return null;
    const reading = clock();
    if (reading && typeof reading.then === 'function') { Promise.resolve(reading).catch(() => {}); return null; }
    const current = clockTime(reading);
    if (current === null || expiry <= current) return null;
    return { platform: 'wechat', qrImageUrl, expiresAt };
  } catch { return null; }
}

/**
 * Standalone Request -> Response adapter. It never listens, creates storage, or opens the frontend.
 * The required injected service owns policy, trusted clock, token/rate verification and durable
 * idempotent commits. It must resolve saved retries before applying new-registration time gates.
 */
export function createRegistrationApi({ allowedOrigins, submissionService, allowedGroupInviteOrigins, clock } = {}) {
  const origins = originSet(allowedOrigins);
  const inviteOrigins = originSet(allowedGroupInviteOrigins);
  let submit;
  try { if (typeof submissionService?.submit === 'function') submit = submissionService.submit.bind(submissionService); }
  catch { /* Invalid trusted dependency remains unavailable. */ }
  return async function handle(request) {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' };
    function reply(value, status) { return new Response(value === null ? null : JSON.stringify(value), { status, headers }); }
    function failure(code) { const [status, message] = ERRORS[code]; return reply({ error: { code, message } }, status); }
    try {
      const origin = request.headers.get('origin');
      if (origins?.has(origin)) headers['access-control-allow-origin'] = origin;
      if (!origins || !submit) return failure('UNAVAILABLE');
      const url = new URL(request.url);
      if (url.pathname !== '/api/registrations' || url.search || url.hash) return failure('NOT_FOUND');
      if (!['POST', 'OPTIONS'].includes(request.method)) { headers.allow = 'POST, OPTIONS'; return failure('METHOD_NOT_ALLOWED'); }
      if (url.protocol !== 'https:' || !origins.has(origin)) return failure('ORIGIN_REJECTED');
      if (request.method === 'OPTIONS') {
        const names = (request.headers.get('access-control-request-headers') ?? '').split(',').map(name => name.trim().toLowerCase());
        if (request.headers.get('access-control-request-method') !== 'POST' || names.some(name => name && !HEADER_NAMES.includes(name))) return failure('PREFLIGHT_REJECTED');
        headers['access-control-allow-methods'] = 'POST';
        headers['access-control-allow-headers'] = 'Content-Type, Idempotency-Key, X-Registration-Token';
        return reply(null, 204);
      }
      if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(request.headers.get('content-type') ?? '')
        || ![null, 'identity'].includes(request.headers.get('content-encoding'))) return failure('UNSUPPORTED_MEDIA_TYPE');
      const idempotencyKey = request.headers.get('idempotency-key');
      const submissionToken = request.headers.get('x-registration-token');
      // Syntax cannot establish key entropy or verify a token signature or expiry.
      if (!KEY_PATTERN.test(idempotencyKey ?? '') || typeof submissionToken !== 'string' || submissionToken.length > 4096 || !TOKEN_PATTERN.test(submissionToken)) return failure('INVALID_HEADERS');
      if (request.signal.aborted) return failure('INVALID_JSON');
      const payload = await readPayload(request);
      if (request.signal.aborted) return failure('INVALID_JSON');
      const result = await submit({ payload, idempotencyKey, submissionToken, origin });
      if (request.signal.aborted) return failure('UNAVAILABLE');
      const outcome = own(result, 'outcome');
      if (outcome === 'created' || outcome === 'replayed') {
        const receipt = committedReceipt(result, payload);
        if (!receipt) return failure('UNAVAILABLE');
        return reply({ status: 'registered', reference_code: receipt.referenceCode, groupInvite: groupInvite(result, inviteOrigins, clock) }, outcome === 'created' ? 201 : 200);
      }
      return failure(Object.hasOwn(OUTCOMES, outcome) ? OUTCOMES[outcome] : 'UNAVAILABLE');
    } catch (error) { return failure(error instanceof HttpError ? error.code : 'UNAVAILABLE'); }
  };
}
