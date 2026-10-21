import {createDefaultOrganizations} from '../config/exhibiting-partners.mjs';
import {isPublicWebsite} from '../../shared/content-schema.mjs';
import {prepareProfileImage,processedImageSummary} from '../lib/profile-image.mjs';
import '../styles/organizations-admin.css';

const portrait=/^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const participationLabels={undecided:'参与形式待确定',exhibitor:'参展',attendee:'一般参与'};
const statusLabels={pending:'待确认',confirmed:'已确认',withdrawn:'已退出'};
function node(tag,text,className){const result=document.createElement(tag);if(text!==undefined)result.textContent=text;if(className)result.className=className;return result;}

/** Owns only local organization editing; the existing content controller saves and publishes. */
export function createOrganizationsEditor({root,request,getContext,onApply,onChange,announce}){
  const $=selector=>root.querySelector(selector),dialog=$('[data-organization-dialog]'),form=$('[data-organization-form]');
  let generation=0,uploadController=null,uploading=false,formDirty=false,accountKey='',editingId=null,editContext=null,imageGeneration=0;
  const context=()=>getContext(),allowed=()=>Boolean(context().content&&context().user?.roles.includes('editor'));
  const blocked=()=>context().busy===true;
  const records=()=>Object.hasOwn(context().content??{},'organizations')?context().content.organizations:createDefaultOrganizations();
  const notify=()=>onChange?.();
  function error(message=''){const box=$('[data-organization-error]');box.textContent=message;box.hidden=!message;if(message)box.focus();}
  function changed(){formDirty=true;notify();}
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
  function cancelUpload(){generation++;uploadController?.abort();uploadController=null;uploading=false;}
  function reset(){cancelUpload();form.reset();editingId=null;editContext=null;formDirty=false;image('');error();$('[data-organization-image-status]').textContent='';}
  function clear(){reset();accountKey='';if(dialog.open)dialog.close();$('[data-organization-list]').replaceChildren();$('[data-organizations-legacy]').hidden=true;$('[data-organizations-empty]').hidden=true;}
  function configure(){
    const current=context(),next=current.user?current.user.id+'|'+[...current.user.roles].sort().join(','):'';
    if(next!==accountKey){clear();accountKey=next;}
    const locked=blocked()||!allowed();
    for(const button of root.querySelectorAll('[data-organization-add],[data-organization-action]'))button.disabled=locked||uploading||dialog.open||button.dataset.edge==='true';
    for(const field of form.querySelectorAll('input,textarea,select,button'))field.disabled=locked||uploading;
    for(const button of root.querySelectorAll('[data-organization-close]'))button.disabled=blocked();
  }
  function apply(next,message){if(!allowed()||blocked()||uploading)return;onApply(next);render();announce(message+' 请保存草稿，再发布到公开页。');}
  function render(){
    configure();if(!context().content)return;
    const current=records(),output=$('[data-organization-list]');output.replaceChildren();
    $('[data-organizations-legacy]').hidden=Object.hasOwn(context().content,'organizations');$('[data-organizations-empty]').hidden=current.length>0;
    for(const [index,item]of current.entries()){
      const card=node('article',undefined,'ah-organization-row');card.dataset.organizationId=item.id;
      const frame=node('div',undefined,'ah-organization-image');
      if(portrait.test(item.logoId)){const picture=node('img');picture.src='/api/admin/portraits/'+item.logoId;picture.alt=item.name+'组织图片（内部预览）';picture.width=110;picture.height=90;picture.loading='lazy';picture.addEventListener('error',()=>{picture.remove();frame.append(node('span','图片预览不可用'));},{once:true});frame.append(picture);}else frame.append(node('span','未上传图片'));
      const body=node('div');body.append(node('h3',item.name||'未填写组织名称'),node('p',participationLabels[item.participation]??participationLabels.undecided),node('p',(statusLabels[item.status]??statusLabels.pending)+' · '+(item.publicConsent?'已获公开授权':'未获公开授权')));
      if(item.website&&isPublicWebsite(item.website)){const link=node('a','查看组织页面 ↗');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}
      const actions=node('div',undefined,'ah-organization-actions');
      for(const [label,action]of[['编辑','edit'],['上移','up'],['下移','down'],...(item.publicConsent?[['停止公开','withdraw']]:[])]){
        const button=node('button',label);button.type='button';button.dataset.organizationAction=action;button.setAttribute('aria-label',label+'组织 '+item.name);button.dataset.edge=String(action==='up'&&index===0||action==='down'&&index===current.length-1);
        button.addEventListener('click',()=>{
          if(!allowed()||blocked()||uploading||dialog.open)return;
          if(action==='edit'){open(item);return;}
          const next=structuredClone(records()),position=next.findIndex(value=>value.id===item.id);if(position<0)return;
          if(action==='withdraw'){if(!confirm('停止公开此组织？名称、图片、链接与备注会保留，保存并发布后才更新前台。'))return;next[position].publicConsent=false;apply(next,'已在草稿停止公开此组织，资料仍保留。');}
          else{const target=position+(action==='up'?-1:1);if(target<0||target>=next.length)return;[next[position],next[target]]=[next[target],next[position]];apply(next,'组织显示顺序已应用到草稿。');}
        });actions.append(button);
      }
      body.append(actions);card.append(frame,body);output.append(card);
    }
    configure();
  }
  function open(item=null){
    if(!allowed()||blocked()||uploading)return;
    if(!item&&records().length>=200){announce('参与组织最多 200 条，请先核对现有记录。',true);return;}
    reset();const value=item??{id:'organization-'+crypto.randomUUID().replaceAll('-',''),name:'',logoId:'',website:'',participation:'undecided',status:'pending',publicConsent:false,internalNotes:''};editingId=item?.id??null;editContext={content:context().content,revision:context().revision,accountKey};
    for(const [key,text]of Object.entries(value)){const field=form.elements.namedItem(key);if(field?.type==='checkbox')field.checked=text===true;else if(field)field.value=text;}
    image(value.logoId);$('[data-organization-dialog-title]').textContent=(item?'编辑':'新增')+'组织';$('[data-organization-consent-note]').textContent='更改公开资料或图片后，请重新核对授权；保存草稿不会自动公开。';dialog.showModal();notify();configure();
  }
  function close(){if(blocked())return;if((formDirty||uploading)&&!confirm('关闭将放弃本次尚未应用的组织资料，继续吗？'))return;cancelUpload();dialog.close();reset();notify();configure();}
  async function upload(event){
    const file=event.currentTarget.files?.[0];if(!allowed()||blocked()||!dialog.open)return;
    cancelUpload();form.elements.namedItem('logoId').value='';image('');revoke();error();$('[data-organization-image-status]').textContent='';if(!file){configure();return;}
    const started=generation,current=context(),content=current.content,revision=current.revision,key=accountKey,id=form.elements.namedItem('id').value;
    const controller=new AbortController();uploadController=controller;uploading=true;notify();configure();$('[data-organization-image-status]').textContent='正在处理并上传组织图片…';
    const active=()=>started===generation&&!controller.signal.aborted&&key===accountKey&&allowed()&&dialog.open&&context().content===content&&context().revision===revision&&form.elements.namedItem('id').value===id;
    try{
      const prepared=await prepareProfileImage(file,{maxEdge:800,signal:controller.signal});if(!active())return;
      const result=await request('/api/admin/portraits',{method:'POST',body:JSON.stringify(prepared.payload),signal:controller.signal});if(!active())return;
      const proof=result.portrait;if(!portrait.test(proof?.id??'')||proof.contentType!==prepared.payload.contentType||!Number.isSafeInteger(proof.bytes)||proof.bytes<1||proof.bytes>512*1024)throw new Error('图片上传结果尚未核对，请重新选择图片后再应用。');
      form.elements.namedItem('logoId').value=proof.id;image(proof.id);$('[data-organization-image-status]').textContent=processedImageSummary(prepared)+' 请应用、保存并发布。';
    }catch(reason){if(active()){$('[data-organization-image-status]').textContent='图片未确认上传，请重新选择；组织资料尚未应用。';error(reason.message||'图片上传暂未完成。');}}
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
  $('[data-organization-image-remove]').addEventListener('click',()=>{if(!allowed()||blocked())return;cancelUpload();form.elements.namedItem('logoId').value='';$('[data-organization-image]').value='';$('[data-organization-image-status]').textContent='';image('');revoke();configure();});
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!allowed()||blocked()||uploading||!form.reportValidity())return;
    if(!editContext||editContext.content!==context().content||editContext.revision!==context().revision||editContext.accountKey!==accountKey){error('草稿版本已变化，请关闭本次编辑，重新读取组织资料后再修改。');return;}
    const item=Object.fromEntries(['id','name','logoId','website','participation','status','internalNotes'].map(name=>[name,form.elements.namedItem(name).value]));item.publicConsent=form.elements.namedItem('publicConsent').checked;
    if(item.website&&!isPublicWebsite(item.website)){error('请填写不含账号密码的 HTTP 或 HTTPS 网址。');return;}
    const next=structuredClone(records()),position=editingId?next.findIndex(value=>value.id===editingId):-1;
    if(editingId&&position<0){error('此组织记录已变化，请关闭后重新读取草稿。');return;}
    if(position>=0)next[position]=item;else next.push(item);
    try{onApply(next);dialog.close();reset();render();notify();announce('组织修改已应用到草稿。请保存草稿，再发布到公开页。');}catch(reason){error(reason.message||'组织资料尚未应用，请核对后重试。');}
  });
  clear();
  return Object.freeze({render,configure,clear,get uploading(){return uploading;},hasUnapplied:()=>dialog.open||uploading,
    appendPublicPreview(content,output){
      const list=Object.hasOwn(content,'organizations')?content.organizations:createDefaultOrganizations();output.append(node('h3','参与组织'));if(!list.length)output.append(node('p','暂未公布参与组织。'));
      for(const item of list){const card=node('article',undefined,'ah-organization-row'),body=node('div');const logo=(item.logoUrl??'').split('/').at(-1);if(portrait.test(logo??'')){const picture=node('img');picture.src='/api/admin/portraits/'+logo;picture.alt=item.name+'组织图片';picture.width=110;picture.height=90;picture.style.objectFit='contain';card.append(picture);}body.append(node('h4',item.name),node('p',participationLabels[item.participation]??participationLabels.undecided));if(item.website&&isPublicWebsite(item.website)){const link=node('a','组织页面 ↗');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}card.append(body);output.append(card);}
    },
  });
}
