import { MAX_DELIVERY_BUNDLE_BYTES, deliveryConfigurationObjectKey, encodeDeliveryConfiguration, decodeDeliveryConfiguration, loadDeliveryConfiguration } from '../delivery-config/bundle.mjs';

const KIND='wallet-signing';
export const MAX_WALLET_BUNDLE_BYTES=MAX_DELIVERY_BUNDLE_BYTES;
export const walletSigningObjectKey=input=>deliveryConfigurationObjectKey({...input,kind:KIND});
export const encodeSigningBundle=input=>encodeDeliveryConfiguration({...input,kind:KIND});
export const decodeSigningBundle=input=>decodeDeliveryConfiguration({...input,kind:KIND});
export const loadEncryptedSigningBundle=input=>loadDeliveryConfiguration({...input,kind:KIND});
