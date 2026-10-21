/** Strict, pure importer for the supplied 2026 questionnaire export. No transport or storage. */
export const WORKBOOK_SOURCE_KEY = 'wjx-388636468';

export const importHeaders = Object.freeze([
  '序号',
  '提交答卷时间',
  '所用时间',
  '来源',
  '来源详情',
  '来自IP',
  '1. 姓名 / Name',
  '2. 所在城市 / City',
  '3. 所属机构 / Organization',
  '4. 职位 / Position',
  '5. 电子邮箱 / Email',
  '6. 微信号 / WeChat ID',
  '7. 个人或机构网站（选填）',
  '8. 您目前属于以下哪类参与者?(GGJ 站点组织者 (SO，现任或曾任）)',
  '8 (GGJ 区域组织者 (RO，现任或曾任）)',
  '8 (有意筹建GGJ新站点)',
  '8 (游戏行业嘉宾)',
  '8 (游戏开发者)',
  '8 (高校代表)',
  '8 (教育机构代表)',
  '8 (游戏生态合作伙伴（企业、工具、平台、社区等）)',
  '8 (其他)',
  '9. 您希望以哪些方式参与本次活动?(GGJ站点经验交流)',
  '9 (主题演讲)',
  '9 (技术分享)',
  '9 (圆桌讨论)',
  '9 (行业交流)',
  '9 (展示展位)',
  '9 (产品体验)',
  '9 (GGJ站点资源支持)',
  '9 (赞助或生态合作)',
  '9 (仅作为嘉宾出席)',
  '10. 请简要介绍您在 GGJ、游戏行业或相关领域的经历',
  '11. 如有相关 GGJ 站点、机构、项目或作品链接，请填写（选填）',
  '12. 您是否有意于 2026 年 12 月 5 日前往深圳参加活动?',
  '13. 如您受邀参加活动，是否需要申请一晚住宿支持? (仅限外地嘉宾)',
  '15. 您希望在本次交流会中探讨哪些话题或合作机会?',
  '16. 您是否同意筹备团队为本次活动的意向审核、联系及相关安排使用所填信息?',
  '17. 您所在的机构是否有兴趣与 Global Game Jam（GGJ）探索未来的合作机会？',
]);

export const importTextHeaders = Object.freeze([
  ...importHeaders.slice(0, 13),
  '8. 您目前属于以下哪类参与者?',
  '9. 您希望以哪些方式参与本次活动?',
  ...importHeaders.slice(32),
]);

// Verified by joining all 39 records from numeric and text exports by sourceRowId.
// A historical intent or consent answer never changes a person's RSVP status.
export const verifiedAnswerLegends = Object.freeze({
  attendanceIntent: Object.freeze({
    '1': Object.freeze({ value: 'expected', label: '有意参加，预计可以到场' }),
    '2': Object.freeze({ value: 'uncertain', label: '有意参加，但行程尚未确定' }),
  }),
  accommodationIntent: Object.freeze({
    '1': Object.freeze({ value: 'needed', label: '需要' }),
    '2': Object.freeze({ value: 'not_needed', label: '不需要，我将自行安排住宿' }),
    '3': Object.freeze({ value: 'uncertain', label: '暂不确定' }),
  }),
  contactConsent: Object.freeze({
    '1': Object.freeze({ value: 'consented', label: '同意' }),
    '2': Object.freeze({ value: 'declined', label: '不同意' }),
  }),
  futureCooperation: Object.freeze({
    '1': Object.freeze({ value: 'interested', label: '同意' }),
  }),
});

const categoryDefinitions = [
  ['so', 'GGJ 站点组织者（现任或曾任）'],
  ['ro', 'GGJ 区域组织者（现任或曾任）'],
  ['prospective_site', '有意筹建 GGJ 新站点'],
  ['industry', '游戏行业嘉宾'],
  ['developer', '游戏开发者'],
  ['university', '高校代表'],
  ['education', '教育机构代表'],
  ['partner', '游戏生态合作伙伴'],
  ['other', '其他'],
];
const interestDefinitions = [
  ['site_experience', 'GGJ 站点经验交流'],
  ['talk', '主题演讲'],
  ['technical_share', '技术分享'],
  ['roundtable', '圆桌讨论'],
  ['industry_networking', '行业交流'],
  ['exhibition', '展示展位'],
  ['product_demo', '产品体验'],
  ['site_resources', 'GGJ 站点资源支持'],
  ['sponsorship_partnership', '赞助或生态合作'],
  ['attend_only', '仅作为嘉宾出席'],
];
const options = (definitions) => Object.freeze(definitions.map(([value, label]) => Object.freeze({ value, label })));
export const sourceLabels = Object.freeze({
  // Display only: the original nine questionnaire columns above never move.
  categories: options([...categoryDefinitions, ['student', '学生']]),
  interests: options(interestDefinitions),
});

