import {resolvePeopleView} from './admin-sections.mjs';
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u,REG=/^[A-Za-z0-9_-]{43}$/u;
const string=(value,max=300)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=6400;
const optional=(value,pattern)=>value===null||typeof value==='string'&&pattern.test(value);
const roles=['guest','speaker','panelist','host','organizer','exhibitor','student_showcase','attendee','moderator'];
const admissions=['confirmed','waitlisted','withdrawn','pending_review','rejected'];
export function validatePeopleDirectory(value,view){
  if(!value||value.schemaVersion!==1||value.view!==view||!['all','exhibitors','speakers','guests'].includes(view)
    ||typeof value.permissions?.contacts!=='boolean'||typeof value.permissions?.registrations!=='boolean'
    ||!value.summary||!['people','confirmed','pendingReview','exhibitors','speakers','guests'].every(key=>value.summary[key]===null||count(value.summary[key]))
    ||!count(value.total)||value.rows?.length>value.total||!/^[a-f0-9]{64}$/u.test(value.revision??'')||!Array.isArray(value.rows)||value.rows.length>100
    ||!(value.nextCursor===null||typeof value.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,512}$/u.test(value.nextCursor)))return false;
  const seen=new Set();
  for(const row of value.rows){
    if(!row||!string(row.key,160)||seen.has(row.key)||!string(row.name)||!row.name||!string(row.organization))return false;seen.add(row.key);
    if(row.kind==='person'){
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
const ROLE_LABELS={guest:'嘉宾',speaker:'讲者',panelist:'圆桌嘉宾',host:'主持',organizer:'组织者',exhibitor:'参展',student_showcase:'作品展示',attendee:'参会',moderator:'主持'};
const ADMISSION_LABELS={confirmed:'已确认参会名额',pending_review:'申请待审核',waitlisted:'候补',rejected:'审核不通过',withdrawn:'已撤回'};
const EMAIL_LABELS={provider_accepted:'确认信：服务商已接受',unknown:'确认信：结果待核对',rejected:'确认信：未发出',not_sent:'确认信：尚未寄送',unavailable:'确认信状态待核对',restricted:'',not_applicable:''};
const SOURCE_LABELS={linked:'邀约与报名已关联',contact:'邀约名单',public:'本人公开申请',staff_assisted:'工作人员代登记',staff_entry:'工作人员登记',profile:'人物资料，尚未关联人员'};
const INVITATION_LABELS={not_started:'尚未准备邀请',prepared:'邀请已准备',issuing:'寄送结果待核对',provider_accepted:'邀请服务商已接受',unknown:'邀请结果待核对',rejected:'邀请未发出',manually_sent:'已记录人工发出',not_applicable:''};
const VIEWS={all:['统一名单','同一位已关联人员集中核对；出席回复、正式名额与职责分别标示。'],speakers:['讲者名单','按已保存讲者职责与人物关联列出，不将原问卷兴趣当作讲者确认。'],guests:['嘉宾名单','嘉宾与圆桌嘉宾可兼任讲者；出席与正式名额仍需分别核对。'],exhibitors:['参展商名单','按公司／团队核对联络人与展位；没有明确组织关系的旧展位保留待关联。']};

export function createPeopleDirectory({root,request,getUser,onContact,onProfile,onInvitation,canInvite=()=>false,onFallback=()=>{}}){
  const $=selector=>root.querySelector(selector),node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  let sequence=0,state=null,busy=false,blocked=false,currentCursor='',trail=[],resetting=false;
  const view=()=>resolvePeopleView(location.pathname,location.hash),active=()=>Boolean(getUser()?.id);
  function link(text,href,cls){const a=node('a',text,cls);a.href=href;return a;}
  function badge(text,status){const p=node('div',text,'people-directory-state');p.dataset.state=status;return p;}
  function lock(value=blocked){blocked=value;for(const control of root.querySelectorAll('button,input'))control.disabled=busy||blocked||!active();}
  function personRow(item){
    const row=node('tr'),identity=node('td'),name=node('div',item.name,'people-directory-name');identity.append(name,node('small',item.organization||'机构未填写'),node('small',SOURCE_LABELS[item.source]));
    if(item.roles.length){const tags=node('div',undefined,'people-directory-roles');for(const role of item.roles)tags.append(node('span',ROLE_LABELS[role]));identity.append(tags);}
    const follow=node('td');if(item.responseStatus)follow.append(node('div',({pending:'出席回复待确认',attending:'本人已答应出席',declined:'本人不出席'})[item.responseStatus]));
    const invitation=INVITATION_LABELS[item.invitationStatus];if(invitation)follow.append(node('small',invitation));
    if(item.owner)follow.append(node('small','跟进：'+item.owner));if(item.followUpAt)follow.append(node('small','下次：'+item.followUpAt));if(!follow.childNodes.length)follow.append(node('small','本人申请／资料登记'));
    const admission=node('td');admission.append(item.admissionStatus?badge(ADMISSION_LABELS[item.admissionStatus],item.admissionStatus):node('small',item.registrationState==='restricted'?'已关联报名，名额由审核同事核对':'尚未关联报名'));
    if(EMAIL_LABELS[item.deliveryStatus])admission.append(node('small',EMAIL_LABELS[item.deliveryStatus]));
    const actions=node('td');
    if(item.contactId){const button=node('button','查看与管理','people-directory-action');button.type='button';button.addEventListener('click',()=>{if(!blocked&&!busy&&active())onContact(item.contactId);});actions.append(button);
      const menu=node('details',undefined,'people-row-menu');menu.append(node('summary','更多'));const options=node('div');options.append(link('个人总览','/admin/person/#contact='+encodeURIComponent(item.contactId)));
      for(const[label,callback]of[['编辑基本资料',onProfile],['准备邀请函',canInvite(item.contactId)?onInvitation:null]])if(callback){const b=node('button',label);b.type='button';b.addEventListener('click',()=>{if(!blocked&&!busy&&active())callback(item.contactId);});options.append(b);}
      if(item.registrationId&&state.permissions.registrations)options.append(link('报名与票券','/admin/registrations/#registration='+encodeURIComponent(item.registrationId)));menu.append(options);actions.append(menu);
    }else if(item.registrationId)actions.append(link('审核与票券','/admin/registrations/#registration='+encodeURIComponent(item.registrationId),'people-directory-action'));
    else if(getUser()?.roles?.some(role=>['editor','superadmin'].includes(role)))actions.append(link('管理人物资料','/admin/content/guests/#guest='+encodeURIComponent(item.profileId),'people-directory-action'));
    else actions.append(node('small','人物资料由活动编辑管理'));
    row.append(identity,follow,admission,actions);return row;
  }
  function companyRow(item){const row=node('tr'),identity=node('td'),members=node('td',undefined,'people-directory-members'),booths=node('td'),actions=node('td');
    identity.append(node('div',item.name,'people-directory-name'),node('small',item.kind==='unlinked_booth'?'旧展位文字，组织关系待关联':'参展组织／团队'));
    for(const member of item.members)members.append(link(member.name+(member.role==='lead'?' · 联络人':''),'/admin/person/#contact='+encodeURIComponent(member.id)));
    if(!item.members.length)members.append(node('small','尚未关联联络人'));if(item.memberTotal>item.members.length)members.append(node('small','另有 '+(item.memberTotal-item.members.length)+' 位关联成员'));
    booths.append(badge(({confirmed:'参展已确认',pending:'参展待确认',withdrawn:'已退出',unlinked:'组织关系待关联'})[item.status],item.status));
    for(const booth of item.booths)booths.append(node('small',booth.code+' · '+booth.zone+'区'+(booth.status==='cancelled'?'（已取消）':'')));if(!item.booths.length)booths.append(node('small','展位待安排'));
    if(!getUser()?.roles?.some(role=>['editor','superadmin'].includes(role))){actions.append(item.organizationId?link('查看关联人员','/admin/contacts/#organization='+encodeURIComponent(item.organizationId),'people-directory-action'):node('small','请由活动编辑关联组织'));}
    else actions.append(item.organizationId?link('参展资料','/admin/content/organizations/#organization='+encodeURIComponent(item.organizationId),'people-directory-action'):link('关联展位组织','/admin/content/booths/#booth='+encodeURIComponent(item.booths[0].id),'people-directory-action'));
    row.append(identity,members,booths,actions);return row;
  }
  function render(){
    const selected=view(),labels=VIEWS[selected]??VIEWS.all;$('[data-directory-title]').textContent=labels[0];$('[data-directory-description]').textContent=labels[1];
    const metrics=$('[data-directory-metrics]');metrics.replaceChildren();for(const[label,key]of[['名单记录','people'],['已确认名额','confirmed'],['待审核申请','pendingReview']]){const card=node('article');card.append(node('span',label),node('strong',state.summary[key]===null?'—':String(state.summary[key])));metrics.append(card);}
    for(const link of document.querySelectorAll('[data-people-view]')){if(['exhibitors','speakers','guests'].includes(link.dataset.peopleView))link.hidden=!state.permissions.contacts;const output=link.querySelector('[data-people-count]');const key=({all:'people',registrations:'pendingReview',exhibitors:'exhibitors',speakers:'speakers',guests:'guests'})[link.dataset.peopleView];if(output)output.textContent=state.summary[key]===null?'':link.dataset.peopleView==='registrations'?state.summary[key]+' 待审':String(state.summary[key]);}
    const head=$('[data-directory-head]');head.replaceChildren();const tr=node('tr');for(const label of selected==='exhibitors'?['公司／团队','联络人／成员','展位与状态','操作']:['姓名／机构','邀约与跟进','正式报名与名额','操作'])tr.append(node('th',label));head.append(tr);
    const body=$('[data-directory-rows]');body.replaceChildren(...state.rows.map(item=>item.kind==='person'?personRow(item):companyRow(item)));
    $('[data-directory-empty]').hidden=state.rows.length>0;
    $('[data-directory-empty]').textContent=selected==='all'?'目前没有符合条件的已保存人员。':selected==='exhibitors'?'尚未建立符合条件的参展组织。请在组织资料中核对参与形式、联络人与展位。':'尚无符合条件的已标记人员。请在人员详情或人物资料中保存实际职责。';
    $('[data-directory-status]').textContent='本页 '+state.rows.length+' 条 · 符合筛选 '+state.total+' 条';$('[data-directory-next]').hidden=!state.nextCursor;$('[data-directory-prev]').hidden=!trail.length;lock();
  }
  async function load(cursor='',history=[]){
    if(!active())return clear();const generation=++sequence,actor=getUser().id,selected=view()==='registrations'?'all':view(),query=$('[name=query]').value;
    const current=()=>generation===sequence&&getUser()?.id===actor;busy=true;$('[data-directory-error]').hidden=true;root.setAttribute('aria-busy','true');lock();
    try{const params=new URLSearchParams({view:selected,limit:'50',...(query?{query}:{}),...(cursor?{cursor}:{})});const value=await request('/api/admin/people/directory?'+params,{current});if(!current())return;
      if(!validatePeopleDirectory(value,selected))throw new Error('Invalid directory response.');state=value;currentCursor=cursor;trail=history;render();
    }catch(error){if(!current())return;$('[data-directory-error]').textContent=error.status===409?'名单已经更新，请点搜索重新读取第一页。':'统一名单暂时无法核对，请重试；完整邀约工具仍保留在下方。';$('[data-directory-error]').hidden=false;$('[data-directory-status]').textContent='此次读取未完成，不能据此判断为零。';onFallback();}
    finally{if(current()){busy=false;root.removeAttribute('aria-busy');lock();}}
  }
  function clear(){sequence++;busy=false;state=null;currentCursor='';trail=[];resetting=true;$('[data-directory-search]').reset();resetting=false;for(const selector of ['[data-directory-rows]','[data-directory-head]','[data-directory-metrics]'])$(selector).replaceChildren();$('[data-directory-error]').textContent='';$('[data-directory-error]').hidden=true;$('[data-directory-status]').textContent='';$('[data-directory-next]').hidden=true;$('[data-directory-prev]').hidden=true;for(const badge of document.querySelectorAll('[data-people-count]'))badge.textContent='';lock();}
  $('[data-directory-search]').addEventListener('submit',event=>{event.preventDefault();void load();});$('[data-directory-search]').addEventListener('reset',()=>{if(!resetting)queueMicrotask(()=>{if(active())void load();});});
  $('[data-directory-next]').addEventListener('click',()=>{if(!busy&&state?.nextCursor)void load(state.nextCursor,[...trail,currentCursor]);});$('[data-directory-prev]').addEventListener('click',()=>{if(!busy&&trail.length)void load(trail.at(-1),trail.slice(0,-1));});
  window.addEventListener('hashchange',()=>{if(active()&&/^#people=(exhibitors|speakers|guests)$/u.test(location.hash)||active()&&!location.hash)void load();});
  return{load,clear,lock};
}
