for (const root of document.querySelectorAll('[data-agenda]')) {
  const tabs = [...root.querySelectorAll('[data-zone]')];
  const panels = [...root.querySelectorAll('[data-agenda-panel]')];
  const expand = root.querySelector('[data-full-agenda]');
  const tablist = root.querySelector('[role="tablist"]');
  let zone = 'A';
  let expanded = false;
  const layout = root.closest('#artdico-host') ?? root;
  const horizontalTabs = () => layout.clientWidth <= 700;
  const compactStarts = new Set(['09:30', '10:15', '11:15', '15:30', '17:00']);
  function render() {
    for (const tab of tabs) {
      const selected = tab.dataset.zone === zone;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.agendaPanel !== zone;
      const rows = [...panel.querySelectorAll('.ah-agenda-row')];
      const compactRows = new Set(rows.filter(row => compactStarts.has(row.dataset.agendaStart)));
      for (const row of rows) {
        if (compactRows.size >= 5) break;
        compactRows.add(row);
      }
      rows.forEach(row => {
        const compact = rows.length <= 6 || compactRows.has(row);
        row.hidden = panel.dataset.agendaPanel !== 'C' && !expanded && !compact;
      });
    }
    if (expand) {
      const count = panels.find(panel => panel.dataset.agendaPanel === zone)?.querySelectorAll('.ah-agenda-row').length ?? 0;
      expand.hidden = zone === 'C' || count <= 6;
      expand.setAttribute('aria-controls', 'agenda-' + zone);
      expand.setAttribute('aria-expanded', String(expanded));
      expand.firstChild.textContent = expanded ? '收起 ' + zone + ' 区完整日程 ' : '展开 ' + zone + ' 区完整日程（' + count + ' 段） ';
      expand.querySelector('span').textContent = expanded ? '↑' : '↓';
    }
    tablist?.setAttribute('aria-orientation', horizontalTabs() ? 'horizontal' : 'vertical');
  }
  function choose(tab, focus = false) {
    zone = tab.dataset.zone;
    render();
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab));
    tab.addEventListener('keydown', (event) => {
      const offsets = horizontalTabs() ? { ArrowRight: 1, ArrowLeft: -1 } : { ArrowDown: 1, ArrowUp: -1 };
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
  if (typeof ResizeObserver === 'function') new ResizeObserver(render).observe(layout);
  else window.addEventListener('resize', render);
  root.addEventListener('artdico:content-updated', render);
  render();
}
