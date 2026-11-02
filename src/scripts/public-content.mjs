import { publicGuestCards, publicGuestAffiliation, publicGuestSubtitle, publicGuestSessions } from '../../shared/guest-display.mjs';
import { GUEST_PUBLIC_ROLE_LABELS } from '../../shared/content-schema.mjs';
import { publicShowcaseCards, SHOWCASE_KIND_LABELS } from '../../shared/showcase-display.mjs';
import { resolvePublicContentSource } from '../../shared/public-content-source.mjs';
import { publicOrganizationCards, orderOrganizationCards, organizationReferenceKey, organizationLogoVariant } from '../../shared/organization-display.mjs';
import { PUBLIC_CONTACT_EMAIL } from '../config/event.mjs';
import { organizationArtwork } from '../config/organization-artwork.mjs';
import { createDefaultOrganizations } from '../config/exhibiting-partners.mjs';
import { eventTimeInstant } from '../lib/event-presentation.mjs';
import { createPublicContentRefresh } from '../lib/public-content-refresh.mjs';
import { createHomeCollections } from '../lib/home-collections.mjs';
import { setPublicFaqs } from '../lib/public-faq.mjs';

let displayedContent=null,workCards=[];
const collections=createHomeCollections();
const organizationMobile=typeof matchMedia==='function'?matchMedia('(max-width: 820px)'):null;
let organizationPage=0,organizationPageAnchor=null,organizationMobileApplied=null;
const organizationPatterns={
  1:[[50,50,40]],2:[[30,50,36],[70,50,36]],
  3:[[50,24,40],[30,60,36],[70,60,36]],
  4:[[30,34,36],[70,34,36],[30,66,36],[70,66,36]],
  5:[[50,20,40],[30,44,36],[70,44,36],[30,68,36],[70,68,36]],
  6:[[30,28,36],[70,28,36],[30,50,36],[70,50,36],[30,72,36],[70,72,36]],
  7:[[50,14,40],[30,34,36],[70,34,36],[30,53,36],[70,53,36],[30,72,36],[70,72,36]],
  8:[[50,14,40],[30,32,36],[70,32,36],[30,50,36],[70,50,36],[30,68,36],[70,68,36],[50,86,40]],
};
function updateOrganizationLayout({id=null,page=null}={}){
  const list=document.querySelector('[data-public-organizations]');if(!list)return;
  const rows=[...list.querySelectorAll('[data-organization-id]')],mobile=Boolean(organizationMobile?.matches);organizationMobileApplied=mobile;
  const requested=id?rows.findIndex(row=>row.id===id||row.dataset.organizationId===id):-1;
  if(requested>=0)organizationPage=Math.floor(requested/8);
  else if(page!==null)organizationPage=page;
  else if(organizationPageAnchor){const index=rows.findIndex(row=>row.dataset.organizationId===organizationPageAnchor);if(index>=0)organizationPage=Math.floor(index/8);}
  const pages=Math.max(1,Math.ceil(rows.length/8));organizationPage=Math.max(0,Math.min(pages-1,organizationPage));
  const current=rows.slice(organizationPage*8,organizationPage*8+8),pattern=organizationPatterns[current.length]??[];
  for(const row of rows)row.hidden=mobile&&!current.includes(row);
  current.forEach((row,index)=>{const [x,y,width]=pattern[index];row.style.setProperty('--ah-org-x',x+'%');row.style.setProperty('--ah-org-y',y+'%');row.style.setProperty('--ah-org-width',width+'%');});
  organizationPageAnchor=current[0]?.dataset.organizationId??null;
  const scene=list.closest('.ah-organizations-scene');if(scene)scene.dataset.organizationsReady='true';
  const navigation=document.querySelector('[data-organizations-pagination]'),previous=document.querySelector('[data-organizations-previous]'),next=document.querySelector('[data-organizations-next]');
  if(navigation)navigation.hidden=!mobile||rows.length<=8||list.hidden;
  if(previous)previous.disabled=organizationPage===0;if(next)next.disabled=organizationPage===pages-1;
  const label=document.querySelector('[data-organizations-page]');if(label)label.textContent=`${organizationPage+1} / ${pages}`;
  const active=document.activeElement;
  if(navigation?.contains(active)&&(navigation.hidden||active.disabled)){
    const available=[previous,next].find(button=>button&&!button.disabled&&!navigation.hidden);
    (available??document.getElementById('booths-heading'))?.focus({preventScroll:true});
  }
}
organizationMobile?.addEventListener('change',()=>updateOrganizationLayout({id:document.activeElement?.closest('[data-organization-id]')?.id}));
window.addEventListener('resize',()=>{if(organizationMobileApplied!==Boolean(organizationMobile?.matches))updateOrganizationLayout({id:document.activeElement?.closest('[data-organization-id]')?.id});},{passive:true});
document.querySelector('[data-organizations-previous]')?.addEventListener('click',()=>updateOrganizationLayout({page:organizationPage-1}));
document.querySelector('[data-organizations-next]')?.addEventListener('click',()=>updateOrganizationLayout({page:organizationPage+1}));
document.addEventListener('artdico:organization-reveal',event=>updateOrganizationLayout({id:event.detail?.id}));

