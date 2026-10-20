import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCurrentMainHead } from './deploy-oss.mjs';
import { createFcClient, summarizeFcError } from './fc-client.mjs';
import { createFcConfigClient, assertFcEnvironmentMap, summarizeFcConfigError } from './fc-config-client.mjs';
import { configureCloudAdmin, requireCloudAdminSetupContext, cloudAdminEnvironment, cloudAdminFunctionSnapshot, cloudAdminTriggerSnapshot } from './configure-cloud-admin.mjs';
import { deployCloudContent, requireCloudContentDeploymentContext } from './deploy-cloud-content.mjs';
import { verifyCloudContentCandidate } from './verify-cloud-content-package.mjs';
import { CANDIDATE_KIND, CANDIDATE_ARCHIVE } from './cloud-content-package.mjs';
import { assertFcCodeRequestFits } from './fc-upload-limits.mjs';
import { approvedRegistrationPolicy } from './approved-registration-policy.mjs';
import { parseAdminUsers, verifyPassword } from '../functions/content-api/auth.mjs';

const STAGES = ['object-readback', 'atomic-conflict', 'login-permissions', 'private-contacts', 'content-portrait', 'lost-ack', 'registration-intake', 'registration-review', 'session-revocation', 'shared-login-budget'];
const RUN_KEY = 'ARTDICO_CLOUD_ACCEPTANCE_RUN_ID';
const CONTENT_KEY = 'ARTDICO_CLOUD_CONTENT_ENABLED';
const DEADLINE = 12 * 60_000;
const safeErrors = new WeakSet();
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
function failure(name, diagnostic) {
  const error = new Error('Cloud lifecycle was not verified: ' + name + (diagnostic ? ' [' + diagnostic + ']' : '') + '.');
  safeErrors.add(error); return error;
}
function environment(value) {
  try {
    if (!plain(value) && value !== process.env) throw failure('CONTEXT_INVALID');
    const copy = {};
    for (const key of ['GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_TOKEN', 'GITHUB_RUN_ID',
      'ARTDICO_FC_DEPLOY_ENABLED', 'ARTDICO_CLOUD_LIFECYCLE_ENABLED', 'ARTDICO_CLOUD_ADMIN_SETUP_ENABLED', 'ARTDICO_FC_ACCOUNT_ID',
      'FC_ACCESS_KEY_ID', 'FC_ACCESS_KEY_SECRET', 'FC_SECURITY_TOKEN', 'ARTDICO_ADMIN_PASSWORD', 'ARTDICO_ADMIN_USERNAME',
      'ARTDICO_ADMIN_EMAIL', 'ARTDICO_REGISTRATION_SETUP_ENABLED']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw failure('CONTEXT_INVALID');
      copy[key] = descriptor?.value;
    }
    return copy;
  } catch { throw failure('CONTEXT_INVALID'); }
}
function stable(value) {
  const missing = field => field === undefined || field === null;
  return missing(value.state) && missing(value.lastUpdateStatus)
    || value.state === 'Active' && value.lastUpdateStatus === 'Successful';
}
function healthMatches(value, commit) {
  return value?.status === 200 && value.body?.status === 'ok' && value.body.scope === 'process-only' && value.body.sourceCommit === commit;
}
export function acceptanceMatches(value, runId, commit) {
  const proof = value?.body?.acceptance;
  return healthMatches(value, commit) && plain(proof) && proof.schemaVersion === 1 && proof.status === 'passed'
    && proof.runId === runId && proof.sourceCommit === commit && /^[a-f0-9]{32}$/u.test(proof.instanceId ?? '')
    && isDeepStrictEqual(proof.completed, STAGES) && proof.independentClients === 2 && proof.fcProcesses === 1 && proof.cleanupPerformed === false
    && Number.isSafeInteger(proof.requests) && proof.requests > 0 && proof.requests <= 1000
    && Number.isSafeInteger(proof.touchedObjects) && proof.touchedObjects > 0 && proof.touchedObjects <= 1000;
}

