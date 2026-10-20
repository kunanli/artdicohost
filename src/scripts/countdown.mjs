import { eventCountdown } from '../../shared/event-countdown.mjs';

for (const root of document.querySelectorAll('[data-event-countdown]')) {
  if (!(root instanceof HTMLElement) || root.dataset.countdownEnhanced) continue;
  const startsAt = Date.parse(root.dataset.startsAt ?? '');
  const endsAt = Date.parse(root.dataset.endsAt ?? '');
  const timer = root.querySelector('[data-countdown-timer]');
  const fallback = root.querySelector('[data-countdown-fallback]');
  const status = root.querySelector('[data-countdown-status]');
  const label = root.querySelector('[data-countdown-label]');
  if (!(timer instanceof HTMLElement) || !(fallback instanceof HTMLElement) || !status || !label) continue;
  let timeout;
  let phase;
  function stop() { clearTimeout(timeout); }
  function render() {
    stop();
    // Published content hides this widget if its date/timezone differs from
    // the confirmed target, or the event is cancelled; stop the old timer then.
    if (root.hidden || document.hidden) return;
    const current = eventCountdown(Date.now(), startsAt, endsAt);
    timer.hidden = current.phase !== 'upcoming';
    fallback.hidden = current.phase !== 'unavailable';
    label.hidden = current.phase !== 'upcoming';
    if (current.phase === 'upcoming') {
      for (const unit of ['days', 'hours', 'minutes', 'seconds']) {
        const value = root.querySelector(`[data-countdown-value="${unit}"]`);
        if (value) value.textContent = String(current[unit]).padStart(2, '0');
      }
    }
    // Announce phase changes only. The timer itself is deliberately aria-live=off.
    if (phase !== current.phase) {
      status.textContent = current.phase === 'live' ? '活动进行中'
        : current.phase === 'ended' ? '本次活动已结束' : '';
      phase = current.phase;
      root.dataset.countdownPhase = phase;
    }
    if (current.phase === 'upcoming' || current.phase === 'live') {
      timeout = setTimeout(render, 1000 - Date.now() % 1000);
    }
  }
  document.addEventListener('visibilitychange', render);
  const observer = new MutationObserver(render);
  observer.observe(root, { attributes: true, attributeFilter: ['hidden'] });
  root.dataset.countdownEnhanced = 'true';
  render();
}
