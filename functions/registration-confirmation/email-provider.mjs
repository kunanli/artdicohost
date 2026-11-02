import { createHmac, hkdfSync } from 'node:crypto';
import { createInvitationEmailProvider, invitationEmailConfigurationIssues } from '../intent-invitations/email-provider.mjs';
import { CONFIRMATION_EMAIL_CONFIGURATION_FIELDS, confirmationDiagnostic } from '../../shared/confirmation-delivery.mjs';

const FIELDS = CONFIRMATION_EMAIL_CONFIGURATION_FIELDS;
const own = (value, key) => { const field = Object.getOwnPropertyDescriptor(value, key); return field && Object.hasOwn(field, 'value') ? field.value : undefined; };
const fieldName = key => key==='EMAILJS_TEMPLATE_ID'?'EMAILJS_CONFIRMATION_TEMPLATE_ID':key;
const noStart = (code,reason='EMAIL_NOT_READY') => ({status:'rejected',reason,diagnostic:confirmationDiagnostic({code,transportStarted:false})});
const unknown = () => ({status:'unknown',diagnostic:confirmationDiagnostic({code:'DELIVERY_UNKNOWN',transportStarted:true})});
function identity(config,issues) {
  if(issues.missing.length||issues.invalid.length)return null;
  const key=Buffer.from(hkdfSync('sha256',Buffer.from(config.EMAILJS_PRIVATE_KEY),Buffer.from('ARTDiCO confirmation configuration identity v1'),Buffer.from('confirmation-provider-identity'),32));
  try{return createHmac('sha256',key).update('artdico-confirmation-provider-v1\0').update(JSON.stringify(FIELDS.map(name=>[name,config[name]]))).digest('hex');}
  finally{key.fill(0);}
}

/** Reuses the audited fixed EmailJS transport with a separate confirmation template. */
export function createConfirmationEmailProvider({ env = {}, fetchFn = globalThis.fetch, timeoutMs = 10_000, loadConfiguration } = {}) {
  if (loadConfiguration !== undefined && typeof loadConfiguration !== 'function') throw new TypeError('Trusted confirmation configuration loader required.');
  if(typeof fetchFn!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10_000)throw new TypeError('Trusted confirmation transport required.');
  const direct = Object.fromEntries(FIELDS.map(key => [key, own(env, key)]));
  const enabled = own(env, 'ARTDICO_CONFIRMATION_EMAIL_ENABLED') === 'true';
  async function current(transportFetch = fetchFn,{loadDisabled=false}={}) {
    // Disabled setup does not fetch any bundle or contact a provider.
    const loaded = (enabled||loadDisabled) && loadConfiguration ? await loadConfiguration() : direct;
    const config = Object.fromEntries(FIELDS.map(key => [key, loaded && typeof loaded === 'object' ? own(loaded, key) : undefined]));
    const transportConfig={ ...config,
      EMAILJS_TEMPLATE_ID: config.EMAILJS_CONFIRMATION_TEMPLATE_ID,
      ARTDICO_INVITATION_EMAIL_ENABLED: enabled ? 'true' : 'false' };
    const issues=invitationEmailConfigurationIssues(transportConfig);
    const transport = createInvitationEmailProvider({env:transportConfig,fetchFn:transportFetch,timeoutMs});
    return { transport, issues, configurationIdentity:identity(config,issues) };
  }
  const readiness = async () => {
    try {
      const { transport,issues } = await current();
      const ready=transport.readiness().ready;
      return { ready,
        reason:!enabled?'EMAIL_DISABLED':issues.missing.length?'EMAIL_CONFIGURATION_MISSING':issues.invalid.length?'EMAIL_CONFIGURATION_INVALID':'CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF',
        enabled,missing:issues.missing.map(fieldName),invalid:issues.invalid.map(fieldName),
        template: 'confirmation', deliveryProof: false };
    } catch { return { ready: false, enabled, reason: 'EMAIL_CONFIGURATION_UNAVAILABLE', missing: [],invalid:[], template: 'confirmation', deliveryProof: false }; }
  };
  return Object.freeze({ readiness,
    async configurationIdentity(){try{return(await current(fetchFn,{loadDisabled:true})).configurationIdentity;}catch{return null;}},
    async send(input) {
      if(!enabled)return noStart('EMAIL_DISABLED');
      const controller=new AbortController(),expired=Symbol('deadline');
      let timer,finished=false,transportStarted=false,blockedCode=null;
      const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(expired);},timeoutMs);timer.unref?.();});
      const guardFailure=code=>{blockedCode=code;throw new Error('Confirmation transport did not start.');};
      try {
        const guardedFetch = async (...args) => {
          const signal=AbortSignal.any([controller.signal,...(args[1]?.signal?[args[1].signal]:[])]);
          if(finished||signal.aborted)guardFailure('DELIVERY_WINDOW_EXPIRED');
          let permitted=true;
          try{if(typeof input?.canStart==='function')permitted=await input.canStart({signal});}
          catch{guardFailure(signal.aborted||finished?'DELIVERY_WINDOW_EXPIRED':'DELIVERY_GUARD_UNAVAILABLE');}
          if(finished||signal.aborted)guardFailure('DELIVERY_WINDOW_EXPIRED');
          if(permitted!==true)guardFailure('DELIVERY_GUARD_BLOCKED');
          transportStarted=true;
          return fetchFn(args[0],{...args[1],signal});
        };
        const work=(async()=>{
          const {transport,issues,configurationIdentity}=await current(guardedFetch);
          if(finished||controller.signal.aborted)return noStart('DELIVERY_WINDOW_EXPIRED','DELIVERY_WINDOW_EXPIRED');
          if(issues.missing.length||issues.invalid.length)return noStart(issues.missing.length?'EMAIL_CONFIGURATION_MISSING':'EMAIL_CONFIGURATION_INVALID');
          if(input?.expectedConfigurationIdentity!==undefined&&input.expectedConfigurationIdentity!==configurationIdentity)return noStart('EMAIL_CONFIGURATION_CHANGED');
          return transport.send(input);
        })();
        const result=await Promise.race([work,deadline]);
        if(result===expired||controller.signal.aborted)return transportStarted?unknown():noStart('DELIVERY_WINDOW_EXPIRED','DELIVERY_WINDOW_EXPIRED');
        if(blockedCode)return transportStarted?unknown():noStart(blockedCode,'DELIVERY_WINDOW_EXPIRED');
        return result;
      } catch { return transportStarted?unknown():noStart('EMAIL_CONFIGURATION_UNAVAILABLE'); }
      finally{finished=true;clearTimeout(timer);controller.abort();}
    },
  });
}
