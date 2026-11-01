for (const root of document.querySelectorAll('[data-agenda]')) {
  const tabs = [...root.querySelectorAll('[data-zone]')];
  const panels = [...root.querySelectorAll('[data-agenda-panel]')];
  const controls = root.querySelector('[data-program-controls]');
  const period = root.querySelector('[data-program-period]');
  const validPeriods = new Set(['all', 'morning', 'afternoon']);
  let zone = tabs[0]?.dataset.zone ?? 'A';
  let initialHashApplied=false;
  let published=false,visitorSelection=false;
  let rendered=false;
  const main=root.querySelector('.ah-agenda-main');
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
    // Keep a shorter tab from collapsing the page beneath the reader.
    if(main&&rendered)main.style.minHeight=Math.max(parseFloat(main.style.minHeight)||0,main.getBoundingClientRect().height)+'px';
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
    rendered=true;
  }
  function choose(tab, focus = false) {
    visitorSelection=true;
    zone = tab.dataset.zone;
    render();
    if (focus) tab.focus({preventScroll:true});
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
  period?.addEventListener('change',()=>{visitorSelection=true;render();});
  let resizeFrame=null;
  window.addEventListener('resize',()=>{
    if(resizeFrame!==null)return;
    resizeFrame=requestAnimationFrame(()=>{resizeFrame=null;if(main)main.style.minHeight='';rendered=false;render();});
  });
  function activateHash(hash,{initial=false}={}){
    let id;try{id=decodeURIComponent(hash.replace(/^#/,''));}catch{return false;}
    const target=document.getElementById(id),panel=target?.closest('[data-agenda-panel]');
    if(!panel||!root.contains(panel))return false;
    zone=panel.dataset.agendaPanel;
    if(target.matches('.ah-agenda-row')&&period)period.value='all';
    render();
    if(initial&&!initialHashApplied){initialHashApplied=true;requestAnimationFrame(()=>target.scrollIntoView({block:'start',behavior:'instant'}));}
    return true;
  }
  document.addEventListener('click',event=>{
    const link=event.target.closest?.('a[href*="#"]');if(!link)return;
    if(link.origin===location.origin&&link.pathname===location.pathname)activateHash(link.hash);
  });
  window.addEventListener('hashchange',()=>{initialHashApplied=true;activateHash(location.hash);});
  root.addEventListener('artdico:content-updated', () => {
    panels.forEach(groupRows);if(main)main.style.minHeight='';rendered=false;render();
    // A static slot may already have the URL's ID. Reposition it once after the
    // first publication replaces that overview, unless the visitor chose a tab.
    if(!published&&!visitorSelection)initialHashApplied=false;
    if(!initialHashApplied)activateHash(location.hash,{initial:true});
    published=true;
  });
  panels.forEach(groupRows);
  render();
  activateHash(location.hash,{initial:true});
  if (controls) controls.hidden = false;
}
