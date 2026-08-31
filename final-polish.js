// Finální prezentační doladění před v1.0.
// Odděleno od hlavního routeru, aby se nezasahovalo do datové logiky.

function short106Title(value=''){
  const text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  const colon=text.indexOf(':');
  return (colon>=0?text.slice(0,colon):text).replace(/\s+$/,'');
}

function polish106Rows(){
  if(location.hash!=='#/info106')return;
  const app=document.querySelector('#app');
  if(!app)return;
  const wrap=app.querySelector('.wrap');
  if(wrap)wrap.classList.add('info106-page','final-page-spacing');

  const dashboard=app.querySelector('.compact-stats');
  if(dashboard){
    dashboard.classList.add('info106-dashboard');
    for(const stat of dashboard.querySelectorAll('.stat'))stat.classList.add('info106-stat');
  }

  for(const row of app.querySelectorAll('#rows106 .item')){
    row.classList.add('info106-row');
    const meta=row.querySelector('.meta');
    if(meta)meta.classList.add('info106-date');

    const title=row.querySelector('h3');
    if(title){
      const clean=short106Title(title.textContent);
      if(clean&&title.textContent!==clean)title.textContent=clean;
      title.classList.add('info106-title');
    }

    const link=row.querySelector('a.source');
    if(link){
      if(link.textContent.trim()!=='Odpověď')link.textContent='Odpověď';
      link.classList.add('info106-answer');
    }
  }
}

function finalPolish(){
  const app=document.querySelector('#app');
  if(!app)return;
  const wrap=app.querySelector('.wrap');
  if(wrap)wrap.classList.add('final-page-spacing');
  polish106Rows();
}

const finalApp=document.querySelector('#app');
if(finalApp){
  let queued=false;
  new MutationObserver(()=>{
    if(queued)return;
    queued=true;
    queueMicrotask(()=>{queued=false;finalPolish()});
  }).observe(finalApp,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(finalPolish,0));
finalPolish();
