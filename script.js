/* script.js - Research Archive */

// File System Access API
var FS_SUPPORTED = ('showOpenFilePicker' in window);
var IN_IFRAME    = (window.self !== window.top);

if (!FS_SUPPORTED || IN_IFRAME) {
  var warn = document.getElementById('browserWarn');
  warn.innerHTML = IN_IFRAME
    ? '&#9888; <strong>&#30446;&#21069;&#22312;&#39165;&#35226;&#26694;&#26550;&#20839;&#65292;&#28961;&#27861;&#20351;&#29992;&#26412;&#27231; PDF &#21151;&#33021;&#12290;</strong> &#35531;&#19979;&#36617; HTML &#6511;&#26696;&#24460;&#65292;&#29992; Chrome / Edge &#30456;&#25509;&#38283;&#21839;&#20351;&#29992;&#12290;'
    : '&#9888; &#35531;&#20351;&#29992; Chrome &#25110; Edge &#38283;&#21839;&#27492;&#6511;&#26696;&#20197;&#20351;&#29992;&#26412;&#27231; PDF &#21151;&#33021;&#12290;';
  warn.classList.add('show');
}

// IndexedDB (file handles)
var idb = null;
function openDB(){
  return new Promise(function(res,rej){
    if(idb){res(idb);return;}
    var req=indexedDB.open('ResearchArchive_v2',1);
    req.onupgradeneeded=function(e){var d=e.target.result;if(!d.objectStoreNames.contains('handles'))d.createObjectStore('handles');};
    req.onsuccess=function(e){idb=e.target.result;res(idb);};
    req.onerror=function(e){rej(e.target.error);};
  });
}
function saveHandle(id,h){return openDB().then(function(d){return new Promise(function(res,rej){var tx=d.transaction('handles','readwrite');tx.objectStore('handles').put(h,id);tx.oncomplete=function(){res();};tx.onerror=function(e){rej(e.target.error);};});}); }
function getHandle(id){return openDB().then(function(d){return new Promise(function(res,rej){var req=d.transaction('handles','readonly').objectStore('handles').get(id);req.onsuccess=function(e){res(e.target.result||null);};req.onerror=function(e){rej(e.target.error);};});}); }
function deleteHandle(id){return openDB().then(function(d){return new Promise(function(res,rej){var tx=d.transaction('handles','readwrite');tx.objectStore('handles').delete(id);tx.oncomplete=function(){res();};tx.onerror=function(e){rej(e.target.error);};});}); }
function verifyPermission(handle){
  var opts={mode:'read'};
  return handle.queryPermission(opts).then(function(r){
    if(r==='granted')return true;
    return handle.requestPermission(opts).then(function(r2){return r2==='granted';});
  });
}

// Firebase Config
var FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAOPEEOoFvE8LzO6mgquhAGadYHPAUcCtk",
  authDomain:        "chimoudata.firebaseapp.com",
  projectId:         "chimoudata",
  storageBucket:     "chimoudata.firebasestorage.app",
  messagingSenderId: "990808919387",
  appId:             "1:990808919387:web:f870ac372df5b0d845de7e",
  measurementId:     "G-B6NZGDYBW8"
};

var FB_CONFIGURED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
var db=null, auth=null, currentUser=null;

if(FB_CONFIGURED){
  firebase.initializeApp(FIREBASE_CONFIG);
  auth = firebase.auth();
  db   = firebase.firestore();
} else {
  console.warn("Firebase not configured");
}

// Auth
function signInWithGoogle(){
  if(!FB_CONFIGURED){
    document.getElementById('loginConfigNotice').style.display='block';
    return;
  }
  document.getElementById('loginLoading').style.display='block';
  var provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(function(err){
    document.getElementById('loginLoading').style.display='none';
    alert('Login failed: '+err.message);
  });
}

function signOut(){
  if(auth) auth.signOut();
}

function showApp(user){
  currentUser=user;
  document.getElementById('loginOverlay').classList.add('hidden');
  var name = user.displayName || user.email || '';
  document.getElementById('logoTitle').innerHTML =
    '\u96DE\u6BDB\u8CC7\u6599\u5EAB<span class="logo-user"> - '+name+'</span>';
  var chip=document.getElementById('userChip');
  chip.innerHTML='<img src="'+(user.photoURL||'')+'" style="width:24px;height:24px;border-radius:50%;object-fit:cover" onerror="this.style.display=\'none\'"><button class="btn-signout" onclick="signOut()">\u767b\u51fa</button>';
}

function showLogin(){
  currentUser=null;
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginLoading').style.display='none';
  document.getElementById('userChip').innerHTML='';
  document.getElementById('logoTitle').innerHTML='\u96DE\u6BDB\u8CC7\u6599\u5EAB';
  papers=[];projects=[];renderAll();
}

// Firestore save/load
var STORAGE_KEY = 'research_papers_v4';
var PROJ_KEY    = 'research_projects_v1';

function userRef(){ return db.collection('users').doc(currentUser.uid); }

function savePapers(arr){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  if(!currentUser||!db) return;
  userRef().set({papers: arr, projects: projects}, {merge:true}).catch(function(e){ console.error('Firestore save error',e); });
}
function saveProjects(arr){
  localStorage.setItem(PROJ_KEY, JSON.stringify(arr));
  if(!currentUser||!db) return;
  userRef().set({papers: papers, projects: arr}, {merge:true}).catch(function(e){ console.error('Firestore save error',e); });
}
function loadPapers(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]');}catch(e){return[];}}
function loadProjects(){try{return JSON.parse(localStorage.getItem(PROJ_KEY)||'[]');}catch(e){return[];}}

function loadFromCloud(){
  if(!currentUser||!db) return Promise.resolve(false);
  return userRef().get().then(function(snap){
    if(snap.exists){
      var data=snap.data();
      papers   = data.papers   || [];
      projects = data.projects || [];
      var checks = papers.map(function(p){
        if(p.hasPdf){
          return getHandle(p.id).catch(function(){return null;}).then(function(h){
            if(!h) p._pdfMissing=true;
          });
        }
        return Promise.resolve();
      });
      return Promise.all(checks).then(function(){
        localStorage.setItem(STORAGE_KEY, JSON.stringify(papers));
        localStorage.setItem(PROJ_KEY, JSON.stringify(projects));
        return true;
      });
    }
    return false;
  }).catch(function(e){ console.error('Firestore load error',e); return false; });
}

var papers   = [];
var projects = [];
var editingId    = null;
var activeTags   = new Set();
var currentPage  = 1;
var PAGE_SIZE    = 20;
var activeProject = null;

function initAppData(){
  return loadFromCloud().then(function(fromCloud){
    if(!fromCloud){ papers=loadPapers(); projects=loadProjects(); }
    renderAll();
  });
}

// Toast + Progress
var toastTimer=null;
function showToast(msg,type){
  type=type||'success';
  var el=document.getElementById('toast');
  el.innerHTML=msg;el.className='toast '+type+' show';
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){el.classList.remove('show');},3500);
}
function showProgress(){document.getElementById('progressBar').style.width='65%';}
function hideProgress(){
  var b=document.getElementById('progressBar');
  b.style.width='100%';
  setTimeout(function(){b.style.width='0';},400);
}

