import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const HASH_PATTERN = /^scrypt\$16384\$8\$1\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/u;

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
  try { users = typeof value === 'string' ? JSON.parse(value) : structuredClone(value); }
  catch { throw new TypeError('ADMIN_USERS_JSON 必须是有效的账号 JSON 数组。'); }
  if (!Array.isArray(users) || !users.length || users.length > 20) throw new TypeError('须配置 1–20 个本地账号；没有默认账号。');
  const ids = new Set();
  const names = new Set();
  return users.map((user) => {
    if (!user || typeof user !== 'object' || Array.isArray(user)
      || !/^[A-Za-z0-9_-]{1,80}$/u.test(user.id ?? '')
      || !/^[A-Za-z0-9_.-]{1,80}$/u.test(user.username ?? '')
      || typeof user.label !== 'string' || !user.label.trim() || user.label.length > 120
      || !HASH_PATTERN.test(user.passwordHash ?? '') || 'password' in user
      || !Array.isArray(user.roles) || !user.roles.length
      || user.roles.some((role) => !['editor', 'publisher', 'outreach'].includes(role))
      || new Set(user.roles).size !== user.roles.length
      || ids.has(user.id) || names.has(user.username)) {
      throw new TypeError('本地账号的 ID、用户名、角色或 scrypt 摘要无效；不接受明文密码。');
    }
    ids.add(user.id);
    names.add(user.username);
    return Object.freeze({ id: user.id, username: user.username, label: user.label.trim(), roles: [...user.roles], passwordHash: user.passwordHash });
  });
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
