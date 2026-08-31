// Drobné prezentační opravy oddělené od hlavního routeru.
// MutationObserver zajistí, že se aplikují i po změně hash routy.
let bodiesSourcePromise=null;
let bodiesPolishRunning=false;
let contractsNamesPromise=null;
let contractsNamesRunning=false;
let homeNewsPromise=null;
let homeNewsRunning=false;
let electionsSourcePromise=null;
let electionsPolishRunning=false;

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

function loadElectionsSource(){
  if(!electionsSourcePromise){
    electionsSourcePromise=fetch(`data/volby.json?v=${Date.now()}`,{cache:'no-store'})
      .then(r=>r.ok?r.json():null)
      .catch(()=>null);
  }
  return electionsSourcePromise;
}

function electionFingerprint(value=''){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLocaleLowerCase('cs-CZ')
    .replace(/[^a-z0-9]+/g,' ')
    .trim().split(/\s+/).filter(Boolean).sort().join('|');
}

async function polishElectionNames(app){
  if(electionsPolishRunning||location.hash!=='#/volby')return;
  electionsPolishRunning=true;
  try{
    const source=await loadElectionsSource();
    const parties=(source?.years||[]).flatMap(y=>y.parties||[]).map(p=>p.name).filter(Boolean);
    const byFingerprint=new Map();
    for(const name of parties){
      const key=electionFingerprint(name);
      if(key&&!byFingerprint.has(key))byFingerprint.set(key,name);
    }
    if(!byFingerprint.size)return;

    const leaves=app.querySelectorAll('h3,h4,b,strong,span,div,td');
    for(const el of leaves){
      if(el.children.length)continue;
      const text=(el.textContent||'').replace(/\s+/g,' ').trim();
      if(!text||text.length>180)continue;
      const correct=byFingerprint.get(electionFingerprint(text));
      if(correct&&correct!==text)setTextIfChanged(el,correct);
    }
  }finally{
    electionsPolishRunning=false;
  }
}

function polishInfo106(app){
  if(location.hash!=='#/info106')return;
  const wrap=app.querySelector('.wrap');
  if(wrap)wrap.classList.add('info106-page');

  const notice=app.querySelector('.notice');
  if(notice)notice.classList.add('production-data-note');

  for(const el of app.querySelectorAll('.item h3,.item b,.item strong')){
    if(el.children.length)continue;
    const text=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(!/^Žádost o informac(?:i|e)\b/i.test(text))continue;
    const m=text.match(/^(Žádost o informac(?:i|e)[^:]*:)/i);
    if(m)setTextIfChanged(el,m[1]);
  }
}

function setupMobileMenu(){
  const topbar=document.querySelector('.topbar');
  if(!topbar||topbar.dataset.mobileMenuReady)return;
  topbar.dataset.mobileMenuReady='true';

  const button=document.createElement('button');
  button.type='button';
  button.className='mobile-menu-toggle';
  button.setAttribute('aria-label','Otevřít menu');
  button.setAttribute('aria-expanded','false');
  button.textContent='☰';

  const panel=document.createElement('nav');
  panel.className='mobile-menu-panel';
  panel.setAttribute('aria-label','Mobilní navigace');
  panel.innerHTML=`
    <div class="mobile-menu-group"><strong>Usnesení</strong>
      <a href="#/usneseni">Usnesení Rady a Zastupitelstva</a>
      <a href="#/penize">Rozpočty a veřejné finance</a>
      <a href="#/uredni-deska">Úřední deska</a>
    </div>
    <div class="mobile-menu-group"><strong>Registr smluv</strong>
      <a href="#/smlouvy">Smlouvy MČ Praha 8</a>
      <a href="#/smlouvy-organizace">Smlouvy příspěvkových organizací</a>
      <a href="#/smlouvy-firmy">Smlouvy městských firem</a>
    </div>
    <div class="mobile-menu-group"><strong>Volené orgány a městské firmy</strong>
      <a href="#/organy">Komise a výbory</a>
      <a href="#/skoly">Školy</a>
      <a href="#/organizace">Organizace a městské firmy</a>
      <a href="#/volby">Volby</a>
      <a href="#/lide">Zastupitelstvo</a>
    </div>
    <div class="mobile-menu-group"><a href="#/zdroje"><strong>Datové zdroje</strong></a></div>`;

  topbar.append(button,panel);

  const close=()=>{
    topbar.classList.remove('mobile-menu-open');
    button.setAttribute('aria-expanded','false');
    button.textContent='☰';
  };
  button.addEventListener('click',()=>{
    const open=!topbar.classList.contains('mobile-menu-open');
    topbar.classList.toggle('mobile-menu-open',open);
    button.setAttribute('aria-expanded',String(open));
    button.textContent=open?'×':'☰';
  });
  panel.addEventListener('click',e=>{if(e.target.closest('a'))close()});
  addEventListener('hashchange',close);
  addEventListener('resize',()=>{if(innerWidth>850)close()});
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
  if(location.hash==='#/volby')void polishElectionNames(app);
  if(location.hash==='#/info106')polishInfo106(app);
  polishVotingHeadings(app);

  if(location.hash===''||location.hash==='#/'||location.hash==='#'){
    const principle=app.querySelector('.home-principle .kicker');
    if(principle)principle.remove();
    void polishHomeNews(app);
  }
}

setupMobileMenu();
const app=document.querySelector('#app');
if(app){
  new MutationObserver(()=>queueMicrotask(polishProductionUi)).observe(app,{childList:true,subtree:true});
}
addEventListener('hashchange',()=>setTimeout(polishProductionUi,0));
polishProductionUi();
