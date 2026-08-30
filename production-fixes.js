// Drobné prezentační opravy oddělené od hlavního routeru.
// MutationObserver zajistí, že se aplikují i po změně hash routy.
let bodiesSourcePromise=null;
let bodiesPolishRunning=false;
let contractsNamesPromise=null;
let contractsNamesRunning=false;
let homeNewsPromise=null;
let homeNewsRunning=false;

function bodyNameForDisplay(value=''){
  let name=String(value||'').replace(/\s+/g,' ').trim();
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
  for(const kicker of app.querySelectorAll('.section > .section-head .kicker'))kicker.remove();

  for(const link of app.querySelectorAll('.body-links a')){
    if(/^detail\b/i.test(link.textContent||''))setTextIfChanged(link,'web ↗');
  }

  for(const count of app.querySelectorAll('.section > .section-head > p')){
    const match=(count.textContent||'').trim().match(/^(\d+)\s+orgánů$/i);
    if(!match)continue;
    const n=Number(match[1]);
    const form=n===1?'orgán':(n>=2&&n<=4?'orgány':'orgánů');
    setTextIfChanged(count,`${n} ${form}`);
  }

  void polishBodiesNames(app);
}

function loadContractNames(){
  if(!contractsNamesPromise){
    contractsNamesPromise=Promise.all([
      fetch(`data/smlouvy.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`data/smlouvy-subjekty.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
    ]).then(([main,entities])=>{
      const byIco=new Map();
      const add=p=>{
        const ico=String(p?.ico||'').replace(/\D/g,'');
        const name=String(p?.name||p?.counterparty||'').replace(/\s+/g,' ').trim();
        if(ico&&name&&!byIco.has(ico))byIco.set(ico,name);
      };
      for(const p of (main?.partners||[]))add(p);
      for(const e of (entities?.entities||[]))for(const p of (e?.partnerList||[]))add(p);
      return byIco;
    });
  }
  return contractsNamesPromise;
}

async function polishContractPartnerNames(app){
  if(contractsNamesRunning)return;
  contractsNamesRunning=true;
  try{
    const byIco=await loadContractNames();
    if(!byIco?.size||!location.hash.startsWith('#/smlouvy'))return;
    for(const row of app.querySelectorAll('.partner-row')){
      const icoText=[...row.querySelectorAll('small')].map(x=>x.textContent||'').find(x=>/IČO\s*\d+/i.test(x))||'';
      const ico=icoText.replace(/\D/g,'');
      const nameEl=row.querySelector('div > b');
      const correct=byIco.get(ico);
      if(nameEl&&correct)setTextIfChanged(nameEl,correct);
    }
  }finally{
    contractsNamesRunning=false;
  }
}

function loadHomeNews(){
  if(!homeNewsPromise){
    homeNewsPromise=fetch(`data/novinky.json?v=${Date.now()}`,{cache:'no-store'})
      .then(r=>r.ok?r.json():[])
      .catch(()=>[]);
  }
  return homeNewsPromise;
}

async function polishHomeNews(app){
  if(homeNewsRunning)return;
  homeNewsRunning=true;
  try{
    if(!(location.hash===''||location.hash==='#/'||location.hash==='#'))return;
    const grid=app.querySelector('.news-home-grid');
    if(!grid)return;
    const source=await loadHomeNews();
    if(!Array.isArray(source)||!source.length)return;
    const rows=[...source]
      .sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.title||'').localeCompare(a.title||'','cs'))
      .slice(0,3);
    const signature=rows.map(x=>`${x.date||''}|${x.title||''}|${x.url||''}`).join('||');
    if(grid.dataset.latestNewsSignature===signature)return;

    grid.replaceChildren(...rows.map(x=>{
      const a=document.createElement('a');
      a.href=x.url||'#';
      a.target='_blank';
      a.rel='noreferrer';
      const small=document.createElement('small');
      if(x.date){
        const d=new Date(`${x.date}T12:00:00`);
        small.textContent=Number.isNaN(d.valueOf())?'':new Intl.DateTimeFormat('cs-CZ').format(d);
      }
      const b=document.createElement('b');
      b.textContent=x.title||'';
      a.append(small,b);
      return a;
    }));
    grid.dataset.latestNewsSignature=signature;
  }finally{
    homeNewsRunning=false;
  }
}

function polishVotingHeadings(app){
  for(const el of app.querySelectorAll('h2,h3,h4,h5,strong,b,small,p,div')){
    if(el.children.length)continue;
    const text=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(text==='Hlasování'){
      setTextIfChanged(el,'Výsledek hlasování');
      el.classList.add('voting-mini-heading');
    }else if(text==='Výsledek hlasování'){
      el.classList.add('voting-mini-heading');
    }else if(/^Jak hlasovali jednotliví zastupitelé\??$/i.test(text)){
      el.classList.add('voting-mini-heading');
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

  if(location.hash==='#/organy')polishBodiesUi(app);
  if(location.hash.startsWith('#/smlouvy'))void polishContractPartnerNames(app);
  polishVotingHeadings(app);

  if(location.hash===''||location.hash==='#/'||location.hash==='#'){
    const principle=app.querySelector('.home-principle .kicker');
    if(principle)principle.remove();
    void polishHomeNews(app);
  }
}

const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
