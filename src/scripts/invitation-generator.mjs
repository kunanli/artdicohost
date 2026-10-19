import { renderInvitation, invitationPngBlob } from '../lib/invitation-renderer.mjs';

const form = document.querySelector('[data-generator-form]');
const canvas = document.querySelector('[data-generator-canvas]');
const image = document.querySelector('[data-generator-image]');
const empty = document.querySelector('[data-generator-empty]');
const status = document.querySelector('[data-generator-status]');
const download = document.querySelector('[data-generator-download]');
let previewUrl = null;
let filename = '';
let revision = 0;
let busy = false;

function invalidate() {
  revision++;
  download.disabled = true;
  image.hidden = true;
  image.removeAttribute('src');
  empty.hidden = false;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
form?.addEventListener('input', () => {
  invalidate();
  status.textContent = '内容已更改，请重新生成预览。';
});
form?.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !form.reportValidity()) return;
  invalidate();
  const generation = revision;
  busy = true;
  status.textContent = '正在生成图片…';
  try {
    const data = Object.fromEntries(new FormData(form));
    // Public preview always retains the tentative watermark. Formal output belongs to staff tooling.
    data.confirmed = false;
    const result = await renderInvitation(canvas, data);
    const blob = await invitationPngBlob(canvas);
    if (revision !== generation) return;
    previewUrl = URL.createObjectURL(blob);
    filename = result.filename;
    image.src = previewUrl;
    image.hidden = false;
    empty.hidden = true;
    download.disabled = false;
    status.textContent = (result.confirmed ? '已生成经你确认的图片。' : '已生成带暂定标记的图片。') + ' 尚未发送邀请。可保存 PNG，或长按预览图保存。';
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '生成失败，请重试。';
  } finally {
    busy = false;
  }
});
download?.addEventListener('click', () => {
  if (!previewUrl || download.disabled) return;
  const anchor = document.createElement('a');
  anchor.href = previewUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  status.textContent = '已请求保存图片；若浏览器未下载，请长按或右键保存预览图。尚未发送邀请。';
});
window.addEventListener('pagehide', invalidate);
