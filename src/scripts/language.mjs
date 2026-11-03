import { LANGUAGE_KEY, resolveLanguage, SUPPORTED_LANGUAGES } from '../i18n/language.mjs';
import { translate } from '../i18n/translate.mjs';

const root = document.getElementById('artdico-host');
if (root) {
  let saved;
  try { saved=localStorage.getItem(LANGUAGE_KEY); } catch { /* Storage can be disabled in private browsers. */ }
  let language=resolveLanguage(saved,navigator.languages?.length?navigator.languages:[navigator.language]);
  const sources=new WeakMap();
  const attributes=['aria-label','aria-roledescription','alt','title','placeholder','content'];
  const excluded='script,style,pre,code,textarea,input,[contenteditable],[data-language-switch],[data-i18n-preserve],.ah-guest-name,.ah-guest-initial,.ah-guest-detail-name,.ah-guest-affiliation,.ah-guest-company,.ah-guest-title,.ah-guest-role,.ah-guest-subtitle,.ah-guest-bio,.ah-organization-card h3,[data-showcase-id] h3,[data-application-recovery-person]';
  // Keep source and last display separately so a publication/recovery update
  // supersedes the old source, and switching back never restores stale text.
  function display(target,key,current,write) {
    if(target instanceof Element&&target.matches('.ah-organization-card')&&['title','aria-label'].includes(key)&&current===target.getAttribute('title'))return;
    const record=sources.get(target)??new Map(), previous=record.get(key);
    const source=previous&&previous.display===current?previous.source:current;
    const next=translate(source,language);
    record.set(key,{source,display:next});sources.set(target,record);
    if(next!==current)write(next);
  }
  function scan(node) {
    if(!node)return;
    if(node.nodeType===Node.TEXT_NODE){
      if(!node.parentElement?.closest(excluded))display(node,'text',node.data,value=>{node.data=value;});
      return;
    }
    if(!(node instanceof Element)||node.matches(excluded))return;
    for(const attr of attributes)if(node.hasAttribute(attr))display(node,attr,node.getAttribute(attr),value=>node.setAttribute(attr,value));
    for(const child of node.childNodes)scan(child);
  }
  const observer=new MutationObserver(records=>{
    observer.disconnect();
    for(const record of records){
      if(record.type==='childList')for(const node of record.addedNodes)scan(node);
      else if(record.type==='characterData')scan(record.target);
      else if(record.type==='attributes')scan(record.target);
    }
    observe();
  });
  function observe(){
    observer.observe(root,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:attributes});
    observer.observe(document.head,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['content']});
  }
  function apply(){
    observer.disconnect();
    document.documentElement.lang=language;
    scan(root);scan(document.head);scan(document.querySelector('.ah-skip-link'));
    document.querySelector('meta[property="og:locale"]')?.setAttribute('content',language==='en'?'en_US':'zh_CN');
    for(const button of root.querySelectorAll('[data-language]'))button.setAttribute('aria-pressed',String(button.dataset.language===language));
    root.querySelector('[data-language-switch]')?.removeAttribute('hidden');
    const notice=root.querySelector('[data-language-note]');if(notice)notice.hidden=language!=='en';
    observe();
  }
  root.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-language]');
    if(!button||!SUPPORTED_LANGUAGES.includes(button.dataset.language))return;
    language=button.dataset.language;
    saved=language;
    try{localStorage.setItem(LANGUAGE_KEY,language);}catch{/* The choice still applies for this visit. */}
    apply();
    document.dispatchEvent(new CustomEvent('artdico:language-changed',{detail:{language}}));
  });
  window.addEventListener('languagechange',()=>{
    if(SUPPORTED_LANGUAGES.includes(saved))return;
    try{if(SUPPORTED_LANGUAGES.includes(localStorage.getItem(LANGUAGE_KEY)))return;}catch{}
    language=resolveLanguage(null,navigator.languages);apply();
  });
  apply();
}
