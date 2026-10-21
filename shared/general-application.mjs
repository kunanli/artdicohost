import { identityOptions } from './registration-schema.mjs';

export const GENERAL_APPLICATION_INTAKE = 'general-v2';
export const GENERAL_APPLICATION_FIELDS = Object.freeze(['intake','name','email','categories','participationInterests','organization','city','wechat','speaker']);
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
/** New public intake stays sparse; unasked historic questions are never synthesized. */
export function validateGeneralApplicationFields(input){
  const errors={};if(!safeObject(input)||Reflect.ownKeys(input).some(key=>!GENERAL_APPLICATION_FIELDS.includes(key)))return{valid:false,errors:{fields:'申请字段无效，请使用当前简表。'},value:null};
  if(own(input,'intake')!==GENERAL_APPLICATION_INTAKE)errors.intake='申请版本无效。';
  const value={intake:GENERAL_APPLICATION_INTAKE,name:string(input,'name',80,errors,{required:true,min:2}),email:string(input,'email',254,errors,{required:true}),categories:[],participationInterests:[]};
  if(value.email&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value.email))errors.email='请填写有效邮箱。';
  const categories=own(input,'categories');if(!safeList(categories,1)||categories.length!==1||typeof categories[0]!=='string'||!identityOptions.some(option=>option.value===categories[0]))errors.categories='请选择一项参与身份。';else value.categories=[categories[0]];
  const interests=own(input,'participationInterests');const interestList=safeList(interests,2),proposal=interestList&&interests.length===2&&interests[0]==='attend'&&interests[1]==='talk';
  if(!interestList||!(interests.length===1&&interests[0]==='attend'||proposal))errors.participationInterests='请确认本次参会申请。';else value.participationInterests=[...interests];
  for(const [key,max]of[['organization',160],['city',100],['wechat',100]]){const field=string(input,key,max,errors);if(field)value[key]=field;}
  const speaker=own(input,'speaker');
  if(proposal){if(!safeObject(speaker)||Reflect.ownKeys(speaker).length!==2||!Object.hasOwn(speaker,'topic')||!Object.hasOwn(speaker,'summary'))errors.speaker='请填写分享主题和简介。';else{const branchErrors={};value.speaker={topic:string(speaker,'topic',200,branchErrors,{required:true}),summary:string(speaker,'summary',1500,branchErrors,{required:true,multiline:true})};for(const [key,message]of Object.entries(branchErrors))errors['speaker.'+key]=message;}}
  else if(Object.hasOwn(input,'speaker'))errors.speaker='未选择分享主题时，请勿提交隐藏的提案资料。';
  return{valid:Object.keys(errors).length===0,errors,value};
}
