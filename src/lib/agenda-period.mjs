import { eventConfig } from '../config/event.mjs';

export function agendaPeriod(zone, start, end) {
  if (zone === 'C' && start === eventConfig.time.start && end === eventConfig.time.end) return 'all-day';
  return start < '12:00' ? 'morning' : 'afternoon';
}

export const agendaPeriodLabels = {
  'all-day': ['全日', 'ALL DAY'],
  morning: ['上午', 'MORNING'],
  afternoon: ['午后', 'AFTERNOON'],
};