// Projects
function addProject(){
  var input=document.getElementById('newProjInput');
  var name=input.value.trim();
  if(!name){showToast('\u8ACB\u8F38\u5165\u8CC7\u6599\u593E\u540D\u7A31','error');return;}
  if(projects.some(function(p){return p.name===name;})){showToast('\u5DF2\u6709\u540C\u540D\u8CC7\u6599\u593E','error');return;}
  projects.push({id:Date.now(),name:name});
  saveProjects(projects);
  input.value='';
  renderProjects();
  renderQuickFilters();
  showToast('\u8CC7\u6599\u593E\u5DF2\u65B0\u589E\uFF1A'+name,'success');
}

function deleteProject(pid,e){
  e.stopPropagation();
  if(!confirm('\u522A\u9664\u8CC7\u6599\u593E\uFF1F\u8AD6\u6587\u672C\u8EAB\u4E0D\u6703\u522A\u9664\u3002'))return;
  projects=projects.filter(function(p){return p.id!==pid;});
  papers.forEach(function(p){p.projectIds=(p.projectIds||[]).filter(function(id){return id!==pid;});});
  if(activeProject===pid)activeProject=null;
  saveProjects(projects);savePapers(papers);renderAll();
}

function setActiveProject(pid){
  activeProject = activeProject===pid ? null : pid;
  renderProjects();renderPapers();
  var tag=document.getElementById('activeProjectTag');
  if(activeProject){
    var proj=projects.find(function(p){return p.id===activeProject;});
    tag.innerHTML='<span class="active-project-tag">\uD83D\uDCC1 '+(proj?proj.name:'')+'<button onclick="setActiveProject(null)">\u00D7</button></span>';
  } else {
    tag.innerHTML='';
  }
}

function togglePaperProject(paperId, projId, e){
  if(e)e.stopPropagation();
  var p=papers.find(function(x){return x.id===paperId;});
  if(!p)return;
  p.projectIds=p.projectIds||[];
  if(p.projectIds.includes(projId)) p.projectIds=p.projectIds.filter(function(id){return id!==projId;});
  else p.projectIds.push(projId);
  savePapers(papers);
  renderProjects();renderStats();
  renderPapers();
}

function renderProjects(){
  var list=document.getElementById('projectList');
  var searchEl=document.getElementById('projSearchInput');
  var query=searchEl?searchEl.value.toLowerCase():'';
  var visible=projects.filter(function(proj){return !query||proj.name.toLowerCase().includes(query);});
  var projRows=visible.map(function(proj){
    var cnt=papers.filter(function(p){return (p.projectIds||[]).includes(proj.id);}).length;
    return '<div class="project-item '+(activeProject===proj.id?'active':'')+'" onclick="setActiveProject('+proj.id+')">'+
      '<span class="project-icon">\uD83D\uDCC1</span>'+
      '<span class="project-name">'+proj.name+'</span>'+
      '<span class="proj-count">'+cnt+'</span>'+
      '<span style="font-size:.7rem;cursor:pointer;opacity:.5;flex-shrink:0;padding:.1rem .2rem" onclick="deleteProject('+proj.id+',event)" title="\u522A\u9664">\u2715</span>'+
    '</div>';
  }).join('');
  var emptyMsg=visible.length===0?'<div style="font-family:var(--mono);font-size:.68rem;color:var(--ink-light);padding:.25rem .5rem;opacity:.6">'+(query?'\u7121\u7B26\u5408\u8CC7\u6599\u593E':'\u5C1A\u7121\u8CC7\u6599\u593E\uFF0C\u8ACB\u65BC\u4E0B\u65B9\u65B0\u589E')+'</div>':'';
  list.innerHTML=projRows+emptyMsg;
}

// Tags sidebar
var showAllTags = false;
var TAGS_DEFAULT_SHOW = 5;
var TAGS_EXPANDED_SHOW = 20;

function getAllTags(){
  var tagCount={};
  papers.forEach(function(p){
    p.tags.forEach(function(t){
      tagCount[t]=(tagCount[t]||0)+1;
    });
  });
  return Object.entries(tagCount).sort(function(a,b){return b[1]-a[1];}).map(function(e){return e[0];});
}

function renderTagFilters(){
  var query=document.getElementById('tagSearchInput').value.toLowerCase();
  var allTags=getAllTags();
  var candidates = allTags.filter(function(t){return !activeTags.has(t);});
  var strip = document.getElementById('selectedTagsStrip');
  var header = document.getElementById('selectedTagsHeader');
  if(strip){
    strip.innerHTML = activeTags.size===0 ? '' :
      Array.from(activeTags).map(function(t){return '<span class="selected-tag-pill">'+t+' <span class="rm" onclick="removeTag(\''+t+'\')">&#x2715;</span></span>';}).join('');
  }
  if(header){ header.classList.toggle('show', activeTags.size>0); }

  // Search mode: require at least 2 characters
  if(query){
    if(query.length < 2){
      document.getElementById('tagFilters').innerHTML = '';
      return;
    }
    var searchResults = candidates.filter(function(t){return t.toLowerCase().includes(query);});
    document.getElementById('tagFilters').innerHTML = searchResults.map(function(t){
      return '<span class="tag-filter" onclick="addTag(\''+t+'\')">'+t+'</span>';
    }).join('');
    return;
  }

  // Normal mode: 5 default, 20 when expanded
  var limit = showAllTags ? TAGS_EXPANDED_SHOW : TAGS_DEFAULT_SHOW;
  var visibleCandidates = candidates.slice(0, limit);
  var hasMore = candidates.length > TAGS_DEFAULT_SHOW;
  var tagBtns = visibleCandidates.map(function(t){return '<span class="tag-filter" onclick="addTag(\''+t+'\')">'+t+'</span>';}).join('');
  var moreBtn = hasMore
    ? '<button class="tag-show-more" onclick="toggleShowAllTags()">'+(showAllTags?'&#9650; \u6536\u8D77':'&#9660; \u986F\u793A\u5E38\u7528')+'</button>'
    : '';
  document.getElementById('tagFilters').innerHTML = tagBtns + moreBtn;
}

function toggleShowAllTags(){ showAllTags=!showAllTags; renderTagFilters(); }
function addTag(t){ activeTags.add(t); document.getElementById('tagSearchInput').value=''; showAllTags=false; currentPage=1; renderTagFilters(); renderPapers(); }
function removeTag(t){ activeTags.delete(t); currentPage=1; renderTagFilters(); renderPapers(); }
function clearTags(){ activeTags.clear(); currentPage=1; renderTagFilters(); renderPapers(); }
function setTag(t){ if(t===null){clearTags();}else{addTag(t);} }

// Quick Filters
var activeQuickFilter = null;

function setQuickFilter(type){
  activeQuickFilter = activeQuickFilter===type ? null : type;
  renderQuickFilters();
  renderPapers();
}

