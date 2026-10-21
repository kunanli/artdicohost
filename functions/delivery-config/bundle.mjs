import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes as secureRandomBytes } from 'node:crypto';

export const MAX_DELIVERY_BUNDLE_BYTES = 64 * 1024;
const MAX_CONFIG_BYTES = 32 * 1024;
const SPECS = Object.freeze({
  'wallet-signing': { required: ['APPLE_WALLET_TEAM_ID','APPLE_WALLET_PASS_TYPE_ID','APPLE_WALLET_ORGANIZATION_NAME','APPLE_WALLET_CERT_BASE64','APPLE_WALLET_KEY_BASE64','APPLE_WALLET_WWDR_CERT_BASE64','APPLE_WALLET_ROOT_CERT_BASE64'], optional: ['APPLE_WALLET_KEY_PASSPHRASE'] },
  'confirmation-mail': { required: ['EMAILJS_SERVICE_ID','EMAILJS_CONFIRMATION_TEMPLATE_ID','EMAILJS_PUBLIC_KEY','EMAILJS_PRIVATE_KEY','EMAIL_FROM_ADDRESS','EMAIL_FROM_NAME'], optional: [] },
});
const HASH = /^[a-f0-9]{64}$/u, EVENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const fail = () => { throw new Error('Delivery configuration was not verified.'); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function spec(kind) { if (!Object.hasOwn(SPECS,kind)) fail(); return SPECS[kind]; }
function configValue(input,kind) {
  const {required,optional}=spec(kind), names=[...required,...optional];
  if (!plain(input) || Reflect.ownKeys(input).length !== Object.keys(input).length
    || Reflect.ownKeys(input).some(key => typeof key !== 'string' || !names.includes(key)) || required.some(key => !Object.hasOwn(input,key))) fail();
  const result = {};
  for (const key of Object.keys(input).sort()) {
    const field = Object.getOwnPropertyDescriptor(input,key);
    if (!field || !Object.hasOwn(field,'value') || !field.enumerable || typeof field.value !== 'string' || !field.value.isWellFormed()
      || !field.value.length && !optional.includes(key) || Buffer.byteLength(field.value) > MAX_CONFIG_BYTES || /[\u0000-\u001f\u007f]/u.test(field.value)) fail();
    result[key] = field.value;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CONFIG_BYTES) fail();
  return result;
}
function encryptionKey(secret,eventId,kind) {
  spec(kind);
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/u.test(secret) || !EVENT.test(eventId ?? '')) fail();
  return Buffer.from(hkdfSync('sha256',Buffer.from(secret),Buffer.from('ARTDICO delivery configuration bundle v1'),Buffer.from(kind+'\0'+eventId),32));
}
const aad = (kind,eventId) => Buffer.from('artdico-delivery-config-v1\0'+kind+'\0'+eventId);
function canonicalBase64(value,length) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) fail();
  const bytes = Buffer.from(value,'base64');
  if (bytes.toString('base64') !== value || length !== undefined && bytes.length !== length) fail();
  return bytes;
}
export function deliveryConfigurationObjectKey({kind,eventId,bundleId}={}) {
  spec(kind);
  if (!EVENT.test(eventId ?? '') || typeof bundleId !== 'string' || !HASH.test(bundleId)) fail();
  return 'cms/v1/'+kind+'/'+eventId+'/'+bundleId+'.json';
}

/** Only an encrypted object hash is needed in FC's 4096-byte environment.
 * Provider configuration cannot override the trusted feature-enable flag. */
export function encodeDeliveryConfiguration({kind,config,secret,eventId,randomBytes=secureRandomBytes}={}) {
  let key,plaintext;
  try {
    const value=configValue(config,kind);key=encryptionKey(secret,eventId,kind);
    if(typeof randomBytes !== 'function')fail();
    const iv=randomBytes(12);if(!(iv instanceof Uint8Array)||iv.byteLength!==12)fail();
    plaintext=Buffer.from(JSON.stringify(value));
    const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad(kind,eventId));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
    const data=Buffer.from(JSON.stringify({schemaVersion:1,kind,eventId,iv:Buffer.from(iv).toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')})+'\n');
    if(data.length>MAX_DELIVERY_BUNDLE_BYTES)fail();
    return {bundleId:digest(data),data};
  } catch { fail(); } finally { key?.fill(0);plaintext?.fill(0); }
}

export function decodeDeliveryConfiguration({kind,data,secret,eventId,bundleId}={}) {
  let key,plaintext;
  try {
    deliveryConfigurationObjectKey({kind,eventId,bundleId});
    if(!(data instanceof Uint8Array)||!data.byteLength||data.byteLength>MAX_DELIVERY_BUNDLE_BYTES||digest(data)!==bundleId)fail();
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
    if(!plain(value)||Object.keys(value).sort().join(',')!=='ciphertext,eventId,iv,kind,schemaVersion,tag'||value.schemaVersion!==1||value.kind!==kind||value.eventId!==eventId)fail();
    const iv=canonicalBase64(value.iv,12),tag=canonicalBase64(value.tag,16),ciphertext=canonicalBase64(value.ciphertext);
    if(!ciphertext.length||ciphertext.length>MAX_CONFIG_BYTES)fail();
    key=encryptionKey(secret,eventId,kind);
    const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(aad(kind,eventId));decipher.setAuthTag(tag);
    plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    return configValue(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plaintext)),kind);
  } catch { fail(); } finally { key?.fill(0);plaintext?.fill(0); }
}

/** The logical key is derived from a trusted type, event and digest, never from
 * a request path. A fresh bounded read verifies both bytes and authentication. */
export async function loadDeliveryConfiguration({objects,kind,secret,eventId,bundleId}={}) {
  try {
    if(typeof objects?.get!=='function')fail();
    const key=deliveryConfigurationObjectKey({kind,eventId,bundleId}),object=await objects.get(key,{maxBytes:MAX_DELIVERY_BUNDLE_BYTES});
    if(object?.objectType!=='Normal'||!['application/json','application/octet-stream'].includes(object.contentType))fail();
    return decodeDeliveryConfiguration({kind,data:object.data,secret,eventId,bundleId});
  } catch { fail(); }
}
