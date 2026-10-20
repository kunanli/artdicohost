import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployCloudContent } from '../scripts/deploy-cloud-content.mjs';
import { MAX_FC_ZIP_BYTES, fcCodeRequestBytes } from '../scripts/fc-upload-limits.mjs';

const commit = 'a'.repeat(40), account = '1954121651395178';
const env = { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_SHA: commit,
  ARTDICO_FC_DEPLOY_ENABLED: 'true', ARTDICO_FC_ACCOUNT_ID: account, FC_ACCESS_KEY_ID: 'PRIVATE-SYNTHETIC-ID', FC_ACCESS_KEY_SECRET: 'PRIVATE-SYNTHETIC-SECRET' };
const archive = Buffer.from('synthetic reviewed candidate archive'), hash = createHash('sha256').update(archive).digest('hex');
const manifest = () => ({ schemaVersion: 1, kind: 'fc-cloud-content-candidate', sourceCommit: commit, archive: { path: 'artdicohost-cloud-content-candidate.zip', sha256: hash } });
const info = () => ({ functionName: 'artdicohost-api', functionArn: `acs:fc:cn-hongkong:${account}:functions/artdicohost-api`, runtime: 'custom.debian11',
  customRuntimeConfig: { command: ['/code/bootstrap'], args: [], port: 9000 }, environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'false', PRIVATE_SYNTHETIC_CONFIG: 'PRIVATE-SYNTHETIC-VALUE' },
  role: `acs:ram::${account}:role/artdicohost-content-runtime`, memorySize: 512, timeout: 60, instanceConcurrency: 20,
  state: 'Active', lastUpdateStatus: 'Successful', codeChecksum: '1234567890' });
const trigger = () => ({ triggerType: 'http', qualifier: 'LATEST', triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'HEAD'], disableURLInternet: false }),
  httpTrigger: { urlInternet: 'https://synthetic-content.cn-hongkong.fcapp.run/' } });
const health = (sourceCommit = commit) => ({ status: 200, body: { status: 'ok', scope: 'process-only', sourceCommit } });

