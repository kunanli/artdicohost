import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
const release = JSON.parse(await readFile('/code/release.json', 'utf8'));
assert.equal(process.version, 'v24.19.0');
const child = spawn('/code/bootstrap', [], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', bytes => { output += bytes; });
child.stderr.on('data', bytes => { output += bytes; });
let started = false;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Bootstrap exited before becoming ready: ' + output.slice(0, 500));
    try {
      const response = await fetch('http://127.0.0.1:9000/healthz', { signal: AbortSignal.timeout(500) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: 'ok', scope: 'process-only', sourceCommit: release.sourceCommit });
      started = true;
      break;
    } catch (error) { if (attempt === 59) throw error; }
    await new Promise(accept => setTimeout(accept, 100));
  }
  assert.equal(started, true);
  for (const [path, method] of [['/api/health', 'GET'], ['/api/registrations', 'POST'], ['/api/admin', 'POST']]) {
    const response = await fetch('http://127.0.0.1:9000' + path, { method, ...(method === 'POST' ? { body: 'SYNTHETIC-NOT-PERSISTED' } : {}) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'not_ready', registration: 'closed', storage: 'not_verified' });
  }
  console.log(JSON.stringify({ debian: '11', node: process.version, sourceCommit: release.sourceCommit, bootstrap: 'passed', liveness: 'process-only', business: 'closed', network: 'none', code: 'read-only' }));
} finally { child.kill('SIGTERM'); }
