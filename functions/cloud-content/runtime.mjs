import { createOssObjectClient } from './oss-client.mjs';
import { createObjectJournal } from './object-journal.mjs';
import { createCloudAuth } from './auth.mjs';
import { createOssContentStore } from './store.mjs';
import { createOssPortraitStore } from './portrait-store.mjs';
import { createOssContactsStore } from './contacts-store.mjs';
import { createCloudContentApi, CLOUD_API_ORIGIN, PUBLIC_SITE_ORIGIN } from './handler.mjs';

const credentialFields = ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIBABA_CLOUD_SECURITY_TOKEN'];

/** Construct only from server-side configuration and FC's platform role environment.
 * No deployment key aliases, request headers, implicit account or public write defaults.
 * `configured` describes configuration, never successful cloud persistence.
 */
export function createCloudContentRuntime({ env = process.env, fetchFn, now = () => Date.now(), clock = () => new Date(now()) } = {}) {
  const unavailable = () => ({ handle: createCloudContentApi({ enabled: false }), configured: false, storageVerified: false, registrationEnabled: false });
  if (env.ARTDICO_CLOUD_CONTENT_ENABLED !== 'true') return unavailable();
  if (env.NODE_ENV !== 'production' || env.ARTDICO_CONTENT_API_ORIGIN !== CLOUD_API_ORIGIN
    || env.ARTDICO_PUBLIC_SITE_ORIGIN !== PUBLIC_SITE_ORIGIN || env.ARTDICO_CONTENT_BUCKET !== 'artdicohost-data-hk'
    || env.ARTDICO_CONTENT_REGION !== 'cn-hongkong' || typeof env.ADMIN_USERS_JSON !== 'string'
    || !credentialFields.every(key => typeof env[key] === 'string' && env[key].length > 0)) return unavailable();
  try {
    const objects = createOssObjectClient({ credentials: async () => ({
      accessKeyId: env.ALIBABA_CLOUD_ACCESS_KEY_ID,
      accessKeySecret: env.ALIBABA_CLOUD_ACCESS_KEY_SECRET,
      securityToken: env.ALIBABA_CLOUD_SECURITY_TOKEN,
    }), fetchFn, clock });
    const portraitStore = createOssPortraitStore({ objects });
    const journalFor = prefix => createObjectJournal({ objects, prefix });
    const store = createOssContentStore({ journal: journalFor('cms/v1/content'), portraitStore, now });
    const contactsStore = createOssContactsStore({ journal: journalFor('cms/v1/contacts'), contentStore: store, now });
    const auth = createCloudAuth({ users: env.ADMIN_USERS_JSON, journalFor, now });
    return { handle: createCloudContentApi({ enabled: true, store, portraitStore, auth, contactsStore }), configured: true, storageVerified: false, registrationEnabled: false };
  } catch { return unavailable(); }
}
