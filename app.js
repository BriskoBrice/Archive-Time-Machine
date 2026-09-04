(() => {
  'use strict';

  const CONFIG = {
    minYear: 1980,
    maxYear: 2005,
    capsuleSize: 9,
    api: 'https://archive.org/advancedsearch.php',
    details: id => `https://archive.org/details/${encodeURIComponent(id)}`,
    thumb: id => `https://archive.org/services/img/${encodeURIComponent(id)}`,
    embed: id => `https://archive.org/embed/${encodeURIComponent(id)}`,
    timeoutMs: 14000,
    frenchFilter: '(language:French OR language:fre OR language:fra OR language:fr)',
  };

  const $ = s => document.querySelector(s);
  const els = {
    homeView: $('#homeView'), resultsView: $('#resultsView'), todayLabel: $('#todayLabel'), yearInput: $('#yearInput'),
    loader: $('#loader'), loaderTitle: $('#loaderTitle'), loaderText: $('#loaderText'), errorBox: $('#errorBox'),
    resultsEyebrow: $('#resultsEyebrow'), resultsTitle: $('#resultsTitle'), resultsSub: $('#resultsSub'),
    exactSection: $('#exactSection'), exactGrid: $('#exactGrid'), exactCount: $('#exactCount'),
    aroundSection: $('#aroundSection'), aroundGrid: $('#aroundGrid'), capsuleSection: $('#capsuleSection'), capsuleGrid: $('#capsuleGrid'), capsuleCount: $('#capsuleCount'),
    drawer: $('#drawer'), drawerContent: $('#drawerContent'), drawerTitle: $('#drawerTitle'), drawerEyebrow: $('#drawerEyebrow'), scrim: $('#scrim'),
    viewer: $('#viewer'), viewerTitle: $('#viewerTitle'), viewerBody: $('#viewerBody'), favCount: $('#favCount')
  };

  const state = { mode: 'home', year: 1994, depth: 0, items: new Map(), activeRequest: null, requestToken: 0 };
  const monthNames = ['JANVIER','FÉVRIER','MARS','AVRIL','MAI','JUIN','JUILLET','AOÛT','SEPTEMBRE','OCTOBRE','NOVEMBRE','DÉCEMBRE'];
  const store = {
    get(k, fallback){ try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  const escapeHtml = s => String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const asText = v => Array.isArray(v) ? v.filter(Boolean).join(', ') : (v == null || v === '' ? '' : String(v));
  const clampYear = y => Math.max(CONFIG.minYear, Math.min(CONFIG.maxYear, Number(y) || 1997));
  const shuffle = a => { const b=[...a]; for(let i=b.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[b[i],b[j]]=[b[j],b[i]];} return b; };
  const uniqueById = arr => [...new Map(arr.filter(x=>x?.identifier).map(x => [x.identifier,x])).values()];
  const truncate = (s,n=230) => { s=asText(s).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); return s.length>n ? s.slice(0,n-1).trim()+'…' : s; };

  function formatKnownDate(item){
    const raw = asText(item.date).trim();
    if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) return raw.slice(0,10);
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    if (/^\d{4}$/.test(raw)) return raw;
    const yr = asText(item.year).match(/\b(19|20)\d{2}\b/)?.[0];
    return raw || yr || 'Information non disponible';
  }

  function exactISO(item){
    const raw = asText(item.date).trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if(!m) return null;
    const [_,y,mo,d] = m;
    const dt = new Date(`${y}-${mo}-${d}T00:00:00Z`);
    if(Number.isNaN(dt.getTime()) || dt.toISOString().slice(0,10) !== `${y}-${mo}-${d}`) return null;
    return `${y}-${mo}-${d}`;
  }

  function category(item){
    const m=(item.mediatype||'').toLowerCase();
    if(m==='software') return 'LOGICIEL / JEU'; if(m==='movies') return 'VIDÉO'; if(m==='audio') return 'AUDIO / RADIO';
    if(m==='texts') return 'TEXTE / PÉRIODIQUE'; if(m==='image') return 'IMAGE / PHOTO'; if(m==='web') return 'WEB';
    return m ? m.toUpperCase() : 'ARCHIVE';
  }

  function beginArchiveRequest(){
    if(state.activeRequest) state.activeRequest.abort();
    state.activeRequest=new AbortController();
    state.requestToken+=1;
    return {signal:state.activeRequest.signal, token:state.requestToken};
  }
  function isCurrentRequest(token){ return token===state.requestToken; }

  async function searchArchive({q, rows=50, page=1, sort=[], signal}){
    const filteredQ = `(${q}) AND ${CONFIG.frenchFilter}`;
    const params = new URLSearchParams({q:filteredQ, rows:String(rows), page:String(page), output:'json'});
    ['identifier','title','date','year','mediatype','description','creator','subject','collection','downloads','language'].forEach(f => params.append('fl[]',f));
    sort.forEach(s => params.append('sort[]',s));
    const abortController = new AbortController();
    const forwardAbort=()=>abortController.abort();
    if(signal){ if(signal.aborted) abortController.abort(); else signal.addEventListener('abort',forwardAbort,{once:true}); }
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;abortController.abort();},CONFIG.timeoutMs);
    try{
      const res = await fetch(`${CONFIG.api}?${params}`, {signal:abortController.signal, mode:'cors', cache:'no-store'});
      if(!res.ok) throw new Error(`Archive.org a répondu HTTP ${res.status}.`);
      const json = await res.json();
      if(!json?.response || !Array.isArray(json.response.docs)) throw new Error('Réponse Archive.org inattendue.');
      return {docs:json.response.docs, numFound:Number(json.response.numFound)||0};
    } catch(err){
      if(err?.name==='AbortError' && timedOut && !signal?.aborted) throw new Error('La requête Archive.org a expiré. Réessaie dans quelques secondes.');
      throw err;
    } finally {
      clearTimeout(timer);
      if(signal) signal.removeEventListener('abort',forwardAbort);
    }
  }

  function setLoading(on,title='INTERROGATION DES ARCHIVES…',text='Connexion à Internet Archive.'){
    els.loader.hidden=!on; els.loaderTitle.textContent=title; els.loaderText.textContent=text;
  }
  function clearResults(){
    els.errorBox.hidden=true; els.exactSection.hidden=true; els.aroundSection.hidden=true; els.capsuleSection.hidden=true;
    els.exactGrid.innerHTML=''; els.aroundGrid.innerHTML=''; els.capsuleGrid.innerHTML=''; state.items.clear();
  }
  function showError(err){
    els.errorBox.hidden=false;
    const msg=err?.message||'Erreur réseau.'; const noResult=/Aucun|aucune catégorie/i.test(msg);
    els.errorBox.innerHTML=`<strong>${noResult?'AUCUN OBJET FIABLE RETROUVÉ':'CONNEXION AUX ARCHIVES IMPOSSIBLE'}</strong><p>${escapeHtml(err?.name==='AbortError'?'La requête a été interrompue.':msg)}</p><p>La V1 n’utilise aucune donnée fictive : si Archive.org ne répond pas ou ne fournit rien d’assez fiable, elle n’invente pas de capsule.</p>`;
  }
  function showResults(){ els.homeView.classList.remove('active'); els.resultsView.classList.add('active'); window.scrollTo({top:0}); }
  function showHome(){ if(state.activeRequest){state.activeRequest.abort();state.activeRequest=null;state.requestToken+=1;} els.resultsView.classList.remove('active'); els.homeView.classList.add('active'); state.mode='home'; els.yearInput.value=state.year||clampYear(els.yearInput.value); syncChronoscope(); window.scrollTo({top:0}); }

  function card(item,{exact=false,pepite=false}={}){
    state.items.set(item.identifier,item);
    const node=$('#cardTemplate').content.firstElementChild.cloneNode(true);
    if(pepite) node.classList.add('pepite');
    const img=node.querySelector('.thumb'), fallback=node.querySelector('.thumb-fallback'); img.src=CONFIG.thumb(item.identifier); img.alt=`Aperçu : ${asText(item.title)||'archive'}`;
    img.onerror=()=>{ img.style.display='none'; fallback.classList.add('show'); };
    node.querySelector('.media-badge').textContent=asText(item.mediatype).toUpperCase()||'ARCHIVE';
    const date=node.querySelector('.date-chip'); date.textContent=formatKnownDate(item); if(exact) date.classList.add('exact');
    node.querySelector('.category-chip').textContent=category(item);
    node.querySelector('.card-title').textContent=asText(item.title)||'Information non disponible';
    node.querySelector('.creator').textContent=asText(item.creator)||'Auteur / créateur : information non disponible';
    node.querySelector('.description').textContent=truncate(item.description)||'Description : information non disponible';
    const out=node.querySelector('.link-btn'); out.href=CONFIG.details(item.identifier);
    const fav=node.querySelector('.fav-btn'); syncFavButton(fav,item.identifier); fav.addEventListener('click',()=>toggleFavorite(item,fav));
    node.querySelector('.view-btn').addEventListener('click',()=>openViewer(item));
    return node;
  }

  function renderGrid(el, items, opts={}){
    el.innerHTML=''; const frag=document.createDocumentFragment(); items.forEach((it,i)=>frag.appendChild(card(it,{...opts,pepite:opts.pepiteIndex===i}))); el.appendChild(frag);
  }

  function scorePepite(item){
    let s=0; const d=Number(item.downloads); if(Number.isFinite(d)){ if(d<100)s+=5; else if(d<1000)s+=3; else if(d<10000)s+=1; }
    if(asText(item.description)) s+=2; if(asText(item.creator)) s+=1; if(asText(item.subject)) s+=1;
    const t=(asText(item.title)+' '+asText(item.subject)).toLowerCase();
    if(/demo|catalog|catalogue|shareware|promotional|training|manual|local|amateur|bulletin|newsletter|vhs|cd-rom|cdrom|diskette|floppy/.test(t)) s+=4;
    return s+Math.random()*1.5;
  }

  function choosePepite(items){
    if(!items.length) return -1; let best=0,bestScore=-Infinity; items.forEach((it,i)=>{const s=scorePepite(it); if(s>bestScore){best=i;bestScore=s;}}); return best;
  }

  async function openCapsule(year, deep=false){
    year=clampYear(year);
    const continuingSameCapsule=state.mode==='capsule' && state.year===year;
    state.mode='capsule'; state.year=year; state.depth=deep?(continuingSameCapsule?state.depth+1:1):0;
    const {signal,token}=beginArchiveRequest();
    showResults(); clearResults();
    els.resultsEyebrow.textContent=deep?`PROFONDEUR ${state.depth} // CAPSULE TEMPORELLE`:'CAPSULE TEMPORELLE';
    els.resultsTitle.textContent=year; els.resultsSub.textContent=deep?'Recherche relancée en français avec exclusion des objets déjà vus.':'Sélection variée en français construite à partir des métadonnées publiques.';
    setLoading(true, deep?'DESCENTE DANS LES ARCHIVES…':'CONSTRUCTION DE LA CAPSULE…',`Recherche d’objets en français datés de ${year}.`);
    try{
      const seen = new Set(store.get('atmSeen',[]));
      const buckets=[
        ['software',`year:${year} AND mediatype:software`], ['texts',`year:${year} AND mediatype:texts`], ['movies',`year:${year} AND mediatype:movies`],
        ['audio',`year:${year} AND mediatype:audio`], ['image',`year:${year} AND mediatype:image`]
      ];
      const depth=state.depth;
      const settled=await Promise.allSettled(buckets.map(([_,q],idx)=>{
        const page = deep ? 2 + ((depth*7+idx*3)%12) : 1 + ((year+idx*5)%4);
        const sort = deep ? ['downloads asc'] : [];
        return searchArchive({q,rows:36,page,sort,signal});
      }));
      if(!isCurrentRequest(token)) return;
      const failures=settled.filter(x=>x.status==='rejected');
      const fulfilled=settled.filter(x=>x.status==='fulfilled').map(x=>x.value);
      if(!fulfilled.length){
        const first=failures[0]?.reason;
        if(first?.name==='AbortError') throw first;
        throw new Error(first?.message||'Internet Archive n’a répondu à aucune catégorie.');
      }
      if(failures.length) els.resultsSub.textContent+=` ${failures.length} catégorie${failures.length>1?'s':''} n’a${failures.length>1?'ont':''} pas répondu, les autres résultats restent utilisables.`;
      const byBucket=settled.map(r=>r.status==='fulfilled'?shuffle(r.value.docs).filter(x=>x.identifier && x.title):[]);
      let selected=[];
      for(const bucket of byBucket){ const pick=bucket.find(x=>!seen.has(x.identifier)); if(pick) selected.push(pick); }
      const pool=shuffle(uniqueById(byBucket.flat())).filter(x=>!selected.some(s=>s.identifier===x.identifier));
      for(const it of pool){ if(selected.length>=CONFIG.capsuleSize) break; if(!seen.has(it.identifier)) selected.push(it); }
      if(selected.length<6){ for(const it of pool){ if(selected.length>=CONFIG.capsuleSize) break; if(!selected.some(s=>s.identifier===it.identifier)) selected.push(it); } }
      selected=uniqueById(selected).slice(0,CONFIG.capsuleSize);
      if(!selected.length) throw new Error(`Aucun objet exploitable n’a été retourné pour ${year}.`);
      if(!isCurrentRequest(token)) return;
      const pepiteIndex=choosePepite(selected);
      renderGrid(els.capsuleGrid,selected,{pepiteIndex});
      els.capsuleCount.textContent=`${selected.length} OBJET${selected.length>1?'S':''} RETROUVÉ${selected.length>1?'S':''}`;
      els.capsuleSection.hidden=false;
      saveSeen(selected.map(x=>x.identifier)); saveCapsuleHistory(year,selected.length,deep);
    }catch(err){
      if(isCurrentRequest(token) && err?.name!=='AbortError') showError(err);
    }finally{
      if(isCurrentRequest(token)){ setLoading(false); state.activeRequest=null; }
    }
  }

  async function exploreToday(){
    const now=new Date(); const month=String(now.getMonth()+1).padStart(2,'0'), day=String(now.getDate()).padStart(2,'0');
    state.mode='today'; state.depth=0;
    const {signal,token}=beginArchiveRequest();
    showResults(); clearResults(); els.resultsEyebrow.textContent='MODE CE JOUR-LÀ'; els.resultsTitle.textContent=`${now.getDate()} ${monthNames[now.getMonth()]}`; els.resultsSub.textContent=`Recherche de dates exactes confirmées en français entre ${CONFIG.minYear} et ${CONFIG.maxYear}.`;
    setLoading(true,'CALAGE DES COORDONNÉES TEMPORELLES…',`Vérification du ${day}/${month} dans les archives francophones sur ${CONFIG.maxYear-CONFIG.minYear+1} années.`);
    try{
      const exactTerms=[]; for(let y=CONFIG.minYear;y<=CONFIG.maxYear;y++) exactTerms.push(`date:"${y}-${month}-${day}"`);
      const exactQuery=`(${exactTerms.join(' OR ')})`;
      const exactRes=await searchArchive({q:exactQuery,rows:150,page:1,signal});
      if(!isCurrentRequest(token)) return;
      const exact=uniqueById(exactRes.docs).filter(it=>{ const iso=exactISO(it); return iso && iso.slice(5,10)===`${month}-${day}` && Number(iso.slice(0,4))>=CONFIG.minYear && Number(iso.slice(0,4))<=CONFIG.maxYear; });
      const exactShown=shuffle(exact).slice(0,18);
      if(exactShown.length){ renderGrid(els.exactGrid,exactShown,{exact:true}); els.exactCount.textContent=`${exactShown.length} confirmé${exactShown.length>1?'s':''}`; els.exactSection.hidden=false; }

      const sampleYears=[CONFIG.minYear,1985,1990,1995,2000,CONFIG.maxYear].filter((v,i,a)=>v>=CONFIG.minYear&&v<=CONFIG.maxYear&&a.indexOf(v)===i);
      const aroundQ=`(${sampleYears.map(y=>`year:${y}`).join(' OR ')}) AND (mediatype:texts OR mediatype:movies OR mediatype:audio OR mediatype:software OR mediatype:image)`;
      const aroundRes=await searchArchive({q:aroundQ,rows:70,page:1,signal});
      if(!isCurrentRequest(token)) return;
      const exactIds=new Set(exact.map(x=>x.identifier));
      const around=shuffle(uniqueById(aroundRes.docs)).filter(x=>x.title&&!exactIds.has(x.identifier)&&!exactISO(x)).slice(0,9);
      if(around.length){ renderGrid(els.aroundGrid,around); els.aroundSection.hidden=false; }
      if(!exactShown.length && !around.length) throw new Error('Aucun résultat suffisamment fiable n’a été retourné pour cette exploration.');
    }catch(err){
      if(isCurrentRequest(token) && err?.name!=='AbortError') showError(err);
    }finally{
      if(isCurrentRequest(token)){ setLoading(false); state.activeRequest=null; }
    }
  }

  function saveSeen(ids){ const old=store.get('atmSeen',[]); store.set('atmSeen',[...new Set([...ids,...old])].slice(0,350)); }
  function saveCapsuleHistory(year,count,deep){ const h=store.get('atmHistory',[]); h.unshift({year,count,deep,at:new Date().toISOString()}); store.set('atmHistory',h.slice(0,24)); }
  function favorites(){ return store.get('atmFavorites',[]); }
  function updateFavCount(){ els.favCount.textContent=favorites().length; }
  function syncFavButton(btn,id){ btn.classList.toggle('on',favorites().some(x=>x.identifier===id)); btn.textContent=btn.classList.contains('on')?'★':'☆'; }
  function toggleFavorite(item,btn){ let f=favorites(); const i=f.findIndex(x=>x.identifier===item.identifier); if(i>=0) f.splice(i,1); else f.unshift({identifier:item.identifier,title:asText(item.title)||'Information non disponible',date:formatKnownDate(item),mediatype:item.mediatype||''}); store.set('atmFavorites',f.slice(0,100)); syncFavButton(btn,item.identifier); updateFavCount(); }

  function openDrawer(type){
    els.drawerContent.innerHTML='';
    if(type==='favorites'){
      els.drawerEyebrow.textContent='MÉMOIRE LOCALE'; els.drawerTitle.textContent='Favoris'; const f=favorites();
      if(!f.length) els.drawerContent.innerHTML='<p>Aucune pépite sauvegardée pour le moment.</p>';
      else f.forEach(it=>els.drawerContent.appendChild(miniItem(it)));
    }else{
      els.drawerEyebrow.textContent='DERNIÈRES EXPLORATIONS'; els.drawerTitle.textContent='Historique'; const h=store.get('atmHistory',[]);
      if(!h.length) els.drawerContent.innerHTML='<p>Aucune capsule visitée pour le moment.</p>';
      else h.forEach(x=>{const d=document.createElement('button');d.className='mini-item';d.style.width='100%';d.style.color='inherit';d.style.background='transparent';d.innerHTML=`<div style="font-size:26px">${escapeHtml(x.year)}</div><div><strong>Capsule ${escapeHtml(x.year)}</strong><small>${x.count} objets · ${x.deep?'exploration profonde':'exploration initiale'}</small></div><span>↗</span>`;d.onclick=()=>{closeDrawer();els.yearInput.value=x.year;openCapsule(x.year,false);};els.drawerContent.appendChild(d);});
    }
    els.drawer.classList.add('open'); els.drawer.setAttribute('aria-hidden','false'); els.scrim.hidden=false;
  }
  function miniItem(it){ const d=document.createElement('div');d.className='mini-item';d.innerHTML=`<img src="${CONFIG.thumb(it.identifier)}" alt=""><div><strong>${escapeHtml(it.title)}</strong><small>${escapeHtml(it.date)} · ${escapeHtml(it.mediatype||'archive')}</small></div><a href="${CONFIG.details(it.identifier)}" target="_blank" rel="noopener noreferrer">↗</a>`; return d; }
  function closeDrawer(){ els.drawer.classList.remove('open'); els.drawer.setAttribute('aria-hidden','true'); els.scrim.hidden=true; }

  function openViewer(item){
    els.viewerTitle.textContent=asText(item.title)||item.identifier; els.viewerBody.innerHTML='';
    const tools=document.createElement('div'); tools.className='viewer-tools'; tools.innerHTML='<span>Si le lecteur n’est pas disponible pour cet objet, ouvre sa fiche originale.</span>';
    const viewerFallback=document.createElement('a'); viewerFallback.href=CONFIG.details(item.identifier); viewerFallback.target='_blank'; viewerFallback.rel='noopener noreferrer'; viewerFallback.textContent='OUVRIR SUR ARCHIVE.ORG ↗'; tools.appendChild(viewerFallback);
    const wrap=document.createElement('div'); wrap.className='viewer-frame-wrap';
    const iframe=document.createElement('iframe'); iframe.src=CONFIG.embed(item.identifier); iframe.loading='eager'; iframe.allow='autoplay; fullscreen'; iframe.allowFullscreen=true; iframe.title=`Lecteur Archive.org : ${asText(item.title)||item.identifier}`;
    wrap.appendChild(iframe); els.viewerBody.append(tools,wrap); els.viewer.showModal();
  }
  function closeViewer(){ if(els.viewer.open) els.viewer.close(); els.viewerBody.innerHTML=''; }

  function renderChronoscope(y){
    document.querySelectorAll('[data-year-offset]').forEach(el=>{
      const val=y+Number(el.dataset.yearOffset); const outOfRange=val<CONFIG.minYear||val>CONFIG.maxYear;
      el.textContent=outOfRange?'····':val; el.style.opacity=outOfRange?'.22':''; el.setAttribute('aria-hidden',outOfRange?'true':'false');
    });
    const dialStatus=$('#dialStatus'); if(dialStatus) dialStatus.textContent=`CAPSULE ${y} // PRÊTE`;
  }
  function syncChronoscope(){
    const y=clampYear(els.yearInput.value); els.yearInput.value=y; renderChronoscope(y);
  }
  function syncChronoscopePreview(){
    const raw=String(els.yearInput.value||'').replace(/\D/g,'').slice(0,4);
    if(String(els.yearInput.value)!==raw) els.yearInput.value=raw;
    if(/^\d{4}$/.test(raw)){
      const y=Number(raw);
      if(y>=CONFIG.minYear && y<=CONFIG.maxYear){ renderChronoscope(y); return; }
    }
    const dialStatus=$('#dialStatus'); if(dialStatus) dialStatus.textContent=`SAISIR ${CONFIG.minYear}—${CONFIG.maxYear}`;
  }
  const now=new Date(); els.todayLabel.textContent=`${now.getDate()} ${monthNames[now.getMonth()]}`;
  els.yearInput.min=CONFIG.minYear; els.yearInput.max=CONFIG.maxYear;
  $('#yearMinus').onclick=()=>{els.yearInput.value=clampYear(Number(els.yearInput.value)-1);syncChronoscope();};
  $('#yearPlus').onclick=()=>{els.yearInput.value=clampYear(Number(els.yearInput.value)+1);syncChronoscope();};
  els.yearInput.onchange=syncChronoscope;
  els.yearInput.onblur=syncChronoscope;
  els.yearInput.oninput=syncChronoscopePreview;
  els.yearInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ syncChronoscope(); els.yearInput.blur(); } });
  $('#openCapsuleBtn').onclick=()=>openCapsule(els.yearInput.value,false);
  $('#deeperBtn').onclick=()=>openCapsule(state.year,true);
  const homeDeep=$('#homeDeeperBtn'); if(homeDeep) homeDeep.onclick=()=>openCapsule(els.yearInput.value,true);
  $('#todayExploreBtn').onclick=exploreToday;
  syncChronoscope();
  $('#backBtn').onclick=showHome; $('#homeBtn').onclick=showHome;
  $('#favoritesBtn').onclick=()=>openDrawer('favorites'); $('#historyBtn').onclick=()=>openDrawer('history');
  $('#drawerClose').onclick=closeDrawer; els.scrim.onclick=closeDrawer;
  $('#viewerClose').onclick=closeViewer; els.viewer.addEventListener('close',()=>els.viewerBody.innerHTML='');
  updateFavCount();
})();
