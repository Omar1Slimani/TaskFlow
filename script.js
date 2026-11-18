

const svg=(d,s=16)=>`<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const IC={clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',pen:'<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',plus:'<path d="M12 5v14M5 12h14"/>',msg:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'};
const $ = (id) => document.getElementById(id);
const today = () => new Date().toLocaleDateString('en-CA');
const read = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
let templates = [];
let tasks = [];
let editingTaskId = null;
// ----- Jour affiché (null = aujourd'hui, suit automatiquement le changement de jour) -----
let viewDate = null;
const curDate = () => viewDate || today();
const ymd = ds => ds.split('-').map(Number);
const fmtDay = ds => { const [y,m,d]=ymd(ds); return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(y,m-1,d)); };
const shiftDay = (ds,n) => { const [y,m,d]=ymd(ds); return new Date(y,m-1,d+n).toLocaleDateString('en-CA'); };
// Tâches du jour affiché + (si on est aujourd'hui) les tâches non terminées des jours précédents
const visibleTasks = () => { const c=curDate(), t=today(); return tasks.filter(x => x.date===c || (c===t && x.date<t && x.status!=='done' && x.status!=='undone')); };

// ===== Google Sheets (Apps Script Web App) =====
const API_URL = 'https://script.google.com/macros/s/AKfycbzI38oV_y95mR1R2ynamz_1fuIHSmU7wgSrdNLVBgWHODqHZUDKgeTZCoY7ghwzhDQv/exec'; // https://script.google.com/macros/s/.../exec
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
// ===== Profil (nom affiché + photo) =====
let profile={displayName:'',avatar:''};
const AVATAR_RE=/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
const dispName=u=>(u&&u.displayName)||(u&&u.username)||'';
const avatarHtml=(av,name)=>AVATAR_RE.test(av||'')?`<img src="${av}" alt="">`:safe(String(name||'?').trim().charAt(0)||'?');
function saveProfileLocal(){ try{ localStorage.setItem(ck('profile'),JSON.stringify(profile)); }catch{} }
function renderIdentity(){
  if(!session)return;
  const nm=profile.displayName||session.username;
  document.querySelectorAll('.user-name').forEach(e=>e.textContent=nm);
  document.querySelectorAll('.user-avatar').forEach(e=>e.innerHTML=avatarHtml(profile.avatar,nm));
  $('pfAvatar').innerHTML=avatarHtml(profile.avatar,nm);
  $('pfRemove').classList.toggle('hidden',!profile.avatar);
}
function renderProfileForm(){
  if(!session)return;
  $('pfUser').value=session.username; $('pfName').value=profile.displayName||'';
  ['pfError','pwError'].forEach(i=>{$(i).textContent='';});
  renderIdentity();
}
async function loadProfile(){
  if(!apiReady()||!session)return;
  try{
    const r=await call({action:'profile'});
    profile={displayName:S(r.displayName),avatar:S(r.avatar)}; saveProfileLocal(); renderIdentity();
    if(!$('profileView').classList.contains('hidden')) renderProfileForm();
  }catch(e){ authFail(e); }
}
function startSession(sess){
  session=sess; localStorage.setItem('taskflow_session',JSON.stringify(sess));
  const read2=k=>{try{return JSON.parse(localStorage.getItem(ck(k)))||[];}catch{return [];}};
  tasks=read2('tasks'); templates=read2('templates');
  try{ const pr=JSON.parse(localStorage.getItem(ck('profile'))); profile={displayName:S(pr&&pr.displayName),avatar:S(pr&&pr.avatar)}; }catch{ profile={displayName:'',avatar:''}; }
  renderIdentity();
  $('authScreen').classList.add('hidden'); document.querySelector('.app-shell').classList.remove('hidden');
  showView('today'); loadAll(); loadProfile();
}
function logout(msg){
  ratingsData=null; ratingsUser=null; profile={displayName:'',avatar:''}; session=null; tasks=[]; templates=[]; localStorage.removeItem('taskflow_session');
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
  $('ratingsView').classList.toggle('hidden', view !== 'ratings');
  $('profileView').classList.toggle('hidden', view !== 'profile');
  $('headerAdd').classList.toggle('hidden', view==='ratings'||view==='profile');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('pageTitle').textContent = ({today:"Aujourd'hui",library:'Bibliothèque',analytics:'Analytique',ratings:'Évaluations',profile:'Profil'})[view];
  $('headerAdd').innerHTML = svg(IC.plus,17) + (view==='library' ? ' Ajouter à la bibliothèque' : ' Nouvelle tâche');
  $('headerAdd').onclick = view==='library' ? ()=>openTemplateDialog() : ()=>openTaskDialog();
  render();
  if(view==='ratings'){ ratingsUser=null; loadRatings(); }
  if(view==='profile'){ renderProfileForm(); loadProfile(); }
}
document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
function updateDates(){
  const c=curDate(), isT=c===today();
  $('dateLabel').textContent = new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());
  $('todayChip').textContent = isT ? new Intl.DateTimeFormat('fr-FR',{day:'numeric',month:'long'}).format(new Date()) : fmtDay(c);
  $('dayLabel').textContent = isT ? "Aujourd'hui" : fmtDay(c);
  $('dayToday').classList.toggle('hidden', isT);
}
$('dayPrev').addEventListener('click',()=>{viewDate=shiftDay(curDate(),-1);render();});
$('dayNext').addEventListener('click',()=>{viewDate=shiftDay(curDate(),1);render();});
$('dayToday').addEventListener('click',()=>{viewDate=null;render();});
let lastDay = today();
const checkNewDay = () => { if(today()!==lastDay){ lastDay=today(); render(); } };
setInterval(checkNewDay, 30000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) checkNewDay(); });
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
  $('taskDate').value = task?.date || (template ? today() : curDate());
  $('taskComment').value = task?.comment || template?.description || '';
  const sel=$('taskTemplate'), pick=$('templatePick');
  if(!task && templates.length){
    sel.innerHTML='<option value="">— Saisie manuelle —</option>'+templates.map(t=>`<option value="${safe(t.id)}">${safe(t.name)}${t.category?' · '+safe(t.category):''}</option>`).join('');
    sel.value = template ? template.id : '';
    pick.classList.remove('hidden');
  } else pick.classList.add('hidden');
  $('taskDialog').showModal();
}
$('taskTemplate').addEventListener('change',e=>{
  const t=templates.find(x=>x.id===e.target.value);
  if(!t) return;
  $('taskName').value=t.name; $('taskComment').value=t.description||'';
});
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
  updateDates();
  const todays=visibleTasks();
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
  const done=cnt(x=>x.status==='done'), doing=cnt(x=>x.status==='doing'), undone=cnt(x=>x.status==='undone'), todo=total-done-doing-undone;
  $('aTotal').textContent=total;
  $('aRate').textContent=(total?Math.round(done/total*100):0)+'%';
  $('aLate').textContent=cnt(x=>x.date<t0&&x.status!=='done'&&x.status!=='undone');
  $('aUrgent').textContent=cnt(x=>x.priority==='high'&&x.status!=='done');
  const days=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const k=d.toLocaleDateString('en-CA');
    return {k,label:new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(d).replace('.',''),n:cnt(x=>x.date===k),d:cnt(x=>x.date===k&&x.status==='done')};});
  const max=Math.max(1,...days.map(x=>x.n));
  $('weekChart').innerHTML=days.map(x=>`<div class="bar-col${x.k===t0?' now':''}"><span class="bar-val">${x.d}/${x.n}</span><div class="bar-wrap"><div class="bar" style="height:${x.n/max*100}%"><i style="height:${x.n?x.d/x.n*100:0}%"></i></div></div><span class="bar-lbl">${x.label}</span></div>`).join('');
  const pr=[['high','Haute','var(--red)'],['medium','Moyenne','var(--amber)'],['low','Basse','var(--accent)']];
  $('prioChart').innerHTML=pr.map(([k,l,c])=>{const n=cnt(x=>x.priority===k);return `<div class="hrow"><span>${l}</span><div class="htrack"><i style="width:${total?n/total*100:0}%;background:${c}"></i></div><b>${n}</b></div>`;}).join('');
  const st=[['À faire',todo,'#3b4350'],['En cours',doing,'#1d4ed8'],['Terminées',done,'#3b82f6'],['Pas terminé',undone,'#f2b84b']];
  $('statusChart').innerHTML=`<div class="stack">${st.map(([l,n,c])=>n?`<i style="flex:${n};background:${c}"></i>`:'').join('')||'<i style="flex:1;background:#171b22"></i>'}</div><ul class="slegend">${st.map(([l,n,c])=>`<li><i style="background:${c}"></i>${l}<b>${n}</b></li>`).join('')}</ul>`;
}
function renderTasks(){
  const filter=$('taskFilter').value;
  let list=visibleTasks().filter(t=>filter==='all'||t.status===filter);
  list.sort((a,b)=>(a.time||'99:99').localeCompare(b.time||'99:99'));
  $('taskList').innerHTML=list.length?list.map(t=>`
    <article class="task-card ${t.status==='done'?'is-done':''} ${t.status==='undone'?'is-undone':''}">
      <input autocomplete="off" class="check-task" type="checkbox" ${t.status==='done'?'checked':''} aria-label="Terminer ${safe(t.name)}" data-done="${t.id}">
      <div class="task-main"><div class="task-name">${safe(t.name)}</div>
        <div class="task-meta"><span class="priority ${t.priority}">${priorityLabel(t.priority)}</span>${t.date!==curDate()?`<span class="late-badge">En retard · ${safe(t.date.slice(5).split('-').reverse().join('/'))}</span>`:''}${t.status==='undone'?'<span class="undone-badge">Pas terminé</span>':''}${t.time?`<span class="meta-i">${svg(IC.clock,13)} ${safe(t.time)}</span>`:''}</div>
        ${t.comment?`<div class="comment-line meta-i">${svg(IC.msg,13)} ${safe(t.comment)}</div>`:''}
      </div>
      <div class="task-actions"><select class="status-select" data-status="${t.id}" aria-label="Statut"><option value="todo" ${t.status==='todo'?'selected':''}>À faire</option><option value="doing" ${t.status==='doing'?'selected':''}>En cours</option><option value="done" ${t.status==='done'?'selected':''}>Terminée</option><option value="undone" ${t.status==='undone'?'selected':''}>Pas terminé</option></select>
      <button class="icon-btn" data-edit="${t.id}" title="Modifier" aria-label="Modifier">${svg(IC.pen)}</button><button class="icon-btn" data-delete="${t.id}" title="Supprimer" aria-label="Supprimer">${svg(IC.trash)}</button></div>
    </article>`).join(''):`<div class="empty-state"><strong>${filter==='all'?(curDate()===today()?'Aucune tâche pour aujourd’hui':'Aucune tâche ce jour-là'):'Aucun résultat'}</strong>Ajoute une tâche ou choisis-en une depuis ta bibliothèque.</div>`;
  $('taskList').querySelectorAll('[data-done]').forEach(el=>el.addEventListener('change',()=>updateStatus(el.dataset.done,el.checked?'done':'todo')));
  $('taskList').querySelectorAll('[data-status]').forEach(el=>el.addEventListener('change',()=>updateStatus(el.dataset.status,el.value)));
  $('taskList').querySelectorAll('[data-edit]').forEach(el=>el.addEventListener('click',()=>openTaskDialog(tasks.find(t=>t.id===el.dataset.edit))));
  $('taskList').querySelectorAll('[data-delete]').forEach(el=>el.addEventListener('click',()=>{if(confirm('Supprimer cette tâche ?')){const id=el.dataset.delete;tasks=tasks.filter(t=>t.id!==id);save();pull('task',id);render();}}));
}
function updateStatus(id,status){
  const old=tasks.find(t=>t.id===id);
  tasks=tasks.map(t=>t.id===id?{...t,status}:t);save();push('task',tasks.find(t=>t.id===id));render();
  if(status==='undone'&&old&&old.date<today()&&curDate()===today()) toast('Tâche déplacée au '+old.date.slice(5).split('-').reverse().join('/'));
}
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
// ----- Profil : handlers -----
document.querySelectorAll('.user-avatar,.user-name').forEach(e=>e.addEventListener('click',()=>showView('profile')));
const AVATAR_PX=128, AVATAR_MAX=26000;
function makeAvatar(file){
  return new Promise((resolve,reject)=>{
    if(!/^image\//.test(file.type)) return reject(new Error('Fichier non valide : choisissez une image.'));
    const url=URL.createObjectURL(file), img=new Image();
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Impossible de lire cette image."));};
    img.onload=()=>{
      URL.revokeObjectURL(url);
      const c=document.createElement('canvas'); c.width=c.height=AVATAR_PX;
      const x=c.getContext('2d'); x.fillStyle='#14171d'; x.fillRect(0,0,AVATAR_PX,AVATAR_PX);
      const m=Math.min(img.width,img.height), sx=(img.width-m)/2, sy=(img.height-m)/2;
      x.drawImage(img,sx,sy,m,m,0,0,AVATAR_PX,AVATAR_PX);
      let q=.8, d=c.toDataURL('image/jpeg',q);
      while(d.length>AVATAR_MAX&&q>.3){ q-=.1; d=c.toDataURL('image/jpeg',q); }
      d.length>AVATAR_MAX?reject(new Error('Image trop lourde.')):resolve(d);
    };
    img.src=url;
  });
}
async function uploadAvatar(d){
  const size=1500, n=Math.ceil(d.length/size);
  for(let i=0;i<n;i++) await call({action:'avatarChunk',i,n,part:d.slice(i*size,(i+1)*size)});
}
$('pfPick').addEventListener('click',()=>$('pfFile').click());
$('pfFile').addEventListener('change',async e=>{
  const f=e.target.files[0]; e.target.value=''; if(!f)return;
  if(!apiReady()||!session)return;
  setSync('saving');
  try{
    const d=await makeAvatar(f); await uploadAvatar(d);
    profile.avatar=d; saveProfileLocal(); renderIdentity(); setSync('ok'); toast('Photo mise à jour');
  }catch(err){ if(authFail(err))return; setSync('error'); toast(err.message,true); }
});
$('pfRemove').addEventListener('click',async()=>{
  if(!profile.avatar||!confirm('Supprimer votre photo ?'))return;
  setSync('saving');
  try{ await call({action:'saveProfile',removeAvatar:'1'}); profile.avatar=''; saveProfileLocal(); renderIdentity(); setSync('ok'); toast('Photo supprimée'); }
  catch(err){ if(authFail(err))return; setSync('error'); toast(err.message,true); }
});
$('profileForm').addEventListener('submit',async e=>{
  e.preventDefault(); $('pfError').textContent='';
  const name=$('pfName').value.trim(), btn=e.submitter||e.target.querySelector('button[type=submit]');
  if(btn)btn.disabled=true; setSync('saving');
  try{
    const r=await call({action:'saveProfile',displayName:name});
    profile.displayName=S(r.displayName); saveProfileLocal(); renderIdentity(); $('pfName').value=profile.displayName; setSync('ok'); toast('Profil enregistré');
  }catch(err){ if(authFail(err))return; setSync('error'); $('pfError').textContent=err.message; }
  finally{ if(btn)btn.disabled=false; }
});
$('pwForm').addEventListener('submit',async e=>{
  e.preventDefault(); $('pwError').textContent='';
  const o=$('pwOld').value, n=$('pwNew').value, c=$('pwConf').value, btn=e.submitter||e.target.querySelector('button[type=submit]');
  if(n.length<6) return $('pwError').textContent='Le nouveau mot de passe doit contenir au moins 6 caractères.';
  if(n!==c) return $('pwError').textContent='Les mots de passe ne correspondent pas.';
  if(n===o) return $('pwError').textContent='Le nouveau mot de passe doit être différent de l’actuel.';
  if(btn)btn.disabled=true;
  try{ await call({action:'changePassword',oldPassword:o,newPassword:n}); e.target.reset(); toast('Mot de passe modifié'); }
  catch(err){ if(authFail(err))return; $('pwError').textContent=err.message; }
  finally{ if(btn)btn.disabled=false; }
});
// ===== Évaluations (classement sans noms de tâches) =====
let ratingsData=null, ratingsUser=null;
const pctOf=(d,n)=>n?Math.round(d/n*100):0;
function rankUsers(list){
  const act=list.filter(u=>u.today.total>0).sort((a,b)=>pctOf(b.today.done,b.today.total)-pctOf(a.today.done,a.today.total)||b.today.done-a.today.done||b.today.total-a.today.total||a.username.localeCompare(b.username));
  const idle=list.filter(u=>!u.today.total).sort((a,b)=>a.username.localeCompare(b.username));
  act.forEach((u,i)=>u.rank=i+1); idle.forEach(u=>u.rank=0);
  return [...act,...idle];
}
function userState(u){
  const t=u.today, p=pctOf(t.done,t.total);
  if(!t.total) return ["Aucune tâche aujourd'hui",'var(--muted)'];
  if(p===100) return ['Journée terminée','var(--accent)'];
  if(p>=75) return ['Presque terminé','var(--accent)'];
  if(t.done+t.doing===0) return ['Pas encore commencé','var(--muted)'];
  return ['En cours','var(--amber)'];
}
async function loadRatings(){
  const box=$('ratingsList');
  $('ratingsDetail').classList.add('hidden'); $('ratingsListWrap').classList.remove('hidden');
  if(!apiReady()||!session){ box.innerHTML='<div class="empty-state"><strong>Indisponible</strong>Connectez-vous pour voir les évaluations.</div>'; return; }
  if(!ratingsData) box.innerHTML='<div class="empty-state"><strong>Chargement…</strong></div>';
  try{
    const d=await call({action:'ratings',today:today()});
    ratingsData=rankUsers(d); renderRatings();
  }catch(e){
    if(authFail(e))return;
    const old=/Unknown action/i.test(e.message);
    box.innerHTML=`<div class="empty-state"><strong>Impossible de charger les évaluations</strong>${old?'Mettez à jour le script Google Apps Script (Code.gs) puis redéployez-le.':safe(e.message)}</div>`;
  }
}
function renderRatings(){
  if(ratingsUser){ const u=(ratingsData||[]).find(x=>x.username===ratingsUser); if(u) return renderRatingDetail(u); ratingsUser=null; }
  $('ratingsDetail').classList.add('hidden'); $('ratingsListWrap').classList.remove('hidden');
  const list=ratingsData||[];
  $('ratingsList').innerHTML=list.length?list.map(u=>{
    const t=u.today, p=pctOf(t.done,t.total), [lbl,col]=userState(u), me=session&&u.username===session.username;
    return `<button type="button" class="rank-card${me?' me':''}" data-user="${safe(u.username)}">
      <span class="rank-num${u.rank&&u.rank<=3?' r'+u.rank:''}">${u.rank||'–'}</span>
      <span class="rank-av">${avatarHtml(u.avatar,dispName(u))}</span>
      <div class="rank-main">
        <div class="rank-top"><span class="rank-name"><span class="n">${safe(dispName(u))}</span>${me?'<span class="rank-you">VOUS</span>':''}</span><span class="rank-pct">${t.total?p+'%':'—'}</span></div>
        <div class="htrack"><i style="width:${p}%;background:${col==='var(--muted)'?'#3b4350':col}"></i></div>
        <div class="rank-sub"><span class="rank-tag" style="color:${col}">${lbl}</span><span>${t.total?`${t.done}/${t.total} terminée(s)`:''}</span></div>
      </div></button>`;
  }).join(''):'<div class="empty-state"><strong>Aucun utilisateur</strong></div>';
}
function donutSvg(parts,total,center){
  const R=15.915; let off=25;
  const segs=total?parts.filter(p=>p[1]>0).map(([l,n,c])=>{const len=n/total*100;const x=`<circle r="${R}" cx="21" cy="21" fill="none" stroke="${c}" stroke-width="5" stroke-dasharray="${len} ${100-len}" stroke-dashoffset="${off}"/>`;off-=len;return x;}).join(''):'';
  return `<svg class="donut" viewBox="0 0 42 42" role="img" aria-label="Répartition des tâches du jour"><circle r="${R}" cx="21" cy="21" fill="none" stroke="#171b22" stroke-width="5"/>${segs}<text x="21" y="21.6" text-anchor="middle" dominant-baseline="middle" font-size="7.5" font-weight="800" fill="#eef2f8">${center}</text></svg>`;
}
function renderRatingDetail(u){
  ratingsUser=u.username;
  $('ratingsListWrap').classList.add('hidden'); const box=$('ratingsDetail'); box.classList.remove('hidden');
  const t=u.today, p=pctOf(t.done,t.total), [lbl]=userState(u), t0=today();
  const todoToday=t.total-t.done-t.doing-t.undone;
  const parts=[['Terminées',t.done,'#3b82f6'],['En cours',t.doing,'#1d4ed8'],['À faire',todoToday,'#3b4350'],['Pas terminé',t.undone,'#f2b84b']];
  const max=Math.max(1,...u.week.map(x=>x.n));
  const bars=u.week.map(x=>{const [y,m,d]=ymd(x.k);const lb=new Intl.DateTimeFormat('fr-FR',{weekday:'short'}).format(new Date(y,m-1,d)).replace('.','');
    return `<div class="bar-col${x.k===t0?' now':''}"><span class="bar-val">${x.d}/${x.n}</span><div class="bar-wrap"><div class="bar" style="height:${x.n/max*100}%"><i style="height:${x.n?x.d/x.n*100:0}%"></i></div></div><span class="bar-lbl">${lb}</span></div>`;}).join('');
  const all=[['Terminées',u.done,'#3b82f6'],['En cours',u.doing,'#1d4ed8'],['À faire',u.todo,'#3b4350'],['Pas terminé',u.undone,'#f2b84b']];
  box.innerHTML=`
    <div class="rd-head"><button type="button" class="secondary-btn" id="ratingsBack">← Retour</button><span class="rank-av rd-av">${avatarHtml(u.avatar,dispName(u))}</span><h2>${safe(dispName(u))}</h2><span class="today-chip">${u.rank?'Rang n°'+u.rank:'Sans classement'}</span></div>
    <div class="stats-grid">
      <article class="stat-card"><div><p>Progression du jour</p><strong>${t.total?p+'%':'—'}</strong></div></article>
      <article class="stat-card"><div><p>Terminées aujourd'hui</p><strong>${t.done}/${t.total}</strong></div></article>
      <article class="stat-card"><div><p>Taux de réussite global</p><strong>${pctOf(u.done,u.total)}%</strong></div></article>
      <article class="stat-card"><div><p>Total des tâches</p><strong>${u.total}</strong></div></article>
    </div>
    <section class="analytics-card plain"><div class="section-heading"><div><h2>Activité des 7 derniers jours</h2><p>Tâches planifiées et terminées par jour</p></div>
      <div class="legend"><span><i style="background:#232a35"></i>Planifiées</span><span><i style="background:var(--accent)"></i>Terminées</span></div></div><div class="bars">${bars}</div></section>
    <div class="two-col">
      <section class="analytics-card plain"><div class="section-heading"><div><h2>Aujourd'hui</h2><p>${safe(lbl)}</p></div></div>
        <div class="donut-wrap">${donutSvg(parts,t.total,t.total?p+'%':'—')}<ul class="slegend">${parts.map(([l,n,c])=>`<li><i style="background:${c}"></i>${l}<b>${n}</b></li>`).join('')}</ul></div></section>
      <section class="analytics-card plain"><div class="section-heading"><div><h2>Toutes les tâches</h2><p>Répartition par statut</p></div></div>
        <div class="stack">${all.map(([l,n,c])=>n?`<i style="flex:${n};background:${c}"></i>`:'').join('')||'<i style="flex:1;background:#171b22"></i>'}</div>
        <ul class="slegend">${all.map(([l,n,c])=>`<li><i style="background:${c}"></i>${l}<b>${n}</b></li>`).join('')}</ul></section>
    </div>`;
  $('ratingsBack').onclick=()=>{ratingsUser=null;renderRatings();};
}
$('ratingsList').addEventListener('click',e=>{const b=e.target.closest('[data-user]'); if(!b)return; const u=(ratingsData||[]).find(x=>x.username===b.dataset.user); if(u){renderRatingDetail(u);window.scrollTo({top:0});}});
$('ratingsRefresh').addEventListener('click',loadRatings);

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

