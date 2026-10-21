import { organizerTaskLabels } from '../../shared/organizer-progress.mjs';

const $ = selector => document.querySelector(selector);
const element = (tag, text, className) => { const item = document.createElement(tag); if(text !== undefined)item.textContent = text;if(className)item.className = className;return item; };
let user = null, csrfToken = '', busy = false, generation = 0, nextCursor = null, cursor = null;
let filters = { owner: '', kind: '' };
const allowed = () => user?.roles?.includes('superadmin') || user?.roles?.includes('outreach') && user?.roles?.includes('reviewer');
function announce(message, failure = false) { $('[data-tasks-status]').textContent = failure ? '' : message; $('[data-tasks-error]').textContent = failure ? message : ''; $('[data-tasks-error]').hidden = !failure; }
function lock() {
  $('[data-tasks-login-submit]').disabled = busy || location.protocol === 'file:';
  for (const item of document.querySelectorAll('[data-tasks-workspace] button,[data-tasks-workspace] select')) item.disabled = busy || !allowed();
}
function clear() {
  generation++;user = null;csrfToken = '';nextCursor = null;cursor = null;filters = { owner: '', kind: '' };
  $('[data-tasks-workspace]').hidden = true;$('[data-tasks-login-panel]').hidden = false;$('[data-tasks-user]').textContent = '';
  for(const selector of ['[data-tasks-metrics]','[data-tasks-quick]','[data-tasks-list]'])$(selector).replaceChildren();
  for(const selector of ['[data-tasks-meta]','[data-tasks-result]','[data-tasks-availability]'])$(selector).textContent = '';
  $('[data-tasks-filters]').reset();$('[data-tasks-owner]').replaceChildren(new Option('全部负责人',''), new Option('尚未分配负责人','__unassigned'));
}
async function request(path, options = {}) {
  const before = generation;
  const response = await fetch(path, { ...options, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrfToken } : {}) } });
  if(before !== generation)throw new Error('会话已改变，请重新登录。');
  if(response.status === 401){clear();throw new Error(path === '/api/admin/login' ? '账号或密码未通过验证。' : '会话已结束，请重新登录。');}
  if(!response.ok)throw new Error(response.status === 403 ? '此页需要人员邀约及报名审核权限，请使用相应账号。' : response.status === 400 ? '筛选条件无效，请清除后重新选择。' : '待办来源暂时无法核对，请稍后刷新。');
  const result = await response.json();if(before !== generation)throw new Error('会话已改变，请重新登录。');return result;
}
async function action(callback) { if(busy)return;busy = true;lock();try{await callback();}catch(error){announce(error.message || '待办读取未完成。', true);}finally{busy = false;lock();} }
const safeLink = value => typeof value === 'string' && (/^\/admin\/contacts\/#contact=[A-Za-z0-9_%\x2d]+$/u.test(value) || /^\/admin\/registrations\/#registration=[A-Za-z0-9_%\x2d]+$/u.test(value) || /^\/admin\/#booth=[A-Za-z0-9_%\x2d]+$/u.test(value) || value === '/admin/#booths-title');
async function load(next = null) {
  if(!allowed())throw new Error('此页需要人员邀约及报名审核权限，请使用相应账号。');
  const params = new URLSearchParams({ limit: '100', ...Object.fromEntries(Object.entries(filters).filter(([,value])=>value)), ...(next ? { cursor: next } : {}) });
  const state = await request('/api/admin/tasks?' + params);
  if(!Array.isArray(state.tasks) || !state.metrics || !Number.isSafeInteger(state.total) || !state.byKind)throw new Error('待办资料不完整，请稍后刷新。');
  cursor = next;nextCursor = state.nextCursor;
  const metrics = $('[data-tasks-metrics]');metrics.replaceChildren();
  for(const [label,value] of [['全部名单',state.metrics.total],['已代登记（含候补）',state.available?.registrationProgress ? state.metrics.converted : '待核对'],['人工已发出 · 当前版',state.metrics.manuallySent],['服务商已接受 · 未证明送达',state.metrics.providerAccepted],['发送结果待核对',state.metrics.unknown],['候补 · 名额尚未确认',state.metrics.waitlisted],['名额状态待核对',state.metrics.admissionUnknown],['本人确认出席',state.metrics.attending]]){
    const card = element('article');card.append(element('span',label), element('strong',String(value ?? '—')));metrics.append(card);
  }
  const owner = $('[data-tasks-owner]');owner.replaceChildren(new Option('全部负责人',''), new Option('尚未分配负责人','__unassigned'));
  for(const name of state.owners ?? [])owner.append(new Option(name,name));owner.value = filters.owner;
  $('[data-tasks-kind]').value = filters.kind;
  const quick = $('[data-tasks-quick]');quick.replaceChildren();
  for(const [kind,label] of Object.entries(organizerTaskLabels)){
    const button = element('button',label + ' ' + (state.byKind[kind] ?? 0));button.type = 'button';button.setAttribute('aria-pressed',String(filters.kind === kind));
    button.addEventListener('click',()=>{filters.kind = filters.kind === kind ? '' : kind;action(()=>load());});quick.append(button);
  }
  const output = $('[data-tasks-list]');output.replaceChildren();
  for(const task of state.tasks){
    const row = element('li',undefined,'tasks-item');row.dataset.kind = task.kind;
    const body = element('div');body.append(element('span',organizerTaskLabels[task.kind] || '待核对','tasks-kind'),element('h3',task.name || '资料待核对'));
    if(task.organization)body.append(element('p',task.organization,'tasks-organization'));
    body.append(element('p',task.detail));
    const meta = [task.owner ? '负责：' + task.owner : '负责人待分配',task.dueAt ? '下次跟进：' + task.dueAt : ''].filter(Boolean).join(' · ');body.append(element('small',meta));
    const actions = element('div',undefined,'tasks-item-actions');
    for(const [href,label] of [[task.href,task.kind === 'missing_booth_details' ? '补齐展位资料 →' : '个人工作页 →'],[task.registrationHref,'关联报名']])if(safeLink(href)){const link = element('a',label,'ah-admin-button');link.href = href.startsWith('/admin/contacts/#contact=') ? href.replace('/admin/contacts/#contact=','/admin/person/#contact=') : href;actions.append(link);}
    row.append(body,actions);output.append(row);
  }
  $('[data-tasks-empty]').hidden = state.tasks.length > 0;
  $('[data-tasks-result]').textContent = '本页 ' + state.tasks.length + ' 项 · 当前筛选 ' + state.total + ' 项；一人可能有多项待办。';
  $('[data-tasks-next]').hidden = !nextCursor;$('[data-tasks-first]').hidden = !cursor;
  $('[data-tasks-availability]').hidden = state.available?.invitationLedger === true;
  $('[data-tasks-availability]').textContent = '新版报名与邀请来源尚未就绪，未将缺少数据记作零或列入待代登记；当前仍可核对旧邀请函及展位资料。';
  $('[data-tasks-meta]').textContent = '已保存名单 #' + state.revisions.contacts + ' · 内容 #' + state.revisions.content + ' · 读取于 ' + new Date(state.generatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}) + '（中国时间）。拒绝联络或出席 ' + state.metrics.excluded + ' 位不列入人员待办。';
  $('[data-tasks-user]').textContent = user.label || user.id;$('[data-tasks-workspace]').hidden = false;$('[data-tasks-login-panel]').hidden = true;
}
for(const [kind,label] of Object.entries(organizerTaskLabels))$('[data-tasks-kind]').append(new Option(label,kind));
$('[data-tasks-login]').addEventListener('submit',event=>{event.preventDefault();const form=event.currentTarget;if(!form.reportValidity())return;action(async()=>{let result;try{result=await request('/api/admin/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});}finally{form.elements.namedItem('password').value='';}user=result.user;csrfToken=result.csrfToken;await load();announce('已读取保存进度，请按需要查看下一步。');});});
$('[data-tasks-logout]').addEventListener('click',()=>action(async()=>{await request('/api/admin/logout',{method:'POST'});clear();announce('已退出，当前页私有待办已清空。');}));
$('[data-tasks-refresh]').addEventListener('click',()=>action(()=>load()));
$('[data-tasks-filters]').addEventListener('submit',event=>{event.preventDefault();filters={owner:$('[data-tasks-owner]').value,kind:$('[data-tasks-kind]').value};action(()=>load());});
$('[data-tasks-filters]').addEventListener('reset',()=>{filters={owner:'',kind:''};queueMicrotask(()=>action(()=>load()));});
$('[data-tasks-next]').addEventListener('click',()=>action(()=>load(nextCursor)));
$('[data-tasks-first]').addEventListener('click',()=>action(()=>load()));
if(location.protocol==='file:'){announce('请通过已配置的工作人员后台登录；离线预览不含私有待办。');lock();}else{action(async()=>{const response=await fetch('/api/admin/session',{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}});if(response.status===401)return;if(!response.ok)throw new Error('工作人员会话暂时无法核对。');const session=await response.json();user=session.user;csrfToken=session.csrfToken;await load();});}
