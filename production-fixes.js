// Drobné prezentační opravy oddělené od hlavního routeru.
// MutationObserver zajistí, že se aplikují i po změně hash routy.
let bodiesSourcePromise=null;

function bodyNameForDisplay(value=''){
  let name=String(value||'').replace(/\s+/g,' ').trim();
  // Opravíme zjevnou tečku použitou místo čárky před titulem za jménem.
  name=name.replace(/\.\s+(?=(?:Ph\.D\.|CSc\.|DrSc\.|DBA|MBA|MPA|DiS\.?|M\.A\.|LL\.M\.|Th\.D\.)\b)/g,', ');
  // Tituly za jménem oddělujeme čárkou; pořadí předních titulů i jména ponecháváme ze zdroje.
  name=name.replace(/\s*,\s*/g,', ');
  return name;
}

function loadBodiesSource(){
  if(!bodiesSourcePromise){
    bodiesSourcePromise=fetch(`data/organy.json?v=${Date.now()}`,{cache:'no-store'})
      .then(r=>{if(!r.ok)throw new Error(`organy: HTTP ${r.status}`);return r.json()})
      .catch(()=>[]);
  }
  return bodiesSourcePromise;
}

async function polishBodiesNames(app){
  const source=await loadBodiesSource();
  if(!Array.isArray(source)||!source.length||location.hash!=='#/organy')return;

  const norm=s=>String(s||'').toLocaleLowerCase('cs-CZ').replace(/\s+mč praha 8$/i,'').replace(/\s+/g,' ').trim();
  for(const card of app.querySelectorAll('.body-card')){
    const heading=card.querySelector('h3');
    const body=source.find(x=>norm(x.name)===norm(heading?.textContent));
    if(!body)continue;

    const chairName=card.querySelector('.body-chair .person-line > b, .body-chair .person-line > span');
    if(chairName&&body.chair?.name)chairName.textContent=bodyNameForDisplay(body.chair.name);

    const memberGroups=card.querySelectorAll('.body-members');
    for(const group of memberGroups){
      const label=(group.querySelector('small')?.textContent||'').toLocaleLowerCase('cs-CZ');
      const rows=label.includes('občan')?(body.citizens||[]):(body.members||[]);
      const names=group.querySelectorAll('li .person-line > b, li .person-line > span:first-child');
      names.forEach((el,i)=>{if(rows[i]?.name)el.textContent=bodyNameForDisplay(rows[i].name)});
    }

    const secretary=card.querySelector('.body-secretary');
    if(secretary&&body.secretary){
      const small=secretary.querySelector('small');
      secretary.innerHTML=`${small?small.outerHTML:''}<span>${bodyNameForDisplay(body.secretary).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span>`;
    }
  }
}

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
    polishBodiesNames(app);
  }
}

const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
