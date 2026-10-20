import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCloudContentCandidate, parseCandidateArguments } from './cloud-content-package.mjs';

export { prepareCloudContentCandidate, parseCandidateArguments } from './cloud-content-package.mjs';

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseCandidateArguments(process.argv.slice(2));
  const manifest = await prepareCloudContentCandidate({ repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..'), ...options });
  console.log('Prepared cloud content candidate: ' + manifest.files.length + ' allowlisted files. Candidate only; no cloud resources changed.');
}
