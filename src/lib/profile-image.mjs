export const MAX_ORIGINAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
export const MAX_PROCESSED_IMAGE_BYTES = 512 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const invalid = () => new Error('无法读取图片，请选择有效的静态 JPEG、PNG 或 WebP。');

/** Read pixel bounds before asking the browser to allocate a decoded bitmap. */
export function profileImageDimensions(bytes, contentType) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 || !TYPES.includes(contentType)) throw invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  let width, height;
  if (contentType === 'image/png') {
    if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((value,index) => bytes[index] === value)
      || view.getUint32(8) !== 13 || ascii(12,4) !== 'IHDR') throw invalid();
    width = view.getUint32(16); height = view.getUint32(20);
    for (let offset=8;offset+12<=bytes.length;) {
      const length=view.getUint32(offset),end=offset+length+12;
      if(end>bytes.length)throw invalid();
      if(['acTL','fcTL','fdAT'].includes(ascii(offset+4,4)))throw new Error('请选择静态图片，不支持动画 PNG。');
      offset=end;
    }
  } else if (contentType === 'image/jpeg') {
    if (bytes[0] !== 255 || bytes[1] !== 216) throw invalid();
    let offset = 2, segments = 0;
    while (offset + 4 <= bytes.length && ++segments <= 4096) {
      if (bytes[offset++] !== 255) throw invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (offset + 2 > bytes.length) throw invalid();
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) throw invalid();
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (length < 8 || width !== undefined) throw invalid();
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5);
      }
      offset += length;
    }
  } else {
    if (ascii(0,4) !== 'RIFF' || ascii(8,4) !== 'WEBP' || view.getUint32(4,true) + 8 !== bytes.length) throw invalid();
    let offset = 12;
    while (offset + 8 <= bytes.length) {
      const type = ascii(offset,4), length = view.getUint32(offset+4,true), body = offset+8;
      if (body + length > bytes.length) throw invalid();
      if (type === 'ANIM' || type === 'ANMF') throw new Error('请选择静态图片，不支持动画 WebP。');
      if (type === 'VP8X') {
        if (length !== 10 || bytes[body] & 2) throw new Error('请选择静态图片，不支持动画 WebP。');
        width = 1 + bytes[body+4] + (bytes[body+5] << 8) + (bytes[body+6] << 16);
        height = 1 + bytes[body+7] + (bytes[body+8] << 8) + (bytes[body+9] << 16);
      } else if (type === 'VP8 ') {
        if (length < 10 || ascii(body+3,3) !== '\u009d\u0001\u002a') throw invalid();
        const actualWidth=view.getUint16(body+6,true)&16383,actualHeight=view.getUint16(body+8,true)&16383;
        if(width!==undefined&&(width!==actualWidth||height!==actualHeight))throw invalid();
        width=actualWidth;height=actualHeight;
      } else if (type === 'VP8L') {
        if (length < 5 || bytes[body] !== 47) throw invalid();
        const bits = view.getUint32(body+1,true);
        const actualWidth=(bits&16383)+1,actualHeight=(bits>>>14&16383)+1;
        if(width!==undefined&&(width!==actualWidth||height!==actualHeight))throw invalid();
        width=actualWidth;height=actualHeight;
      }
      offset = body + length + (length % 2);
    }
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) throw invalid();
  if (width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS) throw new Error('图片像素超过安全处理范围，请先缩小至四千万像素以内。');
  return {width,height};
}

function ensureActive(signal) { if (signal?.aborted) throw new DOMException('Image processing aborted.', 'AbortError'); }
function encode(canvas, contentType, quality) { return new Promise(resolve => canvas.toBlob(resolve,contentType,quality)); }
function hasTransparency(context, width, height) {
  const pixels = context.getImageData(0,0,width,height).data;
  for (let offset = 3; offset < pixels.length; offset += 4) if (pixels[offset] < 255) return true;
  return false;
}

