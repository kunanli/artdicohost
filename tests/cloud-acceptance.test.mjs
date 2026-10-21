import test from 'node:test';
import assert from 'node:assert/strict';
import { createAcceptanceObjects } from '../functions/cloud-content/scoped-objects.mjs';
import { acceptanceHealthProof, startCloudAcceptance } from '../functions/cloud-content/acceptance.mjs';
import { createCloudContentServer } from '../functions/cloud-content/http-server.mjs';
import { createCloudContentApi } from '../functions/cloud-content/handler.mjs';
import { objectFixture, fakeCredentials, fixedClock } from './cloud-oss-fixture.mjs';
import { request as httpRequest } from 'node:http';
import { createCloudAuth, CLOUD_LOGIN_POLICY } from '../functions/cloud-content/auth.mjs';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createObjectJournal } from '../functions/cloud-content/object-journal.mjs';
import { memoryObjects } from './helpers/cloud-memory-objects.mjs';
import { createInitialContent } from '../src/config/content.mjs';

const SOURCE = 'a'.repeat(40), RUN = 'r123456-a1-' + 'c'.repeat(16) + '-' + SOURCE, INSTANCE = 'b'.repeat(32);
const ENV = { NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'false', ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: RUN,
  ARTDICO_CONTENT_API_ORIGIN: 'https://api.artdico.host', ARTDICO_PUBLIC_SITE_ORIGIN: 'https://artdico.host',
  ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong',
  ALIBABA_CLOUD_ACCESS_KEY_ID: fakeCredentials.accessKeyId, ALIBABA_CLOUD_ACCESS_KEY_SECRET: fakeCredentials.accessKeySecret,
  ALIBABA_CLOUD_SECURITY_TOKEN: fakeCredentials.securityToken };
const options = fixture => ({ env: ENV, sourceCommit: SOURCE, fetchFn: fixture.fetchFn, now: () => fixedClock().getTime() });

// Inject boundaries at observable durable operations, not at a guessed number of
// now() calls. One scenario moves time after the unknown account's budget commit
// and directory read, so the independent correct alias really can log in. The
// final boundary occurs after the known alias is limited but before the last
// unknown account reserves, exercising the second response's clock check too.
async function acceptanceAcrossLoginWindow(boundary) {
  const fixture = objectFixture(), budgets = [], lateSessions = [];
  let at = fixedClock().getTime(), revoking = false, rollovers = 0;
  let saturated = false, deferredRollover = false;
  let knownAliasReady = false, afterKnownClockTicks = 0;
  const advance = () => { at += 15 * 60 * 1000; rollovers++; };
  const fetchFn = async (url, settings) => {
    const key = new URL(url).pathname;
    if (settings.method === 'PUT' && key.includes('/sessions/')) {
      const value = JSON.parse(Buffer.from(settings.body));
      if (value.kind === 'staff_session' && value.revoked === true) {
        revoking = true;
        if (boundary === 'revocation' && !rollovers) advance();
      } else if (revoking && value.kind === 'staff_session') {
        lateSessions.push({createdAt:value.createdAt,revoked:value.revoked});
      }
    }
    if (revoking && settings.method === 'PUT' && key.includes('/limits/')) {
      const value = JSON.parse(Buffer.from(settings.body));
      if (value.kind === 'login_budget') {
        budgets.push({window:value.window,count:value.count});
        if (value.count === 9 && (boundary === 'every-prime' || boundary === 'prime' && !rollovers)) advance();
        if (value.count === 10 && !rollovers) saturated = true;
      }
    }
    if (boundary === 'between-clients' && saturated && !rollovers && settings.method === 'GET' && key.endsWith('/users/commits.jsonl')) deferredRollover = true;
    if (boundary === 'after-known-limit' && saturated && !rollovers && settings.method === 'GET') {
      if (key.endsWith('/users/commits.jsonl')) knownAliasReady = true;
      if (knownAliasReady && key.includes('/limits/') && key.includes('/blobs/')) {
        const stored = fixture.stored.get(key.slice(1));
        if (stored && JSON.parse(stored.data).count === 10) afterKnownClockTicks = 2;
      }
    }
    return fixture.fetchFn(url, settings);
  };
  const now = () => {
    if (deferredRollover) {deferredRollover=false;advance();}
    // The first tick observes the known 429's window; the second is the last
    // unknown login's reservation. A missing final API call cannot pass this case.
    if (afterKnownClockTicks && --afterKnownClockTicks === 0) advance();
    return at;
  };
  const result = await startCloudAcceptance({...options(fixture),fetchFn,now}).completion;
  return {result,fixture,budgets,lateSessions,rollovers};
}

