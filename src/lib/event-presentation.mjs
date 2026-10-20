/** Resolve one unambiguous wall-clock time. Invalid or DST-ambiguous times remain unavailable. */
export function eventTimeInstant(date,time,timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time)) return null;
  try {
    const [year,month,day] = date.split('-').map(Number);
    const [hour,minute] = time.split(':').map(Number);
    const target = Date.UTC(year,month-1,day,hour,minute);
    if (new Date(target).toISOString().slice(0,10) !== date) return null;
    const formatter = new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
    const parts = instant => Object.fromEntries(formatter.formatToParts(new Date(instant)).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)]));
    const offsets = new Set();
    for (let delta=-36;delta<=36;delta+=4) {
      const sample=target+delta*3600000;
      const p=parts(sample);
      offsets.add(Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second)-sample);
    }
    const candidates=[];
    for (const offset of offsets) {
      const instant=target-offset,p=parts(instant);
      if(p.year===year&&p.month===month&&p.day===day&&p.hour===hour&&p.minute===minute&&p.second===0)candidates.push(instant);
    }
    return candidates.length===1?candidates[0]:null;
  } catch {return null;}
}
