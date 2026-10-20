import { createHash, createHmac, randomUUID } from 'node:crypto';
import { MAX_FC_REQUEST_BYTES, MAX_FC_ZIP_BYTES, assertFcCodeRequestFits } from './fc-upload-limits.mjs';
export { MAX_FC_ZIP_BYTES } from './fc-upload-limits.mjs';

// Official FC specifications: signature-mechanism, signature-authentication and
// api-fc-2023-03-30-endpoint under https://help.aliyun.com/zh/functioncompute/.
export const FC_REGION = 'cn-hongkong';
export const FC_API_ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com';
export const FC_FUNCTION_NAME = 'artdicohost-api';
export const FC_TRIGGER_NAME = 'defaultTrigger';
const VERSION = '2023-03-30';
const FUNCTION_PATH = `/${VERSION}/functions/${FC_FUNCTION_NAME}`;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_ERROR_BYTES = 16 * 1024;
const READ_REQUEST_DEADLINE_MS = 20_000;
const CODE_UPDATE_DEADLINE_MS = 120_000;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const diagnostics = new WeakMap();
const operations = new Set(['GetFunction', 'UpdateFunction', 'GetTrigger', 'CheckHealth']);
const phases = new Set(['input', 'signing', 'network', 'timeout', 'aborted', 'http', 'redirect', 'response_type', 'response_size', 'response_read', 'utf8', 'json', 'response_shape', 'trigger_url']);
const providerCodes = new Set(['AccessDenied', 'Forbidden', 'InvalidArgument', 'InvalidParameter', 'RequestEntityTooLarge', 'TooManyRequests', 'Unauthorized', 'SignatureDoesNotMatch', 'InvalidAccessKeyId', 'SecurityTokenExpired', 'InvalidSecurityToken', 'FunctionNotFound', 'InternalError', 'ServiceUnavailable']);
function failure(details) {
  const error = new Error('FC request failed; no response or credential details are included');
  if (operations.has(details?.operation) && phases.has(details.phase)) {
    const safe = { operation: details.operation, phase: details.phase };
    if (Number.isInteger(details.status) && details.status >= 100 && details.status <= 599) safe.status = details.status;
    if (providerCodes.has(details.code)) safe.code = details.code;
    diagnostics.set(error, Object.freeze(safe));
  }
  return error;
}
const preserve = (error, details) => diagnostics.has(error) ? error : failure(details);

/** Only errors created by this module carry diagnostics; arbitrary error properties are ignored. */
export function summarizeFcError(error) {
  const details = diagnostics.get(error);
  if (!details) return null;
  return `operation=${details.operation} phase=${details.phase}${details.status === undefined ? '' : ` status=${details.status}`}${details.code === undefined ? '' : ` code=${details.code}`}`;
}

/** Only a root URL returned by this function's authenticated GetTrigger can be used. */
export function validateFcTriggerUrl(value) {
  try {
    if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\\]/u.test(value)) throw failure();
    const url = new URL(value);
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-hongkong\.fcapp\.run$/u.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/'
      || ![url.origin, url.origin + '/'].includes(value)) throw failure();
    return url.origin;
  } catch { throw failure(); }
}

function time(clock) {
  const value = clock();
  if (!(value instanceof Date) && !(typeof value === 'number' && Number.isSafeInteger(value))
    && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))) throw failure();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw failure();
  if (typeof value === 'string' && date.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw failure();
  return date;
}

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(failure());
  return new Promise((accept, reject) => {
    const aborted = () => reject(failure());
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', aborted); accept(value); }, () => { signal.removeEventListener('abort', aborted); reject(failure()); });
  });
}

