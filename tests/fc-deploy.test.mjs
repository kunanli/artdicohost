import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployFc } from '../scripts/deploy-fc.mjs';
import { createFcClient, FC_API_ENDPOINT } from '../scripts/fc-client.mjs';

const commit = 'a'.repeat(40);
const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_SHA: commit,
  ARTDICO_FC_DEPLOY_ENABLED: 'true', ARTDICO_FC_ACCOUNT_ID: '1234567890123456', FC_ACCESS_KEY_ID: 'PRIVATE-SYNTHETIC-ID', FC_ACCESS_KEY_SECRET: 'PRIVATE-SYNTHETIC-SECRET' };
const archive = Buffer.from('synthetic verified ZIP bytes');
const archiveHash = createHash('sha256').update(archive).digest('hex');
const functionInfo = () => ({ functionName: 'artdicohost-api', functionArn: 'acs:fc:cn-hongkong:1234567890123456:functions/artdicohost-api', runtime: 'custom.debian11',
  customRuntimeConfig: { command: ['/code/bootstrap'], args: [], port: 9000 }, environmentVariables: { PRIVATE_SYNTHETIC_SETTING: 'PRIVATE-SYNTHETIC-VALUE' },
  role: 'PRIVATE-SYNTHETIC-ROLE', lastUpdateStatus: 'Successful', state: 'Active' });
