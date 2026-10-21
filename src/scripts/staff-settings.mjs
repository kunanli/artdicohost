import {COLLABORATOR_ROLES,canManageEventOperations,canManageAccounts,canRecoverSystem} from '../../shared/staff-permissions.mjs';
import {createSettingsFormDraft} from '../lib/settings-form-draft.mjs';
const roles={editor:'内容编辑',publisher:'公开发布',outreach:'人员邀约',reviewer:'报名审核',superadmin:'账号与维护'};
const KEY=/^[A-Za-z0-9_-]{43}$/u;
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const safe=value=>plain(value)&&Reflect.ownKeys(value).every(key=>typeof key==='string'&&Object.getOwnPropertyDescriptor(value,key)?.enumerable&&Object.hasOwn(Object.getOwnPropertyDescriptor(value,key),'value'));
const string=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const denseArray=value=>Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype&&Reflect.ownKeys(value).length===value.length+1&&Array.from({length:value.length},(_,index)=>Object.getOwnPropertyDescriptor(value,String(index))).every(descriptor=>descriptor?.enumerable&&Object.hasOwn(descriptor,'value'));
const roleList=value=>denseArray(value)&&value.length>0&&value.length<=5&&new Set(value).size===value.length&&value.every(role=>typeof role==='string'&&Object.hasOwn(roles,role));
export function staffDirectory(value){
  if(!safe(value)||Object.keys(value).sort().join(',')!=='revision,users'||!Number.isSafeInteger(value.revision)||value.revision<0||!denseArray(value.users)||!value.users.length||value.users.length>20)return null;
  const ids=new Set(),names=new Set(),emails=new Set();
  for(const item of value.users){
    if(!safe(item)||Object.keys(item).some(key=>!['id','username','email','label','roles','active','protected'].includes(key))
      ||!string(item.id,80)||!/^[A-Za-z0-9_-]+$/u.test(item.id)||!string(item.username,80)||!/^[a-z0-9_.-]+$/u.test(item.username)
      ||!string(item.label,120)||!item.label.trim()||!roleList(item.roles)||typeof item.active!=='boolean'||typeof item.protected!=='boolean'
      ||Object.hasOwn(item,'email')&&(!string(item.email,254)||!item.email.endsWith('@artdico.co')||!/^[^\s@]+@artdico\.co$/u.test(item.email))
      ||ids.has(item.id)||names.has(item.username)||item.email!==undefined&&emails.has(item.email))return null;
    ids.add(item.id);names.add(item.username);if(item.email!==undefined)emails.add(item.email);
  }
  return structuredClone(value);
}
const rowFingerprint=row=>JSON.stringify({id:row.id,username:row.username,email:row.email,label:row.label,roles:[...row.roles].sort(),active:row.active,protected:row.protected});
/** A directory GET cannot prove that a password write succeeded. Only the actual POST ACK is checked here. */
export function staffUserSaveAcknowledged({input,before,after}={}){
  const original=staffDirectory(before),saved=staffDirectory(after);
  if(!original||!saved||!safe(input)||input.expectedRevision!==original.revision||saved.revision!==original.revision+1||!roleList(input.roles)||typeof input.active!=='boolean'||!string(input.username,80)||!string(input.label,120))return false;
  const existing=input.id===undefined?null:original.users.find(row=>row.id===input.id);
  if(input.id!==undefined&&(!existing||existing.protected)||input.id===undefined&&original.users.some(row=>row.username===input.username.trim().toLowerCase()))return false;
  const matches=saved.users.filter(row=>row.username===input.username.trim().toLowerCase());
  if(matches.length!==1||saved.users.length!==original.users.length+(existing?0:1))return false;
  const target=matches[0],expected={id:existing?.id??target.id,username:input.username.trim().toLowerCase(),label:input.label.trim(),roles:[...input.roles],active:input.active,protected:false,
    ...(input.email!==undefined?{email:input.email.trim().toLowerCase()}:existing?.email?{email:existing.email}:{})};
  if(rowFingerprint(target)!==rowFingerprint(expected)||!existing&&original.users.some(row=>row.id===target.id))return false;
  return original.users.filter(row=>row.id!==existing?.id).every(row=>saved.users.some(next=>rowFingerprint(next)===rowFingerprint(row)));
}
export function generateInitialStaffPassword(random=globalThis.crypto){
  if(typeof random?.getRandomValues!=='function')throw new Error('当前浏览器无法生成独立密码，请使用安全浏览器。');
  const bytes=new Uint8Array(24);random.getRandomValues(bytes);
  const result='Aa1!'+base64(bytes).replace(/\+/gu,'-').replace(/\//gu,'_').replace(/=+$/u,'');bytes.fill(0);return result;
}

/** Superadmin tools never retain passwords, recovery keys or images in browser storage. */
export function createStaffSettings({root,request,binaryRequest,draftStore}){
  const $=selector=>root.querySelector(selector);
  let user=null,busy=false,externalBusy=false,usersRevision=null,groupRevision=null,groupConfigured=false,maintenance=null;
  let accountKey='',userDirty=false,groupDirty=false,restoreDirty=false,groupImageGeneration=0;
  let backupUrl=null,keyUrl=null,userEditRevision=null,generation=0;
  let usersSequence=0,groupSequence=0,maintenanceSequence=0,userDirectory=null,lastGeneratedPassword='';
  const credentials=new Map();
  const drafts=new Map();
  const unknown=new Set();
  function status(message,error=false){$('[data-settings-status]').textContent=error?'':message;$('[data-settings-error]').textContent=error?message:'';$('[data-settings-error]').hidden=!error;if(error)$('[data-settings-error]').focus();}
  function lock(){
    for(const field of root.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!canManageEventOperations(user)||field.hasAttribute('data-settings-protected');
    for(const [selector,allowed]of[['[data-settings-accounts]',canManageAccounts(user)],['[data-settings-recovery]',canRecoverSystem(user)]]){const section=$(selector);section.hidden=!allowed;for(const field of section.querySelectorAll('button,input,select,textarea'))field.disabled||=!allowed;}
    for(const[kind,selector]of [['users','[data-user-form]'],['group','[data-group-form]'],['restore','[data-restore-form]']])if(unknown.has(kind))for(const field of $(selector).querySelectorAll('input,button,select,textarea'))field.disabled=true;
    for(const[kind,selector]of [['users','[data-user-form]'],['group','[data-group-form]'],['restore','[data-restore-form]']])if(drafts.get(kind)?.blocked)for(const field of $(selector).querySelectorAll('input,button,select,textarea'))field.disabled=true;
    for(const field of root.querySelectorAll('[data-users-list] button'))field.disabled||=unknown.has('users')||drafts.get('users')?.blocked;
    for(const field of root.querySelectorAll('[data-user-prefill]'))field.disabled||=unknown.has('users')||drafts.get('users')?.blocked;
    $('[data-user-unknown]').hidden=!unknown.has('users');$('[data-user-discard-unknown]').disabled=busy||externalBusy||!canManageAccounts(user)||!unknown.has('users');
    $('[data-group-disable]').disabled=busy||externalBusy||!canManageEventOperations(user)||!groupConfigured||unknown.has('group')||drafts.get('group')?.blocked;
    $('[data-backup-create]').disabled=busy||externalBusy||!canRecoverSystem(user)||maintenance?.enabled!==true||maintenance?.backup?.available!==true;
    for(const field of $('[data-restore-form]').querySelectorAll('input,button'))field.disabled=busy||externalBusy||!canRecoverSystem(user)||maintenance?.enabled!==true||unknown.has('restore')||drafts.get('restore')?.blocked;
    $('[data-settings-pending]').hidden=unknown.size===0;
    $('[data-settings-pending]').textContent=unknown.size?'上次'+[...unknown].map(kind=>({users:'账号保存',group:'群码修改',restore:'隔离恢复'})[kind]).join('、')+'结果待核对。先刷新对应区块并逐项比较原输入；不会自动重送。恢复结果须按原隔离名称核对审计，不要换名重复提交。':'';
  }
  async function write(kind,path,options,validate){
    if(!(kind==='users'?canManageAccounts(user):kind==='restore'?canRecoverSystem(user):canManageEventOperations(user)))throw new Error('此账号没有执行该设置操作的权限。');
    if(unknown.has(kind))throw new Error('请先核对上次操作结果，不会自动重送。');
    const started=generation;
    const draft=drafts.get(kind);if(draft){await draft.markPending();current(started);}
    try{const value=await request(path,options);current(started);if(validate&&!validate(value))throw new Error('写入结果未通过核对，请保留原输入并刷新对应区块。');if(draft)await draft.discard();current(started);return value;}
    catch(error){if(started===generation){if(!Number.isInteger(error.status)||error.status>=500)unknown.add(kind);else if(!unknown.has(kind)&&draft){await draft.discard();draft.schedule();}}throw error;}
  }
  async function action(callback,permission=canManageEventOperations){if(busy||externalBusy||!permission(user))return;const started=generation;busy=true;lock();try{await callback(started);}catch(error){if(started===generation)status(error.message||'操作尚未完成，请刷新核对后重试。',true);}finally{if(started===generation){busy=false;lock();}}}
  function current(started){if(started!==generation||!canManageEventOperations(user))throw new Error('会话已改变，原操作不会写入新的账号。');}
  function resetUser(){
    userEditRevision=null;userDirty=false;
    $('[data-user-form]').reset();$('[data-user-form] [name=id]').value='';$('[data-user-form] [name=password]').required=true;
    $('[data-user-form] [name=password]').type='password';$('[data-user-password-toggle]').textContent='显示密码';
    $('[data-user-form-title]').textContent='新增工作人员';$('[data-user-password-note]').textContent='新账号请设置至少 12 个字元的独立密码。';
  }
  function wipeSecrets(){
    lastGeneratedPassword='';credentials.clear();$('[data-user-credential-list]').replaceChildren();$('[data-user-credentials]').hidden=true;
    const password=$('[data-user-form] [name=password]');password.value='';password.type='password';$('[data-user-password-toggle]').textContent='显示密码';
    $('[data-restore-form] [name=encryptionKey]').value='';clearBackup();
  }
  async function copyPassword(value,input){
    if(!value){status('请先生成或填写密码。',true);return;}
    try{await navigator.clipboard.writeText(value);status('密码已复制，请私下交付本人。');}
    catch{input.type='text';input.focus();input.select();status('浏览器未允许复制。已选中密码，请手动复制并私下交付。',true);}
  }
  function renderCredentials(){
    const output=$('[data-user-credential-list]');output.replaceChildren();
    for(const[name,value]of credentials){const card=element('div'),label=element('label','用户名：'+name),input=element('input'),actions=element('div'),show=element('button','显示密码'),copy=element('button','复制密码');
      card.className='settings-account-credential';input.type='password';input.value=value;input.readOnly=true;input.autocomplete='off';input.setAttribute('aria-label',name+' 的初始密码');
      actions.className='contacts-action-row';for(const button of[show,copy]){button.type='button';button.className='ah-admin-button';}
      show.addEventListener('click',()=>{input.type=input.type==='password'?'text':'password';show.textContent=input.type==='password'?'显示密码':'隐藏密码';});copy.addEventListener('click',()=>copyPassword(credentials.get(name),input));
      label.append(input);actions.append(show,copy);card.append(label,actions);output.append(card);
    }$('[data-user-credentials]').hidden=!credentials.size;
  }
  function generatePassword(){
    let value;for(let i=0;i<3;i++){value=generateInitialStaffPassword();if(value!==lastGeneratedPassword)break;value=null;}
    if(!value)throw new Error('未生成新的独立密码，请核对浏览器安全环境。');lastGeneratedPassword=value;
    const input=$('[data-user-form] [name=password]');input.value=value;input.type='password';$('[data-user-password-toggle]').textContent='显示密码';userDirty=true;status('已生成本次独立密码。保存成功后才会提供已确认的登录资料。');
  }
  function collaboratorPreset(){for(const field of $('[data-user-form]').querySelectorAll('[name=roles]'))field.checked=COLLABORATOR_ROLES.includes(field.value);userDirty=true;}
  async function configureDrafts(started){
    if(!draftStore||!user?.id)return;
    const accountForm=$('[data-user-form]'),groupForm=$('[data-group-form]'),restoreForm=$('[data-restore-form]');
    const specs=[
      {kind:'group',form:groupForm,ready:groupRevision!==null,revision:()=>groupRevision,fields:['expiresAt'],
        capture:()=>({expiresAt:groupForm.elements.namedItem('expiresAt').value}),validate:value=>string(value.expiresAt,32),apply:value=>{groupForm.elements.namedItem('expiresAt').value=value.expiresAt;groupDirty=true;}},
      {kind:'users',form:accountForm,ready:canManageAccounts(user)&&usersRevision!==null,revision:()=>usersRevision,fields:['id','username','email','label','roles','active'],
        capture:()=>({id:accountForm.elements.namedItem('id').value,username:accountForm.elements.namedItem('username').value,email:accountForm.elements.namedItem('email').value,label:accountForm.elements.namedItem('label').value,roles:[...accountForm.querySelectorAll('[name=roles]:checked')].map(field=>field.value),active:accountForm.elements.namedItem('active').checked}),
        validate:value=>['id','username','email','label'].every(key=>string(value[key],key==='email'?254:120))&&Array.isArray(value.roles)&&value.roles.length<=5&&value.roles.every(role=>Object.hasOwn(roles,role))&&typeof value.active==='boolean',
        apply:value=>{if(value.id&&!userDirectory?.users.some(row=>row.id===value.id&&!row.protected))throw new Error('账号已改变，请核对目录。');resetUser();for(const key of['id','username','email','label'])accountForm.elements.namedItem(key).value=value[key];for(const field of accountForm.querySelectorAll('[name=roles]'))field.checked=value.roles.includes(field.value);accountForm.elements.namedItem('active').checked=value.active;accountForm.elements.namedItem('password').required=!value.id;userEditRevision=usersRevision;userDirty=true;$('[data-user-form-title]').textContent=value.id?'编辑工作人员 · '+value.username:'新增工作人员';}},
      {kind:'restore',form:restoreForm,ready:canRecoverSystem(user),revision:()=>0,fields:['restoreId'],capture:()=>({restoreId:restoreForm.elements.namedItem('restoreId').value}),validate:value=>string(value.restoreId,80),apply:value=>{restoreForm.elements.namedItem('restoreId').value=value.restoreId;restoreDirty=true;}},
    ];
    for(const spec of specs){if(!spec.ready||drafts.has(spec.kind)||started!==generation)continue;
      const draft=createSettingsFormDraft({store:draftStore,actorId:user.id,entity:spec.kind,form:spec.form,policy:{fields:spec.fields,pendingFields:spec.fields,validate:spec.validate},baseRevision:spec.revision,isCurrent:()=>started===generation&&canManageEventOperations(user),capture:spec.capture,apply:spec.apply,onChange:lock,
        onPending:()=>{unknown.add(spec.kind);},onDiscard:()=>{unknown.delete(spec.kind);spec.form.reset();if(spec.kind==='users')resetUser();else if(spec.kind==='group')groupDirty=false;else restoreDirty=false;lock();}});
      drafts.set(spec.kind,draft);try{await draft.load();}catch{}if(started!==generation)return;
    }lock();
  }
  async function loadUsers(){
    if(!canManageAccounts(user))return;
    const started=generation,sequence=++usersSequence,raw=await request('/api/admin/users');current(started);if(sequence!==usersSequence)return;const state=staffDirectory(raw);if(!state)throw new Error('账号列表结果无效。');
    usersRevision=state.revision;userDirectory=state;if(unknown.has('users'))status('已读取目录，但不能确认上次密码是否生效。请核对后放弃本页未确认操作，再编辑已有账号。',true);const output=$('[data-users-list]');output.replaceChildren();
    for(const item of state.users){
      const row=element('tr'),identity=element('td',item.label||item.username);identity.append(element('small',item.username+(item.email?' · '+item.email:'')));row.append(identity,element('td',(item.roles??[]).map(role=>roles[role]??role).join(' / ')),element('td',item.active===false?'已停用':'已启用'));
      const actionCell=element('td'),button=element('button',item.protected?'受保护账号':'编辑账号');button.type='button';button.className='ah-admin-button';
      if(item.protected){button.dataset.settingsProtected='';button.disabled=true;}
      button.addEventListener('click',()=>{if(item.protected||busy||externalBusy||unknown.has('users')||drafts.get('users')?.blocked)return;if(userDirty&&!confirm('账号表单有未保存内容，放弃后编辑另一个账号吗？'))return;resetUser();userEditRevision=usersRevision;const form=$('[data-user-form]');for(const key of ['id','username','email','label'])form.elements.namedItem(key).value=item[key]??'';form.elements.namedItem('active').checked=item.active!==false;for(const input of form.querySelectorAll('[name=roles]'))input.checked=item.roles.includes(input.value);form.elements.namedItem('password').required=false;$('[data-user-form-title]').textContent='编辑工作人员 · '+item.username;$('[data-user-password-note]').textContent='留空保留原密码；填写新密码将使原会话失效。';drafts.get('users')?.schedule();form.scrollIntoView({block:'start',behavior:'smooth'});});
      actionCell.append(button);row.append(actionCell);output.append(row);
    }
  }
  async function loadGroup(){
    const started=generation,sequence=++groupSequence,state=await request('/api/admin/group-invite');current(started);if(sequence!==groupSequence)return;if(!Number.isSafeInteger(state.revision)||state.revision<0||typeof state.configured!=='boolean'||typeof state.expired!=='boolean'||state.configured&&!Number.isFinite(Date.parse(state.expiresAt)))throw new Error('群码状态结果无效。');
    groupRevision=state.revision;groupConfigured=state.configured===true;if(unknown.has('group'))status('已重新读取群码。读取不能证明先前修改成功，请人工核对后解除本机锁定。',true);
    $('[data-group-status]').textContent=!groupConfigured?'尚未配置入群图片，报名保存成功仍会显示编号。':(state.expired?'当前二维码已过期。':'当前二维码已配置。')+' 到期时间：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(state.expiresAt))+'（UTC+8）';
    const old=$('[data-group-image]'),image=old.cloneNode(false),stamp=++groupImageGeneration;old.removeAttribute('src');old.replaceWith(image);image.hidden=true;image.removeAttribute('src');if(groupConfigured){image.addEventListener('error',()=>{if(started===generation&&stamp===groupImageGeneration)image.hidden=true;},{once:true});image.src='/api/admin/group-invite/image';image.hidden=false;}
    root.dispatchEvent(new CustomEvent('staff-settings-state',{detail:{configured:groupConfigured,expired:state.expired,expiresAt:groupConfigured?state.expiresAt:null}}));
  }
  async function loadMaintenance(){if(!canRecoverSystem(user))return;const started=generation,sequence=++maintenanceSequence,value=await request('/api/admin/maintenance');current(started);if(sequence!==maintenanceSequence)return;maintenance=value;if(unknown.has('restore'))status('维护能力已读取。不能据此确认先前恢复结果；请按原隔离恢复名称核对审计并解除本机锁定，不要换名重复提交。',true);$('[data-maintenance-status]').textContent=maintenance.enabled===true?'可创建加密备份，并验证恢复到隔离位置。旧会话不会恢复；生产切换仍须另行核对。':'维护工具尚未就绪，请使用核定的人工运维流程。';lock();}
  function clearBackup(){if(backupUrl)URL.revokeObjectURL(backupUrl);if(keyUrl)URL.revokeObjectURL(keyUrl);backupUrl=null;keyUrl=null;$('[data-backup-result]').hidden=true;for(const selector of ['[data-backup-download]','[data-backup-key-download]'])$(selector).removeAttribute('href');$('[data-backup-summary]').textContent='';}
  $('[data-users-refresh]').addEventListener('click',()=>action(loadUsers,canManageAccounts));
  $('[data-user-reset]').addEventListener('click',async()=>{if(drafts.get('users')?.blocked)return;try{await drafts.get('users')?.discard();resetUser();}catch{status('本机草稿尚未清除，请保留当前填写。',true);}});
  $('[data-user-password-generate]').addEventListener('click',()=>{try{generatePassword();}catch(error){status(error.message,true);}});
  $('[data-user-password-toggle]').addEventListener('click',()=>{const input=$('[data-user-form] [name=password]');input.type=input.type==='password'?'text':'password';$('[data-user-password-toggle]').textContent=input.type==='password'?'显示密码':'隐藏密码';});
  $('[data-user-password-copy]').addEventListener('click',()=>copyPassword($('[data-user-form] [name=password]').value,$('[data-user-form] [name=password]')));
  $('[data-user-credentials-clear]').addEventListener('click',()=>{wipeSecrets();status('已清空本页密码与备份下载入口。账号本身未改变。');});
  $('[data-user-collaborator-preset]').addEventListener('click',collaboratorPreset);
  for(const button of root.querySelectorAll('[data-user-prefill]'))button.addEventListener('click',()=>{
    const name=button.dataset.userPrefill;if(!canManageAccounts(user)||busy||externalBusy||unknown.has('users'))return;
    if(userDirectory?.users.some(item=>item.username===name)){status(name+' 已在目录中，请使用该行的编辑账号；不会重复新增。',true);return;}
    if(userDirty&&!confirm('放弃当前账号表单，准备 '+name+' 的日常协作账号吗？'))return;
    resetUser();const form=$('[data-user-form]');form.elements.namedItem('username').value=name;form.elements.namedItem('label').value=name;collaboratorPreset();
    try{generatePassword();drafts.get('users')?.schedule();form.scrollIntoView({block:'start',behavior:'smooth'});}catch(error){status(error.message,true);}
  });
  $('[data-user-discard-unknown]').addEventListener('click',async()=>{if(!canManageAccounts(user)||busy||externalBusy||!unknown.has('users'))return;if(!confirm('仅放弃本页未确认输入，不会撤销或重送服务器操作。已核对目录后继续吗？'))return;try{await drafts.get('users')?.discard();unknown.delete('users');resetUser();lock();status('已放弃本页未确认输入。若账号已存在，请编辑已有账号并设置新的独立密码。');}catch{status('本机待核对记录尚未清除，请保留当前页面。',true);}});
  for(const [selector,mark]of [['[data-user-form]',()=>{userDirty=true;}],['[data-group-form]',()=>{groupDirty=true;}],['[data-restore-form]',()=>{restoreDirty=true;}]]){const form=$(selector);form.addEventListener('input',mark);form.addEventListener('change',mark);}
  $('[data-user-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||usersRevision===null)return;
    const data=new FormData(form);const input={expectedRevision:userEditRevision??usersRevision,username:data.get('username'),label:data.get('label')||data.get('username'),roles:data.getAll('roles'),active:data.has('active')};
    if(data.get('email'))input.email=data.get('email');
    if(data.get('id'))input.id=data.get('id');if(data.get('password'))input.password=data.get('password');
    const before=userDirectory?structuredClone(userDirectory):null;
    action(async started=>{try{current(started);if(!before||before.revision!==input.expectedRevision)throw new Error('账号目录已改变，请刷新并重新核对表单。');
      const saved=await write('users','/api/admin/users',{method:'POST',body:JSON.stringify(input)},value=>staffUserSaveAcknowledged({input,before,after:value}));current(started);
      if(input.password){credentials.set(input.username.trim().toLowerCase(),input.password);renderCredentials();}
      usersSequence++;userDirectory=staffDirectory(saved);usersRevision=saved.revision;resetUser();await loadUsers();current(started);status('工作人员账号已保存并核对权限。请私下交付本页已确认的登录资料。');
    }finally{if(started===generation)form.elements.namedItem('password').value='';input.password='';}},canManageAccounts);
  });
  $('[data-group-refresh]').addEventListener('click',()=>action(loadGroup));
  $('[data-group-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||groupRevision===null)return;
    const file=form.elements.namedItem('image').files?.[0],date=form.elements.namedItem('expiresAt').value,expectedRevision=groupRevision;
    action(async started=>{
      if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>512*1024)throw new Error('请选择不超过 512 KiB 的 PNG、JPEG 或 WebP 原图。');
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(date))throw new Error('请填写已核对的准确到期时间。');
      const expiresAt=date+':00+08:00',time=Date.parse(expiresAt);if(!Number.isFinite(time)||time<=Date.now()||time>Date.now()+7*86400000)throw new Error('到期时间须在未来 7 天内，并与图片真实有效期一致。');
      const bytes=new Uint8Array(await file.arrayBuffer());current(started);await write('group','/api/admin/group-invite',{method:'POST',body:JSON.stringify({expectedRevision,contentType:file.type,dataBase64:base64(bytes),expiresAt})},value=>value.revision===expectedRevision+1&&value.configured===true&&value.expiresAt===new Date(expiresAt).toISOString());current(started);
      groupSequence++;form.reset();groupDirty=false;await loadGroup();current(started);status('当前入群图片已更新。旧入口失效，过期时间不会自动延长。');
    });
  });
  $('[data-group-disable]').addEventListener('click',()=>action(async started=>{if(!confirm('关闭后，新的报名成功收据不再提供群码。报名编号与已保存资料不受影响。确认关闭吗？'))return;const expectedRevision=groupRevision;await write('group','/api/admin/group-invite',{method:'PUT',body:JSON.stringify({expectedRevision,enabled:false})},value=>value.revision===expectedRevision+1&&value.configured===false);current(started);groupSequence++;await loadGroup();current(started);status('已关闭入群图片；已保存报名仍然有效。');}));
  $('[data-maintenance-refresh]').addEventListener('click',()=>action(loadMaintenance,canRecoverSystem));
  $('[data-backup-create]').addEventListener('click',()=>action(async()=>{
    const started=generation;
    if(!confirm('创建包含私有资料的加密备份？请确认能将备份文件与恢复密钥分别存放在受控位置。'))return;
    const random=crypto.getRandomValues(new Uint8Array(32)),encryptionKey=base64(random).replace(/\+/gu,'-').replace(/\//gu,'_').replace(/=+$/u,'');
    if(!KEY.test(encryptionKey))throw new Error('当前浏览器无法生成安全恢复密钥。');
    const response=await binaryRequest('/api/admin/maintenance/backup',{encryptionKey,confirmation:'CREATE_ENCRYPTED_BACKUP'});
    if(!response.headers.get('content-type')?.startsWith('application/octet-stream'))throw new Error('备份结果无效，未提供下载。');
    const blob=await response.blob();if(!blob.size||blob.size>1500000)throw new Error('备份文件超过网页处理上限，请使用受控维护工具。');
    if(started!==generation||!user)throw new Error('会话已改变，未提供备份或密钥下载。');
    clearBackup();backupUrl=URL.createObjectURL(blob);keyUrl=URL.createObjectURL(new Blob([encryptionKey+'\n'],{type:'text/plain'}));
    const stamp=new Date().toISOString().slice(0,19).replace(/[:T]/gu,'-');
    $('[data-backup-download]').href=backupUrl;$('[data-backup-download]').download='artdico-'+stamp+'.artdico-backup';
    $('[data-backup-key-download]').href=keyUrl;$('[data-backup-key-download]').download='artdico-recovery-key-'+stamp+'.txt';
    const hash=response.headers.get('x-backup-sha256');$('[data-backup-summary]').textContent=/^[a-f0-9]{64}$/u.test(hash??'')?'备份 SHA-256：'+hash:'请保留下载文件与独立恢复密钥。';
    $('[data-backup-result]').hidden=false;status('加密备份已生成。请点击两个下载入口，分别妥善保存。');random.fill(0);
  },canRecoverSystem));
  $('[data-restore-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
    const encryptionKey=form.elements.namedItem('encryptionKey').value,restoreId=form.elements.namedItem('restoreId').value,file=form.elements.namedItem('bundle').files?.[0];
    action(async started=>{try{
      if(!KEY.test(encryptionKey)||!file?.size||file.size>1500000)throw new Error('请提供有效恢复密钥及不超过 1.5 MB 的加密备份文件。');
      if(!confirm('确认验证备份并写入一个新的隔离恢复位置？不会覆盖生产或恢复旧会话。'))return;
      const bytes=new Uint8Array(await file.arrayBuffer());current(started);const result=await write('restore','/api/admin/maintenance/restore',{method:'POST',body:JSON.stringify({encryptionKey,bundleBase64:base64(bytes),restoreId,confirmation:'RESTORE_TO_ISOLATED_NAMESPACE'})},value=>value.restored===true&&value.active===false&&value.sessionsRestored===false&&Number.isSafeInteger(value.objectCount)&&value.objectCount>=0);current(started);
      restoreDirty=false;$('[data-restore-result]').textContent='已验证并恢复 '+result.objectCount+' 个对象到隔离位置。生产仍未切换，旧会话未恢复。';status('隔离恢复已完成；正式恢复切换需要另行核对。');
    }finally{if(started===generation)form.elements.namedItem('encryptionKey').value='';}},canRecoverSystem);
  });
  function clear(){
    for(const draft of drafts.values())draft.close();drafts.clear();
    generation++;usersSequence++;groupSequence++;maintenanceSequence++;groupImageGeneration++;unknown.clear();user=null;busy=false;accountKey='';userDirty=false;groupDirty=false;restoreDirty=false;usersRevision=null;userDirectory=null;groupRevision=null;groupConfigured=false;maintenance=null;root.hidden=true;wipeSecrets();
    for(const form of root.querySelectorAll('form')){form.reset();for(const field of form.querySelectorAll('input[type=hidden]'))field.value='';}
    $('[data-users-list]').replaceChildren();$('[data-group-image]').removeAttribute('src');$('[data-group-image]').hidden=true;$('[data-restore-result]').textContent='';$('[data-group-status]').textContent='群码状态尚未载入。';$('[data-maintenance-status]').textContent='维护能力尚未载入。';status('');lock();
  }
  return Object.freeze({
    get pending(){return busy||unknown.size>0;},get dirty(){return userDirty||groupDirty||restoreDirty;},clear,wipeSecrets,lock(value){externalBusy=value;lock();},
    async configure(account){
      const key=account?.id+'|'+[...(account?.roles??[])].sort().join(',');if(key!==accountKey)clear();user=account;accountKey=key;root.hidden=!canManageEventOperations(user);if(root.hidden){clear();return;}
      const started=generation,results=await Promise.allSettled([loadGroup(),...(canManageAccounts(user)?[loadUsers()]:[]),...(canRecoverSystem(user)?[loadMaintenance()]:[])]);if(started!==generation)return;
      await configureDrafts(started);if(started!==generation)return;
      if(results.some(result=>result.status==='rejected'))status('部分设置尚未载入，可分别刷新核对。',true);lock();
    },
  });
}
