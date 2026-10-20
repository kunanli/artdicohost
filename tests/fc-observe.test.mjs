import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFcClient, FC_API_ENDPOINT } from '../scripts/fc-client.mjs';
import { EXPECTED_MAIN, observeFc, requireObservationContext } from '../scripts/observe-fc.mjs';

const credentials = { accessKeyId: 'SYNTHETICKEY', accessKeySecret: 'SYNTHETIC-SECRET' };
const privateValue = 'PRIVATE-SYNTHETIC-CONTENT';
const uid = '111222333444';
const triggerUrl = 'https://artdicohost-observation-synthetic.cn-hongkong.fcapp.run';
const mainUrl = 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main';
const env = {
  GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/diag/fc-observe-dff3',
  GITHUB_REPOSITORY: 'kunanli/artdicohost', GITHUB_SHA: 'a'.repeat(40),
  ARTDICO_FC_ACCOUNT_ID: uid, FC_ACCESS_KEY_ID: credentials.accessKeyId,
  FC_ACCESS_KEY_SECRET: credentials.accessKeySecret, GITHUB_TOKEN: 'SYNTHETIC-GITHUB-TOKEN',
};
const functionData = () => ({
  functionName: 'artdicohost-api', functionArn: `acs:fc:cn-hongkong:${uid}:functions/artdicohost-api`,
  runtime: 'custom.debian11', customRuntimeConfig: { command: ['/code/bootstrap'], port: 9000, args: [] },
  environmentVariables: { SECRET: privateValue }, role: privateValue,
  codeSize: 29_507_159, codeChecksum: '18446744073709551615',
});
const triggerData = () => ({ triggerType: 'http', qualifier: 'LATEST',
  triggerConfig: JSON.stringify({ authType: 'function', methods: ['GET'], disableURLInternet: false }),
  httpTrigger: { urlInternet: triggerUrl },
});
const healthData = () => ({ status: 200, body: { status: 'ok', scope: 'process-only', sourceCommit: EXPECTED_MAIN } });
const json = (body, options = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, ...options });

function fixture(overrides = {}) {
  const calls = [], lines = [];
  const client = {
    getFunction: async () => { calls.push('function'); return functionData(); },
    getTrigger: async () => { calls.push('trigger'); return triggerData(); },
    checkHealth: async origin => { assert.equal(origin, triggerUrl); calls.push('health'); return healthData(); },
    updateCode: () => assert.fail('The observer must never upload code'),
    ...overrides,
  };
  const fetchHead = async (url, options) => {
    calls.push('main'); assert.equal(url, mainUrl); assert.equal(options.method, 'GET');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers.Authorization, 'Bearer SYNTHETIC-GITHUB-TOKEN');
    return json({ object: { sha: EXPECTED_MAIN } });
  };
  return { calls, lines, client, fetchHead, report: line => lines.push(line) };
}

async function rejected(options) {
  let caught;
  await assert.rejects(() => observeFc({ env, ...options }), error => {
    caught = error;
    assert.match(error.message, /^(?:FC|Current main|Cannot verify|Only the fixed|Read-only FC)/u);
    for (const value of [privateValue, credentials.accessKeyId, credentials.accessKeySecret, env.GITHUB_TOKEN]) {
      assert.equal(error.stack.includes(value), false);
      assert.equal(options.lines?.join('\n').includes(value) ?? false, false);
    }
    assert.equal(Object.hasOwn(error, 'cause'), false);
    return true;
  });
  assert.equal(options.lines?.some(line => line.startsWith('FC read-only verified:')) ?? false, false);
  return caught;
}