function fixture(changes = {}) {
  const calls = [], reports = [], signals = []; let metadataReads = 0, triggerReads = 0, heads = 0, healthReads = 0, updated = false;
  const client = {
    async getFunction({ signal }) { calls.push('function'); signals.push(signal); return changes.info ? changes.info(++metadataReads, updated) : info(); },
    async getTrigger({ signal }) { calls.push('trigger'); signals.push(signal); return changes.trigger ? changes.trigger(++triggerReads, updated) : trigger(); },
    async updateCode(bytes, { signal }) { calls.push('update'); signals.push(signal); assert.equal(bytes, archive); updated = true; if (changes.updateError) throw new Error('PRIVATE-SYNTHETIC-UNKNOWN-ACK'); },
    async checkHealth(url, { signal }) { calls.push(updated ? 'health' : 'health-before'); signals.push(signal); assert.equal(url, trigger().httpTrigger.urlInternet); return updated ? changes.health ? changes.health(++healthReads) : health() : changes.beforeHealth ? changes.beforeHealth() : health('b'.repeat(40)); },
  };
  const options = { directory: '/synthetic-candidate', repositoryDirectory: '/synthetic-repository', env, client,
    async verifyPackage(input) { calls.push('verify'); assert.deepEqual(input, { directory: '/synthetic-candidate', repositoryDirectory: '/synthetic-repository', expectedCommit: commit }); return { zipBytes: archive, manifest: manifest() }; },
    async fetchHead(url, settings) { calls.push('head'); signals.push(settings.signal); assert.equal(url, 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main'); const sha = changes.head ? changes.head(++heads, updated) : commit; return { ok: true, json: async () => ({ object: { sha } }) }; },
    async wait(milliseconds, { signal }) { calls.push('wait'); signals.push(signal); assert.equal(milliseconds, 2000); }, report: line => reports.push(line) };
  return { calls, reports, signals, client, options };
}

test('cloud code deployment accepts only the enabled exact-repository current-main push and fixed account', async () => {
  for (const patch of [{ GITHUB_ACTIONS: '' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_REPOSITORY: 'other/artdicohost' }, { GITHUB_SHA: 'main' }, { GITHUB_SHA: { toString: () => commit } }, { ARTDICO_FC_DEPLOY_ENABLED: 'false' },
    { FC_ACCESS_KEY_ID: '' }, { FC_ACCESS_KEY_SECRET: '' }, { ARTDICO_FC_ACCOUNT_ID: '1234567890123456' }]) {
    const value = fixture(); await assert.rejects(deployCloudContent({ ...value.options, env: { ...env, ...patch } })); assert.deepEqual(value.calls, []);
  }
});

test('candidate kind, full source commit and exact archive hash are verified before inspecting any cloud resource', async () => {
  for (const mutate of [value => { value.schemaVersion = 2; }, value => { value.kind = 'fc-preflight'; }, value => { value.sourceCommit = 'b'.repeat(40); },
    value => { value.archive.path = 'artdicohost-fc-preflight.zip'; }, value => { value.archive.sha256 = '0'.repeat(64); }]) {
    const value = fixture(), changed = manifest(); mutate(changed);
    await assert.rejects(deployCloudContent({ ...value.options, verifyPackage: async () => ({ zipBytes: archive, manifest: changed }) })); assert.deepEqual(value.calls, []);
  }
  const value = fixture(); await assert.rejects(deployCloudContent({ ...value.options, verifyPackage: async () => { throw new Error('PRIVATE-SYNTHETIC-ARTIFACT'); } }), error => !error.message.includes('PRIVATE-')); assert.deepEqual(value.calls, []);
});

test('missing or wrong dedicated role, enabled or ambiguous business flag and changed runtime are refused before update', async () => {
  const invalid = [{ role: undefined }, { role: 'acs:ram::1954121651395178:role/another-project' }, { role: 'PRIVATE-SYNTHETIC-ROLE' },
    { functionName: 'other-function' }, { functionArn: `acs:fc:cn-shanghai:${account}:functions/artdicohost-api` }, { runtime: 'nodejs20' },
    { customRuntimeConfig: { command: ['/code/other'], port: 9000 } }, { customRuntimeConfig: { command: ['/code/bootstrap'], args: ['other'], port: 9000 } },
    { customRuntimeConfig: { command: ['/code/bootstrap'], port: 80 } }, { environmentVariables: [] },
    ...['true', 'TRUE', '', true, null, 0].map(flag => ({ environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: flag } })),
    { environmentVariables: { ARTDICO_FC_PORT: '9001' } }];
  for (const patch of invalid) {
    const value = fixture({ info: () => ({ ...info(), ...patch }) });
    await assert.rejects(deployCloudContent(value.options), /approved closed cloud-content runtime/); assert.equal(value.calls.includes('update'), false);
  }
  for (const variables of [undefined, null, {}, { ARTDICO_CLOUD_CONTENT_ENABLED: 'false' }]) {
    const value = fixture({ info: () => ({ ...info(), environmentVariables: variables }) });
    assert.equal((await deployCloudContent(value.options)).cloudContentEnabled, false);
  }
});

test('latest metadata is re-read immediately before the single mutation and refuses concurrent changes or updates', async () => {
  for (const patch of [{ state: 'Pending' }, { state: 'Creating' }, { lastUpdateStatus: 'InProgress' }, { memorySize: 1024 },
    { environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'true' } }, { role: 'PRIVATE-SYNTHETIC-CHANGED-ROLE' }]) {
    const value = fixture({ info: count => ({ ...info(), ...(count === 2 ? patch : {}) }) });
    await assert.rejects(deployCloudContent(value.options)); assert.deepEqual(value.calls, ['verify', 'head', 'function', 'trigger', 'health-before', 'function']);
  }
  const initiallyUpdating = fixture({ info: () => ({ ...info(), lastUpdateStatus: 'InProgress' }) });
  await assert.rejects(deployCloudContent(initiallyUpdating.options), /still in progress/); assert.equal(initiallyUpdating.calls.includes('update'), false);
});

