import { validateInvitationData } from './invitation-renderer.mjs';
import { INVITATION_POSTER_RENDER_VERSION } from '../../shared/organizer-progress.mjs';
import { createPrivateInvitationZip, privateInvitationFilename, privateZipEntryBytes, PRIVATE_INVITATION_ZIP_LIMIT } from './private-invitation-zip.mjs';

export const INVITATION_BATCH_MAX_CONTACTS = 100;
const METADATA_RESERVE = 512 * 1024;
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(value);
const registrationId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/u.test(value);
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/u.test(value) ? value : null;
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && !/[\u0000-\u0020\u007f]/u.test(value);
function renderChoice(value) {
  if(value!==undefined&&value!==INVITATION_POSTER_RENDER_VERSION)throw new TypeError('邀请函版本无效。');
  return value===undefined?{}:{renderVersion:value};
}
function selection(contactIds, expectedContactRevision, request) {
  if (!Array.isArray(contactIds) || !contactIds.length || contactIds.length > INVITATION_BATCH_MAX_CONTACTS
    || contactIds.some(value => !id(value)) || new Set(contactIds).size !== contactIds.length
    || !Number.isSafeInteger(expectedContactRevision) || expectedContactRevision < 0 || typeof request !== 'function') throw new TypeError('批量邀请的名单或版本无效。');
  return [...contactIds];
}
function entriesFor(response, selected, key, revision) {
  if (!response || response.contactRevision !== revision || !Array.isArray(response[key]) || response[key].length !== selected.length) throw new TypeError('批量邀请响应不完整，请核对后台记录。');
  const byId = new Map();
  for (const entry of response[key]) {
    if (!entry || !selected.includes(entry.contactId) || byId.has(entry.contactId)) throw new TypeError('批量邀请响应不完整，请核对后台记录。');
    byId.set(entry.contactId, entry);
  }
  return selected.map(contactId => byId.get(contactId));
}
const post = (request, path, payload) => request(path, { method: 'POST', body: JSON.stringify(payload) });

/** Zero mutation precheck; callers must show it before their explicit confirmation. */
export async function previewBatchInvitations({ contactIds, expectedContactRevision, request, renderVersion } = {}) {
  const selected = selection(contactIds, expectedContactRevision, request);
  const version=renderChoice(renderVersion);
  const response = await post(request, '/api/admin/contacts/invitations/preview', { contactIds: selected, expectedContactRevision,...version });
  const entries = entriesFor(response, selected, 'entries', expectedContactRevision).map(entry => {
    if (typeof entry.eligible !== 'boolean' || entry.eligible && (!registrationId(entry.registrationId) || !registrationId(entry.referenceCode))) throw new TypeError('批量邀请预检无效。');
    return { contactId: entry.contactId, eligible: entry.eligible, reason: code(entry.reason),
      ...(registrationId(entry.registrationId) ? { registrationId: entry.registrationId } : {}), ...(registrationId(entry.referenceCode) ? { referenceCode: entry.referenceCode } : {}) };
  });
  if (!token(response.previewToken)) throw new TypeError('批量邀请预检凭据无效。');
  return { contactRevision: expectedContactRevision, previewToken: response.previewToken, entries,...version,
    summary: { selected: entries.length, eligible: entries.filter(entry => entry.eligible).length, skipped: entries.filter(entry => !entry.eligible).length } };
}
function pngResult(entry, status, pngError = null, fileName = null) {
  return { ...entry, pngStatus: status, ...(pngError ? { pngError } : {}), ...(fileName ? { fileName } : {}) };
}
function safeRecord(result) {
  const invitation = result.invitation;
  return { contactId: result.contactId, status: result.status, code: code(result.code),
    registrationId: registrationId(invitation?.registrationId) ? invitation.registrationId : null,
    referenceCode: registrationId(invitation?.referenceCode) ? invitation.referenceCode : null,
    invitationId: id(invitation?.id) ? invitation.id : null,
    invitationStatus: typeof invitation?.status === 'string' && /^[a-z_]{1,40}$/u.test(invitation.status) ? invitation.status : null,
    recipientName: typeof invitation?.content?.settings?.recipientName === 'string' && invitation.content.settings.recipientName.length <= 320 ? invitation.content.settings.recipientName : null,
    renderVersion:invitation?.content?.settings?.renderVersion===INVITATION_POSTER_RENDER_VERSION?INVITATION_POSTER_RENDER_VERSION:null,
    pngStatus: result.pngStatus, pngError: result.pngError ?? null, fileName: result.fileName ?? null };
}
function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
const PNG_MAGIC = [137, 80, 78, 71, 13, 10, 26, 10];