const presentationSelectors={heroDescription:'[data-public-hero-description]',aboutTitle:'[data-public-about-title]',aboutText:'[data-public-about-text]'};
const initialPresentationText=new Map(Object.values(presentationSelectors).flatMap(selector=>[...document.querySelectorAll(selector)].map(node=>[node,node.textContent])));
// Keep the initial real-text lockup available when a later publication returns
// to the branded event. A changed title always renders its published text.
const initialPosterTitles=new Map([...document.querySelectorAll('h1[data-public-event-title]')].map(node=>[node,[...node.children].filter(child=>child.matches('.ah-home-title-art')).map(child=>child.cloneNode(true))]));

// Published event content is independent from registration readiness and staff cookies.
const endpoint = document.querySelector('meta[name="artdico-content-api"]')?.getAttribute('content');
if (endpoint) {
  const target = resolvePublicContentSource(endpoint, location.origin);
  if (target) {
    createPublicContentRefresh({url:target,onContent:snapshot=>{renderPublishedContent(snapshot.content,target);displayedContent=snapshot.content;},onState:state=>{
      const notice=document.querySelector('[data-public-content-status]');
      if(state.status==='missing'){
        renderOrganizations(defaultOrganizationCards(),target,{initial:true});
        if(notice)notice.textContent='尚未发布活动安排，以下显示网站初始设置。';
      }else if(state.status==='unavailable'){
        if(!state.current)organizationsUnavailable();
        if(notice)notice.textContent=state.current?'暂未取得最新安排，仍显示上次核对的发布版本。':'暂时无法读取已发布安排，以下显示网站初始日程。';
      }else if(state.status==='published'&&notice){notice.textContent=displayedContent?.event.status==='cancelled'?'本次活动已取消。':'讲者与主题陆续公布。';}
    }}).start();
  } else organizationsUnavailable();
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderPublishedContent(content,url) {
  const collectionState=displayedContent?collections.capture():null;
  workCards=Object.hasOwn(content,'showcases')?publicShowcaseCards(content.showcases):[];
  renderOrganizations(Object.hasOwn(content,'organizations')?publicOrganizationCards(content.organizations):defaultOrganizationCards(),url,{initial:!Object.hasOwn(content,'organizations')});
  const agenda = document.querySelector('[data-agenda]');
  // A published timetable replaces the static overview, so it never shows stale time blocks.
  const summary = agenda?.querySelector('[data-agenda-summary]');
  if (summary) summary.hidden = true;
  const fullProgram = agenda?.querySelector('[data-full-program]');
  if (fullProgram) fullProgram.open = true;
  // Published sessions do not define check-in/opening. Keep the confirmed countdown
  // only while its original date/timezone facts still match the published event.
  for (const hint of document.querySelectorAll('[data-public-static-hours], [data-public-static-checkin]')) {
    const sameCountdown = hint.matches('[data-event-countdown]')
      && hint.dataset.countdownSourceDate === content.event.date
      && hint.dataset.countdownSourceTimezone === content.event.timezone
      && content.event.dateStatus === 'confirmed' && content.event.status !== 'cancelled';
    hint.hidden = !sameCountdown;
  }
  const programTimezone = document.querySelector('[data-public-program-timezone]');
  if (programTimezone) programTimezone.textContent = ['Asia/Shanghai', 'Asia/Hong_Kong'].includes(content.event.timezone)
    ? '北京时间 · UTC+8' : '活动时区 · ' + content.event.timezone;
  for (const panel of agenda?.querySelectorAll('[data-agenda-panel]') ?? []) {
    const list = panel.querySelector('.ah-agenda-list');
    if (!list) continue;
    const rows = content.sessions.filter(item => item.zone === panel.dataset.agendaPanel && item.status !== 'draft').sort((a,b) => a.start.localeCompare(b.start));
    list.replaceChildren();
    for (const item of rows) {
      const row = element('article', undefined, 'ah-agenda-row');
      row.tabIndex=-1;
      if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/u.test(item.id)) row.id = 'program-' + item.id;
      row.dataset.agendaStart = item.start;
      row.classList.toggle('ah-featured', item.start === '15:30' || item.start === '16:30');
      row.append(element('time', item.start + '–' + item.end));
      const detail = element('div');
      detail.append(element('span', item.zone + ' 区', 'ah-session-category'), element('strong', item.title));
      if (item.status === 'cancelled') {
        row.dataset.sessionStatus = 'cancelled';
        detail.append(element('small', '本场已取消', 'ah-session-meta'));
      }
      row.append(detail);
      list.append(row);
    }
  }
  agenda?.dispatchEvent(new Event('artdico:content-updated'));
  const guestGrid = document.querySelector('[data-public-guests]');
  if (guestGrid) {
    const cards = publicGuestCards(content.guests, content.guestAttendance);
    guestGrid.replaceChildren();
    for (const guest of cards) {
      const card = element('li', undefined, 'ah-guest-card');
      card.id='guest-'+guest.id;card.dataset.guestId=guest.id;card.dataset.guestAttendance=guest.attendance;
      card.dataset.guestFloat='';
      const details=element('details',undefined,'ah-guest-details');
      const trigger=element('summary',undefined,'ah-guest-bubble');trigger.dataset.guestToggle='';trigger.dataset.focusKey='guest-toggle';
      const portrait = element('span', undefined, 'ah-guest-portrait');
      const initial = element('span', Array.from(guest.name)[0], 'ah-guest-initial');initial.setAttribute('aria-hidden','true');portrait.append(initial);
      if(guest.portraitUrl){
        const photo=element('img');photo.width=116;photo.height=116;photo.alt='';photo.loading='lazy';photo.decoding='async';
        photo.addEventListener('error',()=>{photo.hidden=true;});
        if(url.origin!==location.origin)photo.crossOrigin='anonymous';photo.referrerPolicy='no-referrer';photo.src=new URL(guest.portraitUrl,url.origin).href;portrait.append(photo);
      }
      const name=element('span',guest.name,'ah-guest-name');
      trigger.append(name,element('span','查看嘉宾','ah-guest-prompt ah-guest-prompt-closed'),element('span','收起简介','ah-guest-prompt ah-guest-prompt-open'));
      const subtitle=publicGuestSubtitle(guest);
      const affiliation=publicGuestAffiliation(guest);
      if(affiliation){const company=element('span',affiliation,'ah-guest-affiliation');company.dataset.affiliationSource='company';trigger.append(company);}
      if(subtitle.text){const caption=element('span',subtitle.text,'ah-guest-subtitle');caption.dataset.subtitleSource=subtitle.kind;trigger.append(caption);}
      trigger.setAttribute('aria-label',[guest.name,affiliation,subtitle.text,'嘉宾介绍'].filter(Boolean).join('，'));
      const body=element('div',undefined,'ah-guest-detail-body');
      body.setAttribute('role','region');body.setAttribute('aria-label',guest.name+'简介');
      body.append(portrait);
      body.append(element('h3',guest.name,'ah-guest-detail-name'));
      body.append(element('p',guest.publicRoles?.length?guest.publicRoles.map(role=>GUEST_PUBLIC_ROLE_LABELS[role]).join(' · '):'嘉宾','ah-guest-duty'));
      if(guest.company)body.append(element('p',guest.company,'ah-guest-company'));
      if(guest.title)body.append(element('p',guest.title,'ah-guest-title'));
      if(guest.ggjRole)body.append(element('p',guest.ggjRole,'ah-guest-role'));
      if(guest.bio)body.append(element('p',guest.bio,'ah-guest-bio'));
      const sessions=publicGuestSessions(content.sessions,guest.id);
      if(sessions.length){
        const list=element('ul');
        for(const session of sessions){const item=element('li'),link=element('a',session.start+'–'+session.end+' · '+session.zone+' 区 · '+session.title);link.href='#program-'+session.id;item.append(reveal(link));list.append(item);}
        body.append(list);
      }
      if(guest.website){const link=element('a','个人 / 机构网站');link.href=guest.website;link.target='_blank';link.rel='noopener noreferrer';body.append(link);}
      details.append(trigger,body);card.append(details);
      guestGrid.append(card);
    }
    const placeholders=cards.length?(4-cards.length%4)%4:0;
    for(let index=0;index<placeholders;index++){
      const decoration=element('li',undefined,'ah-guest-placeholder');decoration.setAttribute('aria-hidden','true');decoration.setAttribute('role','presentation');
      decoration.dataset.guestFloat='';
      decoration.append(element('span',undefined,'ah-guest-placeholder-circle'));guestGrid.append(decoration);
    }
    guestGrid.hidden = cards.length === 0;
    const emptyGuests = document.querySelector('[data-public-guests-empty]');
    if (emptyGuests) emptyGuests.hidden = cards.length > 0;
    guestGrid.dispatchEvent(new CustomEvent('artdico:guests-rendered',{bubbles:true}));
  }
  // The whole section is shown only for valid published work, including work
  // without a cover. Missing/empty lists do not create a waiting placeholder.
  renderShowcases(content,url);
  const dateText = content.event.date + (content.event.dateStatus === 'confirmed' ? '' : ' · 日期暂定');
  for (const node of document.querySelectorAll('[data-public-agenda-date]')) node.textContent = dateText;
  for (const node of document.querySelectorAll('[data-public-date-value]')) { node.textContent = content.event.date; node.setAttribute('datetime', content.event.date); }
  for (const node of document.querySelectorAll('[data-public-date-tentative]')) node.hidden = content.event.dateStatus === 'confirmed';
  for (const node of document.querySelectorAll('[data-public-date-label]')) node.textContent = content.event.dateStatus === 'confirmed' ? '活动日期已确认' : '活动日期暂定';
  // Keep the first brand written out when loading an older published event revision.
  const knownTitle = /^(\d{4}) (?:GGJ|GlobalGameJam) 中国交流聚会 × ARTDiCO HOST 学生嘉年华$/u.exec(content.event.title);
  const eventTitle = knownTitle ? `${knownTitle[1]} GlobalGameJam 中国交流聚会 × ARTDiCO HOST 学生嘉年华` : content.event.title;
  for (const node of document.querySelectorAll('[data-public-event-title]')) {
    if (node.tagName !== 'H1') { node.textContent = eventTitle; continue; }
    node.setAttribute('aria-label', eventTitle);
    if (eventTitle === (node.dataset.renderedEventTitle || node.dataset.initialEventTitle)) continue;
    node.dataset.renderedEventTitle = eventTitle;
    const poster=initialPosterTitles.get(node);
    if (knownTitle&&poster?.length) {
      node.replaceChildren(...poster.map(child=>child.cloneNode(true)));
      node.dataset.titlePresentation='poster';
      continue;
    }
    node.dataset.titlePresentation='text';
    const titles = eventTitle.split(' × ');
    if (titles.length === 2) {
      node.replaceChildren(
        element('span', titles[0], 'ah-event-title-line'),
        element('span', '×', 'ah-event-title-cross'),
        element('span', titles[1], 'ah-event-title-line'),
      );
    } else node.textContent = eventTitle;
  }
  for (const node of document.querySelectorAll('[data-public-hero-venue]')) node.textContent = content.event.venue;
  for (const node of document.querySelectorAll('[data-public-poster-date]')) {
    const [,month,day] = content.event.date.split('-');
    node.replaceChildren(document.createTextNode(month), element('br'), element('span', day));
  }
  for (const node of document.querySelectorAll('[data-public-artwork-date]')) {
    const [,month,day] = content.event.date.split('-');
    node.replaceChildren(element('span', month, 'ah-date-month'), element('span', '.', 'ah-date-dot'), element('span', day, 'ah-date-day'));
  }
  document.title = eventTitle + '｜活动安排';
  for (const node of document.querySelectorAll('[data-public-event-venue]')) node.textContent = content.event.venue + (content.event.venueStatus === 'confirmed' ? '' : '（暂定）');
  renderPresentation(content.event);
  const notice = document.querySelector('[data-public-content-status]');
  if (notice) notice.textContent = content.event.status === 'cancelled' ? '本次活动已取消。' : '讲者与主题陆续公布。';
  collections.restore(collectionState);
  document.dispatchEvent(new Event('artdico:public-content-updated'));
}

