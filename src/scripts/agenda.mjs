for (const root of document.querySelectorAll('[data-agenda]')) {
  const tabs = [...root.querySelectorAll('[data-zone]')];
  const panels = [...root.querySelectorAll('[data-agenda-panel]')];
  const expand = root.querySelector('[data-full-agenda]');
  const tablist = root.querySelector('[role="tablist"]');
  let zone = 'A';
  let expanded = false;
  const smallScreen = matchMedia('(max-width: 700px)');
  function render() {
    for (const tab of tabs) {
      const selected = tab.dataset.zone === zone;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.agendaPanel !== zone;
      [...panel.querySelectorAll('.ah-agenda-row')].forEach((row, index) => {
        row.hidden = panel.dataset.agendaPanel !== 'C' && !expanded && ![0, 2, 4, 11, 13].includes(index);
      });
    }
    if (expand) {
      expand.hidden = zone === 'C';
      expand.setAttribute('aria-expanded', String(expanded));
      expand.firstChild.textContent = expanded ? '收起完整日程 ' : '展开完整日程（15 段） ';
      expand.querySelector('span').textContent = expanded ? '↑' : '↓';
    }
    tablist?.setAttribute('aria-orientation', smallScreen.matches ? 'horizontal' : 'vertical');
  }
  function choose(tab, focus = false) {
    zone = tab.dataset.zone;
    render();
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab));
    tab.addEventListener('keydown', (event) => {
      const offsets = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      if (Object.hasOwn(offsets, event.key)) {
        event.preventDefault();
        choose(tabs[(index + offsets[event.key] + tabs.length) % tabs.length], true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        choose(event.key === 'Home' ? tabs[0] : tabs.at(-1), true);
      }
    });
  });
  expand?.addEventListener('click', () => { expanded = !expanded; render(); });
  smallScreen.addEventListener('change', render);
  render();
}
