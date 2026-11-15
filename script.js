
const svg=(d,s=16)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC={clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',pen:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',plus:'<path d="M12 5v14M5 12h14"/>',msg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'};
const $ = (id) => document.getElementById(id);
const today = () => new Date().toLocaleDateString('en-CA');
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
let templates = [];
let tasks = [];
let editingTaskId = null;

// ===== Google Sheets (Apps Script Web App) =====
const API_URL = 'https://script.google.com/macros/s/AKfycbzfWKimh7BXaKw8eoILuxbOBTP80sUZosrLk8tzhcHE8a2pLcGIZhsipCM24UckunCn/exec'; // https://script.google.com/macros/s/.../exec
const LOGO_URL = 'iconxp.png'; // Lien de votre logo (png, svg, jpg). Laissez vide pour l'icône par défaut. Remplace aussi le favicon.
if(LOGO_URL){
  document.querySelectorAll('.brand-mark').forEach(m=>{
    const fallback=m.innerHTML, img=new Image();
    m.classList.add('has-img'); m.innerHTML=''; img.alt='';
    img.onerror=()=>{m.classList.remove('has-img'); m.innerHTML=fallback;};
    img.src=LOGO_URL; m.appendChild(img);
  });
  const fav=document.querySelector('link[rel="icon"]'); if(fav) fav.href=LOGO_URL;
}
const apiReady = () => /^https:\/\/script\.google\.com\//.test(API_URL);
function api(params){
  return new Promise((resolve,reject)=>{
    const cb='tf_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
    const el=document.createElement('script');
    const done=()=>{clearTimeout(timer);delete window[cb];el.remove();};
    const timer=setTimeout(()=>{done();reject(new Error('Délai dépassé'));},20000);
    window[cb]=d=>{done();(d&&d.success===false)?reject(new Error(d.message||'Erreur serveur')):resolve(d);};
    el.onerror=()=>{done();reject(new Error('Connexion impossible'));};
    el.src=API_URL+'?'+new URLSearchParams({...params,callback:cb});
    document.head.appendChild(el);
  });
}
const S=v=>v==null?'':String(v);
const T=v=>{v=S(v);return v&&/^([=+\-@']|[\d.,:\/\- ]+$|\d+e\d+$)/i.test(v)?"'"+v:v;}; // keep Sheets from converting text
const fixTime=v=>{v=S(v);let m=v.match(/^(\d{1,2}):(\d{2})/);if(m)return m[1].padStart(2,'0')+':'+m[2];m=v.match(/T(\d{2}):(\d{2})/);return m?m[1]+':'+m[2]:'';};
const normTask=r=>({id:S(r.id),name:S(r.name),priority:S(r.priority)||'medium',time:fixTime(r.time),date:S(r.date).slice(0,10),comment:S(r.comment),status:S(r.status)||'todo'});
const normTpl=r=>({id:S(r.id),name:S(r.name),category:S(r.category),description:S(r.description)});
const outItem=(type,o)=>{const x={};Object.keys(o).forEach(k=>x[k]=T(o[k]));return x;};
const SYNC={local:'Mode local (URL non configurée)',loading:'Synchronisation…',saving:'Enregistrement…',ok:'Synchronisé',error:'Erreur de synchronisation'};
function setSync(st){document.querySelectorAll('.sync').forEach(e=>{e.dataset.s=st;e.innerHTML='<i></i>'+SYNC[st];});}
let toastTimer;
function toast(msg,err){const t=$('toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.className='toast',4500);}
let session=null; try{ session=JSON.parse(localStorage.getItem('taskflow_session')); }catch{}
const ck=k=>`taskflow_${k}_${session?.username||''}`;
function save(){ if(!session)return; try{ localStorage.setItem(ck('templates'), JSON.stringify(templates)); localStorage.setItem(ck('tasks'), JSON.stringify(tasks)); }catch{} }
let queue=Promise.resolve();
const call=p=>api({...p,token:session?.token||''});
function authFail(e){ if(e&&e.message==='Session expirée'){ logout('Session expirée. Veuillez vous reconnecter.'); return true; } return false; }
function enqueue(params){
  if(!apiReady()||!session)return;
  setSync('saving');
  queue=queue.then(()=>call(params)).then(()=>setSync('ok')).catch(e=>{ if(authFail(e))return; toast('Modification non enregistrée : '+e.message,true); return loadAll(); });
}
const push=(type,item)=>enqueue({action:'save',type,data:JSON.stringify(outItem(type,item))});
const pull=(type,id)=>enqueue({action:'delete',type,id});
async function loadAll(){
  if(!apiReady()||!session){ setSync('local'); return; }
  setSync('loading');
  try{
    const [a,b]=await Promise.all([call({action:'list',type:'task'}),call({action:'list',type:'template'})]);
    tasks=a.map(normTask); templates=b.map(normTpl); save(); render(); setSync('ok');
  }catch(e){ if(authFail(e))return; setSync('error'); toast('Chargement impossible : '+e.message,true); }
}
// ===== Authentification =====
let authMode='login';
const authErr=m=>{$('authError').textContent=m||'';};
function setAuthMode(m){
  authMode=m; authErr();
  document.querySelectorAll('.auth-tabs button').forEach(b=>b.classList.toggle('on',b.dataset.mode===m));
  $('authConfirmWrap').classList.toggle('hidden',m==='login'); $('authConfirm').required=m==='register';
  $('authTitle').textContent=m==='login'?'Connexion':'Créer un compte';
  $('authHint').textContent=m==='login'?'Entrez vos identifiants pour accéder à vos tâches.':'Première visite ? Choisissez votre identifiant et votre mot de passe.';
  $('authSubmit').textContent=m==='login'?'Se connecter':'Créer mon compte';
  $('authPass').autocomplete='off';
}
function showAuth(msg){
  document.querySelector('.app-shell').classList.add('hidden'); $('authScreen').classList.remove('hidden');
  setAuthMode('login'); authErr(msg||''); $('authUser').focus();
}
function startSession(sess){
  session=sess; localStorage.setItem('taskflow_session',JSON.stringify(sess));
  const read2=k=>{try{return JSON.parse(localStorage.getItem(ck(k)))||[];}catch{return [];}};
  tasks=read2('tasks'); templates=read2('templates');
  document.querySelectorAll('.user-name').forEach(e=>e.textContent=sess.username);
  document.querySelectorAll('.user-avatar').forEach(e=>e.textContent=sess.username[0]);
  $('authScreen').classList.add('hidden'); document.querySelector('.app-shell').classList.remove('hidden');
  showView('today'); loadAll();
}
function logout(msg){
  session=null; tasks=[]; templates=[]; localStorage.removeItem('taskflow_session');
  showAuth(typeof msg==='string'?msg:'');
}
document.querySelectorAll('.auth-tabs button').forEach(b=>b.addEventListener('click',()=>setAuthMode(b.dataset.mode)));
document.querySelectorAll('[data-logout]').forEach(b=>b.addEventListener('click',()=>logout()));
$('pwToggle').addEventListener('click',()=>{const h=$('authPass').type==='password';$('authPass').type=h?'text':'password';$('pwToggle').textContent=h?'Masquer':'Afficher';});
$('authForm').addEventListener('submit',async e=>{
  e.preventDefault(); authErr();
  const u=$('authUser').value.trim().toLowerCase(), p=$('authPass').value, btn=$('authSubmit');
  if(!apiReady()) return authErr("L'URL de l'API n'est pas configurée dans index.html (API_URL).");
  if(authMode==='register'&&p!==$('authConfirm').value) return authErr('Les mots de passe ne correspondent pas.');
  btn.disabled=true; btn.textContent='Veuillez patienter…';
  try{ const r=await api({action:authMode,username:u,password:p}); $('authForm').reset(); $('authPass').type='password'; $('pwToggle').textContent='Afficher'; startSession({token:r.token,username:r.username}); }
  catch(err){ authErr(err.message); }
  finally{ btn.disabled=false; btn.textContent=authMode==='login'?'Se connecter':'Créer mon compte'; }
});
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function safe(value=''){ return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function priorityLabel(p){ return ({high:'Haute',medium:'Moyenne',low:'Basse'})[p] || 'Moyenne'; }
function showView(view){
  $('todayView').classList.toggle('hidden', view !== 'today');
  $('libraryView').classList.toggle('hidden', view !== 'library');
  $('analyticsView').classList.toggle('hidden', view !== 'analytics');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('pageTitle').textContent = ({today:"Aujourd'hui",library:'Bibliothèque',analytics:'Analytique'})[view];
  $('headerAdd').innerHTML = svg(IC.plus,17) + (view==='library' ? ' Ajouter à la bibliothèque' : ' Nouvelle tâche');
  $('headerAdd').onclick = view==='library' ? ()=>openTemplateDialog() : ()=>openTaskDialog();
  render();
}
document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
$('dateLabel').textContent = new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
$('todayChip').textContent = new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long'}).format(new Date());
$('headerAdd').onclick = ()=>openTaskDialog();
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
$('taskFilter').addEventListener('change',renderTasks);
$('searchTemplates').addEventListener('input',renderTemplates);

function openTaskDialog(task=null, template=null){
  editingTaskId = task?.id || null;
  $('dialogTitle').textContent = task ? 'Modifier la tâche' : 'Nouvelle tâche';
  $('taskName').value = task?.name || template?.name || '';
  $('taskPriority').value = task?.priority || 'medium';
  $('taskTime').value = task?.time || '';
  $('taskDate').value = task?.date || today();
  $('taskComment').value = task?.comment || template?.description || '';
  $('taskDialog').showModal();
}
let editingTemplateId=null;
function openTemplateDialog(tpl=null){
  editingTemplateId=tpl?.id||null; $('templateForm').reset();
  $('templateDialogTitle').textContent=tpl?'Modifier la tâche habituelle':'Ajouter une tâche habituelle';
  if(tpl){$('templateName').value=tpl.name;$('templateCategory').value=tpl.category||'';$('templateDescription').value=tpl.description||'';}
  $('templateDialog').showModal();
}
$('taskForm').addEventListener('submit',e=>{
  e.preventDefault();
  const item={id:editingTaskId||uid(),name:$('taskName').value.trim(),priority:$('taskPriority').value,time:$('taskTime').value,date:$('taskDate').value,comment:$('taskComment').value.trim(),status:tasks.find(t=>t.id===editingTaskId)?.status||'todo'};
  if(!item.name)return;
  if(editingTaskId) tasks=tasks.map(t=>t.id===editingTaskId?item:t); else tasks.push(item);
  save(); push('task',item); $('taskDialog').close(); render();
});
$('templateForm').addEventListener('submit',e=>{
  e.preventDefault();
  const name=$('templateName').value.trim(); if(!name)return;
  const item={id:editingTemplateId||uid(),name,category:$('templateCategory').value.trim(),description:$('templateDescription').value.trim()};
  templates=editingTemplateId?templates.map(t=>t.id===editingTemplateId?item:t):[...templates,item];
  save(); push('template',item); $('templateDialog').close(); renderTemplates();
});
function render(){
  const todays=tasks.filter(t=>t.date===today());
  const done=todays.filter(t=>t.status==='done').length;
  const doing=todays.filter(t=>t.status==='doing').length;
  const percent=todays.length?Math.round(done/todays.length*100):0;
  $('totalCount').textContent=todays.length; $('doneCount').textContent=done; $('progressCount').textContent=doing;
  $('progressPercent').textContent=percent+'%'; $('progressPercentSmall').textContent=percent+'%';
  $('progressBar').style.width=percent+'%';
  $('progressText').textContent=todays.length?`${done} tâche(s) terminée(s) sur ${todays.length}`:'Aucune tâche pour le moment';
  renderTasks(); renderTemplates(); renderAnalytics();
}
function renderAnalytics(){
  const t0=today(), total=tasks.length, cnt=f=>tasks.filter(f).length;
  const done=cnt(x=>x.status==='done'), doing=cnt(x=>x.status==='doing'), todo=total-done-doing;
  $('aTotal').textContent=total;
  $('aRate').textContent=(total?Math.round(done/total*100):0)+'%';
  $('aLate').textContent=cnt(x=>x.date<t0&&x.status!=='done');
  $('aUrgent').textContent=cnt(x=>x.priority==='high'&&x.status!=='done');
  const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const k=d.toLocaleDateString('en-CA');
    return {k,label:new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(d).replace('.',''),n:cnt(x=>x.date===k),d:cnt(x=>x.date===k&&x.status==='done')};});
  const max=Math.max(1,...days.map(x=>x.n));
  $('weekChart').innerHTML=days.map(x=>`<div class="bar-col${x.k===t0?' now':''}"><span class="bar-val">${x.d}/${x.n}</span><div class="bar-wrap"><div class="bar" style="height:${x.n/max*100}%"><i style="height:${x.n?x.d/x.n*100:0}%"></i></div></div><span class="bar-lbl">${x.label}</span></div>`).join('');
  const pr=[['high','Haute','var(--red)'],['medium','Moyenne','var(--amber)'],['low','Basse','var(--accent)']];
  $('prioChart').innerHTML=pr.map(([k,l,c])=>{const n=cnt(x=>x.priority===k);return `<div class="hrow"><span>${l}</span><div class="htrack"><i style="width:${total?n/total*100:0}%;background:${c}"></i></div><b>${n}</b></div>`;}).join('');
  const st=[['À faire',todo,'#3b4350'],['En cours',doing,'#1d4ed8'],['Terminées',done,'#3b82f6']];
  $('statusChart').innerHTML=`<div class="stack">${st.map(([l,n,c])=>n?`<i style="flex:${n};background:${c}"></i>`:'').join('')||'<i style="flex:1;background:#171b22"></i>'}</div><ul class="slegend">${st.map(([l,n,c])=>`<li><i style="background:${c}"></i>${l}<b>${n}</b></li>`).join('')}</ul>`;
}
function renderTasks(){
  const filter=$('taskFilter').value;
  let list=tasks.filter(t=>t.date===today()&&(filter==='all'||t.status===filter));
  list.sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  $('taskList').innerHTML=list.length?list.map(t=>`
    <article class="task-card ${t.status==='done'?'is-done':''}">
      <input autocomplete="off" class="check-task" type="checkbox" ${t.status==='done'?'checked':''} aria-label="Terminer ${safe(t.name)}" data-done="${t.id}">
      <div class="task-main"><div class="task-name">${safe(t.name)}</div>
        <div class="task-meta"><span class="priority ${t.priority}">${priorityLabel(t.priority)}</span>${t.time?`<span class="meta-i">${svg(IC.clock,13)} ${safe(t.time)}</span>`:''}</div>
        ${t.comment?`<div class="comment-line meta-i">${svg(IC.msg,13)} ${safe(t.comment)}</div>`:''}
      </div>
      <div class="task-actions"><select class="status-select" data-status="${t.id}" aria-label="Statut"><option value="todo" ${t.status==='todo'?'selected':''}>À faire</option><option value="doing" ${t.status==='doing'?'selected':''}>En cours</option><option value="done" ${t.status==='done'?'selected':''}>Terminée</option></select>
      <button class="icon-btn" data-edit="${t.id}" title="Modifier" aria-label="Modifier">${svg(IC.pen)}</button><button class="icon-btn" data-delete="${t.id}" title="Supprimer" aria-label="Supprimer">${svg(IC.trash)}</button></div>
    </article>`).join(''):`<div class="empty-state"><strong>${filter==='all'?'Aucune tâche pour aujourd’hui':'Aucun résultat'}</strong>Ajoute une tâche ou choisis-en une depuis ta bibliothèque.</div>`;
  $('taskList').querySelectorAll('[data-done]').forEach(el=>el.addEventListener('change',()=>updateStatus(el.dataset.done,el.checked?'done':'todo')));
  $('taskList').querySelectorAll('[data-status]').forEach(el=>el.addEventListener('change',()=>updateStatus(el.dataset.status,el.value)));
  $('taskList').querySelectorAll('[data-edit]').forEach(el=>el.addEventListener('click',()=>openTaskDialog(tasks.find(t=>t.id===el.dataset.edit))));
  $('taskList').querySelectorAll('[data-delete]').forEach(el=>el.addEventListener('click',()=>{if(confirm('Supprimer cette tâche ?')){const id=el.dataset.delete;tasks=tasks.filter(t=>t.id!==id);save();pull('task',id);render();}}));
}
function updateStatus(id,status){tasks=tasks.map(t=>t.id===id?{...t,status}:t);save();push('task',tasks.find(t=>t.id===id));render();}
function renderTemplates(){
  const q=$('searchTemplates').value.toLowerCase();
  const list=templates.filter(t=>(t.name+' '+t.category+' '+t.description).toLowerCase().includes(q));
  $('templateCount').textContent=`${templates.length} tâche(s) enregistrée(s)`;
  $('templateList').innerHTML=list.length?list.map(t=>`
    <article class="template-card"><div class="template-top"><div><h3>${safe(t.name)}</h3><p>${safe(t.description||'Aucune description')}</p></div></div>
    ${t.category?`<span class="category">${safe(t.category)}</span>`:''}
    <div class="template-actions"><button class="primary-btn add-template" data-add-template="${t.id}">${svg(IC.plus,16)} Ajouter à aujourd'hui</button><button class="secondary-btn sq" data-template-edit="${t.id}" title="Modifier" aria-label="Modifier">${svg(IC.pen)}</button><button class="secondary-btn sq danger" data-template-delete="${t.id}" title="Supprimer" aria-label="Supprimer">${svg(IC.trash)}</button></div></article>`).join(''):`<div class="empty-state" style="grid-column:1/-1"><strong>Ta bibliothèque est vide</strong>Ajoute tes tâches habituelles pour les retrouver facilement.</div>`;
  $('templateList').querySelectorAll('[data-add-template]').forEach(b=>b.addEventListener('click',()=>openTaskDialog(null,templates.find(t=>t.id===b.dataset.addTemplate))));
  $('templateList').querySelectorAll('[data-template-delete]').forEach(b=>b.addEventListener('click',()=>{if(confirm('Supprimer cette tâche de la bibliothèque ?')){const id=b.dataset.templateDelete;templates=templates.filter(t=>t.id!==id);save();pull('template',id);renderTemplates();}}));
  $('templateList').querySelectorAll('[data-template-edit]').forEach(b=>b.addEventListener('click',()=>openTemplateDialog(templates.find(x=>x.id===b.dataset.templateEdit))));
}
session&&session.token&&session.username ? startSession(session) : showAuth();
  
// Désactive la liste de suggestions du navigateur (historique de saisie) sur les champs de l'application
document.querySelectorAll('.modal input, .modal textarea, #searchTemplates, #taskFilter').forEach(el=>{
  el.setAttribute('autocomplete','off');
  if(el.matches('input[type=text],input[type=search],textarea')){
    el.removeAttribute('name');
    el.setAttribute('readonly','');
    const unlock=()=>el.removeAttribute('readonly');
    el.addEventListener('focus',unlock); el.addEventListener('pointerdown',unlock);
  }
});
