import { deliveryConfigurationObjectKey, encodeDeliveryConfiguration, decodeDeliveryConfiguration, loadDeliveryConfiguration } from '../delivery-config/bundle.mjs';

const KIND='confirmation-mail';
export const confirmationMailObjectKey=input=>deliveryConfigurationObjectKey({...input,kind:KIND});
export const encodeConfirmationMailBundle=input=>encodeDeliveryConfiguration({...input,kind:KIND});
export const decodeConfirmationMailBundle=input=>decodeDeliveryConfiguration({...input,kind:KIND});
export const loadEncryptedConfirmationMail=input=>loadDeliveryConfiguration({...input,kind:KIND});