test('all logical object categories are mapped to one private acceptance namespace and nested or malformed scopes are rejected', async () => {
  const seen = [], objects = Object.fromEntries(['get', 'putImmutable', 'append'].map(operation => [operation, (...args) => { seen.push([operation, ...args]); return Promise.resolve(null); }]));
  const scoped = createAcceptanceObjects({ objects, runId: RUN, instanceId: INSTANCE });
  for (const category of ['content', 'contacts', 'portraits', 'sessions', 'limits', 'probes', 'registrations', 'registration-reviews', 'registration-confirmations', 'wallet-signing', 'confirmation-mail', 'intent-invitations', 'group-invites', 'users', 'maintenance', 'restores', 'volunteers']) {
    const logical = `cms/v1/${category}/synthetic.json`;
    await scoped.get(logical); await scoped.putImmutable(logical, Buffer.from('{}')); await scoped.append(logical, 0, Buffer.from('{}'));
  }
  assert.equal(seen.length, 51);
  assert.ok(seen.every(([, key]) => key.startsWith(`cms/v1/acceptance/${RUN}/${INSTANCE}/`)));
  for (const value of ['cms/v1/acceptance/existing/probe.json', 'cms/v1/content/../private.json', 'cms/v1/other/probe.json', 'cms/v1/content//probe.json', 'other/content/probe.json', null, ['cms/v1/content/probe.json']]) {
    assert.throws(() => scoped.get(value), { message: 'Acceptance object scope is invalid.' });
  }
  assert.equal(seen.length, 51);
  for (const runId of ['production', 'r0-a1-' + 'c'.repeat(16) + '-' + SOURCE, 'r1-a0-' + 'c'.repeat(16) + '-' + SOURCE,
    'r1-' + SOURCE, 'r1-a1-../' + SOURCE, 'r1-a1-' + 'c'.repeat(16) + '-' + 'A'.repeat(40), RUN + '/extra']) {
    assert.throws(() => createAcceptanceObjects({ objects, runId, instanceId: INSTANCE }));
  }
});

