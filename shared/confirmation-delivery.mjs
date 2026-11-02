/** Safe public vocabulary only. Provider responses and configuration values must
 * never enter a staff response or a durable diagnostic. */
export const CONFIRMATION_EMAIL_CONFIGURATION_FIELDS = Object.freeze(['EMAILJS_SERVICE_ID','EMAILJS_CONFIRMATION_TEMPLATE_ID','EMAILJS_PUBLIC_KEY','EMAILJS_PRIVATE_KEY','EMAIL_FROM_ADDRESS','EMAIL_FROM_NAME']);
export const CONFIRMATION_EMAIL_REASONS = Object.freeze(['CONFIGURED_PROVIDER_NOT_DELIVERY_PROOF','EMAIL_NOT_READY','EMAIL_DISABLED','EMAIL_CONFIGURATION_MISSING','EMAIL_CONFIGURATION_INVALID','EMAIL_CONFIGURATION_UNAVAILABLE']);
const NOT_STARTED = new Set(['EMAIL_DISABLED','EMAIL_CONFIGURATION_MISSING','EMAIL_CONFIGURATION_INVALID','EMAIL_CONFIGURATION_UNAVAILABLE','INVALID_EMAIL_INPUT','DELIVERY_GUARD_BLOCKED','DELIVERY_GUARD_UNAVAILABLE','DELIVERY_WINDOW_EXPIRED','EMAIL_CONFIGURATION_CHANGED']);
const own = (value,key) => {const d=Object.getOwnPropertyDescriptor(value,key);return d?.enumerable&&Object.hasOwn(d,'value')?d.value:undefined;};
export function validConfirmationDiagnostic(value) {
  if(value===null||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
  const keys=Reflect.ownKeys(value);if(keys.length<2||keys.length>3||keys.some(key=>!['code','transportStarted','httpStatus'].includes(key))||!keys.includes('code')||!keys.includes('transportStarted'))return false;
  const code=own(value,'code'),started=own(value,'transportStarted'),status=own(value,'httpStatus');
  if(NOT_STARTED.has(code))return started===false&&!keys.includes('httpStatus');
  if(code==='PROVIDER_REJECTED')return started===true&&keys.includes('httpStatus')&&Number.isInteger(status)&&status>=400&&status<=499;
  return code==='DELIVERY_UNKNOWN'&&started===true&&(!keys.includes('httpStatus')||Number.isInteger(status)&&status>=100&&status<=599);
}
export function confirmationDiagnostic(value) {
  return validConfirmationDiagnostic(value)?{code:own(value,'code'),transportStarted:own(value,'transportStarted'),...(Object.hasOwn(value,'httpStatus')?{httpStatus:own(value,'httpStatus')}:{})}:null;
}
