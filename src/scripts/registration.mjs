import {
  registrationSchema,
  getActiveBranches,
  validateRegistration,
  completeMockRegistration,
} from '../../shared/registration-schema.mjs';

const multipleFields = registrationSchema.baseFields.filter(field => field.type === 'checkbox-group').map(field => field.name);

for (const form of document.querySelectorAll('[data-registration-form]')) {
  if (!(form instanceof HTMLFormElement) || form.dataset.enhanced) continue;
  // Intercept before enabling controls; there is deliberately no submission transport.
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (step !== 2) return;
    syncBranches();
    const result = completeMockRegistration(read());
    if (!result.valid) {
      const first = Object.keys(result.errors)[0];
      const control = form.elements.namedItem(first);
      const section = control instanceof HTMLElement ? control.closest('[data-form-step]') : null;
      if (section) showStep(Number(section.dataset.formStep), false);
      showErrors(result.errors);
      return;
    }
    form.reset();
    clearErrors();
    syncBranches();
    form.querySelector('[data-form-result]').textContent = result.message;
    showStep(3);
  });
  form.dataset.enhanced = 'true';
  let step = 0;
  const summary = form.querySelector('[data-form-error]');
  const steps = [...form.querySelectorAll('[data-form-step]')];
  const submit = form.querySelector('[data-submit]');
  const branchSets = [...form.querySelectorAll('[data-branch]')];

  function read() {
    const data = new FormData(form);
    const value = Object.fromEntries(data);
    for (const name of multipleFields) value[name] = data.getAll(name);
    value.consentAccepted = data.has('consentAccepted');
    return value;
  }
  function clearErrors() {
    form.querySelectorAll('[data-error-for]').forEach(el => { el.hidden = true; el.textContent = ''; });
    form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid'));
    summary.hidden = true;
    summary.textContent = '';
  }
  function showStep(next, focus = true) {
    step = next;
    steps.forEach(section => { section.hidden = Number(section.dataset.formStep) !== step; });
    form.querySelectorAll('[data-step-dot]').forEach(dot => {
      const active = Number(dot.dataset.stepDot) === step;
      dot.classList.toggle('ah-step-active', Number(dot.dataset.stepDot) <= step);
      if (active) dot.setAttribute('aria-current', 'step'); else dot.removeAttribute('aria-current');
    });
    if (focus) steps.find(section => Number(section.dataset.formStep) === step)?.querySelector('h3')?.focus();
  }
  function syncBranches() {
    const active = new Set(getActiveBranches(read()));
    for (const fieldset of branchSets) {
      const visible = active.has(fieldset.dataset.branch);
      if (!visible) {
        for (const control of fieldset.querySelectorAll('input,select,textarea')) {
          if (control.type === 'checkbox' || control.type === 'radio') control.checked = false;
          else control.value = '';
          control.removeAttribute('aria-invalid');
        }
        fieldset.querySelectorAll('[data-error-for]').forEach(el => { el.hidden = true; el.textContent = ''; });
      }
      fieldset.disabled = !visible;
      fieldset.hidden = !visible;
    }
    form.querySelectorAll('[data-identity]').forEach(input => {
      const mark = input.closest('label')?.querySelector('b');
      if (mark) mark.textContent = input.checked ? '✓' : '+';
    });
  }
  function showErrors(errors) {
    clearErrors();
    const entries = Object.entries(errors);
    for (const [name, message] of entries) {
      const output = [...form.querySelectorAll('[data-error-for]')].find(el => el.dataset.errorFor === name);
      if (output) { output.textContent = message; output.hidden = false; }
      for (const input of form.querySelectorAll('[name]')) if (input.name === name) input.setAttribute('aria-invalid', 'true');
    }
    summary.textContent = '请检查 ' + entries.length + ' 项标记的字段。当前没有提交报名。';
    summary.hidden = false;
    summary.focus();
  }
  function checkStep() {
    syncBranches();
    const validation = validateRegistration(read());
    const section = steps.find(item => Number(item.dataset.formStep) === step);
    const names = new Set([...section.querySelectorAll('[name]:not(:disabled)')].map(input => input.name));
    const errors = Object.fromEntries(Object.entries(validation.errors).filter(([name]) => names.has(name)));
    if (Object.keys(errors).length) { showErrors(errors); return false; }
    clearErrors();
    return true;
  }
  form.querySelectorAll('[data-next-step]').forEach(button => button.addEventListener('click', () => {
    if (checkStep()) showStep(Math.min(2, step + 1));
  }));
  form.querySelectorAll('[data-prev-step]').forEach(button => button.addEventListener('click', () => { clearErrors(); showStep(Math.max(0, step - 1)); }));
  form.querySelector('[data-reset-form]')?.addEventListener('click', () => {
    form.reset(); clearErrors(); syncBranches(); showStep(0);
  });
  form.addEventListener('change', syncBranches);
  for (const link of document.querySelectorAll('[data-recruit]')) {
    link.addEventListener('click', () => {
      if (step === 3) form.reset();
      const choices = link.dataset.recruit === 'speaker'
        ? { participationInterests: 'talk' }
        : { categories: 'sponsor', participationInterests: 'sponsorship' };
      for (const [name, value] of Object.entries(choices)) {
        const input = [...form.querySelectorAll('input')].find(el => el.name === name && el.value === value);
        if (input) input.checked = true;
      }
      clearErrors(); syncBranches(); showStep(0, false);
    });
  }
  submit.disabled = false;
  syncBranches();
  showStep(0, false);
}
