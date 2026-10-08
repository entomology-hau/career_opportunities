'use strict';
const ADMIN_REPOSITORY='entomology-hau/career_opportunities';
const ADMIN_TYPES={job:'Paid job',phd:'PhD',mres:'MRes',internship:'Internship',volunteering:'Volunteering',other:'Other opportunity'};
const ADMIN_COURSES={entomology:'Entomology',ipm:'Integrated Pest Management','biological-recording':'Biological Recording'};
const adminState={apiBase:'',portal:false,user:null,csrfToken:'',queueSha:'',candidates:[],history:[],confirmed:new Set(),busy:false,reloadRequired:false};
const adminElement=id=>document.getElementById(id);
const adminEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const adminSafeURL=value=>{try{const u=new URL(value);return /^https?:$/.test(u.protocol)?u.href:'#';}catch{return '#';}};
const adminList=value=>Array.isArray(value)?value.filter(item=>typeof item==='string'):[];
const adminDate=value=>{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length===10?value+'T12:00:00Z':value));};
function adminConfiguration(config,origin){
  try{
    if(typeof config?.apiBase!=='string'||!config.apiBase.trim())return {configured:false,apiBase:'',portal:false};
    const u=new URL(config.apiBase),local=u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)&&u.origin===origin;
    if((u.protocol!=='https:'&&!local)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid admin origin');
    return {configured:true,apiBase:u.origin,portal:u.origin===origin};
  }catch{return {configured:false,apiBase:'',portal:false};}
}
function adminCommitURL(value){
  try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='github.com'&&new RegExp('^/'+ADMIN_REPOSITORY+'/commit/[a-f0-9]{40,64}$','i').test(u.pathname)?u.href:'#';}catch{return '#';}
}
function adminSessionValid(value){return typeof value?.user?.login==='string'&&value.user.login.trim()!==''&&value.repository===ADMIN_REPOSITORY&&typeof value.csrfToken==='string'&&value.csrfToken.length>=16;}
function adminCandidateValid(value){return value&&typeof value==='object'&&typeof value.title==='string'&&typeof value.url==='string'&&adminSafeURL(value.url)!=='#'&&typeof value.fingerprint==='string'&&/^[a-f0-9]{64}$/i.test(value.fingerprint);}
function adminQueueValid(value){return Array.isArray(value?.candidates)&&value.candidates.every(adminCandidateValid)&&typeof value.queueSha==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value.queueSha)&&(value.history===undefined||Array.isArray(value.history));}
class AdminRequestError extends Error{constructor(status,detail=''){super('Admin request failed');this.status=status;this.detail=typeof detail==='string'?detail.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,240):'';}}
async function adminRequest(path,options={}){
  if(!adminState.portal||adminState.apiBase!==location.origin||!['/api/session','/api/queue','/api/decisions','/auth/logout'].includes(path))throw new AdminRequestError(0);
  const method=options.method||'GET',headers={Accept:'application/json'};
  if(method==='POST'){
    if(!adminState.user||!adminState.csrfToken)throw new AdminRequestError(401);
    headers['Content-Type']='application/json';headers['X-CSRF-Token']=adminState.csrfToken;
  }
  const response=await fetch(adminState.apiBase+path,{method,headers,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',...(method==='POST'?{body:JSON.stringify(options.body||{})}:{})});
  if(!response.ok){let detail='';try{const error=await response.json();if(typeof error?.error==='string')detail=error.error;}catch{}throw new AdminRequestError(response.status,detail);}
  if(path==='/auth/logout'&&response.status===204)return {};
  try{return await response.json();}catch{throw new AdminRequestError(502);}
}
function adminNotice(message,kind='warning',commitUrl=''){
  const box=adminElement('admin-alert');box.hidden=!message;box.className='admin-alert '+kind;box.textContent=message;
  const commit=adminCommitURL(commitUrl);
  if(message&&commit!=='#'){const link=document.createElement('a');link.href=commit;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View saved commit';box.appendChild(link);}
}
function adminSignedOut(message='Sign in with an authorised GitHub account to review pending adverts.'){
  adminState.user=null;adminState.csrfToken='';adminState.queueSha='';adminState.candidates=[];adminState.history=[];adminState.confirmed.clear();adminState.reloadRequired=false;
  adminElement('admin-workspace').hidden=true;adminElement('signed-out').hidden=false;adminElement('sign-in-copy').textContent=message;
  adminElement('signed-in-user').textContent='';adminElement('admin-repository').textContent='';
  adminElement('sign-in-link').hidden=!adminState.apiBase;
  if(adminState.apiBase)adminElement('sign-in-link').href=adminState.apiBase+'/auth/login';
  adminElement('queue-cards').innerHTML='';adminElement('history-list').innerHTML='';
}
function adminOAuthMessage(){
  const url=new URL(location.href),code=url.searchParams.get('authError'),detail=url.searchParams.get('authDetail');
  if(!code)return '';
  url.searchParams.delete('authError');url.searchParams.delete('authDetail');try{history.replaceState(null,'',url.pathname+url.search+url.hash);}catch{}
  const messages={
    'sign-in-failed':'GitHub sign-in could not be completed. Please try again.',
    'client-credentials':'GitHub rejected the app credentials. Update the Cloudflare runtime GITHUB_CLIENT_SECRET with the client secret belonging to this GitHub App, then deploy and sign in again.',
    'callback-mismatch':'GitHub rejected the callback address. Set the GitHub App callback URL to https://hau-opportunities-admin.entomology-hau.workers.dev/auth/callback, then sign in again.',
    'verification-code':'GitHub could not accept this sign-in code. Close other sign-in tabs and start a fresh sign-in from this page.',
    'state-mismatch':'This sign-in no longer matches the browser request. Close other sign-in tabs and start a fresh sign-in from this page.',
    'code-missing':'GitHub did not return a sign-in code. Start a fresh sign-in from this page.',
    'email-unverified':'Verify the primary email address on your GitHub account, then sign in again.',
    'token-invalid':'GitHub did not return a usable GitHub App session. Check that this is a GitHub App with user authorisation configured, then sign in again.',
    'github-unavailable':'The admin service could not complete its request to GitHub. Wait a minute, then start a fresh sign-in.',
    'github-rate-limited':'GitHub temporarily limited requests from the admin service. Wait a few minutes, then sign in again.',
    'not-authorized':'This GitHub account or app cannot manage the board. Choose entomology-hau and check that the GitHub App is installed on career_opportunities with Contents read and write permission.',
    'expired':'The sign-in request expired or its browser cookie is missing. Start a fresh sign-in from this page.',
    'cancelled':'GitHub sign-in was cancelled.'
  };
  const message=Object.hasOwn(messages,code)?messages[code]:'Sign-in could not be completed. Please try again.';
  const phases={'repository-request':'repository lookup','repository-response':'repository response','token-request':'sign-in exchange','token-response':'sign-in response','authorization-request':'account and repository access check','session-create':'browser session creation'};
  const diagnostic=typeof detail==='string'?detail.match(/^(repository-request|repository-response|token-request|token-response|authorization-request|session-create)(?:-([1-5][0-9]{2}))?$/):null;
  return message+(diagnostic?` Diagnostic: ${phases[diagnostic[1]]}${diagnostic[2]?` (HTTP ${diagnostic[2]})`:''}.`:'');
}
function adminMatches(candidate,query){
  const text=[candidate.title,candidate.source,candidate.organisation,candidate.location,candidate.reason,candidate.evidenceSnippet,candidate.relevanceStrength,...adminList(candidate.subjects),...adminList(candidate.matchedTerms),...adminList(candidate.searchKeywords)].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(word=>text.includes(word));
}
function adminCandidateCard(candidate,index){
  const type=ADMIN_TYPES[candidate.suggestedType||candidate.type]||'Not supplied';
  const metadata=[['Organisation',candidate.organisation],['Location',candidate.location],['Suggested type',type],['Match',candidate.relevanceStrength==='direct'?'Direct keyword match':candidate.relevanceStrength==='needs-context'?'Context check needed':candidate.relevanceStrength],['Matched terms',adminList(candidate.matchedTerms).join(' · ')],['Course interest',adminList(candidate.courses).map(c=>ADMIN_COURSES[c]||c).join(' · ')],['Subject',adminList(candidate.subjects).join(' · ')],['First collected',adminDate(candidate.firstSeen)],['Last listed',adminDate(candidate.lastSeen)],['Deadline hint',candidate.deadlineSuggestion||candidate.deadlineLabel]].filter(entry=>entry[1]);
  const disabled=adminState.busy||adminState.reloadRequired||!adminState.queueSha;
  const checked=adminState.confirmed.has(candidate.url);
  return `<article class="queue-card" data-index="${index}"><h3><a href="${adminEscape(adminSafeURL(candidate.url))}" target="_blank" rel="noopener noreferrer">${adminEscape(candidate.title)}</a></h3><p class="queue-source">${adminEscape(candidate.source||'Source not supplied')}</p>${candidate.reason?`<p class="queue-reason"><strong>Relevance check:</strong> ${adminEscape(candidate.reason)}</p>`:''}${candidate.evidenceSnippet?`<p class="queue-evidence">${adminEscape(candidate.evidenceSnippet)}</p>`:''}<dl class="queue-metadata">${metadata.map(([label,value])=>`<dt>${adminEscape(label)}</dt><dd>${adminEscape(value)}</dd>`).join('')}</dl><p class="queue-review-note">Source details and suggested classifications may be incomplete. Follow the original advert before deciding.</p><label class="decision-confirm" for="confirm-${index}"><input id="confirm-${index}" type="checkbox" data-confirm="${index}" ${checked?'checked':''} ${disabled?'disabled':''}>I have checked the original advert and consider this opportunity relevant and currently active.</label><div class="queue-actions"><a href="${adminEscape(adminSafeURL(candidate.url))}" target="_blank" rel="noopener noreferrer">View original advert</a><button type="button" class="admin-primary" data-action="approve" data-index="${index}" ${disabled||!checked?'disabled':''}>Approve</button><button type="button" class="reject-button" data-action="reject" data-index="${index}" ${disabled?'disabled':''}>Reject</button></div></article>`;
}
function adminRenderQueue(){
  const query=adminElement('queue-search').value.trim(),visible=adminState.candidates.map((candidate,index)=>({candidate,index})).filter(({candidate})=>adminMatches(candidate,query));
  adminElement('queue-count').textContent=query?`${visible.length} of ${adminState.candidates.length} pending adverts match your search`:`${adminState.candidates.length} ${adminState.candidates.length===1?'advert awaits':'adverts await'} a decision`;
  adminElement('queue-cards').innerHTML=visible.map(({candidate,index})=>adminCandidateCard(candidate,index)).join('');
  adminElement('queue-empty').hidden=visible.length>0;adminElement('queue-empty-copy').textContent=query&&adminState.candidates.length?'No pending adverts match this search. Try different keywords.':'There are no adverts awaiting a decision.';
  adminElement('reload-queue').disabled=adminState.busy;adminElement('sign-out').disabled=adminState.busy;
}
function adminRenderHistory(){
  const rows=adminState.history.slice().filter(item=>item&&typeof item==='object').sort((a,b)=>String(b.decidedAt||b.createdAt||b.at||'').localeCompare(String(a.decidedAt||a.createdAt||a.at||''))).slice(0,10);
  adminElement('history-list').innerHTML=rows.length?rows.map(item=>{const action=item.action==='approve'?'Approve decision':item.action==='reject'?'Reject decision':'Decision',title=item.title||item.advertTitle||item.advertUrl||'Advert',actor=typeof item.decidedBy==='string'?item.decidedBy:typeof item.actor==='string'?item.actor:item.decidedBy?.login||item.actor?.login||item.user?.login||'',date=adminDate(item.decidedAt||item.createdAt||item.at),commit=adminCommitURL(item.commitUrl),resolution={queued:'Queued for the next site update',applied:'Applied to board data',ignored:'Ignored; no publication change'}[item.resolutionStatus]||item.resolutionStatus||'Queued for the next site update';return `<li><strong>${action}: ${adminEscape(title)}</strong>${actor||date?`<br>${adminEscape([actor?`@${actor}`:'',date].filter(Boolean).join(' · '))}`:''}<br>${adminEscape(resolution)}${item.resolutionReason?` · ${adminEscape(item.resolutionReason)}`:''}${commit!=='#'?` · <a href="${adminEscape(commit)}" target="_blank" rel="noopener noreferrer">Saved commit</a>`:''}</li>`;}).join(''):'<li>No decisions have been saved yet.</li>';
}
function adminErrorMessage(error){
  if(error.status===401)return 'Your session has expired. Sign in to continue.';
  if(error.status===403)return 'This account cannot make decisions. Sign in with an authorised account.';
  if(error.status===409)return error.detail||'The queue changed before your decision was saved. Reload the queue and check the advert again.';
  if(error.status===503)return error.detail||'Admin sign-in is not configured yet.';
  return 'The admin service could not complete this request. Please try again.';
}
function adminHandleError(error){
  if([401,403].includes(error.status))adminSignedOut(adminErrorMessage(error));
  else adminNotice(adminErrorMessage(error));
}
async function adminLoadQueue(options={}){
  if(!adminState.user||adminState.busy)return;
  adminState.busy=true;adminRenderQueue();
  try{
    const queue=await adminRequest('/api/queue');if(!adminQueueValid(queue))throw new AdminRequestError(502);
    adminState.candidates=queue.candidates;adminState.queueSha=queue.queueSha;adminState.history=queue.history||[];adminState.confirmed.clear();adminState.reloadRequired=false;
    adminRenderHistory();
  }catch(error){adminState.queueSha='';adminState.reloadRequired=true;if(options.afterSave){if([401,403].includes(error.status))adminSignedOut(adminErrorMessage(error));adminNotice(`Your decision was saved to GitHub; the site update is queued. ${[401,403].includes(error.status)?'Sign in again before making another decision.':'The queue could not reload. Reload it before making another decision.'}`,'warning',options.commitUrl);}else adminHandleError(error);}
  finally{adminState.busy=false;if(adminState.user)adminRenderQueue();}
}
async function adminDecide(action,index){
  const candidate=adminState.candidates[index];
  if(!adminState.user||adminState.busy||adminState.reloadRequired||!adminState.queueSha||!candidate||!['approve','reject'].includes(action)||(action==='approve'&&!adminState.confirmed.has(candidate.url)))return false;
  adminState.busy=true;adminRenderQueue();adminNotice('Saving decision…','');
  let saved=false,savedCommit='';
  try{
    const result=await adminRequest('/api/decisions',{method:'POST',body:{action,advertUrl:candidate.url,fingerprint:candidate.fingerprint,queueSha:adminState.queueSha}});
    if(result.saved!==true||result.publication!=='queued')throw new AdminRequestError(502);
    saved=true;savedCommit=result.commitUrl;adminState.candidates=adminState.candidates.filter(item=>item.url!==candidate.url);adminState.confirmed.delete(candidate.url);adminState.queueSha='';
    adminNotice(`${action==='approve'?'Approved':'Rejected'}: ${candidate.title}. Saved to GitHub; the site update is queued.`,'success',result.commitUrl);
  }catch(error){
    if(error.status===409){adminState.queueSha='';adminState.reloadRequired=true;adminState.confirmed.clear();}
    adminHandleError(error);
  }finally{adminState.busy=false;if(adminState.user)adminRenderQueue();}
  if(saved&&adminState.user)await adminLoadQueue({afterSave:true,commitUrl:savedCommit});
  return saved;
}
async function adminLogout(){
  if(adminState.busy)return;
  adminState.busy=true;adminRenderQueue();
  try{await adminRequest('/auth/logout',{method:'POST'});adminNotice('You have signed out.','');adminSignedOut();}
  catch(error){adminSignedOut();adminNotice(error.status===401?'Your session has already expired.':'We could not confirm sign-out. Close this portal or sign in again.');}
  finally{adminState.busy=false;}
}
function adminInitTheme(){
  let theme='light';try{if(localStorage.getItem('entomology-theme')==='dark')theme='dark';}catch{}
  const apply=value=>{document.documentElement.dataset.theme=value;adminElement('theme-toggle').setAttribute('aria-pressed',String(value==='dark'));document.querySelector('meta[name="theme-color"]').content=value==='dark'?'#253750':'#eaf1fa';};
  apply(theme);adminElement('theme-toggle').addEventListener('click',()=>{theme=document.documentElement.dataset.theme==='dark'?'light':'dark';apply(theme);try{localStorage.setItem('entomology-theme',theme);}catch{}});
}
async function initAdmin(){
  adminInitTheme();const oauthMessage=adminOAuthMessage();if(oauthMessage)adminNotice(oauthMessage);
  adminElement('queue-search').addEventListener('input',adminRenderQueue);
  adminElement('reload-queue').addEventListener('click',()=>{adminNotice('');adminLoadQueue();});
  adminElement('sign-out').addEventListener('click',adminLogout);
  adminElement('queue-cards').addEventListener('change',event=>{const input=event.target.closest('[data-confirm]');if(!input||adminState.busy)return;const candidate=adminState.candidates[Number(input.dataset.confirm)];if(!candidate)return;if(input.checked)adminState.confirmed.add(candidate.url);else adminState.confirmed.delete(candidate.url);const button=adminElement('queue-cards').querySelector(`[data-action="approve"][data-index="${Number(input.dataset.confirm)}"]`);if(button)button.disabled=!input.checked||adminState.reloadRequired||!adminState.queueSha;});
  adminElement('queue-cards').addEventListener('click',event=>{const button=event.target.closest('button[data-action]');if(button&&!button.disabled)adminDecide(button.dataset.action,Number(button.dataset.index));});
  try{
    const response=await fetch('admin-config.json',{credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store'});if(!response.ok)throw Error('Config unavailable');
    const config=adminConfiguration(await response.json(),location.origin);adminState.apiBase=config.apiBase;adminState.portal=config.portal;
    if(!config.configured){adminSignedOut('Admin sign-in is being set up. The public opportunities board remains available.');return;}
    if(!config.portal){adminSignedOut('Continue to the secure owner portal to sign in with GitHub.');return;}
    const session=await adminRequest('/api/session');if(!adminSessionValid(session))throw new AdminRequestError(502);
    adminState.user=session.user;adminState.csrfToken=session.csrfToken;adminElement('signed-in-user').textContent=`Signed in as @${session.user.login}`;adminElement('admin-repository').textContent=session.repository;
    const board=adminSafeURL(session.publicSiteUrl);if(board!=='#')for(const link of document.querySelectorAll('.board-link'))link.href=board;
    adminElement('signed-out').hidden=true;adminElement('admin-workspace').hidden=false;await adminLoadQueue();
  }catch(error){adminSignedOut(error.status===401?'Sign in with an authorised GitHub account to review pending adverts.':adminErrorMessage(error));}
}
initAdmin();

