// Drobné prezentační opravy oddělené od hlavního routeru.
// MutationObserver zajistí, že se aplikují i po změně hash routy.
let bodiesSourcePromise=null;
let bodiesPolishRunning=false;

function bodyNameForDisplay(value=''){
  let name=String(value||'').replace(/\s+/g,' ').trim();
  // Zdroj orgánů už používá správné pořadí:
  // titul před jménem → jméno → příjmení → titul za jménem.
  // Zde pouze sjednotíme interpunkci u titulů za jménem.
  name=name.replace(/\.\s+(?=(?:Ph\.D\.|CSc\.|DrSc\.|DBA|MBA|MPA|DiS\.?|M\.A\.|LL\.M\.|Th\.D\.)\b)/g,', ');
  name=name.replace(/\s*,\s*/g,', ');
  return name;
}

function setTextIfChanged(el,value){
  if(el && el.textContent!==value)el.textContent=value;
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
  if(bodiesPolishRunning)return;
  bodiesPolishRunning=true;
  try{
    const source=await loadBodiesSource();
    if(!Array.isArray(source)||!source.length||location.hash!=='#/organy')return;

    const norm=s=>String(s||'').toLocaleLowerCase('cs-CZ').replace(/\s+mč praha 8$/i,'').replace(/\s+/g,' ').trim();
    for(const card of app.querySelectorAll('.body-card')){
      const heading=card.querySelector('h3');
      const body=source.find(x=>norm(x.name)===norm(heading?.textContent));
      if(!body)continue;

      const chairName=card.querySelector('.body-chair .person-line > b, .body-chair .person-line > span');
      if(chairName&&body.chair?.name)setTextIfChanged(chairName,bodyNameForDisplay(body.chair.name));

      const memberGroups=card.querySelectorAll('.body-members');
      for(const group of memberGroups){
        const label=(group.querySelector('small')?.textContent||'').toLocaleLowerCase('cs-CZ');
        const rows=label.includes('občan')?(body.citizens||[]):(body.members||[]);
        const names=group.querySelectorAll('li .person-line > b, li .person-line > span:first-child');
        names.forEach((el,i)=>{
          if(rows[i]?.name)setTextIfChanged(el,bodyNameForDisplay(rows[i].name));
        });
      }

      const secretary=card.querySelector('.body-secretary');
      if(secretary&&body.secretary){
        const wanted=bodyNameForDisplay(body.secretary);
        let nameSpan=secretary.querySelector(':scope > span');
        if(!nameSpan){
          nameSpan=document.createElement('span');
          secretary.appendChild(nameSpan);
        }
        setTextIfChanged(nameSpan,wanted);
        // app.js může za <small> ponechat původní textový uzel; po vytvoření span jej odstraníme.
        for(const node of [...secretary.childNodes]){
          if(node.nodeType===Node.TEXT_NODE && node.textContent.trim())node.remove();
        }
      }
    }
  }finally{
    bodiesPolishRunning=false;
  }
}

function polishBodiesUi(app){
  // Nadpisy sekcí jsou samy o sobě dostatečné; drobné kicker popisky zde nepoužíváme.
  for(const kicker of app.querySelectorAll('.section > .section-head .kicker'))kicker.remove();

  // Odkaz vede na oficiální web konkrétního orgánu.
  for(const link of app.querySelectorAll('.body-links a')){
    if(/^detail\b/i.test(link.textContent||''))setTextIfChanged(link,'web ↗');
  }

  // Správné skloňování počtu orgánů: 1 orgán, 2–4 orgány, jinak orgánů.
  for(const count of app.querySelectorAll('.section > .section-head > p')){
    const match=(count.textContent||'').trim().match(/^(\d+)\s+orgánů$/i);
    if(!match)continue;
    const n=Number(match[1]);
    const form=n===1?'orgán':(n>=2&&n<=4?'orgány':'orgánů');
    setTextIfChanged(count,`${n} ${form}`);
  }

  void polishBodiesNames(app);
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

  if(location.hash==='#/organy')polishBodiesUi(app);
}

const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