function renderQuickFilters(){
  var total=papers.length;
  var favs=papers.filter(function(p){return p.favourite;}).length;
  var withPdf=papers.filter(function(p){return p.hasPdf;}).length;
  document.getElementById('quickFilterGroup').innerHTML=
    '<button class="qf-btn '+(activeQuickFilter===null?'active':'')+'" onclick="setQuickFilter(null)">'+
    '<span class="qf-icon">\uD83D\uDCC4</span><span class="qf-label">\u5168\u90E8\u8AD6\u6587</span>'+
    '<span class="qf-count">'+total+'</span></button>'+
    '<button class="qf-btn '+(activeQuickFilter==='fav'?'active':'')+'" onclick="setQuickFilter(\'fav\')">'+
    '<span class="qf-icon">&#11088;</span><span class="qf-label">\u6700\u611B</span>'+
    '<span class="qf-count">'+favs+'</span></button>'+
    '<button class="qf-btn '+(activeQuickFilter==='pdf'?'active':'')+'" onclick="setQuickFilter(\'pdf\')">'+
    '<span class="qf-icon">\uD83D\uDCCC</span><span class="qf-label">\u542B PDF</span>'+
    '<span class="qf-count">'+withPdf+'</span></button>';
}

function renderStats(){ renderQuickFilters(); }

