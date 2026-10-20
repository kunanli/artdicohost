import test from 'node:test';
import assert from 'node:assert/strict';
import { publicContentEndpoint, resolvePublicContentSource } from '../shared/public-content-source.mjs';

test('public content configuration is closed by default and accepts only the fixed read origin', () => {
  assert.equal(publicContentEndpoint(undefined), ''); assert.equal(publicContentEndpoint(''), '');
  assert.equal(publicContentEndpoint('https://api.artdico.host'), 'https://api.artdico.host/api/public/content');
  for (const input of [null, true, 'https://api.artdico.host/', 'http://api.artdico.host', 'https://untrusted.invalid', 'https://api.artdico.host/api/admin/content']) assert.throws(() => publicContentEndpoint(input), TypeError);
});

test('browser content reads preserve exact same-origin local paths and permit only the production public pairing', () => {
  assert.equal(resolvePublicContentSource('/api/public/content', 'http://127.0.0.1:8787')?.href, 'http://127.0.0.1:8787/api/public/content');
  assert.equal(resolvePublicContentSource('/api/public/content', 'https://artdico.host')?.href, 'https://artdico.host/api/public/content');
  assert.equal(resolvePublicContentSource('https://api.artdico.host/api/public/content', 'https://artdico.host')?.href, 'https://api.artdico.host/api/public/content');
  for (const endpoint of ['//untrusted.invalid/api/public/content', 'https://api.artdico.host/api/admin/content', 'https://api.artdico.host/api/registrations', 'https://api.artdico.host/api/public/content?x=1', 'https://api.artdico.host/api/public/content#x', 'https://api.artdico.host:443/api/public/content', 'https://api.artdico.host/./api/public/content', 'https://untrusted.invalid/api/public/content', 'javascript:alert(1)', {}, null]) assert.equal(resolvePublicContentSource(endpoint, 'https://artdico.host'), null);
  for (const origin of ['https://untrusted.invalid', 'http://artdico.host', 'file:', 'https://artdico.host/', 'https://staff@artdico.host']) assert.equal(resolvePublicContentSource('https://api.artdico.host/api/public/content', origin), null);
});
