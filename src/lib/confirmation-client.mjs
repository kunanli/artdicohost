const API = 'https://api.artdico.host';
const SITE = 'https://artdico.host';
const PATH = '/registration/confirmation/';
const TOKEN = /^[A-Za-z0-9_.-]{32,4096}$/u;
const ID = /^[A-Za-z0-9_-]{43}$/u;
const EMAIL_STATES = ['not_configured','not_applicable','disabled','pending','provider_accepted','rejected','unknown'];
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max
  && (empty || value.trim().length > 0) && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const instant = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function confirmationLink(token) {
  return typeof token === 'string' && TOKEN.test(token) ? SITE + PATH + '#r=' + token : null;
}

/** A saved result may redirect only to its matching capability on the fixed site. */
export function savedConfirmation(value, now = Date.now()) {
  if (!plain(value) || !confirmationLink(value.receiptToken) || value.confirmationUrl !== confirmationLink(value.receiptToken)
    || !instant(value.expiresAt) || Date.parse(value.expiresAt) <= now || !EMAIL_STATES.includes(value.email?.status)) return null;
  return { receiptToken: value.receiptToken, confirmationUrl: value.confirmationUrl, expiresAt: value.expiresAt, email: { status: value.email.status } };
}

export function confirmationToken(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#r=')) return null;
  const token = hash.slice(3);
  return TOKEN.test(token) ? token : null;
}

function groupInvite(value, now) {
  if (value?.platform !== 'wechat' || !instant(value.expiresAt) || Date.parse(value.expiresAt) <= now || typeof value.qrImageUrl !== 'string') return null;
  try {
    const url = new URL(value.qrImageUrl);
    if (url.origin !== API || url.username || url.password || url.hash || url.search
      || !/^\/api\/(?:admin\/registration|registration)\/group-invite\/[A-Za-z0-9_.-]+$/u.test(url.pathname)) return null;
    return { platform: 'wechat', qrImageUrl: url.href, expiresAt: value.expiresAt };
  } catch { return null; }
}

/** Project a capability response; private source/contacts and unknown fields never reach the page. */
export function confirmationView(value, now = Date.now()) {
  if (!plain(value) || !ID.test(value.referenceCode ?? '') || !instant(value.submittedAt) || !plain(value.event) || !plain(value.admission)
    || !['confirmed','waitlisted','withdrawn'].includes(value.admission.status) || !['attendee','crew'].includes(value.admission.kind)
    || !Number.isSafeInteger(value.admission.revision) || value.admission.revision < 0 || !EMAIL_STATES.includes(value.email?.status)
    || typeof value.wallet?.ready !== 'boolean') return null;
  const eventKeys = ['id','title','date','time','venue','timezone','checkIn'];
  if (eventKeys.some(key => !text(value.event[key], key === 'title' || key === 'venue' ? 500 : 100))
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value.event.date)) return null;
  const withdrawn = value.admission.status === 'withdrawn';
  if (!withdrawn && (!text(value.attendee?.name, 200) || !text(value.attendee?.organization ?? '', 500, true))) return null;
  const confirmed = value.admission.status === 'confirmed';
  return {
    event: Object.fromEntries(eventKeys.map(key => [key,value.event[key]])), referenceCode: value.referenceCode, submittedAt: value.submittedAt,
    admission: { status: value.admission.status, kind: value.admission.kind, revision: value.admission.revision },
    attendee: withdrawn ? { name: '', organization: '' } : { name: value.attendee.name, organization: value.attendee.organization ?? '' },
    email: { status: value.email.status }, wallet: { ready: confirmed && value.wallet.ready },
    groupInvite: confirmed ? groupInvite(value.groupInvite,now) : null,
  };
}

export const confirmationEmailLabels = Object.freeze({
  not_configured: '报名已保存，确认邮件暂未启用。请保存本页链接或打印留存。',
  not_applicable: '这份报名没有提供邮箱，请保存本页链接或打印留存。',
  disabled: '报名已保存，确认邮件暂未启用。请保存本页链接或打印留存。',
  pending: '报名已保存，确认邮件待处理。请先保存本页，无需重复报名。',
  provider_accepted: '确认邮件已交由服务商处理，请检查邮箱及垃圾邮件。',
  rejected: '报名已保存，确认邮件未能发出。请保存本页，无需重新报名。',
  unknown: '报名已保存，确认邮件的发送结果尚待核对。请保存本页，无需重复报名。',
});

export function createConfirmationClient({ apiOrigin, pageOrigin, fetchFn = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  const available = apiOrigin === API && pageOrigin === SITE && typeof fetchFn === 'function';
  async function request(path, receiptToken, mime, maxBytes) {
    if (!available || !confirmationLink(receiptToken)) throw new Error('请从报名完成后的确认链接或确认邮件打开本页。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),timeoutMs);
    try {
      const response = await fetchFn(API + path, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: { 'Content-Type': 'application/json', Accept: mime }, body: JSON.stringify({ receiptToken }), signal: controller.signal });
      if (!response || response.redirected || response.url && response.url !== API + path) throw new Error();
      if ([401,403,404,410].includes(response.status)) throw Object.assign(new Error('这个确认链接已失效或不可用，请通过原联系渠道向筹备团队核对。'), { known: true });
      if (response.status !== 200 || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== mime) throw new Error();
      const declared = response.headers.get('content-length');
      if (declared !== null && (!/^(?:0|[1-9]\d*)$/u.test(declared) || Number(declared) > maxBytes)) throw new Error();
      const reader = response.body?.getReader(); if (!reader) throw new Error();
      const chunks = []; let size = 0;
      try {
        for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > maxBytes) throw new Error(); chunks.push(part.value); }
      } finally { try { await reader.cancel(); } catch { /* A cancelled response cannot cause another request. */ } reader.releaseLock(); }
      // Browsers decode HTTP content encodings while retaining the encoded
      // Content-Length. Bound decoded bytes rather than comparing those sizes.
      if (!size) throw new Error();
      const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part,offset); offset += part.byteLength; }
      return bytes;
    } catch (error) {
      if (error.known) throw error;
      throw new Error('暂时无法核对最新报名状态，请稍后按「重新读取」。无需重复报名。');
    } finally { clearTimeout(timer); controller.abort(); }
  }
  return Object.freeze({
    get available() { return available; },
    async read(receiptToken) {
      const bytes = await request('/api/admin/registration/confirmation',receiptToken,'application/json',64 * 1024);
      let value; try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new Error('报名状态未通过核对，请稍后重新读取。'); }
      const view = confirmationView(value); if (!view) throw new Error('报名状态未通过核对，请稍后重新读取。'); return view;
    },
    async wallet(receiptToken) {
      const bytes = await request('/api/admin/registration/wallet',receiptToken,'application/vnd.apple.pkpass',2 * 1024 * 1024);
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('票券未通过检查，请稍后再试。');
      return new Blob([bytes],{type:'application/vnd.apple.pkpass'});
    },
  });
}
