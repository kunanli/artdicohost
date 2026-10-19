import { ContentError } from './store.mjs';
import { validateInvitationSettings } from '../../shared/contacts-schema.mjs';

const EVENT_TITLE = 'GGJ 中国交流聚会';
const WALLET_REQUIREMENTS = [
  ['APPLE_WALLET_TEAM_ID', 'Apple Team ID'],
  ['APPLE_WALLET_PASS_TYPE_ID', 'Pass Type ID'],
  ['APPLE_WALLET_ORGANIZATION_NAME', '签发机构名称'],
  ['APPLE_WALLET_CERT_PATH', 'Pass Type ID 签名证书'],
  ['APPLE_WALLET_KEY_PATH', '对应证书私钥'],
  ['APPLE_WALLET_WWDR_CERT_PATH', 'WWDR 中间证书'],
];
const EMAIL_REQUIREMENTS = [
  ['EMAILJS_SERVICE_ID', 'EmailJS Service ID'],
  ['EMAILJS_TEMPLATE_ID', 'EmailJS Template ID'],
  ['EMAILJS_PUBLIC_KEY', 'EmailJS Public Key'],
];

function missing(env, requirements) {
  return requirements.filter(([key]) => typeof env[key] !== 'string' || !env[key].trim()).map(([, label]) => label);
}
function requireContactConsent(contact) {
  if (!contact) throw new ContentError('CONTACT_NOT_FOUND', '此联系人不存在，请重新载入。', 404);
  if (contact.profile?.contactConsent !== 'consented') throw new ContentError('CONTACT_NOT_CONSENTED', '来源资料未明确同意后续联系，不能准备邀请或确认邮件。', 422);
}
function checkedSettings(settings) {
  const result = validateInvitationSettings(settings);
  if (!result.valid) throw new ContentError('VALIDATION_ERROR', '活动信息未通过校验。', 422, result.errors);
  return result.value;
}

/** Readiness never validates, reads or returns credentials; preview is always disabled for delivery. */
export function getCommunicationsReadiness(env = {}) {
  const walletMissing = missing(env, WALLET_REQUIREMENTS);
  const emailMissing = missing(env, EMAIL_REQUIREMENTS);
  return {
    mode: 'preview',
    wallet: {
      ready: false,
      reason: walletMissing.length
        ? '仅开放卡片预览。待配置：' + walletMissing.join('、') + '；还需核验证书、签名和真机添加。'
        : '已提供配置占位，但未核验证书与签名；当前仅开放卡片预览，不能添加到 Apple Wallet。',
    },
    email: {
      ready: false,
      reason: emailMissing.length
        ? '仅开放确认邮件预览。待配置：' + emailMissing.join('、') + '；还需核对发件服务、模板与投递结果。'
        : '已提供配置占位，但未核验发件服务与投递；当前仅开放预览，不会发送邮件。',
    },
  };
}

/** Human-readable card only: no signature, serial, barcode, admission token or .pkpass bytes. */
export function buildWalletPreview(contact, settings) {
  requireContactConsent(contact);
  const value = checkedSettings(settings);
  return {
    mode: 'preview', status: 'unsigned_preview', kind: 'eventTicket',
    title: EVENT_TITLE, name: value.recipientName, date: value.date, time: value.time,
    location: value.venue, confirmed: value.confirmed,
    notice: '未签名卡片预览，无法加入 Apple Wallet，不是入场凭证。' + (value.confirmed ? '' : '活动安排暂定，以筹备团队最终通知为准。'),
  };
}

/** Historical intent is insufficient: staff must separately record an actual attending response. */
export function buildAttendanceConfirmationPreview(contact, settings) {
  requireContactConsent(contact);
  if (contact.operations?.responseStatus !== 'attending') throw new ContentError('ATTENDANCE_NOT_CONFIRMED', '请先根据对象的实际回复记录确认出席，再准备确认邮件。', 422);
  const toEmail = contact.profile.email;
  if (typeof toEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(toEmail)) throw new ContentError('EMAIL_REQUIRED', '请先核对对象的有效邮箱。', 422);
  const value = checkedSettings(settings);
  const eventStatus = value.confirmed ? '活动信息已由工作人员核对' : '活动安排暂定，以筹备团队最终通知为准';
  const variables = {
    to_name: value.recipientName,
    event_title: EVENT_TITLE,
    event_date: value.date,
    event_time: value.time,
    event_venue: value.venue,
    event_status: eventStatus,
  };
  return {
    kind: 'attendance_confirmation', mode: 'preview', status: 'not_sent', toEmail,
    subject: EVENT_TITLE + '｜出席确认',
    text: [
      value.recipientName + '，你好：', '',
      '筹备团队已记录你确认出席' + EVENT_TITLE + '。', '',
      '日期：' + value.date,
      '时间：' + value.time,
      '地点：' + value.venue,
      '安排状态：' + eventStatus, '',
      '如行程有变，请通过原联系渠道告知筹备团队。',
      '本确认不代表讲者、展位、赞助合作、住宿或官方 GGJ 站点资格已获确认。',
    ].join('\n'),
    variables,
  };
}

/** Explicit preparation adapter. Supplying real credentials cannot enable sending or signing. */
export function createPreviewCommunications({ env = {} } = {}) {
  if ((env.COMMUNICATIONS_MODE ?? 'preview') !== 'preview') throw new TypeError('通讯接入当前只支持 preview，不能启用真实发信或签发 Wallet。');
  const readiness = getCommunicationsReadiness(env);
  function disabled() {
    throw new ContentError('COMMUNICATIONS_PREVIEW_ONLY', '当前仅提供预览，尚未启用真实发信或 Wallet 签发。', 503);
  }
  return Object.freeze({
    readiness: () => structuredClone(readiness),
    emailPreview: buildAttendanceConfirmationPreview,
    walletPreview: buildWalletPreview,
    sendEmail: disabled,
    issueWalletPass: disabled,
  });
}
