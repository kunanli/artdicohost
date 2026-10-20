const roles={editor:'内容编辑',publisher:'公开发布',outreach:'人员邀约',reviewer:'报名审核',superadmin:'账号与维护'};
const KEY=/^[A-Za-z0-9_-]{43}$/u;
function element(tag,text){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;}
function base64(bytes){let value='';for(let i=0;i<bytes.length;i+=32768)value+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(value);}

/** Superadmin tools never retain passwords, recovery keys or images in browser storage. */
export function createStaffSettings({root,request,binaryRequest}){
  const $=selector=>root.querySelector(selector);
  let user=null,busy=false,usersRevision=null,groupRevision=null,groupConfigured=false,maintenance=null;
  let backupUrl=null,keyUrl=null,userEditRevision=null,generation=0;
  function status(message,error=false){$('[data-settings-status]').textContent=error?'':message;$('[data-settings-error]').textContent=error?message:'';$('[data-settings-error]').hidden=!error;if(error)$('[data-settings-error]').focus();}
  function lock(){
    for(const field of root.querySelectorAll('button,input,select,textarea'))field.disabled=busy||!user?.roles.includes('superadmin')||field.hasAttribute('data-settings-protected');
    $('[data-group-disable]').disabled=busy||!groupConfigured;
    $('[data-backup-create]').disabled=busy||maintenance?.enabled!==true||maintenance?.backup?.available!==true;
    for(const field of $('[data-restore-form]').querySelectorAll('input,button'))field.disabled=busy||maintenance?.enabled!==true;
  }
  async function action(callback){if(busy)return;busy=true;lock();try{await callback();}catch(error){status(error.message||'操作尚未完成，请刷新核对后重试。',true);}finally{busy=false;lock();}}
  function resetUser(){
    userEditRevision=null;
    $('[data-user-form]').reset();$('[data-user-form] [name=id]').value='';$('[data-user-form] [name=password]').required=true;
    $('[data-user-form-title]').textContent='新增工作人员';$('[data-user-password-note]').textContent='新账号请设置至少 12 个字元的独立密码。';
  }
  async function loadUsers(){
    const state=await request('/api/admin/users');if(!Number.isSafeInteger(state.revision)||!Array.isArray(state.users))throw new Error('账号列表结果无效。');
    usersRevision=state.revision;const output=$('[data-users-list]');output.replaceChildren();
    for(const item of state.users){
      const row=element('tr'),identity=element('td',item.label||item.username);identity.append(element('small',item.username+(item.email?' · '+item.email:'')));row.append(identity,element('td',(item.roles??[]).map(role=>roles[role]??role).join(' / ')),element('td',item.active===false?'已停用':'已启用'));
      const actionCell=element('td'),button=element('button',item.protected?'受保护账号':'编辑账号');button.type='button';button.className='ah-admin-button';
      if(item.protected){button.dataset.settingsProtected='';button.disabled=true;}
      button.addEventListener('click',()=>{if(item.protected||busy)return;resetUser();userEditRevision=usersRevision;const form=$('[data-user-form]');for(const key of ['id','username','email','label'])form.elements.namedItem(key).value=item[key]??'';form.elements.namedItem('active').checked=item.active!==false;for(const input of form.querySelectorAll('[name=roles]'))input.checked=item.roles.includes(input.value);form.elements.namedItem('password').required=false;$('[data-user-form-title]').textContent='编辑工作人员 · '+item.username;$('[data-user-password-note]').textContent='留空保留原密码；填写新密码将使原会话失效。';form.scrollIntoView({block:'start',behavior:'smooth'});});
      actionCell.append(button);row.append(actionCell);output.append(row);
    }
  }
  async function loadGroup(){
    const state=await request('/api/admin/group-invite');if(!Number.isSafeInteger(state.revision))throw new Error('群码状态结果无效。');
    groupRevision=state.revision;groupConfigured=state.configured===true;
    $('[data-group-status]').textContent=!groupConfigured?'尚未配置入群图片，报名保存成功仍会显示编号。':(state.expired?'当前二维码已过期。':'当前二维码已配置。')+' 到期时间：'+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Taipei',dateStyle:'medium',timeStyle:'short'}).format(new Date(state.expiresAt))+'（UTC+8）';
    const image=$('[data-group-image]');image.hidden=true;image.removeAttribute('src');if(groupConfigured){image.src='/api/admin/group-invite/image';image.hidden=false;}
  }
  async function loadMaintenance(){maintenance=await request('/api/admin/maintenance');$('[data-maintenance-status]').textContent=maintenance.enabled===true?'可创建加密备份，并验证恢复到隔离位置。旧会话不会恢复；生产切换仍须另行核对。':'维护工具尚未就绪，请使用核定的人工运维流程。';lock();}
  function clearBackup(){if(backupUrl)URL.revokeObjectURL(backupUrl);if(keyUrl)URL.revokeObjectURL(keyUrl);backupUrl=null;keyUrl=null;$('[data-backup-result]').hidden=true;for(const selector of ['[data-backup-download]','[data-backup-key-download]'])$(selector).removeAttribute('href');$('[data-backup-summary]').textContent='';}
  $('[data-users-refresh]').addEventListener('click',()=>action(loadUsers));
  $('[data-user-reset]').addEventListener('click',resetUser);
  $('[data-user-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||usersRevision===null)return;
    const data=new FormData(form);const input={expectedRevision:userEditRevision??usersRevision,username:data.get('username'),label:data.get('label')||data.get('username'),roles:data.getAll('roles'),active:data.has('active')};
    if(data.get('email'))input.email=data.get('email');
    if(data.get('id'))input.id=data.get('id');if(data.get('password'))input.password=data.get('password');
    action(async()=>{try{await request('/api/admin/users',{method:'POST',body:JSON.stringify(input)});resetUser();await loadUsers();status('工作人员账号已保存；权限与密码由服务端处理，未向公开页面提供。');}finally{form.elements.namedItem('password').value='';input.password='';}});
  });
  $('[data-group-refresh]').addEventListener('click',()=>action(loadGroup));
  $('[data-group-image]').addEventListener('error',()=>{$('[data-group-image]').hidden=true;});
  $('[data-group-form]').addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;if(!form.reportValidity()||groupRevision===null)return;
    const file=form.elements.namedItem('image').files?.[0],date=form.elements.namedItem('expiresAt').value;
    action(async()=>{
      if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>512*1024)throw new Error('请选择不超过 512 KiB 的 PNG、JPEG 或 WebP 原图。');
      if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u.test(date))throw new Error('请填写已核对的准确到期时间。');
      const expiresAt=date+':00+08:00',time=Date.parse(expiresAt);if(!Number.isFinite(time)||time<=Date.now()||time>Date.now()+7*86400000)throw new Error('到期时间须在未来 7 天内，并与图片真实有效期一致。');
      await request('/api/admin/group-invite',{method:'POST',body:JSON.stringify({expectedRevision:groupRevision,contentType:file.type,dataBase64:base64(new Uint8Array(await file.arrayBuffer())),expiresAt})});
      form.reset();await loadGroup();status('当前入群图片已更新。旧入口失效，过期时间不会自动延长。');
    });
  });
  $('[data-group-disable]').addEventListener('click',()=>action(async()=>{if(!confirm('关闭后，新的报名成功收据不再提供群码。报名编号与已保存资料不受影响。确认关闭吗？'))return;await request('/api/admin/group-invite',{method:'PUT',body:JSON.stringify({expectedRevision:groupRevision,enabled:false})});await loadGroup();status('已关闭入群图片；已保存报名仍然有效。');}));
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
    action(async()=>{try{
      if(!KEY.test(encryptionKey)||!file?.size||file.size>1500000)throw new Error('请提供有效恢复密钥及不超过 1.5 MB 的加密备份文件。');
      if(!confirm('确认验证备份并写入一个新的隔离恢复位置？不会覆盖生产或恢复旧会话。'))return;
      const result=await request('/api/admin/maintenance/restore',{method:'POST',body:JSON.stringify({encryptionKey,bundleBase64:base64(new Uint8Array(await file.arrayBuffer())),restoreId,confirmation:'RESTORE_TO_ISOLATED_NAMESPACE'})});
      if(result.restored!==true||result.active!==false||result.sessionsRestored!==false)throw new Error('恢复结果未通过核对，不能宣称已完成。');
      $('[data-restore-result]').textContent='已验证并恢复 '+result.objectCount+' 个对象到隔离位置。生产仍未切换，旧会话未恢复。';status('隔离恢复已完成；正式恢复切换需要另行核对。');
    }finally{form.elements.namedItem('encryptionKey').value='';}});
  });
  return Object.freeze({
    async configure(account){
      user=account;root.hidden=!user?.roles.includes('superadmin');if(root.hidden)return;
      const results=await Promise.allSettled([loadUsers(),loadGroup(),loadMaintenance()]);
      if(results.some(result=>result.status==='rejected'))status('部分维护能力尚未就绪，可分别刷新核对；没有因此执行配置修改。',true);
      lock();
    },
    clear(){generation+=1;user=null;usersRevision=null;groupRevision=null;groupConfigured=false;maintenance=null;root.hidden=true;clearBackup();for(const form of root.querySelectorAll('form'))form.reset();$('[data-users-list]').replaceChildren();$('[data-group-image]').removeAttribute('src');$('[data-group-image]').hidden=true;$('[data-restore-result]').textContent='';},
  });
}
