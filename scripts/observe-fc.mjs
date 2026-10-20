import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFcClient, summarizeFcError, validateFcTriggerUrl } from './fc-client.mjs';

export const EXPECTED_MAIN = 'dff3c897bdadfbe555459366183ccab1fbca0195';
const DIAGNOSTIC_REF = 'refs/heads/diag/fc-observe-dff3';
const MAIN_URL = 'https://api.github.com/repos/kunanli/artdicohost/git/ref/heads/main';
const FUNCTION_NAME = 'artdicohost-api';
const REGION = 'cn-hongkong';
const DEADLINE_MS = 90_000;
const MAX_MAIN_BYTES = 64 * 1024;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/u.test(value);
const safeErrors = new WeakSet();
function failure(message, error) {
  const diagnostic = summarizeFcError(error);
  const result = new Error(message + (diagnostic ? ` [${diagnostic}]` : ''));
  safeErrors.add(result);
  return result;
}

export function requireObservationContext(env) {
  if (!record(env) || env.GITHUB_ACTIONS !== 'true' || env.GITHUB_EVENT_NAME !== 'push'
    || env.GITHUB_REF !== DIAGNOSTIC_REF || env.GITHUB_REPOSITORY !== 'kunanli/artdicohost'
    || !sha(env.GITHUB_SHA)) throw failure('Only the fixed diagnostic branch push in kunanli/artdicohost may observe FC.');
  if (typeof env.ARTDICO_FC_ACCOUNT_ID !== 'string' || !/^\d{6,32}$/u.test(env.ARTDICO_FC_ACCOUNT_ID)
    || !['FC_ACCESS_KEY_ID', 'FC_ACCESS_KEY_SECRET', 'GITHUB_TOKEN'].every(key => typeof env[key] === 'string' && /^[\x21-\x7e]{1,8192}$/u.test(env[key]))) throw failure('Read-only FC observation requires the configured account and Actions credentials.');
}

function field(value, key, choices) {
  if (!Object.hasOwn(value, key)) return { value: 'unknown', presence: 'absent' };
  if (value[key] === null) return { value: 'unknown', presence: 'null' };
  return typeof value[key] === 'string' && choices.includes(value[key])
    ? { value: value[key], presence: 'recognized' } : { value: 'unknown', presence: 'unrecognized' };
}

function metadata(value) {
  const state = field(value, 'state', ['Active', 'Pending', 'Creating', 'Inactive', 'Failed']);
  const update = field(value, 'lastUpdateStatus', ['Successful', 'InProgress', 'Failed']);
  const result = { state: state.value, update: update.value, statePresence: state.presence, updatePresence: update.presence };
  if (Number.isSafeInteger(value.codeSize) && value.codeSize >= 0 && value.codeSize <= 1024 * 1024 * 1024) result.codeSizeBytes = value.codeSize;
  if (typeof value.codeChecksum === 'string' && /^(?:0|[1-9]\d{0,19})$/u.test(value.codeChecksum)
    && BigInt(value.codeChecksum) <= 18446744073709551615n) result.codeChecksumCRC64 = value.codeChecksum;
  return result;
}

function functionSnapshot(value, accountId) {
  const config = value?.customRuntimeConfig;
  const variables = value?.environmentVariables;
  if (!record(value) || value.functionName !== FUNCTION_NAME || value.runtime !== 'custom.debian11'
    || value.functionArn !== `acs:fc:${REGION}:${accountId}:functions/${FUNCTION_NAME}`
    || !record(config) || !isDeepStrictEqual(config.command, ['/code/bootstrap']) || config.port !== 9000
    || config.args != null && !isDeepStrictEqual(config.args, []) || variables != null && !record(variables)
    || variables?.ARTDICO_FC_PORT !== undefined && variables.ARTDICO_FC_PORT !== '9000') throw failure('FC observation target is not the approved isolated runtime.');
  return structuredClone({ runtime: value.runtime, customRuntimeConfig: config, environmentVariables: variables,
    role: value.role, codeSize: value.codeSize, codeChecksum: value.codeChecksum });
}

function triggerSnapshot(value) {
  let config, origin;
  try { config = typeof value?.triggerConfig === 'string' ? JSON.parse(value.triggerConfig) : null; }
  catch { /* Fixed validation failure below. */ }
  if (!record(value) || value.triggerType !== 'http' || value.qualifier !== 'LATEST' || !record(config)
    || config.authType !== 'function' || !Array.isArray(config.methods) || !config.methods.includes('GET')
    || config.disableURLInternet === true) throw failure('FC observation requires the authenticated Internet GET trigger for LATEST.');
  try { origin = validateFcTriggerUrl(value.httpTrigger?.urlInternet); }
  catch { throw failure('FC observation trigger is not a fixed Hong Kong HTTPS function URL.'); }
  return { origin, triggerType: value.triggerType, qualifier: value.qualifier, config };
}

