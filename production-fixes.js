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

    if(schoolNote && !el.dataset.twoLineSchoolNote){
      el.dataset.twoLineSchoolNote='true';
      el.innerHTML='<div><b>Školní rok 2025/2026.</b> Počty dětí, žáků a tříd jsou vedené ke dni 30. 9. 2025.</div><div>Kapacitu a naplněnost zobrazujeme jen tam, kde je lze bezpečně získat z oficiálního zdroje; chybějící údaj nevydáváme za nulu.</div>';
    }
  }

  if(location.hash==='#/organy'){
    // Nadpisy sekcí jsou samy o sobě dostatečné; drobné kicker popisky zde nepoužíváme.
    for(const kicker of app.querySelectorAll('.section > .section-head .kicker'))kicker.remove();

    // Stejný formát jmen jako na stránce zastupitelů použijeme i u tajemníků/tajemnic.
    if(typeof displayPersonName==='function'){
      for(const secretary of app.querySelectorAll('.body-secretary')){
        if(secretary.dataset.namePolished)return;
        const small=secretary.querySelector('small');
        const raw=[...secretary.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).map(n=>n.textContent).join(' ').trim();
        if(raw){
          secretary.dataset.namePolished='true';
          secretary.innerHTML=`${small?small.outerHTML:''}<span>${escapeHtml(displayPersonName(raw))}</span>`;
        }
      }
    }
  }
}

const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