test('main advancing before upload prevents mutation and main advancing after upload prevents a false current-main success', async () => {
  for (const nth of [1, 2, 3]) {
    const value = fixture({ head: count => count >= nth ? 'b'.repeat(40) : commit });
    await assert.rejects(deployCloudContent(value.options), /current main/);
    assert.equal(value.calls.filter(call => call === 'update').length, nth === 3 ? 1 : 0);
  }
});

test('only the preserved signed LATEST Hong Kong trigger is accepted', async () => {
  for (const patch of [{ qualifier: 'production' }, { triggerType: 'timer' }, { triggerConfig: JSON.stringify({ authType: 'anonymous', methods: ['GET'] }) },
    { triggerConfig: JSON.stringify({ authType: 'function', methods: ['POST'] }) }, { triggerConfig: '{PRIVATE-SYNTHETIC-CONFIG' },
    ...['http://synthetic-content.cn-hongkong.fcapp.run/', 'https://synthetic-content.cn-shanghai.fcapp.run/', 'https://user:password@synthetic-content.cn-hongkong.fcapp.run/', 'https://synthetic-content.cn-hongkong.fcapp.run/?private=1', 'https://api.artdico.host/'].map(urlInternet => ({ httpTrigger: { urlInternet } }))]) {
    const value = fixture({ trigger: () => ({ ...trigger(), ...patch }) }); await assert.rejects(deployCloudContent(value.options), /FC HTTP trigger/); assert.equal(value.calls.includes('update'), false);
  }
});

test('success publishes exact code once, preserves configuration and separately proves three signed process-only source matches', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-cloud-code-deploy-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const summary = join(directory, 'summary.md'), value = fixture();
  const result = await deployCloudContent({ ...value.options, env: { ...env, GITHUB_STEP_SUMMARY: summary } });
  assert.deepEqual(result, { functionName: 'artdicohost-api', commit, packageSha256: hash, code: 'verified', cloudContentEnabled: false, businessReady: false });
  assert.equal(value.calls.filter(call => call === 'update').length, 1); assert.equal(value.calls.filter(call => call === 'health').length, 3);
  assert.deepEqual(value.calls.slice(0, 8), ['verify', 'head', 'function', 'trigger', 'health-before', 'function', 'head', 'update']);
  assert.equal(value.calls.at(-1), 'head'); assert.ok(value.signals.every(signal => signal instanceof AbortSignal && signal.aborted));
  assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
  const text = await readFile(summary, 'utf8'); assert.match(text, /Cloud content remains disabled/); assert.match(text, /codeChecksum is CRC64/); assert.match(text, /local artifact hash/);
  assert.ok(text.includes(commit) && text.includes(hash)); assert.doesNotMatch(text, /PRIVATE-|fcapp\.run|acs:ram|acs:fc/);
  assert.doesNotMatch(value.reports.join('\n'), /PRIVATE-|fcapp\.run|acs:ram|acs:fc/);
});

test('old instance responses and transient errors reset the full-source streak, and pre-upload health never counts', async () => {
  const value = fixture({ health: count => { if (count === 3) throw new Error('PRIVATE-SYNTHETIC-HEALTH'); return count === 1 ? health('b'.repeat(40)) : health(); }, beforeHealth: () => health() });
  await deployCloudContent(value.options); assert.equal(value.calls.filter(call => call === 'health').length, 6); assert.equal(value.calls.filter(call => call === 'health-before').length, 1);
  assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
  const incomplete = fixture({ beforeHealth: () => health(), health: count => count <= 2 ? health() : health('b'.repeat(40)) });
  await assert.rejects(deployCloudContent(incomplete.options), /three consecutive/); assert.equal(incomplete.calls.filter(call => call === 'update').length, 1);
});

test('missing and null metadata may use signed health but never infer Active/Successful, while partial metadata remains unverified', async () => {
  for (const mode of ['absent', 'null']) {
    const value = fixture({ info: () => { const current = info(); if (mode === 'absent') { delete current.state; delete current.lastUpdateStatus; } else { current.state = null; current.lastUpdateStatus = null; } return current; } });
    const result = await deployCloudContent(value.options); assert.equal(result.functionMetadata, 'not-reported');
    assert.equal(value.calls.filter(call => call === 'health').length, 3);
    const observation = JSON.parse(value.reports.find(line => line.startsWith('FC post-update metadata: ')).slice('FC post-update metadata: '.length));
    assert.equal(observation.state, 'unknown'); assert.equal(observation.update, 'unknown');
  }
  for (const patch of [{ state: null }, { lastUpdateStatus: null }, { state: 'PRIVATE-SYNTHETIC-STATE', lastUpdateStatus: null }]) {
    const value = fixture({ info: (_count, updated) => ({ ...info(), ...(updated ? patch : {}) }) });
    await assert.rejects(deployCloudContent(value.options), /three consecutive/); assert.equal(value.calls.filter(call => call === 'health').length, 0);
  }
});

