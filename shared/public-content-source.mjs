/** Public read configuration only. No staff cookies, write or registration paths. */
export const PUBLIC_CONTENT_API_ORIGIN = 'https://api.artdico.host';
export const PUBLIC_WEBSITE_ORIGIN = 'https://artdico.host';
const PATH = '/api/public/content';

export function publicContentEndpoint(configuredOrigin) {
  if (configuredOrigin === undefined || configuredOrigin === '') return '';
  if (configuredOrigin !== PUBLIC_CONTENT_API_ORIGIN) throw new TypeError('公开内容 API 必须使用指定 HTTPS 来源。');
  return PUBLIC_CONTENT_API_ORIGIN + PATH;
}

export function resolvePublicContentSource(endpoint, pageOrigin) {
  if (typeof endpoint !== 'string' || typeof pageOrigin !== 'string') return null;
  let page;
  try { page = new URL(pageOrigin); } catch { return null; }
  if (!['http:', 'https:'].includes(page.protocol) || page.origin !== pageOrigin) return null;
  if (endpoint === PATH) return new URL(PATH, page.origin);
  if (page.origin === PUBLIC_WEBSITE_ORIGIN && endpoint === PUBLIC_CONTENT_API_ORIGIN + PATH) return new URL(endpoint);
  return null;
}