function defaultOrganizationCards() {
  return publicOrganizationCards(createDefaultOrganizations().map(({id,name,participation,website,status,publicConsent})=>({id,name,participation,website,status,publicConsent,logoUrl:''})));
}

function organizationsUnavailable() {
  const list=document.querySelector('[data-public-organizations]');
  if(list){list.replaceChildren();list.hidden=true;}
  updateOrganizationLayout();
  const message=document.querySelector('[data-public-organizations-empty]');
  if(message){message.textContent='暂时无法读取参与组织，请稍后重试。';message.hidden=false;}
}

function renderOrganizations(cards,url,{initial=false}={}) {
  const list=document.querySelector('[data-public-organizations]');if(!list)return;
  const focusedId=list.contains(document.activeElement)?document.activeElement.closest('[data-organization-id]')?.dataset.organizationId:null;
  list.replaceChildren();
  const referenceKeys=new Set();
  for(const organization of orderOrganizationCards(cards)){
    const item=element('li');item.dataset.organizationId=organization.id;item.id='organization-'+organization.id;
    const referenceKey=organizationReferenceKey(organization);if(referenceKey&&!referenceKeys.has(referenceKey)){item.dataset.organizationReference=referenceKey;referenceKeys.add(referenceKey);}
    const card=element(organization.website?'a':'div',undefined,'ah-organization-card');
    card.title=organization.name;card.setAttribute('aria-label',organization.name);if(!organization.website)card.setAttribute('role','group');
    if(organization.website){card.href=organization.website;card.target='_blank';card.rel='noopener noreferrer';card.referrerPolicy='no-referrer';card.setAttribute('aria-label',organization.name+' · 打开组织页面（新窗口）');}
    if(organization.logoUrl){
      const frame=element('div',undefined,'ah-organization-image'),logo=element('img');
      const variant=organizationLogoVariant(organization,organizationArtwork);let usingVariant=Boolean(variant);
      logo.width=240;logo.height=120;logo.alt=organization.name+'的组织图片';logo.loading='lazy';logo.decoding='async';
      item.dataset.logoArtwork=usingVariant?'reference':'published';
      logo.referrerPolicy='no-referrer';
      let renderedSource=null;
      const showName=()=>{frame.hidden=true;item.dataset.logoArtwork='published-name';};
      logo.addEventListener('load',()=>{
        if(!logo.isConnected)return;
        if(usingVariant)return;
        if(renderedSource){
          if(logo.getAttribute('src')===renderedSource){frame.dataset.logoPresentation='white';item.dataset.logoArtwork='published-white';}
          return;
        }
        const source=logo.getAttribute('src');
        try{
          const canvas=whiteOrganizationMask(logo);
          if(!canvas){showName();return;}
          // A bounded data URL is owned only by this image node. No blob URL or
          // persistent derivative exists to outlive a replaced publication.
          const result=canvas.toDataURL('image/png');
          if(!logo.isConnected||logo.getAttribute('src')!==source)return;
          renderedSource=result;logo.dataset.logoSource=source;logo.src=result;
        }catch{showName();}
      });
      const loadLogo=(path,origin)=>{renderedSource=null;frame.dataset.logoPresentation=usingVariant?'reference':'pending';if(origin!==location.origin)logo.crossOrigin='anonymous';else logo.removeAttribute('crossorigin');logo.src=new URL(path,origin).href;};
      logo.addEventListener('error',()=>{if(!logo.isConnected)return;if(usingVariant){usingVariant=false;item.dataset.logoArtwork='published-fallback';loadLogo(organization.logoUrl,url.origin);}else showName();});
      loadLogo(variant||organization.logoUrl,usingVariant?location.origin:url.origin);
      frame.append(logo);card.append(frame);
    }
    const name=element('h3',organization.name);
    card.append(name);
    item.append(card);list.append(item);
  }
  list.hidden=cards.length===0;
  updateOrganizationLayout({id:focusedId});
  const message=document.querySelector('[data-public-organizations-empty]');
  if(message){message.textContent=initial?'参与组织沿用网站初始名单。':'参与组织陆续公布。';message.hidden=cards.length>0&&!initial;}
}