/** Local-only decode/orientation/resize/re-encode. Transparency is opt-in; opaque images stay JPEG. */
export async function prepareProfileImage(file, { maxEdge = 800, signal, preserveTransparency = false } = {}) {
  if (!file || !TYPES.includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 图片。');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_ORIGINAL_IMAGE_BYTES) throw new Error('请选择不超过 12 MiB 的图片。');
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 64 || maxEdge > 1600) throw new TypeError('Invalid image size.');
  if (typeof preserveTransparency !== 'boolean') throw new TypeError('Invalid image transparency option.');
  ensureActive(signal);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength !== file.size) throw invalid();
  profileImageDimensions(bytes,file.type);
  ensureActive(signal);
  let source, objectUrl;
  try {
    if (typeof createImageBitmap === 'function') source = await createImageBitmap(file,{imageOrientation:'from-image'});
    else {
      objectUrl = URL.createObjectURL(file); source = new Image(); source.src = objectUrl; await source.decode();
    }
    ensureActive(signal);
    const width = source.width || source.naturalWidth, height = source.height || source.naturalHeight;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > MAX_IMAGE_PIXELS) throw invalid();
    const canvas = document.createElement('canvas');
    let blob, quality, transparent = false, contentType = 'image/jpeg';
    for (let sizeAttempt = 0; sizeAttempt < (transparent ? 8 : 3) && !blob; sizeAttempt++) {
      const scale = Math.min(1,maxEdge * .8 ** sizeAttempt / Math.max(width,height));
      canvas.width = Math.max(1,Math.round(width * scale)); canvas.height = Math.max(1,Math.round(height * scale));
      const context = canvas.getContext('2d',{alpha:preserveTransparency,willReadFrequently:preserveTransparency});
      if (!context) throw new Error('当前浏览器无法处理图片，请更换浏览器。');
      if (!preserveTransparency) { context.fillStyle = '#fff'; context.fillRect(0,0,canvas.width,canvas.height); }
      context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
      context.drawImage(source,0,0,canvas.width,canvas.height);
      if (preserveTransparency && !transparent) transparent = hasTransparency(context,canvas.width,canvas.height);
      if (transparent) {
        contentType = 'image/png'; quality = null;
        ensureActive(signal);
        const candidate = await encode(canvas,contentType);
        if (candidate?.type === contentType && candidate.size > 0 && candidate.size <= MAX_PROCESSED_IMAGE_BYTES) blob = candidate;
        continue;
      }
      for (quality of [.88,.8,.7,.6]) {
        ensureActive(signal);
        const candidate = await encode(canvas,contentType,quality);
        if (candidate?.type === contentType && candidate.size > 0 && candidate.size <= MAX_PROCESSED_IMAGE_BYTES) { blob = candidate; break; }
      }
    }
    if (!blob) throw new Error('图片处理后仍超过 512 KiB，请选择较小的原图。');
    ensureActive(signal);
    const processed = new Uint8Array(await blob.arrayBuffer()); let binary = '';
    ensureActive(signal);
    for (let offset = 0; offset < processed.length; offset += 32768) binary += String.fromCharCode(...processed.subarray(offset,offset+32768));
    return { payload:{contentType,dataBase64:btoa(binary)},
      source:{width,height,bytes:file.size}, processed:{width:canvas.width,height:canvas.height,bytes:blob.size,quality,transparencyPreserved:transparent} };
  } catch (error) {
    if (error?.name === 'AbortError' || error instanceof Error && /^(?:请选择|图片|当前浏览器)/u.test(error.message)) throw error;
    throw invalid();
  } finally { source?.close?.(); if (objectUrl) URL.revokeObjectURL(objectUrl); }
}

export function processedImageSummary(image) {
  return '原图 ' + image.source.width + ' × ' + image.source.height + ' → ' + image.processed.width + ' × ' + image.processed.height
    + '，' + Math.ceil(image.processed.bytes / 1024) + ' KiB；已校正方向并移除照片元数据。'
    + (image.processed.transparencyPreserved ? ' 透明背景已保留。' : '');
}