const headerKey = (value) => typeof value === 'string' ? value.normalize('NFC').replace(/^\uFEFF/, '').trim().replace(/\s+/g, ' ') : '';
const knownHeaders = new Map(importHeaders.map((value, index) => [headerKey(value), index]));
const knownTextHeaders = new Map(importTextHeaders.map((value, index) => [headerKey(value), index]));
const requiredHeaderIndices = [0, 1, ...Array.from({ length: 33 }, (_, index) => index + 6)];
const empty = (value) => value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
const questionDefinitions = [
  ['attendanceIntent', 34, 17], ['accommodationIntent', 35, 18],
  ['contactConsent', 37, 20], ['futureCooperation', 38, 21],
];
const sourceCategoryTexts = importHeaders.slice(13, 22).map((header) => header.slice(header.indexOf('(') + 1, -1));
const sourceInterestTexts = importHeaders.slice(22, 32).map((header) => header.slice(header.indexOf('(') + 1, -1));

function fail(code, message, row, column) {
  const error = new Error(message);
  error.name = 'ContactImportError';
  error.code = code;
  if (row !== undefined) error.row = row;
  if (column !== undefined) error.column = column;
  throw error;
}

function cellText(value, row, column, limit = 8192) {
  if (empty(value)) return '';
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) fail('invalid_date', '表格中有无法读取的日期。', row, column);
    // Excel stores a local wall-clock value, so do not invent a timezone suffix.
    return value.toISOString().slice(0, 19).replace('T', ' ');
  }
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value)))) {
    fail('invalid_cell_type', '表格中有不支持的单元格类型。', row, column);
  }
  const result = String(value).normalize('NFC').trim();
  if (result.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    fail('invalid_cell_text', '表格中有过长或含控制字符的内容。', row, column);
  }
  return result;
}

function flag(value, row, column) {
  if (empty(value) || value === 0 || value === false || value === '0') return false;
  if (value === 1 || value === true || (typeof value === 'string' && value.trim() === '1')) return true;
  fail('invalid_selection_code', '多选题应为 1、0 或空白，请检查导出格式。', row, column);
}

function readHeaderPositions(header, definitions) {
  const positions = new Map();
  const ignoredColumns = [];
  header.forEach((value, position) => {
    const key = headerKey(value);
    if (!key) return;
    const definition = definitions.get(key);
    if (definition === undefined) { ignoredColumns.push(position + 1); return; }
    if (positions.has(definition)) fail('duplicate_header', '表头重复，请使用原始导出表头。', 1, position + 1);
    positions.set(definition, position);
  });
  return { positions, ignoredColumns };
}

function selectionFlags(value, knownLabels, row, column) {
  if (empty(value)) return knownLabels.map(() => 0);
  const text = cellText(value, row, column, 4000);
  const labels = text.split('┋').map((label) => headerKey(label));
  const known = knownLabels.map(headerKey);
  if (labels.some((label) => !known.includes(label)) || new Set(labels).size !== labels.length) {
    fail('unknown_selection_label', '文本多选题有未识别或重复的选项，请检查原问卷导出格式。', row, column);
  }
  return known.map((label) => labels.includes(label) ? 1 : 0);
}

