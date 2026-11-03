import {resolvePeopleView} from './admin-sections.mjs';
import { PEOPLE_WORK_FILTERS, PEOPLE_HEALTH_KINDS, PEOPLE_ATTENDANCE_FILTERS, personAttendanceStage, validPersonAttendanceStage } from '../../shared/organizer-progress.mjs';
import {eventConfig} from '../config/event.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u,REG=/^[A-Za-z0-9_-]{43}$/u;
const string=(value,max=300)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=6400;
const optional=(value,pattern)=>value===null||typeof value==='string'&&pattern.test(value);
const roles=['guest','speaker','panelist','host','organizer','exhibitor','student_showcase','attendee','moderator'];
const admissions=['confirmed','waitlisted','withdrawn','pending_review','rejected'];
const sourceRevision = value => value === null || Number.isSafeInteger(value) && value >= 0;
const revisionKeys = ['contacts','registration','applications','admissions','invitations','content','publishedContent'];
function validRevisions(value) { return value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => [...revisionKeys, 'delivery'].includes(key)) && revisionKeys.every(key => sourceRevision(value[key]))
  && (!Object.hasOwn(value, 'delivery') || sourceRevision(value.delivery)); }
function safeStaffHref(value) {
  if (!string(value, 400) || !/^\/admin\/(?:person|contacts|registrations|content\/(?:guests|showcases|event))\/(?:#(?:contact=[A-Za-z0-9][A-Za-z0-9_-]{0,79}|registration=[A-Za-z0-9_-]{43}|guest=[A-Za-z0-9][A-Za-z0-9_-]{0,79}|showcase=[A-Za-z0-9][A-Za-z0-9_-]{0,79}|people=all))?$/u.test(value)) return false;
  return true;
}
function validNextAction(value) { return value && ['check','source','reply','integration','duplicate','review','notification','publication','arrangement','details','handoff'].includes(value.key)
  && ['navigate','handoff','refresh'].includes(value.kind) && string(value.label, 80) && value.label && string(value.reason, 300) && safeStaffHref(value.href); }
export function validatePeopleHealth(value) {
  if (!value || value.schemaVersion !== 1 || !value.availability || !['contacts','registrations','invitations','admissions','content'].every(key => ['available','unavailable','restricted'].includes(value.availability[key]))
    || !validRevisions(value.revisions) || !value.counts || !PEOPLE_HEALTH_KINDS.every(key => value.counts[key] === null || Number.isSafeInteger(value.counts[key]) && value.counts[key] >= 0)
    || !(value.total === null || Number.isSafeInteger(value.total) && value.total >= 0) || typeof value.truncated !== 'boolean' || !Array.isArray(value.issues) || value.issues.length > 200) return false;
  const seen = new Set();
  for (const item of value.issues) {
    if (!item || !string(item.id, 400) || !item.id || seen.has(item.id) || !PEOPLE_HEALTH_KINDS.includes(item.kind) || !string(item.label, 300)
      || !string(item.reason, 300) || !string(item.reasonCode, 80) || !safeStaffHref(item.href) || !validRevisions(item.sourceRevisions)
      || !(item.personKey === null || typeof item.personKey === 'string' && /^(?:contact:[A-Za-z0-9][A-Za-z0-9_-]{0,79}|registration:[A-Za-z0-9_-]{43})$/u.test(item.personKey))) return false;
    seen.add(item.id);
  }
  return true;
}
export function validatePeopleDirectory(value,view){
  if(!value||value.schemaVersion!==1||value.view!==view||!['all','exhibitors','speakers','guests','unassigned','attendees'].includes(view)
    ||value.work!==undefined&&!PEOPLE_WORK_FILTERS.includes(value.work)||value.attendance!==undefined&&!PEOPLE_ATTENDANCE_FILTERS.includes(value.attendance)||typeof value.permissions?.contacts!=='boolean'||typeof value.permissions?.registrations!=='boolean'
    ||!value.summary||!['people','confirmed','pendingReview','exhibitors','speakers','guests','unassigned','attendees','pendingIntegration'].every(key=>value.summary[key]===null||count(value.summary[key]))
    ||!count(value.total)||value.rows?.length>value.total||!/^[a-f0-9]{64}$/u.test(value.revision??'')||!Array.isArray(value.rows)||value.rows.length>100
    ||!(value.nextCursor===null||typeof value.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,512}$/u.test(value.nextCursor)))return false;
  const seen=new Set();
  for(const row of value.rows){
    if(!row||row.recordedAt!==undefined&&row.recordedAt!==null&&!(typeof row.recordedAt==='string'&&Number.isFinite(Date.parse(row.recordedAt))&&new Date(row.recordedAt).toISOString()===row.recordedAt)||!string(row.key,160)||seen.has(row.key)||!string(row.name)||!row.name||!string(row.organization))return false;seen.add(row.key);
    if(row.kind==='person'){
      if(Object.hasOwn(row,'attendance')&&!validPersonAttendanceStage(row.attendance))return false;
      if(Object.hasOwn(row,'deliveryHistoryUnknown')&&row.deliveryHistoryUnknown!==true)return false;
      if (['stateLabel','workKinds','nextAction','basisRevisions'].some(key => Object.hasOwn(row,key)) && (!string(row.stateLabel, 80) || !Array.isArray(row.workKinds)
        || row.workKinds.some(kind => !PEOPLE_WORK_FILTERS.includes(kind) || kind === 'all') || new Set(row.workKinds).size !== row.workKinds.length || !validNextAction(row.nextAction) || !validRevisions(row.basisRevisions))) return false;
      if(view==='exhibitors'||!optional(row.contactId,ID)||!optional(row.registrationId,REG)||!optional(row.profileId,ID)
        ||!row.contactId&&!row.registrationId&&!row.profileId||!string(row.city,160)||!string(row.owner,120)||!string(row.followUpAt,10)
        ||!['linked','contact','public','staff_assisted','staff_entry','profile'].includes(row.source)
        ||!['available','restricted','unlinked'].includes(row.registrationState)
        ||!(row.admissionStatus===null||admissions.includes(row.admissionStatus))
        ||!(row.responseStatus===null||['pending','attending','declined'].includes(row.responseStatus))
        ||!['prepared','issuing','provider_accepted','unknown','rejected','manually_sent','not_started','not_applicable'].includes(row.invitationStatus)
        ||!['provider_accepted','unknown','rejected','restricted','unavailable','not_sent','not_applicable'].includes(row.deliveryStatus)
        ||!Array.isArray(row.roles)||row.roles.length>roles.length||row.roles.some(role=>!roles.includes(role))||new Set(row.roles).size!==row.roles.length)return false;
      const key=row.contactId?'contact:'+row.contactId:row.registrationId?'registration:'+row.registrationId:'profile:'+row.profileId;
      if(row.personKey!==undefined&&!/^(?:contact:[A-Za-z0-9][A-Za-z0-9_-]{0,79}|registration:[A-Za-z0-9_-]{43})$/u.test(row.personKey)||row.sourceCount!==undefined&&(!Number.isSafeInteger(row.sourceCount)||row.sourceCount<1||row.sourceCount>200))return false;
      if(row.key!==key||!value.permissions.contacts&&(row.contactId||row.profileId||row.roles.length)||!value.permissions.registrations&&row.admissionStatus!==null)return false;
      if(view==='speakers'&&!row.roles.includes('speaker')||view==='guests'&&!row.roles.some(role=>['guest','panelist'].includes(role)))return false;
    }else{
      if(view!=='exhibitors'||!value.permissions.contacts||!['organization','unlinked_booth'].includes(row.kind)||!optional(row.organizationId,ID)
        ||row.kind==='organization'&&(!row.organizationId||row.key!=='organization:'+row.organizationId)||row.kind==='unlinked_booth'&&(row.organizationId!==null||row.booths?.length!==1||row.key!=='booth:'+row.booths[0]?.id)||!['pending','confirmed','withdrawn','unlinked'].includes(row.status)
        ||!Array.isArray(row.members)||row.members.length>20||!count(row.memberTotal)||row.memberTotal<row.members.length
        ||row.members.some(item=>!ID.test(item.id??'')||!string(item.name,120)||!['lead','member'].includes(item.role))
        ||!Array.isArray(row.booths)||row.booths.length>200||row.booths.some(item=>!ID.test(item.id??'')||!string(item.code,80)||!string(item.zone,10)||!['pending','confirmed','cancelled'].includes(item.status)))return false;
    }
  }
  return true;
}
import {ownerTagPresentation} from './people-relationships.mjs';
const ROLE_LABELS={guest:'受邀嘉宾',speaker:'讲者',panelist:'圆桌嘉宾',host:'主持',organizer:'组织者',exhibitor:'参展',student_showcase:'作品展示',attendee:'一般参会者',moderator:'主持'};
const ADMISSION_LABELS={confirmed:'名额已确认',pending_review:'待审核',waitlisted:'候补',rejected:'审核不通过',withdrawn:'已撤回'};
const EMAIL_LABELS={provider_accepted:'确认信：邮件服务已接收',unknown:'确认信：结果待核对',rejected:'确认信：未发出',not_sent:'确认信：尚未寄送',unavailable:'确认信状态待核对',restricted:'',not_applicable:''};
const SOURCE_LABELS={linked:'邀约与报名已关联',contact:'邀约名单',public:'本人公开申请',staff_assisted:'工作人员代登记',staff_entry:'工作人员登记',profile:'人物资料，尚未关联人员'};
const INVITATION_LABELS={not_started:'尚未准备邀请',prepared:'邀请已准备',issuing:'寄送结果待核对',provider_accepted:'邀请：邮件服务已接收',unknown:'邀请结果待核对',rejected:'邀请未发出',manually_sent:'已记录人工发出',not_applicable:''};
const VIEWS={unassigned:['待分流','核对身份后继续处理。'],attendees:['一般参会者','参会名额与本人回复分别核对。'],all:['人员','先处理需要跟进的人。'],speakers:['讲者','按已保存的讲者职责显示。'],guests:['受邀嘉宾','出席与名额分别核对。'],exhibitors:['参展商','按公司／团队核对安排。']};
const RESPONSE_LABELS={pending:'待回复',attending:'已答应出席',declined:'不出席'};

const NAV_KEY='artdico:people-navigation:v1',NAV_TTL=30*60*1000;
const NAV_FIELDS=['schemaVersion','actorId','roles','eventId','view','query','work','attendance','cursor','trail','revision','ids','selected','focus','scrollY','capturedAt'];
export const peopleSelectionKey=item=>item?.contactId?'contact:'+item.contactId:item?.registrationId?'registration:'+item.registrationId:null;
const selectionKey=value=>typeof value==='string'&&/^(?:contact:[A-Za-z0-9][A-Za-z0-9_-]{0,79}|registration:[A-Za-z0-9_-]{43})$/u.test(value);
export function peopleSelectionHref(key){if(!selectionKey(key))return null;const cut=key.indexOf(':');return '/admin/person/#'+key.slice(0,cut)+'='+encodeURIComponent(key.slice(cut+1));}
export function peopleReturnHref(view){return view==='registrations'?'/admin/registrations/':view==='all'?'/admin/contacts/':['exhibitors','speakers','guests','unassigned','attendees'].includes(view)?'/admin/contacts/#people='+view:null;}
export function peopleNextSelection(original,current,fresh){
  const index=fresh.indexOf(current);if(index>=0)return fresh[index+1]??null;
  const anchor=original.indexOf(current);if(anchor<0)return null;
  return original.slice(anchor+1).find(key=>fresh.includes(key))??null;
}
export function validPeopleNavigation(value,user,{eventId=eventConfig.id,view,selection,now=Date.now()}={}){
  if(!value||Object.keys(value).length!==NAV_FIELDS.length-(Object.hasOwn(value,'attendance')?0:1)||Object.keys(value).some(key=>!NAV_FIELDS.includes(key))||Object.hasOwn(value,'attendance')&&!PEOPLE_ATTENDANCE_FILTERS.includes(value.attendance)||value.schemaVersion!==1||!user?.id||value.actorId!==user.id||value.eventId!==eventId||!Array.isArray(value.roles)||JSON.stringify(value.roles)!==JSON.stringify([...(user.roles??[])].sort())||!peopleReturnHref(value.view)||view&&value.view!==view)return false;
  if(!string(value.query,160)||/https?:\/\/|#r=|\b(?:c1|v1)\.[A-Za-z0-9_.-]{20,}/iu.test(value.query)||!PEOPLE_WORK_FILTERS.includes(value.work)||!string(value.cursor,512)||value.cursor&&!/^[A-Za-z0-9_-]+$/u.test(value.cursor)||!Array.isArray(value.trail)||value.trail.length>20||value.trail.some(cursor=>!string(cursor,512)||cursor&&!/^[A-Za-z0-9_-]+$/u.test(cursor))||!/^[a-f0-9]{64}$/u.test(value.revision))return false;
  return Boolean(Array.isArray(value.ids)&&value.ids.length>0&&value.ids.length<=50&&new Set(value.ids).size===value.ids.length&&value.ids.every(selectionKey)&&value.ids.includes(value.selected)&&selectionKey(value.focus)&&value.focus===value.selected&&(!selection||selection===value.selected)&&Number.isSafeInteger(value.scrollY)&&value.scrollY>=0&&value.scrollY<=2000000&&Number.isSafeInteger(value.capturedAt)&&value.capturedAt<=now+5000&&now-value.capturedAt<=NAV_TTL&&JSON.stringify(value).length<=16384);
}
/** Sensitive queries live only in this tab's session storage, never an href or
 * the durable mutation store. Stored IDs are hints; rows are always reread. */
export function createPeopleNavigation({storage,eventId=eventConfig.id,clock=Date.now}={}){
  const target=()=>{try{return storage??globalThis.sessionStorage;}catch{return null;}};
  function clear(){try{target()?.removeItem(NAV_KEY);}catch{}}
  function read(user,options={}){try{const raw=target()?.getItem(NAV_KEY);if(!raw)return null;if(raw.length>16384)throw Error();const value=JSON.parse(raw);if(!validPeopleNavigation(value,user,{...options,eventId,now:clock()}))throw Error();return value;}catch{clear();return null;}}
  function save(user,input){const value={schemaVersion:1,actorId:user?.id,roles:[...(user?.roles??[])].sort(),eventId,...input,capturedAt:clock()};if(!validPeopleNavigation(value,user,{eventId,now:clock()}))return false;try{const store=target();if(!store)return false;store.setItem(NAV_KEY,JSON.stringify(value));return true;}catch{return false;}}
  return{read,save,clear};
}

export function createPeopleDirectory({root,request,getUser,onContact,onProfile,onInvitation,canInvite=()=>false,onFallback=()=>{},onResolve=()=>{},canResolve=()=>false}){
  const $=selector=>root.querySelector(selector),node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  let sequence=0,healthSequence=0,state=null,busy=false,healthBusy=false,blocked=false,currentCursor='',trail=[],resetting=false,restoreAttempted=false;
  const navigation=createPeopleNavigation();
  const view=()=>resolvePeopleView(location.pathname,location.hash),active=()=>Boolean(getUser()?.id);
  const actorKey=()=>{const user=getUser();return user?.id+'|'+[...(user?.roles??[])].sort().join(',');};
  const work=()=>view()==='exhibitors'?'all':$('[name=work]')?.value||'all';
  const attendance=()=>view()==='exhibitors'?'all':$('[name=attendance]')?.value||'all';
  const healthAllowed=()=>active()&&canResolve();
  function link(text,href,cls){const a=node('a',text,cls);a.href=href;return a;}
  function badge(text,status){const p=node('div',text,'people-directory-state');p.dataset.state=status;return p;}
  function lock(value=blocked){blocked=value;for(const control of root.querySelectorAll('button,input,select'))control.disabled=busy||blocked||!active()||healthBusy&&control.hasAttribute('data-directory-health-refresh');for(const action of root.querySelectorAll('[data-directory-primary]'))action.setAttribute('aria-disabled',String(busy||blocked||!active()));$('[data-directory-health]').hidden=!healthAllowed();}
  function remember(key){
    if(!state||!key)return;const ids=state.rows.filter(item=>item.kind==='person').map(peopleSelectionKey).filter(Boolean).slice(0,50);
    if(!ids.includes(key)){ids.length=0;ids.push(key);}
    navigation.save(getUser(),{view:view(),query:$('[name=query]').value,work:work(),attendance:attendance(),cursor:currentCursor,trail:[...trail].slice(-20),revision:state.revision,ids,selected:key,focus:key,scrollY:Math.max(0,Math.round(window.scrollY))});
  }
  function personHref(item){return peopleSelectionHref(peopleSelectionKey(item));}
  function fallbackState(item){
    if(['unknown','issuing'].includes(item.invitationStatus)||['unknown','unavailable'].includes(item.deliveryStatus))return '结果待核对';
    if(item.responseStatus==='declined'&&item.admissionStatus==='confirmed')return '名额待核对';
    return ADMISSION_LABELS[item.admissionStatus]||RESPONSE_LABELS[item.responseStatus]||'待核对';
  }
  function personRow(item){
    const row=node('tr');row.dataset.directoryPerson=item.personKey??item.key;
    const identity=node('td'),status=node('td'),actions=node('td');
    identity.append(node('div',item.name,'people-directory-name'),node('small',item.organization||'机构未填写'));
    const recorded=node('time',item.recordedAt?'录入：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(new Date(item.recordedAt)):'录入时间未记录','people-recorded-at');if(item.recordedAt)recorded.dateTime=item.recordedAt;identity.append(recorded);
    if(item.contactId||item.owner){const owner=ownerTagPresentation(item.owner),tag=node('span',owner.label,'ah-owner-tag');tag.dataset.ownerTone=owner.tone;identity.append(tag);}
    const next=item.nextAction;
    const progress=item.attendance??personAttendanceStage({responseStatus:item.responseStatus,admissionStatus:item.admissionStatus,deliveryStatus:item.deliveryStatus,invitationStatus:item.invitationStatus,historicalDeliveryUnknown:item.deliveryHistoryUnknown===true});
    const primaryStatus=badge(progress.label,progress.key);primaryStatus.dataset.directoryAttendanceStage=progress.key;status.append(primaryStatus);
    if(progress.invitationLabel)status.append(node('small',progress.invitationLabel,'people-directory-invitation'));
    const warning=progress.warning||(next?.reason&&(next.kind==='handoff'||next.kind==='refresh'||item.workKinds?.includes('unavailable'))?next.reason:'');
    if(warning)status.append(node('small',warning,'people-directory-warning'));
    const href=personHref(item);
    if(href){const primary=link(next?.kind==='handoff'?'查看转交方式':next?.label||'查看下一步',href,'people-directory-action');primary.dataset.directoryPrimary='';primary.addEventListener('click',event=>{if(blocked||busy||!active())event.preventDefault();else remember(peopleSelectionKey(item));});actions.append(primary);}
    else if(item.profileId&&getUser()?.roles?.some(role=>['editor','superadmin'].includes(role)))actions.append(link('核对人物资料','/admin/content/guests/#guest='+encodeURIComponent(item.profileId),'people-directory-action'));
    else actions.append(node('small','交由活动编辑核对'));
    const menu=node('details',undefined,'people-row-menu');menu.append(node('summary','更多'));const options=node('div');
    if(item.sourceCount>1)options.append(node('small','已关联 '+item.sourceCount+' 项来源'));
    if(SOURCE_LABELS[item.source])options.append(node('small',SOURCE_LABELS[item.source]));
    if(item.roles.length)options.append(node('small',item.roles.map(role=>ROLE_LABELS[role]).join(' / ')));
    if(item.responseStatus)options.append(node('small','回复：'+RESPONSE_LABELS[item.responseStatus]));
    if(item.admissionStatus)options.append(node('small','名额：'+ADMISSION_LABELS[item.admissionStatus]));
    if(EMAIL_LABELS[item.deliveryStatus])options.append(node('small',EMAIL_LABELS[item.deliveryStatus]));
    if(INVITATION_LABELS[item.invitationStatus])options.append(node('small',INVITATION_LABELS[item.invitationStatus]));
    if(item.followUpAt)options.append(node('small','跟进日期：'+item.followUpAt));
    const action=(label,callback)=>{const button=node('button',label);button.type='button';button.addEventListener('click',()=>{if(!blocked&&!busy&&active())callback();});options.append(button);};
    if(canResolve()&&(item.contactId||item.registrationId))action('身份／报名',()=>onResolve(item.personKey??item.key));
    if(item.contactId){
      action('联络与安排',()=>onContact(item.contactId));
      if(onProfile)action('编辑基本资料',()=>onProfile(item.contactId));
      if(onInvitation&&canInvite(item.contactId))action('准备邀请函',()=>onInvitation(item.contactId));
    }
    if(item.registrationId&&state.permissions.registrations)options.append(link('报名与票券','/admin/registrations/#registration='+encodeURIComponent(item.registrationId)));
    if(getUser()?.roles?.includes('superadmin')&&(item.registrationId||item.contactId))action('删除',()=>void deletePerson(item));
    menu.append(options);actions.append(menu);row.append(identity,status,actions);return row;
  }
  async function deletePerson(item){
    if(!active()||busy||blocked||!getUser()?.roles?.includes('superadmin'))return;
    const registration=Boolean(item.registrationId),id=registration?item.registrationId:item.contactId;
    if(!id||!confirm(registration?'删除此报名并释放名额？入场券和私人参会页将停用，候补可能转正并收到确认信；原始资料与历史保留。':'从人员名单删除此联系人？原始资料与历史保留；已有报名和入场券不会被取消。'))return;
    const generation=++sequence,actor=actorKey(),current=()=>generation===sequence&&actorKey()===actor&&active();
    busy=true;lock();let started=false;
    const check=async()=>{
      if(registration){const value=await request('/api/admin/registrations/'+encodeURIComponent(id),{current});if(value.registration?.id!==id||!value.review||!Object.hasOwn(value.review,'deletionRequested'))throw Error('Invalid deletion source');return{revision:value.revision,deleted:Boolean(value.review.deletionRequested)};}
      const value=await request('/api/admin/contacts',{current}),contact=value.contacts?.find(row=>row.id===id);if(!contact||contact.archivedAt!==undefined&&!(typeof contact.archivedAt==='string'&&Number.isFinite(Date.parse(contact.archivedAt))&&new Date(contact.archivedAt).toISOString()===contact.archivedAt))throw Error('Missing contact');return{revision:value.revision,deleted:Boolean(contact.archivedAt)};
    };
    try{
      const before=await check();if(!current())return;
      if(!Number.isSafeInteger(before.revision)||before.revision<0)throw Error('Invalid deletion source');
      if(!before.deleted){started=true;await request(registration?'/api/admin/registrations/'+encodeURIComponent(id)+'/deletion-request':'/api/admin/contacts/'+encodeURIComponent(id)+'/archive',{method:'POST',body:JSON.stringify(registration?{expectedRevision:before.revision,reason:'other'}:{expectedRevision:before.revision,archived:true}),current});}
      if(!current())return;const after=await check();if(!after.deleted)throw Error('Deletion not verified');
      busy=false;await load();if(active()&&actorKey()===actor)$('[data-directory-status]').textContent=registration?'已删除报名，历史保留。':'已从名单删除，历史保留。';
    }catch{
      if(!current())return;
      if(started){try{const after=await check();if(current()&&after.deleted){busy=false;await load();$('[data-directory-status]').textContent='已核对删除结果，历史保留。';return;}}catch{}}
      if(!current())return;$('[data-directory-error]').replaceChildren(node('span',started?'删除结果待核对。':'删除未完成，请重新核对。'));
      if(started){const verify=node('button','核对删除结果');verify.type='button';verify.addEventListener('click',async()=>{if(busy||blocked||!active()||actorKey()!==actor)return;busy=true;lock();try{const after=await check();if(!current())return;if(after.deleted){busy=false;await load();$('[data-directory-status]').textContent='已核对删除结果，历史保留。';}else{$('[data-directory-error]').textContent='已核对，未删除。请刷新名单后重新操作。';}}catch{$('[data-directory-error]').textContent='结果仍无法核对，请稍后刷新名单。';}finally{busy=false;lock();}});$('[data-directory-error]').append(verify);}
      $('[data-directory-error]').hidden=false;
    }finally{if(current()){busy=false;lock();}}
  }
  function companyRow(item){const row=node('tr'),identity=node('td'),members=node('td',undefined,'people-directory-members'),booths=node('td'),actions=node('td');
    identity.append(node('div',item.name,'people-directory-name'),node('small',item.kind==='unlinked_booth'?'组织关系待关联':'参展组织／团队'));
    for(const member of item.members){const anchor=link(member.name+(member.role==='lead'?' · 联络人':''),'/admin/person/#contact='+encodeURIComponent(member.id));anchor.addEventListener('click',()=>remember('contact:'+member.id));members.append(anchor);}
    if(!item.members.length)members.append(node('small','联络人待关联'));if(item.memberTotal>item.members.length)members.append(node('small','另有 '+(item.memberTotal-item.members.length)+' 位成员'));
    booths.append(badge(({confirmed:'参展已确认',pending:'参展待确认',withdrawn:'已退出',unlinked:'关系待关联'})[item.status],item.status));
    for(const booth of item.booths)booths.append(node('small',booth.code+' · '+booth.zone+'区'+(booth.status==='cancelled'?'（已取消）':'')));if(!item.booths.length)booths.append(node('small','展位待安排'));
    if(!getUser()?.roles?.some(role=>['editor','superadmin'].includes(role)))actions.append(item.organizationId?link('查看关联人员','/admin/contacts/#organization='+encodeURIComponent(item.organizationId),'people-directory-action'):node('small','交由活动编辑关联'));
    else actions.append(item.organizationId?link('参展资料','/admin/content/organizations/#organization='+encodeURIComponent(item.organizationId),'people-directory-action'):link('关联展位组织','/admin/content/booths/#booth='+encodeURIComponent(item.booths[0].id),'people-directory-action'));
    row.append(identity,members,booths,actions);return row;
  }
  function clearRows(){
    state=null;for(const selector of ['[data-directory-rows]','[data-directory-head]','[data-directory-metrics]'])$(selector).replaceChildren();
    $('[data-directory-empty]').hidden=true;$('[data-directory-next]').hidden=true;$('[data-directory-prev]').hidden=true;
    for(const badge of document.querySelectorAll('[data-people-count]'))badge.textContent='';
  }
  function render(){
    const selected=view(),labels=VIEWS[selected]??VIEWS.all;$('[data-directory-title]').textContent=labels[0];$('[data-directory-description]').textContent=labels[1];
    root.dataset.directoryKind=selected==='exhibitors'?'companies':'people';$('[data-directory-work]').closest('div').hidden=selected==='exhibitors';
    if($('[data-directory-attendance]'))$('[data-directory-attendance]').closest('div').hidden=selected==='exhibitors';
    if($('[data-directory-advanced]'))$('[data-directory-advanced]').hidden=selected==='exhibitors';
    const metrics=$('[data-directory-metrics]');metrics.replaceChildren();for(const[label,key]of[['人员','people'],['名额已确认','confirmed'],['待审核','pendingReview'],['待整合','pendingIntegration']]){const card=node('article');card.append(node('span',label),node('strong',state.summary[key]===null||state.summary[key]===undefined?'—':String(state.summary[key])));metrics.append(card);}
    for(const link of document.querySelectorAll('[data-people-view]')){if(['exhibitors','speakers','guests','unassigned','attendees'].includes(link.dataset.peopleView))link.hidden=!state.permissions.contacts;const output=link.querySelector('[data-people-count]');const key=({all:'people',registrations:'pendingReview',exhibitors:'exhibitors',speakers:'speakers',guests:'guests',unassigned:'unassigned',attendees:'attendees'})[link.dataset.peopleView];if(output)output.textContent=state.summary[key]===null||state.summary[key]===undefined?'':link.dataset.peopleView==='registrations'?state.summary[key]+' 待审':String(state.summary[key]);}
    const head=$('[data-directory-head]');head.replaceChildren();const tr=node('tr');for(const label of selected==='exhibitors'?['公司／团队','联络人／成员','展位与状态','操作']:['姓名／机构','当前状态','下一步'])tr.append(node('th',label));head.append(tr);
    $('[data-directory-rows]').replaceChildren(...state.rows.map(item=>item.kind==='person'?personRow(item):companyRow(item)));
    $('[data-directory-empty]').hidden=state.rows.length>0;
    $('[data-directory-empty]').textContent=work()==='pending'?'当前筛选没有待处理人员。':selected==='exhibitors'?'暂无符合条件的参展商。':'暂无符合条件的人员。';
    $('[data-directory-status]').textContent='本页 '+state.rows.length+' 条 · 符合筛选 '+state.total+' 条';$('[data-directory-next]').hidden=!state.nextCursor;$('[data-directory-prev]').hidden=!trail.length;lock();
  }
  async function load(cursor='',history=[]){
    let restoring=null;
    if(!restoreAttempted&&active()){
      restoreAttempted=true;restoring=navigation.read(getUser(),{view:view()});
      if(restoring){$('[name=query]').value=restoring.query;$('[name=work]').value=restoring.work;if($('[name=attendance]'))$('[name=attendance]').value=restoring.attendance??'all';if(restoring.work!=='all'&&$('[data-directory-advanced]'))$('[data-directory-advanced]').open=true;cursor=restoring.cursor;history=[...restoring.trail];}
    }
    if(!active())return clear();const generation=++sequence,actor=actorKey(),selected=view()==='registrations'?'all':view(),query=$('[name=query]').value,selectedWork=work(),selectedAttendance=attendance();
    const current=()=>generation===sequence&&actorKey()===actor&&active();
    const filterFocus=$('[data-directory-search]')?.contains?.(document.activeElement)?document.activeElement:null;
    busy=true;$('[data-directory-error]').hidden=true;root.setAttribute('aria-busy','true');lock();
    try{let stale=false;const read=position=>request('/api/admin/people/directory?'+new URLSearchParams({view:selected,work:selectedWork,attendance:selectedAttendance,limit:'50',...(query?{query}:{}),...(position?{cursor:position}:{})}),{current});let value;
      try{value=await read(cursor);}catch(error){if(error.status!==409||!cursor)throw error;if(!current())return;cursor='';history=[];stale=true;value=await read('');}
      if(!current())return;if(!validatePeopleDirectory(value,selected)||value.work!==undefined&&value.work!==selectedWork||value.attendance!==undefined&&value.attendance!==selectedAttendance)throw new Error('Invalid directory response.');state=value;currentCursor=cursor;trail=history;render();
      if(restoring){
        stale=stale||restoring.revision!==value.revision;
        const target=!stale?[...root.querySelectorAll('[data-directory-person]')].find(row=>row.dataset.directoryPerson===restoring.focus)?.querySelector('[data-directory-primary]'):null;
        const heading=$('[data-directory-title]');heading.tabIndex=-1;(target??heading).focus({preventScroll:true});
        if(!stale&&target){window.scrollTo({top:restoring.scrollY,behavior:'instant'});requestAnimationFrame(()=>{if(current())window.scrollTo({top:restoring.scrollY,behavior:'instant'});});}
      }
      if(stale)$('[data-directory-status]').textContent='名单已更新，已保留搜索与筛选。';
    }catch(error){if(!current())return;clearRows();$('[data-directory-error]').textContent=error.status===409?'名单已更新，请重新搜索。':'名单暂时无法核对，请重试。';$('[data-directory-error]').hidden=false;$('[data-directory-status]').textContent='此次读取未完成，不能据此判断为零。';onFallback();}
    finally{if(current()){busy=false;root.removeAttribute('aria-busy');lock();
      if(filterFocus?.isConnected&&!filterFocus.disabled&&document.activeElement===document.body)filterFocus.focus({preventScroll:true});}}
  }
  function clearHealth(){healthSequence++;healthBusy=false;$('[data-directory-health]').open=false;$('[data-directory-health]').hidden=true;$('[data-directory-health-items]').replaceChildren();$('[data-directory-health-status]').textContent='打开后核对已保存资料。';$('[data-directory-health-error]').textContent='';$('[data-directory-health-error]').hidden=true;$('[data-directory-health-empty]').hidden=true;}
  async function loadHealth(){
    if(!healthAllowed())return clearHealth();const generation=++healthSequence,actor=actorKey(),current=()=>generation===healthSequence&&actorKey()===actor&&healthAllowed();
    healthBusy=true;$('[data-directory-health-items]').replaceChildren();$('[data-directory-health-empty]').hidden=true;$('[data-directory-health-error]').hidden=true;$('[data-directory-health-status]').textContent='正在核对…';lock();
    try{const value=await request('/api/admin/people/health?kind=all&limit=100',{current});if(!current())return;
      if(!validatePeopleHealth(value))throw new Error('Invalid health response.');
      for(const issue of value.issues){const item=node('li');item.dataset.healthKind=issue.kind;item.append(link(issue.label,issue.href),node('span',issue.reason));$('[data-directory-health-items]').append(item);}
      const unavailable=Object.values(value.availability).includes('unavailable')||value.total===null;
      $('[data-directory-health-status]').textContent=Object.values(value.availability).includes('unavailable')?'部分资料暂时无法核对。':value.truncated?'先显示 '+value.issues.length+' 项，请分批核对。':value.total===null?'此次核对尚未完成。':'需核对 '+value.total+' 项';
      $('[data-directory-health-empty]').hidden=unavailable||value.truncated||value.total!==0;
    }catch(error){if(!current())return;$('[data-directory-health-error]').textContent=error.status===403?'权限已变化，请重新登录。':'资料暂时无法核对，请重试。';$('[data-directory-health-error]').hidden=false;$('[data-directory-health-status]').textContent='此次核对未完成。';}
    finally{if(current()){healthBusy=false;lock();}}
  }
  function clear(){sequence++;busy=false;currentCursor='';trail=[];restoreAttempted=false;navigation.clear();resetting=true;$('[data-directory-search]').reset();resetting=false;clearRows();clearHealth();$('[data-directory-error]').textContent='';$('[data-directory-error]').hidden=true;$('[data-directory-status]').textContent='';lock();}
  $('[data-directory-search]').addEventListener('submit',event=>{event.preventDefault();void load();});$('[data-directory-search]').addEventListener('reset',()=>{if(!resetting)queueMicrotask(()=>{if(active())void load();});});
  $('[data-directory-work]').addEventListener('change',()=>{if(active())void load();});
  $('[data-directory-attendance]')?.addEventListener('change',()=>{if(active())void load();});
  $('[data-directory-next]').addEventListener('click',()=>{if(!busy&&state?.nextCursor)void load(state.nextCursor,[...trail,currentCursor]);});$('[data-directory-prev]').addEventListener('click',()=>{if(!busy&&trail.length)void load(trail.at(-1),trail.slice(0,-1));});
  $('[data-directory-health]').addEventListener('toggle',()=>{if($('[data-directory-health]').open&&healthAllowed())void loadHealth();});$('[data-directory-health-refresh]').addEventListener('click',()=>void loadHealth());
  window.addEventListener('hashchange',()=>{if(active()&&(/^#people=(exhibitors|speakers|guests|unassigned|attendees)$/u.test(location.hash)||!location.hash))void load();});
  return{load,clear,lock};
}
