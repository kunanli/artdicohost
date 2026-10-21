import { constants } from 'node:fs';
import { open, mkdir, lstat, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSigningIdentity } from '../functions/apple-wallet/pkpass.mjs';
import { encodeSigningBundle, walletSigningObjectKey } from '../functions/apple-wallet/bundle.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const REQUIRED = ['cert', 'key', 'wwdr', 'root', 'team-id', 'pass-type-id', 'organization', 'event-id', 'secret-file', 'out'];
const FLAGS = [...REQUIRED, 'key-passphrase-file'];
const fail = () => { throw new Error('Wallet signing bundle was not prepared.'); };
export function parseWalletSigningArguments(args) {
  if (!Array.isArray(args) || args.length % 2) fail();
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (typeof flag !== 'string' || !flag.startsWith('--') || !FLAGS.includes(flag.slice(2)) || Object.hasOwn(result, flag.slice(2))
      || typeof args[index + 1] !== 'string' || !args[index + 1] || args[index + 1].startsWith('--') || /[\u0000-\u001f\u007f]/u.test(args[index + 1])) fail();
    result[flag.slice(2)] = args[index + 1];
  }
  if (REQUIRED.some(name => !Object.hasOwn(result, name))) fail();
  return result;
}
async function input(path, { secret = false, max = 24 * 1024 } = {}) {
  let handle;
  try {
    handle = await open(resolve(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > max || secret && (info.mode & 0o077)) fail();
    const data = await handle.readFile(); if (data.length !== info.size || data.length > max) fail(); return data;
  } finally { await handle?.close(); }
}
function secretText(data, max) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\r?\n$/u, '');
  if (!value || value.length > max || !value.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value)) fail(); return value;
}

/** Offline preparation only: no upload, no FC change, no account creation, and no plaintext output. */
export async function prepareWalletSigning(options, { validateIdentity = validateSigningIdentity, now = Date.now } = {}) {
  let key, secret, passphrase, created = false, output, encoded;
  try {
    const parsed = parseWalletSigningArguments(Object.entries(options ?? {}).flatMap(([name, value]) => ['--' + name, value]));
    if (typeof validateIdentity !== 'function' || typeof now !== 'function') fail();
    output = resolve(parsed.out);
    const local = resolve(ROOT, '.local-data') + sep;
    if (output.startsWith(ROOT) && !output.startsWith(local)) fail();
    const paths = ['cert', 'key', 'wwdr', 'root', 'secret-file', ...(parsed['key-passphrase-file'] ? ['key-passphrase-file'] : [])].map(name => resolve(parsed[name]));
    if (new Set(paths).size !== paths.length || paths.includes(output)) fail();
    const cert = await input(parsed.cert), wwdr = await input(parsed.wwdr), root = await input(parsed.root);
    key = await input(parsed.key, { secret: true }); secret = await input(parsed['secret-file'], { secret: true, max: 4096 });
    if (parsed['key-passphrase-file']) passphrase = await input(parsed['key-passphrase-file'], { secret: true, max: 4096 });
    const password = passphrase ? secretText(passphrase, 1024) : undefined;
    const identity = validateIdentity({ certificate: cert, key, wwdr, root, teamId: parsed['team-id'], passTypeIdentifier: parsed['pass-type-id'], passphrase: password, now: now() });
    const config = { APPLE_WALLET_TEAM_ID: parsed['team-id'], APPLE_WALLET_PASS_TYPE_ID: parsed['pass-type-id'], APPLE_WALLET_ORGANIZATION_NAME: parsed.organization,
      APPLE_WALLET_CERT_BASE64: cert.toString('base64'), APPLE_WALLET_KEY_BASE64: key.toString('base64'), APPLE_WALLET_WWDR_CERT_BASE64: wwdr.toString('base64'),
      APPLE_WALLET_ROOT_CERT_BASE64: root.toString('base64'), ...(password ? { APPLE_WALLET_KEY_PASSPHRASE: password } : {}) };
    if (typeof config.APPLE_WALLET_ORGANIZATION_NAME !== 'string' || !config.APPLE_WALLET_ORGANIZATION_NAME.trim() || config.APPLE_WALLET_ORGANIZATION_NAME.length > 80) fail();
    encoded = encodeSigningBundle({ config, secret: secretText(secret, 256), eventId: parsed['event-id'] });
    const objectKey = walletSigningObjectKey({ eventId: parsed['event-id'], bundleId: encoded.bundleId });
    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    const directory = await lstat(dirname(output));
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) || await realpath(dirname(output)) !== dirname(output)) fail();
    const handle = await open(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await handle.writeFile(encoded.data); await handle.sync(); } finally { await handle.close(); }
    return { prepared: true, enabled: false, bundleId: encoded.bundleId, objectKey, encryptedBytes: encoded.data.length,
      certificateExpiresAt: identity.expiresAt, deviceAcceptanceRequired: true };
  } catch { if (created) await unlink(output).catch(() => {}); fail(); }
  finally { key?.fill(0); secret?.fill(0); passphrase?.fill(0); encoded?.data?.fill(0); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await prepareWalletSigning(parseWalletSigningArguments(process.argv.slice(2)))) + '\n'); }
  catch { process.stderr.write('Wallet signing bundle was not prepared. Check the documented file, permission and certificate requirements.\n'); process.exitCode = 1; }
}
