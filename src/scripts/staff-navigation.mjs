// Navigation has no access to staff records and never submits editor changes.
const desktop = window.matchMedia('(min-width: 1100px)');
for (const navigation of document.querySelectorAll('[data-staff-navigation]')) {
  const menu = navigation.querySelector('[data-staff-navigation-menu]');
  const workspace = navigation.parentElement;
  const links = [...navigation.querySelectorAll('[data-staff-section-link]')];
  const headings = links.map(link => document.getElementById(link.hash.slice(1))).filter(Boolean);
  let frame = 0;
  const visibleHeadings = () => headings.filter(heading => !heading.closest('[hidden]') && heading.getClientRects().length > 0);
  function markCurrent() {
    frame = 0;
    if (workspace.hidden) return;
    const visible = visibleHeadings();
    let current = visible[0];
    for (const heading of visible) {
      // Allow subpixel rounding around the mobile scroll margin plus page padding.
      if (heading.getBoundingClientRect().top <= 102) current = heading;
    }
    // The last section can be too short to reach the top of the viewport.
    if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2) current = visible.at(-1);
    for (const link of links) {
      if (link.hash === '#' + current?.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  function scheduleCurrent() {
    if (!frame) frame = requestAnimationFrame(markCurrent);
  }
  function resetMenu() {
    menu.open = desktop.matches;
    scheduleCurrent();
  }
  function restoreSection() {
    if (workspace.hidden) return;
    const heading = visibleHeadings().find(item => '#' + item.id === location.hash);
    if (!heading || heading.closest('[hidden]')) return;
    requestAnimationFrame(() => {
      if (workspace.hidden || '#' + heading.id !== location.hash) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: 'start', behavior: 'instant' });
      scheduleCurrent();
    });
  }
  desktop.addEventListener('change', resetMenu);
  // Desktop navigation stays expanded; the mobile summary is the toggle.
  menu.addEventListener('toggle', () => {
    if (desktop.matches && !menu.open) menu.open = true;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open && !desktop.matches) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  for (const link of links) link.addEventListener('click', event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const heading = document.getElementById(link.hash.slice(1));
    if (!heading) return;
    event.preventDefault();
    // Do not replace an outstanding invitee/booth fragment used by the editor.
    if (!/^#(?:invitee|booth)=/u.test(location.hash)) history.replaceState(history.state, '', link.hash);
    if (!desktop.matches) menu.open = false;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: 'instant' });
    scheduleCurrent();
  });
  window.addEventListener('scroll', scheduleCurrent, { passive: true });
  window.addEventListener('resize', scheduleCurrent, { passive: true });
  new MutationObserver(() => { resetMenu(); restoreSection(); }).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  resetMenu();
  restoreSection();
}
