import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptanceObjects } from '../functions/cloud-content/scoped-objects.mjs';
import { acceptanceHealthProof, startCloudAcceptance } from '../functions/cloud-content/acceptance.mjs';
import { createCloudContentServer } from '../functions/cloud-content/http-server.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { objectFixture, fakeCredentials, fixedClock } from './cloud-oss-fixture.mjs';
import { request as httpRequest } from 'node:http';

const SOURCE = 'a'.repeat(40), RUN = 'r123456-' + SOURCE, INSTANCE = 'b'.repeat(32);
const ENV = { NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'false', ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: RUN,
  ARTDICO_CONTENT_API_ORIGIN: 'https://api.artdico.host', ARTDICO_PUBLIC_SITE_ORIGIN: 'https://artdico.host',
  ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong',
  ALIBABA_CLOUD_ACCESS_KEY_ID: fakeCredentials.accessKeyId, ALIBABA_CLOUD_ACCESS_KEY_SECRET: fakeCredentials.accessKeySecret,
  ALIBABA_CLOUD_SECURITY_TOKEN: fakeCredentials.securityToken };
const options = fixture => ({ env: ENV, sourceCommit: SOURCE, fetchFn: fixture.fetchFn, now: () => fixedClock().getTime() });

test('all logical object categories are mapped to one private acceptance namespace and nested or malformed scopes are rejected', async () => {
  const seen = [], objects = Object.fromEntries(['get', 'putImmutable', 'append'].map(operation => [operation, (...args) => { seen.push([operation, ...args]); return Promise.resolve(null); }]));
  const scoped = createAcceptanceObjects({ objects, runId: RUN, instanceId: INSTANCE });
  for (const category of ['content', 'contacts', 'portraits', 'sessions', 'limits', 'probes']) {
    const logical = `cms/v1/${category}/synthetic.json`;
    await scoped.get(logical); await scoped.putImmutable(logical, Buffer.from('{}')); await scoped.append(logical, 0, Buffer.from('{}'));
  }
  assert.equal(seen.length, 18);
  assert.ok(seen.every(([, key]) => key.startsWith(`cms/v1/acceptance/${RUN}/${INSTANCE}/`)));
  for (const value of ['cms/v1/acceptance/existing/probe.json', 'cms/v1/content/../private.json', 'cms/v1/other/probe.json', 'cms/v1/content//probe.json', 'other/content/probe.json', null, ['cms/v1/content/probe.json']]) {
    assert.throws(() => scoped.get(value), { message: 'Acceptance object scope is invalid.' });
  }
  assert.equal(seen.length, 18);
  for (const runId of ['production', 'r0-' + SOURCE, 'r1-../' + SOURCE, 'r1-' + 'A'.repeat(40), 'r1-' + SOURCE + '/extra']) {
    assert.throws(() => createAcceptanceObjects({ objects, runId, instanceId: INSTANCE }));
  }
});

test('isolated acceptance performs durable HTTP object operations and reports only fixed evidence, with no production objects touched', async () => {
  const fixture = objectFixture(), monitor = startCloudAcceptance(options(fixture));
  assert.equal(monitor.snapshot().status, 'running');
  const result = await monitor.completion;
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.runId, RUN); assert.equal(result.sourceCommit, SOURCE);
  assert.equal(result.completed.length, 8);
  assert.equal(result.independentClients, 2); assert.equal(result.fcProcesses, 1); assert.equal(result.cleanupPerformed, false);
  assert.ok(result.requests > 100 && result.requests < 500);
  assert.equal(result.requests, fixture.calls.length);
  const prefix = `cms/v1/acceptance/${RUN}/${result.instanceId}/`;
  assert.ok(fixture.calls.every(call => call.key.startsWith(prefix)));
  assert.ok([...fixture.stored.keys()].every(key => key.startsWith(prefix)));
  for (const category of ['content', 'contacts', 'portraits', 'sessions', 'limits', 'probes']) assert.ok([...fixture.stored.keys()].some(key => key.startsWith(prefix + category + '/')), category);
  assert.equal(fixture.calls.some(call => call.method === 'DELETE'), false);
  assert.equal(fixture.calls.some(call => call.method === 'POST' && !call.url.includes('?append&position=')), false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /passwordHash|csrfToken|set-cookie|synthetic\.acceptance|synthetic@example|scrypt\$|PRIVATE_|ExampleSecret|ExampleToken|cms\/v1/u);
  assert.deepEqual(acceptanceHealthProof({ ...result, privateProviderBody: 'PRIVATE_INPUT' }), result);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.completed));
  const calls = fixture.calls.length;
  assert.deepEqual(monitor.snapshot(), result); assert.deepEqual(await monitor.completion, result);
  assert.equal(fixture.calls.length, calls, 'reading evidence never repeats mutations');
});

test('missing acceptance setting does no credential, clock or network work and returns no health claim', async () => {
  let calls = 0;
  const monitor = startCloudAcceptance({ env: {}, fetchFn() { calls++; }, now() { calls++; throw new Error('PRIVATE_CLOCK'); } });
  assert.equal(monitor.snapshot(), null); assert.equal(await monitor.completion, null); assert.equal(calls, 0);
  assert.equal(acceptanceHealthProof(null), null);
});

