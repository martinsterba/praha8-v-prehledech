// Drobné prezentační opravy oddělené od hlavního routeru.
// MutationObserver zajistí, že se aplikují i po změně hash routy.
function polishProductionUi(){
  const app=document.querySelector('#app');
  if(!app)return;

  const budgetCount=app.querySelector('#countBudget');
  if(budgetCount)budgetCount.hidden=true;

  for(const el of app.querySelectorAll('.notice')){
    const text=(el.textContent||'').replace(/\s+/g,' ').trim();
    const schoolNote=/Školní rok 2025\/2026|30\.\s*9\.\s*2025/i.test(text);
    const newsNote=/posledních 7 dní|posledních sedm dní/i.test(text) && /novink|zpráv/i.test(text);
    if(schoolNote||newsNote)el.classList.add('production-data-note');
  }
}

const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
