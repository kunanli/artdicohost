import { appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentMainHead } from './deploy-oss.mjs';
import { verifyFcPublication } from './verify-fc-package.mjs';

export const FC_FUNCTION_NAME = 'artdicohost-api';
export const FC_REGION = 'cn-hongkong';
const DEPLOYMENT_TIMEOUT = 90_000;
const MAX_ATTEMPTS = 16;
const defaultWait = (milliseconds, { signal } = {}) => delay(milliseconds, undefined, { signal });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function requireFcDeploymentContext(env) {
  if (!record(env) || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== 'kunanli/artdicohost' || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')) throw new Error('Only a main push in kunanli/artdicohost may deploy FC code.');
  if (env.ARTDICO_FC_DEPLOY_ENABLED !== 'true') throw new Error('FC deployment is not explicitly enabled.');
  if (!['FC_ACCESS_KEY_ID', 'FC_ACCESS_KEY_SECRET'].every(key => typeof env[key] === 'string' && env[key].trim())) throw new Error('FC deployment credentials are required.');
  if (typeof env.ARTDICO_FC_ACCOUNT_ID !== 'string' || !/^\d{6,32}$/u.test(env.ARTDICO_FC_ACCOUNT_ID)) throw new Error('A valid FC deployment account ID is required.');
}

function functionSnapshot(value, accountId) {
  const config = value?.customRuntimeConfig;
  const variables = value?.environmentVariables;
  if (!record(value) || value.functionName !== FC_FUNCTION_NAME || value.runtime !== 'custom.debian11'
    || value.functionArn !== `acs:fc:${FC_REGION}:${accountId}:functions/${FC_FUNCTION_NAME}`
    || !record(config) || !isDeepStrictEqual(config.command, ['/code/bootstrap'])
    || config.args != null && !isDeepStrictEqual(config.args, []) || config.port !== 9000
    || variables != null && !record(variables)
    || variables?.ARTDICO_FC_PORT !== undefined && variables.ARTDICO_FC_PORT !== '9000') throw new Error('FC target configuration is not the approved closed preflight.');
  return structuredClone({ runtime: value.runtime, customRuntimeConfig: config, environmentVariables: variables, role: value.role });
}

function triggerUrl(value) {
  let config;
  try { config = typeof value?.triggerConfig === 'string' ? JSON.parse(value.triggerConfig) : null; }
  catch { /* Fail closed below without exposing trigger configuration. */ }
  if (!record(value) || value.triggerType !== 'http' || value.qualifier !== 'LATEST' || !record(config)
    || config.authType !== 'function' || !Array.isArray(config.methods) || !config.methods.includes('GET') || config.disableURLInternet === true) throw new Error('FC HTTP trigger is not the approved authenticated LATEST trigger.');
  try {
    const raw = value.httpTrigger?.urlInternet;
    if (typeof raw !== 'string' || /[\s\\#\u0000-\u001f\u007f]/u.test(raw) || !raw.startsWith('https://')) throw new Error();
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cn-hongkong\.fcapp\.run$/u.test(url.hostname)
      || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
      || ![url.origin, url.origin + '/'].includes(raw)) throw new Error();
    return url.href;
  } catch { throw new Error('FC HTTP trigger URL is not a fixed Hong Kong HTTPS function URL.'); }
}

/** Code-only update of an already configured closed preflight; never creates or opens a service. */
export async function deployFc({ directory, repositoryDirectory, env = process.env, client, verifyPackage = verifyFcPublication, fetchHead = fetch, wait = defaultWait } = {}) {
  requireFcDeploymentContext(env);
  const controller = new AbortController();
  const deadline = performance.now() + DEPLOYMENT_TIMEOUT;
  const timer = setTimeout(() => controller.abort(), DEPLOYMENT_TIMEOUT);
  timer.unref();
  const deadlineError = () => new Error('FC deployment exceeded its verification deadline; no success was recorded.');
  async function bounded(operation, message) {
    if (controller.signal.aborted || performance.now() >= deadline) { controller.abort(); throw deadlineError(); }
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(deadlineError());
      controller.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => operation(controller.signal)), aborted]);
      if (performance.now() >= deadline) { controller.abort(); throw deadlineError(); }
      return result;
    } catch { throw controller.signal.aborted ? deadlineError() : new Error(message); }
    finally { controller.signal.removeEventListener('abort', onAbort); }
  }
  const currentMain = () => bounded(signal => assertCurrentMainHead(env, (url, options) => fetchHead(url, { ...options, signal: AbortSignal.any([options.signal, signal]) })), 'Cannot verify that this run is the current main commit; no FC code was updated.');
  try {
    const publication = await bounded(() => verifyPackage({ directory, expectedCommit: env.GITHUB_SHA, repositoryDirectory }), 'FC publication verification failed; no code was updated.');
    const { zipBytes, manifest } = publication ?? {};
    if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength === 0 || zipBytes.byteLength > 64 * 1024 * 1024
      || manifest?.sourceCommit !== env.GITHUB_SHA || !/^[a-f0-9]{64}$/u.test(manifest?.archive?.sha256 ?? '')
      || createHash('sha256').update(zipBytes).digest('hex') !== manifest.archive.sha256) throw new Error('FC publication identity or archive hash is invalid; no code was updated.');
    await currentMain();
    if (!client) {
      client = await bounded(async () => {
        const { createFcClient } = await import('./fc-client.mjs');
        return createFcClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET,
          ...(env.FC_SECURITY_TOKEN ? { securityToken: env.FC_SECURITY_TOKEN } : {}) } });
      }, 'FC deployment client could not be initialized; no code was updated.');
    }
    if (!['getFunction', 'getTrigger', 'updateCode', 'checkHealth'].every(name => typeof client[name] === 'function')) throw new Error('FC deployment client is incomplete; no code was updated.');
    const before = await bounded(signal => client.getFunction({ signal }), 'FC target could not be inspected; no code was updated.');
    const snapshot = functionSnapshot(before, env.ARTDICO_FC_ACCOUNT_ID);
    const trigger = await bounded(signal => client.getTrigger({ signal }), 'FC trigger could not be inspected; no code was updated.');
    const healthUrl = triggerUrl(trigger);
    const triggerSnapshot = { triggerType: trigger.triggerType, qualifier: trigger.qualifier, config: JSON.parse(trigger.triggerConfig) };
    // Metadata inspection can take time. Recheck main immediately before the only mutation.
    await currentMain();
    await bounded(signal => client.updateCode(zipBytes, { signal }), 'FC code update failed; deployment was not verified.');
    let consecutive = 0;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let state;
      try { state = await bounded(signal => client.getFunction({ signal }), 'FC update state could not be verified.'); }
      catch (error) { if (controller.signal.aborted) throw error; }
      if (state) {
        if (state.lastUpdateStatus === 'Failed' || state.state === 'Failed') throw new Error('FC reported a failed code update; no success was recorded.');
        const after = functionSnapshot(state, env.ARTDICO_FC_ACCOUNT_ID);
        if (!isDeepStrictEqual(snapshot, after)) throw new Error('FC runtime, environment or role changed; deployment was not verified.');
      }
      let matches = false;
      if (state?.lastUpdateStatus === 'Successful' && state.state === 'Active') {
        try {
          const health = await bounded(signal => client.checkHealth(healthUrl, { signal }), 'FC process health could not be verified.');
          matches = health?.status === 200 && health.body?.status === 'ok' && health.body.scope === 'process-only' && health.body.sourceCommit === env.GITHUB_SHA;
        } catch (error) { if (controller.signal.aborted) throw error; }
      }
      consecutive = matches ? consecutive + 1 : 0;
      if (consecutive === 3) {
        const finalTrigger = await bounded(signal => client.getTrigger({ signal }), 'FC trigger could not be rechecked; deployment was not verified.');
        const finalHealthUrl = triggerUrl(finalTrigger);
        if (finalHealthUrl !== healthUrl || !isDeepStrictEqual(triggerSnapshot, { triggerType: finalTrigger.triggerType, qualifier: finalTrigger.qualifier, config: JSON.parse(finalTrigger.triggerConfig) })) throw new Error('FC HTTP trigger changed; deployment was not verified.');
        const summary = `Updated closed FC startup preflight \`${FC_FUNCTION_NAME}\` from commit \`${env.GITHUB_SHA}\`. Package SHA-256: \`${manifest.archive.sha256}\`. Three consecutive signed process-only health checks matched this commit. Registration remains closed; business and private storage readiness are not verified.\n`;
        if (env.GITHUB_STEP_SUMMARY) await bounded(() => appendFile(env.GITHUB_STEP_SUMMARY, summary), 'FC verification passed but its summary could not be recorded.');
        return { functionName: FC_FUNCTION_NAME, commit: env.GITHUB_SHA, packageSha256: manifest.archive.sha256, preflight: 'verified', businessReady: false };
      }
      if (attempt < MAX_ATTEMPTS - 1) await bounded(signal => wait(2000, { signal }), 'FC verification wait failed; no success was recorded.');
    }
    throw new Error('FC did not pass three consecutive process-only health checks; no success was recorded.');
  } finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await deployFc({ directory: resolve(process.argv[2] ?? '.local-data/fc-publication'), repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
  console.log('Verified closed FC startup preflight ' + result.functionName + ' from commit ' + result.commit + '.');
}
