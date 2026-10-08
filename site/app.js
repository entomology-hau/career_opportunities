'use strict';
const TYPES = {job:'Paid job',phd:'PhD',mres:'MRes',internship:'Internship',volunteering:'Volunteering',other:'Other opportunity'};
const COURSES = {entomology:'Entomology',ipm:'Integrated Pest Management','biological-recording':'Biological Recording'};
const PAGE_SIZES = [10,20,30,40,50];
let currentPage = 1;
let database, sourceData, healthData;
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : '#'; } catch { return '#'; } };
const day = 86400000;
const dateText = value => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length === 10 ? value+'T12:00:00Z' : value));
const ageDays = (date,now) => (now - new Date(date+'T00:00:00Z').getTime()) / day;
function initTheme(){
  let theme='light';
  try{if(localStorage.getItem('entomology-theme')==='dark')theme='dark';}catch{}
  const apply=value=>{document.documentElement.dataset.theme=value;$('theme-toggle').setAttribute('aria-pressed',String(value==='dark'));document.querySelector('meta[name="theme-color"]').content=value==='dark'?'#253750':'#eaf1fa';};
  apply(theme);
  $('theme-toggle').addEventListener('click',()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(theme);try{localStorage.setItem('entomology-theme',theme);}catch{}});
}
function active(item, now=Date.now()) {
  return ['approved','automatic'].includes(item.reviewStatus) && !['closed','withdrawn','expired'].includes(item.status) && ageDays(item.lastSeen||item.lastChecked,now) <= 30 && (!item.deadlineAt || new Date(item.deadlineAt).getTime() > now);
}
const countrySupplied=item=>Boolean(detailValue(item.country));
function locationMatch(item, value) {
  const specified=countrySupplied(item);
  return value === 'all' || (value === 'uk' && (!specified || item.country === 'United Kingdom')) || (value === 'international' && specified && item.country !== 'United Kingdom') || (value === 'remote' && /remote|hybrid/i.test(item.workplace||''));
}
function selectedTypes(){return [...document.querySelectorAll('[name=type]:checked')].map(x=>x.value)}
function getState(){return {q:$('search').value.trim().toLowerCase(),course:$('course').value,relevance:$('relevance').value,types:selectedTypes(),subject:$('subject').value,location:$('location').value,source:$('source').value,closing:$('closing').checked,sort:$('sort').value,pageSize:Number($('page-size').value)}}
function matches(item,state,now){
  const words=state.q.split(/\s+/).filter(Boolean);
  const text=[item.title,item.organisation,item.summary,item.location,item.country,item.compensation,item.fitReason||'',item.searchKeywords?.join(' ')||'',...(item.courses||[]).map(c=>COURSES[c]),...(item.tags||[]),...(item.subjects||[])].join(' ').toLowerCase();
  return active(item,now) && words.every(w=>text.includes(w)) && (!state.types.length || [item.type,...(item.secondaryTypes||[])].some(t=>state.types.includes(t))) && (!state.subject || (item.subjects||[]).includes(state.subject)) && (!state.course || (item.courses||[]).includes(state.course)) && (!state.relevance || item.relevanceTier===state.relevance) && locationMatch(item,state.location) && (!state.source || item.source===state.source) && (!state.closing || (item.deadlineAt && new Date(item.deadlineAt).getTime() <= now+14*day));
}
function paginate(items,page=1,pageSize=10){
  const size=PAGE_SIZES.includes(Number(pageSize))?Number(pageSize):10;
  const total=items.length,pages=Math.max(1,Math.ceil(total/size));
  const selected=Math.min(pages,Math.max(1,Number.isSafeInteger(Number(page))?Number(page):1));
  const start=(selected-1)*size;
  return {items:items.slice(start,start+size),page:selected,pages,pageSize:size,total,start:total?start+1:0,end:Math.min(start+size,total)};
}
const missingValue=/^(?:not (?:supplied|provided|given|stated|specified|extracted|available|advertised|known|checked|confirmed|disclosed|listed)|unknown\b|unspecified\b|unavailable\b|tbc\b|tbd\b|to be (?:confirmed|announced)|check (?:the )?(?:(?:original|main|source) )?advert|see (?:the )?(?:(?:original|main|source) )?advert|source details\b|details not (?:supplied|provided|extracted)|(?:full |further )?details (?:on|in|at|from) (?:the )?(?:original|main|source) advert)/i;
function detailValue(value){
  if(typeof value!=='string')return '';
  const text=value.trim(),withoutField=text.replace(/^(?:location|country|organisation|organization|employer|deadline|closing date|salary|pay|funding(?:\s*\/\s*fees)?|eligibility|opportunity type)\s*[:—–-]?\s*/i,'');
  return !text||/^(?:[-—–]|n\/a)$/i.test(text)||missingValue.test(text)||missingValue.test(withoutField)?'':text;
}
function advertCaveats(item){
  const missing=[];
  if(!validDate(item.deadline)&&!validDate(item.deadlineAt)&&!detailValue(item.deadlineLabel))missing.push('closing date');
  else if(/ongoing|rolling|year[- ]round|no fixed deadline/i.test(detailValue(item.deadlineLabel)))missing.push('current availability');
  if(!detailValue(item.location)&&!detailValue(item.country)&&!/remote|home[- ]based/i.test(detailValue(item.workplace)))missing.push('location');
  if(!detailValue(item.organisation)&&!detailValue(item.employer)&&!detailValue(item.hostOrganisation))missing.push('employer / organisation');
  const compensation=detailValue(item.compensation);
  if(item.type==='job'&&!compensation&&!detailValue(item.salary)&&!detailValue(item.pay))missing.push('salary');
  else if(item.type==='job'&&/\bamount\s+(?:is\s+)?not\s+(?:stated|specified|supplied|provided|disclosed|given)\b/i.test(compensation))missing.push(/\brates?\b/i.test(compensation)?'pay rate':'salary amount');
  if(['phd','mres'].includes(item.type)&&!compensation&&!detailValue(item.funding)&&!detailValue(item.fees))missing.push('funding / fees');
  else if(['phd','mres'].includes(item.type)&&/\b(?:amount|stipend)\s+(?:is\s+)?not\s+(?:stated|specified|supplied|provided|disclosed|given)\b/i.test(compensation))missing.push(/\bstipend\b/i.test(compensation)?'stipend amount':'funding amount');
  if(item.type==='internship'&&!compensation&&!detailValue(item.pay)&&!detailValue(item.salary))missing.push('pay');
  else if(item.type==='internship'&&/\bamount\s+(?:is\s+)?not\s+(?:stated|specified|supplied|provided|disclosed|given)\b/i.test(compensation))missing.push('pay amount');
  if(!detailValue(item.eligibility))missing.push('eligibility');
  else{
    if(/\bvisa sponsorship\b[^.;]{0,45}\bnot\s+(?:stated|specified|supplied|provided|disclosed|given)\b/i.test(item.eligibility))missing.push('visa sponsorship');
    if(/\bvisa eligibility\b[^.;]{0,45}\bnot\s+(?:stated|specified|supplied|provided|disclosed|given)\b/i.test(item.eligibility))missing.push('visa eligibility');
  }
  if(!TYPES[item.type]||item.type==='other')missing.push('opportunity type');
  if(item.reviewStatus==='automatic'&&(item.relevanceTier==='Related field'||item.relevanceStrength==='needs-context'))missing.push('relevance to your interests');
  return missing;
}
function caveatText(fields){return fields.length>1?fields.slice(0,-1).join(', ')+' and '+fields.at(-1):fields[0]||'';}
function reportURL(item){
  const url=new URL('https://github.com/entomology-hau/career_opportunities/issues/new');
  const id=String(item.id||'').replace(/[\r\n]/g,' ');
  url.search=new URLSearchParams({title:`[Advert report] ${item.title||'Opportunity'}`,body:`Advert ID: ${id}\nAdvert URL: ${safeURL(item.url)}\n\nReason (tick one):\n- [ ] Irrelevant\n- [ ] Closed/expired\n- [ ] Incorrect details\n- [ ] Other\n\nDetails:\n`}).toString();
  return url.href;
}
function formatDeadline(item,now=Date.now()){
  const label=detailValue(item.deadlineLabel);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(item.deadline||'')||!validDate(item.deadline))return label||'Deadline not supplied';
  const clock=/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.deadlineTime||'')?item.deadlineTime:'';
  let notes=label.replace(/^(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})\s*/,'').replace(/^[,;·]\s*/,'').trim();
  if(clock)notes=notes.replace(/^(?:at\s+)?(?:\d{1,2}:\d{2}(?:\s*(?:[ap]\.?m\.?|noon|midnight))?|\d{1,2}\s*(?:noon|midnight|[ap]\.?m\.?)|noon|midnight)\s*/i,'').replace(/^[,;·]\s*/,'').trim();
  let text=dateText(item.deadline)+(clock?', '+clock:'');
  if(notes)text+=(/^(?:UK time|local time|UTC|GMT|BST|CET|CEST|EET|EEST|EST|EDT|PST|PDT)\b/i.test(notes)?' ':' · ')+notes;
  const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  if(item.deadline===localToday)text+=' · closes today';
  return text;
}
function renderCard(item,now){
  const automatic=item.reviewStatus==='automatic',type=TYPES[item.type]?item.type:'other';
  const caveats=advertCaveats(item);
  const deadline=formatDeadline(item,now);
  const remaining=item.deadlineAt ? new Date(item.deadlineAt)-now : null;
  const urgent=remaining!==null && remaining<=7*day;
  const linkNeedsCheck=healthData?.links?.some(x=>x.id===item.id && x.status==='needs-check');
  const contentChanged=healthData?.links?.some(x=>x.id===item.id && x.contentChanged===true);
  const pay=automatic?detailValue(item.compensation):item.compensation,eligibility=automatic?detailValue(item.eligibility):item.eligibility;
  const location=detailValue(item.location)||'Location not supplied — check advert',workplace=detailValue(item.workplace);
  const details=[['Pay / funding',pay],['Eligibility',eligibility],[automatic?'Course interest (keyword match)':'Course interest',(item.courses||[]).map(c=>COURSES[c]).join(' · ')],['Experience',detailValue(item.careerLevel)],['Contract',detailValue(item.contract)],['Deadline',deadline],['Type',item.classificationInferred?'Type inferred from source':null],['Note',item.notes]].filter(x=>x[1]);
  const sourceDates=[!automatic&&validDate(item.lastChecked)?`Reviewed ${dateText(item.lastChecked)}`:null,automatic&&validDate(item.firstSeen)?`Collected ${dateText(item.firstSeen)}`:null,validDate(item.lastSeen)?`Listed at source ${dateText(item.lastSeen)}`:null].filter(Boolean);
  return `<article class="card" data-id="${escapeHTML(item.id)}"><div class="card-top"><div class="badge-stack"><span class="badge ${escapeHTML(type)}">${TYPES[type]}</span>${item.relevanceTier==='Related field'?'<span class="badge related">Related field</span>':''}</div><span class="deadline ${urgent?'urgent':''}">${escapeHTML(deadline)}</span></div>${automatic?'<p class="automatic-note">Automatic source match</p>':''}<h3><a href="${escapeHTML(safeURL(item.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a></h3>${detailValue(item.organisation)?`<p class="organisation">${escapeHTML(item.organisation)}</p>`:''}<p class="location-line">${escapeHTML(location)}${workplace?` · ${escapeHTML(workplace)}`:''}</p>${linkNeedsCheck?'<p class="link-warning">Link needs checking · last source request was unsuccessful</p>':''}${contentChanged?'<p class="link-warning">Source page changed · confirm the current details</p>':''}${pay?`<p class="funding-line">${escapeHTML(pay)}</p>`:''}${item.summary?`<p class="summary">${escapeHTML(item.summary)}</p>`:''}${item.fitReason?`<p class="fit-reason"><strong>Relevance:</strong> ${escapeHTML(item.fitReason)}</p>`:''}${caveats.length?`<p class="advert-caveat"><strong>Check main advert for</strong> ${escapeHTML(caveatText(caveats))}.</p>`:''}<div class="tags">${(item.tags||[]).slice(0,4).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('')}</div><details class="details"><summary>${automatic?'Source details':'Eligibility &amp; details'}${/Experienced|Specialist|Professional|experience required/.test(item.careerLevel||'')?' · experience required':''}</summary>${automatic?'<p class="source-details-note">Subject and course filters indicate keyword matches. Follow the main advert before applying.</p>':''}<dl>${details.map(([k,v])=>`<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join('')}</dl></details><div class="card-bottom"><div class="source-meta">Via ${escapeHTML(item.source)}${sourceDates.map(date=>`<br>${escapeHTML(date)}`).join('')}</div><div class="card-actions"><a class="advert-link" href="${escapeHTML(safeURL(item.url))}" target="_blank" rel="noopener noreferrer" aria-label="View advert: ${escapeHTML(item.title)} (opens in a new tab)">View advert</a><a class="report-link" href="${escapeHTML(reportURL(item))}" target="_blank" rel="noopener noreferrer" aria-label="Report advert: ${escapeHTML(item.title)} (opens GitHub; sign-in required)">Report advert</a><span class="report-hint">GitHub sign-in required</span></div></div></article>`;
}
const isCollector=source=>source.enabled===true && ['rss','res-headings'].includes(source.mode);
const validDate=value=>typeof value==='string' && Number.isFinite(Date.parse(value));
const checkStale=(value,now)=>!validDate(value) || now-Date.parse(value)>2*day;
function collectionSummary(health,sources=[],now=Date.now()){
  const enabled=sources.filter(isCollector),checks=health?.sources||[];
  if(!health || !validDate(health.lastRun))return {warning:true,text:'Source-check status is unavailable. Browse the original sources for current adverts.'};
  const working=enabled.filter(s=>checks.some(c=>c.id===s.id && c.status==='ok')).length;
  let text=`${working} of ${enabled.length} collectors working at the last check (${dateText(health.lastRun)}).`;
  if(Number.isSafeInteger(health.autoPublished)&&health.autoPublished>=0)text+=` ${health.autoPublished} automatic ${health.autoPublished===1?'listing':'listings'} on the board.`;
  if(Number.isSafeInteger(health.newPublished)&&health.newPublished>=0)text+=` ${health.newPublished} new ${health.newPublished===1?'listing added':'listings added'} this check.`;
  const stale=checkStale(health.lastRun,now),failed=enabled.length>0&&working===0,partial=working<enabled.length;
  if(stale)text+=' Source checks are over 48 hours old; browse the sources for newer adverts.';
  else if(failed)text+=' Automatic discovery is unavailable; browse the sources directly.';
  else if(partial)text+=' Some sources could not be collected; browse them directly.';
  else if(!enabled.length)text+=' New opportunities are found through assisted searches.';
  return {warning:stale||partial||['partial','failed'].includes(health.discoveryStatus),text};
}
function sourceCheckSummary(source,health,now=Date.now()){
  if(!isCollector(source))return {warning:false,text:'Assisted search · browse this source directly'};
  const kind=source.mode==='rss'?'Automated feed':'Automated index';
  const check=health?.sources?.find(c=>c.id===source.id);
  if(!check || !validDate(check.lastAttempt))return {warning:true,text:`${kind} · awaiting a source check`};
  const date=dateText(check.lastAttempt);
  if(check.status!=='ok')return {warning:true,text:`${kind} · collection needs checking (${date}); browse directly`};
  if(checkStale(check.lastAttempt,now))return {warning:true,text:`${kind} · last check ${date}; over 48 hours old`};
  const entries=Number.isSafeInteger(check.entriesFound)&&check.entriesFound>=0?` · ${check.entriesFound} entries checked`:'';
  return {warning:false,text:`${kind}${entries} · checked ${date}`};
}
function renderHealth(now=Date.now()){
  const summary=collectionSummary(healthData,sourceData?.sources,now);
  if($('collection-summary').textContent!==summary.text)$('collection-summary').textContent=summary.text;
  $('collection-status').classList.toggle('warning',summary.warning);
  $('check-status').textContent=healthData&&validDate(healthData.lastRun)?`${summary.text} Source-listed matches appear automatically with caveats for missing information or broader relevance. Editorial review dates remain separate.`:'Automated source-check status is unavailable. Collection and editorial dates are shown on each advert.';
}
function persistState(state){
  const params=new URLSearchParams();
  if(state.q)params.set('q',state.q);if(state.types.length)params.set('type',state.types.join(','));if(state.subject)params.set('subject',state.subject);if(state.relevance)params.set('relevance',state.relevance);if(state.location!=='uk')params.set('location',state.location);if(state.source)params.set('source',state.source);if(state.closing)params.set('closing','1');if(state.sort!=='deadline')params.set('sort',state.sort);
  if(state.course)params.set('course',state.course);if(state.pageSize!==10)params.set('page-size',String(state.pageSize));if(currentPage>1)params.set('page',String(currentPage));
  const query=params.toString();try{history.replaceState(null,'',location.pathname+(query?'?'+query:'')+location.hash);}catch{}
}
function render(){
  if(!database)return;
  const now=Date.now(),state=getState(),all=database.opportunities.filter(x=>active(x,now));
  const filtered=database.opportunities.filter(x=>matches(x,state,now));
  filtered.sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title):state.sort==='newest'?(b.lastSeen||b.lastChecked||b.firstSeen||'').localeCompare(a.lastSeen||a.lastChecked||a.firstSeen||'')||a.title.localeCompare(b.title):((a.deadlineAt?Date.parse(a.deadlineAt):Infinity)-(b.deadlineAt?Date.parse(b.deadlineAt):Infinity))||a.title.localeCompare(b.title));
  const page=paginate(filtered,currentPage,state.pageSize);currentPage=page.page;
  $('cards').innerHTML=page.items.map(x=>renderCard(x,now)).join('');$('empty').hidden=filtered.length>0;
  $('result-count').textContent=`${filtered.length?`Showing ${page.start}–${page.end} of `:''}${filtered.length} ${filtered.length===1?'opportunity':'opportunities'}${state.location==='uk'?' in the UK or with location unspecified':state.location==='international'?' outside the UK':state.location==='remote'?' with remote or hybrid work':''}`;
  $('pagination').hidden=page.pages<=1;$('previous-page').disabled=currentPage===1;$('next-page').disabled=currentPage===page.pages;$('page-info').textContent=`Page ${currentPage} of ${page.pages}`;
  const countDescription=`${filtered.length} matching ${filtered.length===1?'opportunity':'opportunities'} of ${all.length} total`;
  $('total-count').textContent=filtered.length;$('total-count').title=countDescription;$('total-count').setAttribute('aria-label',countDescription);
  for(const [type]of Object.entries(TYPES)){$('count-'+type).textContent=all.filter(x=>locationMatch(x,state.location)&&[x.type,...(x.secondaryTypes||[])].includes(type)).length;}
  const lastReview=database.opportunities.filter(x=>x.reviewStatus==='approved').map(x=>x.lastChecked).filter(validDate).sort().at(-1),lastCollection=database.opportunities.map(x=>x.lastSeen).filter(validDate).sort().at(-1);
  $('freshness').textContent=lastCollection?`Most recent collection: ${dateText(lastCollection)}.${lastReview?` Latest editorial review: ${dateText(lastReview)}.`:''} Check the original advert before applying.`:lastReview?`Most recent editorial review: ${dateText(lastReview)}. ${ageDays(lastReview,now)>7?'Some listings may need rechecking.':'Check the advert before applying.'}`:'No collection dates are available yet. Check the original adverts for current details.';
  $('freshness').classList.toggle('stale',!(lastCollection||lastReview)||ageDays(lastCollection||lastReview,now)>7);
  renderHealth(now);
  persistState(state);
}
function filtersChanged(){currentPage=1;render();}
function changePage(offset){currentPage+=offset;render();$('results').focus({preventScroll:true});$('results').scrollIntoView({block:'start'});}
function reset(){ $('search').value='';document.querySelectorAll('[name=type]').forEach(x=>x.checked=false);$('subject').value='';$('course').value='';$('relevance').value='';$('location').value='all';$('source').value='';$('closing').checked=false;$('sort').value='deadline';filtersChanged(); }
function restore(){
  const p=new URLSearchParams(location.search);$('search').value=p.get('q')||'';
  for(const el of document.querySelectorAll('[name=type]'))el.checked=(p.get('type')||'').split(',').includes(el.value);
  for(const id of ['subject','location','source','sort','relevance','course','page-size'])if(p.has(id)&&[...$(id).options].some(x=>x.value===p.get(id)))$(id).value=p.get(id);
  $('closing').checked=p.get('closing')==='1';
  const page=Number(p.get('page'));currentPage=Number.isSafeInteger(page)&&page>0?page:1;
}
function renderSources(){
  $('source-cards').innerHTML=sourceData.sources.filter(s=>s.showOnBoard!==false).map(s=>{const check=sourceCheckSummary(s,healthData);return `<article class="source-card"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.description)}</p><a href="${escapeHTML(safeURL(s.searchUrl||s.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.linkLabel||`Search ${s.shortName||s.name}`)}</a>${s.searches?.length?`<div class="source-searches">${s.searches.map(x=>`<a href="${escapeHTML(safeURL(x.url))}" target="_blank" rel="noopener noreferrer">${escapeHTML(x.label)}</a>`).join('')}</div>`:''}<span class="source-mode">${escapeHTML(s.label)}</span><span class="source-check ${check.warning?'warning':''}">${escapeHTML(check.text)}</span></article>`;}).join('');
  $('keyword-groups').innerHTML=sourceData.keywordGroups.map(g=>`<div class="keyword-group"><h3>${escapeHTML(g.name)}</h3><p>${g.terms.map(escapeHTML).join(' · ')}</p>${g.usefulness?`<p class="keyword-assessment">${escapeHTML(g.usefulness)}</p>`:''}</div>`).join('');
}
async function load(){
  initTheme();
  try{ const responses=await Promise.all([fetch('data/opportunities.json'),fetch('data/sources.json')]);if(responses.some(x=>!x.ok))throw Error('Data request failed');[database,sourceData]=await Promise.all(responses.map(x=>x.json()));
    $('type-filters').innerHTML=Object.entries(TYPES).map(([key,label])=>`<label class="checkbox-row"><input name="type" type="checkbox" value="${key}"><span>${label}</span><span class="count" id="count-${key}">0</span></label>`).join('');
    for(const name of sourceData.keywordGroups.map(x=>x.name))$('subject').add(new Option(name,name));
    for(const name of [...new Set(database.opportunities.map(x=>x.source))].sort())$('source').add(new Option(name,name));
    renderSources();restore();render();
    $('search').addEventListener('input',filtersChanged);for(const el of document.querySelectorAll('select,input[type=checkbox]'))el.addEventListener('change',filtersChanged);
    $('previous-page').addEventListener('click',()=>changePage(-1));$('next-page').addEventListener('click',()=>changePage(1));
    $('reset').addEventListener('click',reset);$('empty-reset').addEventListener('click',reset);$('board-tab').addEventListener('click',()=>{$('results').focus();$('results').scrollIntoView({block:'start'});});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();renderSources();}});setInterval(()=>{render();renderSources();},60000);
    try{const response=await fetch('data/health.json');if(!response.ok)throw Error();healthData=await response.json();render();renderSources();}catch{healthData=null;renderHealth();renderSources();}
  }catch(error){$('load-error').hidden=false;$('result-count').textContent='Opportunities unavailable';$('cards').innerHTML='';$('freshness').textContent='';if(sourceData)renderSources();}
}
load();
