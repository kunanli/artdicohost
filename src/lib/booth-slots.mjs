import { contentSchema } from '../../shared/content-schema.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const CODE = /^[A-Z0-9][A-Z0-9-]{0,15}$/u;
const own = (value, name) => Object.getOwnPropertyDescriptor(value, name)?.value;

/** Validate position metadata without reading private fields or changing records. */
function positions(records) {
  if (!Array.isArray(records) || records.length > contentSchema.maxBooths) throw new TypeError('展位资料无效。');
  const occupied = new Set(), ids = new Set(), codes = new Set();
  for (let index = 0; index < records.length; index++) {
    const row = own(records, String(index));
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('展位资料无效。');
    const id = own(row, 'id'), code = own(row, 'code'), status = own(row, 'status');
    const field = Object.getOwnPropertyDescriptor(row, 'slotNumber');
    const slot = field ? field.value : 0;
    if (typeof id !== 'string' || !ID.test(id) || ids.has(id) || typeof code !== 'string' || !CODE.test(code.toUpperCase()) || codes.has(code.toUpperCase())
      || !contentSchema.boothStatuses.includes(status) || !Number.isSafeInteger(slot) || slot < 0 || slot > contentSchema.maxBoothPosition) throw new TypeError('展位资料无效。');
    ids.add(id); codes.add(code.toUpperCase());
    if (status !== 'cancelled' && slot) {
      if (occupied.has(slot)) throw new TypeError('展位位置重复，请先核对。');
      occupied.add(slot);
    }
  }
  return { occupied, codes };
}

/** Suggest a vacant position for one new booth; cancelled history does not occupy it. */
export function nextBoothSlot(records) {
  const { occupied } = positions(records);
  if (records.length >= contentSchema.maxBooths) throw new TypeError('展位记录已达上限，请先核对历史记录。');
  for (let slot = 1; slot <= contentSchema.maxBoothPosition; slot++) if (!occupied.has(slot)) return slot;
  throw new TypeError('没有可用位置，请先核对现有展位。');
}

/** Codes stay unique across active and cancelled records, independent of positions. */
export function nextBoothCode(records, slotNumber) {
  const { codes } = positions(records);
  if (!Number.isSafeInteger(slotNumber) || slotNumber < 1 || slotNumber > contentSchema.maxBoothPosition) throw new TypeError('展位位置无效。');
  const base = 'C-' + String(slotNumber).padStart(2, '0');
  let code = base, sequence = 2;
  while (codes.has(code)) code = base + '-' + sequence++;
  return code;
}
