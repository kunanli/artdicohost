import test from 'node:test';
import assert from 'node:assert/strict';
import { imagePlacement, originalAlpha, removeEdgeBackground, paintAlphaStroke } from '../src/lib/image-editing.mjs';

function image(width, height, color = [255, 255, 255, 255]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index++) data.set(color, index * 4);
  return data;
}
function pixel(data, width, x, y, color) { data.set(color, (y * width + x) * 4); }

test('cover cropping and pan bounds keep the frame filled and preserve the original aspect', () => {
  const centered = imagePlacement(1200, 600, 600, 600);
  assert.deepEqual(centered, { x: -300, y: 0, width: 1200, height: 600, scale: 1, offsetX: 0, offsetY: 0 });
  const rightEdge = imagePlacement(1200, 600, 600, 600, 1, 9999, -9999);
  assert.equal(rightEdge.x, 0); assert.equal(rightEdge.y, 0);
  const leftEdge = imagePlacement(1200, 600, 600, 600, 1, -9999, 9999);
  assert.equal(leftEdge.x + leftEdge.width, 600);
  const zoomed = imagePlacement(1200, 600, 600, 600, 2, -300, 150);
  assert.equal(zoomed.width / zoomed.height, 2);
  assert.ok(zoomed.x <= 0 && zoomed.y <= 0 && zoomed.x + zoomed.width >= 600 && zoomed.y + zoomed.height >= 600);
});

test('zooming out centers a contained original with transparent room rather than distorting it', () => {
  const contained = imagePlacement(1200, 600, 600, 600, .5, 400, 400);
  assert.deepEqual(contained, { x: 0, y: 150, width: 600, height: 300, scale: .5, offsetX: 0, offsetY: 0 });
  assert.throws(() => imagePlacement(1200, 600, 600, 600, Infinity));
  assert.throws(() => imagePlacement(1200, 600, 600, 600, .01));
  assert.throws(() => imagePlacement(1200, 600, 600, 600, 1, NaN));
});

test('edge-connected background removal preserves enclosed white details and the original pixels', () => {
  const width = 9, height = 9, data = image(width, height);
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) pixel(data, width, x, y, [20, 70, 220, 255]);
  pixel(data, width, 4, 4, [255, 255, 255, 255]);
  const untouched = new Uint8ClampedArray(data), mask = originalAlpha(data, width, height);
  const result = removeEdgeBackground(data, width, height, mask, [255, 255, 255], 12);
  assert.equal(result.removed, 56);
  assert.equal(result.mask[0], 0); assert.equal(result.mask[4 * width + 4], 255);
  assert.equal(result.mask[2 * width + 2], 255);
  assert.deepEqual(data, untouched);
  assert.ok(mask.every(value => value === 255), 'the input mask remains usable for undo');
});

test('tolerance changes only connected matching colors and never a contrasting foreground', () => {
  const width = 5, height = 3, data = image(width, height, [240, 242, 244, 255]);
  pixel(data, width, 2, 1, [5, 80, 240, 255]);
  const mask = originalAlpha(data, width, height);
  assert.equal(removeEdgeBackground(data, width, height, mask, [255, 255, 255], 0).removed, 0);
  const permissive = removeEdgeBackground(data, width, height, mask, [255, 255, 255], 20);
  assert.equal(permissive.removed, 14); assert.equal(permissive.mask[7], 255);
});

test('a transparent border remains transparent and connects a sampled background without erasing nonmatching color', () => {
  const width = 5, height = 5, data = image(width, height, [0, 0, 0, 0]);
  for (let y = 1; y < 4; y++) for (let x = 1; x < 4; x++) pixel(data, width, x, y, [255, 255, 255, 255]);
  pixel(data, width, 2, 2, [180, 20, 40, 128]);
  const result = removeEdgeBackground(data, width, height, originalAlpha(data, width, height), [255, 255, 255], 0);
  assert.equal(result.mask[0], 0); assert.equal(result.mask[6], 0); assert.equal(result.mask[12], 128);
});

test('erase strokes are continuous between pointer events and restore never invents original opacity', () => {
  const width = 60, height = 20, data = image(width, height), alpha = originalAlpha(data, width, height);
  alpha[10 * width + 30] = 80; alpha[10 * width + 31] = 0;
  const mask = new Uint8ClampedArray(alpha);
  paintAlphaStroke(mask, alpha, width, height, { x: 5.5, y: 10.5 }, { x: 54.5, y: 10.5 }, 3);
  for (let x = 6; x <= 54; x++) assert.equal(mask[10 * width + x], 0);
  assert.equal(mask[0], 255);
  paintAlphaStroke(mask, alpha, width, height, { x: 28.5, y: 10.5 }, { x: 32.5, y: 10.5 }, 3, true);
  assert.equal(mask[10 * width + 30], 80); assert.equal(mask[10 * width + 31], 0);
  assert.equal(mask[10 * width + 10], 0);
  assert.ok(mask.every((value, index) => value <= alpha[index]));
});

test('size and brush guards reject unsafe allocations and non-finite coordinates before processing', () => {
  const mask = new Uint8ClampedArray(4), data = image(2, 2);
  assert.throws(() => originalAlpha(data, 1601, 1600));
  assert.throws(() => removeEdgeBackground(data, 2, 2, mask, [255, 255, NaN]));
  assert.throws(() => removeEdgeBackground(data, 2, 2, mask, [255, 255, 255], 151));
  assert.throws(() => paintAlphaStroke(mask, mask, 2, 2, { x: Infinity, y: 1 }, { x: 1, y: 1 }, 2));
  assert.throws(() => paintAlphaStroke(mask, mask, 2, 2, { x: 1, y: 1 }, { x: 1, y: 1 }, 1000));
});
