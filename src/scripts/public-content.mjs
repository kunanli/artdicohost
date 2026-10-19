// Public content is a separate, read-only endpoint. Registration remains a no-I/O demo.
const endpoint = document.querySelector('meta[name="artdico-content-api"]')?.getAttribute('content');
if (endpoint) {
  const target = new URL(endpoint, location.href);
  if (target.origin === location.origin && /^https?:$/.test(target.protocol)) {
    loadPublishedContent(target).catch(() => {
      const notice = document.querySelector('[data-public-content-status]');
      if (notice) notice.textContent = '暂时无法读取最新安排，以下显示网站日程。';
    });
  }
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function loadPublishedContent(url) {
  const response = await fetch(url, { credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' } });
  if (response.status === 404) return; // No published revision: retain the static event configuration.
  if (!response.ok) throw new Error('Content unavailable');
  const envelope = await response.json();
  const content = envelope.content;
  if (!content || !Array.isArray(content.sessions) || !Array.isArray(content.booths) || !content.event) throw new Error('Invalid public content');
  const agenda = document.querySelector('[data-agenda]');
  // A published timetable replaces the static overview, so it never shows stale time blocks.
  const summary = agenda?.querySelector('[data-agenda-summary]');
  if (summary) summary.hidden = true;
  const fullProgram = agenda?.querySelector('[data-full-program]');
  if (fullProgram) fullProgram.open = true;
  // The API publishes session times, but has no authoritative check-in / opening fields.
  for (const hint of document.querySelectorAll('[data-public-static-hours], [data-public-static-checkin]')) hint.hidden = true;
  for (const panel of agenda?.querySelectorAll('[data-agenda-panel]') ?? []) {
    const list = panel.querySelector('.ah-agenda-list');
    if (!list) continue;
    const rows = content.sessions.filter(item => item.zone === panel.dataset.agendaPanel && item.status !== 'draft').sort((a,b) => a.start.localeCompare(b.start));
    list.replaceChildren();
    for (const item of rows) {
      const row = element('article', undefined, 'ah-agenda-row');
      row.dataset.agendaStart = item.start;
      row.classList.toggle('ah-featured', item.start === '15:30' || item.start === '16:30');
      row.append(element('time', item.start + '–' + item.end));
      const detail = element('div');
      detail.append(element('strong', item.title));
      if (item.status === 'cancelled') detail.append(element('small', '本场已取消'));
      else detail.append(element('small', item.speakerStatus === 'confirmed' ? '讲者：' + item.speakerName : '讲者 / 主持人待确认'));
      row.append(detail);
      list.append(row);
    }
    if (!rows.length) list.append(element('p', '此区域的场次尚未公布。', 'ah-agenda-caption'));
  }
  agenda?.dispatchEvent(new Event('artdico:content-updated'));
  const booths = document.querySelector('[data-public-booths]');
  if (booths) {
    booths.replaceChildren();
    for (const item of content.booths.filter(item => item.status === 'confirmed')) {
      const card = element('article', undefined, 'ah-booth-card');
      card.append(element('span', item.code + ' · ' + item.zone + ' 区', 'ah-kicker'), element('h3', item.organization), element('p', item.project));
      booths.append(card);
    }
    const empty = document.querySelector('[data-public-booths-empty]');
    if (empty) empty.hidden = booths.childElementCount > 0;
  }
  const dateText = content.event.date + (content.event.dateStatus === 'confirmed' ? '' : ' · 日期暂定');
  for (const node of document.querySelectorAll('[data-public-agenda-date]')) node.textContent = dateText;
  for (const node of document.querySelectorAll('[data-public-date-value]')) { node.textContent = content.event.date; node.setAttribute('datetime', content.event.date); }
  for (const node of document.querySelectorAll('[data-public-date-tentative]')) node.hidden = content.event.dateStatus === 'confirmed';
  for (const node of document.querySelectorAll('[data-public-date-label]')) node.textContent = content.event.dateStatus === 'confirmed' ? '活动日期已确认' : '活动日期暂定';
  for (const node of document.querySelectorAll('[data-public-event-title]')) {
    if (node.tagName !== 'H1') { node.textContent = content.event.title; continue; }
    node.setAttribute('aria-label', content.event.title);
    if (content.event.title === (node.dataset.renderedEventTitle || node.dataset.initialEventTitle)) continue;
    node.dataset.renderedEventTitle = content.event.title;
    const titles = content.event.title.split(' × ');
    if (titles.length === 2) {
      node.replaceChildren(
        element('span', titles[0], 'ah-event-title-line'),
        element('span', '×', 'ah-event-title-cross'),
        element('span', titles[1], 'ah-event-title-line'),
      );
    } else node.textContent = content.event.title;
  }
  for (const node of document.querySelectorAll('[data-public-hero-venue]')) node.textContent = content.event.venue;
  for (const node of document.querySelectorAll('[data-public-poster-date]')) {
    const [,month,day] = content.event.date.split('-');
    node.replaceChildren(document.createTextNode(month), element('br'), element('span', day));
  }
  for (const node of document.querySelectorAll('[data-public-artwork-date]')) {
    const [,month,day] = content.event.date.split('-');
    node.replaceChildren(element('span', month, 'ah-date-month'), element('span', '.', 'ah-date-dot'), element('span', day, 'ah-date-day'));
  }
  document.title = content.event.title + '｜活动安排';
  for (const node of document.querySelectorAll('[data-public-event-venue]')) node.textContent = content.event.venue + (content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  const notice = document.querySelector('[data-public-content-status]');
  if (notice) notice.textContent = content.event.status === 'cancelled' ? '本次活动已取消。' : '讲者与主题陆续公布。';
}
