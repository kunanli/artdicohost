import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { encodeSigningBundle,decodeSigningBundle,loadEncryptedSigningBundle,walletSigningObjectKey } from '../functions/apple-wallet/bundle.mjs';
import { encodeConfirmationMailBundle,decodeConfirmationMailBundle,confirmationMailObjectKey } from '../functions/registration-confirmation/config-bundle.mjs';
import { MAX_DELIVERY_BUNDLE_BYTES } from '../functions/delivery-config/bundle.mjs';

const secret='SYNTHETIC_CONFIGURATION_MASTER_SECRET_12345678901234567890', eventId='synthetic-delivery-2026';
const wallet={APPLE_WALLET_TEAM_ID:'SYNTHETIC1',APPLE_WALLET_PASS_TYPE_ID:'pass.example.invalid.synthetic',APPLE_WALLET_ORGANIZATION_NAME:'合成组织',
  APPLE_WALLET_CERT_BASE64:'U1lOVEhFVElDLUNFUlQ=',APPLE_WALLET_KEY_BASE64:'U1lOVEhFVElDLVBSSVZBVEUtS0VZ',APPLE_WALLET_WWDR_CERT_BASE64:'U1lOVEhFVElDLVdXRFI=',APPLE_WALLET_ROOT_CERT_BASE64:'U1lOVEhFVElDLVJPT1Q='};
const mail={EMAILJS_SERVICE_ID:'synthetic_service',EMAILJS_CONFIRMATION_TEMPLATE_ID:'synthetic_confirmation',EMAILJS_PUBLIC_KEY:'SYNTHETIC_PUBLIC',
  EMAILJS_PRIVATE_KEY:'SYNTHETIC_PRIVATE_PROVIDER_KEY',EMAIL_FROM_ADDRESS:'synthetic@artdico.co',EMAIL_FROM_NAME:'合成团队'};
const digest=data=>createHash('sha256').update(data).digest('hex');
const reject=callback=>assert.throws(callback,error=>error.message==='Delivery configuration was not verified.'&&!error.cause&&!error.stack.includes(mail.EMAILJS_PRIVATE_KEY));

test('Wallet and confirmation provider configuration round-trip only as randomized authenticated ciphertext',()=>{
  for(const[config,encode,decode,keyFor]of[[wallet,encodeSigningBundle,decodeSigningBundle,walletSigningObjectKey],[mail,encodeConfirmationMailBundle,decodeConfirmationMailBundle,confirmationMailObjectKey]]){
    const first=encode({config,secret,eventId}),second=encode({config,secret,eventId});
    assert.notEqual(first.bundleId,second.bundleId);assert.equal(first.bundleId,digest(first.data));
    assert.deepEqual(decode({...first,secret,eventId}),config);
    const text=first.data.toString('utf8');for(const value of Object.values(config))assert.equal(text.includes(value),false);
    assert.match(keyFor({eventId,bundleId:first.bundleId}),/^cms\/v1\/(?:wallet-signing|confirmation-mail)\/synthetic-delivery-2026\/[a-f0-9]{64}\.json$/u);
    assert.ok(Buffer.byteLength(JSON.stringify({ARTDICO_CLOUD_CONTENT_ENABLED:'false',APPLE_WALLET_BUNDLE_ID:first.bundleId}))<4096);
  }
});

test('bundle identity, type, event, ciphertext and key are all bound before private configuration can be read',()=>{
  const encoded=encodeSigningBundle({config:wallet,secret,eventId});
  for(const patch of[{bundleId:'a'.repeat(64)},{eventId:'another-event'},{secret:'DIFFERENT_SYNTHETIC_SECRET_12345678901234567890'},{data:Buffer.alloc(MAX_DELIVERY_BUNDLE_BYTES+1)}])reject(()=>decodeSigningBundle({...encoded,secret,eventId,...patch}));
  reject(()=>decodeConfirmationMailBundle({...encoded,secret,eventId}));
  const value=JSON.parse(encoded.data),bytes=Buffer.from(value.ciphertext,'base64');bytes[0]^=1;value.ciphertext=bytes.toString('base64');
  const changed=Buffer.from(JSON.stringify(value)+'\n');reject(()=>decodeSigningBundle({data:changed,bundleId:digest(changed),secret,eventId}));
});

test('secret config cannot carry enable flags, endpoints, getters, hidden fields or oversized input',()=>{
  for(const config of[{...wallet,APPLE_WALLET_ENABLED:'true'},{...mail,endpoint:'https://foreign.example.invalid'},{...mail,EMAIL_FROM_NAME:'x'.repeat(33000)}])reject(()=>encodeConfirmationMailBundle({config,secret,eventId}));
  const hidden={...mail};Object.defineProperty(hidden,'EMAILJS_PRIVATE_KEY',{value:mail.EMAILJS_PRIVATE_KEY,enumerable:false});reject(()=>encodeConfirmationMailBundle({config:hidden,secret,eventId}));
  let calls=0;const getters={...mail};Object.defineProperty(getters,'EMAILJS_PRIVATE_KEY',{get(){calls++;return mail.EMAILJS_PRIVATE_KEY;},enumerable:true});
  reject(()=>encodeConfirmationMailBundle({config:getters,secret,eventId}));assert.equal(calls,0);
  for(const value of['../foreign','synthetic/other','',null])reject(()=>walletSigningObjectKey({eventId:value,bundleId:'a'.repeat(64)}));
});

test('runtime bundle loading uses one fixed hash path and fresh bounded normal-object reads',async()=>{
  const encoded=encodeSigningBundle({config:wallet,secret,eventId}),calls=[];
  const object={objectType:'Normal',contentType:'application/json',data:encoded.data};
  const objects={async get(key,options){calls.push({key,options});return object;}};
  assert.deepEqual(await loadEncryptedSigningBundle({objects,secret,eventId,bundleId:encoded.bundleId}),wallet);
  assert.deepEqual(await loadEncryptedSigningBundle({objects,secret,eventId,bundleId:encoded.bundleId}),wallet);
  assert.equal(calls.length,2);assert.equal(calls[0].key,walletSigningObjectKey({eventId,bundleId:encoded.bundleId}));assert.equal(calls[0].options.maxBytes,MAX_DELIVERY_BUNDLE_BYTES);
  for(const broken of[null,{...object,objectType:'Appendable'},{...object,contentType:'text/html'},{...object,data:Buffer.from('corrupt')}]){
    await assert.rejects(loadEncryptedSigningBundle({objects:{get:async()=>broken},secret,eventId,bundleId:encoded.bundleId}),/Delivery configuration was not verified\./u);
  }
});
