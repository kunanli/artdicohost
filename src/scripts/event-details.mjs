import { orderedSessions } from '../../shared/content-schema.mjs';
import { commemorativeCardVenue } from '../../shared/general-application.mjs';
import { resolvePublicContentSource } from '../../shared/public-content-source.mjs';
import { publicShowcaseCards, SHOWCASE_KIND_LABELS } from '../../shared/showcase-display.mjs';
import { INVITATION_POSTER_FACTS } from '../../shared/organizer-progress.mjs';
import { appleMapsDirectionsUrl, assessPublishedEventFacts, eventConfig } from '../config/event.mjs';
import { createPublicContentRefresh } from '../lib/public-content-refresh.mjs';

const page = document.querySelector('[data-event-details]');
const find = key => page.querySelector('[data-event-' + key + ']');
const endpoint = document.querySelector('meta[name="artdico-content-api"]')?.content;
const source = endpoint && resolvePublicContentSource(endpoint, location.origin);

function node(tag, text) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  return element;
}

function render(snapshot) {
  const { event, sessions, guests, showcases, booths, sessionOrder } = snapshot.content;
  const cancelled = event.status === 'cancelled';
  const date = find('date');
  date.dateTime = event.date;
  date.textContent = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(event.date + 'T12:00:00Z'))
    + (event.dateStatus === 'confirmed' ? '' : '（暂定）');
  const times = event.presentation ?? (assessPublishedEventFacts(snapshot).ready
    ? { openingTime: eventConfig.time.opening, endTime: eventConfig.time.end } : {});
  const start = times.openingTime, end = times.endTime;
  find('hours').textContent = cancelled ? '已取消' : start && end && start < end
    ? start + '–' + end + (event.timezone === eventConfig.time.timezone ? '（北京时间）' : '（' + event.timezone + '）') : '待公布';
  find('venue').textContent = event.venue + (event.venueStatus === 'confirmed' ? '' : '（暂定）');
  const knownVenue = [eventConfig.venue.name, eventConfig.venue.address, commemorativeCardVenue(eventConfig.venue.address), INVITATION_POSTER_FACTS.venue].includes(event.venue);
  const address = find('address');
  address.hidden = !knownVenue || event.venue === eventConfig.venue.address;
  const map = find('map');
  map.href = appleMapsDirectionsUrl(knownVenue ? eventConfig.venue.address : event.venue);
  map.hidden = cancelled || event.venueStatus !== 'confirmed';
  find('registration').hidden = cancelled;
  const status = find('status');
  status.textContent = cancelled ? '本次活动已取消。' : '';
  status.hidden = !cancelled;

  const speakers = new Map(guests.map(guest => [guest.id, guest.name]));
  for (const list of page.querySelectorAll('[data-event-zone]')) {
    const ordered = orderedSessions(sessions.filter(session => session.zone === list.dataset.eventZone), sessionOrder);
    list.replaceChildren(...ordered.map(session => {
      const row = node('li');
      row.className = 'event-session';
      const time = node('time', session.start + '–' + session.end);
      time.dateTime = session.start;
      const description = node('div');
      description.append(node('p', session.title));
      const names = new Set([session.speakerName, ...(session.participants ?? []).map(({ guestId }) => speakers.get(guestId))].filter(Boolean));
      const subtitle = session.status === 'cancelled' ? '本场已取消' : [...names].join('、');
      if (subtitle) description.append(node('small', subtitle));
      row.append(time, description);
      return row;
    }));
    list.nextElementSibling.hidden = ordered.length > 0;
  }
  find('agenda-note').hidden = true;

  const works = publicShowcaseCards(showcases);
  const publicBooths = new Map(booths.map(booth => [booth.id, booth]));
  find('games').replaceChildren(...works.map(work => {
    const row = node('li');
    row.className = 'event-game';
    if (work.coverUrl) {
      const image = node('img');
      image.loading = 'lazy';
      image.decoding = 'async';
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => image.remove(), { once: true });
      image.src = new URL(work.coverUrl, source).href;
      row.append(image);
    }
    row.append(node('h3', work.title), node('small', [SHOWCASE_KIND_LABELS[work.kind], work.teamName].filter(Boolean).join(' · ')));
    if (work.summary) row.append(node('p', work.summary));
    const booth = publicBooths.get(work.boothId);
    if (booth) row.append(node('small', '展位 ' + booth.code));
    return row;
  }));
  const gamesNote = find('games-note');
  gamesNote.textContent = '参展作品尚未公布。';
  gamesNote.hidden = works.length > 0;
}

function showUnavailable(current) {
  const note = find('agenda-note');
  note.textContent = current ? '暂时无法取得最新安排，以下为上一次公布的版本。' : '暂时无法取得更新，以下为本页附带的日程。';
  note.hidden = false;
  if (!current) find('games-note').textContent = '暂时无法读取参展作品。';
}

if (source) createPublicContentRefresh({
  url: source,
  onContent: render,
  onState({ status, current }) {
    if (status === 'unavailable') showUnavailable(current);
    if (status === 'missing') find('games-note').textContent = '参展作品尚未公布。';
    if (status === 'published') find('agenda-note').hidden = true;
  },
}).start();
else showUnavailable(null);
