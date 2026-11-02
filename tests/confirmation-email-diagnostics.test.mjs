import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createConfirmationEmailProvider as buildConfirmationEmailProvider } from '../functions/registration-confirmation/email-provider.mjs';
import { CONFIRMATION_EMAIL_CONFIGURATION_FIELDS, CONFIRMATION_EMAIL_REASONS,
  validConfirmationDiagnostic, confirmationDiagnostic } from '../shared/confirmation-delivery.mjs';

const configuration = Object.freeze({
  EMAILJS_SERVICE_ID: 'synthetic_service',
  EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic_confirmation',
  EMAILJS_PUBLIC_KEY: 'SYNTHETIC_PROVIDER_PUBLIC_KEY',
  EMAILJS_PRIVATE_KEY: 'SYNTHETIC_PROVIDER_PRIVATE_KEY',
  EMAIL_FROM_ADDRESS: 'synthetic-sender@artdico.co',
  EMAIL_FROM_NAME: 'SYNTHETIC_SENDER_NAME',
});
const PRIVATE_FAILURE = 'SYNTHETIC_PROVIDER_BODY_MUST_NEVER_ESCAPE';
const createConfirmationEmailProvider = options => buildConfirmationEmailProvider({
  fetchFn: async () => assert.fail('synthetic diagnostics must never contact a real provider'), ...options,
});
const enabled = patch => ({ ...configuration, ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true', ...patch });
const acknowledgement = () => new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } });
function input(patch = {}) {
  const text = '合成确认正文，不包含真实参会资料。';
  return { recipient: 'synthetic-recipient@example.invalid', subject: '合成确认信', text,
    idempotencyKey: 'synthetic_confirmation_notice', templateVariables: {
      to_name: '合成收件人', to_email: 'synthetic-recipient@example.invalid', event_title: '合成活动',
      event_date: '2026-12-05', event_time: '10:00–18:00', event_venue: '合成活动地点',
      reference_code: 'synthetic_reference', invitation_text: text,
    }, ...patch };
}
function noPrivateOutput(value, additional = []) {
  const output = JSON.stringify(value);
  for (const secret of [...Object.values(configuration), PRIVATE_FAILURE, 'synthetic-recipient@example.invalid', ...additional]) {
    assert.equal(output.includes(JSON.stringify(secret).slice(1, -1)), false, 'only safe diagnostic codes and field names cross the provider boundary');
  }
}
function failed(result, status, diagnostic, reason) {
  assert.equal(result.status, status);
  assert.equal(validConfirmationDiagnostic(result.diagnostic), true, 'the emitted diagnostic passes the shared closed vocabulary');
  assert.deepEqual(result.diagnostic, diagnostic);
  if (reason !== undefined) assert.equal(result.reason, reason);
  noPrivateOutput(result);
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('synthetic provider did not settle')), 2000);
    })]);
  } finally { clearTimeout(timer); }
}

test('confirmation readiness exposes configuration field names without provider values', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => { calls++; return acknowledgement(); } });
  const state = await provider.readiness();
  assert.deepEqual(state, { ready: true, reason: 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF', enabled: true,
    missing: [], invalid: [], template: 'confirmation', deliveryProof: false });
  assert.equal(CONFIRMATION_EMAIL_REASONS.includes(state.reason), true);
  assert.equal(calls, 0, 'readiness is a local configuration check, not a delivery probe');
  noPrivateOutput(state);
});

test('each absent confirmation field is identified separately from invalid nonempty configuration', async t => {
  for (const field of CONFIRMATION_EMAIL_CONFIGURATION_FIELDS) await t.test(field, async () => {
    const env = enabled(); delete env[field];
    let calls = 0;
    const provider = createConfirmationEmailProvider({ env, fetchFn: async () => { calls++; return acknowledgement(); } });
    const state = await provider.readiness();
    assert.equal(state.ready, false); assert.equal(state.enabled, true);
    assert.equal(state.reason, 'EMAIL_CONFIGURATION_MISSING');
    assert.deepEqual(state.missing, [field]); assert.deepEqual(state.invalid, []);
    assert.equal(state.template, 'confirmation'); assert.equal(state.deliveryProof, false);
    failed(await provider.send(input()), 'rejected', { code: 'EMAIL_CONFIGURATION_MISSING', transportStarted: false });
    assert.equal(calls, 0); noPrivateOutput(state);
  });
});

