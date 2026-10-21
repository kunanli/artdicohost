import { publicGuestCards, publicGuestSessions } from '../../shared/guest-display.mjs';
import { GUEST_PUBLIC_ROLE_LABELS, isPublicWebsite } from '../../shared/content-schema.mjs';
import { publicShowcaseCards } from '../../shared/showcase-display.mjs';
import { resolvePublicContentSource } from '../../shared/public-content-source.mjs';
import { eventTimeInstant } from '../lib/event-presentation.mjs';

// Published event content is independent from registration readiness and staff cookies.
const endpoint = document.querySelector('meta[name="artdico-content-api"]')?.getAttribute('content');
if (endpoint) {
  const target = resolvePublicContentSource(endpoint, location.origin);
  if (target) {
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
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(item.id)) row.id = 'program-' + item.id;
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
      if (url.origin !== location.origin) photo.crossOrigin = 'anonymous';
      photo.referrerPolicy = 'no-referrer';
      photo.src = new URL(guest.portraitUrl, url.origin).href;
      portrait.append(initial, photo);
      const body = element('div',undefined,'ah-guest-body');
      body.append(element('h3',guest.name,'ah-guest-name'));
      if (guest.publicRoles?.length) body.append(element('p',guest.publicRoles.map(role => GUEST_PUBLIC_ROLE_LABELS[role]).join(' · '),'ah-guest-duty'));
      body.append(element('p',[guest.title,guest.company].filter(Boolean).join(' · '),'ah-guest-company'));
      if (guest.ggjRole) body.append(element('p',guest.ggjRole,'ah-guest-role'));
      const sessions = publicGuestSessions(content.sessions,guest.id);
      if (guest.bio || sessions.length || guest.website) {
        const details = element('details',undefined,'ah-guest-details');
        details.append(element('summary',guest.bio ? sessions.length ? '简介与参与场次' : '人物简介' : sessions.length ? '参与场次' : '相关网站'));
        if (guest.bio) details.append(element('p',guest.bio,'ah-guest-bio'));
        if (sessions.length) {
          const list = element('ul');
          for (const session of sessions) {
            const item = element('li'), link = element('a',session.start + '–' + session.end + ' · ' + session.zone + ' 区 · ' + session.title);
            link.href = '#program-' + session.id;
            link.addEventListener('click',() => {
              const panel = document.getElementById('program-' + session.id)?.closest('[data-agenda-panel]');
              if(fullProgram)fullProgram.open=true;
              const period=agenda?.querySelector('[data-program-period]');if(period){period.value='all';period.dispatchEvent(new Event('change'));}
              agenda?.querySelector('[data-zone="' + panel?.dataset.agendaPanel + '"]')?.click();
            });
            item.append(link);list.append(item);
          }
          details.append(list);
        }
        if (guest.website) { const link = element('a','个人 / 机构网站');link.href=guest.website;link.target='_blank';link.rel='noopener noreferrer';details.append(link); }
        body.append(details);
      }
      card.append(portrait,body);
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
      card.append(element('h3',item.organization),element('p',item.project,'ah-booth-project'),element('small',item.code + ' · ' + item.zone + ' 区'));
      if(typeof item.description==='string'&&item.description)card.append(element('p',item.description,'ah-booth-description'));
      if(typeof item.website==='string'&&item.website&&isPublicWebsite(item.website)){const link=element('a','组织网站','ah-booth-website');link.href=item.website;link.target='_blank';link.rel='noopener noreferrer';card.append(link);}
      booths.append(card);
    }
    const empty = document.querySelector('[data-public-booths-empty]');
    if (empty) empty.hidden = booths.childElementCount > 0;
  }
  // Older published revisions do not contain a showcase list. Keep the labelled
  // concept image for those revisions; an explicit empty list has no public work.
  if (Object.hasOwn(content, 'showcases')) renderShowcases(content, url);
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
  renderPresentation(content.event);
  const notice = document.querySelector('[data-public-content-status]');
  if (notice) notice.textContent = content.event.status === 'cancelled' ? '本次活动已取消。' : '讲者与主题陆续公布。';
  document.dispatchEvent(new Event('artdico:public-content-updated'));
}

