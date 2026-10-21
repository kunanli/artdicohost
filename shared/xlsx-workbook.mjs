/** Bounded OOXML workbook writer. Cells are explicit strings, never formulas. */
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_XLSX_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function fail() { throw new RangeError('Workbook exceeds its supported shape or size.'); }
function checksum(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ value >>> 8; return (value ^ 0xffffffff) >>> 0; }
function escaped(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) fail();
  // Escape the literal OOXML escape prefix before XML escaping, preserving original text.
  return value.replace(/_x([0-9a-f]{4})_/giu, '_x005F_x$1_').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
function column(index) { let name = ''; for (index++; index; index = Math.floor((index - 1) / 26)) name = String.fromCharCode(65 + (index - 1) % 26) + name; return name; }
function bytes(value) { return encoder.encode(value); }
function zip(files, maxBytes) {
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    const name = bytes(file.name), data = bytes(file.body), crc = checksum(data);
    const header = new Uint8Array(30), directory = new Uint8Array(46);
    const h = new DataView(header.buffer), d = new DataView(directory.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 0x0314, true); d.setUint16(6, 20, true); d.setUint16(8, 0x0800, true); d.setUint16(14, 33, true);
    d.setUint32(16, crc, true); d.setUint32(20, data.length, true); d.setUint32(24, data.length, true); d.setUint16(28, name.length, true);
    d.setUint32(38, (0o100600 << 16) >>> 0, true); d.setUint32(42, offset, true);
    local.push(header, name, data); central.push(directory, name);
    offset += header.length + name.length + data.length; centralSize += directory.length + name.length;
    if (offset + centralSize + 22 > maxBytes) fail();
  }
  const end = new Uint8Array(22), view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, files.length, true); view.setUint16(10, files.length, true); view.setUint32(12, centralSize, true); view.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.length); let position = 0;
  for (const part of [...local, ...central, end]) { result.set(part, position); position += part.length; }
  return result;
}

/** Each sheet supplies headers and rows of already scoped strings. No downloads or I/O. */
export function createXlsxWorkbook(sheets, { maxBytes = MAX_XLSX_BYTES } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > MAX_XLSX_BYTES || !Array.isArray(sheets) || !sheets.length || sheets.length > 8) fail();
  const names = new Set(), files = []; let totalCells = 0, xmlBytes = 0;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const add = (name, body) => { xmlBytes += bytes(body).length; if (xmlBytes > maxBytes) fail(); files.push({ name, body }); };
  for (const [index, sheet] of sheets.entries()) {
    if (!sheet || typeof sheet.name !== 'string' || !sheet.name.trim() || [...sheet.name].length > 31 || /[\[\]:*?/\\\u0000-\u001f]/u.test(sheet.name)
      || names.has(sheet.name.toLocaleLowerCase()) || !Array.isArray(sheet.headers) || !sheet.headers.length || sheet.headers.length > 128
      || !Array.isArray(sheet.rows) || sheet.rows.length > 65000) fail();
    names.add(sheet.name.toLocaleLowerCase());
    const rows = [sheet.headers, ...sheet.rows], body = [];
    for (const [r, row] of rows.entries()) {
      if (!Array.isArray(row) || row.length !== sheet.headers.length || (totalCells += row.length) > 300000) fail();
      const rendered = row.map((value, c) => '<c r="' + column(c) + (r + 1) + '" t="inlineStr"' + (r === 0 ? ' s="1"' : '') + '><is><t xml:space="preserve">' + escaped(value) + '</t></is></c>').join('');
      const line = '<row r="' + (r + 1) + '">' + rendered + '</row>';
      xmlBytes += bytes(line).length; if (xmlBytes > maxBytes) fail(); body.push(line);
    }
    const columns = sheet.headers.map((header, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + Math.min(48, Math.max(16, [...header].length * 2 + 4)) + '" customWidth="1"/>').join('');
    const range = 'A1:' + column(sheet.headers.length - 1) + rows.length;
    // Row bytes were already bounded above; add() accounts the completed worksheet once.
    xmlBytes -= body.reduce((sum, line) => sum + bytes(line).length, 0);
    add('xl/worksheets/sheet' + (index + 1) + '.xml', xml + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="' + range + '"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>' + columns + '</cols><sheetData>' + body.join('') + '</sheetData><autoFilter ref="' + range + '"/></worksheet>');
  }
  add('[Content_Types].xml', xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>');
  add('_rels/.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>');
  add('xl/workbook.xml', xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((sheet, i) => '<sheet name="' + escaped(sheet.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  add('xl/styles.xml', xml + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174CB5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs></styleSheet>');
  return zip(files, maxBytes);
}
