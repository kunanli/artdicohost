import { MAX_REGISTRATION_BYTES } from './validation.mjs';
import { own, plainObject, parseTimestamp, clockTime, validateRegistrationPolicy } from './policy.mjs';

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
  const valid = own(receipt, 'committed') === true && typeof eventId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(eventId)
    && eventId === own(payload, 'eventId') && typeof referenceCode === 'string' && KEY_PATTERN.test(referenceCode)
    && parseTimestamp(own(receipt, 'committedAt')) !== null;
  if (!valid) return null;
  const admissionStatus = own(receipt, 'admissionStatus'), admissionKind = own(receipt, 'admissionKind'), admissionRevision = own(receipt, 'admissionRevision');
  if (!['pending_review', 'confirmed', 'waitlisted', 'rejected'].includes(admissionStatus) || !['attendee', 'crew'].includes(admissionKind)
    || !Number.isSafeInteger(admissionRevision) || admissionRevision < 0) return null;
  return { referenceCode, admissionStatus, admissionKind, admissionRevision };
}

function publicAdmissions(value, capacity) {
  const projected = { capacity: own(value, 'capacity'), staffReserve: own(value, 'staffReserve'), waitlistEnabled: own(value, 'waitlistEnabled') };
  if (projected.capacity !== capacity || !Number.isSafeInteger(projected.staffReserve) || projected.staffReserve < 0 || projected.staffReserve > capacity
    || typeof projected.waitlistEnabled !== 'boolean') return null;
  for (const field of ['confirmedCount', 'attendeeConfirmedCount', 'crewConfirmedCount', 'waitlistCount', 'pendingReviewCount', 'rejectedCount', 'remainingPublic', 'remainingTotal']) {
    const count = own(value, field);
    if (!Number.isSafeInteger(count) || count < 0 || count > (['waitlistCount', 'pendingReviewCount', 'rejectedCount'].includes(field) ? 1000 : capacity)) return null;
    projected[field] = count;
  }
  return projected;
}

