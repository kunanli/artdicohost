import { INVITATION_MEDIUM_PARTS, INVITATION_REGULAR_PART } from './invitation-font-data.mjs';

export const INVITATION_MEDIUM_FAMILY = 'ARTDiCOInvitationMediumV2';
export const INVITATION_REGULAR_FAMILY = 'ARTDiCOInvitationRegularV2';
const failure = (message = '邀请函字体未能载入，请稍后重新生成。') => new Error(message);
const covers = (part, point) => part.codePointRanges.some(([start, end]) => point >= start && point <= end);
function partValue(part) {
  if (!part || typeof part.id !== 'string' || !part.id || typeof part.url !== 'string' || !part.url
    || typeof part.unicodeRange !== 'string' || !part.unicodeRange || !Array.isArray(part.codePointRanges) || !part.codePointRanges.length
    || part.codePointRanges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(value => Number.isInteger(value) && value >= 0 && value <= 0x10ffff) || range[0] > range[1])) throw failure();
  return part;
}

/** FontFace loading is explicit and shared across PNGs; no DOM globals are accessed on import. */
export function createInvitationFontLoader({ FontFace: Face = globalThis.FontFace, fonts = globalThis.document?.fonts,
  mediumParts = INVITATION_MEDIUM_PARTS, regularPart = INVITATION_REGULAR_PART } = {}) {
  if (!Array.isArray(mediumParts) || !mediumParts.length) throw failure();
  const medium = mediumParts.map(partValue), regular = partValue(regularPart), promises = new Map();
  if (new Set([...medium, regular].map(part => part.id)).size !== medium.length + 1) throw failure();
  async function ensure(part, family, weight) {
    let promise = promises.get(part.id);
    if (!promise) {
      promise = (async () => {
        const face = new Face(family, 'url(' + JSON.stringify(part.url) + ')', { style: 'normal', weight: String(weight), unicodeRange: part.unicodeRange });
        const loaded = await face.load();
        if (loaded !== face || face.status !== 'loaded') throw failure();
        fonts.add(face); return face;
      })();
      promises.set(part.id, promise);
      promise.catch(() => { if (promises.get(part.id) === promise) promises.delete(part.id); });
    }
    return promise;
  }
  return async function load({ mediumText = '', regularText = '' } = {}) {
    if (typeof Face !== 'function' || !fonts || !['add', 'load', 'check'].every(key => typeof fonts[key] === 'function')
      || typeof mediumText !== 'string' || typeof regularText !== 'string') throw failure();
    // A custom stored time can contain characters outside the small Regular subset.
    // Such a line uses the complete Medium source rather than a system fallback.
    const useRegular = [...regularText].every(character => covers(regular, character.codePointAt(0)));
    const completeMediumText = mediumText + (useRegular ? '' : regularText), needed = new Set();
    for (const character of completeMediumText) {
      const point = character.codePointAt(0), part = medium.find(candidate => covers(candidate, point));
      if (!part) throw failure('邀请函字体不支持部分字符（U+' + point.toString(16).toUpperCase().padStart(4, '0') + '），请核对称呼或地点。');
      needed.add(part);
    }
    try {
      await Promise.all([...needed].map(part => ensure(part, INVITATION_MEDIUM_FAMILY, 500)));
      if (useRegular && regularText) await ensure(regular, INVITATION_REGULAR_FAMILY, 400);
      for (const [family, weight, text] of [[INVITATION_MEDIUM_FAMILY, 500, completeMediumText], [INVITATION_REGULAR_FAMILY, 400, useRegular ? regularText : '']]) {
        if (!text) continue;
        const query = weight + ' 40px "' + family + '"', loaded = await fonts.load(query, text);
        if (!Array.isArray(loaded) || !loaded.length || loaded.some(face => face.status !== 'loaded') || !fonts.check(query, text)) throw failure();
      }
    } catch { throw failure(); }
    return { mediumFamily: '"' + INVITATION_MEDIUM_FAMILY + '"', regularFamily: '"' + (useRegular ? INVITATION_REGULAR_FAMILY : INVITATION_MEDIUM_FAMILY) + '"', regularWeight: useRegular ? 400 : 500 };
  };
}

const loaders = new WeakMap();
export async function loadInvitationFonts(texts) {
  const fonts = globalThis.document?.fonts;
  if (!fonts || typeof fonts !== 'object' || typeof globalThis.FontFace !== 'function') throw failure();
  let loader = loaders.get(fonts);
  if (!loader) { loader = createInvitationFontLoader({ fonts }); loaders.set(fonts, loader); }
  return loader(texts);
}
