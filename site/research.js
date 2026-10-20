'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const categories = {'risk-assessment':'Risk assessment',protocol:'Protocol',sop:'SOP'};
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const date = value => {if(!value || !Number.isFinite(Date.parse(value)))return '';return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/London'}).format(new Date(value.length===10?value+'T12:00:00Z':value));};
  const size = n => n >= 1048576 ? (n/1048576).toFixed(1)+' MB' : Math.max(0,Math.ceil(n/1024))+' KB';
  function status(message='',kind='',focus=false){const box=$('research-status');box.hidden=!message;box.textContent=message;box.className='research-status '+kind;if(focus){box.tabIndex=-1;box.focus();}}
  function busy(form,value){for(const control of form.querySelectorAll('button,input,select,textarea'))control.disabled=value;form.setAttribute('aria-busy',String(value));}
  class RequestError extends Error {constructor(code,message){super(message);this.status=code;}}
  let portal=false;
  async function request(path,{method='GET',body,csrf='',file=false}={}){
    if(!portal || !/^\/(?:research-api\/|api\/session$|auth\/logout$)/.test(path))throw new RequestError(0,'Open the secure research portal to continue.');
    const headers={Accept:file?'application/octet-stream':'application/json'};
    if(csrf)headers['X-CSRF-Token']=csrf;
    if(body && !(body instanceof FormData))headers['Content-Type']='application/json';
    const response=await fetch(path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,credentials:'same-origin',mode:'same-origin',cache:'no-store',redirect:'error'});
    if(!response.ok){let message='The request could not be completed. Please try again.';try{const value=await response.json();if(typeof value.error==='string')message=value.error.slice(0,400);}catch{}throw new RequestError(response.status,message);}
    if(file)return response.blob();
    if(response.status===204)return {};
    return response.json();
  }
  function documentCard(doc,admin=false){
    const metadata=[['File',`${doc.filename || 'Document'} · ${size(Number(doc.size)||0)}`],['Version',doc.version],['Added',date(doc.uploadedAt)],['Review date',date(doc.reviewDate)]].filter(([,value])=>value);
    return `<article class="research-document"><span class="badge">${escape(categories[doc.category]||'Document')}</span><h3>${escape(doc.title)}</h3>${doc.description?`<p>${escape(doc.description)}</p>`:''}<dl>${metadata.map(([key,value])=>`<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join('')}</dl><div class="research-doc-actions"><button type="button" class="research-secondary" data-download="${escape(doc.id)}">Download</button>${admin?`<button type="button" class="research-remove" data-remove-document="${escape(doc.id)}">Remove document</button>`:''}</div></article>`;
  }
  function theme(){let value='light';try{value=localStorage.getItem('entomology-theme')||'light';}catch{}const update=()=>{document.documentElement.dataset.theme=value;$('theme-toggle').setAttribute('aria-pressed',String(value==='dark'));$('theme-toggle').querySelector('span').textContent=value==='dark'?'Light mode':'Dark mode';};update();$('theme-toggle').addEventListener('click',()=>{value=value==='dark'?'light':'dark';try{localStorage.setItem('entomology-theme',value);}catch{}update();});}
  async function initPortal(){
    try{const response=await fetch('admin-config.json',{cache:'no-store',credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error();const config=await response.json();const origin=new URL(config.apiBase);if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw Error();if(origin.origin!==location.origin){$('portal-link').href=origin.origin+(document.body.dataset.researchPage==='admin'?'/research-admin.html':'/research.html');$('portal-link-panel').hidden=false;status('');return false;}portal=true;return true;}catch{status('The research portal is unavailable. Please try again later or contact the toolkit administrator.','error');return false;}
  }
  theme();
  const ready=initPortal();
  window.HAUResearch={$,categories,escape,date,size,status,busy,request,documentCard,ready};
  if(document.body.dataset.researchPage!=='student')return;
  let session=null,documents=[];
  function signedOut(){session=null;documents=[];$('research-workspace').hidden=true;$('research-signin').hidden=false;$('document-list').replaceChildren();$('research-user').textContent='';$('research-expiry').textContent='';$('research-password').value='';}
  function handleError(error){if(error.status===401||error.status===403){signedOut();status('Your session has ended. Sign in with your approved email address and the current toolkit password.','error',true);}else status(error.message||'The toolkit is unavailable. Please try again.','error',true);}
  function render(){const query=$('document-search').value.toLowerCase().trim(),category=$('document-category').value;const filtered=documents.filter(doc=>(!category||doc.category===category)&&query.split(/\s+/).every(word=>[doc.title,doc.description,doc.filename,doc.version].join(' ').toLowerCase().includes(word)));$('document-list').innerHTML=filtered.map(doc=>documentCard(doc)).join('');$('document-count').textContent=`${filtered.length} of ${documents.length} documents`;$('document-empty').hidden=filtered.length>0;$('document-empty').querySelector('h3').textContent=documents.length?'No matching documents':'No documents yet';$('document-empty').querySelector('p').textContent=documents.length?'Try another keyword or document type.':'The research team will add documents here when they are ready.';}
  async function loadDocuments(){const data=await request('/research-api/documents');if(!Array.isArray(data.documents))throw Error('The document list could not be read.');documents=data.documents;render();}
  async function establish(value){if(typeof value?.user?.email!=='string'||typeof value.csrfToken!=='string')throw Error('Sign-in could not be verified.');session=value;await loadDocuments();$('research-signin').hidden=true;$('research-workspace').hidden=false;$('research-user').textContent=value.user.email;$('research-expiry').textContent=value.passwordExpiresAt?'Toolkit password valid until '+date(value.passwordExpiresAt):'';}
  async function checkSession(){if(!await ready)return;$('research-workspace').hidden=true;try{await establish(await request('/research-api/session'));status('');}catch(error){if(error.status===401){signedOut();status('');}else{signedOut();status(error.message||'The toolkit is unavailable. Please try again later.','error');}}}
  $('research-login-form').addEventListener('submit',async event=>{event.preventDefault();if(!portal)return;const form=event.currentTarget,body={email:$('research-email').value.trim(),password:$('research-password').value};busy(form,true);status('Signing in…');try{const value=await request('/research-api/login',{method:'POST',body});$('research-password').value='';await establish(value);status('');$('documents-heading').focus();}catch(error){if(session&&[401,403].includes(error.status))handleError(error);else status(error.message||'Sign-in could not be completed. Please try again.','error',true);}finally{body.password='';$('research-password').value='';busy(form,false);}});
  $('research-signout').addEventListener('click',async()=>{const button=$('research-signout');button.disabled=true;try{await request('/research-api/logout',{method:'POST',csrf:session?.csrfToken,body:{}});signedOut();status('You have signed out.');$('research-email').focus();}catch(error){handleError(error);}finally{button.disabled=false;}});
  $('research-reload').addEventListener('click',async()=>{const button=$('research-reload');button.disabled=true;try{await loadDocuments();status('Document list refreshed.','success');}catch(error){handleError(error);}finally{button.disabled=false;}});
  $('document-search').addEventListener('input',render);$('document-category').addEventListener('change',render);
  $('document-list').addEventListener('click',async event=>{const button=event.target.closest('[data-download]');if(!button)return;const doc=documents.find(item=>item.id===button.dataset.download);if(!doc)return;button.disabled=true;try{const blob=await request('/research-api/documents/'+encodeURIComponent(doc.id)+'/download',{file:true});const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=doc.filename||'research-document';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);status('Download ready: '+doc.title,'success');}catch(error){handleError(error);}finally{button.disabled=false;}});
  window.addEventListener('pageshow',event=>{if(event.persisted)checkSession();});
  checkSession();
})();
