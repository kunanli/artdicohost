const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function validDraftFields(value) {
  return plain(value) && Object.keys(value).length <= 160 && Object.entries(value).every(([key, item]) => /^[A-Za-z][A-Za-z0-9:_-]{0,120}$/u.test(key)
    && (typeof item === 'string' && item.length <= 32000 || Array.isArray(item) && item.length <= 100 && item.every(part => typeof part === 'string' && part.length <= 32000)));
}
/** Only explicitly named controls are cached. Consent, credentials and file inputs never enter this list. */
export function captureDraftFields(form, names) {
  const result = {};
  for (const name of names) {
    const fields = [...form.elements].filter(field => field.name === name && !['file','password'].includes(field.type));
    if (!fields.length) continue;
    if (fields[0].type === 'checkbox' || fields[0].type === 'radio') result[name] = fields.filter(field => field.checked).map(field => field.value);
    else if (fields[0].tagName === 'SELECT' && fields[0].multiple) result[name] = [...fields[0].selectedOptions].map(option => option.value);
    else result[name] = fields.length === 1 ? fields[0].value : fields.map(field => field.value);
  }
  return result;
}
export function applyDraftFields(form, values, names) {
  if (!validDraftFields(values) || Object.keys(values).some(name => !names.includes(name))) throw new Error('本机草稿字段无法核对。');
  // Check all exact options before changing any control. Removed IDs are never matched by label.
  for (const [name, value] of Object.entries(values)) {
    const fields = [...form.elements].filter(field => field.name === name), selected = Array.isArray(value) ? value : [value];
    if (!fields.length) throw new Error('关联项目已改变，请手动核对本机草稿。');
    const options = fields[0].tagName === 'SELECT' ? [...fields[0].options].map(option => option.value) : ['checkbox','radio'].includes(fields[0].type) ? fields.map(field => field.value) : null;
    if (options && selected.some(item => !options.includes(item))) throw new Error('关联项目已改变，请手动核对本机草稿。');
  }
  for (const [name, value] of Object.entries(values)) {
    const fields = [...form.elements].filter(field => field.name === name);
    if (['checkbox','radio'].includes(fields[0].type)) for (const field of fields) field.checked = Array.isArray(value) && value.includes(field.value);
    else if (fields[0].tagName === 'SELECT' && fields[0].multiple) for (const option of fields[0].options) option.selected = Array.isArray(value) && value.includes(option.value);
    else fields.forEach((field, index) => { field.value = Array.isArray(value) ? value[index] ?? '' : value; });
  }
}

