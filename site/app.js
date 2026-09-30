'use strict';
const TYPES = {job:'Paid job',phd:'PhD',mres:'MRes',internship:'Internship',volunteering:'Volunteering'};
const COURSES = {entomology:'Entomology',ipm:'Integrated Pest Management','biological-recording':'Biological Recording'};
const PAGE_SIZES = [10,20,30,40,50];
let currentPage = 1;
let database, sourceData, healthData;
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : '#'; } catch { return '#'; } };
const day = 86400000;
const dateText = value => new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length === 10 ? value+'T12:00:00Z' : value));
const ageDays = (date,now) => (now - new Date(date+'T00:00:00Z').getTime()) / day;
function initTheme(){
  let theme='light';
  try{if(localStorage.getItem('entomology-theme')==='dark')theme='dark';}catch{}
  const apply=value=>{document.documentElement.dataset.theme=value;$('theme-toggle').setAttribute('aria-pressed',String(value==='dark'));document.querySelector('meta[name="theme-color"]').content=value==='dark'?'#253750':'#eaf1fa';};
  apply(theme);
  $('theme-toggle').addEventListener('click',()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(theme);try{localStorage.setItem('entomology-theme',theme);}catch{}});
}
function active(item, now=Date.now()) {
  return item.reviewStatus === 'approved' && !['closed','withdrawn'].includes(item.status) && ageDays(item.lastChecked,now) <= 30 && (!item.deadlineAt || new Date(item.deadlineAt).getTime() > now);
}
function locationMatch(item, value) {
  return value === 'all' || (value === 'uk' && item.country === 'United Kingdom') || (value === 'international' && item.country !== 'United Kingdom') || (value === 'remote' && /remote|hybrid/i.test(item.workplace));
}
function selectedTypes(){return [...document.querySelectorAll('[name=type]:checked')].map(x=>x.value)}
function getState(){return {q:$('search').value.trim().toLowerCase(),course:$('course').value,relevance:$('relevance').value,types:selectedTypes(),subject:$('subject').value,location:$('location').value,source:$('source').value,closing:$('closing').checked,sort:$('sort').value,pageSize:Number($('page-size').value)}}
function matches(item,state,now){
  const words=state.q.split(/\s+/).filter(Boolean);
  const text=[item.title,item.organisation,item.summary,item.location,item.country,item.compensation,item.fitReason||'',item.searchKeywords?.join(' ')||'',...(item.courses||[]).map(c=>COURSES[c]),...item.tags,...item.subjects].join(' ').toLowerCase();
  return active(item,now) && words.every(w=>text.includes(w)) && (!state.types.length || [item.type,...(item.secondaryTypes||[])].some(t=>state.types.includes(t))) && (!state.subject || item.subjects.includes(state.subject)) && (!state.course || (item.courses||[]).includes(state.course)) && (!state.relevance || item.relevanceTier===state.relevance) && locationMatch(item,state.location) && (!state.source || item.source===state.source) && (!state.closing || (item.deadlineAt && new Date(item.deadlineAt).getTime() <= now+14*day));
}
function paginate(items,page=1,pageSize=10){
  const size=PAGE_SIZES.includes(Number(pageSize))?Number(pageSize):10;
  const total=items.length,pages=Math.max(1,Math.ceil(total/size));
  const selected=Math.min(pages,Math.max(1,Number.isSafeInteger(Number(page))?Number(page):1));
  const start=(selected-1)*size;
  return {items:items.slice(start,start+size),page:selected,pages,pageSize:size,total,start:total?start+1:0,end:Math.min(start+size,total)};
}
function renderCard(item,now){
  let deadline=item.deadlineLabel;
  const remaining=item.deadlineAt ? new Date(item.deadlineAt)-now : null;
  const urgent=remaining!==null && remaining<=7*day;
  const localToday=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  if(item.deadline===localToday) deadline='Closes today'+(item.deadlineTime?' · '+item.deadlineTime+' UK':'');
  const linkNeedsCheck=healthData?.links?.some(x=>x.id===item.id && x.status==='needs-check');
  const details=[['Pay / funding',item.compensation],['Eligibility',item.eligibility],['Course interest',(item.courses||[]).map(c=>COURSES[c]).join(' · ')],['Experience',item.careerLevel],['Contract',item.contract],['Deadline',item.deadlineLabel],['Note',item.notes]].filter(x=>x[1]);
  return `<article class="card" data-id="${escapeHTML(item.id)}"><div class="card-top"><div class="badge-stack"><span class="badge ${escapeHTML(item.type)}">${TYPES[item.type]}</span>${item.relevanceTier==='Related field'?'<span class="badge related">Related field</span>':''}</div><span class="deadline ${urgent?'urgent':''}">${escapeHTML(deadline)}</span></div><h3><a href="${safeURL(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a></h3><p class="organisation">${escapeHTML(item.organisation)}</p><p class="location-line">${escapeHTML(item.location)} · ${escapeHTML(item.workplace)}</p>${linkNeedsCheck?'<p class="link-warning">Link needs checking · last source request was unsuccessful</p>':''}<p class="funding-line">${escapeHTML(item.compensation)}</p><p class="summary">${escapeHTML(item.summary)}</p>${item.fitReason?`<p class="fit-reason"><strong>Relevance:</strong> ${escapeHTML(item.fitReason)}</p>`:''}<div class="tags">${item.tags.slice(0,4).map(t=>`<span class="tag">${escapeHTML(t)}</span>`).join('')}</div><details class="details"><summary>Eligibility &amp; details${/Experienced|Specialist|Professional|experience required/.test(item.careerLevel)?' · experience required':''}</summary><dl>${details.map(([k,v])=>`<dt>${escapeHTML(k)}</dt><dd>${escapeHTML(v)}</dd>`).join('')}</dl></details><div class="card-bottom"><div class="source-meta">Via ${escapeHTML(item.source)}<br>Reviewed ${dateText(item.lastChecked)}</div><a class="advert-link" href="${safeURL(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="View advert: ${escapeHTML(item.title)} (opens in a new tab)">View advert</a></div></article>`;
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
  filtered.sort((a,b)=>state.sort==='title'?a.title.localeCompare(b.title):state.sort==='newest'?b.lastChecked.localeCompare(a.lastChecked)||a.title.localeCompare(b.title):((a.deadlineAt?Date.parse(a.deadlineAt):Infinity)-(b.deadlineAt?Date.parse(b.deadlineAt):Infinity))||a.title.localeCompare(b.title));
  const page=paginate(filtered,currentPage,state.pageSize);currentPage=page.page;
  $('cards').innerHTML=page.items.map(x=>renderCard(x,now)).join('');$('empty').hidden=filtered.length>0;
  $('result-count').textContent=`${filtered.length?`Showing ${page.start}–${page.end} of `:''}${filtered.length} ${filtered.length===1?'opportunity':'opportunities'}${state.location==='uk'?' in the UK':state.location==='international'?' outside the UK':state.location==='remote'?' with remote or hybrid work':''}`;
  $('pagination').hidden=page.pages<=1;$('previous-page').disabled=currentPage===1;$('next-page').disabled=currentPage===page.pages;$('page-info').textContent=`Page ${currentPage} of ${page.pages}`;
  $('total-count').textContent=all.length;
  for(const [type]of Object.entries(TYPES)){$('count-'+type).textContent=all.filter(x=>locationMatch(x,state.location)&&[x.type,...(x.secondaryTypes||[])].includes(type)).length;}
  const lastReview=database.opportunities.map(x=>x.lastChecked).sort().at(-1);
  $('freshness').textContent=lastReview?`Most recent editorial review: ${dateText(lastReview)}. ${ageDays(lastReview,now)>7?'Some listings may need rechecking.':'Check the advert before applying.'}`:'No reviewed adverts yet.';
  $('freshness').classList.toggle('stale',!lastReview||ageDays(lastReview,now)>7);
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
  $('source-cards').innerHTML=sourceData.sources.filter(s=>s.showOnBoard!==false).map(s=>`<article class="source-card"><h3>${escapeHTML(s.name)}</h3><p>${escapeHTML(s.description)}</p><a href="${safeURL(s.searchUrl||s.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(s.linkLabel||`Search ${s.shortName||s.name}`)}</a>${s.searches?.length?`<div class="source-searches">${s.searches.map(x=>`<a href="${safeURL(x.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(x.label)}</a>`).join('')}</div>`:''}<span class="source-mode">${escapeHTML(s.label)}</span></article>`).join('');
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
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)render()});setInterval(render,60000);
    try{const response=await fetch('data/health.json');if(!response.ok)throw Error();const health=await response.json();healthData=health;render();$('check-status').textContent=health.lastRun?`Last automated check: ${dateText(health.lastRun)}. ${health.summary}`:'Automated source checks have not run yet. The board currently uses individually reviewed adverts.';}catch{$('check-status').textContent='Automated source-check status is unavailable. Editorial review dates are shown on each advert.';}
  }catch(error){$('load-error').hidden=false;$('result-count').textContent='Opportunities unavailable';$('cards').innerHTML='';$('freshness').textContent='';if(sourceData)renderSources();}
}
load();