test('malformed nonempty configuration reports only the six confirmation field names', async t => {
  const invalid = {
    EMAILJS_SERVICE_ID: 'synthetic invalid service', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic/template',
    EMAILJS_PUBLIC_KEY: 'synthetic\npublic', EMAILJS_PRIVATE_KEY: 'synthetic\u0000private',
    EMAIL_FROM_ADDRESS: 'synthetic-sender@example.invalid', EMAIL_FROM_NAME: 'synthetic\u0000sender',
  };
  for (const field of CONFIRMATION_EMAIL_CONFIGURATION_FIELDS) await t.test(field, async () => {
    let calls = 0;
    const provider = createConfirmationEmailProvider({ env: enabled({ [field]: invalid[field] }),
      fetchFn: async () => { calls++; return acknowledgement(); } });
    const state = await provider.readiness();
    assert.equal(state.ready, false); assert.equal(state.reason, 'EMAIL_CONFIGURATION_INVALID');
    assert.deepEqual(state.missing, []); assert.deepEqual(state.invalid, [field]);
    assert.equal(state.invalid.every(name => CONFIRMATION_EMAIL_CONFIGURATION_FIELDS.includes(name)), true);
    failed(await provider.send(input()), 'rejected', { code: 'EMAIL_CONFIGURATION_INVALID', transportStarted: false });
    assert.equal(await provider.configurationIdentity(), null); assert.equal(calls, 0); noPrivateOutput(state, [invalid[field]]);
  });
});

test('disabled readiness and send do not load a protected configuration or contact the provider', async () => {
  let loads = 0, calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled({ ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'false' }),
    loadConfiguration: async () => { loads++; throw new Error(PRIVATE_FAILURE); },
    fetchFn: async () => { calls++; return acknowledgement(); } });
  const state = await provider.readiness();
  assert.equal(state.ready, false); assert.equal(state.reason, 'EMAIL_DISABLED'); assert.equal(state.enabled, false);
  assert.deepEqual(state.missing, []); assert.deepEqual(state.invalid, []);
  failed(await provider.send(input()), 'rejected', { code: 'EMAIL_DISABLED', transportStarted: false });
  assert.equal(loads, 0); assert.equal(calls, 0); noPrivateOutput(state);
});

test('a protected configuration read failure is distinguished without leaking its error', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' },
    loadConfiguration: async () => { throw new Error(PRIVATE_FAILURE); },
    fetchFn: async () => { calls++; return acknowledgement(); } });
  assert.deepEqual(await provider.readiness(), { ready: false, enabled: true, reason: 'EMAIL_CONFIGURATION_UNAVAILABLE',
    missing: [], invalid: [], template: 'confirmation', deliveryProof: false });
  failed(await provider.send(input()), 'rejected', { code: 'EMAIL_CONFIGURATION_UNAVAILABLE', transportStarted: false });
  assert.equal(await provider.configurationIdentity(), null); assert.equal(calls, 0);
});

test('readiness success does not permit a send after the subsequent fresh configuration load fails', async () => {
  let loads = 0, calls = 0;
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' },
    loadConfiguration: async () => { if (++loads === 1) return { ...configuration }; throw new Error(PRIVATE_FAILURE); },
    fetchFn: async () => { calls++; return acknowledgement(); } });
  assert.equal((await provider.readiness()).ready, true);
  failed(await provider.send(input()), 'rejected', { code: 'EMAIL_CONFIGURATION_UNAVAILABLE', transportStarted: false });
  assert.equal(loads, 2); assert.equal(calls, 0);
});

test('the final guard distinguishes a refusal and an unavailable check before transport', async t => {
  for (const [code, canStart] of [['DELIVERY_GUARD_BLOCKED', () => false],
    ['DELIVERY_GUARD_UNAVAILABLE', () => { throw new Error(PRIVATE_FAILURE); }]]) await t.test(code, async () => {
    let calls = 0;
    const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => { calls++; return acknowledgement(); } });
    failed(await provider.send(input({ canStart })), 'rejected', { code, transportStarted: false }, 'DELIVERY_WINDOW_EXPIRED');
    assert.equal(calls, 0);
  });
});

test('a timed-out asynchronous guard never starts transport after it eventually returns true', async () => {
  const gate = deferred(), entered = deferred(), completed = deferred(); let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), timeoutMs: 20,
    fetchFn: async () => { calls++; return acknowledgement(); } });
  const pending = provider.send(input({ canStart: async () => {
    entered.resolve(); const allowed = await gate.promise; completed.resolve(); return allowed;
  } }));
  await bounded(entered.promise);
  failed(await bounded(pending), 'rejected', { code: 'DELIVERY_WINDOW_EXPIRED', transportStarted: false });
  assert.equal(calls, 0); gate.resolve(true); await bounded(completed.promise); await nextTurn();
  assert.equal(calls, 0, 'settling the expired guard cannot create a late provider request');
});

