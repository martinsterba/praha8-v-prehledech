(()=>{
  const ROUTE='#/dotace';
  const PER_PAGE=25;
  let renderSeq=0;
  let grantsPromise=null;

  const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const money=n=>Number(n||0).toLocaleString('cs-CZ',{maximumFractionDigits:0})+' Kč';
  const normalize=s=>String(s||'').toLocaleLowerCase('cs-CZ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  const digits=s=>String(s||'').replace(/\D/g,'');
  const typeLabel=t=>{
    const value=String(t||'').toLocaleLowerCase('cs-CZ');
    if(value==='programová'||value==='programova'||value==='dotační řízení'||value==='dotacni rizeni')return 'dotace';
    if(value.includes('individuální')||value.includes('individualni')||value.includes('mimořád'))return 'mimořádná dotace';
    return t||'dotace';
  };
  const loadGrants=()=>grantsPromise||(grantsPromise=fetch(`data/dotace.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json()}));

  function isValidGrant(g){
    const raw=String(g?.recipient||'').trim();
    if(!raw||raw.includes('|')||!/[0-9A-Za-zÀ-ž]/.test(raw))return false;
    const name=normalize(raw).replace(/^[\s.,:;|\-–—]+|[\s.,:;|\-–—]+$/g,'');
    if(!name)return false;
    const bad=new Set(['celkem','soucet','soucet vsech projektu','soucet projektu','celkem prideleno','zadatel','prijemce','organizace','nazev organizace']);
    if(bad.has(name)||name.includes('soucet vsech projektu')||name.startsWith('celkem '))return false;
    return Number(g?.approvedCzk||0)>0;
  }

  function fmtDateTime(value){
    if(!value)return '—';
    const d=new Date(value);
    if(Number.isNaN(d.valueOf()))return '—';
    return new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(d).replace(',','');
  }

  function parseStatusDate(text){
    const m=String(text||'').match(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})(?:\s+(?:v\s+)?(\d{1,2}):(\d{2}))?/i);
    if(!m)return 0;
    return new Date(Number(m[3]),Number(m[2])-1,Number(m[1]),Number(m[4]||0),Number(m[5]||0)).valueOf();
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

  function recipientStats(grants){
    const namesToIcos=new Map();
    for(const g of grants){
      const name=normalize(g.recipient);const ico=digits(g.ico);
      if(!name||!ico)continue;
      if(!namesToIcos.has(name))namesToIcos.set(name,new Set());
      namesToIcos.get(name).add(ico);
    }
    const buckets=new Map();
    for(const g of grants){
      const name=normalize(g.recipient);const ico=digits(g.ico);
      const mapped=!ico&&namesToIcos.get(name)?.size===1?[...namesToIcos.get(name)][0]:'';
      const resolvedIco=ico||mapped;
      const key=resolvedIco?`ico:${resolvedIco}`:`name:${name}`;
      if(!buckets.has(key))buckets.set(key,{recipient:g.recipient,ico:resolvedIco,total:0,count:0,years:new Set()});
      const row=buckets.get(key);
      if(ico&&g.recipient)row.recipient=g.recipient;
      row.total+=Number(g.approvedCzk||0);row.count+=1;
      if(g.year)row.years.add(Number(g.year));
    }
    return [...buckets.values()];
  }

  function buildTopRecipients(rows){
    return rows.map((r,i)=>{
      const ys=[...r.years].sort((a,b)=>a-b);
      const period=ys.length?ys[0]===ys[ys.length-1]?String(ys[0]):`${ys[0]}–${ys[ys.length-1]}`:'—';
      return `<div class="partner-row">
        <span class="partner-rank">${i+1}</span>
        <div><b>${esc(r.recipient)}</b><small>${r.ico?`IČO ${esc(r.ico)} · `:''}${r.count.toLocaleString('cs-CZ')} ${r.count===1?'dotace':'dotací'} · ${period}</small></div>
        <div class="partner-numbers"><strong>${money(r.total)}</strong><small>schválená částka celkem</small></div>
      </div>`;
    }).join('');
  }

  async function renderGrants(){
    if(location.hash!==ROUTE)return;
    const seq=++renderSeq;
    const app=document.querySelector('#app');
    if(!app)return;
    app.innerHTML='<div class="wrap"><div class="grant-loading">Načítám dotace…</div></div>';
    try{
      const payload=await loadGrants();
      if(seq!==renderSeq||location.hash!==ROUTE)return;
      const grants=(Array.isArray(payload.grants)?payload.grants:[]).filter(isValidGrant);
      const areas=[...new Set(grants.map(g=>g.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'cs'));
      const years=[...new Set(grants.map(g=>Number(g.year)).filter(Boolean))].sort((a,b)=>b-a);
      const recipients=new Set(grants.map(g=>g.ico?`ico:${digits(g.ico)}`:`name:${normalize(g.recipient)}`));
      const summaryYear=years[0]||null;
      const summaryRows=summaryYear?grants.filter(g=>Number(g.year)===summaryYear):grants;
      const summaryTotal=summaryRows.reduce((s,g)=>s+Number(g.approvedCzk||0),0);
      const stats=recipientStats(grants);
      const topValue=[...stats].sort((a,b)=>b.total-a.total||b.count-a.count||a.recipient.localeCompare(b.recipient,'cs')).slice(0,10);
      const topCount=[...stats].sort((a,b)=>b.count-a.count||b.total-a.total||a.recipient.localeCompare(b.recipient,'cs')).slice(0,10);
      const historyLabel=years.length?`${years[years.length-1]}–${years[0]}`:'dostupnou historii';
      let page=1;

      app.innerHTML=`<div class="wrap grants-preview">
        <div class="page-head"><div class="kicker">Finance</div><h1>Dotace a granty</h1><p>Přehled dotací poskytnutých městskou částí Praha 8 organizacím a dalším příjemcům. Každý záznam odkazuje na původní zdroj.</p></div>
        <section class="entity-overview-stats">
          <div><small>Dotací v databázi</small><strong>${grants.length.toLocaleString('cs-CZ')}</strong><span>načtených záznamů</span></div>
          <div><small>Příjemců</small><strong>${recipients.size.toLocaleString('cs-CZ')}</strong><span>organizací a dalších příjemců</span></div>
          <div><small>Schválená částka${summaryYear?` · ${summaryYear}`:''}</small><strong>${money(summaryTotal)}</strong><span>${summaryYear?`celkem schváleno v roce ${summaryYear}`:'celkem schváleno'}</span></div>
        </section>
        <div class="data-note grant-note"><b>O datech.</b> Přehled spojuje zveřejněné dotace MČ Praha 8 a jejich historické výsledky. Jako <b>mimořádné dotace</b> označujeme peněžní dary schválené formou darovací smlouvy, v níž je MČ Praha 8 dárcem. Starší ročníky zachovávají tehdejší názvy a členění oblastí. Do databáze zařazujeme jen záznamy, u nichž lze z oficiálního zdroje bezpečně určit příjemce a schválenou částku; nezahrnujeme případy, kdy je MČ Praha 8 sama příjemcem prostředků od jiného poskytovatele.</div>
        ${topValue.length?`<section class="section recipient-section grant-top-section"><div class="section-head"><div><div class="kicker">Statistika</div><h2>TOP 10 příjemců dotací</h2></div><p>Organizace s nejvyšším součtem schválených dotací za dostupnou historii ${historyLabel}. Záznamy spojujeme primárně podle IČ.</p></div><div class="partner-tabs"><button class="partner-tab active" data-grant-ranking="value">Podle výše dotací</button><button class="partner-tab" data-grant-ranking="count">Podle počtu dotací</button></div><div id="grantTopRanking" class="partner-ranking">${buildTopRecipients(topValue)}</div></section>`:''}
        <section class="section grant-list-section">
          <div class="grant-toolbar"><div><div class="kicker">Přehled</div><h2>Poskytnuté dotace</h2></div><div class="grant-filters"><input id="grantSearch" type="search" placeholder="Hledat příjemce nebo IČ…"><select id="grantArea"><option value="">Všechny oblasti</option>${areas.map(a=>`<option value="${esc(a)}">${esc(a)}</option>`).join('')}</select><select id="grantYear"><option value="">Všechny roky</option>${years.map(y=>`<option value="${y}">${y}</option>`).join('')}</select></div></div>
          <div id="grantResultCount" class="updated"></div><div class="grant-list-head"><span>Příjemce</span><span>Oblast</span><span>Rok</span><span>Částka</span><span>Zdroj</span></div><div id="grantList" class="grant-list"></div><div id="grantPager" class="pagination"></div>
        </section>
      </div>`;

      if(topValue.length){
        app.querySelectorAll('[data-grant-ranking]').forEach(b=>b.onclick=()=>{
          app.querySelectorAll('[data-grant-ranking]').forEach(x=>x.classList.toggle('active',x===b));
          const ranking=b.dataset.grantRanking==='count'?topCount:topValue;
          app.querySelector('#grantTopRanking').innerHTML=buildTopRecipients(ranking);
        });
      }

      const draw=()=>{
        const q=normalize(app.querySelector('#grantSearch')?.value||'');
        const area=app.querySelector('#grantArea')?.value||'';
        const year=app.querySelector('#grantYear')?.value||'';
        const rows=grants.filter(g=>(!q||normalize([g.recipient,g.ico,g.area,g.project,typeLabel(g.type),g.year].join(' ')).includes(q))&&(!area||g.area===area)&&(!year||String(g.year)===year));
        const pages=Math.max(1,Math.ceil(rows.length/PER_PAGE));
        page=Math.min(page,pages);
        const shown=rows.slice((page-1)*PER_PAGE,page*PER_PAGE);
        app.querySelector('#grantResultCount').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} dotací · stránka ${page} z ${pages}`;
        app.querySelector('#grantList').innerHTML=shown.length?buildRows(shown):'<div class="empty">Žádné dotace neodpovídají zvoleným filtrům.</div>';
        app.querySelector('#grantPager').innerHTML=pagerMarkup(page,pages);
        app.querySelectorAll('#grantPager button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();app.querySelector('#grantResultCount')?.scrollIntoView({behavior:'smooth',block:'center'})});
      };
      app.querySelectorAll('#grantSearch,#grantArea,#grantYear').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));
      draw();
      app.focus({preventScroll:true});
    }catch(error){
      if(seq!==renderSeq||location.hash!==ROUTE)return;
      app.innerHTML=`<div class="wrap"><div class="notice error-notice"><b>Dotace se nepodařilo načíst.</b> ${esc(error.message)}</div></div>`;
    }
  }

  function ensureHomeCard(){
    if(location.hash&&location.hash!=='#/'&&location.hash!=='#')return false;
    const grid=document.querySelector('#app .home-context-section .cards');
    if(!grid)return false;
    if(grid.querySelector('[data-grants-home-card]'))return true;
    const card=document.createElement('a');
    card.className='card';card.href='#/dotace';card.dataset.grantsHomeCard='true';
    card.innerHTML='<span class="icon">Kč</span><h3>Dotace a granty</h3><p>Přehled dotací poskytnutých městskou částí Praha 8 organizacím a dalším příjemcům.</p><span class="more">Otevřít →</span>';
    const finance=[...grid.children].find(x=>x.querySelector('h3')?.textContent?.trim()==='Finance');
    if(finance)grid.insertBefore(card,finance);else grid.append(card);
    return true;
  }

  async function ensureSources(){
    if(location.hash!=='#/zdroje')return false;
    const app=document.querySelector('#app');
    const statusGroups=[...app.querySelectorAll('.status-group')];
    const mcStatus=statusGroups.find(x=>x.querySelector('.status-group-head h3')?.textContent?.trim()==='MČ Praha 8');
    if(!mcStatus)return false;
    const payload=await loadGrants().catch(()=>null);
    if(location.hash!=='#/zdroje')return true;
    const count=Number(payload?.meta?.records||payload?.grants?.length||0);
    const updatedValue=payload?.updated||'';
    const updated=fmtDateTime(updatedValue);
    const updatedEpoch=updatedValue?new Date(updatedValue).valueOf():0;
    const list=mcStatus.querySelector('.status-card-list');
    if(list){
      let card=[...list.children].find(x=>x.dataset.grantsSourceStatus==='true'||x.querySelector('.status-card-title')?.textContent?.trim()==='Dotace a granty');
      if(!card){card=document.createElement('div');card.className='status-card';card.dataset.grantsSourceStatus='true';list.append(card)}
      card.dataset.sourceUpdated=String(Number.isFinite(updatedEpoch)?updatedEpoch:0);
      const html=`<div class="status-card-main"><div class="status-card-title">Dotace a granty</div><div class="status-card-meta">Aktualizace 1× týdně (vždy v pondělí) | poslední proběhla ${updated}</div></div><div class="status-card-number">${count?count.toLocaleString('cs-CZ'):'—'}</div><div class="status-card-state"><span class="data-status ok">data načtena</span></div>`;
      if(card.innerHTML!==html)card.innerHTML=html;
      const current=[...list.children];
      const sorted=[...current].sort((a,b)=>{
        const at=Number(a.dataset.sourceUpdated||0)||parseStatusDate(a.querySelector('.status-card-meta')?.textContent);
        const bt=Number(b.dataset.sourceUpdated||0)||parseStatusDate(b.querySelector('.status-card-meta')?.textContent);
        if(bt!==at)return bt-at;
        return (a.querySelector('.status-card-title')?.textContent||'').localeCompare(b.querySelector('.status-card-title')?.textContent||'','cs');
      });
      if(sorted.some((x,i)=>x!==current[i]))sorted.forEach(x=>list.append(x));
    }
    const sourceGroups=[...app.querySelectorAll('.source-group')];
    const mcSource=sourceGroups.find(x=>x.querySelector('.source-group-head h2')?.textContent?.trim()==='MČ Praha 8');
    const sourceGrid=mcSource?.querySelector('.source-grid');
    if(sourceGrid&&!sourceGrid.querySelector('[data-grants-source-box]')){
      const box=document.createElement('div');box.className='sourcebox';box.dataset.grantsSourceBox='true';
      box.innerHTML='<h3>Dotace a granty</h3><p>Poskytnuté dotace MČ Praha 8. Čerpáme z oficiálního rozcestníku Granty a dotace, historických výsledkových souborů a usnesení. Mimořádné dotace v přehledu tvoří peněžní dary z darovacích smluv, kde je MČ Praha 8 dárcem.</p><code>https://www.praha8.cz/Granty-a-dotace.html</code>';
      const next=[...sourceGrid.children].find(x=>(x.querySelector('h3')?.textContent||'').localeCompare('Dotace a granty','cs')>0);
      if(next)sourceGrid.insertBefore(box,next);else sourceGrid.append(box);
    }
    return true;
  }

  function afterBaseRender(attempt=0){
    if(location.hash===ROUTE){renderGrants();return;}
    const done=location.hash==='#/zdroje'?ensureSources():ensureHomeCard();
    Promise.resolve(done).then(ok=>{if(!ok&&attempt<12)setTimeout(()=>afterBaseRender(attempt+1),30)});
  }

  const schedule=()=>setTimeout(()=>afterBaseRender(0),0);
  addEventListener('hashchange',()=>{renderSeq++;grantsPromise=null;schedule()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
})();