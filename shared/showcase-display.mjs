import { isPublicShowcase, showcaseAllocations } from './content-schema.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const ownValue = (value, key) => Object.getOwnPropertyDescriptor(value, key)?.value;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const coverPattern = /^[a-f0-9]{64}\.(?:jpg|png|webp)$/u;
const line = (value, limit, required = true) => typeof value === 'string'
  && [...value.trim()].length <= limit && (!required || value.trim().length > 0)
  && !/[\u0000-\u001f\u007f]/u.test(value) ? value.trim() : null;

/** Display-only projection; the API remains responsible for publication authorization. */
export function publicShowcaseCards(input) {
  if (!Array.isArray(input) || input.length > 200) return [];
  const seen = new Set();
  return input.flatMap(value => {
    if (!record(value) || ownValue(value, 'status') !== 'confirmed' || ownValue(value, 'responseStatus') !== 'attending' || ownValue(value, 'publicConsent') !== true) return [];
    const id = ownValue(value, 'id');
    const coverId = ownValue(value, 'coverId');
    const title = line(ownValue(value, 'title'), 200);
    const teamName = line(ownValue(value, 'teamName'), 160);
    const summary = line(ownValue(value, 'summary') ?? '', 300, false);
    const sessionId = ownValue(value, 'sessionId') ?? '';
    const boothId = ownValue(value, 'boothId') ?? '';
    const forms = ownValue(value, 'participationForms');
    if (typeof id !== 'string' || !idPattern.test(id) || seen.has(id) || typeof coverId !== 'string' || !coverPattern.test(coverId)
      || title === null || teamName === null || summary === null || typeof sessionId !== 'string' || typeof boothId !== 'string'
      || sessionId && !idPattern.test(sessionId) || boothId && !idPattern.test(boothId)
      || !Array.isArray(forms) || forms.length < 1 || forms.length > 2 || new Set(forms).size !== forms.length
      || forms.some(form => !['booth', 'share'].includes(form))
      || Boolean(sessionId) !== forms.includes('share') || Boolean(boothId) !== forms.includes('booth')) return [];
    seen.add(id);
    return [{ id, title, teamName, summary, coverId, coverUrl: '/api/public/portraits/' + coverId, sessionId, boothId }];
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
    readyToPublishTeams: attending.filter(item => isPublicShowcase(item, content)).length,
  };
}
