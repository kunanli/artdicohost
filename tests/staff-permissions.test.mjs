import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLABORATOR_ROLES, canManageAccounts, canManageEventOperations, canRecoverSystem } from '../shared/staff-permissions.mjs';
import { createCloudUserApi } from '../functions/cloud-content/user-handler.mjs';
import { createMaintenanceApi } from '../functions/registration-admin/maintenance-handler.mjs';

test('only the complete four independent roles add event operations; account and recovery authority remain separate', () => {
  assert.equal(Object.isFrozen(COLLABORATOR_ROLES), true);
  for (let mask = 0; mask < 16; mask++) {
    const user = { roles: COLLABORATOR_ROLES.filter((_, index) => mask & 1 << index) };
    assert.equal(canManageEventOperations(user), mask === 15);
    assert.equal(canManageAccounts(user), false); assert.equal(canRecoverSystem(user), false);
  }
  for (const roles of [['superadmin'], [...COLLABORATOR_ROLES, 'superadmin']]) {
    const user = { roles }; assert.equal(canManageEventOperations(user), true);
    assert.equal(canManageAccounts(user), true); assert.equal(canRecoverSystem(user), true);
  }
});

test('malformed or inherited role claims and getters never confer capabilities', () => {
  const getter = () => assert.fail('Role accessors must not run');
  const accessor = Object.defineProperty({}, 'roles', { get: getter });
  const entries = [...COLLABORATOR_ROLES]; Object.defineProperty(entries, '0', { get: getter });
  for (const user of [null, {}, [], { roles: 'superadmin' }, { roles: ['superadmin', 'superadmin'] },
    { roles: [...COLLABORATOR_ROLES, 'unknown'] }, Object.create({ roles: ['superadmin'] }), accessor, { roles: entries }]) {
    assert.equal(canManageEventOperations(user), false); assert.equal(canManageAccounts(user), false); assert.equal(canRecoverSystem(user), false);
  }
});

test('full event collaborators cannot read or write accounts, export backups or restore even with valid Origin and CSRF', async () => {
  let privateCalls = 0;
  const privateIo = async () => { privateCalls++; assert.fail('Private recovery/account I/O must follow its own admin gate'); };
  const auth = { authenticate: async () => ({ user: { id: 'synthetic-collaborator', roles: [...COLLABORATOR_ROLES] }, csrfToken: 'synthetic-csrf' }) };
  const users = createCloudUserApi({ enabled: true, auth, store: { list: privateIo, save: privateIo } });
  const maintenance = createMaintenanceApi({ enabled: true, auth, objects: { get: privateIo, putImmutable: privateIo, append: privateIo },
    journalPrefixes: ['cms/v1/content'], audit: { record: privateIo, readSafe: privateIo } });
  for (const [path, method, handler] of [['/api/admin/users', 'GET', users], ['/api/admin/users', 'POST', users],
    ['/api/admin/maintenance', 'GET', maintenance], ['/api/admin/maintenance/backup', 'POST', maintenance], ['/api/admin/maintenance/restore', 'POST', maintenance]]) {
    const request = new Request('https://api.artdico.host' + path, { method,
      headers: { Origin: 'https://api.artdico.host', 'X-CSRF-Token': 'synthetic-csrf', 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ roles: ['superadmin'], expectedRevision: 0 }) } : {}) });
    const response = await handler(request); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'FORBIDDEN');
  }
  assert.equal(privateCalls, 0);
});
