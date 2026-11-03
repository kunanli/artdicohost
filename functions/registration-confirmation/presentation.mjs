/** The only raw HTML sent to EmailJS is this fixed, server-rendered actions
 * fragment. Participant and event text stays in escaped invitation_text. */
const SITE = 'https://artdico.host';
const SHORT = /^https:\/\/artdico\.host\/r\/#[A-Za-z0-9_-]{22}$/u;
const LEGACY = /^https:\/\/artdico\.host\/registration\/confirmation\/#r=[A-Za-z0-9_.-]{1,4096}$/u;
const QR = /^https:\/\/api\.artdico\.host\/api\/admin\/registration\/entry-links\/([A-Za-z0-9_-]{22})\/(entry|group)\.png$/u;
const escape = value => value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll("'",'&#39;');
const line = value => typeof value === 'string' && value.length > 0 && value.length <= 500 && !/[\u0000-\u001f\u007f]/u.test(value);
export const CONFIRMATION_PRESENTATION_KEYS = Object.freeze(['email_subject','email_language','confirmation_actions']);
export function confirmationEmailPresentation({ locale, kind, subject, confirmationUrl, ticket, walletReady = false } = {}) {
  if (!line(subject) || !['registration','promotion','application_received','pre_event_reminder'].includes(kind)
    || typeof confirmationUrl !== 'string' || !(SHORT.test(confirmationUrl) || LEGACY.test(confirmationUrl))) throw new TypeError('Invalid confirmation presentation.');
  const language = locale === 'en' ? 'en' : 'zh-CN', en = language === 'en';
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
  blocks.push('<p style="margin:20px 0;font-size:16px;line-height:1.7;"><a href="'+escape(confirmationUrl)+'" style="color:#6540df;">'+(en?'View your attendance details':'查看参会信息')+'</a></p>');
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
  const html=blocks.join('');if(Buffer.byteLength(html)>16_000)throw new TypeError('Confirmation presentation too large.');
  return {email_subject:subject,email_language:language,confirmation_actions:html};
}
export function validConfirmationPresentationVariables(value){
  if(!value||typeof value!=='object'||CONFIRMATION_PRESENTATION_KEYS.some(key=>!Object.hasOwn(value,key)))return false;
  return line(value.email_subject)&&['zh-CN','en'].includes(value.email_language)
    &&typeof value.confirmation_actions==='string'&&value.confirmation_actions.length<=16_000&&value.confirmation_actions.isWellFormed()
    &&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.confirmation_actions);
}
