import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCloudContentCandidate } from './cloud-content-package.mjs';

export { verifyCloudContentCandidate } from './cloud-content-package.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: node scripts/verify-cloud-content-package.mjs ARTIFACT_DIRECTORY EXACT_SOURCE_COMMIT');
  const { manifest } = await verifyCloudContentCandidate({ directory: process.argv[2], expectedCommit: process.argv[3], repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  console.log('Verified cloud content candidate: ' + manifest.files.length + ' files for ' + manifest.sourceCommit + '. No deployment or storage readiness is claimed.');
}
