import {createDefaultOrganizations} from '../config/exhibiting-partners.mjs';
import {isPublicWebsite} from '../../shared/content-schema.mjs';
import {prepareProfileImage,processedImageSummary} from '../lib/profile-image.mjs';
import {editStaffImage} from '../lib/staff-image-editor.mjs';
import {organizationMemberPage,personContactPath} from '../lib/content-relationships.mjs';
import {PUBLICATION_REASON_LABELS,PUBLICATION_CHANGE_LABELS} from '../lib/admin-save-state.mjs';
import {readContentForm,writeContentForm} from '../lib/content-local-drafts.mjs';
import '../styles/organizations-admin.css';

const portrait=/^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const participationLabels={undecided:'参与形式待确定',exhibitor:'参展',attendee:'一般参与'};
const statusLabels={pending:'待确认',confirmed:'已确认',withdrawn:'已退出'};
function node(tag,text,className){const result=document.createElement(tag);if(text!==undefined)result.textContent=text;if(className)result.className=className;return result;}

/** The content controller owns cloud persistence and public publication. */
export function createOrganizationsEditor({root,request,getContext,onApply,onSave,onChange,announce}){
  const $=selector=>root.querySelector(selector),dialog=$('[data-organization-dialog]'),form=$('[data-organization-form]');
  let generation=0,uploadController=null,uploading=false,pendingImage=null,formDirty=false,accountKey='',editingId=null,editContext=null,imageGeneration=0;
  let membersEpoch=0,saving=false,activeSave=null;const memberControllers=new Set();
  const context=()=>getContext(),allowed=()=>Boolean(context().content&&context().user?.roles.includes('editor'));
  const blocked=()=>context().busy===true;
  const pageActive=()=>context().active!==false;
  const records=()=>Object.hasOwn(context().content??{},'organizations')?context().content.organizations:createDefaultOrganizations();
  const notify=()=>onChange?.();
  function cancelMembers(){membersEpoch++;for(const controller of memberControllers)controller.abort();memberControllers.clear();}
  const canViewMembers=()=>Boolean(pageActive()&&context().user?.roles.includes('outreach'));
  function error(message=''){const box=$('[data-organization-error]');box.textContent=message;box.hidden=!message;if(message)box.focus();}
  function changed(event){if(event?.target?.closest('[data-image-editor]')||event?.target===$('[data-organization-image]'))return;formDirty=true;notify();}
  function revoke(){form.elements.namedItem('publicConsent').checked=false;$('[data-organization-consent-note]').textContent='公开资料或图片已变更，请重新核实这份组织资料的公开授权。';changed();}
  function image(id){
    const previous=$('[data-organization-preview]'),preview=previous.cloneNode(false),stamp=++imageGeneration;
    previous.removeAttribute('src');previous.replaceWith(preview);preview.removeAttribute('src');preview.hidden=true;$('[data-organization-image-empty]').hidden=false;
    if(!portrait.test(id??''))return;
    const path='/api/admin/portraits/'+id;
    preview.addEventListener('error',()=>{
      if(stamp!==imageGeneration||!dialog.open||$('[data-organization-preview]')!==preview||!preview.isConnected||form.elements.namedItem('logoId').value!==id||preview.getAttribute('src')!==path)return;
      preview.hidden=true;$('[data-organization-image-empty]').hidden=false;$('[data-organization-image-status]').textContent='图片预览暂不可用，原图片引用仍保留。可重新上传核对；保存时仍会由后台检查图片。';
    },{once:true});
    preview.src=path;preview.hidden=false;$('[data-organization-image-empty]').hidden=true;
  }
  function cancelUpload(){generation++;uploadController?.abort();uploadController=null;uploading=false;pendingImage=null;$('[data-organization-image-editor]').replaceChildren();$('[data-organization-image-editor]').hidden=true;}
  function reset(){cancelUpload();form.reset();for(const field of form.querySelectorAll('input[type=hidden]'))field.value='';editingId=null;editContext=null;formDirty=false;image('');error();$('[data-organization-image-status]').textContent='';}
  function clear(){cancelMembers();activeSave=null;saving=false;reset();accountKey='';if(dialog.open)dialog.close();$('[data-organization-list]').replaceChildren();$('[data-organizations-legacy]').hidden=true;$('[data-organizations-empty]').hidden=true;}
  function configure(){
    const current=context(),next=current.user?current.user.id+'|'+[...current.user.roles].sort().join(','):'';
    if(next!==accountKey){clear();accountKey=next;}
    const locked=blocked()||saving||!pageActive()||!allowed();
    for(const button of root.querySelectorAll('[data-organization-add],[data-organization-action]'))button.disabled=locked||uploading||dialog.open||button.dataset.edge==='true';
    for(const button of root.querySelectorAll('[data-organization-members],[data-organization-members-more]'))button.disabled=blocked()||saving||uploading||context().dirty||!canViewMembers()||button.hasAttribute('data-organization-members-more')&&button.dataset.loading==='true';
    for(const link of root.querySelectorAll('[data-organization-people]')){const disabled=context().dirty||!canViewMembers();link.setAttribute('aria-disabled',String(disabled));if(disabled)link.removeAttribute('href');else link.href=link.dataset.target;}
    for(const field of form.querySelectorAll('input,textarea,select,button'))if(!field.closest('[data-image-editor]'))field.disabled=locked||uploading;
    for(const button of root.querySelectorAll('[data-organization-close]'))button.disabled=blocked()||saving;
    $('[data-organization-submit]').disabled=locked||uploading||Boolean(pendingImage);
    $('[data-organization-image]').disabled=locked||uploading||Boolean(pendingImage);
    $('[data-organization-image-edit]').disabled=locked||uploading||Boolean(pendingImage)||!portrait.test(form.elements.namedItem('logoId').value);
    for(const selector of ['[data-organization-image-retry]','[data-organization-image-discard]']){$(selector).hidden=!pendingImage;$(selector).disabled=locked||uploading;}
  }
  async function apply(next,message){
    if(!allowed()||!pageActive()||blocked()||saving||uploading)return false;
    const key=accountKey,operation={key};activeSave=operation;saving=true;configure();
    try{
      if(typeof onSave==='function'){
        const saved=await onSave(next);if(saved!==true||activeSave!==operation||key!==accountKey||!allowed())return false;
        render();announce('组织修改已保存到云端，公开发布另行操作。');return true;
      }
      onApply(next);render();announce(message+' 请保存草稿，再发布到公开页。');return true;
    }catch(reason){if(activeSave===operation&&key===accountKey&&allowed())announce(reason.message||'组织资料尚未保存，原记录仍保留。',true);return false;}
    finally{if(activeSave===operation){activeSave=null;saving=false;configure();notify();}}
  }
  function publication(item){return context().publication?.items.organizations.find(row=>row.id===item.id)??null;}
  function withdrawalLabel(item){const state=publication(item);return state?.published?'停止公开':state?.ready?'取消待发布':'撤回公开授权';}
  function matchesPublication(item,filter){if(!filter)return true;const state=publication(item);if(!state)return false;return filter==='published'?state.published:filter==='unpublished'?!state.published:filter==='ready'?state.ready:filter==='changed'?['new','updated','removed'].includes(state.change):state.change==='blocked';}
  function appendPublication(body,item){
    const report=context().publication,state=publication(item),isInitial=!Object.hasOwn(context().content??{},'organizations');
    const badge=node('span',!report?'公开状态待核对':!state?(isInitial?'初始内容':'待保存'):state.published?'已公开':'未公开','ah-status');
    badge.dataset.publicationRecord='';badge.dataset.publicationKind='organizations';badge.dataset.publicationId=item.id;badge.dataset.publicationState=!report?'unknown':!state?'unsaved':state.published?'published':'unpublished';badge.dataset.publicationChange=state?.change??'';badge.dataset.statusTone=!state?'neutral':state.published?'positive':'negative';body.append(badge);
    if(state){const progress=node('small',PUBLICATION_CHANGE_LABELS[state.change]??'公开进度待核对');progress.dataset.publicationProgress='';body.append(progress);if(state.reasons.length){const reasons=node('small',state.reasons.map(code=>PUBLICATION_REASON_LABELS[code]??'请核对公开条件').join('；'));reasons.dataset.publicationReasons='';body.append(reasons);}}
  }
  function render(){
    configure();if(!context().content||!pageActive())return;
    cancelMembers();
    const current=records(),filter=$('[data-organization-publication-filter]')?.value??'',visible=current.filter(item=>matchesPublication(item,filter)),output=$('[data-organization-list]');output.replaceChildren();
    $('[data-organizations-legacy]').hidden=Object.hasOwn(context().content,'organizations');$('[data-organizations-empty]').hidden=visible.length>0;$('[data-organizations-empty]').textContent=current.length?'此筛选下没有组织记录。':'还没有参与组织记录。';
    for(const [index,item]of current.entries()){
      if(!matchesPublication(item,filter))continue;
      const card=node('article',undefined,'ah-organization-row');card.dataset.organizationId=item.id;
      const frame=node('div',undefined,'ah-organization-image');
      if(portrait.test(item.logoId)){const picture=node('img');picture.src='/api/admin/portraits/'+item.logoId;picture.alt=item.name+'组织图片（内部预览）';picture.width=110;picture.height=90;picture.loading='lazy';picture.addEventListener('error',()=>{picture.remove();frame.append(node('span','图片预览不可用'));},{once:true});frame.append(picture);}else frame.append(node('span','未上传图片'));
      const body=node('div');body.append(node('h3',item.name||'未填写组织名称'),node('p',participationLabels[item.participation]??participationLabels.undecided),node('p',(statusLabels[item.status]??statusLabels.pending)+' · '+(item.publicConsent?'已获公开授权':'未获公开授权')));
      appendPublication(body,item);
      if(item.website&&isPublicWebsite(item.website)){const link=node('a','查看组织页面 ↗');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}
      const actions=node('div',undefined,'ah-organization-actions');
      for(const [label,action]of[['编辑','edit'],['核对公开条件','readiness'],['上移','up'],['下移','down'],...(item.publicConsent?[[withdrawalLabel(item),'withdraw']]:[])]){
        const button=node('button',label);button.type='button';button.dataset.organizationAction=action;button.setAttribute('aria-label',label+'组织 '+item.name);button.dataset.edge=String(action==='up'&&index===0||action==='down'&&index===current.length-1);
        button.addEventListener('click',()=>{
          if(!allowed()||!pageActive()||blocked()||saving||uploading||dialog.open)return;
          if(action==='edit'||action==='readiness'){open(item);if(action==='readiness'){const field=form.elements.namedItem(item.status!=='confirmed'?'status':'publicConsent');field.focus({preventScroll:true});field.scrollIntoView({block:'center',behavior:'auto'});}return;}
          const next=structuredClone(records()),position=next.findIndex(value=>value.id===item.id);if(position<0)return;
          if(action==='withdraw'){if(!confirm((withdrawalLabel(item))+'此组织？参与确认、名称、图片、链接与备注会保留；明确发布后才更新前台。'))return;next[position].publicConsent=false;void apply(next,'已在草稿停止公开此组织，资料仍保留。');}
          else{const target=position+(action==='up'?-1:1);if(target<0||target>=next.length)return;[next[position],next[target]]=[next[target],next[position]];void apply(next,'组织显示顺序已应用到草稿。');}
        });actions.append(button);
      }
      body.append(actions);if(canViewMembers()&&Object.hasOwn(context().content,'organizations'))appendMembers(item,body);card.append(frame,body);output.append(card);
    }
    configure();
  }
  function appendMembers(item,body){
    const tools=node('div',undefined,'ah-organization-actions'),button=node('button','查看成员');button.type='button';button.dataset.organizationMembers=item.id;button.setAttribute('aria-label','查看组织成员 '+item.name);
    const link=node('a','在人员与邀约中筛选');link.dataset.organizationPeople='';link.dataset.target='/admin/contacts/#organization='+encodeURIComponent(item.id);link.href=link.dataset.target;
    tools.append(button,link);const panel=node('section',undefined,'ah-organization-members');panel.dataset.organizationMembersPanel=item.id;panel.hidden=true;
    const status=node('p'),list=node('ul'),more=node('button','载入更多成员');status.setAttribute('role','status');status.setAttribute('aria-live','polite');list.dataset.organizationMembersList='';more.type='button';more.dataset.organizationMembersMore=item.id;more.hidden=true;panel.append(status,list,more);body.append(tools,panel);
    const stamp=membersEpoch,state=context(),key=accountKey;let controller=null,contactsRevision=null,contentRevision=null,nextCursor=null,members=[];
    const active=()=>stamp===membersEpoch&&accountKey===key&&canViewMembers()&&context().content===state.content&&context().revision===state.revision&&panel.isConnected&&!panel.hidden&&!context().dirty;
    function erase(){controller?.abort();if(controller)memberControllers.delete(controller);controller=null;members=[];contactsRevision=null;contentRevision=null;nextCursor=null;list.replaceChildren();more.hidden=true;button.dataset.loading='false';more.dataset.loading='false';}
    async function load(append=false){
      if(!active()||blocked()||uploading||append&&!nextCursor)return;
      controller?.abort();if(controller)memberControllers.delete(controller);controller=new AbortController();memberControllers.add(controller);const pending=controller;
      button.dataset.loading='true';more.dataset.loading='true';configure();status.textContent='正在读取已保存成员…';
      const params=new URLSearchParams({limit:'100'});if(append)params.set('cursor',nextCursor);
      const cursor=nextCursor,timer=setTimeout(()=>pending.abort(),15_000);
      try{
        const page=organizationMemberPage(await request('/api/admin/people/organizations/'+encodeURIComponent(item.id)+'/members?'+params,{signal:pending.signal,isCurrent:()=>active()&&controller===pending&&!pending.signal.aborted}),item.id);
        if(!active()||controller!==pending)return;
        if(page.contentRevision!==state.revision||append&&(page.contactsRevision!==contactsRevision||page.contentRevision!==contentRevision||page.total<members.length+page.members.length||page.nextCursor!==null&&Number(page.nextCursor)<=Number(cursor)||page.members.some(member=>members.some(previous=>previous.contactId===member.contactId))))throw new Error('成员或组织资料已变化，请重新读取内容后再核对。');
        members=append?[...members,...page.members]:page.members;contactsRevision=page.contactsRevision;contentRevision=page.contentRevision;nextCursor=page.nextCursor;list.replaceChildren();
        for(const member of members){const row=node('li'),person=node('a',member.name);person.href=personContactPath(member.contactId);row.append(person,node('span',(member.role==='lead'?'负责人':'成员')+(member.title?' · '+member.title:'')));list.append(row);}
        status.textContent='已显示 '+members.length+' / '+page.total+' 位已保存成员。成员关系不代表已确认参会或获分配展位。';more.hidden=!nextCursor;
      }catch(reason){if(active()&&controller===pending){const timeout=pending.signal.aborted;erase();status.textContent=timeout?'成员读取超时，请稍后重新读取。':reason.status?reason.message:'成员资料暂不可核对，请稍后重新读取。';configure();}}
      finally{clearTimeout(timer);memberControllers.delete(pending);if(controller===pending){controller=null;button.dataset.loading='false';more.dataset.loading='false';configure();}}
    }
    button.addEventListener('click',()=>{if(!canViewMembers()||blocked()||uploading||context().dirty)return;if(!panel.hidden){erase();panel.hidden=true;status.textContent='';button.textContent='查看成员';configure();return;}panel.hidden=false;button.textContent='收起成员';void load();});
    more.addEventListener('click',()=>void load(true));
  }
  function open(item=null){
    if(!allowed()||!pageActive()||blocked()||saving||uploading)return;
    if(!item&&records().length>=200){announce('参与组织最多 200 条，请先核对现有记录。',true);return;}
    reset();const value=item??{id:'organization-'+crypto.randomUUID().replaceAll('-',''),name:'',logoId:'',website:'',participation:'undecided',status:'pending',publicConsent:false,internalNotes:''};editingId=item?.id??null;editContext={content:context().content,revision:context().revision,accountKey,formId:value.id,newRecordSubmitted:false};
    for(const [key,text]of Object.entries(value)){const field=form.elements.namedItem(key);if(field?.type==='checkbox')field.checked=text===true;else if(field)field.value=text;}
    image(value.logoId);$('[data-organization-dialog-title]').textContent=(item?'编辑':'新增')+'组织';$('[data-organization-consent-note]').textContent='更改公开资料或图片后，请重新核对授权；保存草稿不会自动公开。';dialog.showModal();notify();configure();
  }
  function close(){if(blocked()||saving)return;if((formDirty||uploading||pendingImage)&&!confirm('关闭将放弃本次尚未保存的组织资料，继续吗？'))return;cancelUpload();dialog.close();reset();notify();configure();}
  function imageContext(){return{content:context().content,revision:context().revision,key:accountKey,id:form.elements.namedItem('id').value};}
  function activeImage(state,started,signal){return started===generation&&!signal.aborted&&state.key===accountKey&&allowed()&&pageActive()&&dialog.open&&context().content===state.content&&context().revision===state.revision&&form.elements.namedItem('id').value===state.id;}
  async function sendImage(pending,started,controller){
    const result=await request('/api/admin/portraits',{method:'POST',body:JSON.stringify(pending.prepared.payload),signal:controller.signal});if(!activeImage(pending.context,started,controller.signal))return;
    const proof=result.portrait;if(!portrait.test(proof?.id??'')||proof.contentType!==pending.prepared.payload.contentType||!Number.isSafeInteger(proof.bytes)||proof.bytes<1||proof.bytes>512*1024)throw new Error('图片上传结果尚未核对，可重试同一份图片。');
    revoke();
    form.elements.namedItem('logoId').value=proof.id;image(proof.id);pendingImage=null;$('[data-organization-image-status]').textContent=processedImageSummary(pending.prepared)+(typeof onSave==='function'?' 图片已上传；请保存组织资料，公开发布另行操作。':' 图片已上传；请应用组织修改、保存并发布。');
  }
  function imageFailure(reason){$('[data-organization-image-status]').textContent=pendingImage?'已保留待上传图片与当前组织资料，原图片仍保留。请稍后重试上传，或取消本次图片。':'图片编辑未完成，原有图片与组织资料仍保留。';error(reason.message||'图片上传暂未完成。');}
  async function editImage(fileOrLoader){
    if(!allowed()||!pageActive()||blocked()||saving||!dialog.open||uploading||pendingImage)return;
    cancelUpload();error();
    const started=generation,state=imageContext(),returnFocus=$(typeof fileOrLoader==='function'?'[data-organization-image-edit]':'[data-organization-image]');
    const controller=new AbortController();uploadController=controller;uploading=true;notify();configure();$('[data-organization-image-status]').textContent='正在准备图片编辑…';
    const active=()=>activeImage(state,started,controller.signal);
    try{
      const file=typeof fileOrLoader==='function'?await fileOrLoader(controller.signal):fileOrLoader;if(!active())return;
      $('[data-organization-image-editor]').hidden=false;
      const edited=await editStaffImage(file,{root:$('[data-organization-image-editor]'),kind:'organization',signal:controller.signal});if(!active())return;
      $('[data-organization-image-editor]').hidden=true;
      if(!edited){$('[data-organization-image-status]').textContent='已取消图片编辑，原有图片与组织资料保留。';return;}
      $('[data-organization-image-status]').textContent='正在处理并上传编辑后的组织图片…';
      const prepared=await prepareProfileImage(edited,{maxEdge:800,preserveTransparency:true,signal:controller.signal});if(!active())return;
      pendingImage={prepared,context:state};await sendImage(pendingImage,started,controller);
    }catch(reason){if(active())imageFailure(reason);}
    finally{if(started===generation){uploading=false;uploadController=null;$('[data-organization-image-editor]').hidden=true;$('[data-organization-image]').value='';notify();configure();if(dialog.open&&document.activeElement===document.body)(pendingImage?$('[data-organization-image-retry]'):returnFocus).focus({preventScroll:true});}}
  }
  function upload(event){const file=event.currentTarget.files?.[0];if(file)return editImage(file);}
  async function retryImage(){
    const pending=pendingImage;if(!pending||uploading||blocked()||saving||!pageActive()||!allowed())return;
    const started=generation,controller=new AbortController();if(!activeImage(pending.context,started,controller.signal))return;
    uploadController=controller;uploading=true;error();notify();configure();$('[data-organization-image-status]').textContent='正在重试上传同一份图片…';
    try{await sendImage(pending,started,controller);}catch(reason){if(activeImage(pending.context,started,controller.signal))imageFailure(reason);}
    finally{if(started===generation){uploading=false;uploadController=null;notify();configure();}}
  }
  form.addEventListener('input',changed);form.addEventListener('change',changed);
  for(const name of ['name','website'])form.elements.namedItem(name).addEventListener('input',revoke);
  form.elements.namedItem('participation').addEventListener('change',revoke);
  form.elements.namedItem('status').addEventListener('change',()=>{if(form.elements.namedItem('status').value!=='confirmed')revoke();});
  $('[data-organization-add]').addEventListener('click',()=>open());
  for(const button of root.querySelectorAll('[data-organization-close]'))button.addEventListener('click',close);
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(dialog.open)return;reset();notify();configure();});
  $('[data-organization-image]').addEventListener('change',upload);
  $('[data-organization-image-edit]').addEventListener('click',()=>{const id=form.elements.namedItem('logoId').value;if(portrait.test(id))return editImage(signal=>request('/api/admin/portraits/'+id,{binaryImage:true,signal}));});
  $('[data-organization-image-retry]').addEventListener('click',retryImage);
  $('[data-organization-image-discard]').addEventListener('click',()=>{if(uploading||blocked()||!allowed())return;cancelUpload();error();image(form.elements.namedItem('logoId').value);$('[data-organization-image-status]').textContent='已取消待上传图片，原有图片与组织资料保留。';notify();configure();$('[data-organization-image]').focus({preventScroll:true});});
  $('[data-organization-image-remove]').addEventListener('click',()=>{if(!allowed()||blocked())return;cancelUpload();form.elements.namedItem('logoId').value='';$('[data-organization-image]').value='';$('[data-organization-image-status]').textContent='';image('');revoke();configure();});
  function localDraft(){return dialog.open?{editingId,fields:readContentForm(form,'organization'),imageNeedsReselect:Boolean(uploading||pendingImage)}:null;}
  function acknowledgeSaved(record,{keepOpen=false}={}){
    if(!record||!dialog.open||!allowed()||editContext?.accountKey!==accountKey||record.editingId!==editingId||record.fields?.id!==form.elements.namedItem('id').value||record.fields.id!==editContext.formId)return false;
    const current=localDraft(),matches=JSON.stringify(current)===JSON.stringify(record);
    // The controller calls this only after proving its own CAS acknowledgement.
    // A later raw edit remains open against that newly acknowledged base.
    editContext={...editContext,content:context().content,revision:context().revision,accountKey};
    if(keepOpen&&activeSave?.key===accountKey)activeSave.keepOpen=true;
    if(!matches||keepOpen)return false;
    if(activeSave?.key===accountKey)activeSave.acknowledged=true;
    dialog.close();reset();render();notify();configure();return true;
  }
  async function save({allowBusy=false}={}){
    if(!allowed()||!pageActive()||!dialog.open||(!allowBusy&&blocked())||saving||uploading||pendingImage||!form.reportValidity())return false;
    const state=context(),cloudSave=typeof onSave==='function';
    if(!editContext||(!cloudSave&&editContext.content!==state.content)||editContext.revision!==state.revision||editContext.accountKey!==accountKey){error('草稿版本已变化，请保留填写并重新读取组织资料后核对。');return false;}
    const submitted=localDraft(),item=readContentForm(form,'organization');
    if(!item){error('组织资料尚未通过校验，填写内容仍保留。');return false;}
    if(item.id!==editContext.formId){error('组织记录编号已变化，填写内容仍保留；请恢复原编号后核对。');return false;}
    if(item.website&&!isPublicWebsite(item.website)){error('请填写不含账号密码的 HTTP 或 HTTPS 网址。');return false;}
    const next=structuredClone(records()),position=next.findIndex(value=>value.id===item.id);
    if(editingId&&position<0){error('此组织记录已变化，请保留填写并重新读取草稿后核对。');return false;}
    if(!editingId&&position>=0&&!editContext.newRecordSubmitted){error('此组织编号已存在，请保留填写并重新核对记录。');return false;}
    if(position>=0)next[position]=item;else next.push(item);
    if(!editingId)editContext.newRecordSubmitted=true;
    const operation={key:accountKey,id:item.id,acknowledged:false};activeSave=operation;saving=true;error();configure();
    const current=()=>activeSave===operation&&operation.key===accountKey&&allowed();
    try{
      if(cloudSave){
        const saved=await onSave(next);
        if(!current())return false;
        if(saved!==true){
          if(dialog.open&&form.elements.namedItem('id').value===operation.id){
            if(context().revision===state.revision)editContext={...editContext,content:context().content,revision:state.revision,accountKey};
            error('组织资料尚未确认保存，填写内容仍保留。');
          }
          return false;
        }
        if(!operation.acknowledged)acknowledgeSaved(submitted,{keepOpen:operation.keepOpen===true});
        if(operation.acknowledged)announce('组织资料已保存到云端，公开发布另行操作。');
        return true;
      }
      if(typeof onApply!=='function')throw new Error('组织保存入口尚未就绪。');
      onApply(next);acknowledgeSaved(submitted);announce('组织修改已应用到草稿。请保存草稿，再发布到公开页。');return true;
    }catch(reason){if(current()&&dialog.open&&form.elements.namedItem('id').value===operation.id)error(reason.message||'组织资料尚未保存，填写内容仍保留。');return false;}
    finally{if(activeSave===operation){activeSave=null;saving=false;configure();notify();}}
  }
  $('[data-organization-publication-filter]')?.addEventListener('change',render);
  form.addEventListener('submit',event=>{event.preventDefault();void save();});
  clear();
  return Object.freeze({render,configure,clear,save,acknowledgeSaved,openById(id){const item=Object.hasOwn(context().content??{},'organizations')?records().find(item=>item.id===id):null;if(!item){announce('此组织尚未保存或已不存在，请重新读取内容后核对。',true);return;}open(item);},get uploading(){return uploading;},get saving(){return saving;},hasUnapplied:()=>dialog.open||uploading,
    localDraft,
    restoreLocalDraft(record){
      if(!allowed()||!pageActive()||blocked()||saving)throw new Error('当前不能恢复组织编辑。');
      const item=record.editingId?records().find(value=>value.id===record.editingId):null;
      if(record.editingId&&!item)throw new Error('原组织已不存在，请复制暂存后核对。');
      open(item);editingId=record.editingId;editContext={...editContext,formId:record.fields.id,newRecordSubmitted:record.editingId===null};writeContentForm(form,'organization',record.fields);formDirty=true;image(record.fields.logoId);
      $('[data-organization-consent-note]').textContent='已恢复本机填写，公开授权请重新核对。';
      if(record.imageNeedsReselect)$('[data-organization-image-status]').textContent='未上传的图片编辑无法恢复，请重新选择图片。';
      notify();configure();
    },
    appendPublicPreview(content,output){
      const list=Object.hasOwn(content,'organizations')?content.organizations:createDefaultOrganizations();output.append(node('h3','参与组织'));if(!list.length)output.append(node('p','暂未公布参与组织。'));
      for(const item of list){const card=node('article',undefined,'ah-organization-row'),body=node('div');const logo=(item.logoUrl??'').split('/').at(-1);if(portrait.test(logo??'')){const picture=node('img');picture.src='/api/admin/portraits/'+logo;picture.alt=item.name+'组织图片';picture.width=110;picture.height=90;picture.style.objectFit='contain';card.append(picture);}body.append(node('h4',item.name),node('p',participationLabels[item.participation]??participationLabels.undecided));if(item.website&&isPublicWebsite(item.website)){const link=node('a','组织页面 ↗');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}card.append(body);output.append(card);}
    },
  });
}
