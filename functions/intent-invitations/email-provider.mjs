import { plainData, identifier } from './errors.mjs';

const ENDPOINT = 'https://api.emailjs.com/api/v1.0/email/send';
const VARIABLE_KEYS = ['to_name', 'to_email', 'event_title', 'event_date', 'event_time', 'event_venue', 'reference_code', 'invitation_text'];
const CONFIG_KEYS = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];
const mailbox = value => typeof value === 'string' && value.length <= 254
  && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?\.[A-Za-z]{2,63}$/u.test(value);
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max
  && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);

/** Fixed server-only provider. Local durable issuance prevents replay; EmailJS
 * does not document an idempotency-key guarantee. HTTP 200 means accepted only. */
export function createInvitationEmailProvider({ env = {}, fetchFn = fetch, timeoutMs = 10_000 } = {}) {
  if (typeof fetchFn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000) throw new TypeError('Invalid invitation provider dependencies.');
  const config = {};
  for (const name of ['ARTDICO_INVITATION_EMAIL_ENABLED', ...CONFIG_KEYS]) {
    const field = Object.getOwnPropertyDescriptor(env, name);
    config[name] = field && Object.hasOwn(field, 'value') ? field.value : undefined;
  }
  const ready = config.ARTDICO_INVITATION_EMAIL_ENABLED === 'true'
    && CONFIG_KEYS.every(key => line(config[key], key === 'EMAIL_FROM_ADDRESS' ? 254 : key === 'EMAIL_FROM_NAME' ? 80 : 1024))
    && ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID'].every(key => /^[A-Za-z0-9_-]{1,128}$/u.test(config[key] ?? ''))
    && mailbox(config.EMAIL_FROM_ADDRESS) && config.EMAIL_FROM_ADDRESS.split('@')[1].toLowerCase() === 'artdico.co';
  return Object.freeze({
    readiness: () => ({ ready, reason: ready ? 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' : 'EMAIL_NOT_READY' }),
    async send({ recipient, subject, text, templateVariables, idempotencyKey } = {}) {
      if (!ready) return { status: 'rejected', reason: 'EMAIL_NOT_READY' };
      if (!mailbox(recipient) || !line(subject, 500) || typeof text !== 'string' || !text.length || text.length > 16_000
        || !text.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text) || !identifier(idempotencyKey)
        || !plainData(templateVariables) || Object.keys(templateVariables).length !== VARIABLE_KEYS.length
        || VARIABLE_KEYS.some(key => typeof templateVariables[key] !== 'string' || templateVariables[key].length > (key === 'invitation_text' ? 16_000 : 500))
        || Object.keys(templateVariables).some(key => !VARIABLE_KEYS.includes(key))
        || templateVariables.to_email !== recipient || templateVariables.invitation_text !== text) return { status: 'rejected', reason: 'INVALID_EMAIL_INPUT' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
      let response;
      const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('Email timeout')), { once: true }));
      aborted.catch(() => {});
      try {
        const body = JSON.stringify({ service_id: config.EMAILJS_SERVICE_ID, template_id: config.EMAILJS_TEMPLATE_ID,
          user_id: config.EMAILJS_PUBLIC_KEY, accessToken: config.EMAILJS_PRIVATE_KEY,
          template_params: { ...templateVariables, from_name: config.EMAIL_FROM_NAME, from_email: config.EMAIL_FROM_ADDRESS } });
        if (Buffer.byteLength(body) > 40_000) return { status: 'rejected', reason: 'INVALID_EMAIL_INPUT' };
        response = await Promise.race([Promise.resolve().then(() => fetchFn(ENDPOINT, { method: 'POST', redirect: 'error',
          headers: { 'content-type': 'application/json', accept: 'text/plain' }, body, signal: controller.signal })), aborted]);
        if (!response || !Number.isInteger(response.status) || response.redirected || response.url && response.url !== ENDPOINT) return { status: 'unknown' };
        // Provider content never becomes diagnostics. Bound both declared and
        // actual bytes before accepting an acknowledgement.
        const declared = response.headers?.get('content-length');
        if (declared !== null && declared !== undefined && (!/^(?:0|[1-9]\d*)$/u.test(declared) || Number(declared) > 4096)) return { status: 'unknown' };
        let responseBytes = Buffer.alloc(0);
        if (response.body) {
          const reader = response.body.getReader(); let size = 0; const chunks = [];
          try {
            while (true) {
              const part = await Promise.race([reader.read(), aborted]); if (part.done) break;
              if (!(part.value instanceof Uint8Array) || (size += part.value.byteLength) > 4096) return { status: 'unknown' };
              chunks.push(Buffer.from(part.value));
            }
            if (declared !== null && declared !== undefined && size !== Number(declared)) return { status: 'unknown' };
            responseBytes = Buffer.concat(chunks, size);
          } finally { try { reader.cancel().catch(() => {}); } catch { /* Safe fixed outcome. */ } reader.releaseLock(); }
        }
        if (response.status === 200) {
          const mime = response.headers.get('content-type') ?? '';
          return /^text\/plain(?:\s*;|$)/iu.test(mime) && /^OK\s*$/u.test(responseBytes.toString('utf8')) ? { status: 'provider_accepted' } : { status: 'unknown' };
        }
        // A complete explicit 4xx refusal is known; server and transport errors
        // remain unknown because the external request may already have acted.
        return response.status >= 400 && response.status <= 499 ? { status: 'rejected', reason: 'PROVIDER_REJECTED' } : { status: 'unknown' };
      } catch { return { status: 'unknown' }; }
      finally { clearTimeout(timer); controller.abort(); try { if (response?.body && !response.body.locked) response.body.cancel().catch(() => {}); } catch { /* No raw provider errors. */ } }
    },
  });
}
