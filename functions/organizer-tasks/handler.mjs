import { buildOrganizerTasks, organizerTaskLabels } from '../../shared/organizer-progress.mjs';
import { eventConfig } from '../../src/config/event.mjs';

const ORIGIN = 'https://api.artdico.host';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'vary': 'Cookie, Origin' };
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...headers, ...extra } });
const error = (code, message, status) => json({ error: { code, message } }, status);
export function canReadOrganizerTasks(actor) {
  return Boolean(actor?.id && Array.isArray(actor.roles) && (actor.roles.includes('superadmin') || actor.roles.includes('outreach') && actor.roles.includes('reviewer')));
}
/** Source access happens only after authentication and the complete role gate.
 * getSources is injected by the trusted runtime, never supplied by a request.
 */
export function createOrganizerTasksApi({ authenticate, getSources, now = () => Date.now(), event = eventConfig } = {}) {
  if (typeof authenticate !== 'function' || typeof getSources !== 'function' || typeof now !== 'function') throw new TypeError('Trusted task sources and authentication required.');
  return async function handle(request) {
    const url = new URL(request.url), origin = request.headers.get('origin');
    if (url.origin !== ORIGIN || url.pathname !== '/api/admin/tasks' || url.hash) return error('NOT_FOUND', '接口不存在。', 404);
    if (origin !== null && origin !== ORIGIN) return error('FORBIDDEN', '此来源不能读取工作人员待办。', 403);
    if (request.method !== 'GET') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: '待办页面只读取已保存记录。' } }, 405, { allow: 'GET' });
    try {
      const session = await authenticate(request);
      if (!session?.user) return error('AUTH_REQUIRED', '请先登录。', 401);
      if (!canReadOrganizerTasks(session.user)) return error('FORBIDDEN', '此页需要人员邀约及报名审核权限。', 403);
      const query = url.searchParams;
      if ([...query.keys()].some(key => !['owner', 'kind', 'cursor', 'limit'].includes(key) || query.getAll(key).length !== 1)) return error('INVALID_FILTER', '筛选条件无效。', 400);
      const owner = query.get('owner') ?? '', kind = query.get('kind') ?? '', cursorText = query.get('cursor') ?? '0', limitText = query.get('limit') ?? '100';
      if (owner.length > 120 || /[\u0000-\u001f\u007f]/u.test(owner) || kind && !Object.hasOwn(organizerTaskLabels, kind)
        || !/^(?:0|[1-9]\d{0,5})$/u.test(cursorText) || !/^[1-9]\d{0,2}$/u.test(limitText) || Number(limitText) > 200) return error('INVALID_FILTER', '筛选条件无效。', 400);
      const source = await getSources(session.user);
      if (!source || !Array.isArray(source.contacts) || !source.content || !Array.isArray(source.content.sessions) || !Array.isArray(source.content.booths)
        || !Number.isSafeInteger(source.contactRevision) || source.contactRevision < 0 || !Number.isSafeInteger(source.contentRevision) || source.contentRevision < 0
        || source.intent !== null && (!Array.isArray(source.intent?.conversions) || !Array.isArray(source.intent?.invitations))) throw new Error('Invalid sources');
      const projection = buildOrganizerTasks({ ...source, event, now: now() });
      const filtered = projection.tasks.filter(task => (!kind || task.kind === kind) && (!owner || (owner === '__unassigned' ? !task.owner : task.owner === owner)));
      const offset = Number(cursorText), limit = Number(limitText), tasks = filtered.slice(offset, offset + limit);
      const byKind = Object.fromEntries(Object.keys(organizerTaskLabels).map(key => [key, projection.tasks.filter(task => (!owner || (owner === '__unassigned' ? !task.owner : task.owner === owner)) && task.kind === key).length]));
      return json({ ...projection, tasks, byKind, total: filtered.length, overallTotal: projection.tasks.length,
        nextCursor: offset + tasks.length < filtered.length ? String(offset + tasks.length) : null, filters: { owner, kind } });
    } catch (failure) {
      if (failure?.status === 401 || failure?.code === 'AUTH_REQUIRED') return error('AUTH_REQUIRED', '会话已结束，请重新登录。', 401);
      if (failure?.status === 403) return error('FORBIDDEN', '此账号没有读取工作人员待办的权限。', 403);
      return error('TASKS_UNAVAILABLE', '待办来源暂时无法核对，请稍后刷新；未以零代替缺少的数据。', 503);
    }
  };
}
