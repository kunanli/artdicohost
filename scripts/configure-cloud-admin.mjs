import { isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hashPassword, parseAdminUsers, verifyPassword } from '../functions/content-api/auth.mjs';
import { assertCurrentMainHead } from './deploy-oss.mjs';
import { createFcConfigClient, summarizeFcConfigError, assertFcEnvironmentMap } from './fc-config-client.mjs';
import { summarizeFcError, validateFcTriggerUrl } from './fc-client.mjs';
import { approvedRegistrationPolicy } from './approved-registration-policy.mjs';

const ACCOUNT = '1954121651395178';
const FUNCTION = `acs:fc:cn-hongkong:${ACCOUNT}:functions/artdicohost-api`;
const ROLE = `acs:ram::${ACCOUNT}:role/artdicohost-content-runtime`;
const OWNER_ID = 'staff-owner';
const OWNER_LABEL = '站点管理员';
const LEGACY_ROLES = ['editor', 'publisher', 'outreach'];
const ROLES = ['superadmin', ...LEGACY_ROLES];
const OWNED = Object.freeze({ NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'false',
  ARTDICO_CONTENT_API_ORIGIN: 'https://api.artdico.host', ARTDICO_PUBLIC_SITE_ORIGIN: 'https://artdico.host',
  ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong' });
const DEADLINE = 240_000;
const MAX_READS = 8;
const WAIT = 2000;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const safeErrors = new WeakSet();
const stage = (name, diagnostic) => {
  const error = new Error('Cloud admin setup was not verified: ' + name + (diagnostic ? ' [' + diagnostic + ']' : '') + '.');
  safeErrors.add(error); return error;
};
const descriptorValue = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
};

function setupEnvironment(value) {
  try {
    if (!plain(value) && value !== process.env) throw stage('CONTEXT_INVALID');
    const copy = {};
    for (const key of ['GITHUB_ACTIONS', 'GITHUB_EVENT_NAME', 'GITHUB_REF', 'GITHUB_REPOSITORY', 'GITHUB_SHA', 'GITHUB_TOKEN',
      'ARTDICO_CLOUD_ADMIN_SETUP_ENABLED', 'ARTDICO_FC_ACCOUNT_ID', 'FC_ACCESS_KEY_ID', 'FC_ACCESS_KEY_SECRET', 'FC_SECURITY_TOKEN',
      'ARTDICO_ADMIN_PASSWORD', 'ARTDICO_ADMIN_USERNAME', 'ARTDICO_ADMIN_EMAIL', 'ARTDICO_REGISTRATION_SETUP_ENABLED']) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) throw stage('CONTEXT_INVALID');
      copy[key] = descriptor?.value;
    }
    return copy;
  } catch (error) { throw safeErrors.has(error) ? error : stage('CONTEXT_INVALID'); }
}

export function requireCloudAdminSetupContext(input) {
  const env = setupEnvironment(input);
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main'
    || env.GITHUB_REPOSITORY !== 'kunanli/artdicohost' || typeof env.GITHUB_SHA !== 'string' || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA)
    || env.ARTDICO_CLOUD_ADMIN_SETUP_ENABLED !== 'true' || env.ARTDICO_FC_ACCOUNT_ID !== ACCOUNT
    || !['FC_ACCESS_KEY_ID', 'FC_ACCESS_KEY_SECRET'].every(key => typeof env[key] === 'string' && env[key].length)) throw stage('CONTEXT_INVALID');
  // Names are fixed public configuration identifiers; never include input values.
  for (const key of ['ARTDICO_ADMIN_USERNAME', 'ARTDICO_ADMIN_EMAIL']) {
    if (typeof env[key] !== 'string' || !env[key].length) throw stage('MISSING_REPOSITORY_VARIABLE_' + key);
  }
  if (typeof env.ARTDICO_ADMIN_PASSWORD !== 'string' || !env.ARTDICO_ADMIN_PASSWORD.length) throw stage('MISSING_REPOSITORY_SECRET_ARTDICO_ADMIN_PASSWORD');
  if (Buffer.byteLength(env.ARTDICO_ADMIN_PASSWORD) < 12 || Buffer.byteLength(env.ARTDICO_ADMIN_PASSWORD) > 1024) throw stage('ACCOUNT_INPUT_INVALID');
  if (env.ARTDICO_REGISTRATION_SETUP_ENABLED !== undefined
    && !['true', 'false'].includes(env.ARTDICO_REGISTRATION_SETUP_ENABLED)) throw stage('CONTEXT_INVALID');
}

