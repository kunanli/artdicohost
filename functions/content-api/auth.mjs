import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HASH_PATTERN = /^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/u;
const USERNAME_PATTERN = /^[a-z0-9_.-]{1,80}$/u;
const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@artdico\.co$/u;

function identifierText(value) {
  return typeof value === 'string' && value.length <= 254 ? value.trim().toLowerCase() : null;
}
function usernameValue(value) {
  const text = identifierText(value);
  return text !== null && USERNAME_PATTERN.test(text) ? text : null;
}
function emailValue(value) {
  const text = identifierText(value);
  return text !== null && EMAIL_PATTERN.test(text) && text.split('@')[0].length <= 64 ? text : null;
}
function own(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || Buffer.byteLength(password) < 12 || Buffer.byteLength(password) > 1024) {
    throw new TypeError('本地密码须为 12–1024 字节。');
  }
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.match(HASH_PATTERN) : null;
  if (!parts || typeof password !== 'string' || Buffer.byteLength(password) > 1024) return false;
  const expected = Buffer.from(parts[2], 'base64url');
  const actual = await scrypt(password, Buffer.from(parts[1], 'base64url'), 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function parseAdminUsers(value) {
  let users;
  try { users = typeof value === 'string' ? JSON.parse(value) : value; }
  catch { throw new TypeError('ADMIN_USERS_JSON 必须是有效的账号 JSON 数组。'); }
  if (!Array.isArray(users) || !users.length || users.length > 20) throw new TypeError('须配置 1–20 个本地账号；没有默认账号。');
  const ids = new Set();
  const names = new Set();
  const emails = new Set();
  return Array.from(users).map((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(user))) throw new TypeError('本地账号配置无效。');
    const id = own(user, 'id');
    const username = usernameValue(own(user, 'username'));
    const email = Object.hasOwn(user, 'email') ? emailValue(own(user, 'email')) : undefined;
    const label = own(user, 'label');
    const passwordHash = own(user, 'passwordHash');
    const roles = own(user, 'roles');
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/u.test(id) || username === null || email === null
      || typeof label !== 'string' || !label.trim() || label.length > 120
      || typeof passwordHash !== 'string' || !HASH_PATTERN.test(passwordHash) || 'password' in user
      || !Array.isArray(roles) || !roles.length
      || Array.from(roles).some((role) => !['editor', 'publisher', 'outreach', 'reviewer', 'superadmin'].includes(role))
      || new Set(roles).size !== roles.length
      || ids.has(id) || names.has(username) || email !== undefined && emails.has(email)) {
      throw new TypeError('本地账号的 ID、用户名、可选邮箱、角色或 scrypt 摘要无效；不接受明文密码。');
    }
    ids.add(id);
    names.add(username);
    if (email !== undefined) emails.add(email);
    return Object.freeze({ id, username, ...(email === undefined ? {} : { email }), label: label.trim(), roles: [...roles], passwordHash });
  });
}

/** Looks up only explicitly configured staff identities; an email domain grants no access. */
export function findAdminUser(users, identifier) {
  const normalized = usernameValue(identifier) ?? emailValue(identifier);
  if (normalized === null || !Array.isArray(users)) return null;
  const matches = users.filter(user => user && typeof user === 'object' && !Array.isArray(user)
    && (usernameValue(own(user, 'username')) === normalized || emailValue(own(user, 'email')) === normalized));
  return matches.length === 1 ? matches[0] : null;
}

export function publicUser(user) {
  return { id: user.id, label: user.label, roles: [...user.roles] };
}

export function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