test('the send deadline also covers configuration loading and blocks a late completed load', async () => {
  const gate = deferred(), entered = deferred(), completed = deferred(); let calls = 0;
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' }, timeoutMs: 20,
    loadConfiguration: async () => { entered.resolve(); const config = await gate.promise; completed.resolve(); return config; },
    fetchFn: async () => { calls++; return acknowledgement(); } });
  const pending = provider.send(input()); await bounded(entered.promise);
  failed(await bounded(pending), 'rejected', { code: 'DELIVERY_WINDOW_EXPIRED', transportStarted: false });
  gate.resolve({ ...configuration }); await bounded(completed.promise); await nextTurn(); assert.equal(calls, 0);
});

test('a fetch exception is unknown after transport started and never exposes the exception', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => { calls++; throw new Error(PRIVATE_FAILURE); } });
  failed(await provider.send(input()), 'unknown', { code: 'DELIVERY_UNKNOWN', transportStarted: true });
  assert.equal(calls, 1);
});

test('a timed-out request remains unknown after transport started even if its late response accepts', async () => {
  const gate = deferred(), entered = deferred(); let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), timeoutMs: 20,
    fetchFn: async () => { calls++; entered.resolve(); return gate.promise; } });
  const pending = provider.send(input()); await bounded(entered.promise);
  try {
    failed(await bounded(pending), 'unknown', { code: 'DELIVERY_UNKNOWN', transportStarted: true });
    assert.equal(calls, 1);
  } finally { gate.resolve(acknowledgement()); }
  await nextTurn(); assert.equal(calls, 1, 'a late acknowledgement never triggers another provider request');
});

test('a refused response whose body cannot be fully read remains unknown', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => {
    calls++; return new Response(new ReadableStream({ start(controller) { controller.error(new Error(PRIVATE_FAILURE)); } }),
      { status: 403, headers: { 'content-type': 'text/plain' } });
  } });
  const result = await provider.send(input());
  assert.equal(result.status, 'unknown'); assert.equal(result.diagnostic.code, 'DELIVERY_UNKNOWN');
  assert.equal(result.diagnostic.transportStarted, true); assert.equal(validConfirmationDiagnostic(result.diagnostic), true);
  if (Object.hasOwn(result.diagnostic, 'httpStatus')) assert.equal(result.diagnostic.httpStatus, 403);
  noPrivateOutput(result); assert.equal(calls, 1);
});

test('complete explicit 4xx refusals retain only their safe HTTP status', async t => {
  for (const httpStatus of [400, 401, 403, 404, 429]) await t.test(String(httpStatus), async () => {
    const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => new Response(PRIVATE_FAILURE,
      { status: httpStatus, headers: { 'content-type': 'text/plain' } }) });
    failed(await provider.send(input()), 'rejected', { code: 'PROVIDER_REJECTED', transportStarted: true, httpStatus }, 'PROVIDER_REJECTED');
  });
});

test('provider acceptance keeps its original shape and only accepts the strict EmailJS acknowledgement', async t => {
  const accepted = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => acknowledgement() });
  assert.deepEqual(await accepted.send(input()), { status: 'provider_accepted' });
  for (const [name, response] of [
    ['wrong mime', () => new Response('OK', { status: 200, headers: { 'content-type': 'text/html' } })],
    ['wrong acknowledgement', () => new Response(PRIVATE_FAILURE, { status: 200, headers: { 'content-type': 'text/plain' } })],
    ['server error', () => new Response(PRIVATE_FAILURE, { status: 503, headers: { 'content-type': 'text/plain' } })],
  ]) await t.test(name, async () => {
    const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => response() });
    failed(await provider.send(input()), 'unknown', { code: 'DELIVERY_UNKNOWN', transportStarted: true, httpStatus: name === 'server error' ? 503 : 200 });
  });
});

test('invalid generated email input is rejected without contacting EmailJS', async () => {
  let calls = 0;
  const provider = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => { calls++; return acknowledgement(); } });
  failed(await provider.send(input({ recipient: 'not a mailbox' })), 'rejected',
    { code: 'INVALID_EMAIL_INPUT', transportStarted: false }, 'INVALID_EMAIL_INPUT');
  assert.equal(calls, 0);
});