// Render papers
function renderPapers(){
  var qTitle    = (document.getElementById('searchTitle')?document.getElementById('searchTitle').value:'').toLowerCase();
  var qAuthors  = (document.getElementById('searchAuthors')?document.getElementById('searchAuthors').value:'').toLowerCase();
  var qAbstract = (document.getElementById('searchAbstract')?document.getElementById('searchAbstract').value:'').toLowerCase();
  var qNotes    = (document.getElementById('searchNotes')?document.getElementById('searchNotes').value:'').toLowerCase();
  var sort=document.getElementById('sortSelect').value;

  var filtered=papers.filter(function(p){
    var mt=activeTags.size===0||Array.from(activeTags).every(function(t){return p.tags.includes(t);});
    var mp=!activeProject||(p.projectIds||[]).includes(activeProject);
    var mf=!activeQuickFilter||(activeQuickFilter==='fav'&&p.favourite)||(activeQuickFilter==='pdf'&&p.hasPdf);
    var mTitle    = !qTitle    || p.title.toLowerCase().includes(qTitle);
    var mAuthors  = !qAuthors  || (p.authors||'').toLowerCase().includes(qAuthors);
    var mAbstract = !qAbstract || (p.abstract||'').toLowerCase().includes(qAbstract);
    var mNotes    = !qNotes    || (p.notes||'').toLowerCase().includes(qNotes);
    return mt&&mp&&mf&&mTitle&&mAuthors&&mAbstract&&mNotes;
  });

  filtered.sort(function(a,b){
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

  var scopeTotal=papers.filter(function(p){
    var mp=!activeProject||(p.projectIds||[]).includes(activeProject);
    var mf=!activeQuickFilter||(activeQuickFilter==='fav'&&p.favourite)||(activeQuickFilter==='pdf'&&p.hasPdf);
    return mp&&mf;
  }).length;
  document.getElementById('resultCount').textContent='\u986F\u793A '+filtered.length+' / '+scopeTotal+' \u7BC7';

  var grid=document.getElementById('papersGrid');
  var pgDiv=document.getElementById('pagination');
  if(!filtered.length){
    grid.innerHTML='<div class="empty-state"><div class="empty-icon">\uD83D\uDCC4</div><div class="empty-text">\u5C1A\u7121\u7B26\u5408\u7684\u8AD6\u6587</div><div class="empty-sub">\u8ABF\u6574\u641C\u5C0B\u689D\u4EF6\u6216\u65B0\u589E\u8AD6\u6587</div></div>';
    pgDiv.innerHTML='';
    return;
  }
  var totalPages=Math.ceil(filtered.length/PAGE_SIZE);
  if(currentPage>totalPages) currentPage=1;
  var start=(currentPage-1)*PAGE_SIZE;
  var pageItems=filtered.slice(start,start+PAGE_SIZE);
  grid.innerHTML=pageItems.map(function(p){return buildCard(p);}).join('');
  renderPagination(totalPages,pgDiv);
}

function renderPagination(total,el){
  if(total<=1){el.innerHTML='';return;}
  var p=currentPage;
  var btns='';
  btns+='<button class="pg-btn" onclick="goPage('+(p-1)+')" '+(p===1?'disabled':'')+'>&#9664;</button>';
  var pages=[];
  for(var i=1;i<=total;i++){
    if(i===1||i===total||Math.abs(i-p)<=2) pages.push(i);
    else if(pages[pages.length-1]!=='...') pages.push('...');
  }
  pages.forEach(function(pg){
    if(pg==='...') btns+='<span class="pg-ellipsis">&#8230;</span>';
    else btns+='<button class="pg-btn'+(pg===p?' active':'')+'" onclick="goPage('+pg+')" '+(pg===p?'disabled':'')+'>'+pg+'</button>';
  });
  btns+='<button class="pg-btn" onclick="goPage('+(p+1)+')" '+(p===total?'disabled':'')+'>&#9654;</button>';
  el.innerHTML=btns;
}

function goPage(n){
  currentPage=n;
  renderPapers();
  document.getElementById('papersGrid').scrollIntoView({behavior:'smooth',block:'start'});
}

function buildCard(p){
  var favIcon = p.favourite ? '&#11088;' : '&#9734;';
  var tagHtml=p.tags.map(function(t){
    var cls=(t.includes('neuro')||t.includes('cilia')||t.includes('cerebel')||t.includes('medull'))?'tag-neuro':
            (t.includes('nlp')||t.includes('llm')||t.includes('bert'))?'tag-nlp':
            (t.includes('esg')||t.includes('finance'))?'tag-esg':'tag-topic';
    return '<span class="tag '+cls+'">'+t+'</span>';
  }).join('');
  var kpHtml=(p.keyPoints||[]).map(function(k){return '<div class="key-point-item"><span class="kp-bullet">&#9656;</span><span>'+k+'</span></div>';}).join('');
  var projPills=(p.projectIds||[]).map(function(pid){
    var proj=projects.find(function(x){return x.id===pid;});
    return proj?'<span class="proj-pill">\uD83D\uDCC1 '+proj.name+'</span>':'';
  }).join('');

  var pdfSection;
  if(p.hasPdf){
    pdfSection='<div class="pdf-link-box" id="pdfBox_'+p.id+'">'+
      '<div class="pdf-link-row">'+
      '<div style="font-size:1.4rem">\uD83D\uDCC4</div>'+
      '<div class="pdf-link-info">'+
      '<div class="pdf-link-name">'+(p.pdfName||'document.pdf')+'</div>'+
      '<div class="pdf-link-sub" id="pdfSub_'+p.id+'">\u5132\u5B58\u65BC\u672C\u6A5F\u786C\u789F</div>'+
      '</div></div>'+
      '<div id="pdfViewer_'+p.id+'"></div></div>';
  } else if(p._pdfMissing){
    pdfSection='<div class="pdf-no-link" id="pdfBox_'+p.id+'" style="border-color:#ffc107;background:#fff8e1"><div class="pdf-no-link-text">\uD83D\uDCCE PDF \u5DF2\u767B\u8A18\uFF0C\u4F46\u6B64\u88DD\u7F6E\u5C1A\u672A\u9023\u7D50<br><span style="font-size:.65rem;opacity:.7">\u8ACB\u91CD\u65B0\u9EDE\u64CA\u300C\u9023\u7D50\u672C\u6A5F PDF\u300D\u9078\u53D6\u6A94\u6848</span></div></div>';
  } else {
    pdfSection='<div class="pdf-no-link" id="pdfBox_'+p.id+'">'+
      '<div class="pdf-no-link-text">\u5C1A\u672A\u9023\u7D50 PDF \u6A94\u6848<br><span style="font-size:.65rem;opacity:.7">\u9EDE\u64CA\u300C\u9023\u7D50\u672C\u6A5F PDF\u300D\u9078\u53D6\u786C\u789F\u4E2D\u7684 PDF</span></div></div>';
  }

  return '<div class="paper-card" id="card_'+p.id+'" onclick="cardClick('+p.id+',event)">'+
    '<div class="paper-meta-top">'+
    '<button class="fav-btn '+(p.favourite?'active':'')+'" onclick="toggleFav('+p.id+',event)" title="'+(p.favourite?'\u53D6\u6D88\u6700\u611B':'\u52A0\u5165\u6700\u611B')+'">'+favIcon+'</button>'+
    '<span class="paper-year">'+(p.year||'&#8212;')+'</span>'+
    '<span class="paper-journal">'+(p.journal||'')+'</span>'+
    (p.hasPdf?'<span class="pdf-badge linked">\uD83D\uDCCC PDF</span>':'')+
    '</div>'+
    '<div class="paper-title">'+p.title+'</div>'+
    '<div class="paper-authors">'+(p.authors||'')+'</div>'+
    '<div class="paper-tags">'+tagHtml+'</div>'+
    '<div class="paper-abstract-preview">'+(p.abstract||'')+'</div>'+
    (projPills?'<div class="card-projects">'+projPills+'</div>':'')+
    '<div class="paper-expanded">'+
      '<div class="section-wrap" id="secKP_'+p.id+'">'+
        '<div class="section-label">\u91CD\u9EDE\u6458\u8A18 <span class="en">Key Points</span>'+
        '<button class="section-toggle" onclick="toggleSection(\'secKP_'+p.id+'\',event)">\u25BC</button></div>'+
        '<div class="section-body" id="secKPBody_'+p.id+'">'+
        (kpHtml||'<div style="font-size:.8rem;color:var(--ink-light);font-style:italic">\u5C1A\u7121\u91CD\u9EDE</div>')+
        '</div></div>'+
      '<div class="section-wrap collapsed" id="secNotes_'+p.id+'">'+
        '<div class="section-label">\u500B\u4EBA\u7B46\u8A18 <span class="en">Notes</span>'+
        '<button class="section-toggle" onclick="toggleSection(\'secNotes_'+p.id+'\',event)">\u25B6</button></div>'+
        '<div class="section-body collapsed" id="secNotesBody_'+p.id+'">'+
        '<textarea class="notes-area" id="notes_'+p.id+'" onclick="event.stopPropagation()" onchange="updateNotes('+p.id+')" placeholder="\u95B1\u8B80\u5FC3\u5F97\u3001\u76F8\u95DC\u8AD6\u6587\u3001\u5F85\u8FFD\u8E64\u554F\u984C\u2026">'+(p.notes||'')+'</textarea>'+
        '</div></div>'+
      '<div class="section-wrap collapsed" id="secPdf_'+p.id+'">'+
        '<div class="section-label">PDF \u5168\u6587 <span class="en">Full Text</span>'+
        '<button class="section-toggle" onclick="toggleSection(\'secPdf_'+p.id+'\',event)">\u25B6</button></div>'+
        '<div class="section-body collapsed" id="secPdfBody_'+p.id+'">'+pdfSection+'</div>'+
      '</div>'+
      '<div class="card-actions">'+
        '<button class="collapse-btn-inline" onclick="collapseCard('+p.id+',event)" style="margin-right:auto">\u25B2 \u7E2E\u56DE</button>'+
        (p.doi?'<a href="'+doiUrl(p.doi)+'" target="_blank" class="btn-sm btn-doi" onclick="event.stopPropagation()">\uD83D\uDE97 DOI</a>':'')+
        (p.hasPdf
          ?'<button class="btn-sm btn-open-pdf" id="pdfToggleBtn_'+p.id+'" onclick="openPdf('+p.id+',event)">\u25B6 \u958B\u555F PDF</button>'+
            '<button class="btn-sm btn-unlink-pdf" onclick="unlinkPdf('+p.id+',event)">\u79FB\u9664 PDF</button>'
          :'<button class="btn-sm btn-link-pdf" onclick="linkPdf('+p.id+',event)" '+((!FS_SUPPORTED)?'disabled':'')+'>'+
            (IN_IFRAME?'\u26A0 \u9700\u4E0B\u8F09\u5F8C\u958B\u555F':'\uD83D\uDD17 \u9023\u7D50\u672C\u6A5F PDF')+'</button>'
        )+
        '<button class="btn-sm btn-proj-assign" onclick="openProjModal('+p.id+',event)">\uD83D\uDCC1 \u52A0\u5165\u8CC7\u6599\u593E</button>'+
        '<button class="btn-sm btn-edit" onclick="editPaper('+p.id+',event)">\u7DE8\u8F2F</button>'+
        '<button class="btn-sm btn-delete" onclick="openDelModal('+p.id+',event)">\u522A\u9664\u8AD6\u6587</button>'+
      '</div>'+
    '</div>'+
  '</div>';
}

// Project Assign Modal
var projModalPaperId = null;

function openProjModal(paperId, e){
  if(e) e.stopPropagation();
  projModalPaperId = paperId;
  document.getElementById('projAssignSearch').value = '';
  document.getElementById('projAssignNew').value = '';
  renderProjModalList();
  document.getElementById('projAssignOverlay').classList.add('open');
  setTimeout(function(){document.getElementById('projAssignSearch').focus();}, 100);
}

function closeProjModal(){
  document.getElementById('projAssignOverlay').classList.remove('open');
  projModalPaperId = null;
  renderPapers();
}

function renderProjModalList(){
  var query = document.getElementById('projAssignSearch').value.toLowerCase();
  var paper = papers.find(function(p){return p.id===projModalPaperId;});
  var assigned = paper ? (paper.projectIds||[]) : [];
  var visible = projects.filter(function(p){return !query||p.name.toLowerCase().includes(query);});
  var list = document.getElementById('projAssignList');
  if(!visible.length){
    list.innerHTML='<div class="proj-modal-empty">'+(query?'\u7121\u7B26\u5408\u8CC7\u6599\u593E':'\u5C1A\u7121\u8CC7\u6599\u593E\uFF0C\u8ACB\u65BC\u4E0A\u65B9\u65B0\u589E')+'</div>';
    return;
  }
  list.innerHTML = visible.map(function(proj){
    var checked = assigned.includes(proj.id);
    var cnt = papers.filter(function(p){return (p.projectIds||[]).includes(proj.id);}).length;
    return '<div class="proj-modal-item" onclick="toggleProjFromModal('+proj.id+')">'+
      '<span class="pm-check">'+(checked?'&#10003;':'')+'</span>'+
      '<span class="pm-name">'+proj.name+'</span>'+
      '<span class="pm-cnt">'+cnt+'</span>'+
    '</div>';
  }).join('');
}

function toggleProjFromModal(projId){
  var paper = papers.find(function(p){return p.id===projModalPaperId;});
  if(!paper) return;
  paper.projectIds = paper.projectIds||[];
  if(paper.projectIds.includes(projId)) paper.projectIds = paper.projectIds.filter(function(id){return id!==projId;});
  else paper.projectIds.push(projId);
  savePapers(papers);
  renderProjModalList();
  renderProjects();
}

function addProjFromModal(){
  var input = document.getElementById('projAssignNew');
  var name = input.value.trim();
  if(!name){showToast('\u8ACB\u8F38\u5165\u8CC7\u6599\u593E\u540D\u7A31','error');return;}
  if(projects.some(function(p){return p.name===name;})){showToast('\u5DF2\u6709\u540C\u540D\u8CC7\u6599\u593E','error');return;}
  var newProj = {id:Date.now(), name:name};
  projects.push(newProj);
  saveProjects(projects);
  var paper = papers.find(function(p){return p.id===projModalPaperId;});
  if(paper){ paper.projectIds=paper.projectIds||[]; paper.projectIds.push(newProj.id); savePapers(papers); }
  input.value='';
  renderProjModalList();
  renderProjects();
  showToast('\u5DF2\u65B0\u589E\u8CC7\u6599\u593E\u4E26\u52A0\u5165\uFF1A'+name,'success');
}

// Click-outside disabled for projAssign modal

// Favourite toggle
function toggleFav(id, e){
  e.stopPropagation();
  var p=papers.find(function(x){return x.id===id;});
  if(!p)return;
  p.favourite=!p.favourite;
  savePapers(papers);
  renderStats();
  var btn=document.querySelector('#card_'+id+' .fav-btn');
  if(btn){btn.innerHTML=p.favourite?'&#11088;':'&#9734;';btn.className='fav-btn '+(p.favourite?'active':'');btn.title=p.favourite?'\u53D6\u6D88\u6700\u611B':'\u52A0\u5165\u6700\u611B';}
}

// Card helpers
function cardClick(id,e){
  var card=document.getElementById('card_'+id);
  if(!card) return;
  if(card.classList.contains('expanded')) return;
  if(e.target.closest('.fav-btn,button,a,input,textarea,select')) return;
  card.classList.add('expanded');
}
function toggleSection(wrapId, e){
  if(e) e.stopPropagation();
  var wrap = document.getElementById(wrapId);
  if(!wrap) return;
  var body = wrap.querySelector('.section-body');
  var btn  = wrap.querySelector('.section-toggle');
  if(!body) return;
  var collapsed = body.classList.toggle('collapsed');
  wrap.classList.toggle('collapsed', collapsed);
  if(btn) btn.textContent = collapsed ? '\u25B6' : '\u25BC';
}
function expandCard(id){ document.getElementById('card_'+id) && document.getElementById('card_'+id).classList.add('expanded'); }
function collapseCard(id,e){
  if(e)e.stopPropagation();
  var card=document.getElementById('card_'+id);
  if(card){
    card.classList.remove('expanded');
    setTimeout(function(){card.scrollIntoView({behavior:'smooth',block:'nearest'});},50);
  }
}
function doiUrl(doi){
  doi=doi.trim();
  // Remove common prefixes like "doi: " or "DOI: "
  doi=doi.replace(/^doi:\s*/i,'');
  // Remove trailing period or comma
  doi=doi.replace(/[.,;]+$/,'');
  if(doi.startsWith('http://doi.org/'))    return doi.replace('http://doi.org/','https://doi.org/');
  if(doi.startsWith('https://doi.org/'))   return doi;
  if(doi.startsWith('http://dx.doi.org/')) return doi.replace('http://dx.doi.org/','https://doi.org/');
  if(doi.startsWith('https://dx.doi.org/'))return doi.replace('https://dx.doi.org/','https://doi.org/');
  if(doi.startsWith('10.'))                return 'https://doi.org/'+doi;
  return doi;
}
function onSearchInput(el){
  el.classList.toggle('has-value', el.value.length > 0);
  currentPage=1; renderPapers();
}
function clearAllSearch(){
  ['searchTitle','searchAuthors','searchAbstract','searchNotes'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){el.value='';el.classList.remove('has-value');}
  });
  renderPapers();
}
function goHome(){
  document.querySelectorAll('.paper-card.expanded').forEach(function(c){c.classList.remove('expanded');});
  clearAllSearch();
  document.getElementById('tagSearchInput').value='';activeTags.clear();
  document.getElementById('projSearchInput').value='';
  activeTags.clear(); activeProject=null; activeQuickFilter=null;
  showAllTags=false;
  document.getElementById('sortSelect').value='fav-first';
  renderAll();
  window.scrollTo({top:0,behavior:'smooth'});
  showToast('\u5DF2\u56DE\u5230\u4E3B\u756B\u9762','info');
}
function updateNotes(id){
  var p=papers.find(function(x){return x.id===id;});
  var el=document.getElementById('notes_'+id);
  if(p&&el){p.notes=el.value;savePapers(papers);}
}

