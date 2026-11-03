import { resolveEntryLink } from '../lib/entry-link.mjs';
const code = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
const status = document.querySelector('[data-entry-link-status]'), retry = document.querySelector('[data-entry-link-retry]');
let busy = false;
async function open() {
  if (busy) return; busy = true; retry.hidden = true;
  try { location.replace(await resolveEntryLink({ code, apiOrigin: document.body.dataset.entryLinkApi })); }
  catch { status.textContent = '链接暂时无法使用，请重新读取或联系主办方。'; retry.hidden = !/^[A-Za-z0-9_-]{22}$/u.test(code); }
  finally { busy = false; }
}
retry.addEventListener('click', open);
void open();
