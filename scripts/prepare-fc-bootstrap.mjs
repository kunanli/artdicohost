import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, parse, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NODE_VERSION = 'v24.19.0';
export const PACKAGE_PATHS = Object.freeze([
  'bootstrap', 'functions/fc-api/handler.mjs', 'functions/fc-api/server.mjs',
  'runtime/node/bin/node', 'release.json',
]);
const SOURCE_FILES = [
  ['functions/fc-api/bootstrap', 'bootstrap', 0o755],
  ['functions/fc-api/handler.mjs', 'functions/fc-api/handler.mjs', 0o644],
  ['functions/fc-api/server.mjs', 'functions/fc-api/server.mjs', 0o644],
];
const childEnv = () => ({ PATH: process.env.PATH ?? '', LANG: 'C', LC_ALL: 'C' });
export const sha256 = value => createHash('sha256').update(value).digest('hex');

// Check only explicitly named paths; never discover inputs by walking the repository.
async function noLinks(path, allowMissing = false) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  for (let index = 0; index < parts.length; index++) {
    current = resolve(current, parts[index]);
    let stat;
    try { stat = await lstat(current); }
    catch (error) { if (allowMissing && error.code === 'ENOENT') return; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Symbolic links are not allowed in package paths');
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error('Package parent must be a directory');
  }
}

async function knownFile(path, maxBytes) {
  await noLinks(path);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error('Package input must be a nonempty regular file within the size limit');
    const bytes = await handle.readFile();
    if (bytes.length !== stat.size) throw new Error('Package input changed while reading');
    return bytes;
  } finally { await handle.close(); }
}

export function verifyNodeBytes(bytes, expectedNodeSha256) {
  if (!/^[a-f0-9]{64}$/.test(expectedNodeSha256 ?? '')) throw new Error('Provide the expected Node binary SHA-256 explicitly');
  if (sha256(bytes) !== expectedNodeSha256) throw new Error('Node binary SHA-256 mismatch');
  if (bytes.length < 64 || !bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
    || bytes[4] !== 2 || bytes[5] !== 1 || bytes[6] !== 1
    || bytes.readUInt16LE(18) !== 62 || bytes.readUInt32LE(20) !== 1) {
    throw new Error('Node binary must be a Linux ELF64 little-endian x86_64 executable');
  }
}

async function writeKnown(path, bytes, mode) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { flag: 'wx', mode });
  await chmod(path, mode);
}

const fileRecord = (path, bytes, mode) => ({ path, bytes: bytes.length, sha256: sha256(bytes), mode: mode === 0o755 ? '0755' : '0644' });

/** Local preflight package only. The supplied checksum does not establish official provenance. */
export async function prepareFcBootstrap({ repositoryDirectory, nodeBinary, expectedNodeSha256, sourceCommit, outputDirectory, execute = spawnSync } = {}) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw new Error('Provide the exact 40-character source commit SHA');
  if (![repositoryDirectory, nodeBinary, outputDirectory].every(value => typeof value === 'string' && value.length)) throw new Error('Provide repository, Node binary and output paths explicitly');
  const repository = resolve(repositoryDirectory);
  const binary = resolve(nodeBinary);
  const output = resolve(outputDirectory);
  await noLinks(output, true);
  await mkdir(output, { recursive: true, mode: 0o700 });
  if ((await readdir(output)).length) throw new Error('Package output directory must be empty; no files were removed');

  const nodeBytes = await knownFile(binary, 200 * 1024 * 1024);
  verifyNodeBytes(nodeBytes, expectedNodeSha256);
  const version = execute(binary, ['--version'], { env: childEnv(), encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, stdio: 'pipe' });
  if (version.error || version.status !== 0 || version.stdout?.trim() !== NODE_VERSION) throw new Error('Node binary version must be exactly ' + NODE_VERSION);

  const objectType = execute('git', ['--no-replace-objects', '-C', repository, 'cat-file', '-t', sourceCommit], { env: childEnv(), encoding: 'utf8', timeout: 10_000, maxBuffer: 4096, stdio: 'pipe' });
  if (objectType.error || objectType.status !== 0 || objectType.stdout?.trim() !== 'commit') throw new Error('Source SHA must identify a commit object');
  const source = [];
  for (const [input, path, mode] of SOURCE_FILES) {
    const bytes = await knownFile(resolve(repository, input), 1024 * 1024);
    const committed = execute('git', ['--no-replace-objects', '-C', repository, '--no-pager', 'show', '--no-ext-diff', '--no-textconv', sourceCommit + ':' + input], { env: childEnv(), timeout: 10_000, maxBuffer: 1024 * 1024, stdio: 'pipe' });
    if (committed.error || committed.status !== 0 || !Buffer.isBuffer(committed.stdout) || !committed.stdout.equals(bytes)) throw new Error('Allowlisted source does not match the exact source commit: ' + input);
    source.push({ input, path, mode, bytes });
  }
  const code = resolve(output, 'code');
  const files = [];
  for (const item of source) {
    await writeKnown(resolve(code, item.path), item.bytes, item.mode);
    files.push(fileRecord(item.path, item.bytes, item.mode));
  }
  await writeKnown(resolve(code, 'runtime/node/bin/node'), nodeBytes, 0o755);
  files.push(fileRecord('runtime/node/bin/node', nodeBytes, 0o755));
  const release = {
    schemaVersion: 1, kind: 'fc-preflight', sourceCommit,
    node: { version: NODE_VERSION, platform: 'linux', arch: 'x64', sha256: expectedNodeSha256 },
    files: [...files],
  };
  const releaseBytes = Buffer.from(JSON.stringify(release, null, 2) + '\n');
  await writeKnown(resolve(code, 'release.json'), releaseBytes, 0o644);
  files.push(fileRecord('release.json', releaseBytes, 0o644));
  const archive = resolve(output, 'artdicohost-fc-preflight.zip');
  const result = execute('zip', ['-X', '-q', '-6', archive, ...PACKAGE_PATHS], { cwd: code, env: childEnv(), encoding: 'utf8', timeout: 120_000, maxBuffer: 4096, stdio: 'pipe' });
  if (result.error || result.status !== 0) throw new Error('ZIP creation failed; inspect the retained output directory');
  const archiveBytes = await knownFile(archive, 220 * 1024 * 1024);
  const manifest = {
    schemaVersion: 1, kind: 'fc-preflight', sourceCommit, node: release.node, files,
    archive: { path: 'artdicohost-fc-preflight.zip', bytes: archiveBytes.length, sha256: sha256(archiveBytes) },
    verification: 'Binary checksum, ELF x86_64 and exact version checked. Official runtime provenance must be verified separately.',
  };
  await writeKnown(resolve(output, 'package-manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), 0o644);
  return manifest;
}

export function parseArguments(args) {
  const names = { '--node-binary': 'nodeBinary', '--node-sha256': 'expectedNodeSha256', '--source-commit': 'sourceCommit', '--out': 'outputDirectory' };
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = names[args[index]];
    const value = args[index + 1];
    if (!key || Object.hasOwn(options, key) || !value || value.startsWith('--')) throw new Error('Usage: --node-binary PATH --node-sha256 HEX --source-commit SHA --out EMPTY_DIRECTORY');
    options[key] = value;
  }
  if (Object.keys(options).length !== Object.keys(names).length) throw new Error('All four package arguments are required');
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const manifest = await prepareFcBootstrap({ repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..'), ...options });
  console.log('Prepared FC preflight ZIP: ' + manifest.archive.path + ' (' + manifest.files.length + ' allowlisted files). No cloud resources were changed.');
}
