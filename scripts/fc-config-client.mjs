import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createFcClient } from './fc-client.mjs';

const ENDPOINT = 'https://fcv3.cn-hongkong.aliyuncs.com';
const PATH = '/2023-03-30/functions/artdicohost-api';
const VERSION = '2023-03-30';
const LIMIT = 64 * 1024;
const TIMEOUT = 20_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const diagnostics = new WeakMap();
const phases = new Set(['input', 'signing', 'network', 'timeout', 'aborted', 'http', 'redirect', 'response_type', 'response_size', 'response_read', 'utf8', 'json', 'response_shape']);
const codes = new Set(['AccessDenied', 'Forbidden', 'InvalidArgument', 'InvalidParameter', 'RequestEntityTooLarge', 'TooManyRequests', 'Unauthorized', 'SignatureDoesNotMatch', 'InvalidAccessKeyId', 'SecurityTokenExpired', 'InvalidSecurityToken', 'FunctionNotFound', 'InternalError', 'ServiceUnavailable']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function failure(details) {
  const error = new Error('FC configuration request failed; no response or credential details are included');
  if (phases.has(details?.phase)) {
    const safe = { operation: 'UpdateFunction', phase: details.phase };
    if (Number.isInteger(details.status) && details.status >= 100 && details.status <= 599) safe.status = details.status;
    if (codes.has(details.code)) safe.code = details.code;
    diagnostics.set(error, Object.freeze(safe));
  }
  return error;
}

export function summarizeFcConfigError(error) {
  const detail = diagnostics.get(error);
  return detail ? `operation=UpdateFunction phase=${detail.phase}${detail.status === undefined ? '' : ' status=' + detail.status}${detail.code === undefined ? '' : ' code=' + detail.code}` : null;
}

function environmentBody(value) {
  try {
    if (!plain(value) || Object.getOwnPropertySymbols(value).length || Reflect.ownKeys(value).length > 100) throw failure();
    const copy = Object.create(null);
    for (const key of Reflect.ownKeys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
        || !descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string' || Buffer.byteLength(descriptor.value) > 32 * 1024) throw failure();
      copy[key] = descriptor.value;
    }
    if (copy.ARTDICO_CLOUD_CONTENT_ENABLED !== 'false') throw failure();
    if (Buffer.byteLength(JSON.stringify(copy)) > 4096) throw failure();
    const body = JSON.stringify({ environmentVariables: copy });
    if (Buffer.byteLength(body) > LIMIT) throw failure();
    return body;
  } catch { throw failure({ phase: 'input' }); }
}

/** Validate without returning the serialized map to a caller or logger. */
export function assertFcEnvironmentMap(value) { environmentBody(value); }

function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(failure());
  return new Promise((accept, reject) => {
    const abort = () => reject(failure());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); accept(value); }, () => { signal.removeEventListener('abort', abort); reject(failure()); });
  });
}

function dateValue(clock) {
  const value = clock();
  if (!(value instanceof Date) && !(typeof value === 'number' && Number.isSafeInteger(value))
    && !(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))) throw failure();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || typeof value === 'string' && date.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) throw failure();
  return date.toISOString().replace(/\.\d{3}Z$/u, 'Z');
}

