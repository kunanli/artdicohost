import test from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationEmailProvider } from '../functions/intent-invitations/email-provider.mjs';

const env = { ARTDICO_INVITATION_EMAIL_ENABLED: 'true', EMAILJS_SERVICE_ID: 'synthetic_service', EMAILJS_TEMPLATE_ID: 'synthetic_template',
  EMAILJS_PUBLIC_KEY: 'SYNTHETIC-PUBLIC', EMAILJS_PRIVATE_KEY: 'SYNTHETIC-PRIVATE', EMAIL_FROM_ADDRESS: 'synthetic-sender@artdico.co', EMAIL_FROM_NAME: '合成筹备团队' };
const input = { recipient: 'synthetic@example.invalid', subject: '合成邀请', text: '合成正文\n不代表送达。', idempotencyKey: 'i_synthetic',
  templateVariables: { to_name: '合成来宾', to_email: 'synthetic@example.invalid', event_title: '合成活动', event_date: '2026-12-05', event_time: '09:30–18:00',
    event_venue: '合成地点', reference_code: 'R_SYNTHETIC', invitation_text: '合成正文\n不代表送达。' } };

test('provider requires explicit enable, exact company sender and all server-only service credentials', async () => {
  let calls = 0; const fetchFn = async () => { calls++; return new Response('OK'); };
  for (const name of Object.keys(env)) {
    const config = { ...env }; delete config[name];
    const provider = createInvitationEmailProvider({ env: config, fetchFn });
    assert.equal(provider.readiness().ready, false, name); assert.equal((await provider.send(input)).status, 'rejected');
  }
  for (const sender of ['bad@example.invalid', 'Display <staff@artdico.co>', 'staff@sub.artdico.co', 'staff@artdico.co\r\nBcc:someone@example.invalid']) {
    assert.equal(createInvitationEmailProvider({ env: { ...env, EMAIL_FROM_ADDRESS: sender }, fetchFn }).readiness().ready, false);
  }
  assert.equal(calls, 0);
});

test('one fixed EmailJS POST uses the configured template and returns acceptance without claiming delivery or leaking values', async () => {
  const calls = [];
  const provider = createInvitationEmailProvider({ env, fetchFn: async (url, options) => { calls.push({ url, options }); return new Response('OK', { status: 200 }); } });
  assert.deepEqual(await provider.send(input), { status: 'provider_accepted' }); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.emailjs.com/api/v1.0/email/send'); assert.equal(calls[0].options.redirect, 'error');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.accessToken, env.EMAILJS_PRIVATE_KEY); assert.equal(body.template_params.from_email, env.EMAIL_FROM_ADDRESS);
  assert.equal(body.template_params.to_email, input.recipient); assert.equal(body.template_params.invitation_text, input.text);
  assert.doesNotMatch(JSON.stringify(provider.readiness()), /SYNTHETIC|@/u);
});

test('recipient lists, header injection and caller-selected template variables are rejected before network', async () => {
  let calls = 0; const provider = createInvitationEmailProvider({ env, fetchFn: async () => { calls++; return new Response('OK'); } });
  for (const patch of [{ recipient: 'a@example.invalid,b@example.invalid' }, { subject: 'hello\r\nBcc: injected@example.invalid' },
    { templateVariables: { ...input.templateVariables, from_email: 'attacker@example.invalid' } }, { idempotencyKey: '../other' }]) {
    assert.equal((await provider.send({ ...input, ...patch })).status, 'rejected');
  }
  assert.equal(calls, 0);
});

test('lost ACK, unbounded body, redirect and provider failures remain safe and never retry', async () => {
  for (const implementation of [async () => { throw new Error('PRIVATE-SYNTHETIC-TOKEN'); },
    async () => new Response('x'.repeat(4097)), async () => new Response('PRIVATE-SYNTHETIC', { status: 302 }),
    async () => new Response('<html>OK</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    async () => new Response('PRIVATE-SYNTHETIC', { status: 500 }), async () => new Response('PRIVATE-SYNTHETIC', { headers: { 'content-length': '9999' } })]) {
    let calls = 0; const provider = createInvitationEmailProvider({ env, fetchFn: async (...args) => { calls++; return implementation(...args); } });
    assert.deepEqual(await provider.send(input), { status: 'unknown' }); assert.equal(calls, 1);
  }
  const denied = createInvitationEmailProvider({ env, fetchFn: async () => new Response('PRIVATE-SYNTHETIC', { status: 400 }) });
  assert.deepEqual(await denied.send(input), { status: 'rejected', reason: 'PROVIDER_REJECTED' });
});

test('fixed timeout bounds unknown provider acknowledgement without a second request', async () => {
  let calls = 0;
  const provider = createInvitationEmailProvider({ env, timeoutMs: 20, fetchFn: async () => { calls++; return new Promise(() => {}); } });
  // Keep the runner alive while the production timeout is unref'ed.
  const timer = setTimeout(() => {}, 1000);
  try { assert.deepEqual(await provider.send(input), { status: 'unknown' }); assert.equal(calls, 1); }
  finally { clearTimeout(timer); }
});
