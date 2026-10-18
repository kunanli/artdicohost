// Public content is a separate, read-only endpoint. Registration remains a no-I/O demo.
const endpoint = document.querySelector('meta[name="artdico-content-api"]')?.getAttribute('content');
if (endpoint) {
  const target = new URL(endpoint, location.href);
  if (target.origin === location.origin && /^https?:$/.test(target.protocol)) {
    loadPublishedContent(target).catch(() => {
      const notice = document.querySelector('[data-public-content-status]');
      if (notice) notice.textContent = '暂时无法读取最新安排，以下为暂定日程；请稍后重试。';
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
  if (response.status === 404) return; // No published revision: retain clearly tentative static content.
  if (!response.ok) throw new Error('Content unavailable');
  const envelope = await response.json();
  const content = envelope.content;
  if (!content || !Array.isArray(content.sessions) || !Array.isArray(content.booths) || !content.event) throw new Error('Invalid public content');
  const agenda = document.querySelector('[data-agenda]');
  for (const panel of agenda?.querySelectorAll('[data-agenda-panel]') ?? []) {
    const list = panel.querySelector('.ah-agenda-list');
    if (!list) continue;
    const rows = content.sessions.filter(item => item.zone === panel.dataset.agendaPanel && item.status !== 'draft').sort((a,b) => a.start.localeCompare(b.start));
    list.replaceChildren();
    for (const item of rows) {
      const row = element('article', undefined, 'ah-agenda-row');
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
  const dateText = content.event.date + (content.event.dateStatus === 'confirmed' ? ' · 日期已确认' : ' · 日期暂定');
  for (const node of document.querySelectorAll('[data-public-agenda-date]')) node.textContent = dateText;
  for (const node of document.querySelectorAll('[data-public-date-value]')) { node.textContent = content.event.date; node.setAttribute('datetime', content.event.date); }
  for (const node of document.querySelectorAll('[data-public-date-tentative]')) node.hidden = content.event.dateStatus === 'confirmed';
  for (const node of document.querySelectorAll('[data-public-date-label]')) node.textContent = content.event.dateStatus === 'confirmed' ? '活动日期已确认' : '活动日期暂定';
  for (const node of document.querySelectorAll('[data-public-event-title]')) node.textContent = content.event.title;
  for (const node of document.querySelectorAll('[data-public-hero-venue]')) node.textContent = content.event.venue;
  for (const node of document.querySelectorAll('[data-public-poster-date]')) {
    const [,month,day] = content.event.date.split('-');
    node.replaceChildren(document.createTextNode(month), element('br'), element('span', day));
  }
  document.title = content.event.title + '｜活动安排';
  for (const node of document.querySelectorAll('[data-public-event-venue]')) node.textContent = content.event.venue + (content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  const notice = document.querySelector('[data-public-content-status]');
  if (notice) notice.textContent = content.event.status === 'cancelled' ? '本次活动已取消。' : '以下为已发布安排；请留意后续更新。讲者以各场次确认状态为准。';
}
