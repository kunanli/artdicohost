/** The only raw HTML sent to EmailJS is a fixed server-rendered fragment.
 * Every variable inserted into that fragment is escaped. */
const SITE = 'https://artdico.host';
const SHORT = /^https:\/\/artdico\.host\/r\/#[A-Za-z0-9_-]{22}$/u;
const LEGACY = /^https:\/\/artdico\.host\/registration\/confirmation\/#r=[A-Za-z0-9_.-]{1,4096}$/u;
const QR = /^https:\/\/api\.artdico\.host\/api\/admin\/registration\/entry-links\/([A-Za-z0-9_-]{22})\/(entry|group)\.png$/u;
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll("'",'&#39;');
const line = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value);
const paragraph = value => typeof value === 'string' && value.length <= 16_000 && value.isWellFormed() && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export const CONFIRMATION_PRESENTATION_KEYS = Object.freeze(['email_subject','email_language','email_heading','email_summary','confirmation_actions']);

function cardActions({ card, en, walletReady, confirmationUrl }) {
  if (!card || [card.name, card.identity, card.event, card.date, card.time, card.venue].some(value => !line(value))
    || (card.community && !line(card.community))) throw new TypeError('Invalid commemorative email details.');
  const link = escape(confirmationUrl);
  const badge = SITE + '/wallet/add-to-apple-wallet-' + (en ? 'en' : 'cn') + '.png';
  const field = (label, value) => '<div style="margin:0 0 8px;">'
    + '<div style="color:#ddd5e9;font-size:12px;">' + label + '</div><div>' + escape(value) + '</div></div>';
  return '<p style="margin:18px 0 6px;">'
    + '<a href="' + link + '" style="display:inline-block;vertical-align:middle;margin:0 8px 8px 0;padding:12px 14px;background:#234e9b;color:#fff;border-radius:6px;text-decoration:none;font-size:15px;font-weight:bold;">'
    + (en ? 'Download JPEG' : '下载 JPEG 纪念卡') + '</a>'
    + (walletReady ? '<a href="' + link + '" style="display:inline-block;vertical-align:middle;margin:0 0 8px;"><img src="' + badge
      + '" alt="' + (en ? 'Add to Apple Wallet' : '添加到 Apple 钱包') + '" height="44" style="display:block;height:44px;width:auto;border:0;"></a>' : '')
    + '</p>'
    + (walletReady ? '<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#315445;">'
      + (en ? 'Follow the iPhone prompt to add the card.' : '请按 iPhone 的系统提示确认添加。') + '</p>' : '')
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#121212" style="max-width:600px;background:#121212;color:#fff;">'
    + '<tr><td><img src="' + SITE + '/wallet/host-card-banner.png" alt="HOST" width="384" height="150" style="display:block;width:100%;height:auto;border:0;"></td></tr>'
    + '<tr><td style="padding:14px 16px 20px;color:#fff;font-size:14px;line-height:1.45;word-wrap:break-word;overflow-wrap:anywhere;">'
    + '<div style="margin:0;padding:0 0 12px;border-bottom:1px solid #505050;font-size:16px;">' + escape(card.event) + '</div>'
    + '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;color:#fff;font:inherit;">'
    + '<tr><td width="60%" valign="top" style="padding:12px 4px 0 0;word-wrap:break-word;">' + field(en ? 'Name' : '参会人', card.name) + '</td>'
    + '<td width="40%" valign="top" align="right" style="padding:12px 0 0 4px;word-wrap:break-word;">' + field(en ? 'Card role' : '卡面身份', card.identity) + '</td></tr>'
    + (card.community ? '<tr><td colspan="2" style="padding:0 0 10px;color:#d9c7ff;word-wrap:break-word;">' + escape(card.community) + '</td></tr>' : '')
    + '<tr><td valign="top" style="padding:12px 4px 0 0;border-top:1px solid #505050;word-wrap:break-word;">'
    + field(en ? 'Date' : '日期', card.date) + field(en ? 'Time' : '时间', card.time) + '</td>'
    + '<td valign="top" align="right" style="padding:12px 0 0 4px;border-top:1px solid #505050;word-wrap:break-word;">'
    + field(en ? 'Venue' : '地点', card.venue) + '</td></tr></table></td></tr></table>'
    + '<p style="margin:14px 0 0;font-size:14px;line-height:1.6;color:#52617a;">'
    + (en ? 'Open the private page to save your card. Keep this email private.' : '打开私人领取页保存纪念卡。请保管此邮件。') + '</p>';
}

