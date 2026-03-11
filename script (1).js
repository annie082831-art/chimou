// ═══════════════════════════════════════════
//  File System Access API
// ═══════════════════════════════════════════
const FS_SUPPORTED = ('showOpenFilePicker' in window);
const IN_IFRAME    = (window.self !== window.top);

if (!FS_SUPPORTED || IN_IFRAME) {
  const warn = document.getElementById('browserWarn');
  warn.innerHTML = IN_IFRAME
    ? '⚠ <strong>目前在預覽框架內，無法使用本機 PDF 功能。</strong> 請下載 HTML 檔案後，用 Chrome / Edge 直接開啟使用。'
    : '⚠ 請使用 Chrome 或 Edge 開啟此檔案以使用本機 PDF 功能。';
  warn.classList.add('show');
}

// ── IndexedDB (file handles) ──────────────
let idb = null;
function openDB(){
  return new Promise((res,rej)=>{
    if(idb){res(idb);return}
    const req=indexedDB.open('ResearchArchive_v2',1);
    req.onupgradeneeded=e=>{const d=e.target.result;if(!d.objectStoreNames.contains('handles'))d.createObjectStore('handles')};
    req.onsuccess=e=>{idb=e.target.result;res(idb)};
    req.onerror=e=>rej(e.target.error);
  });
}
async function saveHandle(id,h){const d=await openDB();return new Promise((res,rej)=>{const tx=d.transaction('handles','readwrite');tx.objectStore('handles').put(h,id);tx.oncomplete=()=>res();tx.onerror=e=>rej(e.target.error)})}
async function getHandle(id){const d=await openDB();return new Promise((res,rej)=>{const req=d.transaction('handles','readonly').objectStore('handles').get(id);req.onsuccess=e=>res(e.target.result||null);req.onerror=e=>rej(e.target.error)})}
async function deleteHandle(id){const d=await openDB();return new Promise((res,rej)=>{const tx=d.transaction('handles','readwrite');tx.objectStore('handles').delete(id);tx.oncomplete=()=>res();tx.onerror=e=>rej(e.target.error)})}
async function verifyPermission(handle){const opts={mode:'read'};if(await handle.queryPermission(opts)==='granted')return true;if(await handle.requestPermission(opts)==='granted')return true;return false}

// ═══════════════════════════════════════════
//  Firebase Config — 請填入你的 Firebase 設定
//  Get from: console.firebase.google.com
//  → Your Project → Project Settings → Your apps
// ═══════════════════════════════════════════
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAOPEEOoFvE8LzO6mgquhAGadYHPAUcCtk",
  authDomain:        "chimoudata.firebaseapp.com",
  projectId:         "chimoudata",
  storageBucket:     "chimoudata.firebasestorage.app",
  messagingSenderId: "990808919387",
  appId:             "1:990808919387:web:f870ac372df5b0d845de7e",
  measurementId:     "G-B6NZGDYBW8"
};

// ─── Detect unconfigured ─────────────────
const FB_CONFIGURED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
let db=null, auth=null, currentUser=null;

if(FB_CONFIGURED){
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db   = firebase.firestore();
} else {
  console.warn("Firebase not configured — running in local mode");
}

// ─── Auth ────────────────────────────────
function signInWithGoogle(){
  if(!FB_CONFIGURED){
    document.getElementById('loginConfigNotice').style.display='block';
    return;
  }
  document.getElementById('loginLoading').style.display='block';
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err=>{
    document.getElementById('loginLoading').style.display='none';
    alert('登入失敗：'+err.message);
  });
}

function signOut(){
  if(auth) auth.signOut();
}

function showApp(user){
  currentUser=user;
  document.getElementById('loginOverlay').classList.add('hidden');
  // show name in logo title
  const name = user.displayName || user.email || '';
  document.getElementById('logoTitle').innerHTML =
    `雞毛資料庫<span class="logo-user"> - ${name}</span>`;
  // keep only sign-out button in chip
  const chip=document.getElementById('userChip');
  chip.innerHTML=`<img src="${user.photoURL||''}" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'"><button class="btn-signout" onclick="signOut()">登出</button>`;
}

function showLogin(){
  currentUser=null;
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginLoading').style.display='none';
  document.getElementById('userChip').innerHTML='';
  document.getElementById('logoTitle').innerHTML='雞毛資料庫';
  papers=[];projects=[];renderAll();
}

// ─── Firestore save/load ─────────────────
const STORAGE_KEY = 'research_papers_v4';
const PROJ_KEY    = 'research_projects_v1';

function userRef(){ return db.collection('users').doc(currentUser.uid); }

async function savePapers(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr)); // local cache
  if(!currentUser||!db) return;
  try{ await userRef().set({papers: arr, projects: projects}, {merge:true}); }
  catch(e){ console.error('Firestore save error',e); }
}
async function saveProjects(arr){
  localStorage.setItem(PROJ_KEY, JSON.stringify(arr));
  if(!currentUser||!db) return;
  try{ await userRef().set({papers: papers, projects: arr}, {merge:true}); }
  catch(e){ console.error('Firestore save error',e); }
}
function loadPapers(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}}
function loadProjects(){try{return JSON.parse(localStorage.getItem(PROJ_KEY)||'[]')}catch{return[]}}

async function loadFromCloud(){
  if(!currentUser||!db) return false;
  try{
    const snap = await userRef().get();
    if(snap.exists){
      const data=snap.data();
      papers   = data.papers   || [];
      projects = data.projects || [];
      // PDF: on this device, check which handles exist; if not, mark as needing re-link
      for(const p of papers){
        if(p.hasPdf){
          const h = await getHandle(p.id).catch(()=>null);
          if(!h) p._pdfMissing=true; // local only flag, not saved
        }
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(papers));
      localStorage.setItem(PROJ_KEY, JSON.stringify(projects));
      return true;
    }
    return false;
  }catch(e){ console.error('Firestore load error',e); return false; }
}

let papers   = [];
let projects = [];
let editingId    = null;
let activeTags   = new Set(); // multi-tag
let currentPage  = 1;
const PAGE_SIZE  = 20;
let activeProject = null;   // project id or null
let aiParsed     = null;    // last AI result

// seed data (runs after auth)
async function initAppData(){
  const fromCloud = await loadFromCloud();
  if(!fromCloud){ papers=loadPapers(); projects=loadProjects(); }
  // no seed data — start empty
    renderAll();
}

