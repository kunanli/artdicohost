import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deployFc } from '../scripts/deploy-fc.mjs';
import { createFcClient, FC_API_ENDPOINT } from '../scripts/fc-client.mjs';
import { MAX_FC_ZIP_BYTES, MAX_FC_REQUEST_BYTES, fcCodeRequestBytes } from '../scripts/fc-upload-limits.mjs';

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
  const reports = [];
  let reads = 0;
  const client = {
    async getFunction({ signal }) { calls.push('function'); signals.push(signal); reads++; return changes.functionInfo ? changes.functionInfo(reads) : functionInfo(); },
    async getTrigger({ signal }) { calls.push('trigger'); signals.push(signal); return changes.triggerInfo ? changes.triggerInfo(calls.filter(item => item === 'trigger').length) : triggerInfo(); },
    async updateCode(bytes, { signal }) { calls.push('update'); signals.push(signal); assert.equal(bytes, archive); if (changes.updateError) throw new Error('PRIVATE-SYNTHETIC-UPDATE-ERROR'); },
    async checkHealth(url, { signal }) {
      const before = !calls.includes('update');
      calls.push(before ? 'health-before' : 'health'); signals.push(signal);
      assert.equal(url, triggerInfo().httpTrigger.urlInternet);
      return before ? changes.beforeHealth ? changes.beforeHealth() : goodHealth()
        : changes.health ? changes.health(calls.filter(item => item === 'health').length) : goodHealth();
    },
  };
  const options = {
    directory: '/synthetic-publication', repositoryDirectory: '/synthetic-repository', env,
    client, async verifyPackage(input) { calls.push('verify'); assert.deepEqual(input, { directory: '/synthetic-publication', expectedCommit: commit, repositoryDirectory: '/synthetic-repository' }); return { zipBytes: archive, manifest: { sourceCommit: commit, archive: { sha256: archiveHash } } }; },
    async fetchHead(url, settings) { calls.push('head'); signals.push(settings.signal); assert.equal(url, 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main'); return { ok: true, async json() { return { object: { sha: changes.head ? changes.head(calls.filter(item => item === 'head').length) : commit } }; } }; },
    async wait(milliseconds, { signal }) { calls.push('wait'); signals.push(signal); assert.equal(milliseconds, 2000); },
    report(line) { reports.push(line); },
  };
  return { calls, signals, reports, client, options };
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

test('the fixed code request budget refuses an oversized artifact before any remote inspection or update', async () => {
  const value = fixture();
  const oversized = Buffer.from(archive);
  Object.defineProperty(oversized, 'byteLength', { value: MAX_FC_ZIP_BYTES + 1 });
  await assert.rejects(deployFc({ ...value.options,
    env: { ...env, MAX_FC_ZIP_BYTES: String(64 * 1024 * 1024), MAX_FC_REQUEST_BYTES: String(MAX_FC_REQUEST_BYTES * 2) },
    verifyPackage: async () => ({ zipBytes: oversized, manifest: { sourceCommit: commit, archive: { sha256: archiveHash }, maxZipBytes: 64 * 1024 * 1024 } }),
  }), error => !error.message.includes('PRIVATE-'));
  assert.deepEqual(value.calls, [], 'neither GitHub head, FC inspection nor update can run');
});

test('the request budget is rechecked immediately before the only FC code write', async () => {
  let length = archive.byteLength;
  const changing = Buffer.from(archive);
  Object.defineProperty(changing, 'byteLength', { get: () => length });
  const value = fixture({ head: count => { if (count === 2) length = MAX_FC_ZIP_BYTES + 1; return commit; } });
  await assert.rejects(deployFc({ ...value.options, verifyPackage: async () => ({ zipBytes: changing, manifest: { sourceCommit: commit, archive: { sha256: archiveHash } } }) }), /fixed request budget/u);
  assert.deepEqual(value.calls, ['head', 'function', 'trigger', 'health-before', 'head']);
  assert.equal(value.calls.includes('update'), false);
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
  assert.deepEqual(value.calls.slice(0, 7), ['verify', 'head', 'function', 'trigger', 'health-before', 'head', 'update']);
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
  assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
});

test('pre-update reports retain an old full commit and only verified publication facts without remote or configuration data', async () => {
  const oldCommit = 'b'.repeat(40);
  const value = fixture({
    functionInfo: () => ({ ...functionInfo(), Message: 'PRIVATE-SYNTHETIC-MESSAGE', unknown: 'PRIVATE-SYNTHETIC-UNKNOWN' }),
    beforeHealth: () => ({ ...goodHealth(), body: { ...goodHealth().body, sourceCommit: oldCommit, Message: 'PRIVATE-SYNTHETIC-MESSAGE', environmentVariables: env, role: 'PRIVATE-SYNTHETIC-ROLE', url: triggerInfo().httpTrigger.urlInternet, unknown: 'PRIVATE-SYNTHETIC-UNKNOWN' } }),
  });
  await deployFc(value.options);
  assert.equal(value.calls.filter(item => item === 'health-before').length, 1);
  assert.equal(value.calls.filter(item => item === 'health').length, 3);
  assert.equal(value.calls.filter(item => item === 'update').length, 1);
  assert.deepEqual(value.reports, [
    'FC pre-update observation: ' + JSON.stringify({ state: 'Active', update: 'Successful', statePresence: 'recognized', updatePresence: 'recognized', signedHealth: 'process-only', sourceCommit: oldCommit }),
    'FC publication verified: ' + JSON.stringify({ sourceCommit: commit, zipBytes: archive.byteLength, jsonRequestBytes: fcCodeRequestBytes(archive.byteLength), packageSha256: archiveHash }),
    'FC post-update metadata: ' + JSON.stringify({ state: 'Active', update: 'Successful', statePresence: 'recognized', updatePresence: 'recognized' }),
    ...[1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`),
  ]);
  assert.doesNotMatch(value.reports.join('\n'), /PRIVATE-|https?:|acs:fc|Message|unknown|environment|role|url/u);
});

test('a matching pre-update observation cannot replace any of the three post-update health matches', async () => {
  const value = fixture({ health: count => count <= 2 ? goodHealth() : { ...goodHealth(), body: { ...goodHealth().body, sourceCommit: 'b'.repeat(40) } } });
  await assert.rejects(deployFc(value.options), /three consecutive/u);
  assert.equal(value.calls.filter(item => item === 'health-before').length, 1);
  assert.equal(value.calls.filter(item => item === 'health').length, 16);
  assert.equal(value.calls.filter(item => item === 'update').length, 1);
  assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 2].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
  assert.equal(value.reports.some(line => line.startsWith('FC signed /healthz match 3/3:')), false);
});

test('an initial FC update in progress is observed safely before refusing another code mutation', async () => {
  for (const patch of [{ lastUpdateStatus: 'InProgress' }, { state: 'Pending' }, { state: 'Creating' }]) {
    const value = fixture({ functionInfo: () => ({ ...functionInfo(), ...patch }) });
    await assert.rejects(deployFc(value.options), error => error.message === 'FC reports an update still in progress; no new code was uploaded.');
    assert.deepEqual(value.calls, ['verify', 'head', 'function', 'trigger', 'health-before']);
    assert.equal(value.reports.length, 1);
    assert.deepEqual(JSON.parse(value.reports[0].slice('FC pre-update observation: '.length)), {
      state: patch.state ?? 'Active', update: patch.lastUpdateStatus ?? 'Successful', statePresence: 'recognized', updatePresence: 'recognized', signedHealth: 'process-only', sourceCommit: commit,
    });
    assert.doesNotMatch(value.reports[0], /PRIVATE-|https?:|acs:fc|Message|role|environment/u);
  }
});

test('pre-update metadata distinguishes own missing, null and unrecognized fields without serializing their values', async () => {
  const cases = [
    [value => { delete value.state; delete value.lastUpdateStatus; }, 'unknown', 'unknown', 'absent', 'absent'],
    [value => { value.state = null; value.lastUpdateStatus = null; }, 'unknown', 'unknown', 'null', 'null'],
    [value => { value.state = 'PRIVATE-SYNTHETIC-STATE'; value.lastUpdateStatus = 'PRIVATE-SYNTHETIC-UPDATE'; }, 'unknown', 'unknown', 'unrecognized', 'unrecognized'],
    [value => { value.state = ['Active', 'PRIVATE-SYNTHETIC-STATE']; value.lastUpdateStatus = { status: 'Successful', secret: 'PRIVATE-SYNTHETIC-UPDATE' }; }, 'unknown', 'unknown', 'unrecognized', 'unrecognized'],
    [value => { value.state = undefined; value.lastUpdateStatus = false; }, 'unknown', 'unknown', 'unrecognized', 'unrecognized'],
    [value => { delete value.state; }, 'unknown', 'Successful', 'absent', 'recognized'],
    [value => { value.lastUpdateStatus = null; }, 'Active', 'unknown', 'recognized', 'null'],
  ];
  for (const [mutate, state, update, statePresence, updatePresence] of cases) {
    const value = fixture({ functionInfo: count => { const info = functionInfo(); if (count === 1) mutate(info); return info; } });
    await deployFc(value.options);
    const observation = JSON.parse(value.reports[0].slice('FC pre-update observation: '.length));
    assert.deepEqual(observation, { state, update, statePresence, updatePresence, signedHealth: 'process-only', sourceCommit: commit });
    assert.doesNotMatch(value.reports.join('\n'), /PRIVATE-|secret|https?:|acs:fc/u);
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.filter(item => item === 'health').length, 3);
  }
});

test('partial, unrecognized or in-progress metadata never enables the absence verification path', async () => {
  for (const mutate of [value => { delete value.state; }, value => { delete value.lastUpdateStatus; },
    value => { value.state = null; }, value => { value.lastUpdateStatus = null; },
    value => { value.state = undefined; value.lastUpdateStatus = undefined; },
    value => { value.state = ['Active']; value.lastUpdateStatus = { value: 'Successful' }; },
    value => { value.state = 'PRIVATE-SYNTHETIC-STATE'; delete value.lastUpdateStatus; },
    value => { value.state = 'Pending'; }, value => { value.state = 'Creating'; }, value => { value.lastUpdateStatus = 'InProgress'; }]) {
    const value = fixture({ functionInfo: count => { const info = functionInfo(); if (count > 1) mutate(info); return info; } });
    await assert.rejects(deployFc(value.options), /three consecutive/u);
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.filter(item => item === 'health-before').length, 1);
    assert.equal(value.calls.filter(item => item === 'health').length, 0);
    assert.equal(value.reports.some(line => line.startsWith('FC signed /healthz match ')), false);
    const metadata = value.reports.filter(line => line.startsWith('FC post-update metadata: '));
    assert.equal(metadata.length, 1);
    assert.doesNotMatch(metadata[0], /PRIVATE-|https?:|acs:fc|value/u);
  }
});

test('only two absent or null metadata fields allow three signed exact-source proofs after a single update', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'artdico-fc-deploy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [index, [stateNull, updateNull]] of [[false, false], [false, true], [true, false], [true, true]].entries()) {
    const value = fixture({ functionInfo: () => {
      const info = functionInfo();
      if (stateNull) info.state = null; else delete info.state;
      if (updateNull) info.lastUpdateStatus = null; else delete info.lastUpdateStatus;
      return info;
    } });
    const summary = join(directory, `summary-${index}.md`);
    const result = await deployFc({ ...value.options, env: { ...env, GITHUB_STEP_SUMMARY: summary } });
    assert.deepEqual(result, { functionName: 'artdicohost-api', commit, packageSha256: archiveHash, preflight: 'verified', businessReady: false, functionMetadata: 'not-reported' });
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.filter(item => item === 'health').length, 3);
    const metadata = value.reports.filter(line => line.startsWith('FC post-update metadata: '));
    assert.deepEqual(metadata, ['FC post-update metadata: ' + JSON.stringify({ state: 'unknown', update: 'unknown', statePresence: stateNull ? 'null' : 'absent', updatePresence: updateNull ? 'null' : 'absent' })]);
    assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
    const text = await readFile(summary, 'utf8');
    assert.match(text, /Function state\/update metadata was not reported/u);
    assert.match(text, /Active\/Successful was not inferred/u);
    assert.match(text, /Three consecutive signed process-only health checks matched this commit/u);
    assert.match(text, /Registration remains closed/u);
    assert.doesNotMatch(text, /PRIVATE-|https?:|acs:fc/u);
  }
});

test('absent metadata never substitutes for exact signed health, unchanged settings or the final trigger', async () => {
  const absentInfo = () => { const info = functionInfo(); delete info.state; delete info.lastUpdateStatus; return info; };
  const badHealth = [
    () => ({ ...goodHealth(), status: 503 }),
    () => ({ ...goodHealth(), body: { ...goodHealth().body, status: 'error' } }),
    () => ({ ...goodHealth(), body: { ...goodHealth().body, scope: 'business-ready' } }),
    () => ({ ...goodHealth(), body: { ...goodHealth().body, sourceCommit: 'b'.repeat(40) } }),
    () => { throw new Error('PRIVATE-SYNTHETIC-PROBE'); },
  ];
  for (const health of badHealth) {
    const value = fixture({ functionInfo: absentInfo, health });
    await assert.rejects(deployFc(value.options), error => /three consecutive/u.test(error.message) && !error.message.includes('PRIVATE-'));
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.filter(item => item === 'health').length, 16);
    assert.equal(value.reports.some(line => line.startsWith('FC signed /healthz match ')), false);
  }
  const changedSettings = fixture({ functionInfo: count => count > 1 ? { ...absentInfo(), role: 'PRIVATE-SYNTHETIC-CHANGED-ROLE' } : absentInfo() });
  await assert.rejects(deployFc(changedSettings.options), /runtime, environment or role changed/u);
  assert.equal(changedSettings.calls.filter(item => item === 'health').length, 0);
  const changedTrigger = fixture({ functionInfo: absentInfo, triggerInfo: count => count > 1 ? { ...triggerInfo(), qualifier: 'production' } : triggerInfo() });
  await assert.rejects(deployFc(changedTrigger.options), /FC HTTP trigger/u);
  assert.equal(changedTrigger.calls.filter(item => item === 'update').length, 1);
  assert.equal(changedTrigger.calls.filter(item => item === 'health').length, 3);
  for (const patch of [{ state: 'Failed', lastUpdateStatus: null }, { state: null, lastUpdateStatus: 'Failed' }]) {
    const failed = fixture({ functionInfo: count => count > 1 ? { ...functionInfo(), ...patch } : functionInfo() });
    await assert.rejects(deployFc(failed.options), /reported a failed code update/u);
    assert.equal(failed.calls.filter(item => item === 'update').length, 1);
    assert.equal(failed.calls.filter(item => item === 'health').length, 0);
  }
});

test('absence metadata is reported only when used in the final uninterrupted success streak', async () => {
  const value = fixture({ functionInfo: count => {
    const info = functionInfo();
    if (count === 2) { delete info.state; delete info.lastUpdateStatus; }
    return info;
  }, health: count => count === 1 ? { ...goodHealth(), body: { ...goodHealth().body, sourceCommit: 'b'.repeat(40) } } : goodHealth() });
  const result = await deployFc(value.options);
  assert.equal(Object.hasOwn(result, 'functionMetadata'), false);
  assert.equal(value.calls.filter(item => item === 'update').length, 1);
  assert.equal(value.calls.filter(item => item === 'health').length, 4);
});

test('failed or malformed pre-update health is only an observation and never exposes arbitrary error metadata', async () => {
  const healthClient = createFcClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET },
    fetchFn: async url => new Response(JSON.stringify(url.startsWith(FC_API_ENDPOINT) ? triggerInfo() : { Code: 'Forbidden', Message: 'PRIVATE-SYNTHETIC-MESSAGE' }),
      { status: url.startsWith(FC_API_ENDPOINT) ? 200 : 403, headers: { 'content-type': 'application/json' } }) });
  await healthClient.getTrigger();
  let trusted;
  try { await healthClient.checkHealth(); } catch (error) { trusted = error; }
  assert.ok(trusted instanceof Error);
  const cases = [
    [() => { throw Object.assign(new Error('PRIVATE-SYNTHETIC-ERROR'), { operation: 'CheckHealth', status: 403, code: 'Forbidden', phase: 'http', cause: trusted }); }, undefined],
    [() => { throw trusted; }, 'operation=CheckHealth phase=http status=403 code=Forbidden'],
    [() => ({ ...goodHealth(), status: 503, body: { ...goodHealth().body, sourceCommit: 'PRIVATE-SYNTHETIC-COMMIT' } }), undefined],
    ...[null, ['b'.repeat(40)], { value: 'b'.repeat(40) }, 'PRIVATE-SYNTHETIC-COMMIT'].map(sourceCommit => [() => ({ ...goodHealth(), body: { ...goodHealth().body, sourceCommit } }), undefined]),
  ];
  for (const [beforeHealth, diagnostic] of cases) {
    const value = fixture({ beforeHealth, functionInfo: count => count === 1 ? { ...functionInfo(), state: 'PRIVATE-SYNTHETIC-STATE', lastUpdateStatus: 'PRIVATE-SYNTHETIC-UPDATE' } : functionInfo() });
    await deployFc(value.options);
    const observation = JSON.parse(value.reports[0].slice('FC pre-update observation: '.length));
    assert.deepEqual(observation, { state: 'unknown', update: 'unknown', statePresence: 'unrecognized', updatePresence: 'unrecognized', signedHealth: 'not-verified', ...(diagnostic ? { diagnostic } : {}) });
    assert.equal(value.calls.filter(item => item === 'update').length, 1);
    assert.equal(value.calls.filter(item => item === 'health-before').length, 1);
    assert.equal(value.calls.filter(item => item === 'health').length, 3);
    assert.deepEqual(value.reports.filter(line => line.startsWith('FC signed /healthz match ')), [1, 2, 3].map(count => `FC signed /healthz match ${count}/3: ${commit}`));
    assert.doesNotMatch(value.reports.join('\n'), /PRIVATE-|https?:|acs:fc|Message|cause/u);
  }
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
      const health = url === new URL('/healthz', triggerInfo().httpTrigger.urlInternet).href;
      assert.ok(health || url.startsWith(FC_API_ENDPOINT + '/2023-03-30/functions/artdicohost-api'));
      const body = options.method === 'PUT' ? { ErrorCode: 'AccessDenied', Message: 'PRIVATE-SYNTHETIC-MESSAGE', RequestId: 'PRIVATE-SYNTHETIC-REQUEST', details: env }
        : health ? goodHealth().body : url.endsWith('/triggers/defaultTrigger') ? triggerInfo() : functionInfo();
      return new Response(JSON.stringify(body), { status: options.method === 'PUT' ? 403 : 200, headers: { 'content-type': 'application/json' } });
    } });
  await assert.rejects(deployFc({ ...value.options, client }), error => {
    assert.equal(error.message, 'FC code update failed; deployment was not verified. [operation=UpdateFunction phase=http status=403 code=AccessDenied]');
    assert.doesNotMatch(error.stack, /PRIVATE-|fcapp\.run|aliyuncs\.com|acs:fc|RequestId|details|Message/u);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
  assert.equal(requests.length, 4);
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
