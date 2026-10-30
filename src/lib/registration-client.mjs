import { admissionSummary, registrationReceiptState } from './admission-view.mjs';
import { savedConfirmation } from './confirmation-client.mjs';
import { applicationPendingValue } from './application-draft.mjs';
const API_ORIGIN = 'https://api.artdico.host';
const SITE_ORIGIN = 'https://artdico.host';
const KEY = /^[A-Za-z0-9_-]{32,128}$/u;
const TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const PRIVACY_KEYS = ['version','processor','contactEmail','purpose','storageRegion','retention','rightsRequest','sharing'];
const clientFailures = new WeakSet();

function failure(code, message, uncertain = false) {
  const error = new Error(message);
  error.code = code;
  error.uncertain = uncertain;
  clientFailures.add(error);
  return error;
}
function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
}

/** Public transport uses an injected recovery store; tokens and staff cookies never persist. */
export function createRegistrationClient({ apiOrigin, pageOrigin, fetchFn = globalThis.fetch, randomBytes = () => crypto.getRandomValues(new Uint8Array(32)), clock = Date.now, pendingStore = null } = {}) {
  const available = apiOrigin === API_ORIGIN && pageOrigin === SITE_ORIGIN && typeof fetchFn === 'function';
  let config = null;
  let pending = null;
  let busy = false;
  let preparing = false;
  if(pendingStore!==null&&(!pendingStore||!['prepare','update','clear','reject'].every(key=>typeof pendingStore[key]==='function')))throw new TypeError('Application recovery store required.');
  const pendingValue=()=>({eventId:JSON.parse(pending.json).eventId,idempotencyKey:pending.key,payloadJson:pending.json,attempted:pending.sent,uncertain:pending.uncertain});
  async function persist(method){if(!pendingStore)return;const value=pendingValue();const saved=applicationPendingValue(await pendingStore[method](value),value.eventId);if(saved.idempotencyKey!==pending.key||saved.payloadJson!==pending.json||saved.attempted!==pending.sent||saved.uncertain!==pending.uncertain)throw failure('DRAFT_UNCONFIRMED','本机恢复信息尚未保存，当前未继续提交。',pending.sent);}
  async function request(path, body, headers = {}) {
    const stage=path.endsWith('/token')?'token':path.endsWith('/submit')?'submit':'config';
    const label={token:'提交验证',submit:'核对申请回执',config:'读取申请设置'}[stage];
    const transportFailure=(reason,message)=>Object.assign(failure('UNAVAILABLE',message),{stage,reason});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetchFn(API_ORIGIN + path, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
      });
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw transportFailure('RESPONSE_FORMAT',label+'返回了无法识别的响应（HTTP '+response.status+'），请保留本页后重试。');
      const reader = response.body?.getReader();
      if (!reader) throw transportFailure('RESPONSE_FORMAT',label+'未返回完整资料，请保留本页后重试。');
      const chunks = []; let size = 0;
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 64 * 1024) { await reader.cancel(); throw transportFailure('RESPONSE_SIZE',label+'返回资料超出限制，请保留本页并联系主办方。'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      let value;
      try { value = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); }
      catch { throw transportFailure('RESPONSE_FORMAT',label+'返回资料未通过检查，请保留本页后重试。'); }
      return { status: response.status, value };
    } catch(error) {
      if(clientFailures.has(error))throw error;
      throw transportFailure(controller.signal.aborted?'TIMEOUT':'NETWORK',label+(controller.signal.aborted?'超时':'网络连接未完成')+'，请保留本页并核对原申请。');
    }
    finally { clearTimeout(timer); }
  }
  async function sendPending(){
      if(!available||!pending)throw failure('NOT_READY','没有可核对的原申请。');
      if(busy||preparing)throw failure('BUSY','正在确认申请结果，请稍候。');
      const previousUnknown=pending.uncertain;busy=true;
      try{
        const eventId=JSON.parse(pending.json).eventId;
        const issued=await request('/api/admin/registration/token',{eventId,idempotencyKey:pending.key});const token=issued.value;
        if(issued.status!==200)throw Object.assign(failure(issued.status===429?'RATE_LIMITED':'TOKEN_UNAVAILABLE','提交验证暂不可用（HTTP '+issued.status+'），请保留原申请后重试。',pending.sent),{stage:'token',reason:'HTTP_STATUS'});
        if(issued.status!==200||token?.eventId!==eventId||typeof token.submissionToken!=='string'||token.submissionToken.length>4096||!TOKEN.test(token.submissionToken)||!timestamp(token.expiresAt)||Date.parse(token.expiresAt)<=clock())throw failure('TOKEN_UNAVAILABLE','暂时无法核对，请保留原申请后重试。',pending.sent);
        pending.sent=true;await persist('update');
        const result=await request('/api/admin/registration/submit',JSON.parse(pending.json),{'Idempotency-Key':pending.key,'X-Registration-Token':token.submissionToken});
        const admissionState=registrationReceiptState(result.value);
        if([200,201].includes(result.status)&&admissionState&&KEY.test(result.value.reference_code)){
          const receipt={httpStatus:result.status,body:{status:admissionState==='confirmed'?'registered':admissionState,admissionStatus:admissionState,reference_code:result.value.reference_code,groupInvite:null}};
          if(result.value.admissionKind!==undefined)receipt.body.admissionKind=result.value.admissionKind;if(result.value.admissionRevision!==undefined)receipt.body.admissionRevision=result.value.admissionRevision;
          const confirmation=savedConfirmation(result.value.confirmation,clock());if(confirmation&&['pending_review','rejected'].includes(admissionState))confirmation.email.status='not_applicable';if(confirmation)receipt.body.confirmation=confirmation;
          const invite=result.value.groupInvite;if(admissionState==='confirmed'&&invite?.platform==='wechat'&&timestamp(invite.expiresAt)&&Date.parse(invite.expiresAt)>clock()){try{const url=new URL(invite.qrImageUrl);if(url.origin===API_ORIGIN&&!url.username&&!url.password&&!url.hash)receipt.body.groupInvite={platform:'wechat',qrImageUrl:url.href,expiresAt:invite.expiresAt};}catch{}}
          let cleaned=true;if(pendingStore)try{await pendingStore.clear(pendingValue());}catch{receipt.localRecoveryRetained=true;cleaned=false;}
          if(cleaned)pending=null;return receipt;
        }
        if(result.status===422&&!previousUnknown){if(pendingStore)await pendingStore.reject(pendingValue());pending=null;throw failure('INVALID','资料未通过检查，请核对字段及隐私同意。');}
        if(result.status===422)throw failure('PENDING','原申请结果仍待核对，请勿重新提交另一份申请。',true);
        if(result.status===429)throw failure('RATE_LIMITED','请求较多，请稍候核对原申请。',true);
        if(result.status===409)throw failure('CONFLICT','原申请暂时无法核对，请联系主办方。',true);
        if(result.status===410)throw failure('WITHDRAWN','这份申请已撤回，请联系主办方。',true);
        throw failure('UNCONFIRMED','结果尚待核对，请保留原申请，再次点击确认。',true);
      }catch(error){if(pending?.sent){pending.uncertain=true;try{await persist('update');}catch{}error.uncertain=true;}if(error.code)throw error;throw failure('UNCONFIRMED','结果尚待核对，请保留原申请。',Boolean(pending?.sent));}finally{busy=false;}
  }
  return Object.freeze({
    get pending() { return Boolean(pending&&(pending.sent||pendingStore)); },
    get pendingSnapshot(){return pending?structuredClone(pendingValue()):null;},
    restorePending(value){if(!available||busy||preparing||pending)throw failure('PENDING','请先核对当前申请。');const saved=applicationPendingValue(value);pending={key:saved.idempotencyKey,json:saved.payloadJson,sent:saved.attempted,uncertain:saved.uncertain||saved.attempted};return structuredClone(pendingValue());},
    resume(){return sendPending();},
    async configure() {
      if (!available) return null;
      const result = await request('/api/admin/registration/config');
      const value = result.value;
      if (result.status !== 200) throw failure('UNAVAILABLE','正式报名服务暂时不可用，请稍后重试。');
      const complete = value && typeof value.eventId==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value.eventId) && timestamp(value.opensAt) && timestamp(value.closesAt)
        && Number.isSafeInteger(value.capacity) && value.capacity > 0
        && PRIVACY_KEYS.every(key => typeof value.privacy?.[key] === 'string' && value.privacy[key].trim().length > 0 && value.privacy[key].length <= 4000)
        && !/demo|frontend|mock/iu.test(value.privacy.version);
      const summary = admissionSummary(value?.admissions);
      const metadata = complete ? {eventId:value.eventId,opensAt:value.opensAt,closesAt:value.closesAt,capacity:value.capacity,privacy:Object.fromEntries(PRIVACY_KEYS.map(key=>[key,value.privacy[key]])), ...(summary ? {admissions:summary} : {}), ...(typeof value.attendeeReviewRequired==='boolean'?{attendeeReviewRequired:value.attendeeReviewRequired}:{})} : {};
      if (value?.enabled === false) { config = null; return {enabled:false,reason:value.reason==='closed'?'closed':'unavailable',...metadata}; }
      if (value?.enabled !== true) throw failure('CONFIG_INVALID','正式报名配置尚未完整，请稍后再来。');
      if (!complete) throw failure('CONFIG_INVALID','正式报名配置尚未完整，请稍后再来。');
      config = structuredClone({enabled:true,...metadata});
      return structuredClone(config);
    },
    async submit(fields) {
      if(busy||preparing)throw failure('BUSY','正在确认申请结果，请稍候。');
      if(pending){if(JSON.stringify(JSON.parse(pending.json).fields)!==JSON.stringify(fields))throw failure('PENDING','请先核对原申请，不能更换内容重复提交。',true);return sendPending();}
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
        pending = {key,json,sent:false,uncertain:false};
      }
      preparing=true;try{await persist('prepare');}catch(error){pending=null;throw error;}finally{preparing=false;}
      return sendPending();
    },
  });
}