// ── Toast + Progress ──────────────────────
let toastTimer=null;
function showToast(msg,type='success'){const el=document.getElementById('toast');el.innerHTML=msg;el.className=`toast ${type} show`;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3500)}
function showProgress(){document.getElementById('progressBar').style.width='65%'}
function hideProgress(){const b=document.getElementById('progressBar');b.style.width='100%';setTimeout(()=>b.style.width='0',400)}

// ═══════════════════════════════════════════
//  Projects
// ═══════════════════════════════════════════
function addProject(){
  const input=document.getElementById('newProjInput');
  const name=input.value.trim();
  if(!name){showToast('請輸入資料夾名稱','error');return}
  if(projects.some(p=>p.name===name)){showToast('已有同名資料夾','error');return}
  projects.push({id:Date.now(),name});
  saveProjects(projects);
  input.value='';
  renderProjects();
  renderQuickFilters();
  showToast('資料夾已新增：'+name,'success');
}

function deleteProject(pid,e){
  e.stopPropagation();
  if(!confirm(`刪除資料夾？論文本身不會刪除。`))return;
  projects=projects.filter(p=>p.id!==pid);
  papers.forEach(p=>{p.projectIds=(p.projectIds||[]).filter(id=>id!==pid)});
  if(activeProject===pid)activeProject=null;
  saveProjects(projects);savePapers(papers);renderAll();
}

function setActiveProject(pid){
  activeProject = activeProject===pid ? null : pid;
  renderProjects();renderPapers();
  const tag=document.getElementById('activeProjectTag');
  if(activeProject){
    const proj=projects.find(p=>p.id===activeProject);
    tag.innerHTML=`<span class="active-project-tag">📁 ${proj?.name||''}<button onclick="setActiveProject(null)">×</button></span>`;
  } else {
    tag.innerHTML='';
  }
}

function togglePaperProject(paperId, projId, e){
  if(e)e.stopPropagation();
  const p=papers.find(x=>x.id===paperId);
  if(!p)return;
  p.projectIds=p.projectIds||[];
  if(p.projectIds.includes(projId)) p.projectIds=p.projectIds.filter(id=>id!==projId);
  else p.projectIds.push(projId);
  savePapers(papers);
  renderProjects();renderStats();
  // Re-render just this card's pills + dropdown
  renderPapers();
}

function renderProjects(){
  const list=document.getElementById('projectList');
  const searchEl=document.getElementById('projSearchInput');
  const query=searchEl?searchEl.value.toLowerCase():'';
  let visible=projects.filter(proj=>!query||proj.name.toLowerCase().includes(query));
  const projRows=visible.map(proj=>{
    const cnt=papers.filter(p=>(p.projectIds||[]).includes(proj.id)).length;
    return`<div class="project-item ${activeProject===proj.id?'active':''}" onclick="setActiveProject(${proj.id})">
      <span class="project-icon">📁</span>
      <span class="project-name">${proj.name}</span>
      <span class="proj-count">${cnt}</span>
      <span style="font-size:.7rem;cursor:pointer;opacity:.5;flex-shrink:0;padding:.1rem .2rem" onclick="deleteProject(${proj.id},event)" title="刪除">✕</span>
    </div>`;
  }).join('');
  const emptyMsg=visible.length===0?`<div style="font-family:var(--mono);font-size:.68rem;color:var(--ink-light);padding:.25rem .5rem;opacity:.6">${query?'無符合資料夾':'尚無資料夾，請於下方新增'}</div>`:'';
  list.innerHTML=projRows+emptyMsg;
}

// ═══════════════════════════════════════════
//  Tags sidebar
// ═══════════════════════════════════════════
let showAllTags = false;
const TAGS_DEFAULT_SHOW = 3;

function getAllTags(){
  // Sort tags by recency: collect per-tag the latest addedAt
  const tagDate={};
  papers.forEach(p=>{
    p.tags.forEach(t=>{
      const d=new Date(p.addedAt).getTime();
      if(!tagDate[t]||d>tagDate[t])tagDate[t]=d;
    });
  });
  return Object.entries(tagDate).sort((a,b)=>b[1]-a[1]).map(([t])=>t);
}

function renderTagFilters(){
  const query=document.getElementById('tagSearchInput').value.toLowerCase();
  let allTags=getAllTags();
  // candidate tags: not yet selected, matching search
  let candidates = allTags.filter(t=>!activeTags.has(t));
  if(query) candidates=candidates.filter(t=>t.toLowerCase().includes(query));

  const visibleCandidates = (showAllTags||query) ? candidates : candidates.slice(0,TAGS_DEFAULT_SHOW);
  const hasMore = !query && candidates.length > TAGS_DEFAULT_SHOW;

  // selected tags strip + header
  const strip = document.getElementById('selectedTagsStrip');
  const header = document.getElementById('selectedTagsHeader');
  if(strip){
    strip.innerHTML = activeTags.size===0 ? '' :
      [...activeTags].map(t=>`<span class="selected-tag-pill">${t} <span class="rm" onclick="removeTag('${t}')">✕</span></span>`).join('');
  }
  if(header){
    header.classList.toggle('show', activeTags.size>0);
  }

  const tagBtns=visibleCandidates.map(t=>`<span class="tag-filter" onclick="addTag('${t}')">${t}</span>`).join('');
  const moreBtn= hasMore
    ? `<button class="tag-show-more" onclick="toggleShowAllTags()">${showAllTags?'▲ 收起':'▼ 顯示全部 ('+candidates.length+')'}</button>`
    : '';
  // always show 全部 button
  const allBtn = `<span class="tag-filter ${activeTags.size===0?'active':''}" onclick="clearTags()">全部</span>`;

  document.getElementById('tagFilters').innerHTML = allBtn + tagBtns + (visibleCandidates.length===0&&!query?'':tagBtns?'':'')+moreBtn;
  document.getElementById('tagFilters').innerHTML = allBtn + tagBtns + moreBtn;
}

function toggleShowAllTags(){ showAllTags=!showAllTags; renderTagFilters(); }

function addTag(t){
  activeTags.add(t);
  document.getElementById('tagSearchInput').value=''; // clear search after picking
  showAllTags=false;
  currentPage=1; renderTagFilters(); renderPapers();
}
function removeTag(t){
  activeTags.delete(t);
  currentPage=1; renderTagFilters(); renderPapers();
}
function clearTags(){
  activeTags.clear();
  currentPage=1; renderTagFilters(); renderPapers();
}
// keep backward compat
function setTag(t){ if(t===null){clearTags();}else{addTag(t);} }