test('isolated acceptance uses only synthetic settings even when both real-mail feature flags are enabled', async () => {
  const fixture = objectFixture(), mail = { ARTDICO_INVITATION_EMAIL_ENABLED: 'true', ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true',
    EMAILJS_SERVICE_ID: 'synthetic_service', EMAILJS_TEMPLATE_ID: 'synthetic_invitation', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic_confirmation',
    EMAILJS_PUBLIC_KEY: 'PRIVATE_SYNTHETIC_MAIL_PUBLIC', EMAILJS_PRIVATE_KEY: 'PRIVATE_SYNTHETIC_MAIL_PRIVATE',
    EMAIL_FROM_ADDRESS: 'synthetic.sender@artdico.co', EMAIL_FROM_NAME: '合成通知团队', ARTDICO_DELIVERY_CONFIG_BUNDLE_ID: 'synthetic-bundle' };
  const monitor = startCloudAcceptance({ ...options(fixture), env: { ...ENV, ...mail } });
  assert.equal(monitor.snapshot().status, 'running');
  const result = await monitor.completion;
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.runId, RUN); assert.equal(result.sourceCommit, SOURCE);
  assert.equal(result.completed.length, 10);
  assert.equal(result.independentClients, 2); assert.equal(result.fcProcesses, 1); assert.equal(result.cleanupPerformed, false);
  assert.ok(result.requests > 100 && result.requests < 1000);
  assert.equal(result.requests, fixture.calls.length);
  assert.ok(fixture.calls.every(call => call.headers['accept-encoding'] === 'identity'));
  const prefix = `cms/v1/acceptance/${RUN}/${result.instanceId}/`;
  assert.ok(fixture.calls.every(call => call.key.startsWith(prefix)));
  assert.ok([...fixture.stored.keys()].every(key => key.startsWith(prefix)));
  for (const category of ['content', 'contacts', 'portraits', 'sessions', 'limits', 'probes', 'registrations', 'registration-reviews', 'intent-invitations', 'group-invites', 'maintenance', 'restores', 'volunteers']) assert.ok([...fixture.stored.keys()].some(key => key.startsWith(prefix + category + '/')), category);
  const volunteerPath = 'volunteers/' + createInitialContent().eventId;
  const liveVolunteerLog = fixture.stored.get(prefix + volunteerPath + '/commits.jsonl');
  const volunteerCommits = liveVolunteerLog.data.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line));
  assert.equal(volunteerCommits.length, 1); assert.equal(volunteerCommits[0].version, 1);
  const snapshot = fixture.stored.get(prefix + volunteerPath + '/blobs/' + volunteerCommits[0].valueHash + '.json');
  const volunteers = JSON.parse(snapshot.data);
  assert.equal(volunteers.revision, 1); assert.equal(volunteers.audit.length, 1); assert.equal(volunteers.audit[0].action, 'position_upsert');
  assert.equal(volunteers.volunteers.length, 0); assert.equal(volunteers.positions.length, 1);
  assert.ok(['synthetic-position-left', 'synthetic-position-right'].includes(volunteers.positions[0].id));
  const competingWrites = fixture.calls.filter(call => call.method === 'POST' && call.key === prefix + volunteerPath + '/commits.jsonl');
  assert.equal(competingWrites.length, 2); assert.ok(competingWrites.every(call => new URL(call.url).search === '?append&position=0'));
  assert.equal(fixture.calls.some(call => call.key.startsWith(prefix + 'probes/race/')), false, 'the feature repository replaces the generic conflict probe');
  const restoredVolunteerLogs = [...fixture.stored].filter(([key]) => key.startsWith(prefix + 'restores/') && key.endsWith('/' + volunteerPath + '/commits.jsonl'));
  assert.equal(restoredVolunteerLogs.length, 1);
  assert.deepEqual(restoredVolunteerLogs[0][1].data, liveVolunteerLog.data);
  const restoredSnapshotPath = restoredVolunteerLogs[0][0].slice(0, -'/commits.jsonl'.length) + '/blobs/' + volunteerCommits[0].valueHash + '.json';
  assert.deepEqual(fixture.stored.get(restoredSnapshotPath).data, snapshot.data);
  assert.ok(fixture.calls.some(call => call.key.startsWith(prefix + 'users/')), 'bootstrap directory is checked without creating extra staff');
  assert.equal(fixture.calls.some(call => call.method === 'DELETE'), false);
  assert.equal(fixture.calls.some(call => call.method === 'POST' && !call.url.includes('?append&position=')), false);
  assert.ok(fixture.calls.every(call => new URL(call.url).hostname === 'artdicohost-data-hk.oss-cn-hongkong.aliyuncs.com'));
  for (const value of ['PRIVATE_SYNTHETIC_MAIL_PUBLIC', 'PRIVATE_SYNTHETIC_MAIL_PRIVATE', 'synthetic.sender@artdico.co', 'synthetic-bundle']) {
    assert.equal([...fixture.stored.values()].some(item => item.data.includes(Buffer.from(value))), false);
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /passwordHash|csrfToken|set-cookie|synthetic\.acceptance|synthetic@example|scrypt\$|PRIVATE_|ExampleSecret|ExampleToken|cms\/v1/u);
  assert.deepEqual(acceptanceHealthProof({ ...result, privateProviderBody: 'PRIVATE_INPUT' }), result);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.completed));
  const calls = fixture.calls.length;
  assert.deepEqual(monitor.snapshot(), result); assert.deepEqual(await monitor.completion, result);
  assert.equal(fixture.calls.length, calls, 'reading evidence never repeats mutations');
});