/** Narrow transport only: no create/configuration APIs, environment reads, or request/response logs. */
export function createFcClient({ region = FC_REGION, credentials, fetchFn = fetch, clock = () => new Date(), nonce = randomUUID } = {}) {
  let accessKeyId, accessKeySecret, securityToken;
  try {
    ({ accessKeyId, accessKeySecret, securityToken } = credentials);
    if (region !== FC_REGION || typeof fetchFn !== 'function' || typeof clock !== 'function' || typeof nonce !== 'function'
      || typeof accessKeyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/u.test(accessKeyId)
      || typeof accessKeySecret !== 'string' || !/^[\x21-\x7e]{1,1024}$/u.test(accessKeySecret)
      || securityToken !== undefined && (typeof securityToken !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(securityToken))) throw failure();
  } catch { throw new Error('FC client configuration is invalid'); }
  let triggerOrigin = null;

  async function request(operation, url, options, externalSignal) {
    let reader, response, timeoutSignal, signal, status;
    let phase = 'network';
    try {
      timeoutSignal = AbortSignal.timeout(operation === 'UpdateFunction' ? CODE_UPDATE_DEADLINE_MS : READ_REQUEST_DEADLINE_MS);
      signal = externalSignal ? AbortSignal.any([externalSignal, timeoutSignal]) : timeoutSignal;
      if (signal.aborted) throw failure();
      response = await abortable(fetchFn(url, { ...options, redirect: 'error', cache: 'no-store', signal }), signal);
      status = response.status;
      phase = 'redirect';
      if (response.redirected || response.url && response.url !== url || status >= 300 && status < 400) throw failure();
      phase = 'response_type';
      if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) throw failure();
      const limit = status === 200 ? MAX_RESPONSE_BYTES : MAX_ERROR_BYTES;
      phase = 'response_size';
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) throw failure();
      phase = 'response_read';
      reader = response.body?.getReader();
      if (!reader) throw failure();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        if (!(value instanceof Uint8Array) || (length += value.byteLength) > limit) {
          phase = 'response_size'; throw failure();
        }
        chunks.push(value);
      }
      phase = 'utf8';
      const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
      phase = 'json';
      const body = JSON.parse(decoded);
      phase = 'response_shape';
      if (!plain(body)) throw failure();
      if (status !== 200) {
        const code = ['Code', 'code', 'ErrorCode', 'errorCode'].filter(key => Object.hasOwn(body, key)).map(key => body[key]).find(value => providerCodes.has(value));
        throw failure({ operation, phase: 'http', status, code });
      }
      return { status, body };
    } catch (error) {
      if (externalSignal?.aborted) throw failure({ operation, phase: 'aborted', status });
      if (timeoutSignal?.aborted) throw failure({ operation, phase: 'timeout', status });
      throw preserve(error, { operation, phase, status });
    }
    finally {
      if (reader) { reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* Aborted readers stay private. */ } }
      else response?.body?.cancel().catch(() => {});
    }
  }

  async function api(action, method, path, body = '', { signal } = {}) {
    try {
      const id = nonce();
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(id)) throw failure();
      const headers = { 'content-type': 'application/json', host: new URL(FC_API_ENDPOINT).host,
        'x-acs-action': action, 'x-acs-content-sha256': sha256(body),
        'x-acs-date': time(clock).toISOString().replace(/\.\d{3}Z$/u, 'Z'), 'x-acs-signature-nonce': id, 'x-acs-version': VERSION };
      if (securityToken !== undefined) headers['x-acs-security-token'] = securityToken;
      const names = Object.keys(headers).sort();
      const canonicalHeaders = names.map(name => `${name}:${headers[name].trim()}\n`).join('');
      // CanonicalHeaders ends in a newline; the following join adds the required empty line.
      const canonical = [method, path, '', canonicalHeaders, names.join(';'), sha256(body)].join('\n');
      const signature = createHmac('sha256', accessKeySecret).update('ACS3-HMAC-SHA256\n' + sha256(canonical)).digest('hex');
      headers.authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${names.join(';')},Signature=${signature}`;
      return (await request(action, FC_API_ENDPOINT + path, { method, headers, ...(body ? { body } : {}) }, signal)).body;
    } catch (error) { throw preserve(error, { operation: action, phase: 'signing' }); }
  }

  return {
    getFunction: options => api('GetFunction', 'GET', FUNCTION_PATH, '', options),
    updateCode: (zipBytes, options) => {
      let body;
      try {
        if (!(zipBytes instanceof Uint8Array) || !zipBytes.byteLength || zipBytes.byteLength > MAX_FC_ZIP_BYTES) throw failure();
        const expectedBytes = assertFcCodeRequestFits(zipBytes.byteLength);
        body = JSON.stringify({ code: { zipFile: Buffer.from(zipBytes).toString('base64') } });
        if (Buffer.byteLength(body, 'utf8') !== expectedBytes || expectedBytes > MAX_FC_REQUEST_BYTES) throw failure();
      } catch { return Promise.reject(failure({ operation: 'UpdateFunction', phase: 'input' })); }
      return api('UpdateFunction', 'PUT', FUNCTION_PATH, body, options);
    },
    getTrigger: async options => {
      triggerOrigin = null;
      const body = await api('GetTrigger', 'GET', FUNCTION_PATH + `/triggers/${FC_TRIGGER_NAME}`, '', options);
      try { triggerOrigin = validateFcTriggerUrl(body.httpTrigger?.urlInternet); }
      catch { throw failure({ operation: 'GetTrigger', phase: 'trigger_url' }); }
      return body;
    },
    checkHealth: async (url = triggerOrigin, { signal } = {}) => {
      let phase = 'trigger_url';
      try {
        const origin = validateFcTriggerUrl(url);
        if (!triggerOrigin || origin !== triggerOrigin) throw failure();
        phase = 'signing';
        const headers = { host: new URL(origin).host, date: time(clock).toUTCString() };
        if (securityToken !== undefined) headers['x-fc-security-token'] = securityToken;
        const canonicalFc = securityToken === undefined ? '' : `x-fc-security-token:${securityToken}\n`;
        // HTTP trigger v1 signs an empty query object as a trailing newline after the path.
        const canonical = `GET\n\n\n${headers.date}\n${canonicalFc}/healthz\n`;
        headers.authorization = `FC ${accessKeyId}:${createHmac('sha256', accessKeySecret).update(canonical).digest('base64')}`;
        return await request('CheckHealth', origin + '/healthz', { method: 'GET', headers }, signal);
      } catch (error) { throw preserve(error, { operation: 'CheckHealth', phase }); }
    },
  };
}