// ═══════════════════════════════════════════
//  Quick Filters  (replaces Stats)
// ═══════════════════════════════════════════
// activeQuickFilter: null | 'fav' | 'pdf'
let activeQuickFilter = null;

function setQuickFilter(type){
  activeQuickFilter = activeQuickFilter===type ? null : type;
  renderQuickFilters();
  renderPapers();
}

function renderQuickFilters(){
  const total=papers.length;
  const favs=papers.filter(p=>p.favourite).length;
  const withPdf=papers.filter(p=>p.hasPdf).length;
  document.getElementById('quickFilterGroup').innerHTML=`
    <button class="qf-btn ${activeQuickFilter===null?'active':''}" onclick="setQuickFilter(null)">
      <span class="qf-icon">📄</span>
      <span class="qf-label">全部論文</span>
      <span class="qf-count">${total}</span>
    </button>
    <button class="qf-btn ${activeQuickFilter==='fav'?'active':''}" onclick="setQuickFilter('fav')">
      <span class="qf-icon">⭐</span>
      <span class="qf-label">最愛</span>
      <span class="qf-count">${favs}</span>
    </button>
    <button class="qf-btn ${activeQuickFilter==='pdf'?'active':''}" onclick="setQuickFilter('pdf')">
      <span class="qf-icon">📌</span>
      <span class="qf-label">含 PDF</span>
      <span class="qf-count">${withPdf}</span>
    </button>`;
}

// keep old name as alias so existing calls don't break
function renderStats(){ renderQuickFilters(); }

// ═══════════════════════════════════════════
//  Render papers
// ═══════════════════════════════════════════
function renderPapers(){
  const qTitle    = document.getElementById('searchTitle')?.value.toLowerCase()||'';
  const qAuthors  = document.getElementById('searchAuthors')?.value.toLowerCase()||'';
  const qAbstract = document.getElementById('searchAbstract')?.value.toLowerCase()||'';
  const qNotes    = document.getElementById('searchNotes')?.value.toLowerCase()||'';
  const sort=document.getElementById('sortSelect').value;

  let filtered=papers.filter(p=>{
    const mt=activeTags.size===0||[...activeTags].every(t=>p.tags.includes(t));
    const mp=!activeProject||(p.projectIds||[]).includes(activeProject);
    const mf=!activeQuickFilter||(activeQuickFilter==='fav'&&p.favourite)||(activeQuickFilter==='pdf'&&p.hasPdf);
    // AND logic: each filled field must match its respective field
    const mTitle    = !qTitle    || p.title.toLowerCase().includes(qTitle);
    const mAuthors  = !qAuthors  || (p.authors||'').toLowerCase().includes(qAuthors);
    const mAbstract = !qAbstract || (p.abstract||'').toLowerCase().includes(qAbstract);
    const mNotes    = !qNotes    || (p.notes||'').toLowerCase().includes(qNotes);
    return mt&&mp&&mf&&mTitle&&mAuthors&&mAbstract&&mNotes;
  });

  filtered.sort((a,b)=>{
    if(sort==='fav-first'){
      if(a.favourite===b.favourite) return new Date(b.addedAt)-new Date(a.addedAt);
      return a.favourite?-1:1;
    }
    if(sort==='date-desc') return new Date(b.addedAt)-new Date(a.addedAt);
    if(sort==='date-asc')  return new Date(a.addedAt)-new Date(b.addedAt);
    if(sort==='year-desc') return (b.year||0)-(a.year||0);
    if(sort==='year-asc')  return (a.year||0)-(b.year||0);
    if(sort==='title')     return a.title.localeCompare(b.title);
    return 0;
  });

  const scopeTotal=papers.filter(p=>{const mp=!activeProject||(p.projectIds||[]).includes(activeProject);const mf=!activeQuickFilter||(activeQuickFilter==='fav'&&p.favourite)||(activeQuickFilter==='pdf'&&p.hasPdf);return mp&&mf;}).length;document.getElementById('resultCount').textContent=`顯示 ${filtered.length} / ${scopeTotal} 篇`;
  const grid=document.getElementById('papersGrid');
  const pgDiv=document.getElementById('pagination');
  if(!filtered.length){
    grid.innerHTML=`<div class="empty-state"><div class="empty-icon">📄</div><div class="empty-text">尚無符合的論文</div><div class="empty-sub">調整搜尋條件或新增論文</div></div>`;
    pgDiv.innerHTML='';
    return;
  }
  const totalPages=Math.ceil(filtered.length/PAGE_SIZE);
  if(currentPage>totalPages) currentPage=1;
  const start=(currentPage-1)*PAGE_SIZE;
  const pageItems=filtered.slice(start,start+PAGE_SIZE);
  grid.innerHTML=pageItems.map(p=>buildCard(p)).join('');
  renderPagination(totalPages,pgDiv);
}

function renderPagination(total,el){
  if(total<=1){el.innerHTML='';return;}
  const p=currentPage;
  let btns='';
  // Prev
  btns+=`<button class="pg-btn" onclick="goPage(${p-1})" ${p===1?'disabled':''}>◀</button>`;
  // Page numbers with ellipsis
  const pages=[];
  for(let i=1;i<=total;i++){
    if(i===1||i===total||Math.abs(i-p)<=2) pages.push(i);
    else if(pages[pages.length-1]!=='…') pages.push('…');
  }
  pages.forEach(pg=>{
    if(pg==='…') btns+=`<span class="pg-ellipsis">…</span>`;
    else btns+=`<button class="pg-btn${pg===p?' active':''}" onclick="goPage(${pg})" ${pg===p?'disabled':''}>${pg}</button>`;
  });
  // Next
  btns+=`<button class="pg-btn" onclick="goPage(${p+1})" ${p===total?'disabled':''}>▶</button>`;
  el.innerHTML=btns;
}

function goPage(n){
  currentPage=n;
  renderPapers();
  document.getElementById('papersGrid').scrollIntoView({behavior:'smooth',block:'start'});
}

