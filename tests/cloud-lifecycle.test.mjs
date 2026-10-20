import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { acceptanceMatches, deployCloudLifecycle, verifyPublicRegistrationAlias } from '../scripts/cloud-lifecycle.mjs';
import { CANDIDATE_KIND, CANDIDATE_ARCHIVE } from '../scripts/cloud-content-package.mjs';
import { approvedRegistrationPolicy } from '../scripts/approved-registration-policy.mjs';

const COMMIT = 'a'.repeat(40), OLD = 'b'.repeat(40);
const PRIVATE = 'PRIVATE-SYNTHETIC-ENVIRONMENT';
const URL = 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run';
const RUN = 'r123-a1-' + 'd'.repeat(16) + '-' + COMMIT;
const STAGES = ['object-readback', 'atomic-conflict', 'login-permissions', 'private-contacts', 'content-portrait', 'lost-ack', 'registration-intake', 'registration-review', 'session-revocation', 'shared-login-budget'];
const ENV = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kunanli/artdicohost',
  GITHUB_SHA: COMMIT, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_TOKEN: 'synthetic-github-token', ARTDICO_FC_DEPLOY_ENABLED: 'true',
  ARTDICO_CLOUD_LIFECYCLE_ENABLED: 'true', ARTDICO_CLOUD_ADMIN_SETUP_ENABLED: 'true', ARTDICO_FC_ACCOUNT_ID: '1954121651395178',
  FC_ACCESS_KEY_ID: 'SYNTHETICKEY', FC_ACCESS_KEY_SECRET: 'synthetic-deployment-secret', ARTDICO_ADMIN_PASSWORD: 'synthetic-owner-password-123',
  ARTDICO_ADMIN_USERNAME: 'synthetic.owner', ARTDICO_ADMIN_EMAIL: 'synthetic.owner@artdico.co', ARTDICO_REGISTRATION_SETUP_ENABLED: 'false' };
