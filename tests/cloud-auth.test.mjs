import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudAuth, CLOUD_SESSION_COOKIE } from '../functions/cloud-content/auth.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';

const PASSWORD = 'synthetic staff password only';
const PASSWORD_HASH = await hashPassword(PASSWORD);
const OTHER_HASH = await hashPassword('different synthetic password only');
const sha = value => createHash('sha256').update(value).digest('hex');
const account = (overrides = {}) => ({ id: 'synthetic_editor', username: 'synthetic-editor',
  email: 'synthetic-editor@artdico.co', label: '合成工作人员', roles: ['editor', 'publisher'], passwordHash: PASSWORD_HASH, ...overrides });
const secondary = () => account({ id: 'synthetic_other', username: 'synthetic-other', email: 'synthetic-other@artdico.co', roles: ['publisher'] });
const request = value => new Request('https://api.artdico.host/api/admin/session', { headers: value ? { cookie: value } : {} });
const cookiePair = result => result.cookie.split(';')[0];
const token = result => cookiePair(result).slice(CLOUD_SESSION_COOKIE.length + 1);
const errorIs = (code, status) => error => error instanceof CloudContentError && error.code === code && error.status === status;

function journals({ beforeRead, beforeCommit } = {}) {
  const entries = new Map();
  const calls = { reads: [], writes: [] };
  const journalFor = prefix => ({
    async read() {
      calls.reads.push(prefix);
      await beforeRead?.(prefix);
      const state = entries.get(prefix);
      return state ? structuredClone(state) : { value: null, cursor: { position: 0, version: 0, hash: null } };
    },
    async commit(cursor, value) {
      calls.writes.push({ prefix, cursor: structuredClone(cursor), value: structuredClone(value) });
      await beforeCommit?.(prefix, cursor, value);
      const actual = entries.get(prefix)?.cursor ?? { position: 0, version: 0, hash: null };
      if (JSON.stringify(cursor) !== JSON.stringify(actual)) throw new CloudContentError('WRITE_CONFLICT', '合成共享储存冲突。', 409);
      const serial = JSON.stringify(value);
      const state = { value: structuredClone(value), cursor: { position: actual.position + Buffer.byteLength(serial), version: actual.version + 1, hash: sha(serial) } };
      entries.set(prefix, state);
      return structuredClone(state);
    },
  });
  return { journalFor, entries, calls };
}