function buildCard(p){
  const favIcon = p.favourite ? '⭐' : '☆';
  const tagHtml=p.tags.map(t=>{
    const cls=(t.includes('neuro')||t.includes('cilia')||t.includes('cerebel')||t.includes('medull'))?'tag-neuro':(t.includes('nlp')||t.includes('llm')||t.includes('bert'))?'tag-nlp':(t.includes('esg')||t.includes('finance'))?'tag-esg':'tag-topic';
    return`<span class="tag ${cls}">${t}</span>`;
  }).join('');
  const kpHtml=(p.keyPoints||[]).map(k=>`<div class="key-point-item"><span class="kp-bullet">▸</span><span>${k}</span></div>`).join('');

  // Project pills
  const projPills=(p.projectIds||[]).map(pid=>{
    const proj=projects.find(x=>x.id===pid);
    return proj?`<span class="proj-pill">📁 ${proj.name}</span>`:'';
  }).join('');

  // Project dropdown replaced by modal

  // PDF section
  let pdfSection;
  if(p.hasPdf){
    pdfSection=`<div class="pdf-link-box" id="pdfBox_${p.id}">
      <div class="pdf-link-row">
        <div style="font-size:1.4rem">📄</div>
        <div class="pdf-link-info">
          <div class="pdf-link-name">${p.pdfName||'document.pdf'}</div>
          <div class="pdf-link-sub" id="pdfSub_${p.id}">儲存於本機硬碟</div>
        </div>
      </div>
      <div id="pdfViewer_${p.id}"></div>
    </div>`;
  } else if(p._pdfMissing){
    pdfSection=`<div class="pdf-no-link" id="pdfBox_${p.id}" style="border-color:#ffc107;background:#fff8e1"><div class="pdf-no-link-text">📎 PDF 已登記，但此裝置尚未連結<br><span style="font-size:.65rem;opacity:.7">請重新點擊「連結本機 PDF」選取檔案</span></div></div>`;
  } else {
    pdfSection=`<div class="pdf-no-link" id="pdfBox_${p.id}">
      <div class="pdf-no-link-text">尚未連結 PDF 檔案<br><span style="font-size:.65rem;opacity:.7">點擊「連結本機 PDF」選取硬碟中的 PDF</span></div>
    </div>`;
  }

  return`<div class="paper-card" id="card_${p.id}" onclick="cardClick(${p.id},event)">
    <div class="paper-meta-top">
      <button class="fav-btn ${p.favourite?'active':''}" onclick="toggleFav(${p.id},event)" title="${p.favourite?'取消最愛':'加入最愛'}">${favIcon}</button>
      <span class="paper-year">${p.year||'—'}</span>
      <span class="paper-journal">${p.journal||''}</span>
      ${p.hasPdf?'<span class="pdf-badge linked">📎 PDF</span>':''}
    </div>
    <div class="paper-title">${p.title}</div>
    <div class="paper-authors">${p.authors||''}</div>
    <div class="paper-tags">${tagHtml}</div>
    <div class="paper-abstract-preview">${p.abstract||''}</div>
    ${projPills?`<div class="card-projects">${projPills}</div>`:''}

    <div class="paper-expanded">
      <div class="section-wrap" id="secKP_${p.id}">
        <div class="section-label">重點摘記 <span class="en">Key Points</span>
          <button class="section-toggle" onclick="toggleSection('secKP_${p.id}',event)" title="展開/收合">▼</button>
        </div>
        <div class="section-body" id="secKPBody_${p.id}">
          ${kpHtml||'<div style="font-size:.8rem;color:var(--ink-light);font-style:italic">尚無重點</div>'}
        </div>
      </div>

      <div class="section-wrap" id="secNotes_${p.id}">
        <div class="section-label">個人筆記 <span class="en">Notes</span>
          <button class="section-toggle" onclick="toggleSection('secNotes_${p.id}',event)" title="展開/收合">▼</button>
        </div>
        <div class="section-body" id="secNotesBody_${p.id}">
          <textarea class="notes-area" id="notes_${p.id}" onclick="event.stopPropagation()" onchange="updateNotes(${p.id})" placeholder="閱讀心得、相關論文、待追蹤問題…">${p.notes||''}</textarea>
        </div>
      </div>

      <div class="section-wrap collapsed" id="secPdf_${p.id}">
        <div class="section-label">PDF 全文 <span class="en">Full Text</span>
          <button class="section-toggle" onclick="toggleSection('secPdf_${p.id}',event)" title="展開/收合">▶</button>
        </div>
        <div class="section-body collapsed" id="secPdfBody_${p.id}">
          ${pdfSection}
        </div>
      </div>
      <div class="card-actions">
        <button class="collapse-btn-inline" onclick="collapseCard(${p.id},event)" title="縮回" style="margin-right:auto">▲ 縮回</button>
        ${p.doi?`<a href="${doiUrl(p.doi)}" target="_blank" class="btn-sm btn-doi" onclick="event.stopPropagation()">🚗 DOI</a>`:''}
        ${p.hasPdf
          ?`<button class="btn-sm btn-open-pdf" id="pdfToggleBtn_${p.id}" onclick="openPdf(${p.id},event)">▶ 開啟 PDF</button>
            <button class="btn-sm btn-unlink-pdf" onclick="unlinkPdf(${p.id},event)">移除 PDF</button>`
          :`<button class="btn-sm btn-link-pdf" onclick="linkPdf(${p.id},event)" ${!FS_SUPPORTED?'disabled':''}>${IN_IFRAME?'⚠ 需下載後開啟':'🔗 連結本機 PDF'}</button>`
        }
        <button class="btn-sm btn-proj-assign" onclick="openProjModal(${p.id},event)">📁 加入資料夾</button>
        <button class="btn-sm btn-edit" onclick="editPaper(${p.id},event)">編輯</button>
        <button class="btn-sm btn-delete" onclick="openDelModal(${p.id},event)">刪除論文</button>
      </div>
    </div>
  </div>`;
}

// ── Project Assign Modal ───────────────────
let projModalPaperId = null;

function openProjModal(paperId, e){
  if(e) e.stopPropagation();
  projModalPaperId = paperId;
  document.getElementById('projAssignSearch').value = '';
  document.getElementById('projAssignNew').value = '';
  renderProjModalList();
  document.getElementById('projAssignOverlay').classList.add('open');
  setTimeout(()=>document.getElementById('projAssignSearch').focus(), 100);
}

function closeProjModal(){
  document.getElementById('projAssignOverlay').classList.remove('open');
  projModalPaperId = null;
  renderPapers(); // refresh pills on cards
}