const triggerInfo = () => ({ triggerType: 'http', qualifier: 'LATEST', triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'POST'], disableURLInternet: false }),
  httpTrigger: { urlInternet: 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/' } });
const goodHealth = () => ({ status: 200, body: { status: 'ok', scope: 'process-only', sourceCommit: commit } });

function fixture(changes = {}) {
  const calls = [];
  const signals = [];
  let reads = 0;
  const client = {
    async getFunction({ signal }) { calls.push('function'); signals.push(signal); reads++; return changes.functionInfo ? changes.functionInfo(reads) : functionInfo(); },
    async getTrigger({ signal }) { calls.push('trigger'); signals.push(signal); return changes.triggerInfo ? changes.triggerInfo(calls.filter(item => item === 'trigger').length) : triggerInfo(); },
    async updateCode(bytes, { signal }) { calls.push('update'); signals.push(signal); assert.equal(bytes, archive); if (changes.updateError) throw new Error('PRIVATE-SYNTHETIC-UPDATE-ERROR'); },
    async checkHealth(url, { signal }) { calls.push('health'); signals.push(signal); assert.equal(url, triggerInfo().httpTrigger.urlInternet); return changes.health ? changes.health(calls.filter(item => item === 'health').length) : goodHealth(); },
  };
  const options = {
    directory: '/synthetic-publication', repositoryDirectory: '/synthetic-repository', env,
    client, async verifyPackage(input) { calls.push('verify'); assert.deepEqual(input, { directory: '/synthetic-publication', expectedCommit: commit, repositoryDirectory: '/synthetic-repository' }); return { zipBytes: archive, manifest: { sourceCommit: commit, archive: { sha256: archiveHash } } }; },
    async fetchHead(url, settings) { calls.push('head'); signals.push(settings.signal); assert.equal(url, 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main'); return { ok: true, async json() { return { object: { sha: changes.head ? changes.head(calls.filter(item => item === 'head').length) : commit } }; } }; },
    async wait(milliseconds, { signal }) { calls.push('wait'); signals.push(signal); assert.equal(milliseconds, 2000); },
  };
  return { calls, signals, client, options };
}

test('only an explicitly enabled authenticated main push in the exact repository can begin FC work', async () => {
  for (const patch of [{ GITHUB_ACTIONS: '' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'other/artdicohost' }, { GITHUB_SHA: 'main' }, { ARTDICO_FC_DEPLOY_ENABLED: '' }, { ARTDICO_FC_DEPLOY_ENABLED: 'TRUE' },
    { FC_ACCESS_KEY_ID: '' }, { FC_ACCESS_KEY_SECRET: '' }, { ARTDICO_FC_ACCOUNT_ID: '' }, { ARTDICO_FC_ACCOUNT_ID: '12345' }, { ARTDICO_FC_ACCOUNT_ID: '1234567890123456/path' }]) {
    const value = fixture();
    await assert.rejects(deployFc({ ...value.options, env: { ...env, ...patch } }));
    assert.deepEqual(value.calls, []);
  }
});

test('artifact verification, commit identity and exact archive bytes are mandatory before FC inspection or mutation', async () => {
  for (const verifyPackage of [async () => { throw new Error('PRIVATE-SYNTHETIC-ARTIFACT'); }, async () => ({ zipBytes: archive, manifest: { sourceCommit: 'b'.repeat(40), archive: { sha256: archiveHash } } }),
    async () => ({ zipBytes: archive, manifest: { sourceCommit: commit, archive: { sha256: '0'.repeat(64) } } }), async () => ({ zipBytes: Buffer.alloc(0), manifest: { sourceCommit: commit, archive: { sha256: archiveHash } } })]) {
    const value = fixture();
    await assert.rejects(deployFc({ ...value.options, verifyPackage }), error => !error.message.includes('PRIVATE-'));
    assert.deepEqual(value.calls, []);
  }
});

test('invalid runtime, account, function, command, port and environment gates never update code', async () => {
  const invalid = [
    { functionName: 'other-function' }, { functionArn: 'acs:fc:cn-hongkong:9999999999999999:functions/artdicohost-api' }, { functionArn: 'acs:fc:cn-shanghai:1234567890123456:functions/artdicohost-api' },
    { runtime: 'nodejs20' }, { customRuntimeConfig: { command: ['/code/other'], args: [], port: 9000 } }, { customRuntimeConfig: { command: ['/code/bootstrap'], args: ['PRIVATE-SYNTHETIC-ARG'], port: 9000 } },
    { customRuntimeConfig: { command: ['/code/bootstrap'], args: [], port: 80 } }, { environmentVariables: { ARTDICO_FC_PORT: '9001' } }, { environmentVariables: [] },
  ];
  for (const patch of invalid) {
    const value = fixture({ functionInfo: () => ({ ...functionInfo(), ...patch }) });
    await assert.rejects(deployFc(value.options), /FC target configuration/);
    assert.equal(value.calls.includes('update'), false);
  }
});

test('only the authenticated Internet GET trigger for LATEST in Hong Kong may be updated', async () => {
  for (const patch of [{ triggerType: 'timer' }, { qualifier: 'production' }, { triggerConfig: '{PRIVATE-SYNTHETIC' },
    ...[{ authType: 'anonymous', methods: ['GET'] }, { authType: 'function', methods: ['POST'] }, { authType: 'function', methods: ['GET'], disableURLInternet: true }].map(config => ({ triggerConfig: JSON.stringify(config) })),
    ...['http://synthetic-artdicohost-api.cn-hongkong.fcapp.run/', 'https://synthetic-artdicohost-api.cn-shanghai.fcapp.run/', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run.attacker.invalid/', 'https://user:password@synthetic-artdicohost-api.cn-hongkong.fcapp.run/', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/other', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/?PRIVATE=1', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run:443/', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/..', 'https://synthetic-artdicohost-api.cn-hongkong.fcapp.run/?'].map(urlInternet => ({ httpTrigger: { urlInternet } }))]) {
    const value = fixture({ triggerInfo: () => ({ ...triggerInfo(), ...patch }) });
    await assert.rejects(deployFc(value.options), /FC HTTP trigger/);
    assert.equal(value.calls.includes('update'), false);
  }
});

test('an unverifiable or newly advanced main commit prevents the only code write', async () => {
  for (const head of [() => 'b'.repeat(40), count => count === 1 ? commit : 'b'.repeat(40)]) {
    const value = fixture({ head });
    await assert.rejects(deployFc(value.options), /current main/);
    assert.equal(value.calls.includes('update'), false);
  }
  const value = fixture();
  await assert.rejects(deployFc({ ...value.options, fetchHead: async () => { throw new Error('PRIVATE-SYNTHETIC-NETWORK'); } }), /current main/);
  assert.equal(value.calls.includes('update'), false);
});

test('FC authorization failures before the update never write or expose diagnostics', async () => {
  for (const method of ['getFunction', 'getTrigger']) {
    const value = fixture();
    value.client[method] = async () => { throw new Error('PRIVATE-SYNTHETIC-CREDENTIAL-DIAGNOSTIC'); };
    await assert.rejects(deployFc(value.options), error => !error.message.includes('PRIVATE-'));
    assert.equal(value.calls.includes('update'), false);
  }
});

test('success uploads exact verified bytes once, preserves settings and requires three signed matching health responses', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-fc-deploy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const summary = join(directory, 'summary.md');
  const value = fixture({ functionInfo: count => count === 2 ? { ...functionInfo(), lastUpdateStatus: 'InProgress' } : functionInfo() });
  const result = await deployFc({ ...value.options, env: { ...env, GITHUB_STEP_SUMMARY: summary } });
  assert.deepEqual(result, { functionName: 'artdicohost-api', commit, packageSha256: archiveHash, preflight: 'verified', businessReady: false });
  assert.equal(value.calls.filter(item => item === 'update').length, 1);
  assert.equal(value.calls.filter(item => item === 'health').length, 3);
  assert.deepEqual(value.calls.slice(0, 6), ['verify', 'head', 'function', 'trigger', 'head', 'update']);
  assert.ok(value.signals.every(signal => signal instanceof AbortSignal && signal.aborted));
  const text = await readFile(summary, 'utf8');
  assert.match(text, /Registration remains closed/);
  assert.ok(text.includes(commit) && text.includes(archiveHash));
  assert.doesNotMatch(text, /PRIVATE-|fcapp\.run|acs:fc/);
});

test('old instances and transient health errors reset the consecutive source-commit streak', async () => {
  const value = fixture({ health: count => { if (count === 3) throw new Error('PRIVATE-SYNTHETIC-READBACK'); return count === 1 ? { ...goodHealth(), body: { ...goodHealth().body, sourceCommit: 'b'.repeat(40) } } : goodHealth(); } });
  await deployFc(value.options);
  assert.equal(value.calls.filter(item => item === 'health').length, 6);
  assert.equal(value.calls.filter(item => item === 'update').length, 1);
});

test('unset runtime args may be omitted or null while their original snapshot remains preserved', async () => {
  for (const args of [undefined, null]) {
    const value = fixture({ functionInfo: () => ({ ...functionInfo(), customRuntimeConfig: { ...functionInfo().customRuntimeConfig, args } }) });
    assert.equal((await deployFc(value.options)).preflight, 'verified');
  }
});

test('a trigger changed during the update cannot be reported as verified even after matching health checks', async () => {
  for (const patch of [{ qualifier: 'production' },
    { triggerConfig: JSON.stringify({ authType: 'anonymous', methods: ['GET'] }) },
    { triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'POST', 'PUT'], disableURLInternet: false }) },
    { httpTrigger: { urlInternet: 'https://different-function.cn-hongkong.fcapp.run/' } }]) {
    const value = fixture({ triggerInfo: count => count === 1 ? triggerInfo() : { ...triggerInfo(), ...patch } });
    await assert.rejects(deployFc(value.options), /FC HTTP trigger/);
    assert.equal(value.calls.filter(item => item === 'health').length, 3);
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
  }
  const value = fixture({ triggerInfo: count => ({ ...triggerInfo(), lastModifiedTime: 'synthetic-' + count }) });
  assert.equal((await deployFc(value.options)).preflight, 'verified');
});

test('wrong health status, readiness scope or source commit exhausts a bounded poll without recording success', async () => {
  for (const health of [() => ({ ...goodHealth(), status: 503 }), () => ({ ...goodHealth(), body: { ...goodHealth().body, scope: 'business-ready' } }), () => ({ ...goodHealth(), body: { ...goodHealth().body, sourceCommit: 'b'.repeat(40) } })]) {
    const value = fixture({ health });
    await assert.rejects(deployFc(value.options), /three consecutive/);
    assert.equal(value.calls.filter(item => item === 'health').length, 16);
    assert.equal(value.calls.filter(item => item === 'wait').length, 15);
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
  }
});

test('update errors, failed state and changed runtime settings fail without rollback or success', async () => {
  for (const changes of [{ updateError: true }, { functionInfo: count => count > 1 ? { ...functionInfo(), lastUpdateStatus: 'Failed' } : functionInfo() },
    { functionInfo: count => count > 1 ? { ...functionInfo(), state: 'Failed' } : functionInfo() },
    { functionInfo: count => count > 1 ? { ...functionInfo(), role: 'PRIVATE-SYNTHETIC-CHANGED-ROLE' } : functionInfo() },
    { functionInfo: count => count > 1 ? { ...functionInfo(), environmentVariables: { PRIVATE_SYNTHETIC_SETTING: 'PRIVATE-SYNTHETIC-CHANGED-VALUE' } } : functionInfo() }]) {
    const value = fixture(changes);
    await assert.rejects(deployFc(value.options), error => !error.message.includes('PRIVATE-'));
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.includes('health'), false);
  }
});

