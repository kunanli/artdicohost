import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile, stat, chmod, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWalletSigningArguments, prepareWalletSigning } from '../scripts/prepare-wallet-signing.mjs';
import { validateSigningIdentity } from '../functions/apple-wallet/pkpass.mjs';
import { decodeSigningBundle } from '../functions/apple-wallet/bundle.mjs';
import { createWalletFixture } from './apple-wallet-fixture.mjs';

const fixture = await createWalletFixture(); after(() => fixture.cleanup());
const secret = 'SYNTHETIC_REGISTRATION_TOKEN_SECRET_12345678901234567890';
const secretPath = resolve(fixture.directory, 'registration-secret'); await writeFile(secretPath, secret, { mode: 0o600 });
const base = { cert: resolve(fixture.directory, 'pass.pem'), key: resolve(fixture.directory, 'pass.key'), wwdr: resolve(fixture.directory, 'wwdr.pem'), root: resolve(fixture.directory, 'root.pem'),
  'team-id': fixture.fields.teamId, 'pass-type-id': fixture.fields.passTypeIdentifier, organization: '合成主办方', 'event-id': 'synthetic-event', 'secret-file': secretPath, out: resolve(fixture.directory, 'encrypted', 'signing.json') };
const dependencies = { validateIdentity: input => validateSigningIdentity({ ...input, trustedRootFingerprints: [fixture.rootHash] }), now: () => fixture.now };

test('offline preparation validates the actual signer, writes only authenticated encrypted bytes and reports no credential values', async () => {
  const result = await prepareWalletSigning(base, dependencies);
  assert.equal(result.prepared, true); assert.equal(result.enabled, false); assert.equal(result.deviceAcceptanceRequired, true);
  assert.match(result.objectKey, /^cms\/v1\/wallet-signing\/synthetic-event\/[a-f0-9]{64}\.json$/u);
  const data = await readFile(base.out), decoded = decodeSigningBundle({ data, secret, eventId: base['event-id'], bundleId: result.bundleId });
  assert.equal(decoded.APPLE_WALLET_TEAM_ID, fixture.fields.teamId); assert.equal(decoded.APPLE_WALLET_KEY_BASE64, fixture.env.APPLE_WALLET_KEY_BASE64);
  assert.equal((await stat(base.out)).mode & 0o777, 0o600); assert.equal((await stat(resolve(fixture.directory, 'encrypted'))).mode & 0o777, 0o700);
  assert.doesNotMatch(data.toString(), /CERTIFICATE|PRIVATE|SYNTH12345|pass\.org|合成/u);
  assert.doesNotMatch(JSON.stringify(result), /CERTIFICATE|PRIVATE|SYNTH12345|pass\.org|合成|TOKEN_SECRET/u);
  await assert.rejects(prepareWalletSigning(base, dependencies), /not prepared/u); assert.deepEqual(await readFile(base.out), data, 'existing bundle is never overwritten');
});

test('production preparation rejects synthetic roots and insecure private file permissions, symlinks and public output', async () => {
  const rejectedOut = resolve(fixture.directory, 'must-not-exist.json');
  await assert.rejects(prepareWalletSigning({ ...base, out: rejectedOut }), /not prepared/u); assert.equal(existsSync(rejectedOut), false);
  await chmod(secretPath, 0o644); await assert.rejects(prepareWalletSigning({ ...base, out: rejectedOut }, dependencies), /not prepared/u); await chmod(secretPath, 0o600);
  const link = resolve(fixture.directory, 'linked-private.key'); await symlink(base.key, link);
  await assert.rejects(prepareWalletSigning({ ...base, key: link, out: rejectedOut }, dependencies), /not prepared/u);
  await assert.rejects(prepareWalletSigning({ ...base, out: resolve(import.meta.dirname, '../public/signing-secret.json') }, dependencies), /not prepared/u);
  assert.equal(existsSync(rejectedOut), false);
});

test('the controlled CLI accepts exact file arguments only, with no inline secret, enable flag or trust-root bypass', () => {
  const args = Object.entries(base).flatMap(([name, value]) => ['--' + name, value]); assert.deepEqual(parseWalletSigningArguments(args), base);
  for (const invalid of [[], args.slice(0,-2), [...args, '--secret', secret], [...args, '--enabled', 'true'], [...args, '--trust-root', fixture.rootHash], [...args, '--cert', 'duplicate'], [...args, '--key-passphrase-file']]) assert.throws(() => parseWalletSigningArguments(invalid));
});
