import { english } from './en.mjs';
import { registrationEnglish } from './registration-en.mjs';
import { eventConfig, faqItems } from '../config/event.mjs';
for (const pair of registrationEnglish) english.set(...pair);
const faqAnswers = {
  'registration-status':'Register for general admission on Huodongxing. Availability, results and admission credentials are shown there. Submit speaker proposals on this website; the organizing team will follow up. Check the form here for proposal availability.',
  'site-role':'Current or former GGJ site organizers (SO / RO) and prospective organizers can register to attend on Huodongxing. Contact kunan@globalgamejam.org about starting a new site or exchanging site experience. The organizing team will follow up about support needs.\nOn-site guidance does not replace the official GGJ application; GGJ confirms the result. Prepare a local organizer, team and venue, then apply through Start a Jam Site on the GGJ website. Check the official website for application dates.',
  'lodging-support':'Limited accommodation support is available for visitors from outside the area. Contact kunan@globalgamejam.org in advance to discuss arrangements. Places are limited and accommodation will be confirmed separately.',
};
for (const item of faqItems) if (faqAnswers[item.id]) english.set(item.answer, faqAnswers[item.id]);
english.set(eventConfig.privacy.notice,'This form is a preview and does not collect real applications. Before enabling the live form, the personal information notice and procedures for access, correction, withdrawal and deletion will be published.');
english.set('本站正式表单启用前，将核定处理者、联系邮箱、存储地区、保留期限及查阅、更正、撤回、删除方式。第一阶段不收取证件、酒店订单或财务账单；对外分享个人信息须另行告知并取得适用授权。','Before enabling the live form, the controller, contact email, storage region, retention period and procedures for access, correction, withdrawal and deletion will be confirmed. The first phase does not collect identity documents, hotel bookings or financial statements. Sharing personal information externally requires separate notice and applicable authorization.');

/** Translate complete messages, plus a bounded set of UI templates. Never use
 * generic word replacement on editorial content or user-provided information. */
export function translate(value, language) {
  if (language !== 'en' || typeof value !== 'string') return value;
  const key=value.trim(), translated=english.get(key);
  if (translated) return value.replace(key,translated);
  let match;
  if (key.endsWith('｜活动安排')) return translate(key.slice(0,-5),language)+' | Event schedule';
  if ((match=/^(\d+(?: \/ \d+)?) 件作品$/u.exec(key))) return match[1]+' projects';
  if ((match=/^(提交验证|核对申请回执|读取申请设置)(.+)$/su.exec(key))) {
    const stage={'提交验证':'Submission verification','核对申请回执':'Application receipt check','读取申请设置':'Application settings'}[match[1]];
    const reason=match[2];
    if ((match=/^返回了无法识别的响应（HTTP (\d+)），请保留本页后重试。$/u.exec(reason))) return `${stage} returned an unrecognized response (HTTP ${match[1]}). Keep this page open and retry.`;
    if (reason==='未返回完整资料，请保留本页后重试。') return stage+' returned incomplete data. Keep this page open and retry.';
    if (reason==='返回资料超出限制，请保留本页并联系主办方。') return stage+' returned too much data. Keep this page open and contact the organizers.';
    if (reason==='返回资料未通过检查，请保留本页后重试。') return stage+' returned invalid data. Keep this page open and retry.';
    if (reason==='超时，请保留本页并核对原申请。') return stage+' timed out. Keep this page open and check the original application.';
    if (reason==='网络连接未完成，请保留本页并核对原申请。') return stage+' could not connect. Keep this page open and check the original application.';
    if ((match=/^暂不可用（HTTP (\d+)），请保留原申请后重试。$/u.exec(reason))) return `${stage} is unavailable (HTTP ${match[1]}). Keep the original application and retry.`;
  }
  if ((match=/^([ABC]) 区(?: · (.*))?$/u.exec(key))) return `Zone ${match[1]}${match[2] ? ' · '+translate(match[2],language) : ''}`;
  if ((match=/^查看(.+)的作品大图$/u.exec(key))) return 'View image: '+match[1];
  if ((match=/^(.+)的作品图$/u.exec(key))) return 'Project image: '+match[1];
  if ((match=/^(.+)的组织图片$/u.exec(key))) return 'Organization image: '+match[1];
  if ((match=/^(.+) · 打开组织页面（新窗口）$/u.exec(key))) return match[1]+' · Open organization website (new window)';
  if ((match=/^(.+)，嘉宾介绍$/u.exec(key))) return match[1]+' · Guest introduction';
  if ((match=/^(.+)简介$/u.exec(key))) return 'Bio: '+match[1];
  if ((match=/^请检查 (\d+) 项标记内容，当前没有提交申请。$/u.exec(key))) return `Please check the ${match[1]} highlighted fields. No application has been submitted.`;
  if ((match=/^(\d{2}:\d{2}) 开始签到 ·$/u.exec(key))) return match[1]+' Check-in · ';
  if ((match=/^请手动复制 (.+)$/u.exec(key))) return 'Please copy manually: '+match[1];
  if ((match=/^联络筹备团队 · (.+)$/u.exec(key))) return 'Contact the organizers · '+match[1];
  if ((match=/^(\d{4}-\d\d-\d\d) · 日期暂定$/u.exec(key))) return match[1]+' · Date tentative';
  if (key.endsWith('（暂定）')) return translate(key.slice(0,-4),language)+' (tentative)';
  if ((match=/^(\d{4}-\d\d-\d\d .+) 开场$/u.exec(key))) return match[1]+' · Event starts';
  if ((match=/^活动时区 · (.+)$/u.exec(key))) return 'Event time zone · '+match[1];
  if ((match=/^(处理者|联络邮箱|用途|存储地区|保留期限|查阅、更正、撤回及删除|分享范围|告知版本)：(.+)$/su.exec(key))) return translate(match[1],language)+': '+translate(match[2],language);
  return value;
}
