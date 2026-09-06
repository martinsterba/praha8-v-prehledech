(()=>{
  let grantsPromise=null;
  const loadGrants=()=>grantsPromise||(grantsPromise=fetch(`data/dotace.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null));
  const fmtDate=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('cs-CZ').format(d)};

  function ensureHeader(){
    const nav=document.querySelector('.topbar .nav');
    if(!nav||nav.querySelector('a[href="#/dotace"]'))return;
    const link=document.createElement('a');
    link.href='#/dotace';
    link.textContent='Dotace';
    const sources=nav.querySelector('a[href="#/zdroje"]');
    if(sources)nav.insertBefore(link,sources);else nav.append(link);
  }

  function ensureHomeCard(){
    if(location.hash&&location.hash!=='#/'&&location.hash!=='#')return;
    const grid=document.querySelector('#app .home-context-section .cards');
    if(!grid||grid.querySelector('[data-grants-home-card]'))return;
    const card=document.createElement('a');
    card.className='card';
    card.href='#/dotace';
    card.dataset.grantsHomeCard='true';
    card.innerHTML='<span class="icon">Kč</span><h3>Dotace a granty</h3><p>Přehled dotací poskytnutých městskou částí Praha 8 organizacím a dalším příjemcům.</p><span class="more">Otevřít →</span>';
    const cards=[...grid.children];
    const finance=cards.find(x=>x.querySelector('h3')?.textContent?.trim()==='Finance');
    if(finance)grid.insertBefore(card,finance);else grid.append(card);
  }

  async function ensureSources(){
    if(location.hash!=='#/zdroje')return;
    const payload=await loadGrants();
    if(location.hash!=='#/zdroje')return;
    const app=document.querySelector('#app');
    if(!app)return;
    const count=Number(payload?.meta?.records||payload?.grants?.length||0);
    const updated=fmtDate(payload?.updated);

    const statusGroups=[...app.querySelectorAll('.status-group')];
    const mcStatus=statusGroups.find(x=>x.querySelector('.status-group-head h3')?.textContent?.trim()==='MČ Praha 8');
    const list=mcStatus?.querySelector('.status-card-list');
    if(list&&!list.querySelector('[data-grants-source-status]')){
      const card=document.createElement('div');
      card.className='status-card';
      card.dataset.grantsSourceStatus='true';
      card.innerHTML=`<div class="status-card-main"><div class="status-card-title">Dotace a granty</div><div class="status-card-meta">Poslední aktualizace ${updated}</div></div><div class="status-card-number">${count?count.toLocaleString('cs-CZ'):'—'}</div><div class="status-card-state"><span class="data-status good">data načtena</span><span class="data-qa">Oficiální přehledy a usnesení MČ Praha 8</span></div>`;
      const siblings=[...list.children];
      const hlasovani=siblings.find(x=>x.querySelector('.status-card-title')?.textContent?.trim()==='Hlasování zastupitelstva');
      if(hlasovani)list.insertBefore(card,hlasovani);else list.append(card);
    }

    const sourceGroups=[...app.querySelectorAll('.source-group')];
    const mcSource=sourceGroups.find(x=>x.querySelector('.source-group-head h2')?.textContent?.trim()==='MČ Praha 8');
    const sourceGrid=mcSource?.querySelector('.source-grid');
    if(sourceGrid&&!sourceGrid.querySelector('[data-grants-source-box]')){
      const box=document.createElement('div');
      box.className='sourcebox';
      box.dataset.grantsSourceBox='true';
      box.innerHTML='<h3>Dotace a granty</h3><p>Poskytnuté dotace a granty městské části Praha 8. Čerpáme z oficiálního rozcestníku grantů a dotací, výsledkových tabulek a příloh usnesení Rady a Zastupitelstva.</p><code>https://www.praha8.cz/Granty-a-dotace.html</code>';
      const boxes=[...sourceGrid.children];
      const next=boxes.find(x=>(x.querySelector('h3')?.textContent||'').localeCompare('Dotace a granty','cs')>0);
      if(next)sourceGrid.insertBefore(box,next);else sourceGrid.append(box);
    }
  }

  function apply(){
    ensureHeader();
    ensureHomeCard();
    void ensureSources();
  }

  const app=document.querySelector('#app');
  if(app){let queued=false;new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;apply()})}).observe(app,{childList:true,subtree:true});}
  addEventListener('hashchange',()=>setTimeout(apply,0));
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
})();
