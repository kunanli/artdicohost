import { identityOptions } from './registration-schema.mjs';

export const GENERAL_APPLICATION_INTAKE = 'general-v2';
export const WALLET_APPLICATION_INTAKE = 'wallet-v1';
export const CARD_FORMATS = Object.freeze(['jpeg', 'wallet']);
export const CARD_COMMUNITY_FIELD_LENGTH = 36;
export const CARD_PROFILE_FIELD_LENGTHS = Object.freeze({ organization: 160, phone: 150 });
export function cardProfileFields(input) {
  if (!plain(input) || Object.keys(input).length !== 2) return null;
  const profile = {};
  for (const [key, limit] of Object.entries(CARD_PROFILE_FIELD_LENGTHS)) {
    const raw = own(input, key);
    if (typeof raw !== 'string' || raw.length > limit * 2 || !raw.isWellFormed()
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(raw)) return null;
    const value = raw.normalize('NFC').trim();
    if ([...value].length > limit) return null;
    profile[key] = value;
  }
  return profile;
}
export function cardCommunityFields(value) {
  if (!plain(value) || Object.keys(value).length !== 2) return null;
  const normalize = field => {
    if (typeof field !== 'string' || field.length > CARD_COMMUNITY_FIELD_LENGTH * 2 || !field.isWellFormed()
      || /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(field)) return null;
    const result = field.normalize('NFC').trim();
    return [...result].length <= CARD_COMMUNITY_FIELD_LENGTH ? result : null;
  };
  const site = normalize(own(value, 'site')), role = normalize(own(value, 'role'));
  return site === null || role === null ? null : { site, role };
}
export const cardCommunityLabel = community => community ? [community.site, community.role].filter(Boolean).join(' · ') : '';
const cardCommunityRoleTerms = role => role.split(/[・·、；;]/u).map(term => term.trim()).filter(Boolean);
export function cardJammerOption(role) {
  const terms = cardCommunityRoleTerms(role);
  const otherTerms = terms.filter(term => term.toLowerCase() !== 'jammer');
  const selected = otherTerms.length !== terms.length;
  const toggleValue = selected ? otherTerms.join(' · ') : [role.trim(), 'Jammer'].filter(Boolean).join(' · ');
  return { selected, toggleValue, canToggle: selected || toggleValue.length <= CARD_COMMUNITY_FIELD_LENGTH };
}
export const WALLET_IDENTITIES = Object.freeze([
  {value:'attendee',label:'一般来宾'},{value:'guest',label:'嘉宾'},{value:'speaker',label:'讲者'},
  {value:'exhibitor',label:'参展者'},{value:'organizer',label:'GGJ 组织者'},{value:'student',label:'学生'},
  {value:'staff',label:'工作人员'},{value:'volunteer',label:'志愿者'},
]);
const ENGLISH_CARD_IDENTITIES = new Map([
  ['一般来宾', 'Attendee'], ['嘉宾', 'Guest'], ['讲者', 'Speaker'], ['参展者', 'Exhibitor'],
  ['GGJ 组织者', 'GGJ Organizer'], ['学生', 'Student'], ['工作人员', 'Event Staff'], ['志愿者', 'Volunteer'],
]);
const GGJ_INVOLVEMENT_TERMS = [
  ['站点组织者', 'Site Organizer', '站點組織者'],
  ['区域组织者', 'Regional Organizer', '區域組織者'],
  ['组织者', 'Organizer', 'GGJ 组织者', 'GGJ 組織者', '組織者', 'GGJ Organizer'],
  ['Jammer', 'Jammer'],
  ['参与者', 'Participant', '參與者'],
  ['导师', 'Mentor', '導師'],
  ['志愿者', 'Volunteer', '志工', '志願者'],
  ['评审', 'Juror', '評審', '评委', '評委', 'Judge', 'Jury Member'],
  ['社群伙伴', 'Community Partner', '社群夥伴'],
  ['教育工作者', 'Educator', '教育'],
  ['活动运营', 'Event Operations', '活動營運', '活动支援', '活動支援'],
  ['无障碍倡导', 'Accessibility Advocate', '無障礙倡導'],
  ['程序', 'Programming', '程式', '程序开发', '程式開發', 'Programmer'],
  ['美术', 'Art', '美術', 'Artist'],
  ['游戏策划', 'Game Design', '策划', '策劃', '遊戲策劃', 'Game Designer'],
  ['制作人', 'Producer', '製作人'],
  ['音频', 'Audio', '音頻', 'Audio Design'],
  ['测试', 'QA', '測試', 'Testing'],
  ['叙事设计', 'Narrative Design', '敘事設計'],
];
const GGJ_INVOLVEMENT_LABELS = new Map(GGJ_INVOLVEMENT_TERMS.flatMap(([zh, en, ...aliases]) =>
  [zh, en, ...aliases].map(term => [term.toLowerCase(), { zh, en }])));

