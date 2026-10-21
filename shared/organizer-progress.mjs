/** Private progress projection shared by the authorized API and contacts UI.
 * A saved invitation, a staff send record, a provider acknowledgement and an
 * attendee reply are separate facts. None of them is proof of email delivery.
 */
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const has = (value, key) => Object.prototype.hasOwnProperty.call(value ?? {}, key);
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? Date.parse(value) : -1;
export const organizerTaskLabels = Object.freeze({
  verify_consent: '核实联络授权', unconverted: '待代登记', unsent: '待准备或人工发出邀请',
  invitation_unknown: '核对发送结果', unreplied: '已联系待回复', unassigned: '待安排参与场次 / 展位',
  follow_up: '到期跟进', missing_booth_details: '补齐展位资料', admission_pending: '候补 / 名额待确认',
});
export function contactDeclined(contact) {
  return contact?.profile?.contactConsent === 'declined' || contact?.operations?.responseStatus === 'declined';
}
function settingsCurrent(settings, contact, event) {
  if (!settings || settings.confirmed !== true || !event) return false;
  const names = [contact?.profile?.displayName, contact?.profile?.name].map(text).filter(Boolean);
  const times = [event.time?.label, event.time?.start && event.time?.end ? event.time.start + '–' + event.time.end : ''].filter(Boolean);
  return names.includes(text(settings.recipientName)) && settings.date === event.date?.value
    && times.includes(settings.time) && settings.venue === (event.venue?.address || event.venue?.name);
}
function latestByChannel(invitations) {
  const values = new Map();
  for (const entry of invitations) {
    const channel = entry.channel;
    if (!['manual', 'email'].includes(channel)) continue;
    const previous = values.get(channel);
    // Creation determines the current version. Updating an old send record
    // must never make it newer than an invitation prepared subsequently.
    if (!previous || time(entry.createdAt) > time(previous.createdAt)
      || time(entry.createdAt) === time(previous.createdAt) && time(entry.updatedAt) >= time(previous.updatedAt)) values.set(channel, entry);
  }
  return [...values.values()];
}
export function contactProgress(contact, { intent = null, content = null, event, now = Date.now(), inactiveRegistrationIds = [], admissionStatuses = [] } = {}) {
  const id = contact.id, excluded = contactDeclined(contact), operations = contact.operations ?? {};
  const conversion = list(intent?.conversions).find(entry => entry.sourceContactId === id) ?? null;
  const admission = conversion ? list(admissionStatuses).find(entry => entry.registrationId === conversion.registrationId)?.status ?? conversion.admissionStatus ?? 'unknown' : null;
  const admissionStatus = conversion ? (list(inactiveRegistrationIds).includes(conversion.registrationId) ? 'withdrawn' : ['confirmed','waitlisted','withdrawn'].includes(admission) ? admission : 'unknown') : null;
  const inactive = admissionStatus === 'withdrawn';
  const admissionPending = ['waitlisted','unknown'].includes(admissionStatus);
  const legacy = contact.invitation ?? {};
  const legacyCurrent = Boolean(time(legacy.generatedAt) >= 0 && time(legacy.generatedAt) <= now && settingsCurrent(legacy.settings, contact, event));
  const legacySent = Boolean(legacyCurrent && time(legacy.sentAt) >= time(legacy.generatedAt) && time(legacy.sentAt) <= now && legacy.sentGenerationAt === legacy.generatedAt);
  const versions = latestByChannel(list(intent?.invitations).filter(entry => entry.sourceContactId === id));
  const current = versions.filter(entry => conversion && entry.registrationId === conversion.registrationId
    && entry.content?.registrationId === conversion.registrationId && entry.content?.referenceCode === conversion.referenceCode
    && entry.content?.eventId === event?.id && entry.content?.title === event?.title
    && settingsCurrent(entry.content?.settings, contact, event) && time(entry.createdAt) >= 0 && time(entry.createdAt) <= now
    && (!has(entry, 'expiresAt') || time(entry.expiresAt) > now));
  const manuallySent = !excluded && !inactive && (legacySent || current.some(entry => entry.channel === 'manual' && entry.status === 'manually_sent'));
  const providerAccepted = !excluded && !inactive && current.some(entry => entry.channel === 'email' && entry.status === 'provider_accepted');
  const unknown = !excluded && !inactive && current.some(entry => ['issuing', 'unknown'].includes(entry.status));
  const prepared = !excluded && !inactive && (legacyCurrent || current.some(entry => entry.status === 'prepared'));
  const stale = Boolean(legacy.generatedAt && !legacyCurrent || legacy.sentAt && !legacySent || versions.some(entry => !current.includes(entry)));
  const sessions = list(content?.sessions).filter(entry => entry.status !== 'cancelled');
  const booths = list(content?.booths).filter(entry => entry.status !== 'cancelled');
  const validSessions = list(operations.sessionIds).filter(id => sessions.some(entry => entry.id === id));
  const validBooths = list(operations.boothIds).filter(id => booths.some(entry => entry.id === id));
  const forms = list(operations.participationForms);
  const needsSession = forms.some(value => ['speaker', 'panelist', 'host', 'organizer'].includes(value));
  const needsBooth = forms.includes('booth');
  const needsShowcase = forms.includes('student_showcase');
  const missingAssignment = (needsSession && !validSessions.length) || (needsBooth && !validBooths.length)
    || (needsShowcase && !validSessions.length && !validBooths.length);
  const state = excluded ? 'excluded' : inactive ? 'inactive' : admissionStatus === 'waitlisted' ? 'waitlisted' : admissionPending ? 'admission_unknown' : manuallySent ? 'manually_sent' : unknown ? 'unknown'
    : providerAccepted ? 'provider_accepted' : prepared ? 'prepared' : stale ? 'stale' : 'not_prepared';
  return { contactId: id, owner: text(operations.owner), excluded, consented: contact.profile?.contactConsent === 'consented',
    conversion, admissionStatus, admissionPending, inactive, state, manuallySent, providerAccepted, unknown, prepared, stale,
    response: operations.responseStatus ?? 'pending', contacted: manuallySent || providerAccepted,
    assigned: validSessions.length + validBooths.length > 0, missingAssignment,
    followUpAt: text(operations.followUpAt), needsSession, needsBooth, needsShowcase };
}
export function summarizeContactProgress(contacts, options = {}) {
  const progress = list(contacts).map(contact => contactProgress(contact, options));
  const active = progress.filter(entry => !entry.excluded);
  return { total: progress.length, excluded: progress.length - active.length, actionable: active.length,
    converted: active.filter(entry => entry.conversion).length,
    manuallySent: active.filter(entry => entry.manuallySent).length,
    providerAccepted: active.filter(entry => entry.providerAccepted).length,
    unknown: active.filter(entry => entry.unknown).length,
    waitlisted: active.filter(entry => entry.admissionStatus === 'waitlisted').length,
    admissionUnknown: active.filter(entry => entry.admissionStatus === 'unknown').length,
    attending: active.filter(entry => entry.response === 'attending').length,
    awaitingReply: active.filter(entry => entry.response === 'pending' && entry.contacted).length,
    progress };
}
export const invitationProgressLabels = Object.freeze({ excluded: '已拒绝联络或出席 · 不邀请', inactive: '关联报名已停用 · 请核对',
  waitlisted: '已登记候补 · 名额尚未确认', admission_unknown: '名额状态待核对 · 暂不准备正式邀请',
  manually_sent: '当前版已记录人工发出', provider_accepted: '服务商已接受 · 未证明送达', unknown: '发送结果不明 · 勿重复发送',
  prepared: '当前版已准备 · 未记录发出', stale: '历史版本 · 当前版尚未记录发出', not_prepared: '当前版尚未准备' });

