import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { APPLE_ROOT_FINGERPRINTS, buildAppleWalletPass, validateSigningIdentity, WalletSigningError } from './pkpass.mjs';

export const WALLET_CONFIG_FIELDS = Object.freeze(['APPLE_WALLET_TEAM_ID', 'APPLE_WALLET_PASS_TYPE_ID', 'APPLE_WALLET_ORGANIZATION_NAME',
  'APPLE_WALLET_CERT_BASE64', 'APPLE_WALLET_KEY_BASE64', 'APPLE_WALLET_WWDR_CERT_BASE64', 'APPLE_WALLET_ROOT_CERT_BASE64']);
const API = 'https://api.artdico.host';
const ID = /^[A-Za-z0-9_-]{43}$/u;
const TOKEN = /^[A-Za-z0-9_-]{20,2048}\.[A-Za-z0-9_-]{43}$/u;
const RECEIPT = /^[A-Za-z0-9_.-]{32,4096}$/u;
const own = (object, key) => { const property = object && Object.getOwnPropertyDescriptor(object, key); return property && Object.hasOwn(property, 'value') ? property.value : undefined; };
const line = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed() && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value);
const fixed = outcome => ({ outcome });
const configFailure = code => { throw new WalletSigningError(code); };
function decode(value) {
  if (typeof value !== 'string' || value.length < 128 || value.length > 32768 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) configFailure('WALLET_CERTIFICATE_INVALID');
  const data = Buffer.from(value, 'base64'); if (data.toString('base64') !== value) configFailure('WALLET_CERTIFICATE_INVALID'); return data;
}
function validRecord(value) {
  return value && typeof value === 'object' && ID.test(value.registrationId ?? '') && value.referenceCode === value.registrationId
    && ['confirmed', 'waitlisted', 'withdrawn'].includes(value.admissionStatus) && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value.event?.id ?? '');
}