function renderProjModalList(){
  const query = document.getElementById('projAssignSearch').value.toLowerCase();
  const paper = papers.find(p=>p.id===projModalPaperId);
  const assigned = paper ? (paper.projectIds||[]) : [];
  let visible = projects.filter(p=>!query||p.name.toLowerCase().includes(query));
  const list = document.getElementById('projAssignList');
  if(!visible.length){
    list.innerHTML=`<div class="proj-modal-empty">${query?'無符合資料夾':'尚無資料夾，請於上方新增'}</div>`;
    return;
  }
  list.innerHTML = visible.map(proj=>{
    const checked = assigned.includes(proj.id);
    const cnt = papers.filter(p=>(p.projectIds||[]).includes(proj.id)).length;
    return`<div class="proj-modal-item" onclick="toggleProjFromModal(${proj.id})">
      <span class="pm-check">${checked?'✓':''}</span>
      <span class="pm-name">${proj.name}</span>
      <span class="pm-cnt">${cnt}</span>
    </div>`;
  }).join('');
}

function toggleProjFromModal(projId){
  const paper = papers.find(p=>p.id===projModalPaperId);
  if(!paper) return;
  paper.projectIds = paper.projectIds||[];
  if(paper.projectIds.includes(projId)) paper.projectIds = paper.projectIds.filter(id=>id!==projId);
  else paper.projectIds.push(projId);
  savePapers(papers);
  renderProjModalList();
  renderProjects();
}

function addProjFromModal(){
  const input = document.getElementById('projAssignNew');
  const name = input.value.trim();
  if(!name){showToast('請輸入資料夾名稱','error');return}
  if(projects.some(p=>p.name===name)){showToast('已有同名資料夾','error');return}
  const newProj = {id:Date.now(), name};
  projects.push(newProj);
  saveProjects(projects);
  // auto-assign to current paper
  const paper = papers.find(p=>p.id===projModalPaperId);
  if(paper){ paper.projectIds=paper.projectIds||[]; paper.projectIds.push(newProj.id); savePapers(papers); }
  input.value='';
  renderProjModalList();
  renderProjects();
  showToast('已新增資料夾並加入：'+name,'success');
}

document.getElementById('projAssignOverlay').addEventListener('click',e=>{
  if(e.target===document.getElementById('projAssignOverlay')) closeProjModal();
});

// ═══════════════════════════════════════════
//  Favourite toggle
// ═══════════════════════════════════════════
function toggleFav(id, e){
  e.stopPropagation();
  const p=papers.find(x=>x.id===id);
  if(!p)return;
  p.favourite=!p.favourite;
  savePapers(papers);
  renderStats();
  // update just the button without full re-render
  const btn=document.querySelector(`#card_${id} .fav-btn`);
  if(btn){btn.textContent=p.favourite?'⭐':'☆';btn.className=`fav-btn ${p.favourite?'active':''}`;btn.title=p.favourite?'取消最愛':'加入最愛';}
}

// ═══════════════════════════════════════════
//  Card helpers
// ═══════════════════════════════════════════
function cardClick(id,e){
  const card=document.getElementById('card_'+id);
  if(!card) return;
  // If already expanded, ignore clicks (let user interact freely)
  if(card.classList.contains('expanded')) return;
  // Ignore clicks on interactive elements even when collapsed
  if(e.target.closest('.fav-btn,button,a,input,textarea,select')) return;
  card.classList.add('expanded');
}
function toggleSection(wrapId, e){
  if(e) e.stopPropagation();
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  const body = wrap.querySelector('.section-body');
  const btn  = wrap.querySelector('.section-toggle');
  if(!body) return;
  const collapsed = body.classList.toggle('collapsed');
  wrap.classList.toggle('collapsed', collapsed);
  if(btn) btn.textContent = collapsed ? '▶' : '▼';
}
function expandCard(id){
  document.getElementById('card_'+id)?.classList.add('expanded');
}
function collapseCard(id,e){
  if(e)e.stopPropagation();
  const card=document.getElementById('card_'+id);
  if(card){
    card.classList.remove('expanded');
    setTimeout(()=>card.scrollIntoView({behavior:'smooth',block:'nearest'}),50);
  }
}
function toggleCard(id,e){
  if(e&&e.target.closest('.fav-btn,.notes-area,.card-actions,.proj-dropdown,.pdf-link-box a,iframe,.btn-sm,select,button,.collapse-btn'))return;
  document.getElementById('card_'+id)?.classList.toggle('expanded');
}
function doiUrl(doi){
  doi=doi.trim();
  if(doi.startsWith('http://doi.org/')) return doi.replace('http://doi.org/','https://doi.org/');
  if(doi.startsWith('https://doi.org/')) return doi;
  if(doi.startsWith('10.')) return 'https://doi.org/'+doi;
  return doi; // already a full URL
}
function onSearchInput(el){
  el.classList.toggle('has-value', el.value.length > 0);
  currentPage=1; renderPapers();
}
function clearAllSearch(){
  ['searchTitle','searchAuthors','searchAbstract','searchNotes'].forEach(id=>{
    const el=document.getElementById(id);
    if(el){el.value='';el.classList.remove('has-value');}
  });
  renderPapers();
}
function goHome(){
  // Collapse all cards, clear all filters, scroll to top
  document.querySelectorAll('.paper-card.expanded').forEach(c=>c.classList.remove('expanded'));
  clearAllSearch();
  document.getElementById('tagSearchInput').value='';activeTags.clear();
  document.getElementById('projSearchInput').value='';
  activeTags.clear(); activeProject=null; activeQuickFilter=null;
  showAllTags=false;
  document.getElementById('sortSelect').value='fav-first';
  renderAll();
  window.scrollTo({top:0,behavior:'smooth'});
  showToast('已回到主畫面','info');
}
function updateNotes(id){const p=papers.find(x=>x.id===id);const el=document.getElementById('notes_'+id);if(p&&el){p.notes=el.value;savePapers(papers)}}

// ═══════════════════════════════════════════
//  PDF (File System Access API)
// ═══════════════════════════════════════════
async function linkPdf(id,e){
  e.stopPropagation();
  if(IN_IFRAME){showToast('請下載 HTML 後用 Chrome/Edge 直接開啟','error');return}
  if(!FS_SUPPORTED){showToast('需要 Chrome/Edge','error');return}
  try{
    const [handle]=await window.showOpenFilePicker({types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}],multiple:false});
    showProgress();
    await saveHandle(id,handle);
    const p=papers.find(x=>x.id===id);
    if(p){p.hasPdf=true;p.pdfName=handle.name;savePapers(papers)}
    hideProgress();renderAll();
    showToast('🔗 已連結','success');
  }catch(err){hideProgress();if(err.name!=='AbortError')showToast(`連結失敗：${err.message||err.name}`,'error')}
}

