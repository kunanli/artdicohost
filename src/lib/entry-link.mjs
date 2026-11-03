/** Short link is a private capability: no persistence, referrer, third-party URLs or writes. */
export async function resolveEntryLink({ code, apiOrigin, fetch: fetcher = globalThis.fetch }) {
  if (!/^[A-Za-z0-9_-]{22}$/u.test(code ?? '') || apiOrigin !== 'https://api.artdico.host') throw new Error('LINK_INVALID');
  const response = await fetcher(apiOrigin + '/api/admin/registration/entry-links/' + code, { method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(10_000) });
  if (!response.ok || !/application\/json/iu.test(response.headers.get('content-type') ?? '')) throw new Error('LINK_UNAVAILABLE');
  const text = await response.text(); if (text.length > 8192) throw new Error('LINK_INVALID');
  const body = JSON.parse(text);
  if (!body || Object.keys(body).length !== 1 || typeof body.confirmationUrl !== 'string') throw new Error('LINK_INVALID');
  const target = new URL(body.confirmationUrl);
  if (target.username || target.password || target.port || target.origin !== 'https://artdico.host' || target.pathname !== '/registration/confirmation/' || target.search || !/^#r=c1\.[A-Za-z0-9_.-]+$/u.test(target.hash) || target.href.length > 4096) throw new Error('LINK_INVALID');
  return target.href;
}