/** No contact methods or original answers leave this projection. */
export function buildOrganizerTasks({ contacts = [], contactRevision = 0, content = {}, contentRevision = 0,
  intent = null, inactiveRegistrationIds = [], admissionStatuses = [], event, now = Date.now() } = {}) {
  const options = { intent, content, inactiveRegistrationIds, admissionStatuses, event, now };
  const summary = summarizeContactProgress(contacts, options), tasks = [];
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(now));
  const add = (contact, progress, kind, detail) => tasks.push({ id: kind + ':' + contact.id, kind, label: organizerTaskLabels[kind],
    contactId: contact.id, name: text(contact.profile?.displayName) || text(contact.profile?.name), organization: text(contact.profile?.organization),
    owner: progress.owner, dueAt: progress.followUpAt, detail,
    href: '/admin/contacts/#contact=' + encodeURIComponent(contact.id),
    ...(progress.conversion ? { registrationHref: '/admin/registrations/#registration=' + encodeURIComponent(progress.conversion.registrationId) } : {}) });
  for (const contact of list(contacts)) {
    const progress = summary.progress.find(entry => entry.contactId === contact.id);
    if (progress.excluded || progress.inactive) continue;
    if (!progress.consented) add(contact, progress, 'verify_consent', '先核对本人联络许可；未核实前不准备或发送邀请。');
    if (intent && !progress.conversion) add(contact, progress, 'unconverted', '核对原始来源后，可在人员页预览并代登记。');
    if (progress.unknown) add(contact, progress, 'invitation_unknown', '服务商结果尚未确认；先人工核对，勿重试发送。');
    if (progress.admissionPending) {
      add(contact, progress, 'admission_pending', progress.admissionStatus === 'waitlisted'
        ? '已保存候补登记，名额尚未确认；待筹备团队核对并按已获授权的渠道通知。此时不准备正式入场邀请。'
        : '后台尚未核对名额状态，请刷新或到关联报名核对；确认前不准备正式邀请。');
      continue;
    }
    if (progress.consented && !progress.contacted && !progress.unknown) add(contact, progress, 'unsent', progress.prepared ? '邀请已准备，实际发出后再记录渠道。' : progress.stale ? '旧版记录不计为当前版已发出，请核对最新资料。' : '先准备并核对邀请内容；下载不等于发出。');
    if (progress.response === 'pending' && progress.contacted) add(contact, progress, 'unreplied', progress.providerAccepted && !progress.manuallySent ? '邮件服务商仅接受请求，尚无送达或本人回复证明。' : '已记录人工发出，仍需核对本人实际回复。');
    if (progress.response === 'attending' && progress.missingAssignment) add(contact, progress, 'unassigned', [progress.needsSession ? '场次' : '', progress.needsBooth ? '展位' : '', progress.needsShowcase ? '作品分享或展位' : ''].filter(Boolean).join(' / ') + '仍需关联有效安排；普通参会不需要分配场次。');
    if (progress.followUpAt && progress.followUpAt <= date && progress.response === 'pending') add(contact, progress, 'follow_up', '已到下次跟进日期，核对回复后更新下一步。');
  }
  for (const booth of list(content?.booths).filter(entry => entry.status !== 'cancelled')) {
    const missing = [['organization', '机构 / 团队'], ['project', '项目'], ['description', '展示内容'], ['contactName', '负责人'], ['contactMethods', '联系方式']].filter(([key]) => !text(booth[key])).map(([, label]) => label);
    if (!missing.length) continue;
    tasks.push({ id: 'missing_booth_details:' + booth.id, kind: 'missing_booth_details', label: organizerTaskLabels.missing_booth_details,
      boothId: booth.id, name: text(booth.code) || '展位', organization: text(booth.organization), owner: text(booth.contactName), dueAt: '',
      detail: '待补齐：' + missing.join('、'), href: '/admin/#booth=' + encodeURIComponent(booth.id) });
  }
  for (let slot = 1; slot <= 15; slot++) {
    if (list(content?.booths).some(booth => booth.status !== 'cancelled' && booth.slotNumber === slot)) continue;
    tasks.push({ id: 'missing_booth_details:slot-' + slot, kind: 'missing_booth_details', label: organizerTaskLabels.missing_booth_details,
      slotNumber: slot, name: String(slot).padStart(2, '0') + ' 号展位位置', organization: '', owner: '', dueAt: '',
      detail: '位置尚未关联有效展位记录；确认参展机构后，在总览安排此位置。', href: '/admin/#booths-title' });
  }
  tasks.sort((a, b) => Number(b.kind === 'invitation_unknown') - Number(a.kind === 'invitation_unknown')
    || (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || a.name.localeCompare(b.name, 'zh-CN') || a.kind.localeCompare(b.kind));
  const { progress: _privateProgress, ...metrics } = summary;
  return { generatedAt: new Date(now).toISOString(), revisions: { contacts: contactRevision, content: contentRevision, intent: intent?.revision ?? null },
    available: { registrationProgress: intent !== null, invitationLedger: intent !== null }, metrics,
    owners: [...new Set([...tasks.map(task => task.owner), ...list(contacts).map(contact => text(contact.operations?.owner))].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')), tasks };
}