// PDF
function linkPdf(id,e){
  e.stopPropagation();
  if(IN_IFRAME){showToast('\u8ACB\u4E0B\u8F09 HTML \u5F8C\u7528 Chrome/Edge \u76F4\u63A5\u958B\u555F','error');return;}
  if(!FS_SUPPORTED){showToast('\u9700\u8981 Chrome/Edge','error');return;}
  window.showOpenFilePicker({types:[{description:'PDF',accept:{'application/pdf':['.pdf']}}],multiple:false}).then(function(files){
    var handle=files[0];
    showProgress();
    return saveHandle(id,handle).then(function(){
      var p=papers.find(function(x){return x.id===id;});
      if(p){p.hasPdf=true;p.pdfName=handle.name;savePapers(papers);}
      hideProgress();renderAll();expandCard(id);
      showToast('\uD83D\uDD17 \u5DF2\u9023\u7D50','success');
    });
  }).catch(function(err){hideProgress();if(err.name!=='AbortError')showToast('\u9023\u7D50\u5931\u6557\uFF1A'+(err.message||err.name),'error');});
}

function openPdf(id,e){
  e.stopPropagation();
  var viewer=document.getElementById('pdfViewer_'+id);
  var btn=document.getElementById('pdfToggleBtn_'+id);
  if(viewer&&(viewer.dataset.pdfOpen==='1'||viewer.innerHTML.includes('iframe'))){
    viewer.innerHTML='';
    viewer.dataset.pdfOpen='';
    if(btn){btn.textContent='\u25B6 \u958B\u555F PDF';btn.className='btn-sm btn-open-pdf';btn.onclick=function(ev){openPdf(id,ev);};}
    showToast('\u274C \u5DF2\u95DC\u9589','info');
    return;
  }
  if(!FS_SUPPORTED){showToast('\u9700\u8981 Chrome/Edge','error');return;}
  getHandle(id).then(function(handle){
    if(!handle){showToast('\u627E\u4E0D\u5230 PDF \u9023\u7D50\uFF0C\u8ACB\u91CD\u65B0\u9023\u7D50','error');return;}
    return verifyPermission(handle).then(function(permitted){
      if(!permitted){showToast('\u672A\u7372\u5F97\u8B80\u53D6\u6B0A\u9650','error');return;}
      showProgress();
      return handle.getFile().then(function(file){
        var url=URL.createObjectURL(file);
        if(viewer){
          viewer.dataset.pdfOpen='1';
          viewer.innerHTML='<div class="pdf-inline-wrap">'+
            '<div class="pdf-inline-bar">'+
            '<span>'+file.name+'</span>'+
            '<button onclick="window.open(\''+url+'\',\'_blank\')">\u65B0\u5206\u9801\u958B\u555F &#8599;</button>'+
            '</div><iframe src="'+url+'"></iframe></div>';
        }
        if(btn){btn.textContent='\u25A0 \u95DC\u9589 PDF';btn.className='btn-sm btn-close-pdf';btn.onclick=function(ev){openPdf(id,ev);};}
        hideProgress();showToast('\u2705 \u5DF2\u958B\u555F','success');
      }).catch(function(){
        hideProgress();showToast('\u7121\u6CD5\u8B80\u53D6\u6A94\u6848\uFF0C\u53EF\u80FD\u5DF2\u88AB\u79FB\u52D5\u3002\u8ACB\u91CD\u65B0\u9023\u7D50\u3002','error');
        var sub=document.getElementById('pdfSub_'+id);
        if(sub){sub.textContent='\u26A0 \u6A94\u6848\u672A\u627E\u5230\uFF0C\u8ACB\u91CD\u65B0\u9023\u7D50';sub.className='pdf-link-sub warn';}
      });
    });
  });
}