test('configuration identity follows effective values across direct, bundled, disabled and reordered inputs', async () => {
  const direct = createConfirmationEmailProvider({ env: enabled(), fetchFn: async () => assert.fail('identity never sends') });
  const baseline = await direct.configurationIdentity(); assert.match(baseline, /^[a-f0-9]{64}$/u);
  const reversed = Object.fromEntries(Object.entries(configuration).reverse());
  for (const env of [enabled({ UNRELATED_SYNTHETIC_VALUE: 'changed', EMAILJS_TEMPLATE_ID: 'unrelated_legacy_template' }),
    enabled({ ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'false', ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID: 'a'.repeat(64) })]) {
    const same = createConfirmationEmailProvider({ env, fetchFn: async () => assert.fail('identity never sends') });
    assert.equal(await same.configurationIdentity(), baseline, 'feature flags and unrelated configuration do not manufacture a repair');
  }
  for (const flag of ['true', 'false']) {
    const bundled = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: flag,
      ARTDICO_CONFIRMATION_EMAIL_BUNDLE_ID: 'b'.repeat(64), UNRELATED_SYNTHETIC_VALUE: 'different' },
    loadConfiguration: async () => reversed, fetchFn: async () => assert.fail('identity never sends') });
    assert.equal(await bundled.configurationIdentity(), baseline, 'identity compares plaintext effective configuration rather than bundle bytes or flag');
  }
  noPrivateOutput(await direct.readiness());
});

test('every effective confirmation field participates in configuration identity', async t => {
  const baseline = await createConfirmationEmailProvider({ env: enabled() }).configurationIdentity();
  const alternatives = { EMAILJS_SERVICE_ID: 'synthetic_service_changed', EMAILJS_CONFIRMATION_TEMPLATE_ID: 'synthetic_confirmation_changed',
    EMAILJS_PUBLIC_KEY: 'SYNTHETIC_CHANGED_PUBLIC_KEY', EMAILJS_PRIVATE_KEY: 'SYNTHETIC_CHANGED_PRIVATE_KEY',
    EMAIL_FROM_ADDRESS: 'synthetic-changed-sender@artdico.co', EMAIL_FROM_NAME: 'SYNTHETIC_CHANGED_SENDER' };
  for (const field of CONFIRMATION_EMAIL_CONFIGURATION_FIELDS) await t.test(field, async () => {
    const value = await createConfirmationEmailProvider({ env: enabled({ [field]: alternatives[field] }) }).configurationIdentity();
    assert.match(value, /^[a-f0-9]{64}$/u); assert.notEqual(value, baseline);
  });
  assert.equal(await createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' } }).configurationIdentity(), null);
});

test('send binds an expected identity to the fresh effective configuration without leaking the identity', async () => {
  let current = { ...configuration }, loads = 0, calls = 0;
  const provider = createConfirmationEmailProvider({ env: { ARTDICO_CONFIRMATION_EMAIL_ENABLED: 'true' },
    loadConfiguration: async () => { loads++; return { ...current }; }, fetchFn: async () => { calls++; return acknowledgement(); } });
  const identity = await provider.configurationIdentity();
  assert.deepEqual(await provider.send(input({ expectedConfigurationIdentity: identity })), { status: 'provider_accepted' });
  assert.equal(calls, 1);
  current.EMAILJS_CONFIRMATION_TEMPLATE_ID = 'synthetic_changed_after_preview';
  const result = await provider.send(input({ expectedConfigurationIdentity: identity }));
  failed(result, 'rejected', { code: 'EMAIL_CONFIGURATION_CHANGED', transportStarted: false });
  assert.equal(JSON.stringify(result).includes(identity), false);
  assert.equal(calls, 1); assert.ok(loads >= 3, 'the send checks a newly loaded configuration');
});

test('shared diagnostic projection rejects extra data, accessors and impossible transport states', () => {
  const safe = { code: 'PROVIDER_REJECTED', transportStarted: true, httpStatus: 429 };
  assert.deepEqual(confirmationDiagnostic(safe), safe); assert.notEqual(confirmationDiagnostic(safe), safe);
  let getterCalls = 0;
  const getter = { transportStarted: false };
  Object.defineProperty(getter, 'code', { enumerable: true, get() { getterCalls++; return 'EMAIL_DISABLED'; } });
  for (const value of [getter, { ...safe, body: PRIVATE_FAILURE }, { ...safe, transportStarted: false },
    { code: 'DELIVERY_UNKNOWN', transportStarted: false }, { code: 'EMAIL_DISABLED', transportStarted: false, httpStatus: 400 },
    { code: PRIVATE_FAILURE, transportStarted: true }, { ...safe, httpStatus: 503 }, Object.create(safe)]) {
    assert.equal(validConfirmationDiagnostic(value), false); assert.equal(confirmationDiagnostic(value), null);
  }
  assert.equal(getterCalls, 0, 'diagnostic validation never executes untrusted getters');
});
