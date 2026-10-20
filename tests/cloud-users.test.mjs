import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCloudUserStore } from '../functions/cloud-content/user-store.mjs';
import { createCloudUserApi } from '../functions/cloud-content/user-handler.mjs';
import { createCloudAuth } from '../functions/cloud-content/auth.mjs';
import { CloudContentError } from '../functions/cloud-content/errors.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';

const PASSWORD = 'synthetic directory password only';
const bootstrap = [{ id: 'synthetic_owner', username: 'synthetic-owner', label: '合成管理员', roles: ['superadmin'], passwordHash: await hashPassword(PASSWORD) }];
function journals() {
  const values = new Map();
  const journalFor = prefix => ({
    async read() { return structuredClone(values.get(prefix) ?? { value: null, cursor: { position: 0, version: 0, hash: null } }); },
    async commit(cursor, value) {
      const previous = values.get(prefix)?.cursor ?? { position: 0, version: 0, hash: null };
      if (JSON.stringify(cursor) !== JSON.stringify(previous)) throw new CloudContentError('WRITE_CONFLICT', '合成冲突', 409);
      const serial = JSON.stringify(value);
      const next = { value, cursor: { position: previous.position + Buffer.byteLength(serial), version: previous.version + 1, hash: createHash('sha256').update(serial).digest('hex') } };
      values.set(prefix, structuredClone(next));
      return structuredClone(next);
    },
  });
  return { journalFor, values };
}
function fixture() {
  const shared = journals();
  const factory = () => createCloudUserStore({ journal: shared.journalFor('cms/v1/users'), bootstrapUsers: bootstrap });
  return { ...shared, factory, store: factory() };
}
const input = (patch = {}) => ({ expectedRevision: 0, username: 'synthetic-reviewer', email: 'synthetic-reviewer@artdico.co',
  label: '合成审核人员', roles: ['reviewer'], password: PASSWORD, ...patch });

test('private staff directory never returns hashes, prevents bootstrap replacement and refuses duplicate identities', async () => {
  const f = fixture();
  const saved = await f.store.save(input(), 'synthetic_owner');
  assert.equal(saved.revision, 1);
  assert.equal(saved.users[0].protected, true);
  assert.equal(JSON.stringify(saved).includes('scrypt$'), false);
  assert.equal(JSON.stringify([...f.values]).includes(PASSWORD), false);
  assert.deepEqual((await f.factory().users())[1].roles, ['reviewer']);
  await assert.rejects(f.store.save(input({ expectedRevision: 1, username: 'synthetic-owner', email: undefined }), 'synthetic_owner'), error => error.status === 422);
  await assert.rejects(f.store.save(input({ expectedRevision: 1, id: bootstrap[0].id }), 'synthetic_owner'), error => error.code === 'PROTECTED_ACCOUNT');
});

test('two directory clients compete on revisions and deactivation or role changes revoke sessions in existing auth instances', async () => {
  const f = fixture();
  const first = await f.store.save(input(), 'synthetic_owner');
  const id = first.users.find(user => !user.protected).id;
  const auth = createCloudAuth({ users: bootstrap, usersProvider: () => f.store.users(), journalFor: f.journalFor });
  const loggedIn = await auth.login({ identifier: 'synthetic-reviewer', password: PASSWORD });
  const request = new Request('https://api.artdico.host/api/admin/session', { headers: { cookie: loggedIn.cookie.split(';')[0] } });
  assert.deepEqual((await auth.authenticate(request)).user.roles, ['reviewer']);
  const results = await Promise.allSettled([
    f.store.save({ expectedRevision: 1, id, roles: ['editor'] }, 'synthetic_owner'),
    f.factory().save({ expectedRevision: 1, id, active: false }, 'synthetic_owner'),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  await assert.rejects(auth.authenticate(request), error => error.code === 'AUTH_REQUIRED');
  const current = await f.store.list();
  await f.store.save({ expectedRevision: current.revision, id, active: false }, 'synthetic_owner');
  await assert.rejects(auth.login({ identifier: 'synthetic-reviewer@artdico.co', password: PASSWORD }), error => error.code === 'AUTH_FAILED');
});

test('directory storage errors deny login rather than using a stale account cache', async () => {
  const f = fixture();
  const auth = createCloudAuth({ users: bootstrap, usersProvider: async () => { throw new Error('PRIVATE-SYNTHETIC'); }, journalFor: f.journalFor });
  await assert.rejects(auth.login({ identifier: bootstrap[0].username, password: PASSWORD }), error => error.code === 'AUTH_STORAGE_UNAVAILABLE' && !error.message.includes('PRIVATE'));
});

test('user API requires superadmin, exact Origin and CSRF and hides malformed body or provider details', async () => {
  const f = fixture();
  const session = { user: { id: 'synthetic_owner', roles: ['superadmin'] }, csrfToken: 'synthetic-csrf' };
  const handler = createCloudUserApi({ enabled: true, auth: { async authenticate() { return session; } }, store: f.store });
  const make = (body, headers = {}) => new Request('https://api.artdico.host/api/admin/users', { method: 'POST', headers: { origin: 'https://api.artdico.host', 'x-csrf-token': 'synthetic-csrf', 'content-type': 'application/json', ...headers }, body });
  assert.equal((await handler(make(JSON.stringify(input()), { 'x-csrf-token': 'wrong' }))).status, 403);
  assert.equal((await handler(make('{'))).status, 422);
  assert.equal((await handler(make('x'.repeat(17 * 1024)))).status, 413);
  session.user.roles = ['editor'];
  assert.equal((await handler(new Request('https://api.artdico.host/api/admin/users'))).status, 403);
  session.user.roles = ['superadmin'];
  const saved = await handler(make(JSON.stringify(input())));
  assert.equal(saved.status, 200);
  assert.equal((await saved.text()).includes('scrypt$'), false);
});