test('changed runtime/configuration/role or trigger after upload prevents success; CRC64 changing alone is expected', async () => {
  for (const patch of [{ memorySize: 1024 }, { timeout: 120 }, { instanceConcurrency: 40 }, { vpcConfig: { PRIVATE_SYNTHETIC: true } }, { disableInjectCredentials: true }, { enableLongLiving: true }, { instanceIsolationMode: 'SHARE' },
    { environmentVariables: { ARTDICO_CLOUD_CONTENT_ENABLED: 'false', OTHER_PRIVATE_SETTING: 'PRIVATE-SYNTHETIC-VALUE' } },
    { role: 'PRIVATE-SYNTHETIC-CHANGED-ROLE' }, { state: 'Failed' }, { lastUpdateStatus: 'Failed' }]) {
    const value = fixture({ info: (_count, updated) => ({ ...info(), ...(updated ? patch : {}) }) });
    await assert.rejects(deployCloudContent(value.options), error => !error.message.includes('PRIVATE-')); assert.equal(value.calls.filter(call => call === 'update').length, 1);
  }
  const changedTrigger = fixture({ trigger: (count) => ({ ...trigger(), ...(count > 1 ? { triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET', 'POST'] }) } : {}) }) });
  await assert.rejects(deployCloudContent(changedTrigger.options), /HTTP trigger changed/);
  const crc = fixture({ info: (_count, updated) => ({ ...info(), codeChecksum: updated ? '987654321' : '1234567890' }) });
  assert.equal((await deployCloudContent(crc.options)).code, 'verified');
});

test('unknown upload acknowledgement fails without retries or success, and fixed error handling suppresses secrets', async () => {
  const value = fixture({ updateError: true });
  await assert.rejects(deployCloudContent(value.options), error => /not confirmed.*no retry/u.test(error.message) && !error.message.includes('PRIVATE-'));
  assert.equal(value.calls.filter(call => call === 'update').length, 1); assert.equal(value.calls.filter(call => call === 'health').length, 0);
  assert.equal(value.reports.some(line => line.includes('match 3/3')), false);
  for (const method of ['getFunction', 'getTrigger']) {
    const denied = fixture(); denied.client[method] = async () => { throw new Error('PRIVATE-SYNTHETIC-AUTHORIZATION'); };
    await assert.rejects(deployCloudContent(denied.options), error => !error.message.includes('PRIVATE-')); assert.equal(denied.calls.includes('update'), false);
  }
});

test('fixed code request budget is enforced before inspection and again immediately before code publication', async () => {
  const initial = fixture(), oversized = Buffer.from(archive); Object.defineProperty(oversized, 'byteLength', { value: MAX_FC_ZIP_BYTES + 1 });
  await assert.rejects(deployCloudContent({ ...initial.options, verifyPackage: async () => ({ zipBytes: oversized, manifest: manifest() }) })); assert.deepEqual(initial.calls, []);
  let size = archive.length; const changing = Buffer.from(archive); Object.defineProperty(changing, 'byteLength', { get: () => size });
  const late = fixture({ head: count => { if (count === 2) size = MAX_FC_ZIP_BYTES + 1; return commit; } });
  await assert.rejects(deployCloudContent({ ...late.options, verifyPackage: async () => ({ zipBytes: changing, manifest: manifest() }) }), /fixed request budget/); assert.equal(late.calls.includes('update'), false);
  assert.equal(fcCodeRequestBytes(archive.length), 4 * Math.ceil(archive.length / 3) + Buffer.byteLength('{"code":{"zipFile":""}}'));
});