function proof() {
  return { schemaVersion: 1, status: 'passed', runId: RUN, sourceCommit: COMMIT, instanceId: 'c'.repeat(32), completed: [...STAGES],
    requests: 30, touchedObjects: 20, independentClients: 2, fcProcesses: 1, cleanupPerformed: false };
}
function publication() {
  const zipBytes = Buffer.from('synthetic reviewed archive');
  return { zipBytes, manifest: { schemaVersion: 1, kind: CANDIDATE_KIND, sourceCommit: COMMIT,
    archive: { path: CANDIDATE_ARCHIVE, sha256: createHash('sha256').update(zipBytes).digest('hex') } } };
}
function fixture(change = {}) {
  let source = OLD, proofObserved = false;
  let state = { functionName: 'artdicohost-api', functionArn: 'acs:fc:cn-hongkong:1954121651395178:functions/artdicohost-api',
    runtime: 'custom.debian11', customRuntimeConfig: { command: ['/code/bootstrap'], args: [], port: 9000 },
    role: 'acs:ram::1954121651395178:role/artdicohost-content-runtime', codeChecksum: 'SYNTHETIC-OLD-CRC', codeSize: 123,
    environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'true', SYNTHETIC_PRIVATE_SETTING: PRIVATE }, state: 'Active', lastUpdateStatus: 'Successful', memorySize: 512 };
  if (change.before) state = change.before(state);
  const calls = [], updates = [], reports = [];
  const trigger = { triggerType: 'http', qualifier: 'LATEST', triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'HEAD'] }),
    httpTrigger: { urlInternet: URL } };
  const client = {
    async getFunction() {
      calls.push('function');
      const current = structuredClone(state);
      return change.inspect ? change.inspect(current, updates.length, calls) : current;
    },
    async getTrigger() {
      calls.push('trigger');
      return change.trigger ? change.trigger(structuredClone(trigger), proofObserved, updates.length) : structuredClone(trigger);
    },
    async checkHealth(url) {
      calls.push('health'); assert.equal(url, URL);
      const body = { status: 'ok', scope: 'process-only', sourceCommit: source };
      if (state.environmentVariables.ARTDICO_CLOUD_ACCEPTANCE_RUN_ID) {
        const currentProof = { ...proof(), runId: state.environmentVariables.ARTDICO_CLOUD_ACCEPTANCE_RUN_ID };
        body.acceptance = change.proof ? change.proof(currentProof) : currentProof;
        if (body.acceptance.status === 'passed') proofObserved = true;
      }
      const health = { status: 200, body };
      return change.health ? change.health(health, updates.length) : health;
    },
    async updateEnvironment(variables) {
      calls.push('update'); updates.push(structuredClone(variables));
      if (change.skipApply !== updates.length) state.environmentVariables = structuredClone(variables);
      if (change.afterUpdate) state = change.afterUpdate(state, updates.length);
      if (change.lostAck === updates.length) throw new Error('PRIVATE-SYNTHETIC-LOST-ACK');
      return { acknowledged: true };
    },
  };
  const options = { env: ENV, client, codeClient: {}, verifyPackage: async () => { calls.push('package'); return change.publication?.() ?? publication(); },
    async fetchHead() {
      calls.push('head');
      return { ok: true, async json() { return { object: { sha: change.head ? change.head({ proofObserved, calls, updates }) : COMMIT } }; } };
    },
    async deployCode() {
      calls.push('code');
      assert.equal(state.environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
      assert.equal(Object.hasOwn(state.environmentVariables, 'ARTDICO_CLOUD_ACCEPTANCE_RUN_ID'), false);
      source = COMMIT; state.codeChecksum = 'SYNTHETIC-NEW-CRC'; state.codeSize++;
      if (change.codeError) throw new Error('PRIVATE-SYNTHETIC-CODE-FAILURE');
      return { commit: COMMIT, code: 'verified' };
    },
    async wait() { calls.push('wait'); }, report: line => reports.push(line),
  };
  return { options, calls, updates, reports, current: () => structuredClone(state), source: () => source };
}
async function safeFailure(f, expected) {
  await assert.rejects(deployCloudLifecycle(f.options), error => {
    assert.match(error.message, expected ?? /^Cloud lifecycle was not verified:/u);
    for (const secret of [PRIVATE, ENV.ARTDICO_ADMIN_PASSWORD, ENV.FC_ACCESS_KEY_SECRET, ENV.ARTDICO_ADMIN_EMAIL, 'PRIVATE-SYNTHETIC-']) {
      assert.equal(error.stack.includes(secret), false);
    }
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
}

test('lifecycle requires the protected current-main setup intent and exact run identity before package or network', async () => {
  for (const patch of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/foreign' },
    { GITHUB_REPOSITORY: 'foreign/artdicohost' }, { GITHUB_SHA: 'main' }, { GITHUB_RUN_ID: '0' }, { GITHUB_RUN_ID: '1-2' },
    { GITHUB_RUN_ID: '1'.repeat(21) }, { GITHUB_RUN_ATTEMPT: undefined }, { GITHUB_RUN_ATTEMPT: '0' }, { GITHUB_RUN_ATTEMPT: '1-2' },
    { GITHUB_RUN_ATTEMPT: '1'.repeat(11) }, { ARTDICO_CLOUD_LIFECYCLE_ENABLED: 'false' }, { ARTDICO_FC_DEPLOY_ENABLED: 'false' },
    { ARTDICO_CLOUD_ADMIN_SETUP_ENABLED: 'false' }, { ARTDICO_FC_ACCOUNT_ID: '0000000000' }, { FC_ACCESS_KEY_SECRET: '' }, { ARTDICO_ADMIN_PASSWORD: '' }]) {
    const f = fixture(); f.options.env = { ...ENV, ...patch };
    await safeFailure(f, /CONTEXT_INVALID/u); assert.deepEqual(f.calls, []);
  }
  const f = fixture();
  f.options.env = Object.defineProperty({ ...ENV }, 'ARTDICO_ADMIN_PASSWORD', { get() { throw new Error(PRIVATE); } });
  await safeFailure(f, /CONTEXT_INVALID/u); assert.deepEqual(f.calls, []);
});

test('invalid candidate identity or archive bytes stop before quiescing any cloud resource', async () => {
  for (const mutate of [p => { p.zipBytes[0]++; return p; }, p => { p.manifest.sourceCommit = OLD; return p; },
    p => { p.manifest.kind = 'fc-preflight'; return p; }, p => { p.manifest.archive.path = '../foreign.zip'; return p; }]) {
    const f = fixture({ publication: () => mutate(publication()) });
    await safeFailure(f, /PACKAGE_NOT_VERIFIED/u); assert.deepEqual(f.calls, ['package']);
  }
});

test('enabled code is quiesced before code-only deployment, owner setup and signed acceptance precede activation', async () => {
  const f = fixture(); const result = await deployCloudLifecycle(f.options);
  assert.equal(f.updates.length, 4);
  assert.equal(f.updates[0].ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
  assert.deepEqual(f.updates[0], { ARTDICO_CLOUD_CONTENT_ENABLED: 'false', SYNTHETIC_PRIVATE_SETTING: PRIVATE });
  assert.ok(f.calls.indexOf('update') < f.calls.indexOf('code'));
  assert.equal(f.updates[1].ARTDICO_CLOUD_ACCEPTANCE_RUN_ID, undefined);
  assert.match(f.updates[2].ARTDICO_CLOUD_ACCEPTANCE_RUN_ID, new RegExp('^r123-a1-[a-f0-9]{16}-' + COMMIT + '$', 'u'));
  assert.equal(f.updates[2].ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
  assert.equal(f.updates[3].ARTDICO_CLOUD_CONTENT_ENABLED, 'true');
  assert.equal(Object.hasOwn(f.updates[3], 'ARTDICO_CLOUD_ACCEPTANCE_RUN_ID'), false);
  assert.equal(f.updates[3].SYNTHETIC_PRIVATE_SETTING, PRIVATE);
  const users = JSON.parse(f.updates[3].ADMIN_USERS_JSON);
  assert.deepEqual(users[0].roles, ['superadmin', 'editor', 'publisher', 'outreach']);
  assert.equal(f.updates[3].ARTDICO_REGISTRATION_ENABLED, 'false');
  assert.deepEqual(result, { sourceCommit: COMMIT, contentEnabled: true, registrationEnabled: false,
    acceptanceRunId: f.updates[2].ARTDICO_CLOUD_ACCEPTANCE_RUN_ID, privateOssAcceptance: 'passed', independentClients: 2, fcProcesses: 1 });
  assert.equal(JSON.stringify(f.reports).includes(PRIVATE), false);
});

test('failed or malformed acceptance remains closed and never attempts activation', async () => {
  for (const mutate of [p => ({ ...p, status: 'failed' }), p => ({ ...p, runId: 'r999-' + COMMIT }), p => ({ ...p, sourceCommit: OLD }),
    p => ({ ...p, completed: STAGES.slice(1) }), p => ({ ...p, independentClients: 1 }), p => ({ ...p, fcProcesses: 2 }),
    p => ({ ...p, requests: 1001 }), p => ({ ...p, touchedObjects: 0 }), p => ({ ...p, cleanupPerformed: true })]) {
    const f = fixture({ proof: mutate }); await safeFailure(f, /ACCEPTANCE_(?:FAILED|NOT_VERIFIED)/u);
    assert.equal(f.updates.length, 3); assert.equal(f.current().environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
  }
});

test('rerun attempts and repeated same-attempt invocations cannot reuse a cached acceptance proof', async () => {
  const first = fixture(); const original = await deployCloudLifecycle(first.options);
  const nextAttempt = fixture(); nextAttempt.options.env = { ...ENV, GITHUB_RUN_ATTEMPT: '2' };
  const rerun = await deployCloudLifecycle(nextAttempt.options);
  assert.match(rerun.acceptanceRunId, new RegExp('^r123-a2-[a-f0-9]{16}-' + COMMIT + '$', 'u'));
  assert.notEqual(rerun.acceptanceRunId, original.acceptanceRunId);
  const sameAttempt = fixture(); const repeated = await deployCloudLifecycle(sameAttempt.options);
  assert.notEqual(repeated.acceptanceRunId, original.acceptanceRunId);
  const stale = fixture({ proof: value => ({ ...value, runId: original.acceptanceRunId }) });
  stale.options.env = { ...ENV, GITHUB_RUN_ATTEMPT: '2' };
  await safeFailure(stale, /ACCEPTANCE_NOT_VERIFIED/u);
  assert.equal(stale.updates.length, 3);
  assert.equal(stale.current().environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
});

test('unknown configuration acknowledgements only perform readback and never repeat a phase PUT', async () => {
  for (const lostAck of [1, 2, 3, 4]) {
    const f = fixture({ lostAck }); assert.equal((await deployCloudLifecycle(f.options)).contentEnabled, true);
    assert.equal(f.updates.length, 4);
  }
  const f = fixture({ lostAck: 1, skipApply: 1, before: value => ({ ...value, environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'false',
    ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: 'r1-' + OLD } }) });
  await safeFailure(f, /CONFIGURATION_NOT_VERIFIED/u); assert.equal(f.updates.length, 1);
});

test('advancing main, changed trigger and concurrent configuration drift prevent activation', async () => {
  const advanced = fixture({ head: ({ proofObserved }) => proofObserved ? OLD : COMMIT });
  await safeFailure(advanced, /CURRENT_MAIN_NOT_VERIFIED/u); assert.equal(advanced.updates.length, 3);
  const changedTrigger = fixture({ trigger: (value, proofObserved) => proofObserved ? { ...value, qualifier: 'foreign' } : value });
  await safeFailure(changedTrigger, /SIGNED_TRIGGER_INVALID/u); assert.equal(changedTrigger.updates.length, 3);
  const changedConfig = fixture({ afterUpdate: (value, count) => count === 3 ? { ...value, role: 'foreign' } : value });
  await safeFailure(changedConfig, /TARGET_CONFIGURATION_INVALID/u); assert.equal(changedConfig.updates.length, 3);
});

test('failed code deployment remains closed and no acceptance is armed', async () => {
  const f = fixture({ codeError: true }); await safeFailure(f, /CODE_DEPLOYMENT_NOT_VERIFIED/u);
  assert.equal(f.updates.length, 1); assert.equal(f.current().environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'false');
});

test('active readback must have three source matches without stale acceptance before success', async () => {
  const f = fixture({ health: (value, updates) => updates === 4 ? { ...value, body: { ...value.body, acceptance: proof() } } : value });
  await safeFailure(f, /CONFIGURATION_NOT_VERIFIED/u); assert.equal(f.updates.length, 4);
});

test('acceptance proof does not treat process health or incomplete stage evidence as storage success', () => {
  const value = { status: 200, body: { status: 'ok', scope: 'process-only', sourceCommit: COMMIT, acceptance: proof() } };
  assert.equal(acceptanceMatches(value, RUN, COMMIT), true);
  assert.equal(acceptanceMatches({ ...value, body: { ...value.body, acceptance: undefined } }, RUN, COMMIT), false);
  assert.equal(acceptanceMatches(value, RUN, OLD), false);
});

test('enabled registration requires credential-free HTTPS alias metadata matching the full approved policy', async () => {
  const policy = approvedRegistrationPolicy({ contactEmail: ENV.ARTDICO_ADMIN_EMAIL });
  const metadata = { ...policy, opensAt: new Date(policy.opensAt).toISOString(), closesAt: new Date(policy.closesAt).toISOString() };
  const reply = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://artdico.host' } });
  const f = fixture(); f.options.env = { ...ENV, ARTDICO_REGISTRATION_SETUP_ENABLED: 'true' };
  f.options.fetchPublic = async (url, options) => {
    assert.equal(url, 'https://api.artdico.host/api/admin/registration/config');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { accept: 'application/json', origin: 'https://artdico.host' });
    assert.equal(f.current().environmentVariables.ARTDICO_CLOUD_CONTENT_ENABLED, 'true');
    return reply(metadata);
  };
  assert.equal((await deployCloudLifecycle(f.options)).registrationEnabled, true);
  for (const change of [{ ...metadata, capacity: 301 }, { ...metadata, closesAt: '2026-12-05T05:00:00.000Z' },
    { enabled: false, reason: 'unavailable' }, { ...metadata, privacy: { ...metadata.privacy, retention: 'wrong' } }]) {
    await assert.rejects(verifyPublicRegistrationAlias(async () => reply(change), policy), /PUBLIC_REGISTRATION_NOT_VERIFIED/u);
  }
  await assert.rejects(verifyPublicRegistrationAlias(async () => new Response('{}', { status: 302 }), policy), /PUBLIC_REGISTRATION_NOT_VERIFIED/u);
  const overflow = new Response('x'.repeat(16 * 1024 + 1), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': 'https://artdico.host' } });
  await assert.rejects(verifyPublicRegistrationAlias(async () => overflow, policy), /PUBLIC_REGISTRATION_NOT_VERIFIED/u);
  const failed = fixture(); failed.options.env = { ...ENV, ARTDICO_REGISTRATION_SETUP_ENABLED: 'true' };
  failed.options.fetchPublic = async () => reply({ enabled: false, reason: 'unavailable' });
  await safeFailure(failed, /PUBLIC_REGISTRATION_NOT_VERIFIED/u);
  assert.equal(failed.updates.length, 4);
});