async function openPdf(id,e){
  e.stopPropagation();
  const viewer=document.getElementById('pdfViewer_'+id);
  const btn=document.getElementById('pdfToggleBtn_'+id);
  // If already open, close it
  if(viewer&&(viewer.dataset.pdfOpen==='1'||viewer.innerHTML.includes('iframe'))){
    viewer.innerHTML='';
    viewer.dataset.pdfOpen='';
    const closeBtn=document.getElementById('pdfToggleBtn_'+id);
    if(closeBtn){closeBtn.textContent='▶ 開啟 PDF';closeBtn.className='btn-sm btn-open-pdf';closeBtn.onclick=ev=>openPdf(id,ev);}
    showToast('❌ 已關閉','info');
    return;
  }
  if(!FS_SUPPORTED){showToast('需要 Chrome/Edge','error');return}
  const handle=await getHandle(id);
  if(!handle){showToast('找不到 PDF 連結，請重新連結','error');return}
  const permitted=await verifyPermission(handle);
  if(!permitted){showToast('未獲得讀取權限','error');return}
  showProgress();
  try{
    const file=await handle.getFile();
    const url=URL.createObjectURL(file);
    if(viewer){
      viewer.dataset.pdfOpen='1';
      viewer.innerHTML=`<div class="pdf-inline-wrap">
        <div class="pdf-inline-bar">
          <span>${file.name}</span>
          <button onclick="window.open('${url}','_blank')">新分頁開啟 ↗</button>
        </div>
        <iframe src="${url}"></iframe></div>`;
    }
    // Switch button to "關閉 PDF"
    const toggleBtn=document.getElementById('pdfToggleBtn_'+id);
    if(toggleBtn){toggleBtn.textContent='■ 關閉 PDF';toggleBtn.className='btn-sm btn-close-pdf';toggleBtn.onclick=ev=>openPdf(id,ev);}
    hideProgress();showToast('✅ 已開啟','success');
  }catch(err){
    hideProgress();showToast('無法讀取檔案，可能已被移動。請重新連結。','error');
    const sub=document.getElementById('pdfSub_'+id);
    if(sub){sub.textContent='⚠ 檔案未找到，請重新連結';sub.className='pdf-link-sub warn'}
  }
}

async function unlinkPdf(id,e){
  e.stopPropagation();
  if(!confirm('取消連結？PDF 仍保留在硬碟原位。'))return;
  await deleteHandle(id);
  const p=papers.find(x=>x.id===id);
  if(p){p.hasPdf=false;p.pdfName=null;savePapers(papers)}
  renderAll();showToast('🔗 已移除連結','info');
}

// ═══════════════════════════════════════════
//  Edit / Delete / Modal
// ═══════════════════════════════════════════
function openModal(){
  editingId=null;
  document.getElementById('modalTitle').textContent='新增論文 Add Paper';
  ['fTitle','fAuthors','fJournal','fDoi','fTags','fAbstract','fKeyPoints','fNotes'].forEach(i=>document.getElementById(i).value='');
  document.getElementById('fYear').value=new Date().getFullYear();
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('open')}

function editPaper(id,e){
  e.stopPropagation();
  const p=papers.find(x=>x.id===id);if(!p)return;
  editingId=id;
  document.getElementById('modalTitle').textContent='編輯論文 Edit Paper';
  document.getElementById('fTitle').value=p.title;
  document.getElementById('fAuthors').value=p.authors||'';
  document.getElementById('fYear').value=p.year||'';
  document.getElementById('fJournal').value=p.journal||'';
  document.getElementById('fDoi').value=p.doi||'';
  document.getElementById('fTags').value=p.tags.join(', ');
  document.getElementById('fAbstract').value=p.abstract||'';
  document.getElementById('fKeyPoints').value=(p.keyPoints||[]).join('\n');
  document.getElementById('fNotes').value=p.notes||'';
  document.getElementById('modalOverlay').classList.add('open');
}

let delTargetId = null;
function openDelModal(id, e){
  if(e) e.stopPropagation();
  delTargetId = id;
  const p = papers.find(x=>x.id===id);
  if(!p) return;
  const tagHtml = p.tags.map(t=>{
    const cls=(t.includes('neuro')||t.includes('cilia')||t.includes('cerebel')||t.includes('medull'))?'tag-neuro':(t.includes('nlp')||t.includes('llm'))?'tag-nlp':(t.includes('esg'))?'tag-esg':'tag-topic';
    return `<span class="tag ${cls}">${t}</span>`;
  }).join('');
  document.getElementById('delPaperPreview').innerHTML=`
    <div class="del-paper-year">${p.year||'—'} · ${p.journal||''}</div>
    <div class="del-paper-title">${p.title}</div>
    <div class="del-paper-authors">${p.authors||''}</div>
    <div class="del-paper-tags">${tagHtml}</div>
    <div class="del-paper-abstract">${p.abstract||''}</div>`;
  document.getElementById('delModalOverlay').classList.add('open');
}
function closeDelModal(){
  document.getElementById('delModalOverlay').classList.remove('open');
  delTargetId = null;
}
function confirmDeletePaper(){
  if(!delTargetId) return;
  deleteHandle(delTargetId);
  papers = papers.filter(p=>p.id!==delTargetId);
  savePapers(papers);
  closeDelModal();
  renderAll();
  showToast('論文已刪除','success');
}
function deletePaper(id,e){ openDelModal(id,e); }

function savePaper(){
  const title=document.getElementById('fTitle').value.trim();
  if(!title){showToast('請輸入論文標題','error');return}
  const tags=document.getElementById('fTags').value.split(',').map(t=>t.trim()).filter(Boolean);
  const keyPoints=document.getElementById('fKeyPoints').value.split('\n').map(k=>k.trim()).filter(Boolean);
  const data={title,authors:document.getElementById('fAuthors').value.trim(),year:parseInt(document.getElementById('fYear').value)||null,journal:document.getElementById('fJournal').value.trim(),doi:document.getElementById('fDoi').value.trim(),tags,keyPoints,abstract:document.getElementById('fAbstract').value.trim(),notes:document.getElementById('fNotes').value.trim()};
  if(editingId){Object.assign(papers.find(x=>x.id===editingId),data)}
  else{papers.unshift({id:Date.now(),...data,favourite:false,hasPdf:false,pdfName:null,projectIds:[],addedAt:new Date().toISOString()})}
  const savedId=editingId;savePapers(papers);closeModal();renderAll();if(savedId){expandCard(savedId);}showToast('論文已儲存','success');
}