test('all stages also pass with an advancing clock across durable operations', async () => {
  const fixture = objectFixture(); let ticks = 0;
  const result = await startCloudAcceptance({ ...options(fixture), now: () => fixedClock().getTime() + ++ticks * 7 }).completion;
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.equal(result.completed.length, 10);
  assert.ok(ticks > 100 && result.requests < 1000);
});

test('a login-window boundary at durable session revocation still proves all ten stages inside the original request budget', async () => {
  // Before the bounded CAS preparation, this exact boundary exhausted 1000
  // requests at nine stages and 83 touched objects on main b8d6818.
  const {result,fixture,budgets,rollovers} = await acceptanceAcrossLoginWindow('revocation');
  assert.equal(rollovers,1);
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.equal(result.completed.length,10);
  assert.ok(result.requests<1000);
  assert.equal(result.requests,fixture.calls.length);
  assert.deepEqual(budgets.map(value=>value.count),[9,10],'a real unknown login reserves the last slot after bounded preparation');
  assert.ok(fixture.calls.every(call=>call.key.startsWith(`cms/v1/acceptance/${RUN}/${result.instanceId}/`)));
});

test('rollover after preparing nine attempts re-primes the new actual window and obtains the shared limit', async () => {
  const {result,budgets,lateSessions,rollovers} = await acceptanceAcrossLoginWindow('prime');
  assert.equal(rollovers,1);
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.equal(result.completed.length,10);
  assert.ok(result.requests<1000);
  const primes=budgets.filter(value=>value.count===9);
  assert.equal(primes.length,2);
  assert.equal(primes[1].window,primes[0].window+1);
  assert.deepEqual(budgets.slice(-2).map(value=>value.count),[9,10]);
  assert.equal(lateSessions.length,1,'the correct alias was accepted in the fresh window before the second bounded proof');
});

test('a correct alias accepted across the client boundary cannot masquerade as a shared 429 proof', async () => {
  const {result,budgets,lateSessions,rollovers} = await acceptanceAcrossLoginWindow('between-clients');
  assert.equal(rollovers,1);
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.equal(result.completed.length,10);
  assert.ok(result.requests<1000);
  assert.equal(lateSessions.length,1,'the independent client really receives a successful new-window session');
  assert.deepEqual(budgets.map(value=>value.count),[9,10,1,9,10]);
  assert.equal(budgets.at(-1).window,budgets[0].window+1);
});

test('a boundary after the known alias is limited also re-proves the unknown account in the new actual window', async () => {
  const {result,budgets,lateSessions,rollovers} = await acceptanceAcrossLoginWindow('after-known-limit');
  assert.equal(rollovers,1,'the last unknown API call actually reserves in the next window');
  assert.equal(result.status,'passed',JSON.stringify(result));
  assert.equal(result.completed.length,10);
  assert.ok(result.requests<1000);
  assert.equal(lateSessions.length,0,'the new-window attempt is an unknown account, not an accepted alias');
  assert.deepEqual(budgets.map(value=>value.count),[9,10,1,9,10]);
  assert.equal(budgets.at(-1).window,budgets[0].window+1);
});

test('a second boundary fails closed after two rounds instead of repeatedly preparing windows or exhausting transport', async () => {
  const {result,fixture,budgets,rollovers} = await acceptanceAcrossLoginWindow('every-prime');
  assert.equal(rollovers,2);
  assert.equal(result.status,'failed');
  assert.equal(result.completed.length,9);
  assert.equal(result.completed.at(-1),'session-revocation');
  assert.ok(result.requests<1000);
  assert.equal(result.requests,fixture.calls.length);
  assert.equal(budgets.filter(value=>value.count===9).length,2,'no third preparation round');
  assert.equal(fixture.calls.some(call=>call.method==='DELETE'),false);
});

