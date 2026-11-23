const isJammer = term => term.trim().toLowerCase() === 'jammer';
const terms = value => value.split(/[・·、；;]/u);
const addJammer = value => [value.trim(), 'Jammer'].filter(Boolean).join(' · ');

export function bindJammerOption(role, checkbox) {
  function sync() {
    checkbox.checked = terms(role.value).some(isJammer);
    checkbox.disabled = role.disabled || (!checkbox.checked && addJammer(role.value).length > role.maxLength);
  }

  role.addEventListener('input', sync);
  checkbox.addEventListener('change', () => {
    const current = terms(role.value);
    role.value = checkbox.checked ? (current.some(isJammer) ? role.value : addJammer(role.value))
      : current.map(term => term.trim()).filter(term => term && !isJammer(term)).join(' · ');
    role.dispatchEvent(new Event('input', { bubbles: true }));
  });
  sync();
  return sync;
}