/** A display-only white alpha mask. Uniform opaque backgrounds are removed
 * globally, including enclosed letter counters; complex images use the name.
 * Work stays bounded and synchronous, with no uploads, storage or animation. */
function whiteOrganizationMask(image){
  const scale=Math.min(1,800/Math.max(image.naturalWidth,image.naturalHeight));
  if(!Number.isFinite(scale)||scale<=0)return null;
  const canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});if(!context)return null;
  context.drawImage(image,0,0,canvas.width,canvas.height);
  const data=context.getImageData(0,0,canvas.width,canvas.height),pixels=data.data,total=canvas.width*canvas.height;
  let transparent=0,opaque=0,left=canvas.width,top=canvas.height,right=-1,bottom=-1;
  for(let index=0;index<pixels.length;index+=4){
    const alpha=pixels[index+3];if(alpha<224)transparent++;else opaque++;
    if(alpha<32)continue;
    const pixel=index/4,x=pixel%canvas.width,y=Math.floor(pixel/canvas.width);
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left||bottom<top)return null;
  let background=null;
  // A transparent outer margin does not make an opaque inner panel safe to
  // whiten. Inspect the occupied rectangle too, including enclosed counters.
  const occupiedArea=(right-left+1)*(bottom-top+1);
  if(transparent/total<.02||opaque/occupiedArea>.95){
    const border=[],step=Math.max(1,Math.ceil(Math.max(right-left+1,bottom-top+1)/128));
    const sample=(x,y)=>{const i=(y*canvas.width+x)*4;if(pixels[i+3]>=224)border.push([pixels[i],pixels[i+1],pixels[i+2]]);};
    for(let x=left;x<=right;x+=step){sample(x,top);sample(x,bottom);}
    for(let y=top;y<=bottom;y+=step){sample(left,y);sample(right,y);}
    if(border.length<4)return null;
    const median=channel=>border.map(color=>color[channel]).sort((a,b)=>a-b)[Math.floor(border.length/2)];
    background=[median(0),median(1),median(2)];
    if(border.filter(color=>Math.max(...color.map((value,index)=>Math.abs(value-background[index])))<=32).length/border.length<.9)return null;
  }
  let ink=0;
  for(let index=0;index<pixels.length;index+=4){
    if(background){
      const difference=Math.max(Math.abs(pixels[index]-background[0]),Math.abs(pixels[index+1]-background[1]),Math.abs(pixels[index+2]-background[2]));
      pixels[index+3]=Math.round(pixels[index+3]*Math.min(1,Math.max(0,(difference-12)/40)));
    }
    pixels[index]=pixels[index+1]=pixels[index+2]=255;
    if(pixels[index+3]>128)ink++;
  }
  if(!ink||ink/total>.92)return null;
  context.putImageData(data,0,0);return canvas;
}

