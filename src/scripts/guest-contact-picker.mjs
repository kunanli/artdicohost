import { canLinkContentPeople, contactCandidatePage, personContactPath } from '../lib/content-relationships.mjs';

function node(tag, text) { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; }

/** This picker edits only the current form's stable source ID. It never creates a person. */
export function createGuestContactPicker({ root, request, getContext, getValue, setValue, onChange }) {
  const $ = selector => root.querySelector(selector);
  const query = $('[data-guest-person-query]'), select = $('[data-guest-person-select]');
  let epoch = 0, controller = null, opened = false, account = '', candidates = [], revision = null, nextCursor = null, loading = false, chosen = '';
  const key = () => { const user = getContext().user; return user ? user.id + '|' + [...user.roles].sort().join(',') : ''; };
  const permitted = () => canLinkContentPeople(getContext().user);
  const publishedIdentity = () => getContext().publishedIdentity === true;
  function stop() { epoch++; controller?.abort(); controller = null; loading = false; }
  function clear() {
    stop(); opened = false; candidates = []; revision = null; nextCursor = null; chosen = ''; query.value = ''; select.replaceChildren();
    $('[data-guest-person-status]').textContent = ''; $('[data-guest-person-link]').hidden = true; $('[data-guest-person-link]').removeAttribute('href');
    $('[data-guest-person-more]').hidden = true;
  }
  function controls() {
    const disabled = !opened || !permitted() || publishedIdentity() || getContext().busy;
    for (const control of root.querySelectorAll('input,select,button')) control.disabled = disabled || loading && (control === select || control.hasAttribute('data-guest-person-more'));
    $('[data-guest-person-controls]').hidden = !permitted();
    $('[data-guest-person-more]').hidden = !nextCursor;
  }
  function selectedLink() {
    const link = $('[data-guest-person-link]'), id = getValue(); link.hidden = !permitted() || !id;
    if (!link.hidden) link.href = personContactPath(id); else link.removeAttribute('href');
  }
  function renderChoices() {
    select.replaceChildren(); const blank = node('option', '未关联名单人员'); blank.value = ''; select.append(blank);
    const selected = getValue(), present = candidates.some(item => item.id === selected);
    if (selected && !present) { const current = node('option', '原关联人员 · 尚未核对'); current.value = selected; select.append(current); }
    for (const item of candidates) {
      const already = (getContext().content?.guests ?? []).some(guest => guest.id !== getContext().guestId && guest.contactId === item.id);
      const option = node('option', item.name + (item.organization ? ' · ' + item.organization : '') + (!item.eligible ? ' · 当前不可新增关联' : already ? ' · 已有关联嘉宾' : ''));
      option.value = item.id; option.disabled = (!item.eligible || already) && item.id !== selected; select.append(option);
    }
    select.value = selected; selectedLink(); controls();
  }
  async function load({ append = false, id = '' } = {}) {
    if (!opened || !permitted() || publishedIdentity() || getContext().busy) return;
    const cursor = append ? nextCursor : null; if (append && !cursor) return;
    stop(); const stamp = epoch, state = getContext(), currentAccount = key(), term = query.value.trim();
    const signalController = new AbortController(); controller = signalController; loading = true; controls();
    const current = () => stamp === epoch && opened && permitted() && !publishedIdentity() && key() === currentAccount && getContext().content === state.content
      && getContext().revision === state.revision && getContext().guestId === state.guestId;
    const active = () => current() && !signalController.signal.aborted;
    const timer = setTimeout(() => signalController.abort(), 15_000);
    $('[data-guest-person-status]').textContent = '正在读取现有人员…';
    const params = new URLSearchParams({ limit: '100' }); if (id) params.set('id', id); else { if (term) params.set('query', term); if (cursor) params.set('cursor', cursor); }
    try {
      const page = contactCandidatePage(await request('/api/admin/people/candidates?' + params, { signal: signalController.signal, isCurrent: active }));
      if (!active()) return;
      if (append && (page.contactsRevision !== revision || page.total < candidates.length + page.candidates.length || page.nextCursor !== null && Number(page.nextCursor) <= Number(cursor) || page.candidates.some(item => candidates.some(previous => previous.id === item.id)))) throw new Error('名单已变化，请重新搜索后核对关联。');
      candidates = append ? [...candidates, ...page.candidates] : page.candidates; revision = page.contactsRevision; nextCursor = id ? null : page.nextCursor;
      renderChoices();
      $('[data-guest-person-status]').textContent = id ? candidates.length ? '已核对原关联人员。修改关联后需重新核对公开授权。' : '原人员无法核对，已保留原关联；可搜索现有人員后明确调整。'
        : '已显示 ' + candidates.length + ' / ' + page.total + ' 位。选择只改变内部关联，不会自动报名或发布。';
    } catch (error) {
      if (!current()) return;
      candidates = []; revision = null; nextCursor = null; renderChoices();
      $('[data-guest-person-status]').textContent = signalController.signal.aborted ? '人员读取超时，原关联仍保留。可重新搜索。' : error.status ? error.message : '人员暂不可核对，原关联仍保留。请稍后重新搜索。';
    } finally { clearTimeout(timer); if (stamp === epoch) { controller = null; loading = false; controls(); } }
  }
  function configure() {
    const next = key(); if (next !== account) { clear(); account = next; }
    if (!permitted()) { stop(); candidates = []; revision = null; nextCursor = null; select.replaceChildren(); selectedLink(); $('[data-guest-person-status]').textContent = getValue() ? '已保存内部人员关联。查看或修改需要同时具备人员邀约与活动编辑权限。' : '关联名单人员需要同时具备人员邀约与活动编辑权限。'; }
    else if (publishedIdentity()) { stop(); candidates = []; revision = null; nextCursor = null; $('[data-guest-person-status]').textContent = '请先停止公开并保存发布，再更换关联人员。'; }
    controls();
  }
  function open() { clear(); account = key(); opened = true; chosen = getValue(); configure(); renderChoices(); if (permitted()) { const stamp = epoch; if (getContext().busy) setTimeout(() => { if (stamp === epoch && opened) void load({ id: chosen }); }, 0); else void load({ id: chosen }); } }
  $('[data-guest-person-search]').addEventListener('click', () => void load());
  $('[data-guest-person-more]').addEventListener('click', () => void load({ append: true }));
  query.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); void load(); } });
  select.addEventListener('change', () => {
    if (!opened || !permitted() || publishedIdentity() || loading || getContext().busy) { select.value = getValue(); return; }
    const id = select.value, item = candidates.find(item => item.id === id);
    if (id && (!item?.eligible || (getContext().content?.guests ?? []).some(guest => guest.id !== getContext().guestId && guest.contactId === id))) { select.value = getValue(); return; }
    if (id !== getValue()) { setValue(id); chosen = id; onChange(); $('[data-guest-person-status]').textContent = '内部关联已更改，请重新核对本人及公开授权，再应用并保存草稿。'; }
    selectedLink();
  });
  return Object.freeze({ open, configure, clear });
}