function environmentFrom(value) {
  const input = descriptorValue(value, 'environmentVariables');
  if (input === undefined || input === null) return {};
  if (!plain(input) || Object.getOwnPropertySymbols(input).length || Object.keys(input).length > 100) throw stage('TARGET_CONFIGURATION_INVALID');
  const result = {};
  for (const key of Object.keys(input)) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)
      || !field || !Object.hasOwn(field, 'value') || typeof field.value !== 'string' || Buffer.byteLength(field.value) > 32 * 1024) throw stage('TARGET_CONFIGURATION_INVALID');
    Object.defineProperty(result, key, { value: field.value, enumerable: true, writable: true, configurable: true });
  }
  return result;
}

function functionSnapshot(value) {
  if (!plain(value)) throw stage('TARGET_CONFIGURATION_INVALID');
  const config = descriptorValue(value, 'customRuntimeConfig');
  if (descriptorValue(value, 'functionName') !== 'artdicohost-api' || descriptorValue(value, 'functionArn') !== FUNCTION
    || descriptorValue(value, 'runtime') !== 'custom.debian11' || descriptorValue(value, 'role') !== ROLE || !plain(config)
    || !isDeepStrictEqual(descriptorValue(config, 'command'), ['/code/bootstrap'])
    || descriptorValue(config, 'args') != null && !isDeepStrictEqual(descriptorValue(config, 'args'), []) || descriptorValue(config, 'port') !== 9000
    || typeof descriptorValue(value, 'codeChecksum') !== 'string' || !/^[A-Za-z0-9+/=_-]{1,128}$/u.test(descriptorValue(value, 'codeChecksum'))
    || !Number.isSafeInteger(descriptorValue(value, 'codeSize')) || descriptorValue(value, 'codeSize') <= 0) throw stage('TARGET_CONFIGURATION_INVALID');
  const snapshot = {};
  for (const key of ['functionName', 'functionArn', 'runtime', 'customRuntimeConfig', 'role', 'codeChecksum', 'codeSize',
    'timeout', 'cpu', 'memorySize', 'diskSize', 'instanceConcurrency', 'internetAccess', 'logConfig', 'vpcConfig', 'nasConfig',
    'ossMountConfig', 'customDNS', 'customContainerConfig', 'gpuConfig', 'instanceLifecycleConfig', 'sessionAffinity', 'disableOndemand', 'disableInjectCredentials',
    'enableLongLiving', 'instanceIsolationMode', 'idleTimeout', 'sessionAffinityConfig', 'layers', 'tracingConfig', 'handler', 'customHealthCheckConfig', 'instanceType']) {
    if (Object.hasOwn(value, key)) snapshot[key] = structuredClone(descriptorValue(value, key));
  }
  return snapshot;
}

function triggerSnapshot(value) {
  let config;
  try { config = JSON.parse(value?.triggerConfig); } catch { throw stage('SIGNED_TRIGGER_INVALID'); }
  if (!plain(value) || value.triggerType !== 'http' || value.qualifier !== 'LATEST' || !plain(config) || config.authType !== 'function'
    || !Array.isArray(config.methods) || !config.methods.includes('GET') || config.disableURLInternet === true) throw stage('SIGNED_TRIGGER_INVALID');
  let origin;
  try { origin = validateFcTriggerUrl(value.httpTrigger?.urlInternet); } catch { throw stage('SIGNED_TRIGGER_INVALID'); }
  return { triggerType: value.triggerType, qualifier: value.qualifier, config, origin };
}