/** Only an exact public receipt URL and bounded delivery states leave the API. */
function publicConfirmation(result, clock) {
  try {
    const value = own(result, 'confirmation'), receiptToken = own(value, 'receiptToken'), confirmationUrl = own(value, 'confirmationUrl'), expiresAt = own(value, 'expiresAt');
    if (typeof receiptToken !== 'string' || receiptToken.length > 4096 || !TOKEN_PATTERN.test(receiptToken)
      || typeof confirmationUrl !== 'string' || confirmationUrl.length > 4600 || confirmationUrl !== 'https://artdico.host/registration/confirmation/#r=' + receiptToken
      || parseTimestamp(expiresAt) === null || typeof clock !== 'function') return null;
    const current = clockTime(clock());
    if (current === null || parseTimestamp(expiresAt) <= current) return null;
    const status = own(own(value, 'email'), 'status');
    if (!['not_configured','not_applicable','disabled','pending','prepared','provider_accepted','rejected','unknown','issuing'].includes(status)) return null;
    return { receiptToken, confirmationUrl, expiresAt, email: { status } };
  } catch { return null; }
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
  let submit, metadata, issueToken;
  try {
    if (typeof submissionService?.submit === 'function') submit = submissionService.submit.bind(submissionService);
    if (typeof submissionService?.metadata === 'function') metadata = submissionService.metadata.bind(submissionService);
    if (typeof submissionService?.issueToken === 'function') issueToken = submissionService.issueToken.bind(submissionService);
  }
  catch { /* Invalid trusted dependency remains unavailable. */ }
  return async function handle(request) {
    const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'Origin' };
    function reply(value, status) { return new Response(value === null ? null : JSON.stringify(value), { status, headers }); }
    function failure(code) { const [status, message] = ERRORS[code]; return reply({ error: { code, message } }, status); }
    try {
      const origin = request.headers.get('origin');
      if (origins?.has(origin)) headers['access-control-allow-origin'] = origin;
      if (!origins) return failure('UNAVAILABLE');
      const url = new URL(request.url);
      const configRoute = url.pathname === '/api/registration/config', tokenRoute = url.pathname === '/api/registration/token';
      if ((!configRoute && !tokenRoute && url.pathname !== '/api/registrations') || url.search || url.hash) return failure('NOT_FOUND');
      if (configRoute || tokenRoute) {
        if (url.protocol !== 'https:' || !origins.has(origin)) return failure('ORIGIN_REJECTED');
        const allowedMethod = configRoute ? 'GET' : 'POST';
        if (!['OPTIONS', allowedMethod].includes(request.method)) { headers.allow = `${allowedMethod}, OPTIONS`; return failure('METHOD_NOT_ALLOWED'); }
        if (request.method === 'OPTIONS') {
          const names = (request.headers.get('access-control-request-headers') ?? '').split(',').map(value => value.trim().toLowerCase());
          if (request.headers.get('access-control-request-method') !== allowedMethod || names.some(value => value && value !== 'content-type')) return failure('PREFLIGHT_REJECTED');
          headers['access-control-allow-methods'] = allowedMethod;
          if (tokenRoute) headers['access-control-allow-headers'] = 'Content-Type';
          return reply(null, 204);
        }
        if (configRoute) {
          if (!metadata) return reply({ enabled: false, reason: 'unavailable' }, 200);
          const value = await metadata();
          const enabled = own(value, 'enabled'), reason = own(value, 'reason') === 'closed' ? 'closed' : 'unavailable';
          if (enabled === false && !['eventId', 'opensAt', 'closesAt', 'capacity', 'privacy'].some(key => own(value, key) !== undefined)) return reply({ enabled: false, reason }, 200);
          // Only the server-owned public notice/configuration projection can leave this endpoint.
          const checked = { enabled, eventId: own(value, 'eventId'), opensAt: own(value, 'opensAt'), closesAt: own(value, 'closesAt'), capacity: own(value, 'capacity'), privacy: {} };
          if (typeof enabled !== 'boolean' || typeof checked.eventId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(checked.eventId)
            || parseTimestamp(checked.opensAt) === null || parseTimestamp(checked.closesAt) === null || !Number.isSafeInteger(checked.capacity) || checked.capacity < 1 || checked.capacity > 1000) return failure('UNAVAILABLE');
          for (const key of ['version', 'processor', 'contactEmail', 'purpose', 'storageRegion', 'retention', 'rightsRequest', 'sharing']) {
            const text = own(own(value, 'privacy'), key);
            if (typeof text !== 'string' || !text || text.length > 4000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) return failure('UNAVAILABLE');
            checked.privacy[key] = text;
          }
          if (!validateRegistrationPolicy({ ...checked, enabled: true }, { now: checked.opensAt }).valid) return failure('UNAVAILABLE');
          // Review is server policy, never a caller-controlled option.
          checked.attendeeReviewRequired = true;
          if (own(value, 'admissions') !== undefined) {
            checked.admissions = publicAdmissions(own(value, 'admissions'), checked.capacity);
            if (!checked.admissions) return failure('UNAVAILABLE');
          }
          return reply(enabled ? checked : { ...checked, reason }, 200);
        }
        if (!issueToken) return failure('UNAVAILABLE');
        if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/iu.test(request.headers.get('content-type') ?? '')
          || ![null, 'identity'].includes(request.headers.get('content-encoding'))) return failure('UNSUPPORTED_MEDIA_TYPE');
        const payload = await readPayload(request);
        if (Object.keys(payload).sort().join(',') !== 'eventId,idempotencyKey' || !KEY_PATTERN.test(own(payload, 'idempotencyKey') ?? '')) return failure('INVALID_HEADERS');
        const value = await issueToken({ eventId: own(payload, 'eventId'), idempotencyKey: own(payload, 'idempotencyKey'), origin });
        if (request.signal.aborted) return failure('UNAVAILABLE');
        if (own(value, 'outcome') !== 'issued') {
          if (own(value, 'outcome') === 'rate_limited' && Number.isSafeInteger(own(value, 'retryAfter')) && own(value, 'retryAfter') >= 1 && own(value, 'retryAfter') <= 86400) headers['retry-after'] = String(own(value, 'retryAfter'));
          return failure(Object.hasOwn(OUTCOMES, own(value, 'outcome')) ? OUTCOMES[own(value, 'outcome')] : 'UNAVAILABLE');
        }
        const token = own(value, 'submissionToken'), expiresAt = own(value, 'expiresAt');
        if (own(value, 'eventId') !== own(payload, 'eventId') || typeof token !== 'string' || token.length > 4096 || !TOKEN_PATTERN.test(token) || parseTimestamp(expiresAt) === null) return failure('UNAVAILABLE');
        return reply({ eventId: own(value, 'eventId'), submissionToken: token, expiresAt }, 200);
      }
      if (!submit) return failure('UNAVAILABLE');
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
        const { referenceCode, ...admission } = receipt;
        const status = {
          pending_review: 'pending_review', confirmed: 'registered', waitlisted: 'waitlisted', rejected: 'rejected',
        }[receipt.admissionStatus];
        const confirmation = publicConfirmation(result, clock);
        return reply({ status, reference_code: referenceCode,
          groupInvite: receipt.admissionStatus === 'confirmed' ? groupInvite(result, inviteOrigins, clock) : null, ...admission,
          ...(confirmation ? { confirmation } : {}) }, outcome === 'created' ? 201 : 200);
      }
      if (outcome === 'rate_limited' && Number.isSafeInteger(own(result, 'retryAfter')) && own(result, 'retryAfter') >= 1 && own(result, 'retryAfter') <= 86400) headers['retry-after'] = String(own(result, 'retryAfter'));
      return failure(Object.hasOwn(OUTCOMES, outcome) ? OUTCOMES[outcome] : 'UNAVAILABLE');
    } catch (error) { return failure(error instanceof HttpError ? error.code : 'UNAVAILABLE'); }
  };
}