export function cardEventIdentityLabel(identity, locale = 'zh-CN') {
  return locale === 'en' ? ENGLISH_CARD_IDENTITIES.get(identity) ?? identity : identity;
}

export function cardIdentityHeadline(identity, community, locale = 'zh-CN') {
  const en = locale === 'en';
  const siteName = (community?.site ?? '').replace(/(?<![A-Za-z0-9])(?:GGJ|ARTDICO)(?![A-Za-z0-9])/gi, word => word.toUpperCase());
  const site = siteName && !/^GGJ(?:$|[^A-Za-z0-9])/u.test(siteName) ? 'GGJ ' + siteName : siteName;
  const organizer = identity === 'GGJ 组织者';
  const terms = cardCommunityRoleTerms(community?.role ?? '');
  const contributions = terms.map(term => {
    const known = GGJ_INVOLVEMENT_LABELS.get(term.toLowerCase());
    return known?.[en ? 'en' : 'zh'] ?? term;
  });
  const siteOrganizer = en ? 'Site Organizer' : '站点组织者';
  const regionalOrganizer = en ? 'Regional Organizer' : '区域组织者';
  const organizerLabel = en ? 'Organizer' : '组织者';
  const eventIdentity = cardEventIdentityLabel(identity, locale);
  if (organizer) {
    const role = contributions.find(contribution => contribution === siteOrganizer || contribution === regionalOrganizer)
      ?? (site ? organizerLabel : eventIdentity);
    const remaining = contributions.filter(contribution => contribution !== role && contribution !== organizerLabel);
    return { site, label: site, identity: [role, ...new Set(remaining)].join(' · ') };
  }
  if (contributions.length) {
    return { site, label: site || (en ? 'GGJ Involvement' : 'GGJ 参与经历'), identity: [...new Set(contributions)].join(' · ') };
  }
  const eventRole = identity === '学生' ? (en ? 'Student Attendee' : '学生参会者')
    : en ? (identity === '工作人员' ? eventIdentity : 'Event ' + eventIdentity)
      : '活动' + (identity === '一般来宾' ? '参与者' : eventIdentity);
  return { site, label: site, identity: site ? eventRole : eventIdentity };
}
export const WALLET_PREFERENCE_FIELDS = Object.freeze(['requestedWalletIdentity', 'ggjSite', 'ggjRole']);
export function walletApplicationPreferences(input) {
  if (!plain(input)) return null;
  const identity = own(input, 'requestedWalletIdentity');
  if (identity !== undefined && identity !== '' && !WALLET_IDENTITIES.some(option => option.value === identity)) return null;
  const community = cardCommunityFields({
    site: Object.hasOwn(input, 'ggjSite') ? own(input, 'ggjSite') : '',
    role: Object.hasOwn(input, 'ggjRole') ? own(input, 'ggjRole') : '',
  });
  if (!community) return null;
  return {
    ...(identity ? { requestedWalletIdentity: identity } : {}),
    ...(community.site ? { ggjSite: community.site } : {}),
    ...(community.role ? { ggjRole: community.role } : {}),
  };
}
export const commemorativeCardVenue = venue => venue === '深圳市前海合作区梦海大道5188号前海5号楼' ? '深圳市南山区前海5号楼' : venue;
export const isWalletApplicationFields = fields => own(fields,'intake')===WALLET_APPLICATION_INTAKE;

export const GENERAL_APPLICATION_FIELDS = Object.freeze(['intake','locale','name','email','categories','participationInterests','organization','city','wechat','phone','speaker']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const own = (value,key) => Object.getOwnPropertyDescriptor(value ?? {},key)?.value;
const safeObject = value => plain(value) && Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.getOwnPropertyDescriptor(value,key)?.enumerable&&'value' in Object.getOwnPropertyDescriptor(value,key));
const safeList = (value,max) => Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&value.length<=max&&Reflect.ownKeys(value).length===value.length+1&&Array.from({length:value.length},(_,index)=>Object.getOwnPropertyDescriptor(value,String(index))).every(property=>property?.enumerable&&'value' in property);
const formed = value => { for(const character of value){const code=character.codePointAt(0);if(code>=0xd800&&code<=0xdfff)return false;}return true; };
function string(source,key,max,errors,{required=false,min=0,multiline=false}={}){
  const raw=own(source,key);if(raw===undefined&&!required)return '';
  if(typeof raw!=='string'||raw.length>max*2||!formed(raw)||[...raw].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(raw)||!multiline&&/[\r\n\t]/u.test(raw)){errors[key]='请填写长度及格式有效的文字。';return '';}
  const value=raw.normalize('NFC').trim();if(required&&[...value].length<Math.max(1,min))errors[key]='请填写'+({name:'至少两字的姓名',email:'有效邮箱',topic:'分享主题',summary:'分享简介'}[key]||'必填项目')+'。';return value;
}
export const isSpeakerApplicationFields = fields => own(fields,'intake')===GENERAL_APPLICATION_INTAKE && safeList(own(fields,'participationInterests'),1) && own(fields,'participationInterests').length===1 && own(fields,'participationInterests')[0]==='talk';

