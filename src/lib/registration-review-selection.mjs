import { eventConfig } from '../config/event.mjs';

/** Registration IDs are 43-character base64url, including a leading '-' or '_'. */
export function reviewRegistrationSelection(hash) {
  if(typeof hash!=='string'||hash.length>256||!hash.startsWith('#registration='))return null;
  try{const id=decodeURIComponent(hash.slice(14));return /^[A-Za-z0-9_-]{43}$/u.test(id)?id:null;}catch{return null;}
}

/** A private link is accepted only for the selected person and fixed attendee site. */
export function reviewConfirmationLink(value, registrationId, now = Date.now()) {
  if (!value || value.ready !== true || value.registrationId !== registrationId
    || !/^[A-Za-z0-9_-]{43}$/u.test(registrationId ?? '')
    || typeof value.receiptToken !== 'string' || !/^c1\.[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{43}$/u.test(value.receiptToken)
    || value.confirmationUrl !== 'https://artdico.host/registration/confirmation/#r=' + value.receiptToken
    || typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now) return null;
  try {
    const payload = value.receiptToken.split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/gu, '+').replace(/_/gu, '/')));
    if (claims.registrationId !== registrationId || claims.eventId !== eventConfig.id || claims.purpose !== 'artdico-registration-confirmation-v1'
      || claims.expiresAt !== Date.parse(value.expiresAt)) return null;
  } catch { return null; }
  return { confirmationUrl: value.confirmationUrl, expiresAt: value.expiresAt };
}
