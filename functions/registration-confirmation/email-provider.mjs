import { createInvitationEmailProvider } from '../intent-invitations/email-provider.mjs';

const FIELDS = ['EMAILJS_SERVICE_ID', 'EMAILJS_CONFIRMATION_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY', 'EMAIL_FROM_ADDRESS', 'EMAIL_FROM_NAME'];
const own = (value, key) => { const field = Object.getOwnPropertyDescriptor(value, key); return field && Object.hasOwn(field, 'value') ? field.value : undefined; };

/** Reuses the audited fixed EmailJS transport with a separate confirmation template. */
export function createConfirmationEmailProvider({ env = {}, fetchFn = globalThis.fetch, timeoutMs = 10_000, loadConfiguration } = {}) {
  if (loadConfiguration !== undefined && typeof loadConfiguration !== 'function') throw new TypeError('Trusted confirmation configuration loader required.');
  const direct = Object.fromEntries(FIELDS.map(key => [key, own(env, key)]));
  const enabled = own(env, 'ARTDICO_CONFIRMATION_EMAIL_ENABLED') === 'true';
  async function current(transportFetch = fetchFn) {
    // Disabled setup does not fetch any bundle or contact a provider.
    const loaded = enabled && loadConfiguration ? await loadConfiguration() : direct;
    const config = Object.fromEntries(FIELDS.map(key => [key, loaded && typeof loaded === 'object' ? own(loaded, key) : undefined]));
    const transport = createInvitationEmailProvider({ env: { ...config,
      EMAILJS_TEMPLATE_ID: config.EMAILJS_CONFIRMATION_TEMPLATE_ID,
      ARTDICO_INVITATION_EMAIL_ENABLED: enabled ? 'true' : 'false' }, fetchFn: transportFetch, timeoutMs });
    return { config, transport };
  }
  const readiness = async () => {
    try {
      const { config, transport } = await current();
      return { ready: transport.readiness().ready,
        reason: transport.readiness().ready ? 'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF' : 'EMAIL_NOT_READY',
        enabled, missing: FIELDS.filter(key => typeof config[key] !== 'string' || !config[key].trim()),
        template: 'confirmation', deliveryProof: false };
    } catch { return { ready: false, enabled, reason: 'EMAIL_CONFIGURATION_UNAVAILABLE', missing: [], template: 'confirmation', deliveryProof: false }; }
  };
  return Object.freeze({ readiness,
    async send(input) {
      let blocked = false;
      try {
        const guardedFetch = (...args) => {
          if (typeof input?.canStart === 'function' && input.canStart() !== true) {
            blocked = true; throw new Error('Confirmation delivery window expired.');
          }
          return fetchFn(...args);
        };
        const result = await (await current(guardedFetch)).transport.send(input);
        return blocked ? { status: 'rejected', reason: 'DELIVERY_WINDOW_EXPIRED' } : result;
      } catch { return { status: 'rejected', reason: 'EMAIL_NOT_READY' }; }
    },
  });
}
