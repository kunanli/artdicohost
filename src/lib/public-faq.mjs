import { faqItems as defaults } from '../config/event.mjs';
import { legacyFaqId } from '../../shared/content-schema.mjs';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u;
const REQUIRED = ['registration-status', 'data-rights', 'lodging-support'];
const CONTACT = 'support@artdico.co';
const line = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && value.isWellFormed()
  && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const mailbox = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u.test(value);
function legacyKey(question, answer) {
  let hash = 2166136261;
  for (const character of question + '\0' + answer) hash = Math.imul(hash ^ character.codePointAt(0), 16777619) >>> 0;
  return 'legacy-' + hash.toString(16);
}

/** Public, read-only projection. Optional stable IDs are persisted only by an
 * explicit editor save; an old fixed question is adapted by exact name here. */
export function publicFaqItems(items = defaults, { availability = null, privacy = null, contactEmail = CONTACT } = {}) {
  const rows = [], used = new Set();
  const input = Array.isArray(items) ? items.slice(0, 20) : defaults;
  for (const item of input) {
    if (!line(item?.question, 200) || !line(item?.answer, 1500)) continue;
    if (Object.hasOwn(item, 'id') && !ID.test(item.id ?? '')) continue;
    let id = item.id ?? legacyFaqId(item.question) ?? legacyKey(item.question, item.answer);
    if (used.has(id)) {
      if (!id.startsWith('legacy-')) continue;
      let suffix = 2; while (used.has(id + '-' + suffix)) suffix++; id += '-' + suffix;
    }
    used.add(id); rows.push({ id, question: item.question, answer: item.answer, contactEmail: null });
  }
  for (const id of REQUIRED) if (!used.has(id)) {
    const item = defaults.find(row => row.id === id); rows.push({ ...item, contactEmail: null });
  }
  return rows.map(item => {
    if (item.id === 'registration-status') return { ...item, answer: line(availability?.message, 4000) ? availability.message : defaults.find(row => row.id === item.id).answer };
    if (item.id === 'data-rights') return { ...item, answer: line(privacy?.rightsRequest, 4000) ? privacy.rightsRequest : defaults.find(row => row.id === item.id).answer,
      contactEmail: mailbox(privacy?.contactEmail) ? privacy.contactEmail : mailbox(contactEmail) ? contactEmail : CONTACT };
    if (item.id === 'lodging-support') return { ...defaults.find(row => row.id === item.id), contactEmail: CONTACT };
    return item;
  });
}

let currentItems = defaults, currentContact = CONTACT, currentPrivacy = null, currentAvailability = null;
/** The only FAQ DOM owner. Public content refresh supplies editorial items;
 * current registration/privacy state remains independent of those snapshots. */
export function setPublicFaqs(items, options = {}) {
  if (Array.isArray(items)) currentItems = items;
  else if (items === null) currentItems = defaults;
  if (Object.hasOwn(options, 'contactEmail')) currentContact = mailbox(options.contactEmail) ? options.contactEmail : CONTACT;
  renderFaqs();
}
function node(tag, text, className) {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element;
}
function renderFaqs() {
  if (typeof document === 'undefined') return;
  const output = document.querySelector('[data-public-faq]'); if (!output) return;
  const focused = document.activeElement, hadFocus = output.contains(focused), focusId = focused?.closest?.('[data-faq-id]')?.dataset.faqId;
  const saved = new Map([...output.children].filter(row => row instanceof HTMLDetailsElement).map(row => [row.dataset.faqId, row]));
  const rows = publicFaqItems(currentItems, { availability: currentAvailability, privacy: currentPrivacy, contactEmail: currentContact });
  for (const item of rows) {
    const previous = saved.get(item.id), row = previous ?? node('details', undefined, 'ah-faq-message');
    if (!previous) row.open = true;
    row.id = 'faq-' + item.id; row.dataset.faqId = item.id; saved.delete(item.id);
    let question = row.querySelector('summary'), answer = row.querySelector('.ah-faq-answer');
    if (!question) { question = node('summary', undefined, 'ah-faq-question'); row.prepend(question); }
    question.className = 'ah-faq-question'; question.textContent = item.question;
    const icon = node('span', '+'); icon.setAttribute('aria-hidden', 'true'); question.append(icon);
    if (!answer) { answer = node('p', undefined, 'ah-faq-answer'); row.append(answer); } answer.textContent = item.answer;
    let contact = row.querySelector('.ah-faq-contact');
    if (item.contactEmail) {
      if (!contact) { contact = node('p', undefined, 'ah-faq-contact'); row.append(contact); }
      if (contact.dataset.email !== item.contactEmail) {
        contact.dataset.email = item.contactEmail; contact.replaceChildren();
        const link = node('a', item.contactEmail); link.href = 'mailto:' + encodeURIComponent(item.contactEmail).replaceAll('%40', '@');
        const copy = node('button', '复制邮箱', 'ah-faq-copy'); copy.type = 'button'; copy.dataset.faqCopyEmail = item.contactEmail;
        const status = node('span', '', 'ah-faq-copy-status'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
        contact.append(link, copy, status);
      }
    } else contact?.remove();
    output.append(row);
  }
  for (const row of saved.values()) row.remove();
  const sameQuestion = [...output.children].find(row => row.dataset.faqId === focusId)?.querySelector('summary');
  if (hadFocus) (focused?.isConnected ? focused : sameQuestion ?? output.querySelector('summary'))?.focus({ preventScroll: true });
}
if (typeof document !== 'undefined') {
  document.addEventListener('artdico:registration-ready', event => {
    currentPrivacy = event.detail?.privacy ?? currentPrivacy;
    currentAvailability = { message: '可以提交参会申请。申请收到后需由主办方人工审核；待审核不占参会名额。审核通过并确认名额后再发送正式邀请。' }; renderFaqs();
  });
  document.addEventListener('artdico:registration-policy', event => { currentPrivacy = event.detail?.privacy ?? currentPrivacy; renderFaqs(); });
  document.addEventListener('artdico:registration-unavailable', event => {
    currentAvailability = { message: line(event.detail?.message, 4000) ? event.detail.message : '申请服务暂时无法核对，请稍后再试。' }; renderFaqs();
  });
  document.addEventListener('click', async event => {
    const button = event.target instanceof Element ? event.target.closest('[data-faq-copy-email]') : null;
    if (!(button instanceof HTMLButtonElement) || !button.closest('[data-public-faq]')) return;
    const email = button.dataset.faqCopyEmail, status = button.parentElement.querySelector('[role=status]');
    if (!mailbox(email)) return;
    try { await navigator.clipboard.writeText(email); if (button.isConnected && button.dataset.faqCopyEmail === email) status.textContent = '邮箱已复制'; }
    catch { if (button.isConnected && button.dataset.faqCopyEmail === email) status.textContent = '请手动复制 ' + email; }
  });
  renderFaqs();
}