function reveal(link){
  link.addEventListener('click',()=>collections.reveal(link.hash.slice(1)));
  return link;
}
function renderPresentation(event) {
  const contact=document.querySelector('[data-public-contact-email]');
  if(contact){contact.textContent='联络筹备团队 · '+PUBLIC_CONTACT_EMAIL;contact.href='mailto:'+PUBLIC_CONTACT_EMAIL;contact.hidden=false;}
  const presentation=event.presentation;
  if(!presentation||typeof presentation!=='object'){
    setPublicFaqs(null);
    for(const [node,text]of initialPresentationText)node.textContent=text;
    for(const node of document.querySelectorAll('[data-public-map]')){node.hidden=true;node.removeAttribute('href');}
    for(const node of document.querySelectorAll('[data-event-countdown],span[data-public-static-hours],[data-public-static-checkin]'))node.hidden=true;
    return;
  }
  for(const [field,selector]of Object.entries(presentationSelectors)){
    if(typeof presentation[field]==='string')for(const element of document.querySelectorAll(selector))element.textContent=presentation[field];
  }
  setPublicFaqs(presentation.faqItems);
  const map=document.querySelector('[data-public-map]');
  if(map){map.hidden=true;map.removeAttribute('href');try{const url=new URL(presentation.mapUrl);if(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash){map.href=url.href;map.hidden=false;}}catch{}}
  const start=eventTimeInstant(event.date,presentation.openingTime,event.timezone);
  const end=eventTimeInstant(event.date,presentation.endTime,event.timezone);
  const confirmed=event.dateStatus==='confirmed'&&event.status!=='cancelled'&&start!==null&&end!==null&&end>start;
  const countdown=document.querySelector('[data-event-countdown]');
  if(countdown){
    countdown.hidden=!confirmed;
    if(confirmed){countdown.dataset.startsAt=new Date(start).toISOString();countdown.dataset.endsAt=new Date(end).toISOString();const fallback=countdown.querySelector('[data-countdown-fallback]');if(fallback)fallback.textContent=event.date+' '+presentation.openingTime+' · '+event.timezone+' 开场';}
  }
  for(const hours of document.querySelectorAll('span[data-public-static-hours]')){hours.hidden=!confirmed;if(confirmed)hours.textContent=(hours.hasAttribute('data-home-hours')?'':' · ')+presentation.openingTime+'–'+presentation.endTime;}
  for(const checkin of document.querySelectorAll('[data-public-static-checkin]')){checkin.hidden=!confirmed;if(confirmed)checkin.textContent=presentation.checkInTime+' 开始签到 · ';}
}

