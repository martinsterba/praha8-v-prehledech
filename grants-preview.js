(()=>{
  const route='#/dotace';
  let renderSeq=0;
  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=n=>Number(n||0).toLocaleString('cs-CZ',{maximumFractionDigits:0})+' Kč';
  const normalize=s=>String(s||'').toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g,'');

  async function loadGrants(){
    const r=await fetch(`data/dotace.json?v=${Date.now()}`,{cache:'no-store'});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  function buildRows(grants){
    return grants.map((g,i)=>`<article class="grant-row" data-index="${i}" data-area="${esc(g.area)}" data-search="${esc(normalize([g.recipient,g.ico,g.area,g.project,g.type].join(' ')))}">
      <div class="grant-main"><b>${esc(g.recipient)}</b><span>${g.ico?`IČ ${esc(g.ico)}`:'IČ neuvedeno'}</span></div>
      <div class="grant-area"><span>${esc(g.area)}</span><small>${esc(g.type||'')}</small></div>
      <div class="grant-amount"><strong>${money(g.approvedCzk)}</strong></div>
      <div class="grant-source"><a href="${esc(g.sourcePage)}" target="_blank" rel="noreferrer">Zdroj ↗</a></div>
    </article>`).join('');
  }

  function applyFilters(root){
    const q=normalize(root.querySelector('#grantSearch')?.value||'');
    const area=root.querySelector('#grantArea')?.value||'';
    let visible=0,total=0;
    root.querySelectorAll('.grant-row').forEach(row=>{
      const okQ=!q||row.dataset.search.includes(q);
      const okA=!area||row.dataset.area===area;
      const show=okQ&&okA;
      row.hidden=!show;
      if(show){visible++; total+=Number(row.querySelector('.grant-amount strong')?.dataset.value||0)}
    });
    const count=root.querySelector('#grantVisibleCount');
    if(count)count.textContent=visible.toLocaleString('cs-CZ');
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
      const recipients=new Set(grants.map(g=>g.ico?`ico:${g.ico}`:`name:${normalize(g.recipient)}`));
      const total=grants.reduce((s,g)=>s+Number(g.approvedCzk||0),0);
      app.innerHTML=`<div class="wrap grants-preview">
        <div class="page-head grants-head"><div class="kicker">Pracovní náhled</div><h1>Dotace a granty</h1><p>Přehled dotací poskytnutých MČ Praha 8. Zatím obsahuje první ověřenou část programových dotací za rok 2026; další roky, sociální oblast a individuální či mimořádné dotace ještě doplňujeme.</p></div>
        <section class="stats grants-stats">
          <div class="stat"><strong>${grants.length.toLocaleString('cs-CZ')}</strong><span>načtených dotací</span></div>
          <div class="stat"><strong>${recipients.size.toLocaleString('cs-CZ')}</strong><span>příjemců</span></div>
          <div class="stat"><strong>${money(total)}</strong><span>celkem schváleno</span></div>
        </section>
        <div class="grant-note"><b>Pracovní dataset.</b> Sociální dotace 2026 jsou zatím dohledané ve zdroji, ale ještě nejsou zahrnuté do přehledu. Stejně tak zde zatím nejsou individuální a mimořádné dotace z usnesení Rady a Zastupitelstva.</div>
        <section class="section grant-list-section">
          <div class="grant-toolbar">
            <div><div class="kicker">Rok 2026</div><h2>Poskytnuté dotace</h2></div>
            <div class="grant-filters"><input id="grantSearch" type="search" placeholder="Hledat příjemce nebo IČ…"><select id="grantArea"><option value="">Všechny oblasti</option>${areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select></div>
          </div>
          <div class="grant-list-head"><span>Příjemce</span><span>Oblast</span><span>Částka</span><span>Zdroj</span></div>
          <div class="grant-list">${buildRows(grants)}</div>
          <div class="grant-list-foot">Zobrazeno <b id="grantVisibleCount">${grants.length.toLocaleString('cs-CZ')}</b> z ${grants.length.toLocaleString('cs-CZ')} záznamů.</div>
        </section>
      </div>`;
      app.querySelectorAll('.grant-amount strong').forEach((el,i)=>el.dataset.value=String(grants[i]?.approvedCzk||0));
      app.querySelector('#grantSearch')?.addEventListener('input',()=>applyFilters(app));
      app.querySelector('#grantArea')?.addEventListener('change',()=>applyFilters(app));
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
