// Native details supplies the open / closed state and the complete no-script menu.
for (const menu of document.querySelectorAll('[data-site-menu]')) {
  const summary = menu.querySelector('summary');
  function close(returnFocus = false) {
    menu.open = false;
    if (returnFocus) summary?.focus({ preventScroll: true });
  }
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      close(true);
    }
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) close(menu.contains(document.activeElement));
  });
  document.addEventListener('focusin', event => {
    if (menu.open && !menu.contains(event.target)) close();
  });
  for (const link of menu.querySelectorAll('nav a[href^="#"]')) {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = document.getElementById(link.hash.slice(1));
      close(!target);
      if (!target) return;
      const temporaryTabIndex = !target.hasAttribute('tabindex');
      if (temporaryTabIndex) {
        target.setAttribute('tabindex', '-1');
        target.addEventListener('blur', () => target.removeAttribute('tabindex'), { once: true });
      }
      target.focus({ preventScroll: true });
    });
  }
}
