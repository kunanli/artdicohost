// Coordinates follow the organizer-provided portrait card. The sample name
// and sample QR are never part of the template.
export const CARD_IMAGE = Object.freeze({ width: 1030, height: 1510 });

const faces = [
  'M3 2 H88 V157 H117 V2 H201 V397 H117 V241 H88 V397 H3 Z',
  'M288 103 C288 52 345 13 415 13 C485 13 545 54 547 102 V294 C547 347 492 387 418 387 C347 387 288 346 288 294 Z M399 95 V305 C399 323 436 323 436 305 V95 C436 76 399 76 399 95 Z',
  'M535 111 C535 62 577 19 642 19 C703 19 750 62 750 116 V150 H660 V110 C660 92 643 90 634 96 C625 101 624 110 631 119 L733 257 C746 275 752 292 750 313 C747 367 700 400 644 400 C584 400 540 364 536 316 V265 H628 V310 C628 326 646 328 655 319 C662 312 661 304 655 294 L553 153 C542 138 535 125 535 111 Z',
  'M782 2 H1024 V66 H936 V388 H874 V66 H782 Z',
];
const relief = [
  { path: 'M88 4 L117 54 V158 H88 Z', axis: [95, 0, 124, 160], stops: [[0, '#8244fa'], [1, '#6e9fe0']] },
  { path: 'M87 241 H118 V389 L88 397 Z', axis: [107, 244, 65, 389], stops: [[0, '#51bed2'], [.62, '#fae45e'], [1, '#ff6d17']] },
  { path: 'M225 156 L320 42 L402 19 L517 34 L545 80 L547 292 L419 385 L253 357 Z', axis: [269, 91, 297, 365], stops: [[0, '#ff7817'], [.7, '#ff7919'], [.89, '#fbe362'], [1, '#9de9cf']] },
  { path: 'M201 2 L259 246 V363 L201 397 Z', axis: [249, 182, 188, 392], stops: [[0, '#8145f9'], [.7, '#8fd6e5'], [1, '#ffe660']] },
  { path: 'M397 77 H438 V320 H397 Z', axis: [397, 80, 437, 320], stops: [[0, '#589ce4'], [1, '#5aa6e1']] },
  { path: 'M534 265 L668 254 L698 332 L636 369 Z', axis: [534, 265, 660, 330], stops: [[0, '#ffe666'], [.4, '#ffffa4'], [.65, '#51bed2'], [1, '#43a6ee']] },
  { path: 'M627 93 L717 35 L788 120 L857 185 L804 313 L708 382 L650 321 Z', axis: [687, 78, 630, 315], stops: [[0, '#8148f9'], [.32, '#688bf5'], [.44, '#56b6e5'], [.64, '#8050fa'], [1, '#8341fa']] },
  { path: 'M781 3 L1027 65 L936 118 L875 388 L796 314 V157 H749 Z', axis: [756, 83, 960, 208], stops: [[0, '#ff7b1a'], [.18, '#f9e957'], [.33, '#55bdd1'], [.67, '#55b9d0'], [1, '#8849f8']] },
];
const outlines = [
  [[0, '#ff801b'], [.25, '#ffffa9'], [.5, '#f9f5ff'], [1, '#8141fc']],
  [[0, '#8041fc'], [.53, '#f9f7ff'], [.75, '#ffffa3'], [1, '#ff8419']],
  [[0, '#ff8117'], [.29, '#fff1a4'], [.55, '#f9f5ff'], [1, '#8146fa']],
  [[0, '#ff881e'], [.22, '#fff39a'], [.51, '#f2e7ff'], [1, '#8141fc']],
];

function gradient(context, axis, stops) {
  const paint = context.createLinearGradient(...axis);
  for (const [position, color] of stops) paint.addColorStop(position, color);
  return paint;
}

function drawWordmark(context) {
  for (const { path, axis, stops } of relief) {
    context.fillStyle = gradient(context, axis, stops);
    context.fill(new Path2D(path));
  }
  const spans = [[2, 202], [288, 547], [535, 750], [781, 1025]];
  faces.forEach((path, index) => {
    const glyph = new Path2D(path);
    const [left, right] = spans[index];
    context.fillStyle = '#000';
    context.fill(glyph, 'evenodd');
    context.strokeStyle = gradient(context, [left, 380, right, 15], outlines[index]);
    context.lineWidth = 3.5;
    context.stroke(glyph);
  });
  context.fillStyle = '#fff';
  context.beginPath();
  context.ellipse(514, -20, 88, 63, 0, 0, Math.PI * 2);
  context.fill();
}

function line(context, text, x, y, size, { maxWidth = 900, align = 'left' } = {}) {
  context.fillStyle = '#fff';
  context.font = '400 ' + size + 'px system-ui, "PingFang SC", "Microsoft YaHei", sans-serif';
  context.textAlign = align;
  context.fillText(text, x, y, maxWidth);
}

export async function renderCommemorativeJpeg(view) {
  const canvas = document.createElement('canvas');
  canvas.width = CARD_IMAGE.width;
  canvas.height = CARD_IMAGE.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('此浏览器无法生成纪念卡图片。');
  const qr = view.card.entryQr ? new Image() : null;
  if (qr) {
    qr.src = 'data:image/png;base64,' + view.card.entryQr;
    await qr.decode();
  }
  context.fillStyle = '#121212';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawWordmark(context);
  line(context, '2026 Global Game Jam 中国组织者交流会', 65, 500, 47);
  line(context, '×  ARTDiCO HOST 学生嘉年华', 65, 560, 47);
  context.fillStyle = '#5b5b5b';
  context.fillRect(67, 597, 895, 1);
  context.fillRect(67, 781, 895, 1);
  line(context, '参会人', 64, 680, 38);
  line(context, view.attendee.name, 64, 735, 43, { maxWidth: 580 });
  line(context, '入场身份', 962, 680, 38, { align: 'right' });
  line(context, view.card.identity, 962, 735, 43, { maxWidth: 265, align: 'right' });
  line(context, '日期', 64, 852, 29);
  line(context, view.event.date.replaceAll('-', ' - '), 64, 894, 29);
  line(context, '时间', 64, 956, 29);
  line(context, view.event.time.replace(/\s*[–—-]\s*/u, ' - '), 64, 999, 29);
  line(context, '地点', 962, 852, 29, { align: 'right' });
  const venue = view.event.venue === '深圳市前海合作区梦海大道5188号前海5号楼' ? '深圳市南山区前海5号楼' : view.event.venue;
  line(context, venue, 962, 894, 29, { maxWidth: 540, align: 'right' });
  if (qr) {
    context.fillStyle = '#fff';
    context.beginPath();
    if (typeof context.roundRect === 'function') context.roundRect(324, 1087, 382, 382, 10);
    else context.rect(324, 1087, 382, 382);
    context.fill();
    context.imageSmoothingEnabled = false;
    context.drawImage(qr, 331, 1094, 368, 368);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      canvas.width = 0;
      canvas.height = 0;
      if (blob?.type === 'image/jpeg' && blob.size) resolve(blob);
      else reject(new Error('暂时无法生成 JPEG 纪念卡。'));
    }, 'image/jpeg', 0.97);
  });
}