/** No credentials or personal data are returned by readiness. All callback dependencies are server supplied. */
export function createAppleWalletService({ env = {}, loadSigningBundle, authorize, authorizedRegistration, tokenSecret, clock = () => Date.now(),
  trustedRootFingerprints = APPLE_ROOT_FINGERPRINTS } = {}) {
  if (typeof authorize !== 'function' || typeof authorizedRegistration !== 'function' || typeof clock !== 'function'
    || typeof tokenSecret !== 'string' || Buffer.byteLength(tokenSecret) < 32 || Buffer.byteLength(tokenSecret) > 4096
    || loadSigningBundle !== undefined && typeof loadSigningBundle !== 'function') throw new TypeError('Trusted Wallet receipt and signing dependencies required.');
  const enabled = own(env, 'APPLE_WALLET_ENABLED') === 'true', bundleId = own(env, 'APPLE_WALLET_BUNDLE_ID');
  const direct = Object.fromEntries([...WALLET_CONFIG_FIELDS, 'APPLE_WALLET_KEY_PASSPHRASE'].map(name => [name, own(env, name)]));
  const tokenKey = Buffer.from(hkdfSync('sha256', Buffer.from(tokenSecret), Buffer.alloc(0), Buffer.from('artdico/apple-wallet-verification-v1'), 32));
  function current() { const value = clock(); if (!Number.isSafeInteger(value) || value < 0) throw new Error('Wallet time is unavailable.'); return value; }
  async function signing() {
    let config = direct;
    if (bundleId !== undefined && bundleId !== '') {
      if (!/^[a-f0-9]{64}$/u.test(bundleId) || typeof loadSigningBundle !== 'function') configFailure('WALLET_BUNDLE_UNAVAILABLE');
      try { config = await loadSigningBundle({ bundleId }); } catch { configFailure('WALLET_BUNDLE_UNAVAILABLE'); }
      if (!config || typeof config !== 'object' || Array.isArray(config)) configFailure('WALLET_BUNDLE_UNAVAILABLE');
    }
    const missing = WALLET_CONFIG_FIELDS.filter(name => !line(own(config, name), name.endsWith('_BASE64') ? 32768 : 200));
    if (missing.length) return { missing };
    const organizationName = own(config, 'APPLE_WALLET_ORGANIZATION_NAME');
    if (!line(organizationName, 80)) configFailure('WALLET_IDENTITY_INVALID');
    const identity = validateSigningIdentity({ certificate: decode(own(config, 'APPLE_WALLET_CERT_BASE64')),
      key: decode(own(config, 'APPLE_WALLET_KEY_BASE64')), wwdr: decode(own(config, 'APPLE_WALLET_WWDR_CERT_BASE64')),
      root: decode(own(config, 'APPLE_WALLET_ROOT_CERT_BASE64')), passphrase: own(config, 'APPLE_WALLET_KEY_PASSPHRASE') === '' ? undefined : own(config, 'APPLE_WALLET_KEY_PASSPHRASE'),
      teamId: own(config, 'APPLE_WALLET_TEAM_ID'), passTypeIdentifier: own(config, 'APPLE_WALLET_PASS_TYPE_ID'), now: current(), trustedRootFingerprints });
    return { identity, organizationName, missing: [] };
  }
  async function readiness() {
    try {
      const state = await signing();
      if (state.missing.length) return { ready: false, reason: 'WALLET_NOT_CONFIGURED', missing: [...state.missing], deviceTestRequired: true };
      return { ready: enabled, reason: enabled ? 'CONFIGURED_SIGNER_DEVICE_TEST_REQUIRED' : 'WALLET_DISABLED', missing: [],
        certificateExpiresAt: state.identity.expiresAt, deviceTestRequired: true };
    } catch (error) {
      const allowed = ['WALLET_BUNDLE_UNAVAILABLE', 'WALLET_CERTIFICATE_INVALID', 'WALLET_CERTIFICATE_EXPIRED', 'WALLET_CERTIFICATE_CHAIN_INVALID',
        'WALLET_CERTIFICATE_ID_MISMATCH', 'WALLET_CERTIFICATE_TYPE_INVALID', 'WALLET_IDENTITY_INVALID', 'WALLET_PRIVATE_KEY_INVALID'];
      return { ready: false, reason: allowed.includes(error?.code) ? error.code : 'WALLET_UNAVAILABLE', missing: [], deviceTestRequired: true };
    }
  }
  function verificationToken(record, now) {
    const expiry = Date.parse(record.event.date + 'T23:59:59+08:00');
    if (!Number.isSafeInteger(expiry) || expiry <= now || expiry - now > 180 * 86400000) throw new Error('Wallet event window is unavailable.');
    const claims = { v: 1, purpose: 'wallet-validity', eventId: record.event.id, registrationId: record.registrationId, issuedAt: now, expiresAt: expiry };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return payload + '.' + createHmac('sha256', tokenKey).update(payload).digest('base64url');
  }
  function verifyClaims(token, now) {
    if (typeof token !== 'string' || !TOKEN.test(token)) return null;
    const [payload, signature] = token.split('.');
    const actual = Buffer.from(signature, 'base64url'), expected = createHmac('sha256', tokenKey).update(payload).digest();
    if (actual.length !== expected.length || actual.toString('base64url') !== signature || !timingSafeEqual(actual, expected)) return null;
    let value;
    try {
      const data = Buffer.from(payload, 'base64url'); if (data.toString('base64url') !== payload) return null;
      value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data));
    } catch { return null; }
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6 || value.v !== 1 || value.purpose !== 'wallet-validity'
      || !ID.test(value.registrationId ?? '') || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value.eventId ?? '')
      || !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) || value.issuedAt > now || value.expiresAt <= now
      || value.expiresAt - value.issuedAt > 180 * 86400000 || value.expiresAt <= value.issuedAt) return null;
    return value;
  }
  return Object.freeze({
    readiness,
    async download({ receiptToken } = {}) {
      if (typeof receiptToken !== 'string' || !RECEIPT.test(receiptToken)) return fixed('invalid');
      try {
        const attendee = await authorize({ receiptToken });
        if (!validRecord(attendee)) return fixed('invalid');
        if (attendee.admissionStatus !== 'confirmed') return fixed('inactive');
        if (!enabled) return fixed('not_ready');
        const config = await signing(); if (config.missing.length) return fixed('not_ready');
        const now = current(), token = verificationToken(attendee, now), verificationUrl = API + '/api/admin/registration/wallet/verify/' + token;
        const data = buildAppleWalletPass({ ...config, attendee, verificationUrl, now });
        const latest = await authorizedRegistration(attendee.registrationId);
        if (!validRecord(latest) || latest.registrationId !== attendee.registrationId || latest.event.id !== attendee.event.id
          || latest.admissionStatus !== 'confirmed') return fixed('inactive');
        if (Date.parse(config.identity.expiresAt) <= current()) return fixed('not_ready');
        return { outcome: 'issued', data, contentType: 'application/vnd.apple.pkpass', filename: 'artdico-' + attendee.registrationId.slice(-12) + '.pkpass' };
      } catch (error) { return fixed(error instanceof WalletSigningError ? 'not_ready' : 'unavailable'); }
    },
    async verify({ token } = {}) {
      try {
        const now = current(), claims = verifyClaims(token, now);
        if (!claims) return { valid: false };
        const record = await authorizedRegistration(claims.registrationId);
        if (!validRecord(record) || record.event.id !== claims.eventId || record.registrationId !== claims.registrationId || record.admissionStatus !== 'confirmed') return { valid: false };
        if (!verifyClaims(token, current())) return { valid: false };
        return { valid: true, eventId: claims.eventId, admissionStatus: 'confirmed', verifiedAt: new Date(now).toISOString() };
      } catch { return { valid: false }; }
    },
  });
}