/** Explicit manual preparation only. One HTTP request, sequential local PNGs; never sends, retries, downloads or persists. */
export async function prepareBatchInvitations({ contactIds, expectedContactRevision, previewToken, request, renderInvitation, onProgress = () => {},renderVersion } = {}) {
  const selected = selection(contactIds, expectedContactRevision, request);
  const version=renderChoice(renderVersion);
  if (!token(previewToken) || typeof renderInvitation !== 'function' || typeof onProgress !== 'function') throw new TypeError('请先完成预检并明确确认批量准备。');
  const response = await post(request, '/api/admin/contacts/invitations/prepare-batch', {
    contactIds: selected, expectedContactRevision, previewToken, confirmPrepare: true,...version,
  });
  const entries = entriesFor(response, selected, 'results', expectedContactRevision);
  const validStatuses = ['prepared', 'replayed', 'skipped', 'failed', 'unknown'];
  for (const entry of entries) {
    if (!validStatuses.includes(entry.status)) throw new TypeError('批量准备状态不明，请核对后台记录，勿自动重试。');
    if (['prepared', 'replayed'].includes(entry.status)) {
      const invitation = entry.invitation, settings = invitation?.content?.settings;
      if (invitation?.channel !== 'manual' || !['prepared', 'manually_sent'].includes(invitation.status)
        || !id(invitation.id) || !registrationId(invitation.registrationId) || !registrationId(invitation.referenceCode)
        || settings?.confirmed !== true || settings.renderVersion!==renderVersion || ['recipientName', 'date', 'time', 'venue'].some(field => typeof settings[field] !== 'string' || settings[field].length > 480) || !validateInvitationData(settings).valid) throw new TypeError('批量邀请内容无效，请核对后台记录。');
    }
  }
  const files = [], results = [];
  let archiveBytes = 22, archiveFull = false;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!['prepared', 'replayed'].includes(entry.status)) {
      results.push(pngResult(entry, 'skipped'));
      onProgress({ phase: 'rendering', completed: index + 1, total: entries.length, contactId: entry.contactId, status: 'skipped' });
      continue;
    }
    if (archiveFull) {
      results.push(pngResult(entry, 'failed', 'ZIP_SIZE_LIMIT'));
      onProgress({ phase: 'rendering', completed: index + 1, total: entries.length, contactId: entry.contactId, status: 'failed' });
      continue;
    }
    onProgress({ phase: 'rendering', completed: index, total: entries.length, contactId: entry.contactId, status: 'rendering' });
    let result;
    try {
      const png = await renderInvitation(entry.invitation);
      if (!(png instanceof Blob) || png.type !== 'image/png' || !Number.isSafeInteger(png.size) || png.size <= 0) throw new TypeError('Invalid PNG.');
      const fileName = privateInvitationFilename(entry.invitation.content.settings.recipientName, entry.contactId, index);
      const size = png.size > PRIVATE_INVITATION_ZIP_LIMIT ? Infinity : privateZipEntryBytes(fileName, png.size);
      if (archiveBytes + size > PRIVATE_INVITATION_ZIP_LIMIT - METADATA_RESERVE) {
        archiveFull = true;
        result = pngResult(entry, 'failed', 'ZIP_SIZE_LIMIT');
      } else {
        const magic = new Uint8Array(await png.slice(0, 8).arrayBuffer());
        if (magic.length !== 8 || PNG_MAGIC.some((byte, at) => magic[at] !== byte)) throw new TypeError('Invalid PNG.');
        files.push({ name: fileName, data: png }); archiveBytes += size;
        result = pngResult(entry, 'created', null, fileName);
      }
    } catch { result = pngResult(entry, 'failed', 'PNG_RENDER_FAILED'); }
    results.push(result);
    onProgress({ phase: 'rendering', completed: index + 1, total: entries.length, contactId: entry.contactId, status: result.pngStatus });
  }
  const records = results.map(safeRecord);
  const columns = ['contactId', 'recipientName', 'registrationId', 'referenceCode', 'invitationId', 'status', 'invitationStatus', 'renderVersion', 'pngStatus', 'pngError', 'fileName', 'actualDispatchChannel', 'actualDispatchedAt', 'actualDispatchRecordedBy'];
  const checklist = '\ufeff' + [columns.map(csvCell).join(','), ...records.map(record => columns.map(column => csvCell(record[column])).join(','))].join('\r\n') + '\r\n';
  const summary = { selected: entries.length, prepared: 0, replayed: 0, skipped: 0, failed: 0, unknown: 0,
    pngCreated: results.filter(result => result.pngStatus === 'created').length, pngFailed: results.filter(result => result.pngStatus === 'failed').length };
  for (const entry of entries) summary[entry.status]++;
  files.push({ name: 'dispatch-checklist-private.csv', data: new Blob([checklist], { type: 'text/csv;charset=utf-8' }) },
    { name: 'results-private.json', data: new Blob([JSON.stringify({ format: 'artdico-private-invitation-batch-v1', contactRevision: expectedContactRevision,
      batchPerformedSending: false, downloadMarksSent: false, notice: '仅准备图片；请逐人核对实际发送，并在后台另行记录。未知结果不得自动重送。私密文件请妥善保存。', summary, results: records }, null, 2)], { type: 'application/json' }) });
  const blob = await createPrivateInvitationZip(files);
  onProgress({ phase: 'complete', completed: entries.length, total: entries.length, status: 'prepared' });
  return { blob, fileName: 'ARTDiCO-private-invitations-r' + expectedContactRevision + (renderVersion===INVITATION_POSTER_RENDER_VERSION?'-poster-v2':'') + '.zip', summary: { ...summary, archiveBytes: blob.size }, results };
}