/** New public intake stays sparse; unasked historic questions are never synthesized. */
export function validateGeneralApplicationFields(input){
  if(isWalletApplicationFields(input))return validateWalletApplicationFields(input);
  const errors={};if(!safeObject(input)||Reflect.ownKeys(input).some(key=>!GENERAL_APPLICATION_FIELDS.includes(key)))return{valid:false,errors:{fields:'申请字段无效，请使用当前简表。'},value:null};
  if(own(input,'intake')!==GENERAL_APPLICATION_INTAKE)errors.intake='申请版本无效。';
  const value={intake:GENERAL_APPLICATION_INTAKE,name:string(input,'name',80,errors,{required:true,min:2}),email:string(input,'email',254,errors,{required:true}),categories:[],participationInterests:[]};
  if(Object.hasOwn(input,'locale')){if(!['zh-CN','en'].includes(own(input,'locale')))errors.locale='请选择有效的报名语言。';else value.locale=own(input,'locale');}
  if(value.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value.email))errors.email='请填写有效邮箱。';
  const categories=own(input,'categories');if(!safeList(categories,1)||categories.length!==1||typeof categories[0]!=='string'||!identityOptions.some(option=>option.value===categories[0]))errors.categories='请选择一项参与身份。';else value.categories=[categories[0]];
  const interests=own(input,'participationInterests');const interestList=safeList(interests,2),proposal=isSpeakerApplicationFields(input)||interestList&&interests.length===2&&interests[0]==='attend'&&interests[1]==='talk';
  if(!interestList||!(interests.length===1&&interests[0]==='attend'||proposal))errors.participationInterests='请确认本次申请方式。';else value.participationInterests=[...interests];
  for(const [key,max]of[['organization',160],['city',100],['wechat',100],['phone',150]]){const field=string(input,key,max,errors);if(field)value[key]=field;}
  const speaker=own(input,'speaker');
  if(proposal){if(!safeObject(speaker)||Reflect.ownKeys(speaker).length!==2||!Object.hasOwn(speaker,'topic')||!Object.hasOwn(speaker,'summary'))errors.speaker='请填写分享主题和简介。';else{const branchErrors={};value.speaker={topic:string(speaker,'topic',200,branchErrors,{required:true}),summary:string(speaker,'summary',1500,branchErrors,{required:true,multiline:true})};for(const [key,message]of Object.entries(branchErrors))errors['speaker.'+key]=message;}}
  else if(Object.hasOwn(input,'speaker'))errors.speaker='未选择分享主题时，请勿提交隐藏的提案资料。';
  return{valid:Object.keys(errors).length===0,errors,value};
}

/** An unverified request for a commemorative pass, never external ticket proof. */
export function validateWalletApplicationFields(input){
  const keys=['intake','locale','name','email','wechat','phone','organization','huodongxingReference','categories','participationInterests',...WALLET_PREFERENCE_FIELDS];
  const errors={};
  if(!safeObject(input)||Reflect.ownKeys(input).some(key=>!keys.includes(key)))return{valid:false,errors:{fields:'纪念卡申请字段无效。'},value:null};
  const value={intake:WALLET_APPLICATION_INTAKE,name:string(input,'name',80,errors,{required:true,min:2}),email:string(input,'email',254,errors,{required:true}),wechat:string(input,'wechat',100,errors,{required:true}),huodongxingReference:string(input,'huodongxingReference',160,errors,{required:true}),categories:['other'],participationInterests:['attend']};
  if(own(input,'intake')!==WALLET_APPLICATION_INTAKE)errors.intake='申请版本无效。';
  if(value.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value.email))errors.email='请填写有效邮箱。';
  for(const[key,expected]of[['categories','other'],['participationInterests','attend']]){const list=own(input,key);if(!safeList(list,1)||list.length!==1||list[0]!==expected)errors[key]='纪念卡身份由工作人员确认。';}
  if(Object.hasOwn(input,'locale')){if(!['zh-CN','en'].includes(own(input,'locale')))errors.locale='请选择有效的申请语言。';else value.locale=own(input,'locale');}
  for(const[key,max]of[['phone',150],['organization',160]]){const text=string(input,key,max,errors);if(text)value[key]=text;}
  const preferences = walletApplicationPreferences(input);
  if (!preferences) errors.preferences = '请核对卡面身份与 GGJ 社群资料。';
  else Object.assign(value, preferences);
  return{valid:Object.keys(errors).length===0,errors,value};
}