function renderPresentation(event) {
  const presentation=event.presentation;
  if(!presentation||typeof presentation!=='object')return;
  for(const [field,selector]of Object.entries({heroDescription:'[data-public-hero-description]',aboutTitle:'[data-public-about-title]',aboutText:'[data-public-about-text]'})){
    if(typeof presentation[field]==='string')for(const element of document.querySelectorAll(selector))element.textContent=presentation[field];
  }
  const faq=document.querySelector('[data-public-faq]');
  if(faq&&Array.isArray(presentation.faqItems)&&presentation.faqItems.length<=20){
    faq.replaceChildren();
    for(const item of presentation.faqItems){
      if(typeof item?.question!=='string'||typeof item?.answer!=='string')continue;
      const row=element('details');const heading=element('summary',item.question);heading.append(element('span','+'));row.append(heading,element('p',item.answer));faq.append(row);
    }
  }
  const contact=document.querySelector('[data-public-contact-email]');
  if(contact){contact.hidden=true;contact.removeAttribute('href');if(typeof presentation.contactEmail==='string'&&/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(presentation.contactEmail)){contact.textContent='联络筹备团队 · '+presentation.contactEmail;contact.href='mailto:'+encodeURIComponent(presentation.contactEmail);contact.hidden=false;}}
  const map=document.querySelector('[data-public-map]');
  if(map){map.hidden=true;map.removeAttribute('href');try{const url=new URL(presentation.mapUrl);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash){map.href=url.href;map.hidden=false;}}catch{}}
  const start=eventTimeInstant(event.date,presentation.openingTime,event.timezone);
  const end=eventTimeInstant(event.date,presentation.endTime,event.timezone);
  const confirmed=event.dateStatus==='confirmed'&&event.status!=='cancelled'&&start!==null&&end!==null&&end>start;
  const countdown=document.querySelector('[data-event-countdown]');
  if(countdown){
    countdown.hidden=!confirmed;
    if(confirmed){countdown.dataset.startsAt=new Date(start).toISOString();countdown.dataset.endsAt=new Date(end).toISOString();const fallback=countdown.querySelector('[data-countdown-fallback]');if(fallback)fallback.textContent=event.date+' '+presentation.openingTime+' · '+event.timezone+' 开场';}
  }
  for(const hours of document.querySelectorAll('span[data-public-static-hours]')){hours.hidden=!confirmed;if(confirmed)hours.textContent=' · '+presentation.openingTime+'–'+presentation.endTime;}
  for(const checkin of document.querySelectorAll('[data-public-static-checkin]')){checkin.hidden=!confirmed;if(confirmed)checkin.textContent=presentation.checkInTime+' 开始签到 · ';}
}

function renderShowcases(content, sourceUrl) {
  const grid = document.querySelector('[data-public-showcases]');
  if (!grid) return;
  const cards = publicShowcaseCards(content.showcases);
  grid.replaceChildren();
  for (const work of cards) {
    const card = element('li', undefined, 'ah-showcase-card');
    const photo = document.createElement('img');
    photo.width = 960; photo.height = 540;
    photo.alt = work.title + '的作品图';
    photo.loading = 'lazy'; photo.decoding = 'async';
    photo.referrerPolicy = 'no-referrer';
    if (sourceUrl.origin !== location.origin) photo.crossOrigin = 'anonymous';
    // The helper constructs this path from a content-addressed image ID, never
    // an external URL or a private materials link from the admin record.
    photo.src = new URL(work.coverUrl, sourceUrl.origin).href;
    photo.addEventListener('error', () => { photo.hidden = true; });
    const detail = element('div', undefined, 'ah-showcase-card-body');
    detail.append(element('h3', work.title), element('p', work.teamName, 'ah-showcase-team'));
    if (work.summary) detail.append(element('p', work.summary));
    const arrangement = [];
    const session = content.sessions.find(item => item.id === work.sessionId && item.status === 'scheduled');
    if (session && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(session.start)
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(session.end) && ['A', 'B', 'C'].includes(session.zone)) {
      arrangement.push('作品分享 · ' + session.start + '–' + session.end + ' · ' + session.zone + ' 区');
    }
    const booth = content.booths.find(item => item.id === work.boothId && item.status === 'confirmed');
    if (booth && typeof booth.code === 'string' && /^[A-Z0-9][A-Z0-9-]{0,15}$/u.test(booth.code) && booth.zone === 'C') {
      arrangement.push('展位试玩 · C 区 ' + booth.code);
    }
    if (arrangement.length) detail.append(element('p', arrangement.join(' / '), 'ah-showcase-arrangement'));
    card.append(photo, detail);
    grid.append(card);
  }
  grid.hidden = cards.length === 0;
  const concept = document.querySelector('[data-public-showcases-concept]');
  if (concept) concept.hidden = true;
  const empty = document.querySelector('[data-public-showcases-empty]');
  if (empty) empty.hidden = cards.length > 0;
}