test('acceptance rejects enabled business, missing role credentials, wrong fixed targets, invalid source binding and excessive deadline before networking', async () => {
  for (const patch of [{ ARTDICO_CLOUD_CONTENT_ENABLED: 'true' }, { ALIBABA_CLOUD_SECURITY_TOKEN: '' }, { ALIBABA_CLOUD_ACCESS_KEY_SECRET: '' },
    { NODE_ENV: 'development' }, { ARTDICO_CONTENT_BUCKET: 'another-private-bucket' }, { ARTDICO_CONTENT_REGION: 'cn-shanghai' },
    { ARTDICO_CONTENT_API_ORIGIN: 'https://example.invalid' }, { ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: 'r123456-' + 'b'.repeat(40) }]) {
    let calls = 0;
    const monitor = startCloudAcceptance({ ...options({ fetchFn() { calls++; } }), env: { ...ENV, ...patch } });
    assert.equal((await monitor.completion).status, 'rejected'); assert.equal(calls, 0);
  }
  let calls = 0;
  const monitor = startCloudAcceptance({ ...options({ fetchFn() { calls++; } }), deadlineMs: 90_001 });
  assert.equal((await monitor.completion).status, 'rejected'); assert.equal(calls, 0);
  for (const runId of ['PRIVATE_SECRET', 'r0-' + SOURCE, 'r1-' + SOURCE + '?private']) assert.throws(() => startCloudAcceptance({ env: { ...ENV, ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: runId }, sourceCommit: SOURCE }), { message: 'Cloud acceptance was not verified.' });
});

test('provider denials and unknown network outcomes fail closed without provider details, retries or success evidence', async () => {
  for (const fetchFn of [async () => { throw new Error('PRIVATE_PROVIDER_CREDENTIAL_DETAIL'); }, async () => new Response('<Error><Code>AccessDenied</Code><Message>PRIVATE_PROVIDER_CREDENTIAL_DETAIL</Message></Error>', { status: 403, headers: { 'content-type': 'application/xml' } })]) {
    let calls = 0;
    const monitor = startCloudAcceptance({ ...options({ fetchFn: async (...args) => { calls++; return fetchFn(...args); } }) });
    const result = await monitor.completion;
    assert.equal(result.status, 'failed'); assert.deepEqual(result.completed, []); assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|AccessDenied|credentials|authorization/u);
  }
});

test('the overall deadline bounds a transport that ignores abort and no late success is reported', async () => {
  const monitor = startCloudAcceptance({ ...options({ fetchFn: () => new Promise(() => {}) }), deadlineMs: 20 });
  const started = Date.now();
  // A ref-ed timer keeps the test alive while production's own monitor timer is unref-ed.
  const keeper = setTimeout(() => {}, 500);
  try {
    const result = await monitor.completion;
    assert.equal(result.status, 'failed'); assert.deepEqual(result.completed, []); assert.equal(result.requests, 1);
    assert.ok(Date.now() - started < 400);
  } finally { clearTimeout(keeper); }
});

test('health proof cannot promote incomplete results, reorder stages or return unchecked status fields', async () => {
  const good = await startCloudAcceptance(options(objectFixture())).completion;
  for (const patch of [{ status: 'unknown' }, { completed: [] }, { completed: Array(8) }, { completed: [...good.completed].reverse() }, { requests: 501 }, { runId: '../private' }, { sourceCommit: 'short' }, { instanceId: 'private' }, { fcProcesses: 2 }, { cleanupPerformed: true }]) {
    assert.throws(() => acceptanceHealthProof({ ...good, ...patch }), { message: 'Cloud acceptance was not verified.' });
  }
});

test('health returns the fixed acceptance summary without executing work and all business routes remain closed', async t => {
  const fixture = objectFixture(), result = await startCloudAcceptance(options(fixture)).completion;
  const calls = fixture.calls.length;
  const server = createCloudContentServer({ runtime: { configured: false, handle: createCloudContentApi({ enabled: false }) }, sourceCommit: SOURCE, readAcceptance: () => ({ ...result, password: 'PRIVATE_UNSAFE_EXTRA_FIELD' }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const send = (path, method = 'GET') => new Promise((resolve, reject) => {
    const outgoing = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, method, headers: { host: 'api.artdico.host', connection: 'close' } }, incoming => {
      const chunks = []; incoming.on('data', chunk => chunks.push(chunk)); incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers, text: Buffer.concat(chunks).toString('utf8') }));
    }); outgoing.on('error', reject); outgoing.end();
  });
  const health = await send('/healthz');
  assert.equal(health.status, 200); assert.equal(health.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(health.text).scope, 'process-only');
  assert.deepEqual(JSON.parse(health.text).acceptance, result);
  assert.doesNotMatch(health.text, /PRIVATE_UNSAFE_EXTRA_FIELD|password|csrfToken/u);
  assert.equal((await send('/healthz', 'HEAD')).text, '');
  for (const path of ['/admin/', '/api/admin/content', '/api/admin/session', '/api/registrations']) assert.equal((await send(path)).status, 503, path);
  assert.equal((await send('/acceptance')).status, 503);
  assert.equal(fixture.calls.length, calls);
});
