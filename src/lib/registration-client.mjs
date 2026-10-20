const API_ORIGIN = 'https://api.artdico.host';
const SITE_ORIGIN = 'https://artdico.host';
const KEY = /^[A-Za-z0-9_-]{32,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const PRIVACY_KEYS = ['version','processor','contactEmail','purpose','storageRegion','retention','rightsRequest','sharing'];

function failure(code, message, uncertain = false) {
  const error = new Error(message);
  error.code = code;
  error.uncertain = uncertain;
  return error;
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}

/** Public registration transport. No browser storage, staff cookie, auto-retry or default API. */
export function createRegistrationClient({ apiOrigin, pageOrigin, fetchFn = globalThis.fetch, randomBytes = () => crypto.getRandomValues(new Uint8Array(32)), clock = Date.now } = {}) {
  const available = apiOrigin === API_ORIGIN && pageOrigin === SITE_ORIGIN && typeof fetchFn === 'function';
  let config = null;
  let pending = null;
  let busy = false;
  async function request(path, body, headers = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetchFn(API_ORIGIN + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw failure('UNAVAILABLE','服务暂时无法确认，请稍后重试。');
      const reader = response.body?.getReader();
      if (!reader) throw failure('UNAVAILABLE','服务暂时无法确认，请稍后重试。');
      const chunks = []; let size = 0;
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) { await reader.cancel(); throw failure('UNAVAILABLE','服务暂时无法确认，请稍后重试。'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
      catch { throw failure('UNAVAILABLE','服务暂时无法确认，请稍后重试。'); }
      return { status: response.status, value };
    } catch { throw failure('UNAVAILABLE','网络或服务暂时无法确认，请保留本页并重试。'); }
    finally { clearTimeout(timer); }
  }
  return Object.freeze({
    get pending() { return Boolean(pending?.sent); },
    async configure() {
      if (!available) return null;
      const result = await request('/api/admin/registration/config');
      const value = result.value;
      if (result.status !== 200) throw failure('UNAVAILABLE','正式报名服务暂时不可用，请稍后重试。');
      if (value?.enabled === false) { config = null; return {enabled:false,reason:value.reason==='closed'?'closed':'unavailable'}; }
      if (value?.enabled !== true) throw failure('CONFIG_INVALID','正式报名配置尚未完整，请稍后再来。');
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value.eventId) || !timestamp(value.opensAt) || !timestamp(value.closesAt)
        || !Number.isSafeInteger(value.capacity) || value.capacity < 1
        || !PRIVACY_KEYS.every(key => typeof value.privacy?.[key] === 'string' && value.privacy[key].trim().length > 0 && value.privacy[key].length <= 4000)
        || /demo|frontend|mock/iu.test(value.privacy.version)) throw failure('CONFIG_INVALID','正式报名配置尚未完整，请稍后再来。');
      config = structuredClone({enabled:true,eventId:value.eventId,opensAt:value.opensAt,closesAt:value.closesAt,capacity:value.capacity,privacy:Object.fromEntries(PRIVACY_KEYS.map(key=>[key,value.privacy[key]]))});
      return structuredClone(config);
    },
    async submit(fields) {
      if (!available || !config) throw failure('NOT_READY','本站正式报名暂未开放，请勿填写真实资料。');
      if (busy) throw failure('BUSY','正在确认报名结果，请稍候。');
      const payload = { eventId: config.eventId, fields, consent: {accepted:true,version:config.privacy.version} };
      const json = JSON.stringify(payload);
      if (new TextEncoder().encode(json).length > 128 * 1024) throw failure('INVALID','资料超过长度限制，请缩短后重试。');
      if (pending && pending.json !== json && pending.sent) throw failure('PENDING','上次结果尚未确认，请保留原资料并再次点击确认；需要更正可联络工作人员。',true);
      if (!pending || pending.json !== json) {
        const bytes = randomBytes();
        if (!(bytes instanceof Uint8Array) || bytes.length !== 32) throw failure('UNAVAILABLE','当前浏览器无法安全提交，请更换浏览器。');
        const key = Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
        if (!KEY.test(key)) throw failure('UNAVAILABLE','当前浏览器无法安全提交，请更换浏览器。');
        pending = {key,json,sent:false};
      }
      busy = true;
      try {
        const issued = await request('/api/admin/registration/token',{eventId:config.eventId,idempotencyKey:pending.key});
        const token = issued.value;
        if (issued.status !== 200 || token?.eventId !== config.eventId || typeof token.submissionToken !== 'string'
          || token.submissionToken.length > 4096 || !TOKEN.test(token.submissionToken) || !timestamp(token.expiresAt)
          || Date.parse(token.expiresAt) <= clock()) throw failure('TOKEN_UNAVAILABLE','报名验证暂时无法完成，请稍后再试。',pending.sent);
        pending.sent = true;
        const result = await request('/api/admin/registration/submit',JSON.parse(pending.json),{'Idempotency-Key':pending.key,'X-Registration-Token':token.submissionToken});
        if ([200,201].includes(result.status) && result.value?.status === 'registered' && KEY.test(result.value.reference_code)) {
          const receipt = {httpStatus:result.status,body:{status:'registered',reference_code:result.value.reference_code,groupInvite:null}};
          const invite = result.value.groupInvite;
          if (invite?.platform === 'wechat' && timestamp(invite.expiresAt) && Date.parse(invite.expiresAt) > clock()) {
            try { const url = new URL(invite.qrImageUrl); if (url.origin === API_ORIGIN && !url.username && !url.password && !url.hash) receipt.body.groupInvite = {platform:'wechat',qrImageUrl:url.href,expiresAt:invite.expiresAt}; } catch {}
          }
          pending = null;
          return receipt;
        }
        if (result.status === 422) { pending = null; throw failure('INVALID','资料未通过检查，请核对必填项目、格式及当前隐私告知。'); }
        if (result.status === 429) throw failure('RATE_LIMITED','请求较多，请稍候再试。保留本页即可，无需重新填写。',true);
        if (result.status === 409) throw failure('CONFLICT','当前报名已关闭或资料存在冲突。请保留本页并联络工作人员核对。',true);
        if (result.status === 410) throw failure('WITHDRAWN','这份报名已撤回，请联络工作人员核对。',true);
        throw failure('UNCONFIRMED','尚未确认保存成功。请保留本页与原资料，再次点击确认结果，不要重复新建报名。',true);
      } catch (error) {
        if (error.code) { if (pending?.sent) error.uncertain = true; throw error; }
        throw failure('UNCONFIRMED','尚未确认保存成功，请保留本页并再次确认。',Boolean(pending?.sent));
      } finally { busy = false; }
    },
  });
}