async function abortable(promise, signal) {
  if (signal.aborted) {
    Promise.resolve(promise).catch(() => {});
    throw failure('FC read-only observation exceeded its deadline.');
  }
  return new Promise((accept, reject) => {
    const abort = () => reject(failure('FC read-only observation exceeded its deadline.'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { signal.removeEventListener('abort', abort); accept(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

async function currentMain(env, fetchHead, parentSignal) {
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(20_000)]);
  let response, reader;
  try {
    response = await abortable(fetchHead(MAIN_URL, { method: 'GET', headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + env.GITHUB_TOKEN }, redirect: 'error', cache: 'no-store', signal }), signal);
    const declared = response.headers.get('content-length');
    if (response.status !== 200 || response.redirected || response.url && response.url !== MAIN_URL
      || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
      || declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_MAIN_BYTES)) throw failure('Current main could not be verified.');
    reader = response.body?.getReader();
    if (!reader) throw failure('Current main could not be verified.');
    const chunks = [];
    let length = 0;
    while (true) {
      const { done, value } = await abortable(reader.read(), signal);
      if (done) break;
      if (!(value instanceof Uint8Array) || (length += value.byteLength) > MAX_MAIN_BYTES) throw failure('Current main could not be verified.');
      chunks.push(value);
    }
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (body?.object?.sha !== EXPECTED_MAIN) throw failure('Current main differs from the fixed expected commit; no read-only verification was recorded.');
  } finally {
    if (reader) { reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* No stream details are exposed. */ } }
    else response?.body?.cancel().catch(() => {});
  }
}

/** Observe only: no code upload, configuration write, object write, or readiness claim. */
export async function observeFc({ env = process.env, client, fetchHead = fetch, report = line => console.log(line) } = {}) {
  requireObservationContext(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEADLINE_MS);
  timer.unref();
  const emit = line => { try { report(line); } catch { throw failure('FC read-only observation could not report its safe result.'); } };
  async function bounded(operation, message) {
    try { return await abortable(Promise.resolve().then(() => operation(controller.signal)), controller.signal); }
    catch (error) {
      if (controller.signal.aborted) throw failure('FC read-only observation exceeded its deadline; no verification was recorded.');
      throw failure(message, error);
    }
  }
  try {
    await bounded(signal => currentMain(env, fetchHead, signal), 'Cannot verify that main is the fixed expected commit; no observation was verified.');
    emit('FC read-only expected main: ' + EXPECTED_MAIN);
    if (!client) client = await bounded(() => createFcClient({ credentials: { accessKeyId: env.FC_ACCESS_KEY_ID, accessKeySecret: env.FC_ACCESS_KEY_SECRET,
      ...(env.FC_SECURITY_TOKEN ? { securityToken: env.FC_SECURITY_TOKEN } : {}) } }), 'FC read-only client could not be initialized.');
    if (!['getFunction', 'getTrigger', 'checkHealth'].every(key => typeof client[key] === 'function')) throw failure('FC read-only client is incomplete.');
    const before = await bounded(signal => client.getFunction({ signal }), 'FC function could not be read.');
    const snapshot = functionSnapshot(before, env.ARTDICO_FC_ACCOUNT_ID);
    const trigger = triggerSnapshot(await bounded(signal => client.getTrigger({ signal }), 'FC trigger could not be read.'));
    emit('FC read-only function before: ' + JSON.stringify(metadata(before)));
    let matches = 0;
    for (let probe = 1; probe <= 3; probe++) {
      let health, diagnostic;
      await bounded(async signal => {
        try { health = await client.checkHealth(trigger.origin, { signal }); }
        catch (error) {
          const safe = summarizeFcError(error);
          if (safe?.startsWith('operation=CheckHealth ')) diagnostic = safe;
        }
      }, 'FC signed health observation could not finish.');
      const valid = health?.status === 200 && health.body?.status === 'ok' && health.body.scope === 'process-only';
      const sourceCommit = valid && sha(health.body.sourceCommit) ? health.body.sourceCommit : null;
      const match = sourceCommit === EXPECTED_MAIN;
      matches = match ? matches + 1 : 0;
      emit('FC read-only signed health: ' + JSON.stringify({ probe, status: match ? 'expected-source' : 'not-verified',
        ...(sourceCommit ? { sourceCommit } : {}), ...(diagnostic ? { diagnostic } : {}) }));
    }
    const after = await bounded(signal => client.getFunction({ signal }), 'FC function could not be rechecked.');
    if (!isDeepStrictEqual(snapshot, functionSnapshot(after, env.ARTDICO_FC_ACCOUNT_ID))) throw failure('FC function settings or code metadata changed during observation.');
    const finalTrigger = triggerSnapshot(await bounded(signal => client.getTrigger({ signal }), 'FC trigger could not be rechecked.'));
    if (!isDeepStrictEqual(trigger, finalTrigger)) throw failure('FC trigger changed during observation.');
    emit('FC read-only function after: ' + JSON.stringify(metadata(after)));
    await bounded(signal => currentMain(env, fetchHead, signal), 'Cannot verify that main stayed at the fixed expected commit; no observation was verified.');
    if (matches !== 3) throw failure('FC did not provide three consecutive signed process-only proofs of the fixed main commit.');
    emit('FC read-only verified: ' + EXPECTED_MAIN + '; no resource was changed; business readiness was not verified.');
    return { observation: 'read-only-verified', sourceCommit: EXPECTED_MAIN, signedHealthChecks: 3, businessReady: false };
  } catch (error) {
    throw safeErrors.has(error) ? error : failure('FC read-only observation failed; no verification was recorded.', error);
  } finally { clearTimeout(timer); controller.abort(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await observeFc();
