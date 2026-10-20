for (const root of document.querySelectorAll('[data-agenda]')) {
  const tabs = [...root.querySelectorAll('[data-zone]')];
  const panels = [...root.querySelectorAll('[data-agenda-panel]')];
  const controls = root.querySelector('[data-program-controls]');
  const period = root.querySelector('[data-program-period]');
  const validPeriods = new Set(['all', 'morning', 'afternoon']);
  let zone = tabs[0]?.dataset.zone ?? 'A';
  const rowPeriod = row => row.dataset.agendaStart < '12:00' ? 'morning' : 'afternoon';

  // Published content replaces the list with direct article children. Recreate
  // these presentation headings from those new rows rather than stale copies.
  function groupRows(panel) {
    const list = panel.querySelector('.ah-agenda-list');
    if (!list) return;
    list.querySelectorAll('[data-program-divider]').forEach(heading => heading.remove());
    let previous;
    for (const row of list.querySelectorAll('.ah-agenda-row')) {
      const current = rowPeriod(row);
      if (current !== previous) {
        const heading = document.createElement('h4');
        heading.className = 'ah-program-divider';
        heading.dataset.programDivider = current;
        heading.append(document.createTextNode(current === 'morning' ? '上午' : '午后'));
        const english = document.createElement('span');
        english.setAttribute('aria-hidden', 'true');
        english.textContent = current === 'morning' ? 'MORNING' : 'AFTERNOON';
        heading.append(english);
        list.insertBefore(heading, row);
      }
      previous = current;
    }
  }
  function render() {
    const selectedPeriod = validPeriods.has(period?.value) ? period.value : 'all';
    for (const tab of tabs) {
      const selected = tab.dataset.zone === zone;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.agendaPanel !== zone;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', 'tab-' + panel.dataset.agendaPanel);
      const rows = [...panel.querySelectorAll('.ah-agenda-row')];
      for (const row of rows) row.hidden = selectedPeriod !== 'all' && rowPeriod(row) !== selectedPeriod;
      for (const heading of panel.querySelectorAll('[data-program-divider]')) {
        heading.hidden = selectedPeriod !== 'all' && heading.dataset.programDivider !== selectedPeriod;
      }
      const empty = panel.querySelector('[data-program-empty]');
      if (empty) empty.hidden = rows.some(row => !row.hidden);
    }
  }
  function choose(tab, focus = false) {
    zone = tab.dataset.zone;
    render();
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => choose(tab));
    tab.addEventListener('keydown', event => {
      const offsets = { ArrowRight: 1, ArrowLeft: -1 };
      if (Object.hasOwn(offsets, event.key)) {
        event.preventDefault();
        choose(tabs[(index + offsets[event.key] + tabs.length) % tabs.length], true);
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault();
        choose(event.key === 'Home' ? tabs[0] : tabs.at(-1), true);
      }
    });
  });
  period?.addEventListener('change', render);
  root.addEventListener('artdico:content-updated', () => { panels.forEach(groupRows); render(); });
  panels.forEach(groupRows);
  render();
  if (controls) controls.hidden = false;
}
