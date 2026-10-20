import { randomBytes } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { hashPassword, parseAdminUsers } from '../content-api/auth.mjs';
import { CloudContentError } from './errors.mjs';

const own = (value, key) => Object.getOwnPropertyDescriptor(value ?? {}, key)?.value;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code = 'USER_STORAGE_UNAVAILABLE', status = 503) => { throw new CloudContentError(code,
  status === 409 ? '账号目录已更新，请重载后再决定。' : status === 422 ? '账号资料无效，请核对用户名、邮箱、角色及密码。' : '账号目录暂不可用，请稍后重载。', status); };
const accountFields = ['id', 'username', 'email', 'label', 'roles', 'passwordHash'];
const account = value => Object.fromEntries(accountFields.filter(key => value[key] !== undefined).map(key => [key, value[key]]));

/** Protected bootstrap accounts cannot be replaced. All additional accounts use the shared private CAS journal. */
export function createCloudUserStore({ journal, bootstrapUsers, now = () => Date.now() } = {}) {
  const bootstrap = parseAdminUsers(bootstrapUsers);
  if (!journal || typeof journal.read !== 'function' || typeof journal.commit !== 'function' || typeof now !== 'function') throw new TypeError('账号目录储存未配置。');
  const protectedIds = new Set(bootstrap.map(user => user.id));
  async function read() {
    try {
      const state = await journal.read();
      const value = state.value ?? { schemaVersion: 1, revision: 0, users: [], audit: [] };
      if (!plain(value) || Object.keys(value).sort().join(',') !== 'audit,revision,schemaVersion,users' || value.schemaVersion !== 1
        || !Number.isSafeInteger(value.revision) || value.revision < 0 || !Array.isArray(value.users) || value.users.length + bootstrap.length > 20
        || !Array.isArray(value.audit) || value.audit.length !== value.revision || value.audit.length > 1000) fail();
      const ids = new Set();
      for (const user of value.users) {
        if (!plain(user) || Object.keys(user).some(key => ![...accountFields, 'active'].includes(key))
          || typeof user.active !== 'boolean' || protectedIds.has(user.id) || ids.has(user.id)) fail();
        ids.add(user.id);
      }
      parseAdminUsers([...bootstrap, ...value.users.map(account)]);
      for (const [index, entry] of value.audit.entries()) {
        if (!plain(entry) || Object.keys(entry).sort().join(',') !== 'action,actorId,at,revision,targetId' || entry.revision !== index + 1
          || !['create_user', 'update_user', 'deactivate_user'].includes(entry.action)
          || typeof entry.actorId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(entry.actorId) || !ids.has(entry.targetId)
          || typeof entry.at !== 'string' || !Number.isFinite(Date.parse(entry.at)) || new Date(entry.at).toISOString() !== entry.at
          || index && entry.at < value.audit[index - 1].at) fail();
      }
      return { value, cursor: state.cursor };
    } catch (error) { if (error instanceof CloudContentError) throw error; fail(); }
  }
  function projection(value) {
    const users = [...bootstrap.map(user => ({ ...user, active: true, protected: true })), ...value.users.map(user => ({ ...user, protected: false }))]
      .map(({ passwordHash: _, ...user }) => user);
    return { revision: value.revision, users };
  }
  return Object.freeze({
    async users() { const { value } = await read(); return parseAdminUsers([...bootstrap, ...value.users.filter(user => user.active).map(account)]); },
    async list() { return projection((await read()).value); },
    async save(input, actorId) {
      if (!plain(input) || Object.getOwnPropertySymbols(input).length || Object.keys(input).some(key => !['expectedRevision', 'id', 'username', 'email', 'label', 'roles', 'password', 'active'].includes(key)
        || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))
        || !Number.isSafeInteger(own(input, 'expectedRevision')) || !/^[A-Za-z0-9_-]{1,80}$/u.test(actorId)) fail('USER_INPUT_INVALID', 422);
      const state = await read(), previous = state.value;
      if (input.expectedRevision !== previous.revision) fail('REVISION_CONFLICT', 409);
      if (previous.audit.length >= 1000) fail('USER_CAPACITY_EXCEEDED');
      const id = own(input, 'id') ?? 'staff_' + randomBytes(12).toString('base64url');
      if (typeof id !== 'string' || protectedIds.has(id)) fail('PROTECTED_ACCOUNT', 422);
      const existing = previous.users.find(user => user.id === id);
      if (input.id !== undefined && !existing) fail('USER_NOT_FOUND', 422);
      const password = own(input, 'password');
      let passwordHash = existing?.passwordHash;
      if (password !== undefined && password !== '') {
        try { passwordHash = await hashPassword(password); } catch { fail('USER_INPUT_INVALID', 422); }
      }
      const active = own(input, 'active') ?? existing?.active ?? true;
      if (typeof active !== 'boolean') fail('USER_INPUT_INVALID', 422);
      let candidate;
      try {
        candidate = parseAdminUsers([{ id, username: own(input, 'username') ?? existing?.username,
          ...(own(input, 'email') !== undefined ? { email: input.email } : existing?.email ? { email: existing.email } : {}),
          label: own(input, 'label') ?? existing?.label, roles: own(input, 'roles') ?? existing?.roles, passwordHash }])[0];
      } catch { fail('USER_INPUT_INVALID', 422); }
      const entry = { ...candidate, active };
      const users = existing ? previous.users.map(user => user.id === id ? entry : user) : [...previous.users, entry];
      try { parseAdminUsers([...bootstrap, ...users.map(account)]); } catch { fail('USER_INPUT_INVALID', 422); }
      let at;
      try { at = new Date(now()).toISOString(); } catch { fail(); }
      if (previous.audit.length && at < previous.audit.at(-1).at) fail();
      const next = { schemaVersion: 1, revision: previous.revision + 1, users,
        audit: [...previous.audit, { revision: previous.revision + 1, actorId, targetId: id, at,
          action: existing ? active ? 'update_user' : 'deactivate_user' : 'create_user' }] };
      try {
        const ack = await journal.commit(state.cursor, next);
        if (!isDeepStrictEqual(ack.value, next)) fail();
      } catch (error) {
        if (error instanceof CloudContentError && error.code === 'WRITE_CONFLICT') fail('REVISION_CONFLICT', 409);
        fail();
      }
      return projection(next);
    },
  });
}
