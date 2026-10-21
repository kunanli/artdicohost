import { MAX_ORIGINAL_IMAGE_BYTES, profileImageDimensions } from './profile-image.mjs';
import { imagePlacement, originalAlpha, removeEdgeBackground, paintAlphaStroke } from './image-editing.mjs';
import '../styles/image-editor.css';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const PROCESS_EDGE = 1200, OUTPUT_EDGE = 800;
let editorSequence = 0;
const aborted = () => new DOMException('Image editing aborted.', 'AbortError');
const active = signal => { if (signal?.aborted) throw aborted(); };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, hook) {
  const node = element('button', text); node.type = 'button'; node.setAttribute('data-image-editor-' + hook, ''); return node;
}
function abortable(promise, signal, disposeLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => { if (!settled) { settled = true; reject(aborted()); } };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    Promise.resolve(promise).then(value => {
      signal?.removeEventListener('abort', abort);
      if (settled) { disposeLate(value); return; }
      settled = true; resolve(value);
    }, error => { signal?.removeEventListener('abort', abort); if (!settled) { settled = true; reject(error); } });
  });
}

/** No network or record access. Only explicit Apply returns new pixels to the caller. */
export async function editStaffImage(file, { root, kind = 'guest', signal } = {}) {
  active(signal);
  if (!root || root.ownerDocument !== document || !['guest', 'organization'].includes(kind)) throw new TypeError('Invalid image editor host.');
  if (!file || !TYPES.includes(file.type) || typeof file.arrayBuffer !== 'function') throw new Error('请选择 JPEG、PNG 或 WebP 图片。');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ORIGINAL_IMAGE_BYTES) throw new Error('请选择不超过 12 MiB 的图片。');
  if (root.querySelector('[data-image-editor]')) throw new Error('请先应用或取消当前图片编辑。');
  const previousFocus = document.activeElement;
  const bytes = new Uint8Array(await abortable(file.arrayBuffer(), signal));
  if (bytes.length !== file.size) throw new Error('无法读取完整图片，请重新选择。');
  profileImageDimensions(bytes, file.type); active(signal);
  let decoded, objectUrl;
  const source = document.createElement('canvas');
  try {
    if (typeof createImageBitmap === 'function') decoded = await abortable(createImageBitmap(file, { imageOrientation: 'from-image' }), signal, value => value.close());
    else {
      objectUrl = URL.createObjectURL(file); decoded = new Image(); decoded.src = objectUrl;
      await abortable(decoded.decode(), signal);
    }
    active(signal);
    const width = decoded.width || decoded.naturalWidth, height = decoded.height || decoded.naturalHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 40_000_000) throw new Error('图片像素超过安全处理范围。');
    const scale = Math.min(1, PROCESS_EDGE / Math.max(width, height));
    source.width = Math.max(1, Math.round(width * scale)); source.height = Math.max(1, Math.round(height * scale));
    const context = source.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器无法编辑图片，请更换浏览器。');
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(decoded, 0, 0, source.width, source.height);
  } catch (error) {
    source.width = source.height = 1;
    if (error?.name === 'AbortError' || error instanceof Error && /^(?:请选择|图片|当前浏览器)/u.test(error.message)) throw error;
    throw new Error('无法读取图片，请选择有效的静态 JPEG、PNG 或 WebP。');
  } finally { decoded?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl); }

  return new Promise((resolve, reject) => {
    const events = new AbortController();
    const listen = (node, name, callback) => node.addEventListener(name, callback, { signal: events.signal });
    const width = source.width, height = source.height, sourceContext = source.getContext('2d', { willReadFrequently: true });
    const pixels = sourceContext.getImageData(0, 0, width, height), alpha = originalAlpha(pixels.data, width, height);
    let mask = new Uint8ClampedArray(alpha), maskDirty = true, ratio = kind === 'guest' ? 'square' : 'original';
    let zoom = 1, offsetX = 0, offsetY = 0, finished = false, busy = false, pointer = null, frame = 0;
    const undo = [], masked = document.createElement('canvas'); masked.width = width; masked.height = height;
    const maskedContext = masked.getContext('2d'), working = new ImageData(new Uint8ClampedArray(pixels.data), width, height);
    const sample = [pixels.data[0], pixels.data[1], pixels.data[2]];
    const panel = element('section', undefined, 'ah-image-editor'); panel.setAttribute('data-image-editor', '');
    const headingId = 'staff-image-editor-title-' + ++editorSequence;
    panel.setAttribute('aria-labelledby', headingId);
    const header = element('div', undefined, 'ah-image-editor-header'), headingGroup = element('div');
    const heading = element('h3', '编辑' + (kind === 'guest' ? '嘉宾照片' : '组织图片')); heading.id = headingId; heading.tabIndex = -1;
    headingGroup.append(heading, element('p', '缩放后拖动图片，调整要保留的范围。')); header.append(headingGroup);
    const stage = element('div', undefined, 'ah-image-editor-stage'), canvas = element('canvas');
    canvas.setAttribute('data-image-editor-canvas', ''); canvas.setAttribute('aria-label', '图片编辑画布。可拖动图片；方向键或下方按钮调整位置。'); canvas.tabIndex = 0;
    stage.append(canvas);
    const controls = element('div', undefined, 'ah-image-editor-controls');
    function choice(label, hook, entries, selected) {
      const wrap = element('label', label, 'ah-image-editor-field'), select = element('select'); select.setAttribute('data-image-editor-' + hook, '');
      for (const [value, text] of entries) { const option = element('option', text); option.value = value; select.append(option); }
      select.value = selected; wrap.append(select); controls.append(wrap); return select;
    }
    function range(label, hook, min, max, step, value, suffix) {
      const wrap = element('label', label, 'ah-image-editor-field'), input = element('input'), output = element('output');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value); input.setAttribute('data-image-editor-' + hook, '');
      const update = () => { output.value = Math.round(Number(input.value) * (hook === 'zoom' ? 100 : 1)) + suffix; };
      listen(input, 'input', update); update(); wrap.append(input, output); controls.append(wrap); return input;
    }
    const ratioControl = choice('裁切比例', 'ratio', [['original', '原图比例'], ['square', '方形 1:1']], ratio);
    const tool = choice('编辑工具', 'tool', [['move', '拖动位置'], ['sample', '取背景色'], ['erase', '擦除画笔'], ['restore', '还原画笔']], 'move');
    const zoomControl = range('图片缩放', 'zoom', .25, 6, .01, 1, '%');
    const tolerance = range('背景颜色容差', 'tolerance', 0, 150, 1, 28, '');
    const brush = range('画笔直径', 'brush', 4, 120, 1, 36, ' px');
    const sampleLabel = element('p', undefined, 'ah-image-editor-note'), swatch = element('span', undefined, 'ah-image-editor-sample'), sampleText = element('span');
    sampleLabel.append(swatch, sampleText);
    const move = element('div', undefined, 'ah-image-editor-move'); move.setAttribute('role', 'group'); move.setAttribute('aria-label', '调整图片位置');
    const moveButtons = [];
    for (const [direction, label, arrow] of [['left', '图片向左移动', '←'], ['right', '图片向右移动', '→'], ['up', '图片向上移动', '↑'], ['down', '图片向下移动', '↓']]) {
      const node = button(arrow, 'move'); node.setAttribute('data-image-editor-move', direction); node.setAttribute('aria-label', label); moveButtons.push(node); move.append(node);
    }
    const tools = element('div', undefined, 'ah-image-editor-tools');
    const background = button('去除边缘单色背景', 'remove-background'), reset = button('重置位置', 'reset'), fit = button('完整显示', 'fit');
    const undoButton = button('撤销去背／画笔', 'undo'), resetMask = button('还原原图背景', 'reset-mask'); tools.append(background, undoButton, resetMask, reset, fit);
    const note = element('p', '先选「取背景色」再点击图片，可更换背景颜色；去背只处理与图片边缘相连的近似颜色。复杂背景可用擦除／还原画笔。棋盘表示透明，不会加入图片。', 'ah-image-editor-note');
    const status = element('p', '图片仅在当前浏览器编辑，应用后才上传。', 'ah-image-editor-status'); status.setAttribute('data-image-editor-status', ''); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const error = element('p', undefined, 'ah-image-editor-status ah-image-editor-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    const actions = element('div', undefined, 'ah-image-editor-actions'), cancel = button('取消图片编辑', 'cancel'), apply = button('应用图片并上传', 'apply'); apply.className = 'ah-image-editor-apply'; actions.append(cancel, apply);
    panel.append(header, stage, controls, move, sampleLabel, tools, note, status, error, actions); root.hidden = false; root.append(panel);

    function message(text) { status.textContent = text; error.hidden = true; error.textContent = ''; }
    function updateControls() {
      for (const control of panel.querySelectorAll('button,input,select')) control.disabled = busy;
      cancel.disabled = false; undoButton.disabled = busy || undo.length === 0;
      brush.closest('label').hidden = !['erase', 'restore'].includes(tool.value);
      tolerance.closest('label').hidden = false; canvas.dataset.tool = tool.value;
      swatch.style.backgroundColor = 'rgb(' + sample.join(',') + ')'; sampleText.textContent = '背景取色：RGB ' + sample.join(' / ');
      panel.setAttribute('aria-busy', String(busy));
    }
    function placement() { return imagePlacement(width, height, canvas.width, canvas.height, zoom, offsetX, offsetY); }
    function render() {
      if (frame) cancelAnimationFrame(frame); frame = 0; if (finished) return;
      if (maskDirty) { for (let index = 0; index < mask.length; index++) working.data[index * 4 + 3] = mask[index]; maskedContext.putImageData(working, 0, 0); maskDirty = false; }
      const outputScale = Math.min(1, OUTPUT_EDGE / Math.max(width, height));
      const side = Math.min(OUTPUT_EDGE, Math.min(width, height));
      const frameWidth = ratio === 'square' ? side : Math.max(1, Math.round(width * outputScale));
      const frameHeight = ratio === 'square' ? side : Math.max(1, Math.round(height * outputScale));
      if (canvas.width !== frameWidth || canvas.height !== frameHeight) { canvas.width = frameWidth; canvas.height = frameHeight; }
      stage.style.maxWidth = Math.min(420, 420 * frameWidth / frameHeight) + 'px';
      const transform = placement(); offsetX = transform.offsetX; offsetY = transform.offsetY;
      const context = canvas.getContext('2d'); context.clearRect(0, 0, frameWidth, frameHeight);
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high'; context.drawImage(masked, transform.x, transform.y, transform.width, transform.height);
      updateControls();
    }
    function schedule() { if (!frame && !finished) frame = requestAnimationFrame(render); }
    function snapshot() { undo.push(new Uint8ClampedArray(mask)); if (undo.length > 6) undo.shift(); updateControls(); }
    function outputPoint(event) { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height }; }
    function sourcePoint(point) { const transform = placement(); return { x: (point.x - transform.x) / transform.scale, y: (point.y - transform.y) / transform.scale }; }
    function paint(from, to) { const radius = clamp(Number(brush.value) / 2 / placement().scale, .5, 512); paintAlphaStroke(mask, alpha, width, height, from, to, radius, tool.value === 'restore'); maskDirty = true; schedule(); }
    function releasePointer() { if (pointer) { try { canvas.releasePointerCapture(pointer.id); } catch {} pointer = null; } }
    function cleanup() {
      const restoreFocus = panel.parentNode === root && panel.contains(document.activeElement);
      releasePointer(); if (frame) cancelAnimationFrame(frame); events.abort();
      signal?.removeEventListener('abort', onAbort); panel.remove();
      if (!root.querySelector('[data-image-editor]')) root.hidden = true;
      source.width = source.height = masked.width = masked.height = canvas.width = canvas.height = 1;
      mask.fill(0); alpha.fill(0); pixels.data.fill(0); working.data.fill(0); for (const item of undo) item.fill(0); undo.length = 0;
      if (restoreFocus && !root.querySelector('[data-image-editor]') && previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
    }
    function finish(result, reason) { if (finished) return; finished = true; cleanup(); if (reason) reject(reason); else resolve(result); }
    function onAbort() { finish(null, aborted()); }
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    listen(cancel, 'click', () => finish(null));
    listen(panel, 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(null); } });
    listen(ratioControl, 'change', () => { ratio = ratioControl.value; zoom = 1; offsetX = offsetY = 0; zoomControl.value = '1'; zoomControl.dispatchEvent(new Event('input')); render(); });
    listen(tool, 'change', () => { releasePointer(); updateControls(); message(tool.value === 'sample' ? '点击图片中的背景颜色，再按「去除边缘单色背景」。' : tool.value === 'move' ? '拖动图片或使用方向键调整位置。' : '在图片上拖动画笔；可撤销或切换还原画笔。'); });
    listen(zoomControl, 'input', () => { zoom = Number(zoomControl.value); render(); });
    listen(reset, 'click', () => { zoom = 1; offsetX = offsetY = 0; zoomControl.value = '1'; zoomControl.dispatchEvent(new Event('input')); message('已重置位置，去背与画笔结果保留。'); });
    listen(fit, 'click', () => { zoom = clamp(Math.min(canvas.width / width, canvas.height / height) / Math.max(canvas.width / width, canvas.height / height), .25, 6); offsetX = offsetY = 0; zoomControl.value = String(zoom); zoomControl.dispatchEvent(new Event('input')); message('已居中显示完整图片；透明区域不会加上灰底。'); });
    listen(undoButton, 'click', () => { const previous = undo.pop(); if (!previous) return; mask.set(previous); previous.fill(0); maskDirty = true; render(); message('已撤销上一次去背或画笔。'); });
    listen(resetMask, 'click', () => { snapshot(); mask.set(alpha); maskDirty = true; render(); message('已还原原图的颜色与透明背景。'); });
    listen(background, 'click', async () => {
      if (busy) return; busy = true; releasePointer(); updateControls(); message('正在当前浏览器去除边缘单色背景…');
      await new Promise(done => requestAnimationFrame(done)); if (finished) return;
      try { active(signal); const result = removeEdgeBackground(pixels.data, width, height, mask, sample, Number(tolerance.value)); snapshot(); mask = result.mask; maskDirty = true; message(result.removed ? '已去除背景；请检查边缘，必要时用还原画笔修整。' : '未找到相连的同色边缘；可重新取色、调容差或使用擦除画笔。'); }
      catch (reason) { if (reason?.name === 'AbortError') { finish(null, reason); return; } error.textContent = '背景暂未处理，请重试。'; error.hidden = false; }
      finally { if (!finished) { busy = false; render(); } }
    });
    function moveBy(direction, distance = 12) { if (busy || finished) return; if (direction === 'left') offsetX -= distance; if (direction === 'right') offsetX += distance; if (direction === 'up') offsetY -= distance; if (direction === 'down') offsetY += distance; render(); }
    for (const node of moveButtons) listen(node, 'click', () => moveBy(node.getAttribute('data-image-editor-move')));
    listen(canvas, 'keydown', event => { const direction = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[event.key]; if (direction) { event.preventDefault(); moveBy(direction, event.shiftKey ? 36 : 6); } });
    listen(canvas, 'pointerdown', event => {
      if (busy || pointer || event.button !== 0) return; event.preventDefault(); canvas.focus({ preventScroll: true }); const point = outputPoint(event), original = sourcePoint(point);
      if (tool.value === 'sample') { const x = Math.floor(original.x), y = Math.floor(original.y); if (x < 0 || y < 0 || x >= width || y >= height) { message('请在原图片范围内取背景色。'); return; } const index = (y * width + x) * 4; sample.splice(0, 3, pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]); updateControls(); message('已取色。按「去除边缘单色背景」应用，可调节颜色容差。'); return; }
      pointer = { id: event.pointerId, x: point.x, y: point.y, offsetX, offsetY, source: original };
      try { canvas.setPointerCapture(event.pointerId); } catch {}
      if (tool.value !== 'move') { snapshot(); paint(original, original); }
    });
    listen(canvas, 'pointermove', event => { if (!pointer || pointer.id !== event.pointerId || busy) return; event.preventDefault(); const point = outputPoint(event); if (tool.value === 'move') { offsetX = pointer.offsetX + point.x - pointer.x; offsetY = pointer.offsetY + point.y - pointer.y; schedule(); } else { const original = sourcePoint(point); paint(pointer.source, original); pointer.source = original; } });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, name, event => { if (pointer?.id === event.pointerId) { releasePointer(); schedule(); } });
    listen(apply, 'click', async () => {
      if (busy) return; busy = true; releasePointer(); render(); updateControls(); message('正在生成图片…');
      try { const blob = await abortable(new Promise(done => canvas.toBlob(done, 'image/png')), signal); active(signal); if (finished) return; if (!blob || blob.type !== 'image/png' || !blob.size) throw new Error(); finish(new File([blob], 'edited-' + kind + '.png', { type: 'image/png', lastModified: 0 })); }
      catch (reason) { if (finished) return; if (reason?.name === 'AbortError') { finish(null, reason); return; } busy = false; updateControls(); error.textContent = '图片尚未生成，请重新应用。'; error.hidden = false; }
    });
    render(); queueMicrotask(() => { if (!finished) { heading.focus({ preventScroll: true }); panel.scrollIntoView({ block: 'nearest', behavior: 'instant' }); } });
  });
}
