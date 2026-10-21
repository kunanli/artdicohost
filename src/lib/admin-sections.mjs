/** Public route metadata only. Resolving a page never reads or saves staff data.
 * @typedef {Readonly<{key:string,label:string,title:string,headingId:string,description:string,href:string}>} AdminPage
 * @typedef {readonly [key:string,label:string,title:string,headingId:string,description:string]} AdminPageDefinition
 */
/** @type {readonly AdminPageDefinition[]} */
const contentDefinitions = [
  ['overview', '工作区概况', '活动内容概况', 'workspace-title', '选择一项内容，完成保存后再到发布页公开。'],
  ['event', '活动基本资料', '活动基本资料', 'event-editor-title', '维护日期、场地、联络方式与常见问题。'],
  ['arrangements', '现场配置总览', '现场配置总览', 'arrangements-title', '核对展位、场次与人员安排。'],
  ['guests', '嘉宾与讲者', '嘉宾与讲者', 'guests-title', '维护人物资料、照片与公开授权。'],
  ['organizations', '参与组织', '参与组织', 'organizations-title', '维护组织图片、名称、页面链接与参与形式。'],
  ['showcases', '学生作品', '学生作品', 'showcases-title', '维护作品、材料与参与安排。'],
  ['sessions', '活动场次', '活动场次', 'sessions-title', '维护各区域场次、时间与讲者关联。'],
  ['booths', '十五个展位', '十五个展位', 'booths-title', '维护展位、展示项目与内部负责人资料。'],
  ['publish', '预览与发布', '预览与发布', 'preview-title', '核对已保存内容，再明确发布到活动页。'],
];
/** @type {readonly AdminPageDefinition[]} */
const settingsDefinitions = [
  ['delivery', '报名确认与票券', '报名确认与票券', 'delivery-settings-heading', '核对确认邮件与 Apple Wallet。'],
  ['group', '微信群入口', '微信群入口', 'group-settings-title', '维护群二维码与有效期。'],
  ['invitations', '工作人员邀请', '工作人员邀请', 'invitation-settings-title', '核对工作人员代登记对象的邀请方式。'],
  ['accounts', '用户管理', '用户管理', 'staff-accounts-title', '管理工作人员账号、权限与停用。'],
];
/**
 * @param {readonly AdminPageDefinition[]} definitions
 * @param {string} root
 * @returns {readonly AdminPage[]}
 */
const records = (definitions, root) => Object.freeze(definitions.map(([key, label, title, headingId, description]) => Object.freeze({ key, label, title, headingId, description, href: root + key + '/' })));
export const CONTENT_PAGES = records(contentDefinitions, '/admin/content/');
export const SETTINGS_PAGES = records(settingsDefinitions, '/admin/settings/');
const contentHashes = new Map(CONTENT_PAGES.map(page => ['#' + page.headingId, page.key]));
const settingsHashes = new Map([...SETTINGS_PAGES.map(page => ['#' + page.headingId, page.key]), ['#settings-workspace-title', 'overview'], ['#staff-settings-title', 'group'], ['#wallet-settings-title', 'delivery']]);
const entities = new Map([['invitee', 'guests'], ['guest', 'guests'], ['organization', 'organizations'], ['booth', 'booths'], ['session', 'sessions'], ['showcase', 'showcases']]);
function routeKey(pathname, root, pages) {
  if (typeof pathname !== 'string') return null;
  const path = pathname.endsWith('/') ? pathname : pathname + '/';
  if (path === root) return 'overview';
  return pages.find(page => page.href === path)?.key ?? null;
}
export function resolveContentPage(pathname, hash = '') {
  const key = routeKey(pathname, '/admin/', CONTENT_PAGES); if (key === null) return null;
  if (contentHashes.has(hash)) return contentHashes.get(hash);
  const entity = typeof hash === 'string' && /^#(invitee|guest|organization|booth|session|showcase)=[A-Za-z0-9_-]{1,100}$/u.exec(hash);
  return entity ? entities.get(entity[1]) : key;
}
export function resolveSettingsPage(pathname, hash = '') {
  const key = routeKey(pathname, '/admin/settings/', SETTINGS_PAGES);
  return key === null ? null : settingsHashes.get(hash) ?? key;
}
export function contentPageHref(key) {
  const page = CONTENT_PAGES.find(page => page.key === key); if (!page) throw new TypeError('Unknown content page.'); return page.href;
}
export function settingsPageHref(key) {
  if (key === 'overview') return '/admin/settings/';
  const page = SETTINGS_PAGES.find(page => page.key === key); if (!page) throw new TypeError('Unknown settings page.'); return page.href;
}
