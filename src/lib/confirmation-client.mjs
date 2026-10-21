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
const exact = (value, keys) => plain(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const posterText = (value, maximum) => typeof value === 'string' && value.isWellFormed() && value === value.normalize('NFC').trim()
  && value.length > 0 && [...value].length <= maximum && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
export const CONFIRMATION_INVITATION_FILENAME = 'artdico-host-invitation.png';

/** The API supplies the exact poster facts. Older receipts never infer permission from their event text. */
export function confirmationInvitation(value, admissionStatus, attendeeName) {
  const disabled = { ready: false };
  if (admissionStatus !== 'confirmed' || !exact(value, ['ready','settings']) || value.ready !== true) return disabled;
  const settings = value.settings;
  if (!exact(settings, ['recipientName','date','time','venue','confirmed','renderVersion'])
    || settings.confirmed !== true || settings.renderVersion !== 'ggj2026-poster-v2'
    || !posterText(settings.recipientName,120) || !posterText(settings.venue,300)
    || typeof attendeeName !== 'string' || settings.recipientName !== attendeeName.normalize('NFC').trim()
    || typeof settings.date!=='string'||typeof settings.time!=='string'
    || !/^\d{4}-\d{2}-\d{2}$/u.test(settings.date)
    || !Number.isFinite(Date.parse(settings.date+'T00:00:00Z'))
    || new Date(settings.date+'T00:00:00Z').toISOString().slice(0,10) !== settings.date
    || !/^(?:[01]\d|2[0-3]):[0-5]\d–(?:[01]\d|2[0-3]):[0-5]\d$/u.test(settings.time ?? '')
    || settings.time.slice(6) <= settings.time.slice(0,5)) return disabled;
  return { ready: true, settings: Object.fromEntries(['recipientName','date','time','venue','confirmed','renderVersion'].map(key=>[key,settings[key]])) };
}

const subject = value => value&&ID.test(value.referenceCode??'')&&instant(value.submittedAt)&&text(value.event?.id,100) ? JSON.stringify([value.referenceCode,value.submittedAt,value.event.id]) : null;
/** Compare only this person's current facts; another attendee's shared admission revision is irrelevant. */
export function confirmationInvitationFacts(value) {
  if (!subject(value) || value.admission?.status !== 'confirmed' || !['attendee','crew'].includes(value.admission.kind)||value.invitation?.ready !== true||!text(value.attendee?.organization,500,true)) return null;
  const invitation=confirmationInvitation(value.invitation,value.admission.status,value.attendee?.name);
  return invitation.ready ? JSON.stringify([subject(value),value.attendee.name,value.attendee.organization,value.admission.kind,invitation.settings]) : null;
}

/** Two fresh read-only checks surround all asynchronous rendering and PNG encoding. */
export async function prepareConfirmationInvitation({receiptToken,initial,read,generate,isCurrent=()=>true,signal}={}) {
  const current=()=>isCurrent()===true&&!signal?.aborted;
  const cancelled=()=>Object.assign(new Error('已取消这次邀请函生成。'),{cancelled:true});
  const assertCurrent=()=>{if(!current())throw cancelled();};
  assertCurrent();
  if(!confirmationLink(receiptToken)||!confirmationInvitationFacts(initial))throw new Error('请重新核对当前参会名额与邀请函资料。');
  const first=await read(receiptToken,{signal});assertCurrent();
  if(subject(first)!==subject(initial))throw new Error('报名状态或活动资料已更新，请重新核对后生成。');
  if(!confirmationInvitationFacts(first))throw Object.assign(new Error('报名状态或活动资料已更新，请重新核对后生成。'),{view:first});
  let blob;
  try{blob=await generate(first.invitation.settings,{signal});}catch(error){assertCurrent();throw Object.assign(new Error(error.message||'邀请函暂时无法生成，请稍后再试。'),{view:first});}
  assertCurrent();
  if(!(blob instanceof Blob)||blob.type!=='image/png'||!blob.size)throw Object.assign(new Error('邀请函图片未通过核对，请重新生成。'),{view:first});
  const final=await read(receiptToken,{signal});assertCurrent();
  if(confirmationInvitationFacts(first)!==confirmationInvitationFacts(final))throw Object.assign(new Error('报名状态或活动资料已更新，请重新核对后生成。'),subject(first)===subject(final)?{view:final}:{});
  return {blob,view:final};
}

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
    || !['pending_review','confirmed','waitlisted','rejected','withdrawn'].includes(value.admission.status) || !['attendee','crew'].includes(value.admission.kind)
    || !Number.isSafeInteger(value.admission.revision) || value.admission.revision < 0 || !EMAIL_STATES.includes(value.email?.status)
    || typeof value.wallet?.ready !== 'boolean') return null;
  const eventKeys = ['id','title','date','time','venue','timezone','checkIn'];
  if (eventKeys.some(key => !text(value.event[key], key === 'title' || key === 'venue' ? 500 : 100))
    || !/^\d{4}-\d{2}-\d{2}$/u.test(value.event.date)) return null;
  const withdrawn = value.admission.status === 'withdrawn';
  if (!withdrawn && (!text(value.attendee?.name, 400) || [...value.attendee.name].length>200 || !text(value.attendee?.organization ?? '', 500, true))) return null;
  const confirmed = value.admission.status === 'confirmed';
  return {
    event: Object.fromEntries(eventKeys.map(key => [key,value.event[key]])), referenceCode: value.referenceCode, submittedAt: value.submittedAt,
    admission: { status: value.admission.status, kind: value.admission.kind, revision: value.admission.revision },
    attendee: withdrawn ? { name: '', organization: '' } : { name: value.attendee.name, organization: value.attendee.organization ?? '' },
    email: { status: ['pending_review','rejected'].includes(value.admission.status) ? 'not_applicable' : value.email.status }, wallet: { ready: confirmed && value.wallet.ready },
    groupInvite: confirmed ? groupInvite(value.groupInvite,now) : null,
    invitation: confirmationInvitation(value.invitation,value.admission.status,value.attendee?.name),
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

/** Review status controls the purpose of this page; it never promises an invitation before a confirmed seat. */
export function confirmationEmailMessage(admissionStatus, emailStatus) {
  if (admissionStatus === 'pending_review') return '申请已收到，待主办方人工审核。当前没有参会名额，也不会发送正式邀请；请保存此查询链接。';
  if (admissionStatus === 'rejected') return '本次申请未通过审核，没有确认参会名额或正式邀请。如需核对，请通过原联系渠道联络筹备团队。';
  if (admissionStatus === 'waitlisted') return '当前为候补，尚未确认参会名额，不提供正式邀请。请通过本页核对后续状态，无需重复申请。';
  if (admissionStatus === 'withdrawn') return '这份报名已取消，原确认邮件不代表当前仍有参会名额。';
  return admissionStatus === 'confirmed' ? confirmationEmailLabels[emailStatus] ?? '' : '';
}

export const confirmationStatusLabels = Object.freeze({
  pending_review: ['待人工审核', '申请已收到，待审核', '主办方将人工核对这份申请。目前尚未确认参会名额，请保存申请编号与本页查询链接。', '打印申请收据'],
  confirmed: ['名额已确认', '参会名额已确认', '期待在现场与你相见。请保存登记编号，方便签到和后续核对。', '打印参会确认'],
  waitlisted: ['尚未确认名额', '候补登记已保存', '当前尚未确认参会名额。请等待筹备团队核对后续名额，无需重复申请。', '打印候补状态'],
  rejected: ['审核未通过', '本次申请未通过审核', '这份申请已完成审核，目前没有参会名额。如需核对，请通过原联系渠道联络筹备团队。', '打印审核结果'],
  withdrawn: ['名额已取消', '这份报名已取消', '这份报名当前不再占用参会名额。如需调整，请通过原联系渠道向筹备团队核对。', '打印取消状态'],
});

export function createConfirmationClient({ apiOrigin, pageOrigin, fetchFn = globalThis.fetch, timeoutMs = 20_000 } = {}) {
  const available = apiOrigin === API && pageOrigin === SITE && typeof fetchFn === 'function';
  async function request(path, receiptToken, mime, maxBytes, signal) {
    if (!available || !confirmationLink(receiptToken)) throw new Error('请从报名完成后的确认链接或确认邮件打开本页。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),timeoutMs);
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    try {
      if(controller.signal.aborted)throw new Error();
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
        for (;;) { if(controller.signal.aborted)throw new Error();const part = await reader.read(); if(controller.signal.aborted)throw new Error();if (part.done) break; size += part.value.byteLength; if (size > maxBytes) throw new Error(); chunks.push(part.value); }
      } finally { try { await reader.cancel(); } catch { /* A cancelled response cannot cause another request. */ } reader.releaseLock(); }
      // Browsers decode HTTP content encodings while retaining the encoded
      // Content-Length. Bound decoded bytes rather than comparing those sizes.
      if (!size) throw new Error();
      const bytes = new Uint8Array(size); let offset = 0; for (const part of chunks) { bytes.set(part,offset); offset += part.byteLength; }
      return bytes;
    } catch (error) {
      if(signal?.aborted)throw Object.assign(new Error('读取已取消。'),{cancelled:true});
      if (error.known) throw error;
      throw new Error('暂时无法核对最新报名状态，请稍后按「重新读取」。无需重复报名。');
    } finally { clearTimeout(timer);signal?.removeEventListener('abort',abort); controller.abort(); }
  }
  return Object.freeze({
    get available() { return available; },
    async read(receiptToken,{signal}={}) {
      const bytes = await request('/api/admin/registration/confirmation',receiptToken,'application/json',64 * 1024,signal);
      let value; try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { throw new Error('报名状态未通过核对，请稍后重新读取。'); }
      const view = confirmationView(value); if (!view) throw new Error('报名状态未通过核对，请稍后重新读取。'); return view;
    },
    async wallet(receiptToken,{signal}={}) {
      const bytes = await request('/api/admin/registration/wallet',receiptToken,'application/vnd.apple.pkpass',2 * 1024 * 1024,signal);
      if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw new Error('票券未通过检查，请稍后再试。');
      return new Blob([bytes],{type:'application/vnd.apple.pkpass'});
    },
  });
}