function expandTextMatrix(matrix) {
  const { positions, ignoredColumns } = readHeaderPositions(matrix[0], knownTextHeaders);
  const required = [0, 1, ...Array.from({ length: 16 }, (_, index) => index + 6)];
  if (required.some((index) => !positions.has(index))) fail('missing_header', '缺少必要的问卷文本导出表头，请选择原始导出文件。');
  const expanded = [Array.from(importHeaders)];
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index];
    if (!Array.isArray(line)) fail('invalid_row', '表格中有无法读取的数据行。', index + 1);
    if (line.every(empty)) { expanded.push([]); continue; }
    if (line.length > 100) fail('too_many_columns', '数据行列数超过支持的范围。', index + 1);
    const get = (definition) => line[positions.get(definition)];
    const row = Array(39).fill(null);
    // Copy only relevant fields. IP, device/source details and completion time are discarded.
    for (const definition of [0, 1, 6, 7, 8, 9, 10, 11, 12]) row[definition] = get(definition);
    selectionFlags(get(13), sourceCategoryTexts, index + 1, positions.get(13) + 1).forEach((value, offset) => { row[offset + 13] = value; });
    selectionFlags(get(14), sourceInterestTexts, index + 1, positions.get(14) + 1).forEach((value, offset) => { row[offset + 22] = value; });
    for (let offset = 0; offset < 7; offset += 1) row[offset + 32] = get(offset + 15);
    for (const [name, numericIndex, textIndex] of questionDefinitions) {
      const label = cellText(get(textIndex), index + 1, positions.get(textIndex) + 1, 240);
      if (!label) { row[numericIndex] = ''; continue; }
      const pair = Object.entries(verifiedAnswerLegends[name]).find(([, definition]) => headerKey(definition.label) === headerKey(label));
      if (!pair) fail('unknown_answer_label', '文本单选题有未核对的选项，不能推测其含义。', index + 1, positions.get(textIndex) + 1);
      row[numericIndex] = pair[0];
    }
    expanded.push(row);
  }
  return { matrix: expanded, ignoredColumns };
}

/**
 * @param {unknown[][]} matrix Header first, using a read-only XLSX reader.
 * @param {{maxRows?: number}} [configuration]
 * @returns {{rows:Record<string,unknown>[],warnings:Record<string,unknown>[]}}
 */
