/** Client-side invitation rendering. It never sends an invitation or changes a contact record. */
export const INVITATION_SIZE = Object.freeze({ width: 1080, height: 1920 });
export const INVITATION_TEMPLATE_URL = '/invitations/template-blank.png';
export const INVITATION_FONT = '"Noto Sans CJK SC", "Microsoft YaHei", "PingFang SC", sans-serif';

const graphemes = (text) => typeof Intl.Segmenter === 'function'
  ? [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map((item) => item.segment)
  : Array.from(text);

function cleanText(value) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/gu, ' ').trim();
}

/** Normalizes editable text and requires an explicit boolean confirmation for final images. */
export function validateInvitationData(input = {}) {
  const value = {
    recipientName: cleanText(input.recipientName),
    date: cleanText(input.date),
    time: cleanText(input.time),
    venue: cleanText(input.venue),
    confirmed: input.confirmed === true,
  };
  const errors = {};
  for (const [key, limit] of [['recipientName', 80], ['date', 30], ['time', 40], ['venue', 120]]) {
    if (graphemes(value[key]).length > limit) errors[key] = '内容过长，请缩短后重试。';
  }
  if (!value.recipientName) errors.recipientName = '请填写邀请函称呼。';
  if (value.confirmed) {
    for (const key of ['date', 'time', 'venue']) {
      if (!value[key] || /暂定|待确认|待定/u.test(value[key])) errors[key] = '正式导出前请填写并确认完整活动信息。';
    }
  }
  return { valid: Object.keys(errors).length === 0, errors, value };
}

function setFont(context, size, weight, family) {
  context.font = weight + ' ' + size + 'px ' + family;
}

/** Fits a single line. Does not truncate or silently replace any person's name. */
export function fitText(context, text, {
  maxWidth, maxFontSize = 100, minFontSize = 24, weight = 500, fontFamily = INVITATION_FONT,
} = {}) {
  for (let size = maxFontSize; size >= minFontSize; size -= 1) {
    setFont(context, size, weight, fontFamily);
    if (context.measureText(text).width <= maxWidth) return size;
  }
  return minFontSize;
}

/** Wraps at grapheme boundaries, including long Latin words and mixed Chinese text. */
export function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const character of graphemes(text)) {
    if (line && context.measureText(line + character).width > maxWidth) {
      lines.push(line.trimEnd());
      line = character.trimStart();
    } else line += character;
  }
  if (line || !lines.length) lines.push(line.trimEnd());
  return lines;
}

/** Returns a complete, bounded layout; throws instead of clipping oversized content. */
export function fitTextBlock(context, text, {
  maxWidth, maxHeight, maxFontSize, minFontSize = 24, lineHeight = 1.1,
  weight = 500, fontFamily = INVITATION_FONT,
}) {
  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 1) {
    setFont(context, fontSize, weight, fontFamily);
    const lines = wrapText(context, text, maxWidth);
    const height = lines.length * fontSize * lineHeight;
    if (height <= maxHeight && lines.every((line) => context.measureText(line).width <= maxWidth)) {
      return { lines, fontSize, lineHeight: fontSize * lineHeight, height };
    }
  }
  throw new RangeError('文字无法完整放入邀请函，请缩短称呼或地点。');
}

export function invitationFilename(recipientName, confirmed = false) {
  const safeName = cleanText(recipientName).replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/gu, '_').slice(0, 60) || '未命名';
  return 'GGJ邀请函-' + safeName + '-' + (confirmed === true ? '已确认' : '暂定') + '.png';
}

async function loadTemplate(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('邀请函模板加载失败，请检查模板文件。'));
    image.src = url;
  });
}

function drawBlock(context, text, { x, y, width, height, maxFontSize, minFontSize = 24, align = 'left', weight = 500 }) {
  const layout = fitTextBlock(context, text, {
    maxWidth: width, maxHeight: height, maxFontSize, minFontSize, weight,
  });
  setFont(context, layout.fontSize, weight, INVITATION_FONT);
  context.textAlign = align;
  context.textBaseline = 'top';
  layout.lines.forEach((line, index) => context.fillText(line, x, y + index * layout.lineHeight));
  return layout;
}

/**
 * Draws a 1080 × 1920 invitation into a supplied canvas and returns export metadata.
 * Generating/downloading an image is separate from sending it; deliveryStatus is always not_sent.
 * Third argument is an injectable image loader for deterministic tests and local browser QA.
 */
export async function renderInvitation(canvas, input, { loadImage = loadTemplate } = {}) {
  const result = validateInvitationData(input);
  if (!result.valid) throw Object.assign(new Error(Object.values(result.errors)[0]), { errors: result.errors });
  if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('需要有效的画布。');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器无法生成邀请函。');
  const data = result.value;
  const image = await loadImage(input.templateUrl || INVITATION_TEMPLATE_URL);
  if (typeof document !== 'undefined' && document.fonts?.ready) await document.fonts.ready;
  canvas.width = INVITATION_SIZE.width;
  canvas.height = INVITATION_SIZE.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffffff';
  const layouts = {
    recipientName: drawBlock(context, data.recipientName, {
      x: 90, y: 735, width: 900, height: 102, maxFontSize: 100, minFontSize: 28, weight: 500,
    }),
    date: drawBlock(context, data.date || '日期待确认', {
      x: 90, y: 1135, width: 425, height: 44, maxFontSize: 40, minFontSize: 24,
    }),
    time: drawBlock(context, data.time || '时间待确认', {
      x: 90, y: 1184, width: 425, height: 44, maxFontSize: 40, minFontSize: 24,
    }),
    venue: drawBlock(context, data.venue || '地点待确认', {
      x: 990, y: 1135, width: 465, height: 95, maxFontSize: 40, minFontSize: 22, align: 'right', weight: 600,
    }),
  };
  if (!data.confirmed) {
    context.save();
    context.fillStyle = 'rgba(11, 8, 20, .9)';
    context.fillRect(90, 1250, 900, 58);
    context.fillStyle = '#ffffff';
    setFont(context, 30, 700, INVITATION_FONT);
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText('暂定 · 信息待确认', 540, 1279);
    context.translate(540, 1450);
    context.rotate(-0.22);
    context.fillStyle = 'rgba(255, 255, 255, .25)';
    setFont(context, 108, 700, INVITATION_FONT);
    context.fillText('暂定', 0, 0);
    context.restore();
  }
  return {
    ...INVITATION_SIZE,
    mimeType: 'image/png',
    filename: invitationFilename(data.recipientName, data.confirmed),
    confirmed: data.confirmed,
    deliveryStatus: 'not_sent',
    layouts,
  };
}

/** PNG bytes stay in the browser until staff explicitly downloads the result. */
export function invitationPngBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('PNG 导出失败，请重试。')),
    'image/png',
  ));
}