function unlinkPdf(id,e){
  e.stopPropagation();
  if(!confirm('\u53D6\u6D88\u9023\u7D50\uFF1FPDF \u4ECD\u4FDD\u7559\u5728\u786C\u789F\u539F\u4F4D\u3002'))return;
  deleteHandle(id).then(function(){
    var p=papers.find(function(x){return x.id===id;});
    if(p){p.hasPdf=false;p.pdfName=null;savePapers(papers);}
    renderAll();expandCard(id);showToast('\uD83D\uDD17 \u5DF2\u79FB\u9664\u9023\u7D50','info');
  });
}

// Edit / Delete / Modal
function openModal(){
  editingId=null;
  document.getElementById('modalTitle').textContent='\u65B0\u589E\u8AD6\u6587 Add Paper';
  ['fTitle','fAuthors','fJournal','fDoi','fTags','fAbstract','fKeyPoints','fNotes'].forEach(function(i){document.getElementById(i).value='';});
  document.getElementById('fYear').value=new Date().getFullYear();
  document.getElementById('modalOverlay').classList.add('open');
}
function closeModal(){document.getElementById('modalOverlay').classList.remove('open');}

function editPaper(id,e){
  e.stopPropagation();
  var p=papers.find(function(x){return x.id===id;});if(!p)return;
  editingId=id;
  document.getElementById('modalTitle').textContent='\u7DE8\u8F2F\u8AD6\u6587 Edit Paper';
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

var delTargetId = null;
function openDelModal(id, e){
  if(e) e.stopPropagation();
  delTargetId = id;
  var p = papers.find(function(x){return x.id===id;});
  if(!p) return;
  var tagHtml = p.tags.map(function(t){
    var cls=(t.includes('neuro')||t.includes('cilia'))?'tag-neuro':(t.includes('nlp')||t.includes('llm'))?'tag-nlp':(t.includes('esg'))?'tag-esg':'tag-topic';
    return '<span class="tag '+cls+'">'+t+'</span>';
  }).join('');
  document.getElementById('delPaperPreview').innerHTML=
    '<div class="del-paper-year">'+(p.year||'&#8212;')+' &middot; '+(p.journal||'')+'</div>'+
    '<div class="del-paper-title">'+p.title+'</div>'+
    '<div class="del-paper-authors">'+(p.authors||'')+'</div>'+
    '<div class="del-paper-tags">'+tagHtml+'</div>'+
    '<div class="del-paper-abstract">'+(p.abstract||'')+'</div>';
  document.getElementById('delModalOverlay').classList.add('open');
}
function closeDelModal(){
  document.getElementById('delModalOverlay').classList.remove('open');
  delTargetId = null;
}
function confirmDeletePaper(){
  if(!delTargetId) return;
  deleteHandle(delTargetId);
  papers = papers.filter(function(p){return p.id!==delTargetId;});
  savePapers(papers);
  closeDelModal();
  renderAll();
  showToast('\u8AD6\u6587\u5DF2\u522A\u9664','success');
}
function deletePaper(id,e){ openDelModal(id,e); }

function savePaper(){
  var title=document.getElementById('fTitle').value.trim();
  if(!title){showToast('\u8ACB\u8F38\u5165\u8AD6\u6587\u6A19\u984C','error');return;}
  var tags=document.getElementById('fTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean);
  var keyPoints=document.getElementById('fKeyPoints').value.split('\n').map(function(k){return k.trim();}).filter(Boolean);
  var data={
    title:title,
    authors:document.getElementById('fAuthors').value.trim(),
    year:parseInt(document.getElementById('fYear').value)||null,
    journal:document.getElementById('fJournal').value.trim(),
    doi:document.getElementById('fDoi').value.trim(),
    tags:tags,keyPoints:keyPoints,
    abstract:document.getElementById('fAbstract').value.trim(),
    notes:document.getElementById('fNotes').value.trim()
  };
  if(editingId){
    var existing=papers.find(function(x){return x.id===editingId;});
    if(existing) Object.assign(existing,data);
  } else {
    papers.unshift({id:Date.now(),favourite:false,hasPdf:false,pdfName:null,projectIds:[],addedAt:new Date().toISOString(),...data});
  }
  var savedId=editingId;savePapers(papers);closeModal();renderAll();
  if(savedId){expandCard(savedId);}
  showToast('\u8AD6\u6587\u5DF2\u5132\u5B58','success');
}


// Global events
// Click-outside disabled for del modal
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){closeModal();closeDelModal();}
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){e.preventDefault();document.getElementById('searchTitle').focus();}
});