function healthMatches(value, sourceCommit) {
  return value?.status === 200 && value.body?.status === 'ok' && value.body.scope === 'process-only' && value.body.sourceCommit === sourceCommit;
}

async function accountJson(env, existing) {
  // Derive only in process, then validate identity with the exact runtime parser.
  const passwordHash = await hashPassword(env.ARTDICO_ADMIN_PASSWORD);
  const identity = parseAdminUsers([{ id: OWNER_ID, username: env.ARTDICO_ADMIN_USERNAME, email: env.ARTDICO_ADMIN_EMAIL,
    label: OWNER_LABEL, roles: ROLES, passwordHash }])[0];
  if (typeof existing === 'string' && existing.trim()) {
    let input;
    try { input = JSON.parse(existing); } catch { throw stage('EXISTING_ACCOUNT_REQUIRES_REVIEW'); }
    const fields = ['id', 'username', 'email', 'label', 'roles', 'passwordHash'];
    if (!Array.isArray(input) || input.length !== 1 || !plain(input[0]) || Object.keys(input[0]).length !== fields.length
      || fields.some(key => !Object.hasOwn(input[0], key))) throw stage('EXISTING_ACCOUNT_REQUIRES_REVIEW');
    let current;
    try { current = parseAdminUsers(input)[0]; } catch { throw stage('EXISTING_ACCOUNT_REQUIRES_REVIEW'); }
    const currentRoles = [...current.roles].sort();
    const legacy = isDeepStrictEqual(currentRoles, [...LEGACY_ROLES].sort());
    if (['id', 'username', 'email', 'label'].some(key => current[key] !== identity[key])
      || !legacy && !isDeepStrictEqual(currentRoles, [...ROLES].sort())
      || !await verifyPassword(env.ARTDICO_ADMIN_PASSWORD, current.passwordHash)) throw stage('EXISTING_ACCOUNT_REQUIRES_REVIEW');
    return { json: legacy ? JSON.stringify([{ ...current, roles: ROLES }]) : existing, existingAccount: true };
  }
  const result = parseAdminUsers([{ ...identity, passwordHash }]);
  return { json: JSON.stringify(result), existingAccount: false };
}

function registrationEnvironment(env, previous) {
  let secret = previous.ARTDICO_REGISTRATION_TOKEN_SECRET;
  if (secret === undefined) secret = randomBytes(48).toString('base64url');
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(secret)
    || secret === env.ARTDICO_ADMIN_PASSWORD || secret === env.FC_ACCESS_KEY_SECRET) throw stage('REGISTRATION_SECRET_REQUIRES_REVIEW');
  const enabled = env.ARTDICO_REGISTRATION_SETUP_ENABLED === 'true';
  let policy;
  try { policy = approvedRegistrationPolicy({ contactEmail: env.ARTDICO_ADMIN_EMAIL, enabled }); }
  catch { throw stage('REGISTRATION_POLICY_INVALID'); }
  return { ARTDICO_REGISTRATION_TOKEN_SECRET: secret, ARTDICO_REGISTRATION_POLICY_JSON: JSON.stringify(policy),
    ARTDICO_REGISTRATION_CAPACITY: String(policy.capacity), ARTDICO_REGISTRATION_ENABLED: String(enabled) };
}

