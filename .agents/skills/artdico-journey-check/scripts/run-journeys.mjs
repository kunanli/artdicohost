#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const nodeGroups = [
  { id: 'application-and-history', files: ['tests/application-domain.test.mjs', 'tests/application-runtime-history.test.mjs'] },
  { id: 'legacy-and-operator', files: ['tests/people-relationships-runtime.test.mjs', 'tests/person-confirmation-runtime.test.mjs'] },
  { id: 'notification-and-private-page', files: ['tests/registration-confirmation.test.mjs', 'tests/confirmation-client.test.mjs'] },
  { id: 'group-and-wallet', files: ['tests/registration-group-invite.test.mjs', 'tests/apple-wallet.test.mjs'] },
];
const browserFiles = [
  'tests/browser/application-review-smoke.mjs',
  'tests/browser/people-resolution-smoke.mjs',
  'tests/browser/registration-workflow-smoke.mjs',
  'tests/browser/settings-group-runtime-smoke.mjs',
];
const modes = new Set(['--node', '--browser', '--all', '--list', '--help']);
const args = process.argv.slice(2);
if (args.length > 1 || args.some(arg => !modes.has(arg))) {
  console.error('Use no argument, --node, --browser, --all, --list or --help. Arbitrary paths and URLs are not accepted.');
  process.exit(2);
}
const mode = args[0] ?? '--node';
if (mode === '--help') {
  console.log('ARTDiCO synthetic journey check\nDefault/--node: fixed service and client tests\n--browser: fixed intercepted Chromium scripts, requires local build and explicit browser paths\n--all: both layers\n--list: fixed suite names\nExit 0: requested layers passed; 1: test failure; 2: prerequisites or incomplete tests. Real-device and production evidence remain separate.');
  process.exit(0);
}
if (mode === '--list') {
  console.log(JSON.stringify({ node: nodeGroups, browser: browserFiles }, null, 2));
  process.exit(0);
}

// The tests use injected synthetic services. Do not pass actual runtime bindings,
// API overrides, credentials or Node preload options to the child processes.
const env = { NODE_ENV: 'test', ASTRO_TELEMETRY_DISABLED: '1' };
for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TMPDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LANG', 'LC_ALL']) {
  if (typeof process.env[key] === 'string') env[key] = process.env[key];
}
const report = {
  skill: 'artdico-journey-check', mode: mode.slice(2), nodeVersion: process.version, syntheticOnly: true,
  node: { status: 'not_requested', groups: [] },
  browser: { status: 'not_requested', scripts: [], buildEvidence: [] },
  independentEvidence: { realEmailReceipt: 'not_run', realWeChatJoin: 'not_run', iPhoneWalletAdd: 'not_run', productionStorage: 'not_run', arrivalCheckIn: 'not_run' },
  scope: 'Existing baseline regression evidence only; pending redesign requirements need their own implementation and tests.',
};
let exitCode = 0;
function incomplete(message) { console.error(message); exitCode = Math.max(exitCode, 2); }
async function filesExist(files) {
  for (const file of files) {
    try { await access(resolve(root, file), constants.R_OK); }
    catch { incomplete('Required local file unavailable: ' + file); return false; }
  }
  return true;
}
function run(fileArgs, timeout) {
  return spawnSync(process.execPath, fileArgs, { cwd: root, env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
}
function failureOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error('Child process did not complete: ' + result.error.code);
  if (result.signal) console.error('Child process ended by signal: ' + result.signal);
}
function tapNumber(output, name) {
  const rows = [...output.matchAll(new RegExp('^# ' + name + ' (\\d+)\\s*$', 'gm'))];
  return rows.length ? Number(rows.at(-1)[1]) : null;
}
if (mode === '--node' || mode === '--all') {
  report.node.status = 'passed';
  if (!(await filesExist(nodeGroups.flatMap(group => group.files)))) report.node.status = 'not_run';
  else for (const group of nodeGroups) {
    console.log('Running synthetic service group: ' + group.id);
    const result = run(['--test', '--test-concurrency=2', '--test-reporter=tap', ...group.files], 180_000);
    const counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, tapNumber(result.stdout ?? '', key)]));
    const clean = !result.error && !result.signal && result.status === 0 && counts.tests > 0 && counts.pass === counts.tests && counts.fail === 0 && counts.cancelled === 0 && counts.skipped === 0 && counts.todo === 0;
    report.node.groups.push({ id: group.id, files: group.files, status: clean ? 'passed' : 'failed_or_incomplete', ...counts });
    if (!clean) {
      report.node.status = 'failed_or_incomplete';
      exitCode = Math.max(exitCode, result.status === 0 && !result.error ? 2 : 1);
      failureOutput(result);
      break;
    }
    console.log(group.id + ': ' + counts.pass + ' tests passed.');
  }
}
if (mode === '--browser' || mode === '--all') {
  report.browser.status = 'not_run';
  const modulePath = process.env.ARTDICO_PLAYWRIGHT_MODULE, binaryPath = process.env.ARTDICO_CHROMIUM_BINARY;
  let ready = true;
  for (const [label, path, permission] of [['ARTDICO_PLAYWRIGHT_MODULE', modulePath, constants.R_OK], ['ARTDICO_CHROMIUM_BINARY', binaryPath, constants.X_OK]]) {
    if (!path || !isAbsolute(path)) { incomplete(label + ' must identify an existing absolute local path.'); ready = false; }
    else try { await access(path, permission); } catch { incomplete(label + ' local path is unavailable.'); ready = false; }
  }
  const htmlFiles = ['dist/index.html', 'dist/registration/confirmation/index.html', 'dist/admin/registrations/index.html', 'dist/admin/contacts/index.html', 'dist/admin/settings/group/index.html', 'dist/admin/settings/delivery/index.html'];
  ready = await filesExist([...browserFiles, ...htmlFiles]) && ready;
  if (ready) {
    for (const file of htmlFiles) {
      const bytes = await readFile(resolve(root, file));
      report.browser.buildEvidence.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
      if (file === 'dist/index.html' && !bytes.toString().includes('data-registration-api-origin="https://api.artdico.host"')) { incomplete('Local homepage lacks the expected public registration build configuration; rebuild locally.'); ready = false; }
      if (file === 'dist/registration/confirmation/index.html' && !bytes.toString().includes('data-confirmation-api="https://api.artdico.host"')) { incomplete('Local private page lacks the expected public API build configuration; rebuild locally.'); ready = false; }
    }
  }
  if (ready && report.node.status !== 'failed_or_incomplete') {
    env.ARTDICO_PLAYWRIGHT_MODULE = modulePath;
    env.ARTDICO_CHROMIUM_BINARY = binaryPath;
    env.ARTDICO_DIST_DIRECTORY = resolve(root, 'dist');
    report.browser.status = 'passed';
    for (const file of browserFiles) {
      console.log('Running intercepted synthetic browser script: ' + file);
      const result = run([file], 180_000);
      const passed = !result.error && !result.signal && result.status === 0;
      report.browser.scripts.push({ file, status: passed ? 'passed' : 'failed' });
      if (!passed) { report.browser.status = 'failed'; exitCode = Math.max(exitCode, 1); failureOutput(result); break; }
      console.log(file + ': completed. Evidence is local and synthetic.');
    }
  } else if (ready) incomplete('Browser layer not run because the requested service layer did not complete.');
}
if (report.node.groups.length) {
  report.node.totals = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key,
    report.node.groups.every(group => Number.isSafeInteger(group[key])) ? report.node.groups.reduce((sum, group) => sum + group[key], 0) : null]));
}
console.log(JSON.stringify(report, null, 2));
process.exitCode = exitCode;
