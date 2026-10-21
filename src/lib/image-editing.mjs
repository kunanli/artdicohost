const number = value => typeof value === 'number' && Number.isFinite(value);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
function dimensions(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || width * height > 2_560_000) throw new RangeError('Invalid editing image size.');
}
function maskSize(mask, width, height) {
  dimensions(width, height);
  if (!(mask instanceof Uint8ClampedArray) || mask.length !== width * height) throw new TypeError('Invalid editing mask.');
}

/** Geometry is in output pixels. Panning never loses an image beyond its frame. */
export function imagePlacement(width, height, frameWidth, frameHeight, zoom = 1, offsetX = 0, offsetY = 0) {
  dimensions(width, height); dimensions(frameWidth, frameHeight);
  if (![zoom, offsetX, offsetY].every(number) || zoom < .25 || zoom > 6) throw new RangeError('Invalid editing transform.');
  const scale = Math.max(frameWidth / width, frameHeight / height) * zoom;
  const drawnWidth = width * scale, drawnHeight = height * scale;
  const panX = clamp(offsetX, -Math.max(0, (drawnWidth - frameWidth) / 2), Math.max(0, (drawnWidth - frameWidth) / 2));
  const panY = clamp(offsetY, -Math.max(0, (drawnHeight - frameHeight) / 2), Math.max(0, (drawnHeight - frameHeight) / 2));
  return { x: (frameWidth - drawnWidth) / 2 + panX, y: (frameHeight - drawnHeight) / 2 + panY,
    width: drawnWidth, height: drawnHeight, scale, offsetX: panX, offsetY: panY };
}

export function originalAlpha(data, width, height) {
  dimensions(width, height);
  if (!(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) throw new TypeError('Invalid editing pixels.');
  const result = new Uint8ClampedArray(width * height);
  for (let index = 0; index < result.length; index++) result[index] = data[index * 4 + 3];
  return result;
}

/** Only matching pixels connected to an image edge are removed; enclosed details survive. */
export function removeEdgeBackground(data, width, height, mask, color, tolerance = 28) {
  maskSize(mask, width, height);
  if (!(data instanceof Uint8ClampedArray) || data.length !== mask.length * 4
    || !Array.isArray(color) || color.length !== 3 || !color.every(value => number(value) && value >= 0 && value <= 255)
    || !number(tolerance) || tolerance < 0 || tolerance > 150) throw new TypeError('Invalid background sample.');
  const result = new Uint8ClampedArray(mask), seen = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  const threshold = tolerance * tolerance * 3;
  let head = 0, tail = 0, removed = 0;
  function visit(index) {
    if (seen[index]) return;
    seen[index] = 1;
    const offset = index * 4;
    const distance = (data[offset] - color[0]) ** 2 + (data[offset + 1] - color[1]) ** 2 + (data[offset + 2] - color[2]) ** 2;
    if (data[offset + 3] === 0 || distance <= threshold) {
      if (result[index]) removed++;
      result[index] = 0; queue[tail++] = index;
    }
  }
  for (let x = 0; x < width; x++) { visit(x); visit((height - 1) * width + x); }
  for (let y = 1; y + 1 < height; y++) { visit(y * width); visit(y * width + width - 1); }
  while (head < tail) {
    const index = queue[head++], x = index % width;
    if (x) visit(index - 1);
    if (x + 1 < width) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index + width < mask.length) visit(index + width);
  }
  return { mask: result, removed };
}

/** Paint a continuous soft stroke. Restoration is bounded by the original alpha. */
export function paintAlphaStroke(mask, alpha, width, height, from, to, radius, restore = false) {
  maskSize(mask, width, height); maskSize(alpha, width, height);
  if (![from?.x, from?.y, to?.x, to?.y, radius].every(number) || radius < .5 || radius > 512) throw new RangeError('Invalid editing brush.');
  const start = { x: clamp(from.x, -radius, width + radius), y: clamp(from.y, -radius, height + radius) };
  const end = { x: clamp(to.x, -radius, width + radius), y: clamp(to.y, -radius, height + radius) };
  const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.y - start.y) / Math.max(1, radius / 3)));
  for (let step = 0; step <= steps; step++) {
    const x = start.x + (end.x - start.x) * step / steps, y = start.y + (end.y - start.y) * step / steps;
    const left = Math.max(0, Math.floor(x - radius)), right = Math.min(width - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(y - radius)), bottom = Math.min(height - 1, Math.ceil(y + radius));
    for (let py = top; py <= bottom; py++) for (let px = left; px <= right; px++) {
      const distance = Math.hypot(px + .5 - x, py + .5 - y) / radius;
      if (distance >= 1) continue;
      const strength = Math.min(1, (1 - distance) / .2), index = py * width + px;
      mask[index] = restore ? mask[index] + (alpha[index] - mask[index]) * strength : mask[index] * (1 - strength);
    }
  }
  return mask;
}
