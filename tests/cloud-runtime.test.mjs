import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword } from '../functions/content-api/auth.mjs';
import { createCloudContentRuntime } from '../functions/cloud-content/runtime.mjs';

const user = { id: 'synthetic', username: 'synthetic', email: 'synthetic@artdico.co', label: '合成账号', roles: ['editor'], passwordHash: await hashPassword('synthetic-password-only') };
const config = { NODE_ENV: 'production', ARTDICO_CLOUD_CONTENT_ENABLED: 'true', ARTDICO_CONTENT_API_ORIGIN: 'https://api.artdico.host', ARTDICO_PUBLIC_SITE_ORIGIN: 'https://artdico.host', ARTDICO_CONTENT_BUCKET: 'artdicohost-data-hk', ARTDICO_CONTENT_REGION: 'cn-hongkong', ADMIN_USERS_JSON: JSON.stringify([user]), ALIBABA_CLOUD_ACCESS_KEY_ID: 'synthetic-role-id', ALIBABA_CLOUD_ACCESS_KEY_SECRET: 'synthetic-role-secret', ALIBABA_CLOUD_SECURITY_TOKEN: 'synthetic-temporary-token' };
const request = () => new Request('https://api.artdico.host/api/admin/session');

test('cloud runtime needs explicit production config and all platform role fields, with no deployment-key fallback', async () => {
  let requests = 0;
  const fetchFn = async () => { requests++; throw new Error('SYNTHETIC_PRIVATE'); };
  for (const field of Object.keys(config)) {
    const env = { ...config }; delete env[field];
    const runtime = createCloudContentRuntime({ env, fetchFn });
    assert.equal(runtime.configured, false, field);
    assert.equal((await runtime.handle(request())).status, 503);
  }
  for (const delta of [{ ARTDICO_CLOUD_CONTENT_ENABLED: 'TRUE' }, { NODE_ENV: 'development' }, { ARTDICO_CONTENT_API_ORIGIN: 'https://untrusted.invalid' }, { ARTDICO_CONTENT_BUCKET: 'igda-data-hk' }, { ARTDICO_CONTENT_REGION: 'cn-shenzhen' }, { ADMIN_USERS_JSON: '{' }]) {
    assert.equal(createCloudContentRuntime({ env: { ...config, ...delta }, fetchFn }).configured, false);
  }
  const deploymentOnly = { ...config, FC_ACCESS_KEY_ID: 'synthetic-deploy', FC_ACCESS_KEY_SECRET: 'synthetic-deploy-secret' };
  delete deploymentOnly.ALIBABA_CLOUD_ACCESS_KEY_ID; delete deploymentOnly.ALIBABA_CLOUD_ACCESS_KEY_SECRET; delete deploymentOnly.ALIBABA_CLOUD_SECURITY_TOKEN;
  assert.equal(createCloudContentRuntime({ env: deploymentOnly, fetchFn }).configured, false);
  assert.equal(requests, 0);
});

test('valid configuration is never described as verified persistence or registration readiness', async () => {
  let calls = 0;
  const runtime = createCloudContentRuntime({ env: config, fetchFn: async () => { calls++; throw new Error('SYNTHETIC_PRIVATE'); } });
  assert.equal(runtime.configured, true);
  assert.equal(runtime.storageVerified, false);
  assert.equal(runtime.registrationEnabled, false);
  assert.equal(calls, 0);
  const status = await runtime.handle(new Request('https://api.artdico.host/api/admin/environment'));
  assert.deepEqual(await status.json(), { mode: 'cloud', scope: 'content-and-outreach', registration: 'closed' });
  assert.equal(runtime.storageVerified, false);
  assert.equal(runtime.registrationEnabled, false);
  assert.equal((await runtime.handle(new Request('https://api.artdico.host/api/registrations', { method: 'POST', headers: { Origin: 'https://api.artdico.host' } }))).status, 503);
  assert.equal(calls, 0);
});