export function confirmationEmailPresentation({ locale, kind, subject, confirmationUrl, ticket, walletReady = false,
  heading = subject, summary = '', card } = {}) {
  if (!line(subject) || !['registration','promotion','application_received','pre_event_reminder','card_jpeg','card_wallet'].includes(kind)
    || !line(heading) || !paragraph(summary)
    || typeof confirmationUrl !== 'string' || !(SHORT.test(confirmationUrl) || LEGACY.test(confirmationUrl))) throw new TypeError('Invalid confirmation presentation.');
  const language = locale === 'en' ? 'en' : 'zh-CN', en = language === 'en';
  const pack = html => {
    if (Buffer.byteLength(html) > 16_000) throw new TypeError('Confirmation presentation too large.');
    return {email_subject:subject,email_language:language,email_heading:heading,email_summary:summary,confirmation_actions:html};
  };
  if (kind === 'card_jpeg' || kind === 'card_wallet') {
    if (ticket != null) throw new TypeError('Invalid commemorative email link.');
    return pack(cardActions({ card, en, walletReady, confirmationUrl }));
  }
  const confirmed = kind !== 'application_received';
  let entry = null, group = null, groupExpiry = null;
  if (ticket !== undefined && ticket !== null) {
    if (!SHORT.test(ticket.confirmationUrl ?? '') || ticket.confirmationUrl !== confirmationUrl) throw new TypeError('Invalid confirmation ticket.');
    const token = confirmationUrl.split('#')[1];
    for (const [key,type] of [['admissionQrImageUrl','entry'],['groupQrImageUrl','group']]) {
      const raw=ticket[key];if(raw===undefined||raw===null)continue;
      if(typeof raw!=='string')throw new TypeError('Invalid confirmation image.');
      const match=QR.exec(raw);if(!match||match[1]!==token||match[2]!==type)throw new TypeError('Invalid confirmation image.');
      if(type==='entry')entry=raw;else group=raw;
    }
    if(group && ticket.groupExpiresAt !== undefined && ticket.groupExpiresAt !== null){
      if(typeof ticket.groupExpiresAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(ticket.groupExpiresAt)||!Number.isFinite(Date.parse(ticket.groupExpiresAt)))throw new TypeError('Invalid group expiry.');
      groupExpiry = new Intl.DateTimeFormat(en?'en-GB':'zh-CN',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ticket.groupExpiresAt));
    }
  }
  const blocks=[];
  const action = en ? 'View your attendance details' : '查看参会信息';
  blocks.push('<p style="margin:20px 0;font-size:16px;line-height:1.7;"><a href="'+escape(confirmationUrl)+'" style="color:#6540df;">'+action+'</a></p>');
  if(confirmed && walletReady){
    const badge = SITE+'/wallet/add-to-apple-wallet-'+(en?'en':'cn')+'.png';
    blocks.push('<p style="margin:20px 0 8px;"><a href="'+escape(confirmationUrl)+'"><img src="'+badge+'" alt="'+(en?'Add to Apple Wallet':'添加到 Apple 钱包')+'" height="44" style="display:block;height:44px;width:auto;border:0;"></a></p><p style="margin:0 0 24px;font-size:14px;line-height:1.7;color:#52617a;">'+(en?'On iPhone, open your attendance page in Safari to add your pass.':'iPhone 请在 Safari 打开参会页，再添加至 Apple 钱包。')+'</p>');
  }
  if(confirmed && entry){
    blocks.push('<h2 style="margin:28px 0 12px;font-size:20px;">'+(en?'Admission QR code':'入场二维码')+'</h2><p style="margin:0 0 12px;"><img src="'+escape(entry)+'" alt="'+(en?'Show this code to event staff':'向工作人员出示此码')+'" width="240" height="240" style="display:block;width:240px;height:240px;max-width:100%;border:0;"></p><p style="margin:0;font-size:14px;line-height:1.7;color:#52617a;">'+(en?'Show this code to staff on arrival. Please keep it private.':'到场时请向工作人员出示此码，请勿转发。')+'</p>');
  }
  if(confirmed && group){
    blocks.push('<h2 style="margin:28px 0 12px;font-size:20px;">'+(en?'Join the event WeChat group':'加入活动微信群')+'</h2><p style="margin:0 0 12px;"><img src="'+escape(group)+'" alt="'+(en?'Event WeChat group QR code':'活动微信群二维码')+'" width="240" style="display:block;width:240px;height:auto;max-width:100%;border:0;"></p><p style="margin:0;font-size:14px;line-height:1.7;color:#52617a;">'+(groupExpiry?(en?'Valid until ':'有效至 ')+escape(groupExpiry)+(en?' (UTC+8). ':' (UTC+8)。 '):'')+(en?'If the code has expired or changed, open your attendance page for the current code.':'群码可能更新，失效时请打开参会页取得当前群码。')+'</p>');
  }
  return pack(blocks.join(''));
}
export function validConfirmationPresentationVariables(value){
  if(!value||typeof value!=='object'||CONFIRMATION_PRESENTATION_KEYS.some(key=>!Object.hasOwn(value,key)))return false;
  return line(value.email_subject)&&['zh-CN','en'].includes(value.email_language)
    &&line(value.email_heading)&&paragraph(value.email_summary)
    &&typeof value.confirmation_actions==='string'&&value.confirmation_actions.length<=16_000&&value.confirmation_actions.isWellFormed()
    &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.confirmation_actions);
}