test('observation authenticates only GET requests and verifies main, snapshots and three full-source process proofs', async () => {
  const f = fixture();
  const transportCalls = [];
  const client = createFcClient({ credentials, fetchFn: async (url, options) => {
    transportCalls.push({ url, options });
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    assert.match(options.headers.authorization, /^ACS3-HMAC-SHA256 Credential=SYNTHETICKEY,/u);
    if (url === FC_API_ENDPOINT + '/2023-03-30/functions/artdicohost-api') return json(functionData());
    if (url === FC_API_ENDPOINT + '/2023-03-30/functions/artdicohost-api/triggers/defaultTrigger') return json(triggerData());
    assert.equal(url, triggerUrl + '/healthz');
    return json(healthData().body);
  } });
  const result = await observeFc({ env, ...f, client });
  assert.deepEqual(result, { observation: 'read-only-verified', sourceCommit: EXPECTED_MAIN, signedHealthChecks: 3, businessReady: false });
  assert.equal(transportCalls.length, 7);
  assert.deepEqual(f.calls, ['main', 'main']);
  const healthLines = f.lines.filter(line => line.startsWith('FC read-only signed health: '));
  assert.equal(healthLines.length, 3);
  for (const line of healthLines) assert.equal(JSON.parse(line.slice('FC read-only signed health: '.length)).sourceCommit, EXPECTED_MAIN);
  const metadata = JSON.parse(f.lines.find(line => line.startsWith('FC read-only function before: ')).slice('FC read-only function before: '.length));
  assert.deepEqual(metadata, { state: 'unknown', update: 'unknown', statePresence: 'absent', updatePresence: 'absent', codeSizeBytes: 29_507_159, codeChecksumCRC64: '18446744073709551615' });
  assert.match(f.lines.at(-1), /no resource was changed; business readiness was not verified\.$/u);
  assert.equal(f.lines.join('\n').includes(privateValue), false);
  assert.equal(f.lines.join('\n').includes(triggerUrl), false);
});