/** Credential-free probe of the exact public alias used by the production form. Never returns its body. */
export async function verifyPublicRegistrationAlias(fetchFn, policy, externalSignal) {
  const url = 'https://api.artdico.host/api/admin/registration/config';
  const signal = externalSignal === undefined ? AbortSignal.timeout(10_000) : AbortSignal.any([externalSignal, AbortSignal.timeout(10_000)]);
  let reader, response;
  async function readBounded(operation) {
    if (signal.aborted) throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
    let onAbort;
    const aborted = new Promise((_, reject) => { onAbort = () => reject(failure('PUBLIC_REGISTRATION_NOT_VERIFIED')); signal.addEventListener('abort', onAbort, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(operation), aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
  }
  try {
    response = await readBounded(() => fetchFn(url, { method: 'GET', headers: { accept: 'application/json', origin: 'https://artdico.host' },
      credentials: 'omit', redirect: 'error', cache: 'no-store', signal }));
    if (response.status !== 200 || response.redirected || response.url && response.url !== url
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
      || response.headers.get('access-control-allow-origin') !== 'https://artdico.host') throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 16 * 1024)) throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
    reader = response.body?.getReader();
    if (!reader) throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
    const chunks = []; let size = 0;
    while (true) {
      const part = await readBounded(() => reader.read());
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || (size += part.value.byteLength) > 16 * 1024) throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
      chunks.push(part.value);
    }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (value?.enabled !== true || value.eventId !== policy.eventId || value.capacity !== policy.capacity
      || value.opensAt !== new Date(policy.opensAt).toISOString() || value.closesAt !== new Date(policy.closesAt).toISOString()
      || !isDeepStrictEqual(value.privacy, policy.privacy)) throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED');
    return true;
  } catch { throw failure('PUBLIC_REGISTRATION_NOT_VERIFIED'); }
  finally {
    if (reader) { try { reader.cancel()?.catch?.(() => {}); } catch {} try { reader.releaseLock(); } catch {} }
    else { try { response?.body?.cancel()?.catch?.(() => {}); } catch {} }
  }
}

