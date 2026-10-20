import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { configureCloudAdmin, requireCloudAdminSetupContext } from '../scripts/configure-cloud-admin.mjs';
import { createFcConfigClient } from '../scripts/fc-config-client.mjs';
import { parseAdminUsers, verifyPassword } from '../functions/content-api/auth.mjs';

const COMMIT = 'a'.repeat(40);
const PASSWORD = 'synthetic-owner-password-123';
const ENV = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_SHA: COMMIT,
  ARTDICO_CLOUD_ADMIN_SETUP_ENABLED: 'true', ARTDICO_FC_ACCOUNT_ID: '1954121651395178', FC_ACCESS_KEY_ID: 'SYNTHETICKEY', FC_ACCESS_KEY_SECRET: 'synthetic-deployment-secret',
  ARTDICO_ADMIN_PASSWORD: PASSWORD, ARTDICO_ADMIN_USERNAME: 'synthetic.owner', ARTDICO_ADMIN_EMAIL: 'synthetic.owner@artdico.co' };
const PRIVATE = 'PRIVATE-SYNTHETIC-EXISTING-CONFIGURATION';
const TRIGGER_URL = 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run';
function info() {
  return { functionName: 'artdicohost-api', functionArn: 'acs:fc:cn-hongkong:1954121651395178:functions/artdicohost-api', runtime: 'custom.debian11',
    customRuntimeConfig: { command: ['/code/bootstrap'], args: [], port: 9000 }, role: 'acs:ram::1954121651395178:role/artdicohost-content-runtime',
    environmentVariables: { SYNTHETIC_PRIVATE_SETTING: PRIVATE }, codeChecksum: 'SYNTHETIC-CRC64', codeSize: 1234, state: 'Active', lastUpdateStatus: 'Successful',
    cpu: 0.35, memorySize: 512, timeout: 60, diskSize: 512, instanceConcurrency: 20, disableInjectCredentials: 'None',
    enableLongLiving: false, instanceIsolationMode: 'SHARED', idleTimeout: 60, sessionAffinityConfig: { mode: 'NONE' }, layers: [], tracingConfig: {}, handler: 'index.handler', customHealthCheckConfig: {}, instanceType: 'e1' };
}
function trigger() {
  return { triggerType: 'http', qualifier: 'LATEST', triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'HEAD'], disableURLInternet: false }), httpTrigger: { urlInternet: TRIGGER_URL } };
}
function fixture(change = {}) {
  let functionReads = 0, healthReads = 0, triggerReads = 0, headReads = 0, updates = 0;
  const calls = [], signals = [];
  let current = change.before ? change.before(info()) : info();
  const client = {
    async getFunction({ signal }) {
      calls.push('function'); signals.push(signal); functionReads++;
      const value = structuredClone(current);
      return change.functionInfo ? change.functionInfo(value, functionReads) : value;
    },
    async getTrigger({ signal }) { calls.push('trigger'); signals.push(signal); triggerReads++; return change.trigger ? change.trigger(trigger(), triggerReads) : trigger(); },
    async checkHealth(url, { signal }) {
      calls.push('health'); signals.push(signal); assert.equal(url, TRIGGER_URL); healthReads++;
      const value = { status: 200, body: { status: 'ok', scope: 'process-only', sourceCommit: COMMIT } };
      return change.health ? change.health(value, healthReads) : value;
    },
    async updateEnvironment(variables, { signal }) {
      calls.push('update'); signals.push(signal); updates++;
      if (!change.skipApply) current.environmentVariables = structuredClone(variables);
      if (change.afterUpdate) current = change.afterUpdate(current);
      if (change.updateError) throw new Error('PRIVATE-SYNTHETIC-UNKNOWN-ACK');
      return { acknowledged: true };
    },
  };
  const options = { env: ENV, client,
    async fetchHead(url, settings) {
      calls.push('head'); signals.push(settings.signal); headReads++;
      assert.equal(url, 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main');
      return { ok: true, async json() { return { object: { sha: change.head ? change.head(headReads) : COMMIT } }; } };
    },
    async wait(milliseconds, { signal }) { calls.push('wait'); signals.push(signal); assert.equal(milliseconds, 2000); },
  };
  return { client, options, calls, signals, current: () => current, updates: () => updates };
}

async function opaqueFailure(promise, expected) {
  await assert.rejects(promise, error => {
    assert.match(error.message, /^Cloud admin setup was not verified:/u);
    if (expected) assert.match(error.message, expected);
    for (const value of [PASSWORD, PRIVATE, ENV.FC_ACCESS_KEY_SECRET, ENV.ARTDICO_ADMIN_USERNAME, ENV.ARTDICO_ADMIN_EMAIL, 'PRIVATE-SYNTHETIC-UNKNOWN-ACK']) assert.equal(error.stack.includes(value), false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
}

test('a protected latest-main push with explicit setup intent and complete account inputs is required before any network', async () => {
  for (const patch of [{ GITHUB_ACTIONS: '' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'other/artdicohost' }, { GITHUB_SHA: 'main' }, { GITHUB_SHA: [COMMIT] }, { ARTDICO_CLOUD_ADMIN_SETUP_ENABLED: '' },
    { ARTDICO_FC_ACCOUNT_ID: '0000111122223333' }, { FC_ACCESS_KEY_ID: '' }, { FC_ACCESS_KEY_SECRET: '' }, { ARTDICO_ADMIN_PASSWORD: '' }, { ARTDICO_ADMIN_PASSWORD: 'short' },
    { ARTDICO_ADMIN_USERNAME: '' }, { ARTDICO_ADMIN_EMAIL: '' }]) {
    const f = fixture();
    await opaqueFailure(configureCloudAdmin({ ...f.options, env: { ...ENV, ...patch } }));
    assert.deepEqual(f.calls, []);
  }
  for (const options of [null, Object.defineProperty({}, 'env', { get() { throw new Error('PRIVATE-SYNTHETIC-OPTION'); } }),
    { env: Object.defineProperty({ ...ENV }, 'ARTDICO_ADMIN_PASSWORD', { get() { throw new Error('PRIVATE-SYNTHETIC-ENVIRONMENT'); } }) }]) {
    await opaqueFailure(configureCloudAdmin(options));
  }
  assert.throws(() => requireCloudAdminSetupContext(Object.defineProperty({ ...ENV }, 'ARTDICO_ADMIN_PASSWORD', { get() { throw new Error('PRIVATE-SYNTHETIC-ENVIRONMENT'); } })),
    error => !error.message.includes('PRIVATE-') && error.message.includes('CONTEXT_INVALID'));
});

test('trusted setup reports only the fixed missing setting name, while untrusted contexts remain opaque', async () => {
  for (const [name, expected] of [
    ['ARTDICO_ADMIN_USERNAME', 'MISSING_REPOSITORY_VARIABLE_ARTDICO_ADMIN_USERNAME'],
    ['ARTDICO_ADMIN_EMAIL', 'MISSING_REPOSITORY_VARIABLE_ARTDICO_ADMIN_EMAIL'],
    ['ARTDICO_ADMIN_PASSWORD', 'MISSING_REPOSITORY_SECRET_ARTDICO_ADMIN_PASSWORD'],
  ]) {
    const f = fixture();
    await opaqueFailure(configureCloudAdmin({ ...f.options, env: { ...ENV, [name]: '' } }), new RegExp(expected, 'u'));
    assert.deepEqual(f.calls, []);
    await assert.rejects(configureCloudAdmin({ ...f.options, env: { ...ENV, [name]: '', GITHUB_REF: 'refs/heads/foreign' } }), error => {
      assert.match(error.message, /CONTEXT_INVALID/u);
      assert.doesNotMatch(error.message, /MISSING_REPOSITORY_/u);
      return true;
    });
    assert.deepEqual(f.calls, []);
  }
});

test('the actual CLI accepts Node process.env and never prints sensitive environment values or hashes', () => {
  const stub = 'data:text/javascript,' + encodeURIComponent('globalThis.fetch=async()=>{throw new Error("PRIVATE-SYNTHETIC-NETWORK-DIAGNOSTIC")};');
  const child = spawnSync(process.execPath, ['--import', stub, new URL('../scripts/configure-cloud-admin.mjs', import.meta.url).pathname],
    { env: { ...ENV, LANG: 'C' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /CURRENT_MAIN_NOT_VERIFIED/u);
  assert.doesNotMatch(child.stderr, /CONTEXT_INVALID|PRIVATE-|synthetic|scrypt\$/u);
  const extra = spawnSync(process.execPath, [new URL('../scripts/configure-cloud-admin.mjs', import.meta.url).pathname, 'PRIVATE-SYNTHETIC-ARGUMENT'],
    { env: { LANG: 'C' }, encoding: 'utf8', timeout: 5000 });
  assert.match(extra.stderr, /ARGUMENTS_NOT_ALLOWED/u);
  assert.doesNotMatch(extra.stderr, /PRIVATE-/u);
  assert.equal(extra.stdout, '');
});

test('the setup derives a runtime-valid owner only in memory, preserves unrelated configuration and stays disabled', async () => {
  const f = fixture();
  const result = await configureCloudAdmin(f.options);
  assert.deepEqual(result, { configured: true, contentEnabled: false, storageVerified: false, codeUnchanged: true, existingAccount: false, updated: true });
  assert.equal(f.updates(), 1);
  assert.ok(f.signals.every(signal => signal instanceof AbortSignal));
  const variables = f.current().environmentVariables;
  assert.equal(variables.SYNTHETIC_PRIVATE_SETTING, PRIVATE);
  assert.equal(variables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
  assert.equal(variables.ARTDICO_CONTENT_API_ORIGIN, 'https://api.artdico.host');
  assert.equal(variables.ARTDICO_PUBLIC_SITE_ORIGIN, 'https://artdico.host');
  assert.equal(variables.ARTDICO_CONTENT_BUCKET, 'artdicohost-data-hk');
  assert.equal(variables.ARTDICO_CONTENT_REGION, 'cn-hongkong');
  assert.equal(variables.NODE_ENV, 'production');
  const users = parseAdminUsers(variables.ADMIN_USERS_JSON);
  assert.equal(users.length, 1);
  assert.equal(users[0].username, ENV.ARTDICO_ADMIN_USERNAME);
  assert.equal(users[0].email, ENV.ARTDICO_ADMIN_EMAIL);
  assert.deepEqual(users[0].roles, ['superadmin', 'editor', 'publisher', 'outreach']);
  assert.equal(await verifyPassword(PASSWORD, users[0].passwordHash), true);
  assert.equal(variables.ADMIN_USERS_JSON.includes(PASSWORD), false);
  assert.equal(JSON.stringify(result).includes('scrypt$'), false);
  assert.equal(JSON.stringify(result).includes('synthetic'), false);
  const before = info(), after = f.current(); delete before.environmentVariables; delete after.environmentVariables;
  assert.deepEqual(after, before);
  assert.equal(f.calls.filter(call => call === 'health').length, 4);
  assert.equal(f.calls.filter(call => call === 'trigger').length, 2);
});

test('known owner setup is idempotent and preserves the existing salted hash and original JSON bytes', async () => {
  const first = fixture(); await configureCloudAdmin(first.options);
  const current = first.current();
  current.environmentVariables.ADMIN_USERS_JSON = '\n ' + current.environmentVariables.ADMIN_USERS_JSON + '\n';
  const bytes = current.environmentVariables.ADMIN_USERS_JSON;
  const second = fixture({ before: () => structuredClone(current) });
  const result = await configureCloudAdmin(second.options);
  assert.equal(result.existingAccount, true);
  assert.equal(result.updated, false);
  assert.equal(second.updates(), 0);
  assert.equal(second.current().environmentVariables.ADMIN_USERS_JSON, bytes);
});

test('only the exact legacy owner can receive superadmin while retaining its password hash', async () => {
  const first = fixture(); await configureCloudAdmin(first.options);
  const current = first.current();
  const original = JSON.parse(current.environmentVariables.ADMIN_USERS_JSON)[0];
  const legacy = { ...original, roles: ['editor', 'publisher', 'outreach'] };
  current.environmentVariables.ADMIN_USERS_JSON = JSON.stringify([legacy]);
  const next = fixture({ before: () => structuredClone(current) });
  assert.equal((await configureCloudAdmin(next.options)).updated, true);
  const upgraded = JSON.parse(next.current().environmentVariables.ADMIN_USERS_JSON)[0];
  assert.equal(upgraded.passwordHash, original.passwordHash);
  assert.deepEqual(upgraded.roles, ['superadmin', 'editor', 'publisher', 'outreach']);
  const foreign = fixture({ before: () => ({ ...current, environmentVariables: { ...current.environmentVariables,
    ADMIN_USERS_JSON: JSON.stringify([{ ...legacy, roles: ['reviewer'] }]) } }) });
  await opaqueFailure(configureCloudAdmin(foreign.options), /EXISTING_ACCOUNT_REQUIRES_REVIEW/u);
  assert.equal(foreign.updates(), 0);
});

test('registration policy and independent token secret are configured privately with explicit enabling', async () => {
  const first = fixture(); await configureCloudAdmin(first.options);
  const variables = first.current().environmentVariables;
  assert.match(variables.ARTDICO_REGISTRATION_TOKEN_SECRET, /^[A-Za-z0-9_-]{64}$/u);
  assert.equal(variables.ARTDICO_REGISTRATION_ENABLED, 'false');
  assert.equal(JSON.parse(variables.ARTDICO_REGISTRATION_POLICY_JSON).enabled, false);
  assert.equal(variables.ARTDICO_REGISTRATION_CAPACITY, '300');
  const enabled = fixture({ before: () => first.current() });
  await configureCloudAdmin({ ...enabled.options, env: { ...ENV, ARTDICO_REGISTRATION_SETUP_ENABLED: 'true' } });
  assert.equal(enabled.current().environmentVariables.ARTDICO_REGISTRATION_TOKEN_SECRET, variables.ARTDICO_REGISTRATION_TOKEN_SECRET);
  assert.equal(enabled.current().environmentVariables.ARTDICO_REGISTRATION_ENABLED, 'true');
  assert.equal(JSON.parse(enabled.current().environmentVariables.ARTDICO_REGISTRATION_POLICY_JSON).enabled, true);
  assert.equal(enabled.current().environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
  for (const secret of ['', 'short', ENV.ARTDICO_ADMIN_PASSWORD]) {
    const failed = fixture({ before: value => ({ ...value, environmentVariables: { ARTDICO_REGISTRATION_TOKEN_SECRET: secret } }) });
    await opaqueFailure(configureCloudAdmin(failed.options), /REGISTRATION_SECRET_REQUIRES_REVIEW/u);
    assert.equal(failed.updates(), 0);
  }
});

test('unknown existing staff, changed owner passwords and invalid identity metadata never write', async () => {
  const first = fixture(); await configureCloudAdmin(first.options);
  for (const json of ['PRIVATE-SYNTHETIC-INVALID-JSON', '[]', '{}', JSON.stringify([{ password: PASSWORD }]),
    first.current().environmentVariables.ADMIN_USERS_JSON.replace('synthetic.owner@artdico.co', 'another.synthetic@artdico.co')]) {
    const f = fixture({ before: value => ({ ...value, environmentVariables: { ADMIN_USERS_JSON: json } }) });
    await opaqueFailure(configureCloudAdmin(f.options), /EXISTING_ACCOUNT_REQUIRES_REVIEW/u);
    assert.equal(f.updates(), 0);
  }
  const changedPassword = fixture({ before: () => first.current() });
  await opaqueFailure(configureCloudAdmin({ ...changedPassword.options, env: { ...ENV, ARTDICO_ADMIN_PASSWORD: 'different-synthetic-password-123' } }), /EXISTING_ACCOUNT_REQUIRES_REVIEW/u);
  assert.equal(changedPassword.updates(), 0);
  for (const patch of [{ ARTDICO_ADMIN_USERNAME: 'bad username' }, { ARTDICO_ADMIN_EMAIL: 'synthetic.owner@example.invalid' }]) {
    const f = fixture(); await opaqueFailure(configureCloudAdmin({ ...f.options, env: { ...ENV, ...patch } }), /ACCOUNT_INPUT_INVALID/u);
    assert.equal(f.updates(), 0);
  }
});

test('current main is verified initially, immediately before mutation and after readback', async () => {
  for (const advanceAt of [1, 2, 3]) {
    const f = fixture({ head: count => count >= advanceAt ? 'b'.repeat(40) : COMMIT });
    await opaqueFailure(configureCloudAdmin(f.options), /CURRENT_MAIN_NOT_VERIFIED/u);
    assert.equal(f.updates(), advanceAt === 3 ? 1 : 0);
  }
});

test('target, dedicated role, pinned runtime, code identity and signed full source health are required', async () => {
  for (const patch of [{ functionName: 'other-function' }, { functionArn: info().functionArn.replace('cn-hongkong', 'cn-shanghai') },
    { role: 'acs:ram::1954121651395178:role/other-project' }, { runtime: 'nodejs20' }, { customRuntimeConfig: { command: ['/code/other'], port: 9000 } },
    { customRuntimeConfig: { command: ['/code/bootstrap'], port: 9001 } }, { codeChecksum: null }, { codeSize: 0 }, { environmentVariables: [] },
    { state: 'Pending' }, { lastUpdateStatus: 'InProgress' }, { state: 'Failed' }, { environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'true' } }]) {
    const f = fixture({ before: value => ({ ...value, ...patch }) });
    await opaqueFailure(configureCloudAdmin(f.options)); assert.equal(f.updates(), 0);
  }
  for (const health of [value => ({ ...value, body: { ...value.body, sourceCommit: 'b'.repeat(40) } }), () => ({ status: 503, body: {} })]) {
    const f = fixture({ health }); await opaqueFailure(configureCloudAdmin(f.options), /PRE_UPDATE_HEALTH_NOT_VERIFIED/u); assert.equal(f.updates(), 0);
  }
  for (const patch of [{ triggerType: 'timer' }, { qualifier: 'old' }, { triggerConfig: JSON.stringify({ authType: 'anonymous', methods: ['GET'] }) }, { httpTrigger: { urlInternet: 'https://other.invalid' } }]) {
    const f = fixture({ trigger: value => ({ ...value, ...patch }) });
    await opaqueFailure(configureCloudAdmin(f.options), /SIGNED_TRIGGER_INVALID/u); assert.equal(f.updates(), 0);
  }
});

test('fresh and final state gates reject concurrent updates even when all configuration values still match', async () => {
  for (const readAt of [2, 6]) for (const patch of [{ state: 'Pending' }, { state: 'Creating' }, { lastUpdateStatus: 'InProgress' }, { state: 'Failed' }, { lastUpdateStatus: 'Failed' }]) {
    const f = fixture({ functionInfo: (value, count) => count === readAt ? { ...value, ...patch } : value });
    await opaqueFailure(configureCloudAdmin(f.options), /FUNCTION_NOT_STABLE/u);
    assert.equal(f.updates(), readAt === 2 ? 0 : 1);
  }
});

test('fresh configuration drift prevents a write and post-update code or unrelated settings drift prevents success', async () => {
  const before = fixture({ functionInfo: (value, count) => count === 2 ? { ...value, environmentVariables: { ...value.environmentVariables, SYNTHETIC_PRIVATE_SETTING: 'changed' } } : value });
  await opaqueFailure(configureCloudAdmin(before.options), /CONFIGURATION_CHANGED_BEFORE_UPDATE/u); assert.equal(before.updates(), 0);
  for (const field of ['role', 'runtime', 'codeChecksum', 'codeSize', 'enableLongLiving', 'instanceIsolationMode', 'idleTimeout', 'sessionAffinityConfig', 'layers', 'tracingConfig', 'handler', 'customHealthCheckConfig', 'instanceType', 'disableInjectCredentials']) {
    const f = fixture({ afterUpdate: value => ({ ...value, [field]: field === 'codeSize' ? 1235 : 'PRIVATE-SYNTHETIC-CHANGED' }) });
    await opaqueFailure(configureCloudAdmin(f.options)); assert.equal(f.updates(), 1);
  }
  const envChange = fixture({ afterUpdate: value => ({ ...value, environmentVariables: { ...value.environmentVariables, UNKNOWN_NEW_KEY: 'PRIVATE-SYNTHETIC-CHANGED' } }) });
  await opaqueFailure(configureCloudAdmin(envChange.options), /UNEXPECTED_ENVIRONMENT_CHANGE/u);
  assert.equal(envChange.updates(), 1);
});

test('a lost update acknowledgement succeeds only after exact readback and never causes a second PUT', async () => {
  const reached = fixture({ updateError: true });
  assert.equal((await configureCloudAdmin(reached.options)).configured, true);
  assert.equal(reached.updates(), 1);
  const absent = fixture({ updateError: true, skipApply: true });
  await opaqueFailure(configureCloudAdmin(absent.options), /CONFIGURATION_NOT_VERIFIED/u);
  assert.equal(absent.updates(), 1);
  const failed = fixture({ skipApply: true });
  const denied = createFcConfigClient({ credentials: { accessKeyId: 'SYNTHETICKEY', accessKeySecret: 'synthetic-secret' }, fetchFn: async () =>
    new Response(JSON.stringify({ Code: 'AccessDenied', Message: 'PRIVATE-SYNTHETIC-REMOTE-BODY' }), { status: 403, headers: { 'content-type': 'application/json' } }) });
  failed.client.updateEnvironment = async (...args) => { failed.calls.push('update'); return denied.updateEnvironment(...args); };
  await opaqueFailure(configureCloudAdmin(failed.options), /CONFIGURATION_NOT_VERIFIED \[operation=UpdateFunction phase=http status=403 code=AccessDenied\]/u);
  assert.equal(failed.calls.filter(call => call === 'update').length, 1);
});

test('configuration size is checked before the only PUT, including preserved values and account JSON', async () => {
  const f = fixture({ before: value => ({ ...value, environmentVariables: { SYNTHETIC_FILLER: 'x'.repeat(4000) } }) });
  await opaqueFailure(configureCloudAdmin(f.options), /CONFIGURATION_INPUT_INVALID/u);
  assert.equal(f.updates(), 0);
});

test('post-update health requires three consecutive exact full source markers and unchanged trigger', async () => {
  const retried = fixture({ health: (value, count) => count === 3 ? { ...value, body: { ...value.body, sourceCommit: 'b'.repeat(40) } } : value });
  assert.equal((await configureCloudAdmin(retried.options)).configured, true);
  assert.equal(retried.calls.filter(call => call === 'health').length, 6);
  assert.equal(retried.updates(), 1);
  const changed = fixture({ trigger: (value, count) => count === 2 ? { ...value, triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'HEAD'], disableURLInternet: false, extraSetting: true }) } : value });
  await opaqueFailure(configureCloudAdmin(changed.options), /FINAL_CONFIGURATION_CHANGED/u);
  assert.equal(changed.updates(), 1);
});