/** Separate one-shot configuration transport; no code, role, runtime, trigger or creation mutation. */
export function createFcConfigClient(options = {}) {
  let accessKeyId, accessKeySecret, securityToken, readerClient, fetchFn, clock, nonce;
  try {
    if (!plain(options) || Reflect.ownKeys(options).some(key => !['credentials', 'fetchFn', 'clock', 'nonce'].includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) throw failure();
    const credentials = Object.getOwnPropertyDescriptor(options, 'credentials')?.value;
    if (!plain(credentials) || Reflect.ownKeys(credentials).some(key => !['accessKeyId', 'accessKeySecret', 'securityToken'].includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(credentials, key), 'value'))) throw failure();
    accessKeyId = Object.getOwnPropertyDescriptor(credentials, 'accessKeyId')?.value;
    accessKeySecret = Object.getOwnPropertyDescriptor(credentials, 'accessKeySecret')?.value;
    securityToken = Object.getOwnPropertyDescriptor(credentials, 'securityToken')?.value;
    fetchFn = Object.getOwnPropertyDescriptor(options, 'fetchFn')?.value;
    clock = Object.getOwnPropertyDescriptor(options, 'clock')?.value;
    nonce = Object.getOwnPropertyDescriptor(options, 'nonce')?.value;
    if (fetchFn === undefined) fetchFn = fetch;
    if (clock === undefined) clock = () => new Date();
    if (nonce === undefined) nonce = randomUUID;
    if (typeof fetchFn !== 'function' || typeof clock !== 'function' || typeof nonce !== 'function'
      || typeof accessKeyId !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/u.test(accessKeyId)
      || typeof accessKeySecret !== 'string' || !/^[\x21-\x7e]{1,1024}$/u.test(accessKeySecret)
      || securityToken !== undefined && (typeof securityToken !== 'string' || !/^[\x21-\x7e]{1,8192}$/u.test(securityToken))) throw failure();
    readerClient = createFcClient({ credentials: { accessKeyId, accessKeySecret, ...(securityToken === undefined ? {} : { securityToken }) }, fetchFn, clock, nonce });
  } catch { throw new Error('FC configuration client is invalid'); }

  async function updateEnvironment(environment, options = {}) {
    let externalSignal;
    try {
      if (!plain(options) || Reflect.ownKeys(options).some(key => key !== 'signal'
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) throw failure();
      externalSignal = Object.getOwnPropertyDescriptor(options, 'signal')?.value;
      if (externalSignal !== undefined && !(externalSignal instanceof AbortSignal)) throw failure();
    } catch { throw failure({ phase: 'input' }); }
    const body = environmentBody(environment);
    let headers;
    try {
      const id = nonce();
      if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/u.test(id)) throw failure();
      headers = { 'content-type': 'application/json', host: new URL(ENDPOINT).host, 'x-acs-action': 'UpdateFunction',
        'x-acs-content-sha256': digest(body), 'x-acs-date': dateValue(clock), 'x-acs-signature-nonce': id, 'x-acs-version': VERSION };
      if (securityToken !== undefined) headers['x-acs-security-token'] = securityToken;
      const names = Object.keys(headers).sort();
      const canonical = ['PUT', PATH, '', names.map(key => `${key}:${headers[key].trim()}\n`).join(''), names.join(';'), digest(body)].join('\n');
      const signature = createHmac('sha256', accessKeySecret).update('ACS3-HMAC-SHA256\n' + digest(canonical)).digest('hex');
      headers.authorization = `ACS3-HMAC-SHA256 Credential=${accessKeyId},SignedHeaders=${names.join(';')},Signature=${signature}`;
    } catch { throw failure({ phase: 'signing' }); }

    let reader, response, timeout, signal, status, phase = 'network';
    try {
      timeout = AbortSignal.timeout(TIMEOUT);
      signal = externalSignal === undefined ? timeout : AbortSignal.any([externalSignal, timeout]);
      if (signal.aborted) throw failure();
      response = await abortable(Promise.resolve().then(() => fetchFn(ENDPOINT + PATH, { method: 'PUT', headers, body, signal, redirect: 'error', cache: 'no-store' })), signal);
      status = response.status;
      phase = 'redirect';
      if (response.redirected || response.url && response.url !== ENDPOINT + PATH || status >= 300 && status < 400) throw failure();
      phase = 'response_type';
      if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')) throw failure();
      const limit = status === 200 ? 1024 * 1024 : 16 * 1024;
      phase = 'response_size';
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^\d+$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > limit)) throw failure();
      phase = 'response_read'; reader = response.body?.getReader();
      if (!reader) throw failure();
      const chunks = []; let length = 0;
      while (true) {
        const part = await abortable(reader.read(), signal);
        if (part.done) break;
        if (!(part.value instanceof Uint8Array) || (length += part.value.byteLength) > limit) { phase = 'response_size'; throw failure(); }
        chunks.push(part.value);
      }
      phase = 'utf8'; const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
      phase = 'json'; const value = JSON.parse(text);
      phase = 'response_shape'; if (!plain(value)) throw failure();
      if (status !== 200) {
        const code = ['Code', 'code', 'ErrorCode', 'errorCode'].map(key => value[key]).find(item => codes.has(item));
        throw failure({ phase: 'http', status, code });
      }
      return { acknowledged: true };
    } catch (error) {
      let externallyAborted = false;
      try { externallyAborted = externalSignal !== undefined && Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get.call(externalSignal); } catch { /* Invalid signal stays an opaque request failure. */ }
      if (externallyAborted) throw failure({ phase: 'aborted', status });
      if (timeout?.aborted) throw failure({ phase: 'timeout', status });
      throw diagnostics.has(error) ? error : failure({ phase, status });
    } finally {
      if (reader) {
        try { reader.cancel()?.catch?.(() => {}); } catch { /* Cleanup cannot expose a transport exception. */ }
        try { reader.releaseLock(); } catch { /* Closed reader. */ }
      } else { try { response?.body?.cancel()?.catch?.(() => {}); } catch { /* Cleanup cannot expose a response exception. */ } }
    }
  }
  return Object.freeze({ getFunction: readerClient.getFunction, getTrigger: readerClient.getTrigger, checkHealth: readerClient.checkHealth, updateEnvironment });
}
