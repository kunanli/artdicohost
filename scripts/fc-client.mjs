import { createHash, createHmac, randomUUID } from 'node:crypto';

// Official FC specifications: signature-mechanism, signature-authentication and
// api-fc-2023-03-30-endpoint under https://help.aliyun.com/zh/functioncompute/.
export const FC_REGION = 'cn-hongkong';
export const FC_API_ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com';
export const FC_FUNCTION_NAME = 'artdicohost-api';
export const FC_TRIGGER_NAME = 'defaultTrigger';
export const MAX_FC_ZIP_BYTES = 64 * 1024 * 1024;
const VERSION = '2023-03-30';
const FUNCTION_PATH = `/${VERSION}/functions/${FC_FUNCTION_NAME}`;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = () => new Error('FC request failed; no response or credential details are included');

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

  async function request(url, options, externalSignal) {
    let reader, response;
    try {
      const signal = externalSignal ? AbortSignal.any([externalSignal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
      if (signal.aborted) throw failure();
      response = await abortable(fetchFn(url, { ...options, redirect: 'error', cache: 'no-store', signal }), signal);
      if (response.status !== 200 || response.redirected || response.url && response.url !== url
        || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) throw failure();
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) throw failure();
      reader = response.body?.getReader();
      if (!reader) throw failure();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await abortable(reader.read(), signal);
        if (done) break;
        if (!(value instanceof Uint8Array) || (length += value.byteLength) > MAX_RESPONSE_BYTES) throw failure();
        chunks.push(value);
      }
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      if (!plain(body)) throw failure();
      return { status: response.status, body };
    } catch { throw failure(); }
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
      return (await request(FC_API_ENDPOINT + path, { method, headers, ...(body ? { body } : {}) }, signal)).body;
    } catch { throw failure(); }
  }

  return {
    getFunction: options => api('GetFunction', 'GET', FUNCTION_PATH, '', options),
    updateCode: (zipBytes, options) => {
      if (!(zipBytes instanceof Uint8Array) || !zipBytes.byteLength || zipBytes.byteLength > MAX_FC_ZIP_BYTES) return Promise.reject(failure());
      return api('UpdateFunction', 'PUT', FUNCTION_PATH, JSON.stringify({ code: { zipFile: Buffer.from(zipBytes).toString('base64') } }), options);
    },
    getTrigger: async options => {
      triggerOrigin = null;
      const body = await api('GetTrigger', 'GET', FUNCTION_PATH + `/triggers/${FC_TRIGGER_NAME}`, '', options);
      triggerOrigin = validateFcTriggerUrl(body.httpTrigger?.urlInternet);
      return body;
    },
    checkHealth: async (url = triggerOrigin, { signal } = {}) => {
      try {
        const origin = validateFcTriggerUrl(url);
        if (!triggerOrigin || origin !== triggerOrigin) throw failure();
        const headers = { host: new URL(origin).host, date: time(clock).toUTCString() };
        if (securityToken !== undefined) headers['x-fc-security-token'] = securityToken;
        const canonicalFc = securityToken === undefined ? '' : `x-fc-security-token:${securityToken}\n`;
        // HTTP trigger v1 signs an empty query object as a trailing newline after the path.
        const canonical = `GET\n\n\n${headers.date}\n${canonicalFc}/healthz\n`;
        headers.authorization = `FC ${accessKeyId}:${createHmac('sha256', accessKeySecret).update(canonical).digest('base64')}`;
        return await request(origin + '/healthz', { method: 'GET', headers }, signal);
      } catch { throw failure(); }
    },
  };
}