export function parseContactImport(matrix, configuration = {}) {
  const maxRows = configuration.maxRows ?? 5000;
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 10000) fail('invalid_limit', '导入数量限制无效。');
  if (!Array.isArray(matrix) || !matrix.length || !Array.isArray(matrix[0])) fail('empty_workbook', '没有找到含表头的数据工作表。');
  if (matrix.length - 1 > maxRows) fail('too_many_rows', '本次导入的行数超过限制，请拆分后重试。');
  if (matrix[0].length > 100) fail('too_many_columns', '表格列数超过支持的范围。');
  const textMode = matrix[0].some((value) => headerKey(value) === headerKey(importTextHeaders[13]) || headerKey(value) === headerKey(importTextHeaders[14]));
  let extraTextColumns = [];
  if (textMode) {
    if (matrix[0].some((value) => knownHeaders.get(headerKey(value)) === 13 || knownHeaders.get(headerKey(value)) === 22)) fail('ambiguous_export_format', '表格混合了序号与文本两种导出表头，请选择一种完整导出格式。');
    const expanded = expandTextMatrix(matrix);
    matrix = expanded.matrix;
    extraTextColumns = expanded.ignoredColumns;
  }
  const { positions, ignoredColumns: numericExtraColumns } = readHeaderPositions(matrix[0], knownHeaders);
  const ignoredColumns = textMode ? extraTextColumns : numericExtraColumns;
  const missing = requiredHeaderIndices.filter((index) => !positions.has(index));
  if (missing.length) fail('missing_header', '缺少必要的问卷导出表头，请选择原始导出文件。');
  const warnings = [
    { code: 'verified_answer_legend', message: '选项含义已用同一问卷的序号版与文本版按答卷序号逐条核对。历史意向仍不等于确认参会或已发送邀请。' },
    { code: 'legacy_intention_only', message: '历史意向资料不等于已发邀请、确认参会、已排讲者、已分配展位或获房。网站新报名仍独立受理。' },
  ];
  if (ignoredColumns.length) warnings.push({ code: 'unknown_columns_ignored', columns: ignoredColumns, message: '未识别的额外列未导入。' });
  const result = [];
  const seen = new Set();
  let skippedEmpty = 0;
  let numericWechat = 0;
  for (let index = 1; index < matrix.length; index += 1) {
    const line = matrix[index];
    const excelRow = index + 1;
    if (!Array.isArray(line)) fail('invalid_row', '表格中有无法读取的数据行。', excelRow);
    if (line.every(empty)) { skippedEmpty += 1; continue; }
    if (line.length > 100) fail('too_many_columns', '数据行列数超过支持的范围。', excelRow);
    const get = (definition) => line[positions.get(definition)];
    const read = (definition, limit) => cellText(get(definition), excelRow, positions.get(definition) + 1, limit);
    const optionalExportText = (definition, limit) => {
      const value = read(definition, limit);
      return ['(空)', '（空）', '(跳过)', '（跳过）'].includes(value) ? '' : value;
    };
    const source = read(0, 32);
    if (!/^\d{1,20}$/.test(source) || /^0+$/.test(source)) fail('invalid_source_id', '问卷序号须为正整数。', excelRow, positions.get(0) + 1);
    const sourceRowId = source.replace(/^0+/, '');
    if (seen.has(sourceRowId)) fail('duplicate_source_id', '问卷序号重复，请检查同一答卷是否重复导出。', excelRow, positions.get(0) + 1);
    seen.add(sourceRowId);
    const name = read(6, 160);
    if (!name) fail('missing_name', '数据行缺少姓名，请先补充或排除该行。', excelRow, positions.get(6) + 1);
    const email = read(10, 254);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('invalid_email', '有邮箱格式需要修正，请检查标记的数据行。', excelRow, positions.get(10) + 1);
    const wechat = read(11, 160);
    if (!email && !wechat) fail('missing_contact', '数据行缺少邮箱或微信，请先补充联系方式。', excelRow);
    if (typeof get(11) === 'number') numericWechat += 1;
    const categories = categoryDefinitions.filter((_, offset) => flag(get(offset + 13), excelRow, positions.get(offset + 13) + 1)).map(([value]) => value);
    const interests = interestDefinitions.filter((_, offset) => flag(get(offset + 22), excelRow, positions.get(offset + 22) + 1)).map(([value]) => value);
    if (!categories.length) warnings.push({ code: 'no_category', row: excelRow, message: '此行没有选择参与身份，可在导入后补充。' });
    if (!interests.length) warnings.push({ code: 'no_interest', row: excelRow, message: '此行没有选择参与方式，可在导入后补充。' });
    const answerFields = {};
    for (const [name, numericIndex] of questionDefinitions) {
      const code = read(numericIndex, 32);
      if (code && !/^\d{1,10}$/.test(code)) fail('invalid_answer_code', '数字导出的单选题含有无效代码。', excelRow, positions.get(numericIndex) + 1);
      const definition = Object.hasOwn(verifiedAnswerLegends[name], code) ? verifiedAnswerLegends[name][code] : undefined;
      answerFields[name + 'Code'] = code;
      answerFields[name + 'Label'] = definition?.label ?? '';
      answerFields[name] = definition?.value ?? 'unknown';
      if (code && !definition) warnings.push({ code: 'unknown_answer_code', row: excelRow, field: name, message: '此行有未核对的数字选项代码，保留原代码且不推断含义。' });
    }
    result.push({
      sourceRowId,
      name, displayName: name,
      city: read(7, 160), organization: read(8, 320), position: read(9, 240),
      email, wechat, phone: '', categories, interests,
      background: read(32, 10000), needs: '', siteName: '', siteRole: '', siteYears: '',
      topics: read(36, 10000), submittedAt: read(1, 64), website: optionalExportText(12, 2048), caseLinks: optionalExportText(33, 16000),
      ...answerFields,
    });
  }
  if (!result.length) fail('no_data_rows', '表格中没有可导入的数据行。');
  if (skippedEmpty) warnings.push({ code: 'blank_rows_skipped', count: skippedEmpty, message: '已跳过空白行。' });
  if (numericWechat) warnings.push({ code: 'numeric_wechat', count: numericWechat, message: '有微信号以数字储存，已转为文本。请核对原号码是否曾丢失前导零。' });
  const declinedConsent = result.filter((row) => row.contactConsent === 'declined').length;
  const unknownConsent = result.filter((row) => row.contactConsent === 'unknown').length;
  if (declinedConsent) warnings.push({ code: 'declined_contact_consent', count: declinedConsent, message: '有来宾在原问卷中不同意信息使用，应从待邀约及批量生成范围中排除。' });
  if (unknownConsent) warnings.push({ code: 'unknown_contact_consent', count: unknownConsent, message: '有来宾的原问卷信息使用同意状态待核对，应从待邀约范围中排除。' });
  return { rows: result, warnings };
}
