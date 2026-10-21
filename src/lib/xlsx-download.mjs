const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_BYTES = 8 * 1024 * 1024;
const paths = new Set(['/api/admin/registrations/export.xlsx', '/api/admin/contacts/export.xlsx']);
function failure(message, status) { const error = new Error(message); if (status) error.status = status; return error; }

/** A private download has no automatic retry and never survives a session change. */
export async function downloadPrivateXlsx({ path, body, csrfToken, filename, isCurrent = () => true, fetchFn = fetch, onPrivateUrl = () => {} } = {}) {
  if (!paths.has(path) || typeof csrfToken !== 'string' || !csrfToken || !['artdico-registration-attendance.xlsx', 'artdico-all-contacts.xlsx'].includes(filename)
    || typeof isCurrent !== 'function' || typeof fetchFn !== 'function' || typeof onPrivateUrl !== 'function') throw failure('Excel 导出配置无效。');
  const current = () => { if (!isCurrent()) throw failure('会话已改变，未提供导出下载。'); };
  current();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);
  try{
  const response = await fetchFn(path, { method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken, Accept: MIME }, body: JSON.stringify(body),signal:controller.signal });
  current();
  if (!response.ok) throw failure(response.status === 401 ? '会话已结束，请重新登录。' : response.status === 403 ? '此账号没有所选导出范围的权限。' : response.status === 409 ? '资料版本已改变，请先刷新核对，再明确重新导出。' : response.status === 413 || response.status === 503 ? 'Excel 尚未生成；资料过多时请缩小报名筛选，或联系受控维护人员。' : 'Excel 导出未完成，请稍后重试。', response.status);
  if (response.headers.get('content-type')?.toLowerCase() !== MIME) throw failure('服务未返回有效的 Excel 文件。');
  const length = response.headers.get('content-length'), revision = response.headers.get('x-review-revision'), count = response.headers.get('x-export-count'), expectedHash = response.headers.get('x-export-sha256');
  if (!/^[1-9]\d*$/u.test(length ?? '') || Number(length) > MAX_BYTES || !/^(?:0|[1-9]\d*)$/u.test(revision ?? '') || !Number.isSafeInteger(Number(revision))
    || !/^(?:0|[1-9]\d*)$/u.test(count ?? '') || !Number.isSafeInteger(Number(count)) || !/^[a-f0-9]{64}$/u.test(expectedHash ?? '')) throw failure('Excel 回执未通过核对，未开始下载。');
  const reader = response.body?.getReader(); if (!reader) throw failure('Excel 文件未能读取。');
  const parts = []; let size = 0;
  try {
    for (;;) { const part = await reader.read(); current(); if (part.done) break; size += part.value.byteLength; if (size > MAX_BYTES || size > Number(length)) throw failure('Excel 超过下载上限。'); parts.push(part.value); }
  } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
  if (size !== Number(length)) throw failure('Excel 文件长度不完整，未开始下载。');
  const bytes = new Uint8Array(size); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join(''); current();
  if (digest !== expectedHash || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 3 || bytes[3] !== 4) throw failure('Excel 文件摘要不一致，未开始下载。');
  const url = URL.createObjectURL(new Blob([bytes], { type: MIME }));
  try {
    onPrivateUrl(url); current(); const link = document.createElement('a'); link.href = url; link.download = filename;
    document.body.append(link); try { link.click(); } finally { link.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (error) { URL.revokeObjectURL(url); throw error; }
  return { revision: Number(revision), count: Number(count) };
  }finally{clearTimeout(timer);controller.abort();}
}