test('unmodified cloud auth defaults enforce ten attempts in a shared fifteen-minute window across independent clients', async () => {
  const password='synthetic acceptance policy password only';
  const users=[{id:'synthetic_policy',username:'synthetic-policy',email:'synthetic-policy@artdico.co',label:'合成限流账号',roles:['editor'],passwordHash:await hashPassword(password)}];
  const objects=memoryObjects(),prefixes=new Set();
  const journalFor=prefix=>{prefixes.add(prefix);return createObjectJournal({objects,prefix});};
  const started=fixedClock().getTime();let at=started;
  const first=createCloudAuth({users,journalFor,now:()=>at});
  const second=createCloudAuth({users,journalFor,now:()=>at});
  for(let attempt=0;attempt<10;attempt++) {
    await assert.rejects((attempt%2?first:second).login({identifier:'synthetic-unknown',password:'synthetic-wrong-password'}),error=>error.status===401&&error.code==='AUTH_FAILED');
  }
  await assert.rejects(second.login({identifier:users[0].email,password}),error=>error.status===429&&error.code==='LOGIN_RATE_LIMITED'&&error.retryAfter===900);
  at=started+15*60*1000-1;
  await assert.rejects(first.login({identifier:users[0].username,password}),error=>error.status===429&&error.retryAfter===1);
  at++;
  const session=await second.login({identifier:users[0].email,password});
  assert.equal(session.user.id,users[0].id);
  const windows=[...prefixes].filter(prefix=>prefix.startsWith('cms/v1/limits/')).map(prefix=>Number(prefix.split('/')[3]));
  assert.deepEqual(windows,[Math.floor(started/900000),Math.floor(started/900000)+1]);
  const counts=[...objects.files].filter(([key])=>key.includes('/limits/')&&key.includes('/blobs/')).map(([,item])=>JSON.parse(item.data).count);
  assert.deepEqual(counts,[1,2,3,4,5,6,7,8,9,10,1]);
  assert.deepEqual(CLOUD_LOGIN_POLICY,{limit:10,globalLimit:60,windowMs:900000});
  assert.equal(Object.isFrozen(CLOUD_LOGIN_POLICY),true);
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
    { ARTDICO_CONTENT_API_ORIGIN: 'https://example.invalid' }, { ARTDICO_CLOUD_ACCEPTANCE_RUN_ID: 'r123456-a1-' + 'c'.repeat(16) + '-' + 'b'.repeat(40) }]) {
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

test('the overall result deadline also bounds a response body that ignores transport abort', async () => {
  let body;
  const fetchFn = async () => new Response(new ReadableStream({ start(controller) { body = controller; } }), {
    headers: { 'content-type': 'application/json', 'x-oss-object-type': 'Normal' },
  });
  const monitor = startCloudAcceptance({ ...options({ fetchFn }), deadlineMs: 20 });
  const started = Date.now(), keeper = setTimeout(() => {}, 500);
  try {
    const result = await monitor.completion;
    assert.equal(result.status, 'failed'); assert.deepEqual(result.completed, []);
    assert.ok(Date.now() - started < 400);
    body.close();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(monitor.snapshot().status, 'failed');
  } finally { clearTimeout(keeper); }
});

test('health proof cannot promote incomplete results, reorder stages or return unchecked status fields', async () => {
  const good = await startCloudAcceptance(options(objectFixture())).completion;
  for (const patch of [{ status: 'unknown' }, { completed: [] }, { completed: Array(10) }, { completed: [...good.completed].reverse() }, { requests: 1001 }, { runId: '../private' }, { sourceCommit: 'short' }, { instanceId: 'private' }, { fcProcesses: 2 }, { cleanupPerformed: true }]) {
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