function renderShowcases(content, sourceUrl) {
  const grid = document.querySelector('[data-public-showcases]');
  if (!grid) return;
  const cards=workCards,organizations=new Map(publicOrganizationCards(content.organizations).map(item=>[item.id,item]));
  const section=grid.closest('#students')??grid.closest('section'),hasWorks=cards.length>0;
  const redirectFocus=!hasWorks&&section?.contains(document.activeElement);
  if(!hasWorks){
    const dialog=section?.querySelector('[data-work-lightbox]');
    if(dialog?.open)dialog.close();
    dialog?.querySelector('img')?.removeAttribute('src');
  }
  const controls=document.querySelector('[data-public-works-controls]');if(controls)controls.hidden=!hasWorks;
  grid.replaceChildren();
  for (const work of cards) {
    const card = element('li', undefined, 'ah-showcase-card');
    card.id='work-'+work.id;card.dataset.showcaseId=work.id;card.dataset.workKind=work.kind;
    card.dataset.coverState=work.coverUrl?'available':'missing';
    const poster=element('div',undefined,'ah-showcase-poster');
    const fallback=element('p','作品图片尚未公布','ah-showcase-cover-empty');
    fallback.hidden=Boolean(work.coverUrl);
    if(work.coverUrl){
      const preview=element('button',undefined,'ah-work-preview');preview.type='button';preview.dataset.workPreview='';preview.dataset.focusKey='preview';preview.setAttribute('aria-label','查看'+work.title+'的作品大图');
      const photo = document.createElement('img');
      photo.width = 960; photo.height = 540;
      photo.alt = work.title + '的作品图';
      photo.loading = 'lazy'; photo.decoding = 'async';
      photo.referrerPolicy = 'no-referrer';
      if (sourceUrl.origin !== location.origin) photo.crossOrigin = 'anonymous';
      // Constructed from a content-addressed image ID, never a private materials link.
      photo.src = new URL(work.coverUrl, sourceUrl.origin).href;
      photo.addEventListener('error', () => { photo.hidden = true; fallback.hidden=false;preview.hidden=true;preview.disabled=true;card.dataset.coverState='unavailable';collections.updateWorks(); });
      preview.append(photo,element('span','查看大图 ↗'));poster.append(preview);
    }
    const caption=element('div',undefined,'ah-showcase-caption');
    caption.append(element('span',SHOWCASE_KIND_LABELS[work.kind],'ah-showcase-category'),element('h3',work.title),element('p',work.teamName,'ah-showcase-team'));
    poster.append(caption,fallback);card.append(poster);
    const detail = element('div', undefined, 'ah-showcase-card-body');
    if(work.responseStatus==='declined')detail.append(element('p','已回复不参加','ah-showcase-status'));
    const organization=organizations.get(work.organizationId);
    if(organization){const link=element('a',organization.name,'ah-showcase-organization');link.href='#organization-'+organization.id;detail.append(reveal(link));}
    if (work.summary) detail.append(element('p', work.summary));
    const arrangement = element('p',undefined,'ah-showcase-arrangement');
    const session = content.sessions.find(item => item.id === work.sessionId && item.status === 'scheduled');
    if (session && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(session.start)
      && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(session.end) && ['A', 'B', 'C'].includes(session.zone)) {
      const link=element('a','作品分享 · ' + session.start + '–' + session.end + ' · ' + session.zone + ' 区');link.href='#program-'+session.id;
      link.addEventListener('click',()=>{const agenda=document.querySelector('[data-agenda]'),period=agenda?.querySelector('[data-program-period]');if(period){period.value='all';period.dispatchEvent(new Event('change'));}agenda?.querySelector('[data-zone="'+session.zone+'"]')?.click();});arrangement.append(reveal(link));
    }
    if(arrangement.childElementCount)detail.append(arrangement);
    if(detail.childElementCount)card.append(detail);
    grid.append(card);
  }
  grid.hidden=!hasWorks;
  if(section)section.hidden=!hasWorks;
  collections.updateWorks();
  if(redirectFocus)collections.focusWorks();
}
