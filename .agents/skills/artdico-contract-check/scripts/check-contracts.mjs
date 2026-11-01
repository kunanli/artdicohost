#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const groups = Object.freeze({
  publication: Object.freeze([
    'tests/content-schema.test.mjs',
    'tests/public-content-refresh.test.mjs',
    'tests/guest-content.test.mjs',
    'tests/showcase-display-kinds.test.mjs',
    'tests/games-content.test.mjs',
  ]),
  persistence: Object.freeze([
    'tests/cloud-content-store.test.mjs',
    'tests/booth-store-fields.test.mjs',
    'tests/content-local-drafts.test.mjs',
  ]),
  provenance: Object.freeze([
    'tests/contact-editor.test.mjs',
    'tests/people-domain.test.mjs',
    'tests/people-resolution.test.mjs',
  ]),
  'media-event': Object.freeze([
    'tests/profile-image.test.mjs',
    'tests/event-presentation.test.mjs',
  ]),
});

function usage() {
  process.stderr.write('Usage: node .agents/skills/artdico-contract-check/scripts/check-contracts.mjs [--list | --group publication|persistence|provenance|media-event]\n');
}

function counts(tap) {
  const value = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...tap.matchAll(new RegExp('^# ' + key + ' (\\d+)\\s*$', 'gm'))];
    if (!matches.length) return null;
    value[key] = Number(matches.at(-1)[1]);
  }
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  let selected;
  if (args.length === 0) selected = Object.keys(groups);
  else if (args.length === 1 && args[0] === '--list') {
    for (const [name, files] of Object.entries(groups)) {
      process.stdout.write(name + '\n' + files.map(file => '  ' + file).join('\n') + '\n');
    }
    return 0;
  } else if (args.length === 2 && args[0] === '--group' && Object.hasOwn(groups, args[1])) selected = [args[1]];
  else { usage(); return 2; }

  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (pkg.name !== 'artdico-host') throw new Error('Unexpected repository root.');
  for (const name of selected) for (const file of groups[name]) {
    const info = await lstat(join(root, file));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Required synthetic test is missing or not a regular file: ' + file);
  }

  process.stdout.write('[contract] Scope: current synthetic regressions; planned P1 behavior requires its own added acceptance cases.\n');
  let failed = false;
  for (const name of selected) {
    const files = groups[name];
    const command = ['--test', '--test-reporter=tap', '--test-concurrency=2', ...files];
    const result = spawnSync(process.execPath, command, {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', TZ: 'UTC' },
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const totals = counts(result.stdout ?? '');
    const complete = Boolean(totals && totals.tests > 0 && totals.pass === totals.tests && !totals.fail && !totals.cancelled && !totals.skipped && !totals.todo);
    const passed = !result.error && result.status === 0 && !result.signal && complete;
    failed ||= !passed;
    const summary = totals
      ? Object.entries(totals).map(([key, value]) => key + '=' + value).join(' ')
      : 'no complete TAP summary';
    process.stdout.write('[contract] ' + name + ': ' + (passed ? 'PASS' : 'INCOMPLETE OR FAILED') + ' files=' + files.length + ' ' + summary + '\n');
    if (!passed) {
      const reason = result.error?.code === 'ETIMEDOUT' ? 'timeout' : result.error ? 'process error' : result.signal ? 'signal' : 'test failure or incomplete run';
      process.stdout.write('[contract] ' + name + ': ' + reason + '. Inspect locally with: node ' + command.join(' ') + '\n');
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
    }
  }
  process.stdout.write('[contract] ' + (failed ? 'Not all selected groups passed.' : 'All selected groups passed.') + ' No production or device acceptance claim.\n');
  return failed ? 1 : 0;
}

try { process.exitCode = await main(); }
catch {
  process.stderr.write('[contract] Preflight failed. Verify the repository, required regular test files and Node installation; no groups are reported as passed.\n');
  process.exitCode = 2;
}
