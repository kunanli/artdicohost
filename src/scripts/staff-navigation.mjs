// Navigation never saves, publishes or reads staff records.
import { resolveContentPage, resolveSettingsPage, resolvePeopleView } from '../lib/admin-sections.mjs';
function markPeopleView(){const selected=resolvePeopleView(location.pathname,location.hash);for(const link of document.querySelectorAll('[data-people-view]')){if(link.dataset.peopleView===selected)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}}
window.addEventListener('hashchange',markPeopleView);markPeopleView();
const desktop = window.matchMedia('(min-width: 1100px)');
for (const navigation of document.querySelectorAll('[data-staff-navigation]')) {
  const menu = navigation.querySelector('[data-staff-navigation-menu]');
  const workspace = navigation.parentElement;
  const links = [...navigation.querySelectorAll('[data-staff-section-link]')];
  const pageRoot = navigation.closest('[data-content-page],[data-settings-admin]');
  let frame = 0;
  function markCurrent() {
    frame = 0;
    if (workspace.hidden) return;
    const key = navigation.dataset.staffNavigation === 'content' ? resolveContentPage(location.pathname, location.hash)
      : navigation.dataset.staffNavigation === 'settings' ? resolveSettingsPage(location.pathname, location.hash) : null;
    for (const link of links) {
      if (link.dataset.staffSection === key) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  function scheduleCurrent() { if (!frame) frame = requestAnimationFrame(markCurrent); }
  function resetMenu() { menu.open = desktop.matches; scheduleCurrent(); }
  function restoreSection() {
    if (workspace.hidden || !location.hash || /^#(?:invitee|guest|organization|booth|session|showcase)=/u.test(location.hash)) return;
    const heading = document.getElementById(location.hash.slice(1));
    if (!heading || heading.closest('[hidden]')) return;
    requestAnimationFrame(() => {
      if (workspace.hidden || '#' + heading.id !== location.hash || heading.closest('[hidden]')) return;
      heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
  }
  desktop.addEventListener('change', resetMenu);
  menu.addEventListener('toggle', () => { if (desktop.matches && !menu.open) menu.open = true; });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open && !desktop.matches) { menu.open = false; menu.querySelector('summary').focus(); }
  });
  for (const link of links) link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!desktop.matches) menu.open = false;
    // Independent page URLs must reach their owning controller or the browser.
    const target = new URL(link.href, location.href);
    if (target.origin !== location.origin || target.pathname !== location.pathname || target.search !== location.search || !target.hash) return;
    const heading = document.getElementById(target.hash.slice(1)); if (!heading || heading.closest('[hidden]')) return;
    event.preventDefault(); history.replaceState(history.state, '', target.hash);
    heading.tabIndex = -1; heading.focus({ preventScroll: true }); heading.scrollIntoView({ block: 'start', behavior: 'instant' }); scheduleCurrent();
  });
  for (const name of ['popstate', 'hashchange']) window.addEventListener(name, () => { scheduleCurrent(); restoreSection(); });
  new MutationObserver(() => { resetMenu(); restoreSection(); }).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  if (pageRoot) new MutationObserver(scheduleCurrent).observe(pageRoot, { attributes: true, attributeFilter: ['data-content-page', 'data-settings-section'] });
  resetMenu(); restoreSection();
}