// ═══════════════════════════════════════════
//  AI Quick Fill
// ═══════════════════════════════════════════
function getStoredKey(){
  return localStorage.getItem('gemini_api_key') || localStorage.getItem('anthropic_api_key') || '';
}
function getKeyType(){
  if(localStorage.getItem('gemini_api_key')) return 'gemini';
  if(localStorage.getItem('anthropic_api_key')) return 'anthropic';
  return null;
}
function saveApiKey(){}  // legacy stub
function clearApiKey(){
  localStorage.removeItem('gemini_api_key');
  localStorage.removeItem('anthropic_api_key');
  checkApiKeyStatus();
  openAiSetup();
}
function checkApiKeyStatus(){
  const el=document.getElementById('aiKeyStatus');
  if(!el) return;
  const type=getKeyType();
  if(type==='gemini') el.textContent='🟢 Google Gemini Key 已設定 (✦ Gemini)';
  else if(type==='anthropic') el.textContent='🟢 Anthropic Claude Key 已設定';
  else el.textContent='⚠ 尚未設定 Key';
}
function switchSetupTab(tab){
  document.getElementById('setupTabGemini').style.display    = tab==='gemini'    ? 'block' : 'none';
  document.getElementById('setupTabAnthropic').style.display = tab==='anthropic' ? 'block' : 'none';
  document.getElementById('tabGemini').style.background    = tab==='gemini'    ? 'var(--accent)' : 'white';
  document.getElementById('tabGemini').style.color         = tab==='gemini'    ? 'white' : 'var(--ink-light)';
  document.getElementById('tabAnthropic').style.background = tab==='anthropic' ? 'var(--accent)' : 'white';
  document.getElementById('tabAnthropic').style.color      = tab==='anthropic' ? 'white' : 'var(--ink-light)';
}
function openAiSetup(){
  document.getElementById('aiSetupScreen').style.display='block';
  document.getElementById('aiMainScreen').style.display='none';
  document.getElementById('aiModalSub').style.display='none';
}
function openAiModal(){
  const hasKey = !!getStoredKey();
  document.getElementById('aiSetupScreen').style.display = hasKey ? 'none' : 'block';
  document.getElementById('aiMainScreen').style.display  = hasKey ? 'block' : 'none';
  document.getElementById('aiModalSub').style.display    = hasKey ? 'block' : 'none';
  if(hasKey){
    checkApiKeyStatus();
    document.getElementById('aiTitle').value='';
    document.getElementById('aiAbstract').value='';
    document.getElementById('aiEditFields').style.display='none';
    document.getElementById('aiResultSection').style.display='none';
    const rb=document.getElementById('aiResultBox');rb.style.display='none';rb.className='ai-result-box';rb.textContent='';
    document.getElementById('aiApplyBtn').disabled=true;
    aiParsed=null;
  }
  document.getElementById('setupKeyInput') && (document.getElementById('setupKeyInput').value='');
  document.getElementById('setupKeySaved') && (document.getElementById('setupKeySaved').style.display='none');
  document.getElementById('aiModalOverlay').classList.add('open');
}
function saveApiKeyFromSetup(type){
  const inputId = type==='gemini' ? 'setupGeminiInput' : 'setupAnthropicInput';
  const k=document.getElementById(inputId).value.trim();
  if(!k){alert('請先輸入 API Key');return;}
  if(type==='gemini' && k.length < 10){alert('請輸入正確的 Gemini API Key');return;}
  if(type==='anthropic' && !k.startsWith('sk-ant-')){alert('Anthropic Key 格式應為 sk-ant-…');return;}
  const storeKey = type==='gemini' ? 'gemini_api_key' : 'anthropic_api_key';
  // clear the other type
  localStorage.removeItem(type==='gemini'?'anthropic_api_key':'gemini_api_key');
  localStorage.setItem(storeKey, k);
  document.getElementById('setupKeySaved').style.display='block';
  setTimeout(()=>{ openAiModal(); }, 1200);
}
function closeAiModal(){document.getElementById('aiModalOverlay').classList.remove('open')}