function renderAll(){renderTagFilters();renderProjects();renderStats();renderPapers();}

// Auth state
if(FB_CONFIGURED){
  // Hide login overlay immediately if a cached session exists
  if(auth.currentUser){
    document.getElementById('loginOverlay').classList.add('hidden');
  }
  auth.onAuthStateChanged(function(user){
    if(user){
      showApp(user);
      initAppData();
    } else {
      showLogin();
    }
  });
} else {
  document.getElementById('loginConfigNotice').style.display='block';
  document.querySelector('.btn-google').outerHTML='<button class="btn-google" onclick="enterLocalMode()">&#9889; \u672C\u6A5F\u6A21\u5F0F\u9032\u5165\uFF08\u672A\u8A2D\u5B9A Firebase\uFF09</button>';
}
function enterLocalMode(){
  document.getElementById('loginOverlay').classList.add('hidden');
  papers=loadPapers(); projects=loadProjects();
  initAppData();
}
openDB();

// Citation Import
var citeQueue = [];
var citeQueueIdx = 0;

function openCiteModal(){
  citeQueue = [];
  citeQueueIdx = 0;
  document.getElementById('citeInput').value = '';
  document.getElementById('citeParseError').style.display = 'none';
  document.getElementById('citePasteScreen').style.display = 'block';
  document.getElementById('citeReviewScreen').style.display = 'none';
  document.getElementById('citeQueueStatus').style.display = 'none';
  document.getElementById('citeModalOverlay').classList.add('open');
  setTimeout(function(){document.getElementById('citeInput').focus();}, 100);
}

function closeCiteModal(){
  document.getElementById('citeModalOverlay').classList.remove('open');
}

function backToCitePaste(){
  document.getElementById('citePasteScreen').style.display = 'block';
  document.getElementById('citeReviewScreen').style.display = 'none';
}

function detectFormat(text){
  var t = text.trim();
  if(/\(\d{4}\)/.test(t) && /^[A-Z][a-z]+,\s[A-Z]/.test(t)) return 'apa';
  if(/"[^"]{5,}"/.test(t) && /\bvol\.\s*\d/i.test(t)) return 'mla';
  return 'nlm';
}

function splitCitations(raw){
  var byBlank = raw.trim().split(/\n\s*\n/);
  if(byBlank.length > 1) return byBlank.map(function(s){return s.trim();}).filter(Boolean);
  var lines = raw.trim().split('\n').map(function(s){return s.trim();}).filter(function(s){return s.length>60;});
  if(lines.length > 1) return lines;
  return [raw.trim()];
}

function parseNLM(text){
  var doi = (text.match(/\bdoi:\s*([^\s,;]+)/i)||[])[1] || '';
  var pmid = (text.match(/\bPMID:\s*(\d+)/i)||[])[1] || '';
  var year = (text.match(/\b(19|20)\d{2}\b/)||[])[0] || '';
  var parts = text.split(/\.\s+/);
  var authors = '', title = '', journal = '';
  if(parts.length >= 1){
    var authorPat = /^([A-Z\u00C0-\u00D6][a-z\u00E0-\u00F6]+\s+[A-Z]{1,3}(?:[,;]\s*[A-Z\u00C0-\u00D6][a-z\u00E0-\u00F6]+\s+[A-Z]{1,3})*(?:,?\s*et al)?)/;
    var am = parts[0].match(authorPat);
    if(am) authors = am[1]; else authors = parts[0];
  }
  if(parts.length >= 2) title = parts[1];
  if(parts.length >= 3){ journal = parts[2].replace(/\s*\d{4}.*$/, '').trim(); }
  return { title:title, authors:authors, year:parseInt(year)||null, journal:journal, doi:doi, tags:[], abstract:'', keyPoints:[] };
}

function parseAPA(text){
  var doi = (text.match(/https?:\/\/doi\.org\/([^\s]+)/)||text.match(/\bdoi:\s*([^\s.,;]+)/i)||[])[1] || '';
  var yearM = text.match(/\((\d{4})\)/);
  var year = yearM ? parseInt(yearM[1]) : null;
  var authors = '', title = '', journal = '';
  if(yearM){
    authors = text.slice(0, yearM.index).trim().replace(/\.$/, '');
    var after = text.slice(yearM.index + yearM[0].length).trim().replace(/^\.\s*/,'');
    var titleEnd = after.search(/\.\s+[A-Z\u00C0-\u00D6]/);
    if(titleEnd > -1){
      title = after.slice(0, titleEnd);
      var rest = after.slice(titleEnd).replace(/^\.\s*/,'');
      journal = rest.split(',')[0].trim();
    } else {
      title = after.split('.')[0];
    }
  }
  return { title:title, authors:authors, year:year, journal:journal, doi:doi, tags:[], abstract:'', keyPoints:[] };
}

function parseAMA(text){ return parseNLM(text.replace(/^\d+\.\s*/, '')); }

function parseMLA(text){
  var doi = (text.match(/\bdoi\.org\/([^\s,;]+)/i)||text.match(/\bdoi:\s*([^\s,;]+)/i)||[])[1] || '';
  var year = (text.match(/\b(19|20)\d{2}\b/)||[])[0] || '';
  var titleM = text.match(/"([^"]+)"/);
  var title = titleM ? titleM[1] : '';
  var authors = titleM ? text.slice(0, text.indexOf('"')).trim().replace(/\.$/, '') : '';
  var afterTitle = titleM ? text.slice(text.indexOf('"', text.indexOf('"')+1)+1).trim().replace(/^\.\s*/,'') : '';
  var journal = afterTitle.split(',')[0].replace(/^\s*/, '').trim();
  return { title:title, authors:authors, year:parseInt(year)||null, journal:journal, doi:doi, tags:[], abstract:'', keyPoints:[] };
}

function parseSingleCitation(text, format){
  var fmt = format === 'auto' ? detectFormat(text) : format;
  if(fmt === 'apa') return parseAPA(text);
  if(fmt === 'mla') return parseMLA(text);
  if(fmt === 'ama') return parseAMA(text);
  return parseNLM(text);
}

function parseCitation(){
  var raw = document.getElementById('citeInput').value.trim();
  var format = document.getElementById('citeFormatSelect').value;
  var errEl = document.getElementById('citeParseError');
  if(!raw){ errEl.textContent='\u8ACB\u5148\u8CBC\u5165\u5F15\u7528\u6587\u5B57'; errEl.style.display='block'; return; }
  errEl.style.display='none';
  var chunks = splitCitations(raw);
  citeQueue = chunks.map(function(c){return parseSingleCitation(c, format);});
  citeQueueIdx = 0;
  document.getElementById('citePasteScreen').style.display = 'none';
  document.getElementById('citeReviewScreen').style.display = 'block';
  var nav = document.getElementById('citeMultiNav');
  if(citeQueue.length > 1){ nav.style.display = 'flex'; } else { nav.style.display = 'none'; }
  loadCiteReviewFields(citeQueueIdx);
  updateCiteNav();
  updateCiteQueueStatus();
}