test('trusted UpdateFunction diagnostics survive the client and deployment boundaries without retrying or exposing remote fields', async () => {
  const value = fixture();
  const requests = [];
  const client = createFcClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET },
    clock: () => new Date('2026-10-20T00:00:00Z'), nonce: () => '0123456789abcdef0123456789abcdef',
    async fetchFn(url, options) {
      requests.push({ url, method: options.method });
      assert.ok(url.startsWith(FC_API_ENDPOINT + '/2023-03-30/functions/artdicohost-api'));
      const body = options.method === 'PUT' ? { ErrorCode: 'AccessDenied', Message: 'PRIVATE-SYNTHETIC-MESSAGE', RequestId: 'PRIVATE-SYNTHETIC-REQUEST', details: env }
        : url.endsWith('/triggers/defaultTrigger') ? triggerInfo() : functionInfo();
      return new Response(JSON.stringify(body), { status: options.method === 'PUT' ? 403 : 200, headers: { 'content-type': 'application/json' } });
    } });
  await assert.rejects(deployFc({ ...value.options, client }), error => {
    assert.equal(error.message, 'FC code update failed; deployment was not verified. [operation=UpdateFunction phase=http status=403 code=AccessDenied]');
    assert.doesNotMatch(error.stack, /PRIVATE-|fcapp\.run|aliyuncs\.com|acs:fc|RequestId|details|Message/u);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
  assert.equal(requests.length, 3);
  assert.deepEqual(value.calls, ['verify', 'head', 'head']);
});

test('deployment wrappers ignore forged metadata and causes on arbitrary service failures', async () => {
  const trustedClient = createFcClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET },
    fetchFn: async () => new Response(JSON.stringify({ Code: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }) });
  let trusted;
  try { await trustedClient.getFunction(); } catch (error) { trusted = error; }
  class FcRequestError extends Error {}
  for (const error of [Object.assign(new FcRequestError('PRIVATE-SYNTHETIC-FAILURE'), { operation: 'UpdateFunction', phase: 'http', status: 403, code: 'AccessDenied' }),
    new Error('PRIVATE-SYNTHETIC-FAILURE', { cause: trusted })]) {
    const value = fixture();
    value.client.updateCode = async () => { value.calls.push('update'); throw error; };
    await assert.rejects(deployFc(value.options), result => {
      assert.equal(result.message, 'FC code update failed; deployment was not verified.');
      assert.doesNotMatch(result.stack, /PRIVATE-|Forbidden|AccessDenied/u);
      assert.equal(Object.hasOwn(result, 'cause'), false);
      return true;
    });
    assert.equal(value.calls.filter(call => call === 'update').length, 1);
  }
});