async function runAiFill(){
  const title=document.getElementById('aiTitle').value.trim();
  const abstract=document.getElementById('aiAbstract').value.trim();
  if(!title&&!abstract){showToast('請輸入標題或摘要','error');return}

  const btn=document.getElementById('aiRunBtn');
  const resultBox=document.getElementById('aiResultBox');
  const resultSection=document.getElementById('aiResultSection');
  btn.disabled=true;btn.textContent='▶ 整理中…';
  resultSection.style.display='block';
  resultBox.textContent='整理中…';resultBox.style.display='block';resultBox.className='ai-result-box loading';
  document.getElementById('aiEditFields').style.display='none';

  const prompt=`你是一個論文資訊擷取助手。請從以下論文標題和摘要中，擷取結構化資訊，並嚴格按照以下 JSON 格式回傳，不要輸出任何其他文字：

{"title": "論文完整標題","authors": "作者列表（若無法判斷則留空字串）","year": 年份數字或null,"journal": "期刊或會議名稱（若無法判斷則留空字串）","tags": ["標籤1","標籤2","標籤3"],"abstract_zh": "摘要的繁體中文翻譯或摘要本身（若已是中文）","keyPoints": ["重點1","重點2","重點3","重點4","重點5"]}

標題：${title}
摘要：${abstract}

注意：
- tags 應為 3-6 個英文小寫關鍵字
- keyPoints 應為 3-5 條重點，用繁體中文表達
- abstract_zh 請提供繁體中文版本`;

  const apiKey=getStoredKey();
  const keyType=getKeyType();
  if(!apiKey){
    resultBox.style.display='block';
    resultBox.innerHTML='⚠ 請先設定 API Key（點右上角「更換 Key」）';
    document.getElementById('aiResultSection').style.display='block';
    btn.disabled=false;btn.textContent='▶ AI 整理';
    return;
  }
  resultBox.style.display='block';
  resultBox.innerHTML='⏳ AI 整理中…';
  document.getElementById('aiResultSection').style.display='block';

  let text='';
  try{
    if(keyType==='gemini'){
      const gRes=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key='+apiKey,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}]})
      });
      if(!gRes.ok){const e=await gRes.json().catch(()=>({}));throw new Error('HTTP '+gRes.status+': '+(e?.error?.message||gRes.statusText));}
      const gData=await gRes.json();
      text=gData?.candidates?.[0]?.content?.parts?.[0]?.text||'';
    } else {
      const aRes=await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-allow-browser':'true'},
        body:JSON.stringify({model:'claude-3-5-haiku-20241022',max_tokens:1000,messages:[{role:'user',content:prompt}]})
      });
      if(!aRes.ok){const e=await aRes.json().catch(()=>({}));throw new Error('HTTP '+aRes.status+': '+(e?.error?.message||aRes.statusText));}
      const aData=await aRes.json();
      text=aData?.content?.[0]?.text||'';
    }
  }catch(netErr){
    resultBox.innerHTML='⚠ 錯誤：'+netErr.message+'<br><small style="opacity:.7;line-height:1.8">請確認：① 從 https:// 網址開啟　② Key 正確　③ 網路正常</small>';
    btn.disabled=false;btn.textContent='▶ AI 整理';
    return;
  }

  resultBox.style.display='none';resultBox.className='ai-result-box';
  const jsonMatch=text.match(/\{[\s\S]*\}/);
  if(jsonMatch){
    try{
      aiParsed=JSON.parse(jsonMatch[0]);
      document.getElementById('aiEditTitle').value      = aiParsed.title||'';
      document.getElementById('aiEditAuthors').value    = aiParsed.authors||'';
      document.getElementById('aiEditYear').value       = aiParsed.year||'';
      document.getElementById('aiEditJournal').value    = aiParsed.journal||'';
      document.getElementById('aiEditTags').value       = (aiParsed.tags||[]).join(', ');
      document.getElementById('aiEditAbstract').value   = aiParsed.abstract_zh||'';
      document.getElementById('aiEditKeyPoints').value  = (aiParsed.keyPoints||[]).join('\n');
      document.getElementById('aiEditFields').style.display='block';
      document.getElementById('aiApplyBtn').disabled=false;
    }catch(parseErr){
      resultBox.style.display='block';
      resultBox.textContent='⚠ 無法解析回應，請重試: '+text.slice(0,200);
    }
  }else{
    resultBox.style.display='block';
    resultBox.textContent='⚠ 無法解析回應，請重試: '+text.slice(0,200);
  }
  btn.disabled=false;btn.textContent='▶ AI 整理';
}

function applyAiResult(){
  if(!aiParsed)return;
  // read from editable fields (user may have modified them)
  const title    = document.getElementById('aiEditTitle').value.trim();
  const authors  = document.getElementById('aiEditAuthors').value.trim();
  const year     = document.getElementById('aiEditYear').value.trim();
  const journal  = document.getElementById('aiEditJournal').value.trim();
  const tags     = document.getElementById('aiEditTags').value.trim();
  const abstract = document.getElementById('aiEditAbstract').value.trim();
  const keyPoints= document.getElementById('aiEditKeyPoints').value.trim();
  closeAiModal();
  editingId=null;
  document.getElementById('modalTitle').textContent='新增論文（AI 已填入）Add Paper';
  document.getElementById('fTitle').value=title;
  document.getElementById('fAuthors').value=authors;
  document.getElementById('fYear').value=year;
  document.getElementById('fJournal').value=journal;
  document.getElementById('fTags').value=tags;
  document.getElementById('fAbstract').value=abstract;
  document.getElementById('fKeyPoints').value=keyPoints;
  document.getElementById('fNotes').value='';
  document.getElementById('fDoi').value='';
  document.getElementById('modalOverlay').classList.add('open');
  showToast('AI 已填入資料，請補充筆記後儲存','info');
}

// ═══════════════════════════════════════════
//  Import / Export
// ═══════════════════════════════════════════
function exportJSON(){
  const blob=new Blob([JSON.stringify({papers,projects},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`research_archive_${new Date().toISOString().slice(0,10)}.json`;a.click();
  showToast('已匯出（含資料夾資訊）','success');
}
function importJSON(e){
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=ev=>{
    try{
      const data=JSON.parse(ev.target.result);
      // support both {papers,projects} format and plain array
      const importedPapers=Array.isArray(data)?data:(data.papers||[]);
      const importedProjects=Array.isArray(data)?[]:(data.projects||[]);
      if(confirm(`匯入 ${importedPapers.length} 篇論文、${importedProjects.length} 個資料夾？`)){
        const pids=new Set(papers.map(p=>p.id));
        importedPapers.forEach(p=>{if(!pids.has(p.id))papers.push(p)});
        const prjids=new Set(projects.map(p=>p.id));
        importedProjects.forEach(p=>{if(!prjids.has(p.id))projects.push(p)});
        savePapers(papers);saveProjects(projects);renderAll();
        showToast(`已匯入 ${importedPapers.length} 篇`,'success');
      }
    }catch{showToast('JSON 格式錯誤','error')}
  };
  reader.readAsText(file);e.target.value='';
}

// ═══════════════════════════════════════════
//  Global events
// ═══════════════════════════════════════════
// modal only closes via buttons (save / cancel)
// AI modal only closes via button
document.getElementById('delModalOverlay').addEventListener('click',e=>{
  if(e.target===document.getElementById('delModalOverlay')) closeDelModal();
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){closeModal();closeAiModal();closeDelModal()}
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();document.getElementById('searchTitle').focus()}
});

function renderAll(){renderTagFilters();renderProjects();renderStats();renderPapers()}

// ── Auth state ────────────────────────────
if(FB_CONFIGURED){
  auth.onAuthStateChanged(async user=>{
    if(user){
      showApp(user);
      await initAppData();
    } else {
      showLogin();
    }
  });
} else {
  // Firebase not configured — show login with local-mode notice
  document.getElementById('loginConfigNotice').style.display='block';
  // Replace Google button with a "enter directly" button
  document.querySelector('.btn-google').outerHTML=`<button class="btn-google" onclick="enterLocalMode()">⚡ 本機模式進入（未設定 Firebase）</button>`;
}
function enterLocalMode(){
  document.getElementById('loginOverlay').classList.add('hidden');
  papers=loadPapers(); projects=loadProjects();
  initAppData();
}
openDB();