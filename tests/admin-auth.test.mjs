import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, parseAdminUsers, findAdminUser, publicUser } from '../functions/content-api/auth.mjs';
import { createContentApi } from '../functions/content-api/handler.mjs';

const PASSWORD = 'synthetic-staff-test-password';
const passwordHash = await hashPassword(PASSWORD);
const ORIGIN = 'http://127.0.0.1:8787';
const account = { id: 'synthetic-staff', username: 'Team.Editor', email: 'Synthetic.Editor+ops@artdico.co', label: '合成工作人员', roles: ['editor'], passwordHash };
function api(options = {}) { return createContentApi({ users: [account], allowedOrigin: ORIGIN, ...options }); }
function request(handle, path, { method = 'GET', payload, cookie, csrf, origin = ORIGIN, headers = {} } = {}) {
  return handle(new Request(ORIGIN + path, { method, headers: { origin, ...(payload === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}), ...headers }, body: payload === undefined ? undefined : JSON.stringify(payload) }));
}
function login(handle, username, password = PASSWORD) { return request(handle, '/api/admin/login', { method: 'POST', payload: { username, password } }); }

test('optional email and username normalize independently while legacy accounts and server roles remain compatible', () => {
  const source = { ...account, username: '  Team.Editor  ', email: ' SYNTHETIC.EDITOR+OPS@ARTDICO.CO ' };
  const [user] = parseAdminUsers(JSON.stringify([source]));
  assert.equal(user.username, 'team.editor');
  assert.equal(user.email, 'synthetic.editor+ops@artdico.co');
  assert.equal(user.id, account.id);
  assert.equal(user.passwordHash, passwordHash);
  assert.deepEqual(user.roles, ['editor']);
  const legacy = { ...account }; delete legacy.email;
  const [oldUser] = parseAdminUsers([legacy]);
  assert.equal(Object.hasOwn(oldUser, 'email'), false);
  assert.equal(findAdminUser([oldUser], ' TEAM.EDITOR '), oldUser);
  assert.equal(findAdminUser([oldUser], account.email), null);
  assert.equal(source.username, '  Team.Editor  ');
  assert.deepEqual(publicUser(user), { id: account.id, label: account.label, roles: ['editor'] });
});

test('staff configuration rejects duplicate normalized identifiers and ambiguous or invalid mailbox syntax', () => {
  const second = { ...account, id: 'synthetic-second', username: 'second', email: 'second@artdico.co' };
  assert.throws(() => parseAdminUsers([account, { ...second, username: ' TEAM.EDITOR ' }]), /无效/u);
  assert.throws(() => parseAdminUsers([account, { ...second, email: ' SYNTHETIC.EDITOR+OPS@ARTDICO.CO ' }]), /无效/u);
  for (const email of ['staff@example.invalid', 'staff@artdico.com', 'staff@sub.artdico.co', 'staff@artdico.co.attacker.invalid', 'staff@artdico.co.', 'staff@@artdico.co', 'Name <staff@artdico.co>', 'one@artdico.co,two@artdico.co', 'one@artdico.co;two@artdico.co', 'staff\r\n@artdico.co', '工作人员@artdico.co', '.staff@artdico.co', 'staff.@artdico.co', 'staff..team@artdico.co', 'x'.repeat(65) + '@artdico.co', null, undefined, true, 123, [], {}]) {
    assert.throws(() => parseAdminUsers([{ ...account, email }]), /无效/u);
  }
  for (const username of [null, undefined, true, 123, [], {}, 'staff@artdico.co', 'x'.repeat(81)]) assert.throws(() => parseAdminUsers([{ ...account, username }]), /无效/u);
  assert.throws(() => parseAdminUsers([{ ...account, roles: new Array(1) }]), /无效/u);
  assert.throws(() => parseAdminUsers(new Array(1)), /无效/u);
});