function loadCiteReviewFields(idx){
  var p = citeQueue[idx] || {};
  document.getElementById('citeEditTitle').value   = p.title || '';
  document.getElementById('citeEditAuthors').value = p.authors || '';
  document.getElementById('citeEditYear').value    = p.year || '';
  document.getElementById('citeEditJournal').value = p.journal || '';
  document.getElementById('citeEditDoi').value     = p.doi || '';
  document.getElementById('citeEditTags').value    = (p.tags||[]).join(', ');
  document.getElementById('citeEditAbstract').value= p.abstract || '';
}

function readCiteReviewFields(){
  return {
    title:    document.getElementById('citeEditTitle').value.trim(),
    authors:  document.getElementById('citeEditAuthors').value.trim(),
    year:     parseInt(document.getElementById('citeEditYear').value)||null,
    journal:  document.getElementById('citeEditJournal').value.trim(),
    doi:      document.getElementById('citeEditDoi').value.trim(),
    tags:     document.getElementById('citeEditTags').value.split(',').map(function(t){return t.trim();}).filter(Boolean),
    abstract: document.getElementById('citeEditAbstract').value.trim(),
    keyPoints:[],
    _confirmed: true,
  };
}

function saveCiteCurrentEdits(){ citeQueue[citeQueueIdx] = Object.assign({}, citeQueue[citeQueueIdx], readCiteReviewFields()); }

function updateCiteNav(){
  document.getElementById('citeNavLabel').textContent = '\u7B2C '+( citeQueueIdx+1)+' / '+citeQueue.length+' \u7B46';
}

function updateCiteQueueStatus(){
  var confirmed = citeQueue.filter(function(p){return p._confirmed;}).length;
  var el = document.getElementById('citeQueueStatus');
  if(citeQueue.length > 1){
    el.textContent = '\u5DF2\u78BA\u8A8D '+confirmed+' / '+citeQueue.length+' \u7B46\uFF0C\u9EDE\u300C\u532F\u5165\u8CC7\u6599\u5EAB\u300D\u4E00\u6B21\u5168\u90E8\u65B0\u589E';
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function citeNavStep(dir){
  saveCiteCurrentEdits();
  citeQueueIdx = Math.max(0, Math.min(citeQueue.length-1, citeQueueIdx + dir));
  loadCiteReviewFields(citeQueueIdx);
  updateCiteNav();
  updateCiteQueueStatus();
}

function queueCiteResult(){
  saveCiteCurrentEdits();
  var next = -1;
  for(var i=citeQueueIdx+1;i<citeQueue.length;i++){ if(!citeQueue[i]._confirmed){next=i;break;} }
  if(next > -1){
    citeQueueIdx = next;
    loadCiteReviewFields(citeQueueIdx);
    updateCiteNav();
  }
  updateCiteQueueStatus();
  showToast('\u5DF2\u78BA\u8A8D\u6B64\u7B46\uFF0C\u7E7C\u7E8C\u6838\u5C0D\u4E0B\u4E00\u7B46\u6216\u9EDE\u300C\u532F\u5165\u8CC7\u6599\u5EAB\u300D', 'info');
}

function importAllCiteResults(){
  saveCiteCurrentEdits();
  var toImport = citeQueue.length === 1 ? citeQueue : citeQueue.filter(function(p){return p._confirmed;});
  if(!toImport.length){ showToast('\u8ACB\u5148\u9EDE\u300C\u78BA\u8A8D\u6B64\u7B46\u300D\u78BA\u8A8D\u81F3\u5C11\u4E00\u7B46', 'error'); return; }
  var first = toImport[0];
  if(!first.title){ showToast('\u8ACB\u586B\u5165\u8AD6\u6587\u6A19\u984C', 'error'); return; }
  if(toImport.length === 1){
    closeCiteModal();
    editingId = null;
    document.getElementById('modalTitle').textContent = '\u65B0\u589E\u8AD6\u6587\uFF08\u5F15\u7528\u532F\u5165\uFF09Add Paper';
    document.getElementById('fTitle').value    = first.title;
    document.getElementById('fAuthors').value  = first.authors || '';
    document.getElementById('fYear').value     = first.year || '';
    document.getElementById('fJournal').value  = first.journal || '';
    document.getElementById('fDoi').value      = first.doi || '';
    document.getElementById('fTags').value     = (first.tags||[]).join(', ');
    document.getElementById('fAbstract').value = first.abstract || '';
    document.getElementById('fKeyPoints').value = '';
    document.getElementById('fNotes').value    = '';
    document.getElementById('modalOverlay').classList.add('open');
    showToast('\u5F15\u7528\u5DF2\u89E3\u6790\uFF0C\u8ACB\u88DC\u5145\u8CC7\u8A0A\u5F8C\u5132\u5B58', 'info');
  } else {
    var added = 0;
    toImport.forEach(function(p){
      if(!p.title) return;
      papers.unshift({
        id: Date.now() + added,
        title: p.title, authors: p.authors||'', year: p.year||null,
        journal: p.journal||'', doi: p.doi||'', tags: p.tags||[],
        abstract: p.abstract||'', keyPoints: [], notes: '',
        favourite: false, hasPdf: false, pdfName: null,
        projectIds: [], addedAt: new Date().toISOString()
      });
      added++;
    });
    savePapers(papers);
    closeCiteModal();
    renderAll();
    showToast('\u5DF2\u6279\u6B21\u532F\u5165 '+added+' \u7BC7\u8AD6\u6587', 'success');
  }
}

// Click-outside disabled for cite modal — use cancel button to close

// Smart scroll: redirect wheel events to correct scrollable panel
(function(){
  // Find the closest scrollable ancestor
  function findScrollable(el){
    while(el && el !== document.body){
      var style = window.getComputedStyle(el);
      var overflow = style.overflowY;
      if((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight){
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  window.addEventListener('wheel', function(e){
    var aside   = document.querySelector('aside');
    var mainCol = document.querySelector('.main-col');

    // Check if mouse is inside any open modal overlay
    var modalOverlays = document.querySelectorAll('.modal-overlay.open, .ai-modal-overlay.open, .del-modal-overlay.open, .proj-modal-overlay.open, [id$="ModalOverlay"].open, [id="citeModalOverlay"].open');
    for(var i = 0; i < modalOverlays.length; i++){
      if(modalOverlays[i].contains(e.target)){
        // Find the scrollable modal box inside and scroll it
        var scrollable = findScrollable(e.target);
        if(scrollable){
          scrollable.scrollTop += e.deltaY * 0.5;
          e.preventDefault();
        }
        return;
      }
    }

    if(!aside || !mainCol) return;
    // If already inside a panel, let browser handle naturally
    var t = e.target;
    while(t && t !== document.body){
      if(t === aside || t === mainCol) return;
      t = t.parentElement;
    }
    // Route to left or right panel based on mouse X
    var asideRect = aside.getBoundingClientRect();
    var panel = (e.clientX <= asideRect.right) ? aside : mainCol;
    panel.scrollTop += e.deltaY * 0.5;
    e.preventDefault();
  }, {passive: false});
})();