/** Trusted one-time account configuration only. No business activation, storage probe, filesystem output or secret return. */
export async function configureCloudAdmin(options = {}) {
  try {
    if (!plain(options) || Reflect.ownKeys(options).some(key => !['env', 'client', 'fetchHead', 'wait'].includes(key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'))) throw stage('SETUP_DEPENDENCY_INVALID');
    const env = setupEnvironment(descriptorValue(options, 'env') === undefined ? process.env : descriptorValue(options, 'env'));
    let client = descriptorValue(options, 'client');
    const fetchHead = descriptorValue(options, 'fetchHead') === undefined ? fetch : descriptorValue(options, 'fetchHead');
    const wait = descriptorValue(options, 'wait') === undefined ? (ms, settings) => delay(ms, undefined, settings) : descriptorValue(options, 'wait');
    requireCloudAdminSetupContext(env);
    if (typeof fetchHead !== 'function' || typeof wait !== 'function') throw stage('SETUP_DEPENDENCY_INVALID');
    const controller = new AbortController();
    const deadline = performance.now() + DEADLINE;
    const timer = setTimeout(() => controller.abort(), DEADLINE); timer.unref();
    async function bounded(operation, name) {
      if (controller.signal.aborted || performance.now() >= deadline) throw stage('SETUP_DEADLINE_EXCEEDED');
      let onAbort;
      const aborted = new Promise((_, reject) => { onAbort = () => reject(stage('SETUP_DEADLINE_EXCEEDED')); controller.signal.addEventListener('abort', onAbort, { once: true }); });
      try { return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), aborted]); }
      catch (error) {
        if (safeErrors.has(error)) throw error;
        throw stage(name, summarizeFcConfigError(error) ?? summarizeFcError(error));
      } finally { controller.signal.removeEventListener('abort', onAbort); }
    }
    const currentMain = () => bounded(signal => assertCurrentMainHead(env, (url, options) => fetchHead(url, { ...options, signal: AbortSignal.any([options.signal, signal]) })), 'CURRENT_MAIN_NOT_VERIFIED');
    try {
      await currentMain();
      if (!client) client = createFcConfigClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET,
        ...(env.FC_SECURITY_TOKEN ? { securityToken: env.FC_SECURITY_TOKEN } : {}) } });
      if (!['getFunction', 'getTrigger', 'checkHealth', 'updateEnvironment'].every(key => typeof client[key] === 'function')) throw stage('SETUP_DEPENDENCY_INVALID');
      const before = await bounded(signal => client.getFunction({ signal }), 'FUNCTION_INSPECTION_FAILED');
      const snapshot = functionSnapshot(before), previous = environmentFrom(before);
      if (before.lastUpdateStatus === 'InProgress' || ['Pending', 'Creating', 'Failed'].includes(before.state) || before.lastUpdateStatus === 'Failed') throw stage('FUNCTION_NOT_STABLE');
      if (previous.ARTDICO_CLOUD_CONTENT_ENABLED === 'true') throw stage('CONTENT_ALREADY_ENABLED');
      const trigger = triggerSnapshot(await bounded(signal => client.getTrigger({ signal }), 'TRIGGER_INSPECTION_FAILED'));
      const preHealth = await bounded(signal => client.checkHealth(trigger.origin, { signal }), 'PRE_UPDATE_HEALTH_NOT_VERIFIED');
      if (!healthMatches(preHealth, env.GITHUB_SHA)) throw stage('PRE_UPDATE_HEALTH_NOT_VERIFIED');
      const owner = await bounded(() => accountJson(env, previous.ADMIN_USERS_JSON), 'ACCOUNT_INPUT_INVALID');
      const expected = { ...previous, ...OWNED, ...registrationEnvironment(env, previous), ADMIN_USERS_JSON: owner.json };
      try { assertFcEnvironmentMap(expected); } catch { throw stage('CONFIGURATION_INPUT_INVALID'); }
      const changed = !isDeepStrictEqual(previous, expected);
      // A second inspection prevents overwriting a configuration modified during account preparation.
      const fresh = await bounded(signal => client.getFunction({ signal }), 'FUNCTION_RECHECK_FAILED');
      if (!isDeepStrictEqual(snapshot, functionSnapshot(fresh)) || !isDeepStrictEqual(previous, environmentFrom(fresh))) throw stage('CONFIGURATION_CHANGED_BEFORE_UPDATE');
      if (fresh.lastUpdateStatus === 'InProgress' || ['Pending', 'Creating', 'Failed'].includes(fresh.state) || fresh.lastUpdateStatus === 'Failed') throw stage('FUNCTION_NOT_STABLE');
      await currentMain();
      let updateDiagnostic;
      if (changed) {
        try { await bounded(signal => client.updateEnvironment(expected, { signal }), 'CONFIGURATION_UPDATE_NOT_ACKNOWLEDGED'); }
        catch (error) {
          // The request may have reached FC. Observe exact state without a second mutation.
          if (controller.signal.aborted) throw error;
          // Only this module's own bounded wrapper can have included an allowlisted diagnostic.
          updateDiagnostic = /\[(operation=UpdateFunction phase=[a-z_]+(?: status=\d{3})?(?: code=[A-Za-z]+)?)\]/u.exec(error.message)?.[1];
        }
      }
      let consecutive = 0;
      for (let attempt = 0; attempt < MAX_READS; attempt++) {
        let observed;
        try { observed = await bounded(signal => client.getFunction({ signal }), 'CONFIGURATION_READBACK_FAILED'); }
        catch (error) { if (controller.signal.aborted) throw error; }
        if (observed) {
          if (!isDeepStrictEqual(snapshot, functionSnapshot(observed))) throw stage('CODE_OR_CONFIGURATION_CHANGED');
          if (observed.state === 'Failed' || observed.lastUpdateStatus === 'Failed') throw stage('FUNCTION_UPDATE_FAILED');
          const variables = environmentFrom(observed);
          if (!isDeepStrictEqual(variables, previous) && !isDeepStrictEqual(variables, expected)) throw stage('UNEXPECTED_ENVIRONMENT_CHANGE');
          if (isDeepStrictEqual(variables, expected) && observed.lastUpdateStatus !== 'InProgress' && !['Pending', 'Creating'].includes(observed.state)) {
            let health;
            try { health = await bounded(signal => client.checkHealth(trigger.origin, { signal }), 'POST_UPDATE_HEALTH_NOT_VERIFIED'); }
            catch (error) { if (controller.signal.aborted) throw error; }
            consecutive = healthMatches(health, env.GITHUB_SHA) ? consecutive + 1 : 0;
          } else consecutive = 0;
        } else consecutive = 0;
        if (consecutive === 3) {
          const finalTrigger = triggerSnapshot(await bounded(signal => client.getTrigger({ signal }), 'TRIGGER_RECHECK_FAILED'));
          const final = await bounded(signal => client.getFunction({ signal }), 'FINAL_CONFIGURATION_READBACK_FAILED');
          if (!isDeepStrictEqual(trigger, finalTrigger) || !isDeepStrictEqual(snapshot, functionSnapshot(final)) || !isDeepStrictEqual(expected, environmentFrom(final))) throw stage('FINAL_CONFIGURATION_CHANGED');
          if (final.lastUpdateStatus === 'InProgress' || ['Pending', 'Creating', 'Failed'].includes(final.state) || final.lastUpdateStatus === 'Failed') throw stage('FUNCTION_NOT_STABLE');
          await currentMain();
          return Object.freeze({ configured: true, contentEnabled: false, storageVerified: false, codeUnchanged: true, existingAccount: owner.existingAccount, updated: changed });
        }
        if (attempt + 1 < MAX_READS) await bounded(signal => wait(WAIT, { signal }), 'CONFIGURATION_OBSERVATION_FAILED');
      }
      throw stage('CONFIGURATION_NOT_VERIFIED', updateDiagnostic);
    } finally { clearTimeout(timer); controller.abort(); }
  } catch (error) { throw safeErrors.has(error) ? error : stage('SETUP_FAILED'); }
}

// Shared read-only validation for the lifecycle controller; these never return credentials to logs.
export { environmentFrom as cloudAdminEnvironment, functionSnapshot as cloudAdminFunctionSnapshot,
  triggerSnapshot as cloudAdminTriggerSnapshot };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw stage('ARGUMENTS_NOT_ALLOWED');
    await configureCloudAdmin();
    console.log('Protected staff configuration verified. Content remains disabled; private storage has not been verified.');
  } catch (error) {
    console.error(safeErrors.has(error) ? error.message : 'Cloud admin setup was not verified.');
    process.exitCode = 1;
  }
}
