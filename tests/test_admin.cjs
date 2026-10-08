'use strict';
const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.resolve(__dirname,'..');
const script=fs.readFileSync(path.join(root,'site/admin.js'),'utf8').replace(/initAdmin\(\);\s*$/,'');
const portal='https://owner-portal.example.workers.dev',pages='https://entomology-hau.github.io';
const fingerprint='a'.repeat(64),queueSha='b'.repeat(40),newSha='c'.repeat(40),csrf='csrf-'.repeat(8);
const candidate={title:'Ecological survey assistant',url:'https://example.org/jobs/1?ref=ecology',source:'Official feed',sourceId:'feed',organisation:'Wildlife research centre',location:'Shropshire',matchedTerms:['Species surveys','Biodiversity data'],reason:'Ecology role needs a closer relevance check.',evidenceSnippet:'Species surveys and biodiversity data.',relevanceStrength:'needs-context',suggestedType:'job',firstSeen:'2026-09-30',lastSeen:'2026-10-01',fingerprint};
const session={user:{login:'entomology-hau'},repository:'entomology-hau/career_opportunities',csrfToken:csrf,publicSiteUrl:'https://entomology-hau.github.io/career_opportunities/'};
const queue={candidates:[candidate],queueSha,history:[]};
const response=(status,data)=>({status,ok:status>=200&&status<300,json:async()=>data});
function createClient(origin=portal,query=''){
  const elements={},requests=[],storage=[],replaced=[];
  const element=id=>elements[id]||=({id,hidden:false,value:'',disabled:false,textContent:'',innerHTML:'',className:'',children:[],handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},setAttribute(name,value){this[name]=value;},appendChild(child){this.children.push(child);},querySelector(){return null;}});
  element('admin-workspace').hidden=true;const boardLinks=[{},{}],meta={content:''};
  const context={console,URL,URLSearchParams,Intl,Date,Set,location:{origin,href:origin+'/admin.html'+query},history:{replaceState(_state,_title,url){replaced.push(url);}},localStorage:{getItem(){return null;},setItem(key,value){storage.push({key,value});}},document:{documentElement:{dataset:{}},getElementById:element,querySelector:()=>meta,querySelectorAll:()=>boardLinks,createElement:tag=>({tagName:tag})}};
  context.fetch=async(url,options)=>{requests.push({url,options});throw Error('Unexpected network request');};
  vm.createContext(context);vm.runInContext(script+'\nglobalThis.adminLogic={state:adminState,adminConfiguration,adminSessionValid,adminCandidateValid,adminQueueValid,adminRequest,adminCommitURL,adminOAuthMessage,adminCandidateCard,adminRenderQueue,adminRenderHistory,adminLoadQueue,adminDecide,adminLogout,initAdmin};',context);
  const setFetch=handler=>{context.fetch=async(url,options)=>{requests.push({url,options});return handler(url,options);};};
  const authorise=()=>Object.assign(context.adminLogic.state,{apiBase:portal,portal:true,user:session.user,csrfToken:csrf,queueSha,candidates:[candidate],history:[],busy:false,reloadRequired:false});
  return {logic:context.adminLogic,context,element,requests,storage,replaced,boardLinks,setFetch,authorise};
}
async function main(){
  let client=createClient();
  for(const apiBase of ['', 'javascript:alert(1)','http://outside.example','https://user:pass@owner.example','https://owner.example/admin','https://owner.example/?secret=x'])assert.equal(client.logic.adminConfiguration({apiBase},portal).configured,false);
  assert.equal(client.logic.adminConfiguration({apiBase:portal},portal).portal,true);
  assert.equal(client.logic.adminConfiguration({apiBase:portal},pages).portal,false);
  assert.equal(client.logic.adminConfiguration({apiBase:'http://localhost:8787'},'http://localhost:8787').configured,true);
  assert(client.logic.adminSessionValid(session));assert(!client.logic.adminSessionValid({...session,csrfToken:''}));assert(!client.logic.adminSessionValid({...session,repository:'other/repository'}));
  assert(client.logic.adminQueueValid(queue));assert(!client.logic.adminQueueValid({...queue,queueSha:'bad'}));assert(!client.logic.adminQueueValid({...queue,candidates:[{...candidate,fingerprint:'bad'}]}));assert(!client.logic.adminCandidateValid({...candidate,url:'javascript:alert(1)'}));
  assert.equal(client.logic.adminCommitURL('javascript:alert(1)'),'#');assert.equal(client.logic.adminCommitURL('https://outside.example/commit/'+queueSha),'#');assert.equal(client.logic.adminCommitURL('https://github.com/entomology-hau/career_opportunities/commit/'+queueSha),'https://github.com/entomology-hau/career_opportunities/commit/'+queueSha);

  // Pages offers navigation to the portal without fetching protected cross-origin APIs.
  client=createClient(pages);client.setFetch(()=>response(200,{apiBase:portal}));await client.logic.initAdmin();
  assert.equal(client.requests.length,1);assert.equal(client.requests[0].url,'admin-config.json');assert.equal(client.element('admin-workspace').hidden,true);assert.equal(client.element('sign-in-link').href,portal+'/auth/login');assert.equal(client.logic.state.user,null);
  await assert.rejects(client.logic.adminRequest('/api/session'),error=>error.status===0);assert.equal(client.requests.length,1);
  client=createClient(pages);client.setFetch(()=>response(200,{apiBase:''}));await client.logic.initAdmin();assert.equal(client.requests.length,1);assert.equal(client.element('sign-in-link').hidden,true);assert.match(client.element('sign-in-copy').textContent,/being set up/);

  // A real session is required; a malformed or expired response never shows an authenticated view.
  client=createClient();client.setFetch(url=>url==='admin-config.json'?response(200,{apiBase:portal}):response(401,{}));await client.logic.initAdmin();assert.equal(client.requests.length,2);assert.equal(client.logic.state.user,null);assert.equal(client.element('admin-workspace').hidden,true);assert.equal(client.element('sign-in-link').hidden,false);
  client=createClient();client.setFetch(url=>url==='admin-config.json'?response(200,{apiBase:portal}):response(200,{...session,csrfToken:''}));await client.logic.initAdmin();assert.equal(client.requests.length,2);assert.equal(client.logic.state.user,null);assert.equal(client.element('admin-workspace').hidden,true);
  client=createClient();client.setFetch(url=>url==='admin-config.json'?response(200,{apiBase:portal}):url.endsWith('/api/session')?response(200,session):response(200,queue));await client.logic.initAdmin();
  assert.equal(client.requests.length,3);assert.equal(client.element('admin-workspace').hidden,false);assert.equal(client.element('signed-out').hidden,true);assert.equal(client.element('signed-in-user').textContent,'Signed in as @entomology-hau');assert.equal(client.boardLinks[0].href,session.publicSiteUrl);
  assert(client.requests.every(call=>call.options.credentials==='same-origin'&&call.options.mode==='same-origin'&&call.options.redirect==='error'));assert(client.storage.every(entry=>entry.key==='entomology-theme'));
  assert.match(client.element('queue-cards').innerHTML,/data-action="approve" data-index="0" disabled/);assert.match(client.element('queue-cards').innerHTML,/currently active/);
  assert.match(client.element('queue-cards').innerHTML,/<dt>Matched terms<\/dt><dd>Species surveys · Biodiversity data/);assert.match(client.element('queue-cards').innerHTML,/<dt>Organisation<\/dt><dd>Wildlife research centre/);assert.match(client.element('queue-cards').innerHTML,/<dt>Location<\/dt><dd>Shropshire/);
  const countBefore=client.requests.length;assert.equal(await client.logic.adminDecide('approve',0),false);assert.equal(client.requests.length,countBefore);

  // Decisions send only the snapshot and CSRF fields, then report queued publication honestly.
  client.logic.state.confirmed.add(candidate.url);client.logic.adminRenderQueue();assert(!/data-action="approve" data-index="0" disabled/.test(client.element('queue-cards').innerHTML));
  client.setFetch((url,options)=>url.endsWith('/api/decisions')?response(200,{saved:true,publication:'queued',decisionId:'decision-1',commitUrl:'https://github.com/entomology-hau/career_opportunities/commit/'+newSha}):response(200,{candidates:[],queueSha:newSha,history:[{action:'approve',title:candidate.title,decidedBy:'entomology-hau',decidedAt:'2026-10-01T12:00:00Z',resolutionStatus:'queued'}]}));
  assert.equal(await client.logic.adminDecide('approve',0),true);
  const post=client.requests.find(call=>call.url.endsWith('/api/decisions'));assert.equal(post.options.method,'POST');assert.equal(post.options.headers['X-CSRF-Token'],csrf);assert(!post.options.headers.Authorization);assert.deepEqual(JSON.parse(post.options.body),{action:'approve',advertUrl:candidate.url,fingerprint,queueSha});
  assert.match(client.element('admin-alert').textContent,/Saved to GitHub; the site update is queued/);assert.equal(client.logic.state.candidates.length,0);assert.match(client.element('history-list').innerHTML,/Approve decision:/);assert.match(client.element('history-list').innerHTML,/@entomology-hau/);assert.match(client.element('history-list').innerHTML,/Queued for the next site update/);
  client.logic.state.history=[{title:candidate.title,action:'reject',decidedBy:'entomology-hau',resolutionStatus:'ignored',resolutionReason:'The source advert changed.'},{title:candidate.title,action:'approve',resolutionStatus:'applied'}];client.logic.adminRenderHistory();assert.match(client.element('history-list').innerHTML,/Ignored; no publication change/);assert.match(client.element('history-list').innerHTML,/The source advert changed/);assert.match(client.element('history-list').innerHTML,/Applied to board data/);

  // A stale snapshot cannot be retried until reloaded and approval re-confirmed.
  client=createClient();client.authorise();client.logic.state.confirmed.add(candidate.url);client.setFetch(()=>response(409,{}));assert.equal(await client.logic.adminDecide('approve',0),false);assert.equal(client.logic.state.reloadRequired,true);assert.equal(client.logic.state.confirmed.size,0);assert.match(client.element('admin-alert').textContent,/Reload the queue/);
  assert.equal(await client.logic.adminDecide('reject',0),false);assert.equal(client.requests.length,1);
  client.setFetch(()=>response(200,{...queue,queueSha:newSha}));await client.logic.adminLoadQueue();assert.equal(client.logic.state.reloadRequired,false);assert.equal(client.logic.state.queueSha,newSha);assert.equal(await client.logic.adminDecide('approve',0),false);assert.equal(client.requests.length,2);
  // Useful conflict reasons are retained as bounded text and never inserted as markup.
  for(const reason of ['This advert has passed its known closing date.','This advert has not been listed at a source recently.','<img src=x onerror=alert(1)> The advert is stale.']){
    client=createClient();client.authorise();client.logic.state.confirmed.add(candidate.url);client.setFetch(()=>response(409,{error:reason}));assert.equal(await client.logic.adminDecide('approve',0),false);assert.equal(client.element('admin-alert').textContent,reason);assert.equal(client.element('admin-alert').innerHTML,'');assert.equal(client.logic.state.reloadRequired,true);
  }
  client=createClient();client.authorise();client.setFetch(()=>response(503,{error:'The queue service is temporarily unavailable.'}));await client.logic.adminLoadQueue();assert.equal(client.element('admin-alert').textContent,'The queue service is temporarily unavailable.');
  client=createClient();client.setFetch(url=>url==='admin-config.json'?response(200,{apiBase:portal}):response(503,{error:'GitHub sign-in is temporarily unavailable.'}));await client.logic.initAdmin();assert.equal(client.element('sign-in-copy').textContent,'GitHub sign-in is temporarily unavailable.');assert.equal(client.element('admin-workspace').hidden,true);
  client=createClient();client.authorise();client.setFetch(()=>response(409,{error:'x'.repeat(500)}));await assert.rejects(client.logic.adminRequest('/api/queue'),error=>error.detail.length===240);
  client=createClient();client.authorise();client.setFetch(()=>response(409,{error:{unsafe:'object'}}));await assert.rejects(client.logic.adminRequest('/api/queue'),error=>error.detail==='');

  // A saved mutation is still reported as saved if the following reload fails.
  client=createClient();client.authorise();client.setFetch(url=>url.endsWith('/api/decisions')?response(200,{saved:true,publication:'queued'}):response(500,{}));assert.equal(await client.logic.adminDecide('reject',0),true);assert.match(client.element('admin-alert').textContent,/decision was saved to GitHub/);assert.match(client.element('admin-alert').textContent,/queue could not reload/);assert.equal(client.logic.state.queueSha,'');
  client=createClient();client.authorise();client.setFetch(()=>response(403,{}));await client.logic.adminLoadQueue();assert.equal(client.logic.state.user,null);assert.equal(client.element('admin-workspace').hidden,true);assert.equal(client.element('signed-in-user').textContent,'');

  // Sign-out clears the private view, including when the server session already expired.
  client=createClient();client.authorise();client.setFetch(()=>response(204,null));await client.logic.adminLogout();assert.equal(client.logic.state.user,null);assert.equal(client.logic.state.csrfToken,'');assert.equal(client.element('admin-workspace').hidden,true);assert.match(client.element('admin-alert').textContent,/signed out/);
  client=createClient();client.authorise();client.setFetch(()=>response(401,{}));await client.logic.adminLogout();assert.equal(client.logic.state.user,null);assert.match(client.element('admin-alert').textContent,/already expired/);

  // Queue evidence and callback errors cannot inject markup or redirect the portal.
  client=createClient();client.authorise();const hostile=client.logic.adminCandidateCard({...candidate,title:'<img src=x onerror=alert(1)>',source:'<script>',reason:'<script>',evidenceSnippet:'<iframe>',url:'javascript:alert(1)'},0);assert(!hostile.includes('<img'));assert(!hostile.includes('<script>'));assert(!hostile.includes('<iframe>'));assert(!hostile.includes('href="javascript:'));
  client.logic.state.history=[{title:'<img src=x>',action:'reject',actor:'<script>',commitUrl:'javascript:alert(1)'}];client.logic.adminRenderHistory();assert(!client.element('history-list').innerHTML.includes('<img'));assert(!client.element('history-list').innerHTML.includes('<script>'));assert(!client.element('history-list').innerHTML.includes('javascript:'));
  client=createClient(portal,'?authError=not-authorized&view=queue#main');assert.match(client.logic.adminOAuthMessage(),/Contents read and write/);assert.equal(client.replaced[0],'/admin.html?view=queue#main');
  // Callback diagnostics explain the next action using fixed text; arbitrary input is never echoed.
  for(const [code,expected] of Object.entries({'client-credentials':/GITHUB_CLIENT_SECRET/,'callback-mismatch':/https:\/\/hau-opportunities-admin\.entomology-hau\.workers\.dev\/auth\/callback/,'verification-code':/fresh sign-in/,'state-mismatch':/browser request/,'code-missing':/did not return a sign-in code/,'email-unverified':/primary email/,'token-invalid':/GitHub App session/,'github-unavailable':/Wait a minute/,'github-rate-limited':/Wait a few minutes/})){
    client=createClient(portal,'?authError='+code);assert.match(client.logic.adminOAuthMessage(),expected);assert.equal(client.replaced[0],'/admin.html');assert.equal(client.logic.state.user,null);
  }
  for(const hostileCode of ['__proto__','constructor','toString','unknown-secret-value']){
    client=createClient(portal,'?authError='+hostileCode);assert.equal(client.logic.adminOAuthMessage(),'Sign-in could not be completed. Please try again.');
  }
  client=createClient(portal,'?authError=client-credentials');client.setFetch(url=>url==='admin-config.json'?response(200,{apiBase:portal}):response(401,{}));await client.logic.initAdmin();assert.match(client.element('admin-alert').textContent,/GITHUB_CLIENT_SECRET/);assert.equal(client.element('admin-alert').innerHTML,'');assert.equal(client.element('admin-workspace').hidden,true);
  client=createClient(portal,'?authError=%3Cscript%3E');assert(!client.logic.adminOAuthMessage().includes('<script>'));assert.equal(client.replaced[0],'/admin.html');
  assert(!script.includes('review-queue.json'));assert(!script.includes('access_token'));
  // The retained portal may be unconfigured or already have a public Worker origin.
  const deployedConfig=JSON.parse(fs.readFileSync(path.join(root,'site/admin-config.json'),'utf8'));
  assert.equal(typeof deployedConfig.apiBase,'string');
  assert.equal(client.logic.adminConfiguration(deployedConfig,pages).configured,deployedConfig.apiBase!=='');
  console.log('PASS: portal-only authenticated API access; safe setup/sign-in; CSRF and snapshot decisions; explicit approval confirmation; stale queue handling; queued publication; logout; safe rendering.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});