test('wrong Actions context is rejected before any network or mutation can run', async () => {
  for (const patch of [
    { GITHUB_ACTIONS: 'false' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' },
    { GITHUB_REF: 'refs/heads/main' }, { GITHUB_REPOSITORY: 'kunanli/other-project' },
    { GITHUB_SHA: EXPECTED_MAIN.slice(0, 7) }, { ARTDICO_FC_ACCOUNT_ID: '../wrong' },
    { FC_ACCESS_KEY_SECRET: '' }, { GITHUB_TOKEN: '' },
  ]) assert.throws(() => requireObservationContext({ ...env, ...patch }));
  const f = fixture();
  await rejected({ ...f, env: { ...env, GITHUB_REF: 'refs/pull/14/merge' } });
  assert.deepEqual(f.calls, []);
});

test('a moved main before or after observation cannot produce verification', async () => {
  for (const movedAt of [1, 2]) {
    const f = fixture();
    let reads = 0;
    await rejected({ ...f, fetchHead: async () => { reads++; return json({ object: { sha: reads === movedAt ? 'b'.repeat(40) : EXPECTED_MAIN } }); } });
    assert.equal(reads, movedAt);
    assert.equal(f.calls.filter(call => call === 'health').length, movedAt === 1 ? 0 : 3);
  }
});

test('partial, old, malformed and interrupted health evidence never counts as three matches', async () => {
  const invalid = [
    { status: 503, body: healthData().body },
    { status: 200, body: { ...healthData().body, status: 'unready' } },
    { status: 200, body: { ...healthData().body, scope: 'business-ready' } },
    { status: 200, body: { ...healthData().body, sourceCommit: 'b'.repeat(40) } },
    { status: 200, body: { ...healthData().body, sourceCommit: EXPECTED_MAIN.slice(0, 7) } },
    { status: 200, body: { ...healthData().body, sourceCommit: EXPECTED_MAIN + privateValue } },
  ];
  for (const bad of invalid) {
    let probe = 0;
    const f = fixture({ checkHealth: async () => ++probe === 2 ? bad : healthData() });
    await rejected(f);
    assert.equal(probe, 3);
    assert.equal(f.lines.filter(line => line.includes('"status":"not-verified"')).length, 1);
    assert.equal(f.lines.join('\n').includes(privateValue), false);
  }
});

test('function and trigger settings or code changes cannot be verified even with matching health', async () => {
  for (const mutate of [
    value => { value.environmentVariables.SECRET = 'PRIVATE-CHANGED'; },
    value => { value.role = 'PRIVATE-CHANGED'; },
    value => { value.codeChecksum = '1'; },
    value => { value.codeSize++; },
    value => { value.customRuntimeConfig.args = ['PRIVATE-CHANGED']; },
  ]) {
    let reads = 0;
    const f = fixture({ getFunction: async () => { const value = functionData(); if (++reads === 2) mutate(value); return value; } });
    await rejected(f);
  }
  let reads = 0;
  const f = fixture({ getTrigger: async () => {
    const value = triggerData();
    if (++reads === 2) value.triggerConfig = JSON.stringify({ authType: 'function', methods: ['GET', 'POST'], disableURLInternet: false });
    return value;
  } });
  await rejected(f);
});

test('target validation refuses other function ARNs, runtimes, commands, ports and unauthenticated triggers', async () => {
  for (const mutate of [
    value => { value.functionArn = `acs:fc:cn-shenzhen:${uid}:functions/artdicohost-api`; },
    value => { value.functionName = 'other-api'; }, value => { value.runtime = 'nodejs20'; },
    value => { value.customRuntimeConfig.command = ['python3', 'app.py']; },
    value => { value.customRuntimeConfig.port = 8080; },
  ]) {
    const f = fixture({ getFunction: async () => { const value = functionData(); mutate(value); return value; } });
    await rejected(f);
    assert.equal(f.calls.includes('health'), false);
  }
  for (const mutate of [
    value => { value.qualifier = 'production'; }, value => { value.triggerType = 'timer'; },
    value => { value.triggerConfig = JSON.stringify({ authType: 'anonymous', methods: ['GET'] }); },
    value => { value.triggerConfig = JSON.stringify({ authType: 'function', methods: ['POST'] }); },
    value => { value.triggerConfig = JSON.stringify({ authType: 'function', methods: ['GET'], disableURLInternet: true }); },
    value => { value.httpTrigger.urlInternet = 'https://other.example/'; },
  ]) {
    const f = fixture({ getTrigger: async () => { const value = triggerData(); mutate(value); return value; } });
    await rejected(f);
    assert.equal(f.calls.includes('health'), false);
  }
});

test('safe observation logs suppress arbitrary state, CRC, source and thrown diagnostics', async () => {
  const f = fixture({ getFunction: async () => ({ ...functionData(), state: privateValue, lastUpdateStatus: privateValue, codeSize: privateValue, codeChecksum: privateValue }),
    checkHealth: async () => { throw Object.assign(new Error(privateValue), { operation: 'CheckHealth', phase: privateValue, status: 400, code: privateValue }); } });
  await rejected(f);
  assert.equal(f.lines.filter(line => line.includes('"statePresence":"unrecognized"')).length, 2);
  assert.equal(f.lines.some(line => line.includes('codeChecksumCRC64') || line.includes('"diagnostic"')), false);
  const reporting = fixture();
  await rejected({ ...reporting, report() { throw new Error(privateValue); } });
});

test('trusted client diagnostics retain only the allowed HTTP category and never provider body or headers', async () => {
  const f = fixture();
  const client = createFcClient({ credentials, fetchFn: async url => {
    if (url.startsWith(FC_API_ENDPOINT) && url.endsWith('/triggers/defaultTrigger')) return json(triggerData());
    if (url.startsWith(FC_API_ENDPOINT)) return json(functionData());
    return json({ Code: 'InvalidArgument', Message: privateValue, headers: privateValue }, { status: 400 });
  } });
  await rejected({ ...f, client });
  assert.equal(f.lines.filter(line => line.includes('operation=CheckHealth phase=http status=400 code=InvalidArgument')).length, 3);
});

test('global observation deadline aborts an unresponsive read without claiming success', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture({ getFunction: () => new Promise(() => {}) });
  const pending = rejected(f);
  // Allow the synthetic bounded main response to drain before expiring the fixed global budget.
  for (let index = 0; index < 30; index++) await Promise.resolve();
  t.mock.timers.tick(90_000);
  const error = await pending;
  assert.match(error.message, /deadline/u);
  assert.equal(f.calls.includes('health'), false);
});

test('diagnostic workflow is branch-only, read-only and never invokes a deployment command', async () => {
  const workflow = await readFile(new URL('../.github/workflows/fc-observe.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \[diag\/fc-observe-dff3\]/u);
  assert.match(workflow, /permissions:\n  contents: read/u);
  assert.match(workflow, /github\.event_name == 'push'.*github\.ref == 'refs\/heads\/diag\/fc-observe-dff3'.*github\.repository == 'kunanli\/artdicohost'/u);
  assert.equal([...workflow.matchAll(/\brun: (.+)/gu)].map(match => match[1]).join('\n'), 'node scripts/observe-fc.mjs');
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request|deploy-fc|deploy-oss|write-all|id-token:/u);
});