/** Serialized production lifecycle. Only exact readback and signed evidence can enable content. */
export async function deployCloudLifecycle(options = {}) {
  try {
    if (!plain(options) || Reflect.ownKeys(options).some(key => !['env', 'client', 'codeClient', 'directory', 'repositoryDirectory', 'verifyPackage',
      'deployCode', 'configureAdmin', 'fetchHead', 'fetchPublic', 'wait', 'report'].includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) throw failure('DEPENDENCY_INVALID');
    const env = environment(own(options, 'env') === undefined ? process.env : own(options, 'env'));
    try { requireCloudContentDeploymentContext(env); requireCloudAdminSetupContext(env); } catch { throw failure('CONTEXT_INVALID'); }
    if (env.ARTDICO_CLOUD_LIFECYCLE_ENABLED !== 'true' || typeof env.GITHUB_RUN_ID !== 'string'
      || !/^[1-9][0-9]{0,19}$/u.test(env.GITHUB_RUN_ID)) throw failure('CONTEXT_INVALID');
    const runId = 'r' + env.GITHUB_RUN_ID + '-' + env.GITHUB_SHA;
    const fetchHead = own(options, 'fetchHead') ?? fetch;
    const fetchPublic = own(options, 'fetchPublic') ?? fetch;
    const wait = own(options, 'wait') ?? ((ms, { signal }) => delay(ms, undefined, { signal }));
    const report = own(options, 'report') ?? (line => console.log(line));
    const verifyPackage = own(options, 'verifyPackage') ?? verifyCloudContentCandidate;
    const deployCode = own(options, 'deployCode') ?? deployCloudContent;
    const configureAdmin = own(options, 'configureAdmin') ?? configureCloudAdmin;
    if ([fetchHead, fetchPublic, wait, report, verifyPackage, deployCode, configureAdmin].some(value => typeof value !== 'function')) throw failure('DEPENDENCY_INVALID');
    const controller = new AbortController();
    const deadline = performance.now() + DEADLINE;
    const timer = setTimeout(() => controller.abort(), DEADLINE); timer.unref();
    async function bounded(work, name) {
      if (controller.signal.aborted || performance.now() >= deadline) throw failure('DEADLINE_EXCEEDED');
      let onAbort;
      const aborted = new Promise((_, reject) => { onAbort = () => reject(failure('DEADLINE_EXCEEDED')); controller.signal.addEventListener('abort', onAbort, { once: true }); });
      try { return await Promise.race([Promise.resolve().then(() => work(controller.signal)), aborted]); }
      catch (error) { throw safeErrors.has(error) ? error : failure(name, summarizeFcConfigError(error) ?? summarizeFcError(error)); }
      finally { controller.signal.removeEventListener('abort', onAbort); }
    }
    const currentMain = () => bounded(signal => assertCurrentMainHead(env, (url, settings) => fetchHead(url,
      { ...settings, signal: AbortSignal.any([settings.signal, signal]) })), 'CURRENT_MAIN_NOT_VERIFIED');
    const credentials = { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET,
      ...(env.FC_SECURITY_TOKEN ? { securityToken: env.FC_SECURITY_TOKEN } : {}) };
    try {
      // Validate the exact candidate before even quiescing a working deployment.
      const publication = await bounded(() => verifyPackage({ directory: own(options, 'directory'), repositoryDirectory: own(options, 'repositoryDirectory'), expectedCommit: env.GITHUB_SHA }), 'PACKAGE_NOT_VERIFIED');
      const { zipBytes, manifest } = publication ?? {};
      if (!(zipBytes instanceof Uint8Array) || zipBytes.byteLength === 0 || manifest?.schemaVersion !== 1 || manifest.kind !== CANDIDATE_KIND
        || manifest.sourceCommit !== env.GITHUB_SHA || manifest.archive?.path !== CANDIDATE_ARCHIVE
        || createHash('sha256').update(zipBytes).digest('hex') !== manifest.archive.sha256) throw failure('PACKAGE_NOT_VERIFIED');
      try { assertFcCodeRequestFits(zipBytes.byteLength); } catch { throw failure('PACKAGE_NOT_VERIFIED'); }
      await currentMain();
      const client = own(options, 'client') ?? createFcConfigClient({ credentials, allowContentActivation: true });
      if (!['getFunction', 'getTrigger', 'checkHealth', 'updateEnvironment'].every(key => typeof client[key] === 'function')) throw failure('DEPENDENCY_INVALID');
      const codeClient = own(options, 'codeClient') ?? createFcClient({ credentials });
      const inspect = () => bounded(signal => client.getFunction({ signal }), 'FUNCTION_INSPECTION_FAILED');
      const readTrigger = () => bounded(signal => client.getTrigger({ signal }), 'TRIGGER_INSPECTION_FAILED');
      const snapshot = value => {
        try { return { configuration: cloudAdminFunctionSnapshot(value), variables: cloudAdminEnvironment(value) }; }
        catch { throw failure('TARGET_CONFIGURATION_INVALID'); }
      };
      const triggerSnapshot = value => { try { return cloudAdminTriggerSnapshot(value); } catch { throw failure('SIGNED_TRIGGER_INVALID'); } };
      const initial = await inspect(), initialSnapshot = snapshot(initial);
      if (!stable(initial) || ![undefined, 'false', 'true'].includes(initialSnapshot.variables[CONTENT_KEY])) throw failure('FUNCTION_NOT_STABLE');
      const trigger = triggerSnapshot(await readTrigger());
      const signedHealth = () => bounded(signal => client.checkHealth(trigger.origin, { signal }), 'SIGNED_HEALTH_NOT_VERIFIED');
      const priorHealth = await signedHealth();
      const priorCommit = priorHealth?.body?.sourceCommit;
      if (typeof priorCommit !== 'string' || !/^[a-f0-9]{40}$/u.test(priorCommit) || !healthMatches(priorHealth, priorCommit)) throw failure('PRIOR_HEALTH_NOT_VERIFIED');

      async function unchangedTrigger() {
        if (!isDeepStrictEqual(trigger, triggerSnapshot(await readTrigger()))) throw failure('TRIGGER_CHANGED');
      }
      async function mutate(before, expected, commit, phase, { requireNoAcceptance = false } = {}) {
        const previous = snapshot(before);
        try { assertFcEnvironmentMap(expected, { allowContentActivation: true }); } catch { throw failure('CONFIGURATION_INPUT_INVALID'); }
        const fresh = await inspect();
        if (!stable(fresh) || !isDeepStrictEqual(previous, snapshot(fresh))) throw failure('CONFIGURATION_CHANGED_BEFORE_UPDATE');
        await unchangedTrigger();
        await currentMain();
        let diagnostic;
        if (!isDeepStrictEqual(previous.variables, expected)) {
          try { await bounded(signal => client.updateEnvironment(expected, { signal }), 'CONFIGURATION_UPDATE_NOT_ACKNOWLEDGED'); }
          catch (error) {
            if (controller.signal.aborted) throw error;
            diagnostic = /\[(operation=UpdateFunction phase=[a-z_]+(?: status=\d{3})?(?: code=[A-Za-z]+)?)\]/u.exec(error.message)?.[1];
          }
        }
        let consecutive = 0;
        for (let attempt = 0; attempt < 24; attempt++) {
          let observed;
          try { observed = await inspect(); } catch (error) { if (controller.signal.aborted) throw error; }
          if (observed) {
            const current = snapshot(observed);
            if (!isDeepStrictEqual(previous.configuration, current.configuration)) throw failure('CODE_OR_CONFIGURATION_CHANGED');
            if (!isDeepStrictEqual(current.variables, previous.variables) && !isDeepStrictEqual(current.variables, expected)) throw failure('UNEXPECTED_ENVIRONMENT_CHANGE');
            if (observed.state === 'Failed' || observed.lastUpdateStatus === 'Failed') throw failure('FUNCTION_UPDATE_FAILED');
            let healthy = false;
            if (stable(observed) && isDeepStrictEqual(current.variables, expected)) {
              try {
                const health = await signedHealth();
                healthy = healthMatches(health, commit) && (!requireNoAcceptance || !Object.hasOwn(health.body, 'acceptance'));
              } catch (error) { if (controller.signal.aborted) throw error; }
            }
            consecutive = healthy ? consecutive + 1 : 0;
          } else consecutive = 0;
          if (consecutive === 3) {
            await unchangedTrigger();
            const final = await inspect();
            if (!stable(final) || !isDeepStrictEqual(snapshot(final), { configuration: previous.configuration, variables: expected })) throw failure('FINAL_CONFIGURATION_CHANGED');
            await currentMain();
            report('Cloud lifecycle phase verified: ' + phase + '.');
            return final;
          }
          if (attempt + 1 < 24) await bounded(signal => wait(2000, { signal }), 'OBSERVATION_WAIT_FAILED');
        }
        throw failure('CONFIGURATION_NOT_VERIFIED', diagnostic);
      }

      const closedVariables = { ...initialSnapshot.variables, [CONTENT_KEY]: 'false' };
      delete closedVariables[RUN_KEY];
      await mutate(initial, closedVariables, priorCommit, 'quiesced', { requireNoAcceptance: true });
      const codeResult = await bounded(() => deployCode({ directory: own(options, 'directory'), repositoryDirectory: own(options, 'repositoryDirectory'), env,
        client: codeClient, verifyPackage: () => publication, fetchHead, wait, report: () => {} }), 'CODE_DEPLOYMENT_NOT_VERIFIED');
      if (codeResult?.code !== 'verified' || codeResult.commit !== env.GITHUB_SHA) throw failure('CODE_DEPLOYMENT_NOT_VERIFIED');
      const beforeSetup = snapshot(await inspect());
      const setupResult = await bounded(() => configureAdmin({ env, client, fetchHead, wait }), 'OWNER_CONFIGURATION_NOT_VERIFIED');
      if (setupResult?.configured !== true || setupResult.contentEnabled !== false || setupResult.codeUnchanged !== true) throw failure('OWNER_CONFIGURATION_NOT_VERIFIED');
      const configured = await inspect(), configuredSnapshot = snapshot(configured);
      if (!stable(configured) || configuredSnapshot.variables[CONTENT_KEY] !== 'false' || Object.hasOwn(configuredSnapshot.variables, RUN_KEY)) throw failure('CLOSED_CONFIGURATION_NOT_VERIFIED');
      if (!isDeepStrictEqual(beforeSetup.configuration, configuredSnapshot.configuration)) throw failure('CODE_OR_CONFIGURATION_CHANGED');
      await bounded(async () => {
        const variables = configuredSnapshot.variables;
        const owned = ['NODE_ENV', CONTENT_KEY, 'ARTDICO_CONTENT_API_ORIGIN', 'ARTDICO_PUBLIC_SITE_ORIGIN', 'ARTDICO_CONTENT_BUCKET',
          'ARTDICO_CONTENT_REGION', 'ADMIN_USERS_JSON', 'ARTDICO_REGISTRATION_TOKEN_SECRET', 'ARTDICO_REGISTRATION_POLICY_JSON',
          'ARTDICO_REGISTRATION_CAPACITY', 'ARTDICO_REGISTRATION_ENABLED'];
        const unrelated = value => Object.fromEntries(Object.entries(value).filter(([key]) => !owned.includes(key)));
        if (!isDeepStrictEqual(unrelated(beforeSetup.variables), unrelated(variables))) throw failure('UNEXPECTED_ENVIRONMENT_CHANGE');
        const enabled = env.ARTDICO_REGISTRATION_SETUP_ENABLED === 'true';
        const policy = approvedRegistrationPolicy({ contactEmail: env.ARTDICO_ADMIN_EMAIL, enabled });
        const secret = variables.ARTDICO_REGISTRATION_TOKEN_SECRET;
        const users = parseAdminUsers(variables.ADMIN_USERS_JSON);
        if (users.length !== 1 || users[0].id !== 'staff-owner' || users[0].username !== env.ARTDICO_ADMIN_USERNAME
          || users[0].email !== env.ARTDICO_ADMIN_EMAIL.trim().toLowerCase() || users[0].label !== '站点管理员'
          || !isDeepStrictEqual([...users[0].roles].sort(), ['editor', 'outreach', 'publisher', 'superadmin'])
          || !await verifyPassword(env.ARTDICO_ADMIN_PASSWORD, users[0].passwordHash)
          || typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(secret) || secret === env.ARTDICO_ADMIN_PASSWORD || secret === env.FC_ACCESS_KEY_SECRET
          || beforeSetup.variables.ARTDICO_REGISTRATION_TOKEN_SECRET !== undefined && secret !== beforeSetup.variables.ARTDICO_REGISTRATION_TOKEN_SECRET
          || !isDeepStrictEqual(JSON.parse(variables.ARTDICO_REGISTRATION_POLICY_JSON), policy)
          || variables.ARTDICO_REGISTRATION_CAPACITY !== String(policy.capacity) || variables.ARTDICO_REGISTRATION_ENABLED !== String(enabled)
          || variables.NODE_ENV !== 'production' || variables.ARTDICO_CONTENT_API_ORIGIN !== 'https://api.artdico.host'
          || variables.ARTDICO_PUBLIC_SITE_ORIGIN !== 'https://artdico.host' || variables.ARTDICO_CONTENT_BUCKET !== 'artdicohost-data-hk'
          || variables.ARTDICO_CONTENT_REGION !== 'cn-hongkong') throw failure('CLOSED_CONFIGURATION_NOT_VERIFIED');
      }, 'CLOSED_CONFIGURATION_NOT_VERIFIED');
      const currentHealth = await signedHealth();
      if (!healthMatches(currentHealth, env.GITHUB_SHA)) throw failure('SOURCE_NOT_VERIFIED');
      const armedVariables = { ...configuredSnapshot.variables, [RUN_KEY]: runId };
      const armed = await mutate(configured, armedVariables, env.GITHUB_SHA, 'acceptance-armed');
      const armedSnapshot = snapshot(armed);
      let accepted = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        const observed = await inspect();
        if (!stable(observed) || !isDeepStrictEqual(armedSnapshot, snapshot(observed))) throw failure('ACCEPTANCE_CONFIGURATION_CHANGED');
        let health;
        try { health = await signedHealth(); } catch (error) { if (controller.signal.aborted) throw error; }
        if (acceptanceMatches(health, runId, env.GITHUB_SHA)) { accepted = true; break; }
        const proof = health?.body?.acceptance;
        if (healthMatches(health, env.GITHUB_SHA) && proof?.runId === runId && proof.sourceCommit === env.GITHUB_SHA
          && ['failed', 'rejected'].includes(proof.status)) throw failure('ACCEPTANCE_FAILED');
        if (attempt + 1 < 60) await bounded(signal => wait(2000, { signal }), 'ACCEPTANCE_WAIT_FAILED');
      }
      if (!accepted) throw failure('ACCEPTANCE_NOT_VERIFIED');
      await unchangedTrigger();
      await currentMain();
      const activeVariables = { ...armedVariables, [CONTENT_KEY]: 'true' };
      delete activeVariables[RUN_KEY];
      await mutate(armed, activeVariables, env.GITHUB_SHA, 'activated', { requireNoAcceptance: true });
      if (activeVariables.ARTDICO_REGISTRATION_ENABLED === 'true') {
        await bounded(signal => verifyPublicRegistrationAlias(fetchPublic,
          approvedRegistrationPolicy({ contactEmail: env.ARTDICO_ADMIN_EMAIL, enabled: true }), signal), 'PUBLIC_REGISTRATION_NOT_VERIFIED');
        await currentMain();
        report('Public registration alias verified against the approved policy and capacity.');
      }
      return Object.freeze({ sourceCommit: env.GITHUB_SHA, contentEnabled: true,
        registrationEnabled: activeVariables.ARTDICO_REGISTRATION_ENABLED === 'true', acceptanceRunId: runId,
        privateOssAcceptance: 'passed', independentClients: 2, fcProcesses: 1 });
    } finally { clearTimeout(timer); controller.abort(); }
  } catch (error) { throw safeErrors.has(error) ? error : failure('LIFECYCLE_FAILED'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw failure('ARGUMENTS_NOT_ALLOWED');
    const result = await deployCloudLifecycle({ directory: resolve(process.argv[2]), repositoryDirectory: resolve(dirname(fileURLToPath(import.meta.url)), '..') });
    console.log('Cloud lifecycle verified: ' + JSON.stringify(result));
  } catch (error) {
    console.error(safeErrors.has(error) ? error.message : 'Cloud lifecycle was not verified.');
    process.exitCode = 1;
  }
}
