// An application engineering budget for the code-only JSON request body.
// This does not claim to be the provider's exact request-size limit.
export const MAX_FC_REQUEST_BYTES = 48_000_000;
const JSON_WRAPPER_BYTES = Buffer.byteLength(JSON.stringify({ code: { zipFile: '' } }), 'utf8');
export const MAX_FC_ZIP_BYTES = Math.floor((MAX_FC_REQUEST_BYTES - JSON_WRAPPER_BYTES) / 4) * 3;
const invalid = () => new Error('FC code upload exceeds its fixed request budget or has an invalid ZIP length');

/** Exact UTF-8 size without constructing a ZIP, Base64 string or request body. */
export function fcCodeRequestBytes(zipLength) {
  if (!Number.isSafeInteger(zipLength) || zipLength < 0) throw invalid();
  const size = 4n * ((BigInt(zipLength) + 2n) / 3n) + BigInt(JSON_WRAPPER_BYTES);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  return Number(size);
}

/** The limit cannot be selected by an environment value or artifact manifest. */
export function assertFcCodeRequestFits(zipLength) {
  const size = fcCodeRequestBytes(zipLength);
  if (size > MAX_FC_REQUEST_BYTES) throw invalid();
  return size;
}