test('lookup cannot coerce malformed values, infer email aliases, or choose among ambiguous matches', () => {
  const users = parseAdminUsers([account]);
  assert.equal(findAdminUser(users, ' TEAM.EDITOR '), users[0]);
  assert.equal(findAdminUser(users, ' SYNTHETIC.EDITOR+OPS@ARTDICO.CO '), users[0]);
  for (const identifier of [null, undefined, true, 123, [], { toString() { assert.fail('Identifier must not be coerced'); } }, 'x'.repeat(255), 'unconfigured@artdico.co', 'synthetic.editor@artdico.co', 'team.editor@artdico.co', 'SYNTHETIC.EDITOR+OPS@example.invalid']) assert.equal(findAdminUser(users, identifier), null);
  assert.equal(findAdminUser([users[0], { ...users[0], id: 'ambiguous-staff' }], users[0].username), null);
  assert.equal(findAdminUser([users[0], { ...users[0], id: 'ambiguous-staff', username: 'other' }], users[0].email), null);
});

test('configured username and email authenticate the same staff identity, password and least-privilege session', async () => {
  const handle = api();
  const identities = [];
  for (const identifier of [' TEAM.EDITOR ', ' SYNTHETIC.EDITOR+OPS@ARTDICO.CO ']) {
    const response = await login(handle, identifier);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    identities.push(body.user);
    assert.deepEqual(Object.keys(body.user), ['id', 'label', 'roles']);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes(passwordHash), false);
    assert.equal(serialized.includes(account.email.toLowerCase()), false);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/u);
    const session = await request(handle, '/api/admin/session', { cookie });
    assert.deepEqual((await session.json()).user, body.user);
    const deniedRole = await request(handle, '/api/admin/content/publish', { method: 'POST', payload: { expectedRevision: 0 }, cookie, csrf: body.csrfToken });
    assert.equal(deniedRole.status, 403);
    assert.equal((await deniedRole.json()).error.code, 'FORBIDDEN');
    assert.equal((await request(handle, '/api/admin/contacts', { cookie })).status, 403);
    const badCsrf = await request(handle, '/api/admin/logout', { method: 'POST', cookie, csrf: 'wrong' });
    assert.equal(badCsrf.status, 403);
    assert.equal((await badCsrf.json()).error.code, 'CSRF_REJECTED');
    assert.equal((await request(handle, '/api/admin/logout', { method: 'POST', cookie, csrf: body.csrfToken })).status, 200);
    assert.equal((await request(handle, '/api/admin/session', { cookie })).status, 401);
  }
  assert.deepEqual(identities[0], identities[1]);
});

test('unknown staff, wrong domains, malformed identifiers and incorrect passwords share AUTH_FAILED without disclosures', async () => {
  const handle = api({ loginLimit: 100 });
  let expected;
  for (const [identifier, password] of [[account.username, 'wrong-password'], [account.email, 'wrong-password'], ['unknown', PASSWORD], ['unconfigured@artdico.co', PASSWORD], ['synthetic.editor+ops@example.invalid', PASSWORD], [null, PASSWORD], [[], PASSWORD], [{ username: account.username }, PASSWORD], ['x'.repeat(255), PASSWORD], [account.username, []], [account.email, {}], [account.username, 'x'.repeat(1025)]]) {
    const response = await login(handle, identifier, password);
    assert.equal(response.status, 401);
    assert.equal(response.headers.has('set-cookie'), false);
    const body = await response.json();
    expected ??= body;
    assert.deepEqual(body, expected);
    assert.equal(body.error.code, 'AUTH_FAILED');
    assert.equal(JSON.stringify(body).includes('artdico.co'), false);
    assert.equal(JSON.stringify(body).includes(passwordHash), false);
  }
});

test('username and email aliases share trusted-address rate limits and remain local-only', async () => {
  const handle = api({ loginLimit: 2 });
  assert.equal((await login(handle, account.username, 'wrong-password')).status, 401);
  assert.equal((await login(handle, account.email, 'wrong-password')).status, 401);
  const limited = await request(handle, '/api/admin/login', { method: 'POST', payload: { username: account.email, password: PASSWORD }, headers: { 'x-forwarded-for': '198.51.100.123' } });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error.code, 'LOGIN_RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.throws(() => api({ mode: 'production' }), /生产/u);
  assert.throws(() => api({ allowedOrigin: 'https://example.invalid' }), /本地/u);
});