test('configured username and company email issue distinct host-only secure sessions with the same minimal user', async () => {
  const shared = journals();
  const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  const first = await auth.login({ identifier: '  SYNTHETIC-EDITOR ', password: PASSWORD });
  const second = await auth.login({ identifier: 'SYNTHETIC-EDITOR@ARTDICO.CO', password: PASSWORD });
  assert.deepEqual(first.user, { id: 'synthetic_editor', label: '合成工作人员', roles: ['editor', 'publisher'] });
  assert.deepEqual(second.user, first.user);
  assert.notEqual(first.csrfToken, second.csrfToken);
  assert.notEqual(token(first), token(second));
  assert.match(first.csrfToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(first.cookie, new RegExp(`^${CLOUD_SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=28800$`, 'u'));
  assert.doesNotMatch(first.cookie, /Domain=/iu);
  const privateState = JSON.stringify([...shared.entries]);
  for (const secret of [PASSWORD, PASSWORD_HASH, token(first), token(second), account().email, account().username]) assert.equal(privateState.includes(secret), false);
  for (const result of [first, second]) {
    assert.equal(JSON.stringify(result.user).includes(PASSWORD_HASH), false);
    assert.deepEqual(Object.keys(result.user).sort(), ['id', 'label', 'roles']);
  }
});

test('a separate auth instance authenticates a persisted session and observes logout immediately', async () => {
  const shared = journals();
  const a = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  const login = await a.login({ identifier: account().username, password: PASSWORD });
  const b = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  const session = await b.authenticate(request(cookiePair(login)));
  assert.deepEqual(session.user, login.user);
  assert.equal(session.csrfToken, login.csrfToken);
  assert.equal(session.sessionId, sha(token(login)));
  const loggedOut = await b.logout(session);
  assert.equal(loggedOut.cookie, `${CLOUD_SESSION_COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  await assert.rejects(a.authenticate(request(cookiePair(login))), errorIs('AUTH_REQUIRED', 401));
  assert.deepEqual(await b.logout(session), loggedOut);
  assert.equal([...shared.entries].find(([key]) => key.startsWith('cms/v1/sessions/'))[1].value.revoked, true);
});

test('username and email consume the same shared global budget across instances before password verification', async () => {
  let time = 2_000_000;
  const shared = journals();
  const options = { users: [account()], journalFor: shared.journalFor, now: () => time };
  const a = createCloudAuth(options), b = createCloudAuth(options);
  for (let index = 0; index < 10; index++) {
    const auth = index % 2 ? a : b;
    await assert.rejects(auth.login({ identifier: index % 2 ? account().email : account().username, password: 'wrong synthetic password' }), errorIs('AUTH_FAILED', 401));
  }
  await assert.rejects(a.login({ identifier: account().email, password: PASSWORD }), error => errorIs('LOGIN_RATE_LIMITED', 429)(error) && error.retryAfter > 0);
  assert.equal([...shared.entries].filter(([key]) => key.includes('/limits/')).length, 1);
  assert.deepEqual([...shared.entries.values()].map(entry => entry.value.count), [10]);
  time += 15 * 60 * 1000;
  assert.equal((await b.login({ identifier: account().username, password: PASSWORD })).user.id, account().id);
});

test('concurrent auth instances cannot overspend one shared allowance or use a process-local fallback', async () => {
  let competing = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const shared = journals({ beforeCommit: async (prefix, cursor) => {
    if (prefix.endsWith(`/${sha('global')}`) && cursor.version === 0) {
      competing++;
      if (competing === 2) release();
      await gate;
    }
  } });
  const options = { users: [account()], journalFor: shared.journalFor, loginLimit: 1, now: () => 123_456 };
  const a = createCloudAuth(options), b = createCloudAuth(options);
  const outcomes = await Promise.allSettled([a.login({ identifier: account().username, password: 'incorrect' }), b.login({ identifier: account().email, password: 'incorrect' })]);
  assert.deepEqual(outcomes.map(result => result.reason.code).sort(), ['AUTH_FAILED', 'LOGIN_RATE_LIMITED']);
  const budgets = [...shared.entries.values()].map(entry => entry.value.count).sort((x, y) => x - y);
  assert.deepEqual(budgets, [1]);
  assert.equal(shared.calls.writes.length, 2, 'the race must exercise one CAS conflict');
});

test('global login reservations cap attempts across all accounts and unknown identities with one bounded scope', async () => {
  const shared = journals();
  const auth = createCloudAuth({ users: [account(), secondary()], journalFor: shared.journalFor, globalLoginLimit: 3 });
  for (const identifier of [account().username, secondary().email, 'unknown-one@artdico.co']) await assert.rejects(auth.login({ identifier, password: 'wrong password' }), errorIs('AUTH_FAILED', 401));
  await assert.rejects(auth.login({ identifier: 'unknown-two@artdico.co', password: PASSWORD }), errorIs('LOGIN_RATE_LIMITED', 429));
  assert.equal([...shared.entries].filter(([key]) => key.includes('/limits/')).length, 1);
  const unknown = journals();
  const another = createCloudAuth({ users: [account()], journalFor: unknown.journalFor, loginLimit: 2 });
  for (const identifier of ['unknown-a', 'unknown-b@artdico.co']) await assert.rejects(another.login({ identifier, password: PASSWORD }), errorIs('AUTH_FAILED', 401));
  await assert.rejects(another.login({ identifier: 'unknown-c', password: PASSWORD }), errorIs('LOGIN_RATE_LIMITED', 429));
  assert.equal(unknown.entries.size, 1);
});

test('exhausting unknown or known names cannot enumerate account existence through status or storage paths', async () => {
  for (const exhaustWithUnknown of [true, false]) {
    const shared = journals();
    const options = { users: [account(), secondary()], journalFor: shared.journalFor, now: () => 3_000_000 };
    const a = createCloudAuth(options), b = createCloudAuth(options);
    for (let index = 0; index < 10; index++) await assert.rejects(a.login({
      identifier: exhaustWithUnknown ? `unknown-${index}@artdico.co` : account().username,
      password: 'wrong synthetic password',
    }), errorIs('AUTH_FAILED', 401));
    const failures = [];
    for (const identifier of [account().username, account().email, secondary().username, 'another-unknown', 'wrong@example.com', {}]) {
      const readsBefore = shared.calls.reads.length, writesBefore = shared.calls.writes.length;
      await assert.rejects(b.login({ identifier, password: PASSWORD }), error => {
        failures.push({ code: error.code, message: error.message, status: error.status, retryAfter: error.retryAfter });
        return errorIs('LOGIN_RATE_LIMITED', 429)(error);
      });
      assert.equal(shared.calls.reads.length, readsBefore + 1);
      assert.equal(shared.calls.writes.length, writesBefore);
    }
    assert.ok(failures.every(value => JSON.stringify(value) === JSON.stringify(failures[0])));
    assert.equal(new Set(shared.calls.reads).size, 1);
    assert.equal(shared.entries.size, 1);
    assert.equal([...shared.entries.values()][0].value.count, 10);
  }
});

test('unknown, wrong-domain, malformed and bad-password inputs share AUTH_FAILED without disclosures', async () => {
  for (const input of [
    { identifier: 'not-configured', password: PASSWORD },
    { identifier: 'synthetic-editor@example.com', password: PASSWORD },
    { identifier: { toString() { throw new Error('must not coerce'); } }, password: PASSWORD },
    { identifier: account().username, password: 123 },
    { identifier: account().username, password: 'a'.repeat(1025) },
    { identifier: account().email, password: 'wrong synthetic password' },
    { identifier: null, password: PASSWORD },
  ]) {
    const shared = journals();
    const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
    await assert.rejects(auth.login(input), error => {
      assert.equal(error.code, 'AUTH_FAILED'); assert.equal(error.status, 401);
      assert.equal(error.message, '账号或密码不正确。');
      assert.equal(error.message.includes(PASSWORD), false);
      return true;
    });
    assert.equal(shared.entries.size, 1, 'a global reservation must occur for every invalid login');
    assert.equal([...shared.entries].some(([key]) => key.includes('/sessions/')), false);
  }
});

test('current account removal, password, roles, email and identifier changes invalidate old sessions', async () => {
  const shared = journals();
  const auth = createCloudAuth({ users: [account(), secondary()], journalFor: shared.journalFor });
  const login = await auth.login({ identifier: account().username, password: PASSWORD });
  for (const users of [
    [secondary()],
    [account({ passwordHash: OTHER_HASH })],
    [account({ roles: ['publisher'] })],
    [account({ email: 'changed-synthetic@artdico.co' })],
    [account({ username: 'changed-synthetic' })],
  ]) {
    const next = createCloudAuth({ users, journalFor: shared.journalFor });
    await assert.rejects(next.authenticate(request(cookiePair(login))), errorIs('AUTH_REQUIRED', 401));
  }
  const unchanged = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  assert.deepEqual((await unchanged.authenticate(request(cookiePair(login)))).user.roles, ['editor', 'publisher']);
  assert.equal(shared.entries.size, 2, 'configuration changes cannot rewrite session state');
});

test('expired, future and duplicate or malformed cookies never authenticate and forged logout proofs fail', async () => {
  let time = 10_000;
  const shared = journals();
  const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor, now: () => time, sessionTtlMs: 1000 });
  const login = await auth.login({ identifier: account().username, password: PASSWORD });
  const valid = request(cookiePair(login));
  const session = await auth.authenticate(valid);
  await assert.rejects(auth.logout({ ...session }), errorIs('AUTH_REQUIRED', 401));
  for (const header of ['', `${cookiePair(login)}; ${cookiePair(login)}`, `${CLOUD_SESSION_COOKIE}=invalid`, `${CLOUD_SESSION_COOKIE}=${'a'.repeat(44)}`, `${CLOUD_SESSION_COOKIE}=${'!'.repeat(43)}`]) await assert.rejects(auth.authenticate(request(header)), errorIs('AUTH_REQUIRED', 401));
  time = 9999;
  await assert.rejects(auth.authenticate(valid), errorIs('AUTH_REQUIRED', 401));
  time = 11_000;
  await assert.rejects(auth.authenticate(valid), errorIs('AUTH_REQUIRED', 401));
  assert.equal(shared.entries.size, 2);
});

test('stored session corruption fails closed without reset, storage details, cookie or new session', async () => {
  const shared = journals();
  const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  const login = await auth.login({ identifier: account().username, password: PASSWORD });
  const key = `cms/v1/sessions/${sha(token(login))}`;
  const original = shared.entries.get(key);
  for (const value of [
    {}, { ...original.value, csrfToken: 'broken' }, { ...original.value, revoked: 'no' },
    { ...original.value, credentialFingerprint: PASSWORD_HASH },
    { ...original.value, expiresAt: original.value.createdAt },
    { ...original.value, revokedAt: 1 }, { ...original.value, arbitrary: 'untrusted server detail' },
  ]) {
    shared.entries.set(key, { ...original, value });
    const writes = shared.calls.writes.length;
    await assert.rejects(auth.authenticate(request(cookiePair(login))), error => errorIs('AUTH_STORAGE_UNAVAILABLE', 503)(error) && !error.message.includes('detail'));
    assert.equal(shared.calls.writes.length, writes);
  }
});

test('reservation, login-session and logout failures remain opaque and never retry unknown commits', async () => {
  for (const stage of ['reservation', 'session']) {
    let calls = 0;
    const shared = journals({ beforeCommit: prefix => {
      if (stage === 'reservation' || prefix.includes('/sessions/')) { calls++; throw new Error('untrusted token and provider body'); }
    } });
    const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
    await assert.rejects(auth.login({ identifier: account().username, password: PASSWORD }), error => errorIs('AUTH_STORAGE_UNAVAILABLE', 503)(error) && !error.message.includes('provider'));
    assert.equal(calls, 1);
  }
  let failure = false, calls = 0;
  const shared = journals({ beforeCommit: prefix => { if (failure && prefix.includes('/sessions/')) { calls++; throw new Error('timeout after possible write'); } } });
  const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  const login = await auth.login({ identifier: account().username, password: PASSWORD });
  const session = await auth.authenticate(request(cookiePair(login)));
  failure = true;
  await assert.rejects(auth.logout(session), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  assert.equal(calls, 1);
  assert.equal(shared.entries.get(`cms/v1/sessions/${sha(token(login))}`).value.revoked, false);
});

test('only trusted explicit conflicts are boundedly retried and malformed budgets cannot be reset', async () => {
  let commits = 0;
  const conflictState = journals({ beforeCommit: () => { commits++; throw new CloudContentError('WRITE_CONFLICT', 'synthetic conflict', 409); } });
  const auth = createCloudAuth({ users: [account()], journalFor: conflictState.journalFor });
  await assert.rejects(auth.login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  assert.equal(commits, 8);
  let untrusted = 0;
  const spoof = journals({ beforeCommit: () => { untrusted++; throw Object.assign(new Error('raw failure'), { code: 'WRITE_CONFLICT', status: 409 }); } });
  await assert.rejects(createCloudAuth({ users: [account()], journalFor: spoof.journalFor }).login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  assert.equal(untrusted, 1);
  const shared = journals();
  const setup = createCloudAuth({ users: [account()], journalFor: shared.journalFor });
  await assert.rejects(setup.login({ identifier: account().username, password: 'incorrect' }), errorIs('AUTH_FAILED', 401));
  const [key, original] = [...shared.entries].find(([, state]) => state.value.kind === 'login_budget');
  shared.entries.set(key, { ...original, value: { ...original.value, count: 'reset-me' } });
  const before = shared.calls.writes.length;
  await assert.rejects(setup.login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  assert.equal(shared.calls.writes.length, before);
});

test('missing or foreign commit acknowledgements cannot report login or logout success', async () => {
  for (const badAck of [undefined, null, {}, { value: {}, cursor: { version: 1, position: 123, hash: 'a'.repeat(64) } }]) {
    let writes = 0;
    const auth = createCloudAuth({ users: [account()], journalFor: () => ({
      read: async () => ({ value: null, cursor: { version: 0, position: 0, hash: null } }),
      commit: async () => { writes++; return badAck; },
    }) });
    await assert.rejects(auth.login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
    assert.equal(writes, 1);
  }
  const shared = journals();
  let missingAck = false;
  const journalFor = prefix => {
    const real = shared.journalFor(prefix);
    return { read: real.read, commit: async (cursor, value) => { const result = await real.commit(cursor, value); return missingAck && prefix.includes('/sessions/') ? undefined : result; } };
  };
  const auth = createCloudAuth({ users: [account()], journalFor });
  const login = await auth.login({ identifier: account().username, password: PASSWORD });
  const session = await auth.authenticate(request(cookiePair(login)));
  missingAck = true;
  await assert.rejects(auth.logout(session), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  await assert.rejects(auth.authenticate(request(cookiePair(login))), errorIs('AUTH_REQUIRED', 401));
});

test('nonempty cursors with null values are corrupt rather than new login or session state', async () => {
  let writes = 0;
  const broken = () => ({ read: async () => ({ value: null, cursor: { position: 123, version: 1, hash: 'b'.repeat(64) } }), commit: async () => { writes++; } });
  const auth = createCloudAuth({ users: [account()], journalFor: broken });
  await assert.rejects(auth.login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  const syntheticToken = Buffer.alloc(32, 8).toString('base64url');
  await assert.rejects(auth.authenticate(request(`${CLOUD_SESSION_COOKIE}=${syntheticToken}`)), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  assert.equal(writes, 0);
});

test('invalid configuration and clock failures cannot create storage or leak input', async () => {
  const shared = journals();
  for (const users of [[account({ disabled: true })], [account({ password: PASSWORD })], [account({ unsupported: 'ignored' })], [], 'not-json']) {
    assert.throws(() => createCloudAuth({ users, journalFor: shared.journalFor }), error => error instanceof TypeError && !error.message.includes(PASSWORD));
  }
  for (const options of [{ sessionTtlMs: 0 }, { sessionTtlMs: Infinity }, { loginLimit: 0 }, { loginLimit: 61 }, { globalLoginLimit: 61 }, { loginWindowMs: -1 }, { journalFor: null }]) assert.throws(() => createCloudAuth({ users: [account()], journalFor: shared.journalFor, ...options }), TypeError);
  for (const now of [() => NaN, () => -1, () => Number.MAX_SAFE_INTEGER, () => { throw new Error('raw clock'); }]) {
    const auth = createCloudAuth({ users: [account()], journalFor: shared.journalFor, now });
    await assert.rejects(auth.login({ identifier: account().username, password: PASSWORD }), errorIs('AUTH_STORAGE_UNAVAILABLE', 503));
  }
  assert.equal(shared.entries.size, 0);
});
