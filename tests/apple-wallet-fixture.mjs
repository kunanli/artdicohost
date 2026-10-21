import { mkdtemp, writeFile, readFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Disposable local certificate authority. No credential bytes are committed or printed. */
export async function createWalletFixture() {
  const directory = await mkdtemp(resolve(tmpdir(), 'artdico-synthetic-wallet-'));
  const run = args => execFileSync('openssl', args, { cwd: directory, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
  try {
    await writeFile(resolve(directory, 'wwdr.ext'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
    await writeFile(resolve(directory, 'leaf.ext'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nextendedKeyUsage=clientAuth,1.2.840.113635.100.4.14\n1.2.840.113635.100.6.1.16=ASN1:UTF8String:pass.org.artdico.fixture\n');
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '730', '-subj', '/C=ZZ/O=Synthetic Wallet Fixture/CN=Synthetic Wallet Root', '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:1', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'wwdr.key', '-out', 'wwdr.csr', '-subj', '/C=ZZ/O=Synthetic Wallet Fixture/CN=Synthetic WWDR']);
    run(['x509', '-req', '-in', 'wwdr.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'wwdr.pem', '-days', '365', '-extfile', 'wwdr.ext']);
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pass.key', '-out', 'pass.csr', '-subj', '/C=ZZ/O=Synthetic Wallet Fixture/OU=SYNTH12345/UID=pass.org.artdico.fixture/CN=Synthetic Pass Type ID']);
    run(['x509', '-req', '-in', 'pass.csr', '-CA', 'wwdr.pem', '-CAkey', 'wwdr.key', '-CAcreateserial', '-out', 'pass.pem', '-days', '120', '-extfile', 'leaf.ext']);
    for (const file of ['root.key', 'wwdr.key', 'pass.key']) await chmod(resolve(directory, file), 0o600);
    const [certificate, key, wwdr, root] = await Promise.all(['pass.pem', 'pass.key', 'wwdr.pem', 'root.pem'].map(name => readFile(resolve(directory, name))));
    const rootDer = run(['x509', '-in', 'root.pem', '-outform', 'DER']);
    const rootHash = createHash('sha256').update(rootDer).digest('hex'), now = Date.now();
    const fields = { certificate, key, wwdr, root, teamId: 'SYNTH12345', passTypeIdentifier: 'pass.org.artdico.fixture', now, trustedRootFingerprints: [rootHash] };
    const env = { APPLE_WALLET_ENABLED: 'true', APPLE_WALLET_TEAM_ID: fields.teamId, APPLE_WALLET_PASS_TYPE_ID: fields.passTypeIdentifier,
      APPLE_WALLET_ORGANIZATION_NAME: '合成活动团队', APPLE_WALLET_CERT_BASE64: certificate.toString('base64'), APPLE_WALLET_KEY_BASE64: key.toString('base64'), APPLE_WALLET_WWDR_CERT_BASE64: wwdr.toString('base64'), APPLE_WALLET_ROOT_CERT_BASE64: root.toString('base64') };
    return { directory, run, now, fields, env, rootHash, cleanup: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

export function passFiles(archive) {
  const files = new Map(); let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const bytes = archive.readUInt32LE(offset + 18), nameBytes = archive.readUInt16LE(offset + 26), extra = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameBytes).toString('utf8'), start = offset + 30 + nameBytes + extra;
    if (files.has(name) || archive.readUInt16LE(offset + 8) !== 0) throw new Error('Synthetic pass ZIP is invalid.');
    files.set(name, archive.subarray(start, start + bytes)); offset = start + bytes;
  }
  if (archive.readUInt32LE(offset) !== 0x02014b50) throw new Error('Synthetic pass ZIP central directory is missing.');
  return files;
}
