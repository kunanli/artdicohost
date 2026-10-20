import { createHash, randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parseAdminUsers, findAdminUser, publicUser, verifyPassword, equalToken } from '../content-api/auth.mjs';
import { CloudContentError } from './errors.mjs';

export const CLOUD_SESSION_COOKIE = '__Secure-artdico_staff_session';
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;
const SHA = /^[a-f0-9]{64}$/u;
const MAX_CONFLICT_RETRIES = 8;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const digest = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => {
  try {
    if (!record(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
};
const unavailable = () => new CloudContentError('AUTH_STORAGE_UNAVAILABLE', '工作人员登录暂不可用，请稍后重试。', 503);
const required = () => new CloudContentError('AUTH_REQUIRED', '会话已结束，请重新登录。', 401);
const failed = () => new CloudContentError('AUTH_FAILED', '账号或密码不正确。', 401);
const conflict = error => error instanceof CloudContentError && error.code === 'WRITE_CONFLICT' && error.status === 409;

function configuredAccounts(input) {
  try {
    const value = typeof input === 'string' ? JSON.parse(input) : input;
    const fields = ['id', 'username', 'email', 'label', 'roles', 'passwordHash'];
    if (!Array.isArray(value) || value.some(account => !record(account)
      || Object.keys(account).some(key => !fields.includes(key)))) throw new Error();
    return parseAdminUsers(value);
  } catch { throw new TypeError('云端账号配置无效；仅接受明确账号、角色和 scrypt 摘要，停用须移除账号。'); }
}

function validToken(value) {
  return typeof value === 'string' && TOKEN.test(value)
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function cookie(value, seconds) {
  return `${CLOUD_SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`;
}

function credentialFingerprint(account) {
  return digest(JSON.stringify([account.id, account.username, account.email ?? null, account.label,
    [...account.roles].sort(), account.passwordHash]));
}

function userProjection(account) {
  const user = publicUser(account);
  Object.freeze(user.roles);
  return Object.freeze(user);
}

function sessionValue(value) {
  const fields = ['schemaVersion', 'kind', 'userId', 'credentialFingerprint', 'csrfToken', 'createdAt', 'expiresAt', 'revoked'];
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== 'staff_session'
    || Object.keys(value).some(key => !fields.includes(key) && key !== 'revokedAt')
    || typeof value.userId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(value.userId)
    || typeof value.credentialFingerprint !== 'string' || !SHA.test(value.credentialFingerprint)
    || !validToken(value.csrfToken) || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= value.createdAt
    || value.expiresAt - value.createdAt > MAX_TTL_MS || typeof value.revoked !== 'boolean'
    || value.revoked && (!Number.isSafeInteger(value.revokedAt) || value.revokedAt < value.createdAt)
    || !value.revoked && Object.hasOwn(value, 'revokedAt')) throw unavailable();
  return value;
}

/** Shared journals provide persistence and CAS; this module has no session or rate-limit cache. */
export function createCloudAuth({ users, journalFor, now = () => Date.now(),
  sessionTtlMs = 8 * 60 * 60 * 1000, loginLimit = 10, globalLoginLimit = 60,
  loginWindowMs = 15 * 60 * 1000 } = {}) {
  const accounts = configuredAccounts(users);
  if (typeof journalFor !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(sessionTtlMs) || sessionTtlMs < 1 || sessionTtlMs > MAX_TTL_MS
    || !Number.isSafeInteger(loginWindowMs) || loginWindowMs < 1 || loginWindowMs > MAX_TTL_MS
    || ![loginLimit, globalLoginLimit].every(value => Number.isSafeInteger(value) && value >= 1 && value <= 60)) {
    throw new TypeError('云端账号的共享储存、时钟或限流配置无效。');
  }
  // Transient proof objects only: durable authentication always re-reads the shared journal.
  const authenticationProofs = new WeakMap();

  function clock() {
    let value;
    try { value = now(); } catch { throw unavailable(); }
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - MAX_TTL_MS) throw unavailable();
    return value;
  }

  async function journal(prefix) {
    try {
      const value = await journalFor(prefix);
      if (!value || typeof value.read !== 'function' || typeof value.commit !== 'function') throw unavailable();
      return value;
    } catch { throw unavailable(); }
  }

  async function read(journal) {
    try {
      const state = await journal.read();
      if (!record(state) || !Object.hasOwn(state, 'value') || !record(state.cursor)
        || !Number.isSafeInteger(state.cursor.position) || state.cursor.position < 0
        || !Number.isSafeInteger(state.cursor.version) || state.cursor.version < 0
        || (state.cursor.version === 0
          ? state.cursor.position !== 0 || state.cursor.hash !== null || state.value !== null
          : state.cursor.position <= 0 || typeof state.cursor.hash !== 'string' || !SHA.test(state.cursor.hash) || !record(state.value))) throw unavailable();
      return state;
    } catch { throw unavailable(); }
  }

  async function commit(journal, cursor, value) {
    try {
      const ack = await journal.commit(cursor, value);
      if (!record(ack) || !record(ack.cursor) || !isDeepStrictEqual(ack.value, value)
        || ack.cursor.version !== cursor.version + 1 || !Number.isSafeInteger(ack.cursor.position)
        || ack.cursor.position <= cursor.position || typeof ack.cursor.hash !== 'string' || !SHA.test(ack.cursor.hash)) throw unavailable();
    }
    catch (error) { if (conflict(error)) throw error; throw unavailable(); }
  }

  async function reserve(at) {
    const window = Math.floor(at / loginWindowMs);
    const id = digest('global');
    const limit = Math.min(loginLimit, globalLoginLimit);
    const target = await journal(`cms/v1/limits/${window}/${id}`);
    for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
      const state = await read(target);
      const value = state.value;
      if (value !== null && (!record(value) || value.schemaVersion !== 1 || value.kind !== 'login_budget'
        || value.id !== id || value.window !== window || !Number.isSafeInteger(value.count)
        || value.count < 0 || value.count > 60
        || Object.keys(value).some(key => !['schemaVersion', 'kind', 'id', 'window', 'count'].includes(key)))) throw unavailable();
      const count = value?.count ?? 0;
      if (count >= limit) {
        const error = new CloudContentError('LOGIN_RATE_LIMITED', '登录尝试过于频繁，请稍后重试。', 429);
        error.retryAfter = Math.max(1, Math.ceil(((window + 1) * loginWindowMs - at) / 1000));
        throw error;
      }
      try {
        await commit(target, state.cursor, { schemaVersion: 1, kind: 'login_budget', id, window, count: count + 1 });
        return;
      } catch (error) {
        if (!conflict(error)) throw error;
      }
    }
    throw unavailable();
  }

  function sessionToken(request) {
    let header;
    try { header = request.headers.get('cookie') ?? ''; } catch { throw required(); }
    if (header.length > 8192) throw required();
    const values = header.split(';').map(value => value.trim()).filter(value => value.startsWith(`${CLOUD_SESSION_COOKIE}=`));
    if (values.length !== 1) throw required();
    const token = values[0].slice(CLOUD_SESSION_COOKIE.length + 1);
    if (!validToken(token)) throw required();
    return token;
  }

  return {
    async login(input = {}) {
      const identifier = own(input, 'identifier');
      const password = own(input, 'password');
      const at = clock();
      // One shared budget gives every identifier the same saturated response and
      // storage path; account-specific buckets would reveal whether a name exists.
      // All aliases and failed attempts conservatively consume the same allowance.
      await reserve(at);
      const account = findAdminUser(accounts, identifier);
      const validPassword = typeof password === 'string' && Buffer.byteLength(password) <= 1024;
      let verified;
      try { verified = await verifyPassword(validPassword ? password : '', (account ?? accounts[0]).passwordHash); }
      catch { throw unavailable(); }
      if (!account || !validPassword || !verified) throw failed();
      const token = randomBytes(32).toString('base64url');
      const csrfToken = randomBytes(32).toString('base64url');
      const target = await journal(`cms/v1/sessions/${digest(token)}`);
      const state = await read(target);
      if (state.value !== null) throw unavailable();
      const createdAt = clock();
      try {
        await commit(target, state.cursor, { schemaVersion: 1, kind: 'staff_session', userId: account.id,
          credentialFingerprint: credentialFingerprint(account), csrfToken, createdAt,
          expiresAt: createdAt + sessionTtlMs, revoked: false });
      } catch { throw unavailable(); }
      return { user: userProjection(account), csrfToken, cookie: cookie(token, Math.max(1, Math.floor(sessionTtlMs / 1000))) };
    },

    async authenticate(request) {
      const sessionId = digest(sessionToken(request));
      const target = await journal(`cms/v1/sessions/${sessionId}`);
      const state = await read(target);
      if (state.value === null) throw required();
      const value = sessionValue(state.value);
      const at = clock();
      const account = accounts.find(user => user.id === value.userId);
      if (value.revoked || value.createdAt > at || value.expiresAt <= at
        || value.expiresAt - value.createdAt > sessionTtlMs || !account
        || !equalToken(value.credentialFingerprint, credentialFingerprint(account))) throw required();
      const result = Object.freeze({ user: userProjection(account), csrfToken: value.csrfToken, sessionId });
      authenticationProofs.set(result, { sessionId, userId: account.id,
        credentialFingerprint: value.credentialFingerprint, csrfToken: value.csrfToken });
      return result;
    },

    async logout(session) {
      const proof = session && typeof session === 'object' ? authenticationProofs.get(session) : undefined;
      if (!proof) throw required();
      const target = await journal(`cms/v1/sessions/${proof.sessionId}`);
      for (let attempt = 0; attempt < MAX_CONFLICT_RETRIES; attempt++) {
        const state = await read(target);
        if (state.value === null) throw required();
        const value = sessionValue(state.value);
        if (value.userId !== proof.userId || !equalToken(value.credentialFingerprint, proof.credentialFingerprint)
          || !equalToken(value.csrfToken, proof.csrfToken)) throw unavailable();
        if (value.revoked) return { cookie: cookie('', 0) };
        const at = clock();
        if (at < value.createdAt) throw unavailable();
        try {
          await commit(target, state.cursor, { ...value, revoked: true, revokedAt: at });
          return { cookie: cookie('', 0) };
        } catch (error) {
          if (!conflict(error)) throw error;
        }
      }
      throw unavailable();
    },
  };
}
