(()=>{
  const route='#/dotace';
  const perPage=25;
  let renderSeq=0;
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=n=>Number(n||0).toLocaleString('cs-CZ',{maximumFractionDigits:0})+' Kč';
  const normalize=s=>String(s||'').toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const typeLabel=t=>String(t||'').toLowerCase()==='programová'?'dotační řízení':(t||'dotační řízení');

  async function loadGrants(){
    const r=await fetch(`data/dotace.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function pagerMarkup(page,pages){
    const nums=[];
    for(let i=Math.max(1,page-2);i<=Math.min(pages,page+2);i++)nums.push(i);
    return `<button ${page===1?'disabled':''} data-page="${page-1}">← Předchozí</button>${page>3?'<span>…</span>':''}${nums.map(i=>`<button class="${i===page?'active':''}" data-page="${i}">${i}</button>`).join('')}${page<pages-2?'<span>…</span>':''}<button ${page===pages?'disabled':''} data-page="${page+1}">Další →</button>`;
  }

  function buildRows(grants){
    return grants.map(g=>`<article class="grant-row">
      <div class="grant-main"><b>${esc(g.recipient)}</b><span>${g.ico?`IČ ${esc(g.ico)}`:'IČ neuvedeno'}</span></div>
      <div class="grant-area"><span>${esc(g.area)}</span><small>${esc(typeLabel(g.type))}</small></div>
      <div class="grant-year">${esc(g.year||'—')}</div>
      <div class="grant-amount"><strong>${money(g.approvedCzk)}</strong></div>
      <div class="grant-source"><a href="${esc(g.resolutionUrl||g.sourcePage||g.sourceFile||'#')}" target="_blank" rel="noreferrer">Zdroj ↗</a></div>
    </article>`).join('');
  }

  async function render(){
    if(location.hash!==route)return;
    const seq=++renderSeq;
    const app=document.querySelector('#app');
    if(!app)return;
    app.innerHTML='<div class="wrap"><div class="grant-loading">Načítám dotace…</div></div>';
    try{
      const payload=await loadGrants();
      if(seq!==renderSeq||location.hash!==route)return;
      const grants=Array.isArray(payload.grants)?payload.grants:[];
      const areas=[...new Set(grants.map(g=>g.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'cs'));
      const years=[...new Set(grants.map(g=>Number(g.year)).filter(Boolean))].sort((a,b)=>b-a);
      const recipients=new Set(grants.map(g=>g.ico?`ico:${g.ico}`:`name:${normalize(g.recipient)}`));
      const total=grants.reduce((s,g)=>s+Number(g.approvedCzk||0),0);
      const summaryYear=years.length===1?years[0]:null;
      let page=1;

      app.innerHTML=`<div class="wrap grants-preview">
        <div class="page-head grants-head"><div class="kicker">Finance</div><h1>Dotace a granty</h1><p>Přehled dotací poskytnutých městskou částí Praha 8 organizacím a dalším příjemcům. Každý záznam odkazuje na původní zdroj.</p></div>
        <section class="grants-summary">
          <div><small>Dotací v databázi</small><strong>${grants.length.toLocaleString('cs-CZ')}</strong><span>načtených záznamů</span></div>
          <div><small>Příjemců</small><strong>${recipients.size.toLocaleString('cs-CZ')}</strong><span>organizací a dalších příjemců</span></div>
          <div><small>Schválená částka${summaryYear?` · ${summaryYear}`:''}</small><strong>${money(total)}</strong><span>${summaryYear?`celkem schváleno v roce ${summaryYear}`:'celkem schváleno'}</span></div>
        </section>
        <div class="grant-note"><b>Pracovní dataset.</b> Přehled nyní postupně doplňujeme o sociální a individuální dotace i další historické ročníky. Nezahrnujeme dotace, kde je MČ Praha 8 příjemcem prostředků od hlavního města Prahy nebo jiného poskytovatele.</div>
        <section class="section grant-list-section">
          <div class="grant-toolbar">
            <div><div class="kicker">Přehled</div><h2>Poskytnuté dotace</h2></div>
            <div class="grant-filters"><input id="grantSearch" type="search" placeholder="Hledat příjemce nebo IČ…"><select id="grantArea"><option value="">Všechny oblasti</option>${areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div>
          </div>
          <div id="grantResultCount" class="updated"></div>
          <div class="grant-list-head"><span>Příjemce</span><span>Oblast</span><span>Rok</span><span>Částka</span><span>Zdroj</span></div>
          <div id="grantList" class="grant-list"></div>
          <div id="grantPager" class="pagination"></div>
        </section>
      </div>`;

      const draw=()=>{
        const q=normalize(app.querySelector('#grantSearch')?.value||'');
        const area=app.querySelector('#grantArea')?.value||'';
        const rows=grants.filter(g=>(!q||normalize([g.recipient,g.ico,g.area,g.project,typeLabel(g.type),g.year].join(' ')).includes(q))&&(!area||g.area===area));
        const pages=Math.max(1,Math.ceil(rows.length/perPage));
        page=Math.min(page,pages);
        const shown=rows.slice((page-1)*perPage,page*perPage);
        app.querySelector('#grantResultCount').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} dotací · stránka ${page} z ${pages}`;
        app.querySelector('#grantList').innerHTML=shown.length?buildRows(shown):'<div class="empty">Žádné dotace neodpovídají zvoleným filtrům.</div>';
        app.querySelector('#grantPager').innerHTML=pagerMarkup(page,pages);
        app.querySelectorAll('#grantPager button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();app.querySelector('#grantResultCount')?.scrollIntoView({behavior:'smooth',block:'center'})});
      };

      app.querySelectorAll('#grantSearch,#grantArea').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));
      draw();
      app.focus({preventScroll:true});
    }catch(error){
      if(seq!==renderSeq)return;
      app.innerHTML=`<div class="wrap"><div class="notice error-notice"><b>Dotace se nepodařilo načíst.</b> ${esc(error.message)}</div></div>`;
    }
  }

  const schedule=()=>setTimeout(render,0);
  addEventListener('hashchange',schedule);
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule);else schedule();
})();
