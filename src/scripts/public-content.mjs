import { publicGuestCards } from '../../shared/guest-display.mjs';

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
  // Published sessions do not define check-in/opening. Keep the confirmed countdown
  // only while its original date/timezone facts still match the published event.
  for (const hint of document.querySelectorAll('[data-public-static-hours], [data-public-static-checkin]')) {
    const sameCountdown = hint.matches('[data-event-countdown]')
      && hint.dataset.countdownSourceDate === content.event.date
      && hint.dataset.countdownSourceTimezone === content.event.timezone
      && content.event.dateStatus === 'confirmed' && content.event.status !== 'cancelled';
    hint.hidden = !sameCountdown;
  }
  const programTimezone = document.querySelector('[data-public-program-timezone]');
  if (programTimezone) programTimezone.textContent = ['Asia/Shanghai', 'Asia/Hong_Kong'].includes(content.event.timezone)
    ? '北京时间 · UTC+8' : '活动时区 · ' + content.event.timezone;
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
      detail.append(element('span', item.zone + ' 区', 'ah-session-category'), element('strong', item.title));
      if (item.status === 'cancelled') {
        row.dataset.sessionStatus = 'cancelled';
        detail.append(element('small', '本场已取消', 'ah-session-meta'));
      } else detail.append(element('small', item.speakerStatus === 'confirmed' ? '讲者：' + item.speakerName : '讲者 / 主持人待确认', 'ah-session-meta'));
      row.append(detail);
      list.append(row);
    }
  }
  agenda?.dispatchEvent(new Event('artdico:content-updated'));
  const guestGrid = document.querySelector('[data-public-guests]');
  if (guestGrid) {
    const cards = publicGuestCards(content.guests);
    guestGrid.replaceChildren();
    for (const guest of cards) {
      const card = element('li', undefined, 'ah-guest-card');
      const portrait = element('div', undefined, 'ah-guest-portrait');
      const initial = element('span', Array.from(guest.name)[0], 'ah-guest-initial');
      initial.setAttribute('aria-hidden', 'true');
      const photo = document.createElement('img');
      photo.width = 116; photo.height = 116;
      photo.alt = guest.name + '的头像'; photo.loading = 'lazy'; photo.decoding = 'async';
      photo.addEventListener('error', () => { photo.hidden = true; });
      photo.src = guest.portraitUrl;
      portrait.append(initial, photo);
      card.append(portrait, element('h3', guest.name, 'ah-guest-name'), element('p', guest.company, 'ah-guest-company'));
      if (guest.ggjRole) card.append(element('p', guest.ggjRole, 'ah-guest-role'));
      guestGrid.append(card);
    }
    guestGrid.hidden = cards.length === 0;
    const emptyGuests = document.querySelector('[data-public-guests-empty]');
    if (emptyGuests) emptyGuests.hidden = cards.length > 0;
  }
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
  // Keep the first brand written out when loading an older published event revision.
  const knownTitle = /^(\d{4}) (?:GGJ|GlobalGameJam) 中国交流聚会 × ARTDiCO HOST 学生嘉年华$/u.exec(content.event.title);
  const eventTitle = knownTitle ? `${knownTitle[1]} GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华` : content.event.title;
  for (const node of document.querySelectorAll('[data-public-event-title]')) {
    if (node.tagName !== 'H1') { node.textContent = eventTitle; continue; }
    node.setAttribute('aria-label', eventTitle);
    if (eventTitle === (node.dataset.renderedEventTitle || node.dataset.initialEventTitle)) continue;
    node.dataset.renderedEventTitle = eventTitle;
    if (knownTitle) {
      const first = element('span', undefined, 'ah-event-title-line');
      first.append(element('span', 'GlobalGameJam', 'ah-event-brand'), element('span', '中国交流聚会', 'ah-event-chinese'));
      const second = element('span', undefined, 'ah-event-title-line');
      second.append(element('span', 'ARTDiCO HOST', 'ah-event-brand'), element('span', '学生嘉年华', 'ah-event-chinese'));
      node.replaceChildren(first, element('span', '×', 'ah-event-title-cross'), second);
      continue;
    }
    const titles = eventTitle.split(' × ');
    if (titles.length === 2) {
      node.replaceChildren(
        element('span', titles[0], 'ah-event-title-line'),
        element('span', '×', 'ah-event-title-cross'),
        element('span', titles[1], 'ah-event-title-line'),
      );
    } else node.textContent = eventTitle;
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
  document.title = eventTitle + '｜活动安排';
  for (const node of document.querySelectorAll('[data-public-event-venue]')) node.textContent = content.event.venue + (content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  const notice = document.querySelector('[data-public-content-status]');
  if (notice) notice.textContent = content.event.status === 'cancelled' ? '本次活动已取消。' : '讲者与主题陆续公布。';
}
