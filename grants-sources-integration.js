(()=>{
  const ROUTE='#/zdroje';
  let statusPromise=null;
  let timer=0;

  const loadStatus=()=>statusPromise||(statusPromise=fetch(`data/source-status.json?v=${Date.now()}`,{cache:'no-store'})
    .then(r=>r.ok?r.json():{})
    .catch(()=>({})));

  const fmt=value=>{
    if(!value)return '—';
    const d=new Date(value);
    if(Number.isNaN(d.valueOf()))return '—';
    return new Intl.DateTimeFormat('cs-CZ',{
      timeZone:'Europe/Prague',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'
    }).format(d).replace(',','');
  };

  async function ensure(){
    if(location.hash.split('?')[0]!==ROUTE)return;
    const app=document.querySelector('#app');
    if(!app)return;

    const statusGroups=[...app.querySelectorAll('.status-group')];
    const mcStatus=statusGroups.find(x=>x.querySelector('.status-group-head h3')?.textContent?.trim()==='MČ Praha 8');
    const sourceGroups=[...app.querySelectorAll('.source-group')];
    const mcSource=sourceGroups.find(x=>x.querySelector('.source-group-head h2')?.textContent?.trim()==='MČ Praha 8');
    if(!mcStatus||!mcSource)return;

    const status=await loadStatus();
    if(location.hash.split('?')[0]!==ROUTE)return;
    const grants=status?.grants||{};
    const count=Number(grants.count||0);
    const loaded=grants.status==='data načtena'&&grants.mode==='aktualizováno'&&count>0;

    const list=mcStatus.querySelector('.status-card-list');
    if(list){
      let card=[...list.children].find(x=>x.querySelector('.status-card-title')?.textContent?.trim()==='Dotace a granty');
      if(!card){
        card=document.createElement('div');
        card.className='status-card';
        list.append(card);
      }
      card.dataset.grantsSourceStatus='true';
      card.innerHTML=`<div class="status-card-main"><div class="status-card-title">Dotace a granty</div><div class="status-card-meta">aktualizace 1x týdně (vždy v pondělí) | poslední proběhla ${fmt(grants.updated)}</div></div><div class="status-card-number">${loaded?count.toLocaleString('cs-CZ'):'—'}</div><div class="status-card-state"><span class="data-status ${loaded?'ok':'pending'}">${loaded?'data načtena':'čeká na naplnění'}</span></div>`;
      [...list.children]
        .sort((a,b)=>(a.querySelector('.status-card-title')?.textContent||'').localeCompare(b.querySelector('.status-card-title')?.textContent||'','cs'))
        .forEach(x=>list.append(x));
    }

    const grid=mcSource.querySelector('.source-grid');
    if(grid){
      let box=[...grid.children].find(x=>x.querySelector('h3')?.textContent?.trim()==='Dotace a granty');
      if(!box){
        box=document.createElement('div');
        box.className='sourcebox';
        grid.append(box);
      }
      box.dataset.grantsSourceBox='true';
      box.innerHTML='<h3>Dotace a granty</h3><p>Poskytnuté dotace MČ Praha 8. Čerpáme z oficiálního rozcestníku Granty a dotace, historických výsledkových souborů a usnesení. Mimořádné dotace v přehledu tvoří peněžní dary z darovacích smluv, kde je MČ Praha 8 dárcem.</p><code>https://www.praha8.cz/Granty-a-dotace.html</code>';
      [...grid.children]
        .sort((a,b)=>(a.querySelector('h3')?.textContent||'').localeCompare(b.querySelector('h3')?.textContent||'','cs'))
        .forEach(x=>grid.append(x));
    }
  }

  const schedule=()=>{
    clearTimeout(timer);
    timer=setTimeout(ensure,40);
  };

  addEventListener('hashchange',()=>{statusPromise=null;schedule()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
})();
