const roles={editor:'内容编辑',publisher:'公开发布',outreach:'人员邀约',reviewer:'报名审核',superadmin:'账号与维护'};
const KEY=/^[A-Za-z0-9_-]{43}$/u;
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}

/** Superadmin tools never retain passwords, recovery keys or images in browser storage. */
export function createStaffSettings({root,request,binaryRequest}){
  const $=selector=>root.querySelector(selector);
  let user=null,busy=false,externalBusy=false,usersRevision=null,groupRevision=null,groupConfigured=false,maintenance=null;
  let accountKey='',userDirty=false,groupDirty=false,restoreDirty=false,groupImageGeneration=0;
  let backupUrl=null,keyUrl=null,userEditRevision=null,generation=0;
  let usersSequence=0,groupSequence=0,maintenanceSequence=0;
  const unknown=new Set();
  function status(message,error=false){$('[data-settings-status]').textContent=error?'':message;$('[data-settings-error]').textContent=error?message:'';$('[data-settings-error]').hidden=!error;if(error)$('[data-settings-error]').focus();}
  function lock(){
    for(const field of root.querySelectorAll('button,input,select,textarea'))field.disabled=busy||externalBusy||!user?.roles.includes('superadmin')||field.hasAttribute('data-settings-protected');
    for(const[kind,selector]of [['users','[data-user-form]'],['group','[data-group-form]'],['restore','[data-restore-form]']])if(unknown.has(kind))for(const field of $(selector).querySelectorAll('input,button,select,textarea'))field.disabled=true;
    for(const field of root.querySelectorAll('[data-users-list] button'))field.disabled||=unknown.has('users');
    $('[data-group-disable]').disabled=busy||externalBusy||!groupConfigured||unknown.has('group');
    $('[data-backup-create]').disabled=busy||externalBusy||maintenance?.enabled!==true||maintenance?.backup?.available!==true;
    for(const field of $('[data-restore-form]').querySelectorAll('input,button'))field.disabled=busy||externalBusy||maintenance?.enabled!==true||unknown.has('restore');
    $('[data-settings-pending]').hidden=unknown.size===0;
    $('[data-settings-pending]').textContent=unknown.size?'上次'+[...unknown].map(kind=>({users:'账号保存',group:'群码修改',restore:'隔离恢复'})[kind]).join('、')+'结果待核对。先刷新对应区块并逐项比较原输入；不会自动重送。恢复结果须按原隔离名称核对审计，不要换名重复提交。':'';
  }
  async function write(kind,path,options,validate){
    if(unknown.has(kind))throw new Error('请先刷新对应区块，核对上次操作结果。');
    const started=generation;
    try{const value=await request(path,options);current(started);if(validate&&!validate(value))throw new Error('写入结果未通过核对，请保留原输入并刷新对应区块。');return value;}
    catch(error){if(started===generation&&(!Number.isInteger(error.status)||error.status>=500))unknown.add(kind);throw error;}
  }
  async function action(callback){if(busy||externalBusy||!user?.roles.includes('superadmin'))return;const started=generation;busy=true;lock();try{await callback(started);}catch(error){if(started===generation)status(error.message||'操作尚未完成，请刷新核对后重试。',true);}finally{if(started===generation){busy=false;lock();}}}
  function current(started){if(started!==generation||!user?.roles.includes('superadmin'))throw new Error('会话已改变，原操作不会写入新的账号。');}
  function resetUser(){
    userEditRevision=null;userDirty=false;
    $('[data-user-form]').reset();$('[data-user-form] [name=id]').value='';$('[data-user-form] [name=password]').required=true;
    $('[data-user-form-title]').textContent='新增工作人员';$('[data-user-password-note]').textContent='新账号请设置至少 12 个字元的独立密码。';
  }
  async function loadUsers(){
    const started=generation,sequence=++usersSequence,state=await request('/api/admin/users');current(started);if(sequence!==usersSequence)return;if(!Number.isSafeInteger(state.revision)||!Array.isArray(state.users))throw new Error('账号列表结果无效。');
    usersRevision=state.revision;if(unknown.delete('users'))status('已重新读取账号。请逐项比较原输入，读取成功不代表先前保存成功。');const output=$('[data-users-list]');output.replaceChildren();
    for(const item of state.users){
      const row=element('tr'),identity=element('td',item.label||item.username);identity.append(element('small',item.username+(item.email?' · '+item.email:'')));row.append(identity,element('td',(item.roles??[]).map(role=>roles[role]??role).join(' / ')),element('td',item.active===false?'已停用':'已启用'));
      const actionCell=element('td'),button=element('button',item.protected?'受保护账号':'编辑账号');button.type='button';button.className='ah-admin-button';
      if(item.protected){button.dataset.settingsProtected='';button.disabled=true;}
      button.addEventListener('click',()=>{if(item.protected||busy||externalBusy||unknown.has('users'))return;if(userDirty&&!confirm('账号表单有未保存内容，放弃后编辑另一个账号吗？'))return;resetUser();userEditRevision=usersRevision;const form=$('[data-user-form]');for(const key of ['id','username','email','label'])form.elements.namedItem(key).value=item[key]??'';form.elements.namedItem('active').checked=item.active!==false;for(const input of form.querySelectorAll('[name=roles]'))input.checked=item.roles.includes(input.value);form.elements.namedItem('password').required=false;$('[data-user-form-title]').textContent='编辑工作人员 · '+item.username;$('[data-user-password-note]').textContent='留空保留原密码；填写新密码将使原会话失效。';form.scrollIntoView({block:'start',behavior:'smooth'});});
      actionCell.append(button);row.append(actionCell);output.append(row);
    }
  }
  async function loadGroup(){
    const started=generation,sequence=++groupSequence,state=await request('/api/admin/group-invite');current(started);if(sequence!==groupSequence)return;if(!Number.isSafeInteger(state.revision)||state.revision<0||typeof state.configured!=='boolean'||typeof state.expired!=='boolean'||state.configured&&!Number.isFinite(Date.parse(state.expiresAt)))throw new Error('群码状态结果无效。');
    groupRevision=state.revision;groupConfigured=state.configured===true;if(unknown.delete('group'))status('已重新读取群码。请核对图片与到期时间，读取成功不代表先前修改成功。');
    $('[data-group-status]').textContent=!groupConfigured?'尚未配置入群图片，报名保存成功仍会显示编号。':(state.expired?'当前二维码已过期。':'当前二维码已配置。')+' 到期时间：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(state.expiresAt))+'（UTC+8）';
    const old=$('[data-group-image]'),image=old.cloneNode(false),stamp=++groupImageGeneration;old.removeAttribute('src');old.replaceWith(image);image.hidden=true;image.removeAttribute('src');if(groupConfigured){image.addEventListener('error',()=>{if(started===generation&&stamp===groupImageGeneration)image.hidden=true;},{once:true});image.src='/api/admin/group-invite/image';image.hidden=false;}
    root.dispatchEvent(new CustomEvent('staff-settings-state',{detail:{configured:groupConfigured,expired:state.expired,expiresAt:groupConfigured?state.expiresAt:null}}));
  }
  async function loadMaintenance(){const started=generation,sequence=++maintenanceSequence,value=await request('/api/admin/maintenance');current(started);if(sequence!==maintenanceSequence)return;maintenance=value;if(unknown.delete('restore'))status('维护能力已读取。不能据此确认先前恢复结果；请按原隔离恢复名称核对审计，不要换名重复提交。',true);$('[data-maintenance-status]').textContent=maintenance.enabled===true?'可创建加密备份，并验证恢复到隔离位置。旧会话不会恢复；生产切换仍须另行核对。':'维护工具尚未就绪，请使用核定的人工运维流程。';lock();}
  function clearBackup(){if(backupUrl)URL.revokeObjectURL(backupUrl);if(keyUrl)URL.revokeObjectURL(keyUrl);backupUrl=null;keyUrl=null;$('[data-backup-result]').hidden=true;for(const selector of ['[data-backup-download]','[data-backup-key-download]'])$(selector).removeAttribute('href');$('[data-backup-summary]').textContent='';}
  $('[data-users-refresh]').addEventListener('click',()=>action(loadUsers));
  $('[data-user-reset]').addEventListener('click',resetUser);
  for(const [selector,mark]of [['[data-user-form]',()=>{userDirty=true;}],['[data-group-form]',()=>{groupDirty=true;}],['[data-restore-form]',()=>{restoreDirty=true;}]]){const form=$(selector);form.addEventListener('input',mark);form.addEventListener('change',mark);}
  $('[data-user-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||usersRevision===null)return;
    const data=new FormData(form);const input={expectedRevision:userEditRevision??usersRevision,username:data.get('username'),label:data.get('label')||data.get('username'),roles:data.getAll('roles'),active:data.has('active')};
    if(data.get('email'))input.email=data.get('email');
    if(data.get('id'))input.id=data.get('id');if(data.get('password'))input.password=data.get('password');
    action(async started=>{try{current(started);await write('users','/api/admin/users',{method:'POST',body:JSON.stringify(input)},value=>value.revision===input.expectedRevision+1&&Array.isArray(value.users));current(started);usersSequence++;resetUser();await loadUsers();current(started);status('工作人员账号已保存；权限与密码由服务端处理，未向公开页面提供。');}finally{if(started===generation)form.elements.namedItem('password').value='';input.password='';}});
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
  $('[data-maintenance-refresh]').addEventListener('click',()=>action(loadMaintenance));
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
  }));
  $('[data-restore-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;
    const encryptionKey=form.elements.namedItem('encryptionKey').value,restoreId=form.elements.namedItem('restoreId').value,file=form.elements.namedItem('bundle').files?.[0];
    action(async started=>{try{
      if(!KEY.test(encryptionKey)||!file?.size||file.size>1500000)throw new Error('请提供有效恢复密钥及不超过 1.5 MB 的加密备份文件。');
      if(!confirm('确认验证备份并写入一个新的隔离恢复位置？不会覆盖生产或恢复旧会话。'))return;
      const bytes=new Uint8Array(await file.arrayBuffer());current(started);const result=await write('restore','/api/admin/maintenance/restore',{method:'POST',body:JSON.stringify({encryptionKey,bundleBase64:base64(bytes),restoreId,confirmation:'RESTORE_TO_ISOLATED_NAMESPACE'})},value=>value.restored===true&&value.active===false&&value.sessionsRestored===false&&Number.isSafeInteger(value.objectCount)&&value.objectCount>=0);current(started);
      restoreDirty=false;$('[data-restore-result]').textContent='已验证并恢复 '+result.objectCount+' 个对象到隔离位置。生产仍未切换，旧会话未恢复。';status('隔离恢复已完成；正式恢复切换需要另行核对。');
    }finally{if(started===generation)form.elements.namedItem('encryptionKey').value='';}});
  });
  function clear(){
    generation++;usersSequence++;groupSequence++;maintenanceSequence++;groupImageGeneration++;unknown.clear();user=null;busy=false;accountKey='';userDirty=false;groupDirty=false;restoreDirty=false;usersRevision=null;groupRevision=null;groupConfigured=false;maintenance=null;root.hidden=true;clearBackup();
    for(const form of root.querySelectorAll('form')){form.reset();for(const field of form.querySelectorAll('input[type=hidden]'))field.value='';}
    $('[data-users-list]').replaceChildren();$('[data-group-image]').removeAttribute('src');$('[data-group-image]').hidden=true;$('[data-restore-result]').textContent='';$('[data-group-status]').textContent='群码状态尚未载入。';$('[data-maintenance-status]').textContent='维护能力尚未载入。';status('');lock();
  }
  return Object.freeze({
    get pending(){return busy||unknown.size>0;},get dirty(){return userDirty||groupDirty||restoreDirty;},clear,lock(value){externalBusy=value;lock();},
    async configure(account){
      const key=account?.id+'|'+[...(account?.roles??[])].sort().join(',');if(key!==accountKey)clear();user=account;accountKey=key;root.hidden=!user?.roles.includes('superadmin');if(root.hidden){clear();return;}
      const started=generation,results=await Promise.allSettled([loadUsers(),loadGroup(),loadMaintenance()]);if(started!==generation)return;
      if(results.some(result=>result.status==='rejected'))status('部分设置尚未载入，可分别刷新核对。',true);lock();
    },
  });
}
