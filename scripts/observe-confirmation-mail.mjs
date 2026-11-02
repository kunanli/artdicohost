import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIRMATION_EMAIL_CONFIGURATION_FIELDS, CONFIRMATION_EMAIL_REASONS } from '../shared/confirmation-delivery.mjs';

const API = 'https://api.artdico.host';
const LOGIN = '/api/admin/login', SETTINGS = '/api/admin/registration-confirmation/settings', LOGOUT = '/api/admin/logout';
const COOKIE = '__Secure-artdico_staff_session', MAX_BODY = 32 * 1024;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => { const descriptor = Object.getOwnPropertyDescriptor(value, key); return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined; };
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value) && Buffer.from(value, 'base64url').toString('base64url') === value;
const invalid = () => { throw new Error('Confirmation mail observation unavailable.'); };
const exact = (value, fields) => plain(value) && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
const fixedFields = value => Array.isArray(value) && value.length <= CONFIRMATION_EMAIL_CONFIGURATION_FIELDS.length
  && Object.keys(value).length === value.length && new Set(value).size === value.length
  && value.every(key => CONFIRMATION_EMAIL_CONFIGURATION_FIELDS.includes(key));

function sessionCookie(headers, logout = false) {
  const values = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  if (values.length !== 1 || values[0].length > 256) invalid();
  const match = /^__Secure-artdico_staff_session=([A-Za-z0-9_-]*); Path=\/api\/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=(0|[1-9]\d{0,4})$/u.exec(values[0]);
  if (!match || (logout ? match[1] !== '' || match[2] !== '0' : !token(match[1]) || Number(match[2]) < 1 || Number(match[2]) > 86400)) invalid();
  return COOKIE + '=' + match[1];
}

/** Only login, one configuration read and logout. Sessions/rate-limit records
 * are authentication bookkeeping; this observer never writes business data. */
export async function observeConfirmationMail({ env = process.env, fetchFn = fetch, timeoutMs = 10_000 } = {}) {
  let sourceCommit = null, session, observation, failure = 'INVALID_OBSERVATION_INPUT';
  const base = () => ({ sourceCommit, mailRequests: 0, businessWrites: 0 });
  async function request(path, method, { body, cookie, csrf } = {}) {
    if (![[LOGIN, 'POST'], [SETTINGS, 'GET'], [LOGOUT, 'POST']].some(([allowedPath, allowedMethod]) => path === allowedPath && method === allowedMethod)) invalid();
    const controller = new AbortController(); let response, reader, timer;
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Observation request expired.')); }, timeoutMs); });
    try {
      const url = API + path;
      const pending = Promise.resolve().then(() => fetchFn(url, { method, redirect: 'error', cache: 'no-store', credentials: 'omit',
        referrer: '', referrerPolicy: 'no-referrer', signal: controller.signal,
        headers: { accept: 'application/json', 'accept-encoding': 'identity', Origin: API,
          ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }),
          ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) })).then(value => {
          if (controller.signal.aborted) { try { value?.body?.cancel().catch(() => {}); } catch {} invalid(); }
          return value;
        });
      response = await Promise.race([pending, deadline]);
      if (response?.status !== 200 || response.redirected || response.url && response.url !== url
        || !/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(response.headers.get('content-type') ?? '')
        || ![null, 'identity'].includes(response.headers.get('content-encoding'))
        || !/(?:^|,)\s*no-store\s*(?:,|$)/iu.test(response.headers.get('cache-control') ?? '')
        || path === SETTINGS && response.headers.has('set-cookie')) invalid();
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^(0|[1-9]\d*)$/u.test(declared) || !Number.isSafeInteger(Number(declared)) || Number(declared) > MAX_BODY)) invalid();
      reader = response.body?.getReader(); if (!reader) invalid();
      const chunks = []; let bytes = 0;
      for (;;) {
        const next = await Promise.race([reader.read(), deadline]); if (next.done) break;
        if (!(next.value instanceof Uint8Array) || (bytes += next.value.byteLength) > MAX_BODY) invalid();
        chunks.push(Buffer.from(next.value));
      }
      if (declared !== null && Number(declared) !== bytes) invalid();
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes)));
      if (!plain(value)) invalid();
      return { value, headers: response.headers };
    } finally {
      clearTimeout(timer); controller.abort();
      try { if (reader) { reader.cancel().catch(() => {}); reader.releaseLock(); } else response?.body?.cancel().catch(() => {}); } catch {}
    }
  }
  try {
    const commit = own(env, 'GITHUB_SHA'), username = own(env, 'ARTDICO_ADMIN_USERNAME'), password = own(env, 'ARTDICO_ADMIN_PASSWORD');
    if (typeof commit === 'string' && /^[a-f0-9]{40}$/u.test(commit)) sourceCommit = commit;
    if (!sourceCommit || typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
      || typeof username !== 'string' || !username.trim() || username.length > 320 || /[\u0000-\u001f\u007f]/u.test(username)
      || typeof password !== 'string' || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 1024) invalid();
    failure = 'AUTHENTICATION_UNAVAILABLE';
    const login = await request(LOGIN, 'POST', { body: { username, password } });
    if (!exact(login.value, ['user', 'csrfToken']) || !plain(login.value.user) || !token(login.value.csrfToken)) invalid();
    session = { cookie: sessionCookie(login.headers), csrf: login.value.csrfToken };
    failure = 'SETTINGS_UNAVAILABLE';
    const { value } = await request(SETTINGS, 'GET', { cookie: session.cookie }), email = value.email;
    if (typeof value.automaticEnabled !== 'boolean' || !plain(email) || typeof email.enabled !== 'boolean' || typeof email.ready !== 'boolean'
      || !CONFIRMATION_EMAIL_REASONS.includes(email.reason) || !fixedFields(email.missing)
      || Object.hasOwn(email, 'invalid') && !fixedFields(email.invalid)
      || email.ready && (!email.enabled || email.reason !== 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF')
      || !email.ready && email.reason === 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF'
      || email.reason === 'EMAIL_DISABLED' && email.enabled) invalid();
    observation = { automaticEnabled: value.automaticEnabled, email: { enabled: email.enabled, ready: email.ready, reason: email.reason,
      missing: [...email.missing], ...(Object.hasOwn(email, 'invalid') ? { invalid: [...email.invalid] } : {}) } };
    failure = null;
  } catch { /* Only fixed failure codes leave this module. */ }
  finally {
    if (session) {
      try {
        const logout = await request(LOGOUT, 'POST', { ...session, body: {} });
        if (!exact(logout.value, ['ok']) || logout.value.ok !== true) invalid();
        sessionCookie(logout.headers, true);
      } catch { failure ??= 'LOGOUT_UNAVAILABLE'; }
    }
  }
  return failure ? { verified: false, ...base(), failure } : { verified: true, ...base(), ...observation };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = process.argv.length === 2 ? await observeConfirmationMail() : { verified: false, sourceCommit: null, mailRequests: 0, businessWrites: 0, failure: 'INVALID_OBSERVATION_INPUT' };
  console.log('Confirmation mail readiness observation: ' + JSON.stringify(result));
  if (!result.verified) process.exitCode = 1;
}
