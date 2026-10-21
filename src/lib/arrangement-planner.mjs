import { validateContent } from '../../shared/content-schema.mjs';
import { validateContactOperations } from '../../shared/contacts-schema.mjs';
import { boothOrganizationField } from './content-relationships.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const fields = ['code','organization','project','contactName','contactMethods','description','status'];
const clone = value => structuredClone(value);

export function boothReadiness(booth) {
  return [['organization','机构 / 团队'],['project','展示项目'],['contactName','负责人'],['contactMethods','联系方式'],['description','展示内容']]
    .filter(([key]) => !String(booth?.[key] ?? '').trim()).map(([, label]) => '待补：' + label);
}

/** Apply only the explicitly edited fields to the latest local draft; never publish or write. */
export function prepareBoothDraft(content, { boothId = null, slotNumber, original = null, changes, newId } = {}) {
  if (!content || !Array.isArray(content.booths) || !Number.isSafeInteger(slotNumber) || slotNumber < 1 || slotNumber > 15
    || !changes || typeof changes !== 'object') throw new Error('展位编辑资料无效。');
  const next = clone(content);
  const previous = boothId ? next.booths.find(item => item.id === boothId) : null;
  if (boothId && !previous || previous && JSON.stringify(previous) !== JSON.stringify(original)
    || !previous && next.booths.some(item => item.slotNumber === slotNumber && item.status !== 'cancelled')) throw new Error('此展位在本页已有其他修改，请重新打开后核对。');
  if (!previous && !ID.test(newId ?? '')) throw new Error('新增展位标识无效。');
  const candidate = previous ?? { id: newId, code: '', organization: '', project: '', zone: 'C', status: 'pending', internalNotes: '', slotNumber,
    contactName: '', contactMethods: '', description: '' };
  for (const key of fields) {
    if (typeof changes[key] !== 'string') throw new Error('请完整填写本次展位编辑字段。');
    candidate[key] = changes[key];
  }
  if (Object.hasOwn(changes, 'organizationId')) Object.assign(candidate, boothOrganizationField(previous, changes.organizationId));
  candidate.slotNumber = slotNumber;
  if (!previous) next.booths.push(candidate);
  const result = validateContent(next);
  if (!result.valid) throw new Error([...new Set(Object.values(result.errors))].join(' '));
  return { content: result.value, boothId: candidate.id, warnings: boothReadiness(candidate) };
}

/** Keep follow-up, consent and actual reply unchanged when adjusting private allocations. */
export function prepareContactAssignments(contact, { sessionIds, boothIds }, content) {
  if (!ID.test(contact?.id ?? '') || contact.profile?.contactConsent === 'declined' || contact.operations?.responseStatus === 'declined') throw new Error('已拒绝联络或出席的对象不能新增安排。');
  const sessionRoles = (contact.operations.sessionRoles ?? []).filter(entry => Array.isArray(sessionIds) && sessionIds.includes(entry.sessionId));
  const checked = validateContactOperations({ ...clone(contact.operations), sessionIds, boothIds, sessionRoles }, content);
  if (!checked.valid) throw new Error([...new Set(Object.values(checked.errors))].join(' '));
  return checked.value;
}

/** One row per start time and one column per zone; workshop views never duplicate a session. */
export function sessionTimeline(snapshot) {
  const sessions = new Map();
  for (const zone of ['A','B','other']) for (const session of snapshot?.sessions?.[zone] ?? []) {
    if (!ID.test(session?.id ?? '') || !/^\d\d:\d\d$/u.test(session.start) || !['A','B','C'].includes(session.zone)) continue;
    if (!sessions.has(session.id)) sessions.set(session.id, clone(session));
  }
  const starts = [...new Set([...sessions.values()].map(item => item.start))].sort();
  return starts.map(start => ({ start, zones: Object.fromEntries(['A','B','C'].map(zone => [zone,
    [...sessions.values()].filter(item => item.start === start && item.zone === zone).sort((a,b) => a.id.localeCompare(b.id))])) }));
}
