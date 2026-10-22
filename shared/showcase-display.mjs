import { isPublicShowcase, showcaseAllocations } from './content-schema.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownValue = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const coverPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
export const SHOWCASE_KIND_LABELS=Object.freeze({student:'学生作品',indie:'独立游戏',team:'团队作品'});
const line = (value, limit, required = true) => typeof value === 'string'
  && [...value.trim()].length <= limit && (!required || value.trim().length > 0)
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;

/** Display-only projection; the API remains responsible for publication authorization. */
export function publicShowcaseCards(input) {
  if (!Array.isArray(input) || input.length > 200) return [];
  const seen = new Set();
  return input.flatMap(value => {
    if (!record(value) || Object.hasOwn(value, 'visibility') && ownValue(value, 'visibility') !== 'public'
      || !['pending','confirmed'].includes(ownValue(value, 'status'))
      || !['pending','attending','declined'].includes(ownValue(value, 'responseStatus'))) return [];
    const id = ownValue(value, 'id');
    const coverId = ownValue(value, 'coverId');
    const title = line(ownValue(value, 'title'), 200, ownValue(value, 'status') === 'confirmed');
    const teamName = line(ownValue(value, 'teamName'), 160, ownValue(value, 'status') === 'confirmed');
    const summary = line(ownValue(value, 'summary') ?? '', 300, false);
    const sessionId = ownValue(value, 'sessionId') ?? '';
    const boothId = ownValue(value, 'boothId') ?? '';
    const forms = ownValue(value, 'participationForms');
    const kind=Object.hasOwn(value,'kind')?ownValue(value,'kind'):'student';
    const organizationId=Object.hasOwn(value,'organizationId')?ownValue(value,'organizationId'):undefined;
    if (typeof id !== 'string' || !idPattern.test(id) || seen.has(id) || typeof coverId !== 'string' || coverId !== '' && !coverPattern.test(coverId)
      || title === null || teamName === null || summary === null || typeof sessionId !== 'string' || typeof boothId !== 'string'
      || sessionId && !idPattern.test(sessionId) || boothId && !idPattern.test(boothId)
      || !Array.isArray(forms) || forms.length > 2 || new Set(forms).size !== forms.length
      || forms.some(form => !['booth', 'share'].includes(form))
      || Boolean(sessionId) !== forms.includes('share') || Boolean(boothId) !== forms.includes('booth')
      || typeof kind!=='string'||!Object.hasOwn(SHOWCASE_KIND_LABELS,kind)
      || Object.hasOwn(value,'organizationId')&&(typeof organizationId!=='string'||organizationId!==''&&!idPattern.test(organizationId))) return [];
    seen.add(id);
    return [{ id, title: title || '作品名称待补', teamName, summary, coverId, coverUrl: coverId ? '/api/public/portraits/' + coverId : '', sessionId, boothId,kind,
      ...(organizationId?{organizationId}:{}),
      ...(ownValue(value,'status')!=='confirmed'?{status:ownValue(value,'status')}:{}),
      ...(ownValue(value,'responseStatus')!=='attending'?{responseStatus:ownValue(value,'responseStatus')}:{}) }];
  });
}

/** Private admin planning counts. Students means recorded group sizes, not unique check-ins. */
export function showcaseSummary(showcases, content) {
  const items = Array.isArray(showcases) ? showcases : [];
  const attending = items.filter(item => item.responseStatus === 'attending');
  return {
    totalTeams: items.length,
    confirmedTeams: attending.length,
    confirmedStudents: attending.reduce((sum, item) => sum + (Number.isInteger(item.memberCount) && item.memberCount > 0 && item.memberCount <= 50 ? item.memberCount : 0), 0),
    shareTeams: attending.filter(item => showcaseAllocations(item, content).sessionId).length,
    boothTeams: attending.filter(item => showcaseAllocations(item, content).boothId).length,
    readyToPublishTeams: items.filter(item => isPublicShowcase(item, content)).length,
  };
}
