import { registrationSchema, getActiveBranches } from '../../shared/registration-schema.mjs';

/** Strict API types and current branches only; demo consent metadata never leaves the page. */
export function registrationFields(value) {
  const fields = {};
  const active = getActiveBranches(value);
  function copy(source,target,definitions) {
    for (const field of definitions) {
      if (field.name === 'consentAccepted' || field.conditional && !active.includes(field.conditional)) continue;
      const supplied = source[field.name];
      target[field.name] = field.type === 'number' ? Number(supplied) : supplied;
    }
  }
  copy(value,fields,registrationSchema.baseFields);
  for (const name of active) {
    if (name === 'accommodation') continue;
    fields[name] = {};
    copy(value[name] ?? {},fields[name],registrationSchema.branches[name].fields);
  }
  return fields;
}
