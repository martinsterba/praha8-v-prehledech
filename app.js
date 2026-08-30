const $=(s,e=document)=>e.querySelector(s), $$=(s,e=document)=>[...e.querySelectorAll(s)];
const fmtDate=d=>new Intl.DateTimeFormat('cs-CZ').format(new Date(d+'T12:00:00'));
const fmt=n=>Number.isFinite(Number(n))?Number(n).toLocaleString('cs-CZ'):'—';
const escapeHtml=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const DATA_BUILD=Date.now();
const load=async name=>fetch(`data/${name}.json?v=${DATA_BUILD}`,{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error(`${name}: HTTP ${r.status}`);return r.json()});
const data={};
await Promise.all(['usneseni','hlasovani','lide','organizace','meta'].map(async n=>data[n]=await load(n)));
try{data.organy=await load('organy')}catch{data.organy=[]}
try{data.info106=await load('info106')}catch{data.info106=[]}
try{data.uredniDeska=await load('uredni-deska')}catch{data.uredniDeska=[]}
try{data.syncState=await load('sync-state')}catch{data.syncState={status:'unknown'}}
try{data.volby=await load('volby')}catch{data.volby={years:[],longest:[]}}
try{data.scitani2021=await load('scitani2021')}catch{data.scitani2021=null}
try{data.novinky=await load('novinky')}catch{data.novinky=[]}
try{data.budget2026=await load('budget-2026')}catch{data.budget2026=null}
try{data.smlouvy=await load('smlouvy')}catch{data.smlouvy={contracts:[],partners:[],meta:{}}}
if(Array.isArray(data.smlouvy))data.smlouvy={contracts:data.smlouvy,partners:[],meta:{total:data.smlouvy.length}}
data.smlouvySubjekty=null;
let entityContractsPromise=null;
async function ensureEntityContracts(){
 if(data.smlouvySubjekty)return data.smlouvySubjekty;
 if(!entityContractsPromise)entityContractsPromise=load('smlouvy-subjekty').then(x=>data.smlouvySubjekty=x).catch(()=>data.smlouvySubjekty={entities:[],meta:{},missing:true});
 return entityContractsPromise;
}
try{data.sourceStatus=await load('source-status')}catch{data.sourceStatus={}}
const sourceComplete=key=>{const x=(data.sourceStatus||{})[key]||{};return x.status==='data načtena'&&x.mode==='aktualizováno'};

const menu={
 radnice:[['#/usneseni','Usnesení Rady a Zastupitelstva','Rozhodnutí Rady a Zastupitelstva MČ Praha 8 včetně hlasování'],['#/penize','Rozpočty a veřejné finance','Rozpočet a finanční rozhodnutí'],['#/uredni-deska','Úřední deska','Aktuálně zveřejněné dokumenty a oznámení']],
 penize:[['#/smlouvy','Smlouvy MČ Praha 8','Kompletní historie smluv městské části'],['#/smlouvy-organizace','Smlouvy příspěvkových organizací','37 příspěvkových organizací Prahy 8'],['#/smlouvy-firmy','Smlouvy městských firem','3 společnosti ve 100% vlastnictví MČ']],
 lide:[['#/organy','Komise a výbory','Poradní a kontrolní orgány'],['#/skoly','Školy','Mateřské a základní školy Prahy 8'],['#/organizace','Organizace a městské firmy','Ostatní příspěvkové organizace a městské firmy'],['#/volby','Volby','Historické výsledky voleb na Praze 8'],['#/lide','Zastupitelstvo','Rada, zastupitelé a politické kluby']] 
};
$$('[data-menu]').forEach(b=>b.onclick=()=>{const m=$('#mega');const key=b.dataset.menu;m.innerHTML=`<div class="mega-grid">${menu[key].map(x=>`<a href="${x[0]}"><b>${x[1]}</b><small>${x[2]}</small></a>`).join('')}</div>`;m.hidden=!m.hidden});
addEventListener('hashchange',()=>{$('#mega').hidden=true;render()});

const cards=[
 ['https://www.mesicnikosmicka.cz/','◫','Časopis Osmička','Aktuality, rozhovory a informace z oficiálního měsíčníku Prahy 8.',true],
 ['#/penize','◒','Finance','Rozpočet, smlouvy, veřejné zakázky a finanční rozhodnutí na jednom místě.'],
 ['#/info106','i','Informace podle zákona č. 106/1999 Sb.','Zveřejněné žádosti a odpovědi podle zákona o svobodném přístupu k informacím.'],
 ['https://mapaneziskovek.cz/','⌖','Katalog neziskovek a sociálních služeb','Přehled neziskových organizací a sociálních služeb působících na Praze 8.',true],
 ['#/organy','◇','Komise a výbory','Kdo sedí v komisích rady a výborech zastupitelstva.'],
 ['#/skoly','▤','Školy','Mateřské a základní školy Prahy 8, jejich kontakty, vedení a kapacity.'],
 ['#/novinky','◧','Novinky','Aktuality z městské části za posledních sedm dní na jednom místě.'],
 ['#/organizace','▦','Organizace a městské firmy','Ostatní příspěvkové organizace a městské společnosti Prahy 8.'],
 ['#/smlouvy','≡','Registr smluv','Smlouvy MČ Praha 8, jejích příspěvkových organizací a městských firem zveřejněné v Registru smluv.'],
 ['#/uredni-deska','□','Úřední deska','Aktuálně zveřejněné dokumenty a oznámení městské části.'],
 ['#/usneseni','§','Usnesení a hlasování','Rozhodnutí Rady a Zastupitelstva a související hlasování na jednom místě.'],
 ['#/scitani-2021','◉','Sčítání 2021','Obyvatelé, věková struktura, domy a byty Prahy 8 podle Sčítání 2021.'],
 ['#/volby','◎','Volby','Výsledky komunálních voleb, mandáty a historie zastupitelstva.'],
 ['#/lide','●','Volené orgány','Zastupitelé, radní, gesce a politická příslušnost.']
];
function shell(content){$('#app').innerHTML=`<div class="wrap">${content}</div>`;$('#app').focus({preventScroll:true})}
function missingDataPage({kicker,title,description,command}){shell(`<div class="page-head"><div class="kicker">${escapeHtml(kicker)}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div class="notice missing-data-notice"><b>Data nejsou načtena.</b> Tento datový zdroj čeká na synchronizaci. Pro načtení spusťte <code>${escapeHtml(command)}</code>.</div>`)}
function pagerMarkup(page,pages){const nums=[];for(let i=Math.max(1,page-2);i<=Math.min(pages,page+2);i++)nums.push(i);return `<button ${page===1?'disabled':''} data-page="${page-1}">← Předchozí</button>${page>3?'<span>…</span>':''}${nums.map(i=>`<button class="${i===page?'active':''}" data-page="${i}">${i}</button>`).join('')}${page<pages-2?'<span>…</span>':''}<button ${page===pages?'disabled':''} data-page="${page+1}">Další →</button>`}
async function home(){
 await ensureEntityContracts();
 const resolutionsReady=sourceComplete('resolutions');
 const radaCount=resolutionsReady?data.usneseni.filter(x=>x.organ==='Rada').length:null;
 const zastCount=resolutionsReady?data.usneseni.filter(x=>x.organ==='Zastupitelstvo').length:null;
 const organizationsReady=sourceComplete('organizations');
 const votingReady=sourceComplete('voting');
 const info106Ready=sourceComplete('info106');
 const noticeReady=sourceComplete('noticeboard');
 const contractCount=data.smlouvy?.meta?.total||data.smlouvy?.contracts?.length||0;
 const contractsReady=contractCount>0 || sourceComplete('contracts');
 const entityContractCount=Number(data.smlouvySubjekty?.meta?.totalOtherContracts||data.smlouvySubjekty?.meta?.totalContracts||0);
 const entityContractsReady=!data.smlouvySubjekty?.missing&&Array.isArray(data.smlouvySubjekty?.entities)&&data.smlouvySubjekty.entities.length>0&&entityContractCount>0;
 const contractValidation=data.smlouvy?.meta?.validation||{};
 shell(`<section class="hero"><div class="kicker">Veřejná data Prahy 8</div><h1>Radnice zveřejňuje spoustu dat.<br><span>Tady je z nich přehled.</span></h1><p>Usnesení, hlasování, rozpočet, organizace a další veřejné informace. Na jednom místě, s dohledatelným zdrojem a bez nutnosti procházet desítky dokumentů.</p><div class="actions"><a class="btn primary" href="#/usneseni">Procházet usnesení Rady a Zastupitelstva městské části →</a><a class="btn" href="#/smlouvy">Procházet smlouvy v Registru smluv →</a><button class="btn" onclick="document.querySelector('#searchOpen').click()">Hledat ve všem</button></div></section>
 ${data.syncState?.status==='error'?`<div class="notice error-notice"><b>Poslední synchronizace nedoběhla:</b> ${escapeHtml(data.syncState.message||'neznámá chyba')}. Níže jsou proto zobrazená poslední použitelná lokální data.</div>`:''}<section class="stats home-stats"><div class="stat"><strong>${radaCount===null?'—':radaCount.toLocaleString('cs-CZ')}</strong><span>usnesení Rady</span></div><div class="stat"><strong>${zastCount===null?'—':zastCount.toLocaleString('cs-CZ')}</strong><span>usnesení Zastupitelstva</span></div><div class="stat"><strong>${votingReady?data.hlasovani.length.toLocaleString('cs-CZ'):'—'}</strong><span>načtených hlasování</span></div><div class="stat"><strong>${contractsReady?contractCount.toLocaleString('cs-CZ'):'—'}</strong><span>smluv v Registru smluv</span></div><div class="stat"><strong>${entityContractsReady?entityContractCount.toLocaleString('cs-CZ'):'—'}</strong><span>smluv příspěvkových organizací a městských firem</span></div><div class="stat"><strong>${noticeReady?data.uredniDeska.length.toLocaleString('cs-CZ'):'—'}</strong><span>aktuálních zpráv na úřední desce</span></div><div class="stat"><strong>${info106Ready?data.info106.length.toLocaleString('cs-CZ'):'—'}</strong><span>žádostí podle zákona č. 106/1999&nbsp;Sb.</span></div><div class="stat"><strong>${organizationsReady?data.organizace.length.toLocaleString('cs-CZ'):'—'}</strong><span>organizací a firem</span></div><div class="stat"><strong>${data.lide.length?data.lide.length.toLocaleString('cs-CZ'):'—'}</strong><span>zastupitelů a zastupitelek</span></div></section>
 ${data.scitani2021?`<a class="census-home-strip" href="#/scitani-2021"><div><div class="kicker">Sčítání 2021</div><strong>${Number(data.scitani2021.population.total).toLocaleString('cs-CZ')} obyvatel · ${Number(data.scitani2021.housing.flatsTotal).toLocaleString('cs-CZ')} bytů</strong><span>Nejvyšší dosažené vzdělání · Ekonomická aktivita · Cestování a dojíždění</span></div><b>Otevřít přehled →</b></a>`:''}
 ${Array.isArray(data.novinky)&&data.novinky.length?(()=>{const city=data.novinky.filter(x=>!x.channel||x.channel==='Aktuality z městské části');const rows=(city.length?city:data.novinky).slice(0,3);return `<section class="news-home-strip"><div class="news-home-head"><div><div class="kicker">Novinky</div><strong>Co je nového na Praze 8 za poslední týden</strong></div><a href="#/novinky">Otevřít všechny novinky →</a></div><div class="news-home-grid">${rows.map(x=>`<a href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer"><small>${x.date?fmtDate(x.date):''}</small><b>${escapeHtml(x.title)}</b></a>`).join('')}</div></section>`})():''}
 <section class="section home-context-section"><div class="section-head"><div><div class="kicker">Co tu najdete</div><h2>Praha 8<br>v souvislostech</h2></div><p>Každý záznam má odkaz na původní zdroj. Cílem není data nahrazovat, ale udělat je čitelnější a propojit.</p></div><div class="cards">${[...cards].sort((a,b)=>a[2].localeCompare(b[2],'cs')).map(c=>c[2]==='Registr smluv'?`<div class="card registry-home-card"><span class="icon">${c[1]}</span><h3>${c[2]}</h3><p>${c[3]}</p><div class="registry-home-links"><a class="more" href="#/smlouvy">Otevřít smlouvy MČ Praha 8 →</a><a class="more" href="#/smlouvy-organizace">Otevřít smlouvy příspěvkových organizací →</a><a class="more" href="#/smlouvy-firmy">Otevřít smlouvy městských firem →</a></div></div>`:`<a class="card" href="${c[0]}" ${c[4]?'target="_blank" rel="noreferrer"':''}><span class="icon">${c[1]}</span><h3>${c[2]}</h3><p>${c[3]}</p><span class="more">Otevřít ${c[4]?'↗':'→'}</span></a>`).join('')}</div></section>
 <section class="section home-principle"><div class="grid2"><div><div class="kicker">Princip</div><h2>Všechna data jsou ověřená a pravdivá.</h2></div><div><p>Čerpáme výhradně z oficiálních a veřejně dostupných zdrojů. U každého datasetu uvádíme jeho původ i datum poslední aktualizace, takže si můžete snadno ověřit, odkud data pocházejí a jak jsou aktuální.</p><p><a class="source-inline" href="#/zdroje">Otevřít Datové zdroje →</a></p></div></div></section>`)
}
function usneseni(){
 const resolutionsReady=sourceComplete('resolutions'), votingReady=sourceComplete('voting');
 const params=new URLSearchParams((location.hash.split('?')[1]||''));
 const preset=params.get('tema')||'';
 const years=[...new Set((data.usneseni||[]).map(x=>x.date?.slice(0,4)).filter(Boolean))].sort().reverse();
 shell(`<div class="page-head"><div class="kicker">Radnice</div><h1>Usnesení a hlasování</h1><p>Rozhodnutí Rady a Zastupitelstva MČ Praha 8. U usnesení Zastupitelstva zobrazujeme přímo také výsledek souvisejícího hlasování, pokud jej lze bezpečně přiřadit.</p></div><div id="decisionContent"></div>`);
 const host=$('#decisionContent');
 if(!resolutionsReady){host.innerHTML=`<div class="notice missing-data-notice"><b>Data nejsou načtena.</b> Datový zdroj Usnesení Rady a Zastupitelstva čeká na synchronizaci. Pro načtení spusťte <code>npm run sync:all</code>.</div>`;return}
 host.innerHTML=`<div class="toolbar"><input id="q" placeholder="Hledat v názvu, obsahu nebo čísle"><select id="organ"><option value="">Všechny orgány</option><option>Rada</option><option>Zastupitelstvo</option></select><select id="year"><option value="">Všechny roky</option>${years.map(y=>`<option>${y}</option>`).join('')}</select><input id="tema" value="${escapeHtml(preset)}" placeholder="Téma, např. Školství"></div>${!votingReady?`<div class="notice compact-notice"><b>Hlasování zatím není načteno.</b> Usnesení jsou dostupná, ale výsledky hlasování Zastupitelstva doplní příkaz <code>npm run sync:voting</code>.</div>`:''}<div id="resultCount" class="updated"></div><div id="rows" class="list"></div><div id="pagerUsneseni" class="pagination"></div>`;
 let page=1;const perPage=25;
 const draw=()=>{const text=$('#q').value.toLowerCase(),org=$('#organ').value,year=$('#year').value,tema=$('#tema').value.toLowerCase();const rows=data.usneseni.filter(x=>(!text||(x.title+' '+x.id+' '+(x.content||'')).toLowerCase().includes(text))&&(!org||x.organ===org)&&(!year||x.date?.startsWith(year))&&(!tema||(x.topics||[]).join(' ').toLowerCase().includes(tema)));const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.min(page,pages);const shown=rows.slice((page-1)*perPage,page*perPage);$('#resultCount').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} usnesení · stránka ${page} z ${pages}`;$('#rows').innerHTML=shown.length?shown.map(x=>{const vote=(votingReady&&x.organ==='Zastupitelstvo')?findVoteForResolution(x):null;return `<article class="item resolution-with-vote"><div class="meta"><b>${x.organ}</b><br>${x.date?fmtDate(x.date):'datum neuvedeno'}<br>${escapeHtml(x.id)}${x.meeting?`<br>jednání ${escapeHtml(x.meeting)}`:''}</div><div><div class="vote-title-row"><h3>${escapeHtml(x.title)}</h3>${vote?resolutionVoteStatus(vote):''}</div><div class="chips">${(x.topics||[]).map(t=>`<span class="chip">${escapeHtml(t)}</span>`).join('')}${x.tasks?.length?`<span class="chip">${x.tasks.length} ${x.tasks.length===1?'úkol':'úkoly'}</span>`:''}</div>${vote?renderVoteInline(vote):x.organ==='Zastupitelstvo'&&votingReady?`<div class="vote-inline muted-vote"><span>Hlasování se nepodařilo bezpečně přiřadit k tomuto usnesení.</span></div>`:''}</div><a class="source" target="_blank" rel="noreferrer" href="${x.url}">Originál ↗</a></article>`}).join(''):`<div class="empty">Nic neodpovídá zvoleným filtrům.</div>`;$('#pagerUsneseni').innerHTML=pagerMarkup(page,pages);$$('#pagerUsneseni button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();$('#resultCount').scrollIntoView({behavior:'smooth',block:'center'})})};
 $$('#q,#organ,#year,#tema').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));draw();
}

function normalizeDecisionTitle(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bhlavniho mesta prahy\b/g,'hmp').replace(/\bmestske casti\b|\bmc\b|\bpraha 8\b/g,' ').replace(/\bnavrh(?:u)?\b|\bzameru\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function titleSimilarity(a,b){const A=new Set(normalizeDecisionTitle(a).split(' ').filter(x=>x.length>2)),B=new Set(normalizeDecisionTitle(b).split(' ').filter(x=>x.length>2));if(!A.size||!B.size)return 0;let i=0;A.forEach(x=>{if(B.has(x))i++});return 2*i/(A.size+B.size)}
function findVoteForResolution(r){const same=(data.hlasovani||[]).filter(v=>v.date===r.date && voteBody(v).startsWith('Zastupitelstvo'));let best=null,score=0;for(const v of same){const s=titleSimilarity(r.title,v.title);if(s>score){score=s;best=v}}return score>=0.72?best:null}
function resolutionVoteStatus(v){const st=voteStatus(v);return st?`<span class="vote-status ${st==='schváleno'?'approved':'rejected'}">${st}</span>`:''}
function renderVoteInline(v){const pct=v.present?Math.round((v.for||0)/v.present*100):0;const people=Array.isArray(v.votes)?v.votes:[];const groups=people.reduce((m,x)=>{const k=x.vote||'Neuvedeno';(m[k]??=[]).push(x.name);return m},{});const individual=people.length?`<details class="individual-votes"><summary>Jak hlasovali jednotliví zastupitelé (${people.length})</summary><div class="individual-vote-grid">${Object.entries(groups).map(([k,names])=>`<div><b>${escapeHtml(k)}</b><p>${names.map(escapeHtml).join(', ')}</p></div>`).join('')}</div></details>`:`<details class="individual-votes"><summary>Jak hlasovali jednotliví zastupitelé</summary><p class="updated">Jednotlivé hlasy nejsou v tomto lokálním datasetu zatím načtené. Při další synchronizaci se je pokusíme doplnit z detailu hlasování.</p></details>`;return `<div class="vote-inline"><div class="vote-inline-head"><b>Hlasování</b><a href="${v.detailUrl||v.url}" target="_blank" rel="noreferrer">Zdroj ↗</a></div><div class="chips vote-chips"><span class="chip">Přítomno ${v.present??'—'}</span><span class="chip vote-for">Pro ${v.for??'—'}</span><span class="chip vote-against">Proti ${v.against??'—'}</span><span class="chip vote-abstain">Zdržel/a se ${v.abstain??'—'}</span>${v.notVoting!==undefined?`<span class="chip">Nehlasovalo ${v.notVoting}</span>`:''}<span class="chip">${pct} % přítomných pro</span></div>${individual}</div>`}
function hlasovani(){history.replaceState(null,'','#/usneseni');usneseni()}
function voteBody(x){
 const explicit=String(x.body||x.organ||'').trim(); if(explicit)return explicit;
 const u=String(x.detailUrl||x.url||'').toUpperCase();
 if(u.includes('/ZMC')||u.includes('ZMC20'))return 'Zastupitelstvo MČ Praha 8';
 if(u.includes('/RMC')||u.includes('RMC20'))return 'Rada MČ Praha 8';
 if(/KOMIS|KOMISE/.test(u))return 'Komise Rady MČ Praha 8';
 if(/VYBOR|VÝBOR/.test(u))return 'Výbor Zastupitelstva MČ Praha 8';
 return 'Orgán neuveden';
}
function voteStatus(x){
 if(x.status)return x.status;
 const body=voteBody(x),yes=Number(x.for||0);
 if(body.startsWith('Zastupitelstvo') && Number.isFinite(yes))return yes>=23?'schváleno':'neschváleno';
 if(body.startsWith('Rada') && Number.isFinite(yes))return yes>=5?'schváleno':'neschváleno';
 return '';
}
function slibnik(){
 const items=data.usneseni.flatMap(x=>{const tasks=x.tasks?.length?x.tasks:((x.responsible||x.deadline)?[{responsible:x.responsible,deadline:x.deadline}]:[]);return tasks.map((t,i)=>({...t,id:x.id,title:x.title,url:x.url,index:i+1}))}).sort((a,b)=>(b.deadline||'').localeCompare(a.deadline||''));
 shell(`<div class="page-head"><div class="kicker">Radnice</div><h1>Slibník</h1><p>Automaticky vytěžené úkoly z usnesení, včetně zodpovědné osoby a termínu. Jedno usnesení může obsahovat více úkolů.</p></div><div class="notice">Rozpoznáno ${items.length.toLocaleString('cs-CZ')} úkolů. Stav „termín uplynul“ znamená pouze to, že datum je v minulosti — automaticky to neříká, zda byl úkol splněn.</div><div class="list">${items.map(x=>{const overdue=x.deadline&&new Date(x.deadline+'T23:59:59')<new Date();return `<article class="item"><div class="meta"><span class="promise-status ${overdue?'done':'open'}">${overdue?'Termín uplynul':'Termín neuplynul'}</span><br>${escapeHtml(x.id)}${x.index>1?`<br>úkol ${x.index}`:''}</div><div><h3>${escapeHtml(x.title)}</h3><div class="chips"><span class="chip">Zodpovídá: ${escapeHtml(x.responsible||'neuvedeno')}</span><span class="chip">Termín: ${x.deadline?fmtDate(x.deadline):'neuveden'}</span></div></div><a class="source" href="${x.url}" target="_blank">Usnesení ↗</a></article>`}).join('')||'<div class="empty">Zatím bez rozpoznaných úkolů.</div>'}</div>`)
}
function budgetBars(items){
 const max=Math.max(...(items||[]).map(x=>Number(x.value)||0),1);
 return `<div class="budget-bars">${(items||[]).map(x=>`<div class="budget-bar-row"><div class="budget-bar-label"><b>${escapeHtml(x.label)}</b><span>${(Number(x.value)*1000).toLocaleString('cs-CZ')} Kč</span></div><div class="budget-bar-track"><i style="width:${Math.max(1.5,Number(x.value)/max*100)}%"></i></div></div>`).join('')}</div>`
}
function isBudgetResolution(x){const t=`${x.title||''} ${x.content||''}`.toLowerCase();return /(rozpočt(?!ář)|rozpočtové opatření|rozpočtového opatření|střednědobý výhled|závěrečný účet|závěrečného účtu|účetní závěrk|finanční vypořádání)/i.test(t)}
function penize(){
 const budgetReady=sourceComplete('resolutions');
 const budgetRows=budgetReady?(data.usneseni||[]).filter(isBudgetResolution).sort((a,b)=>(b.date||'').localeCompare(a.date||'')):[];
 const budgetApproval=budgetRows.find(x=>x.organ==='Zastupitelstvo'&&String(x.title||'').toLowerCase().includes('rozpo')&&String(x.date||'').startsWith('2026'));
 shell(`<div class="page-head"><div class="kicker">Finance</div><h1>Rozpočty a veřejné finance</h1><p>Rozpočet, smlouvy a finanční rozhodnutí MČ Praha 8 na jednom místě.</p></div><section class="budget-hero"><div class="kicker">Rozpočet 2026</div><div class="money">1,497 mld. Kč</div><h2>MČ Praha 8 hospodaří v roce 2026 s rozpočtem 1 497 008,3 tis. Kč.</h2>${budgetApproval?`<p>Rozpočet schválilo Zastupitelstvo MČ Praha 8 dne <b>${fmtDate(budgetApproval.date)}</b>.</p>`:'<p>Schválený rozpočet MČ Praha 8 pro rok 2026.</p>'}<a class="budget-approved-link" href="${escapeHtml(data.budget2026?.source||'https://www.praha8.cz/Rozpocet-mestske-casti-Praha-8-pro-rok-2026.html')}" target="_blank" rel="noreferrer">→ OTEVŘÍT SCHVÁLENÝ ROZPOČET MČ PRAHA 8 PRO ROK 2026</a></section><section class="section"><div class="section-head"><div><div class="kicker">Registr smluv</div><h2>Smlouvy</h2></div><p>Tři samostatné pohledy na smlouvy městské části, jejích organizací a městských firem.</p></div><div class="grid3 finance-contract-grid"><a class="card" href="#/smlouvy"><h3>MČ Praha 8</h3><p>Kompletní historie smluv publikovaných městskou částí.</p><span class="more">Otevřít →</span></a><a class="card" href="#/smlouvy-organizace"><h3>Organizace</h3><p>Smlouvy příspěvkových organizací, škol a dalších zařízení.</p><span class="more">Otevřít →</span></a><a class="card" href="#/smlouvy-firmy"><h3>Městské firmy</h3><p>Smlouvy společností ve 100% vlastnictví MČ Praha 8.</p><span class="more">Otevřít →</span></a></div></section><section class="section"><div class="section-head"><div><div class="kicker">Schválený rozpočet 2026</div><h2>Příjmy a výdaje</h2></div><p>Základní struktura schváleného rozpočtu MČ Praha 8. Detailnější průběžné plnění doplníme, až se Praha 8 konečně připojí k systému Cityvizor.</p></div>${data.budget2026?`<div class="budget-chart-grid"><article class="budget-chart-card"><h3>Příjmy</h3><p>Podle rozpočtových tříd</p>${budgetBars(data.budget2026.income)}</article><article class="budget-chart-card"><h3>Výdaje</h3><p>Podle kapitol</p>${budgetBars(data.budget2026.expenses)}</article></div><div class="budget-source-note">Schválený rozpočet na rok 2026 · částky v grafu vycházejí z přílohy č. 2 usnesení Zastupitelstva MČ Praha 8 č. Usn ZMC 002/2026 ze dne 18. 2. 2026. <a href="${escapeHtml(data.budget2026.source)}" target="_blank" rel="noreferrer">Otevřít zdroj ↗</a></div>`:'<div class="notice missing-data-notice"><b>Rozpočtová data nejsou načtena.</b></div>'}</section><section class="section"><div class="section-head"><div><div class="kicker">Rozpočtová rozhodnutí</div><h2>Rozpočtová usnesení a opatření</h2></div><p>Usnesení týkající se rozpočtu, rozpočtových opatření, střednědobého výhledu, závěrečného účtu a účetních závěrek.</p></div><div id="budgetResolutions"></div></section>`);
 const host=$('#budgetResolutions');if(!budgetReady){host.innerHTML=`<div class="notice missing-data-notice"><b>Data nejsou načtena.</b> Rozpočtová usnesení se vybírají z kompletního datasetu Usnesení Rady a Zastupitelstva. Pro načtení spusťte <code>npm run sync:all</code>.</div>`;return}
 host.innerHTML=`<div id="countBudget" class="updated"></div><div id="rowsBudget" class="list"></div><div id="pagerBudget" class="pagination"></div>`;let page=1;const perPage=10;const draw=()=>{const pages=Math.max(1,Math.ceil(budgetRows.length/perPage));page=Math.min(page,pages);const shown=budgetRows.slice((page-1)*perPage,page*perPage);$('#countBudget').textContent=`Nalezeno ${budgetRows.length.toLocaleString('cs-CZ')} rozpočtových usnesení · stránka ${page} z ${pages}`;$('#rowsBudget').innerHTML=shown.map(x=>`<article class="item"><div class="meta"><b>${escapeHtml(x.organ||'')}</b><br>${x.date?fmtDate(x.date):'datum neuvedeno'}<br>${escapeHtml(x.id||'')}</div><div><h3>${escapeHtml(x.title)}</h3></div><a class="source" target="_blank" rel="noreferrer" href="${x.url}">Originál ↗</a></article>`).join('')||'<div class="empty">V načtených usneseních jsme zatím žádné rozpočtové usnesení nerozpoznali.</div>';$('#pagerBudget').innerHTML=pagerMarkup(page,pages);$$('#pagerBudget button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();$('#countBudget').scrollIntoView({behavior:'smooth',block:'center'})})};draw();
}
function personNorm(name=''){
 const drop=new Set(['mgr','bc','ing','phdr','judr','rndr','mvdr','doc','prof','phd','mba','mpa','ma','dis','csc','dba','bca','et']);
 const toks=String(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).filter(x=>!drop.has(x)&&x.length>1);
 return toks.slice(0,2).sort().join(' ')
}
function givenName(p){
 const raw=String(p?.name||'').replace(/\b(Mgr|Bc|Ing|PhDr|JUDr|RNDr|MVDr|doc|prof|MBA|MPA|Ph\.D|DiS|CSc|DBA|BcA|M\.A)\.?\b/gi,'').replace(/[,]/g,' ').trim();
 const parts=raw.split(/\s+/).filter(Boolean);
 // Zdroj Prahy 8 používá pořadí PŘÍJMENÍ JMÉNO, proto je křestní jméno zpravidla druhý token.
 return parts[1]||parts[0]||'';
}
function femalePerson(p){
 if(!p)return false;
 const r=String(p.role||'').toLowerCase();
 if(/místostarostka|zastupitelka|členka|předsedkyně|radní.*žena/.test(r))return true;
 if(/místostarosta|zastupitel(?!ka)|člen(?!ka)|předseda|starosta/.test(r))return false;
 const first=givenName(p).toLowerCase();
 const maleExceptions=new Set(['ivo','nikola','saša','míša','kosta','andrea']);
 if(maleExceptions.has(first))return false;
 return /(?:a|á|ie)$/.test(first);
}
function lowerRoleInitial(value=''){const s=String(value||'');return s?s.charAt(0).toLocaleLowerCase('cs-CZ')+s.slice(1):s}
function personNameParts(name=''){
 const raw=String(name||'').trim().replace(/\s+/g,' ');
 const parts=raw.split(' ').filter(Boolean);
 if(parts.length<2)return {surname:raw,given:'',prefix:[],suffix:[]};
 const surname=parts.shift().replace(/,$/,'');
 const given=parts.shift().replace(/,$/,'');
 const rest=parts.join(' ').replace(/\s*,\s*/g,', ').trim();
 const tokens=rest?rest.split(/\s+/):[];
 const prefix=[],suffix=[];
 const suffixRx=/^(?:Ph\.D\.|CSc\.|DrSc\.|DBA|MBA|MPA|DiS\.|M\.A\.|LL\.M\.|Th\.D\.)[,]?$/i;
 let suffixMode=false;
 for(let token of tokens){
   const clean=token.replace(/,$/,'');
   if(suffixRx.test(token)||suffixMode){suffixMode=true;suffix.push(clean)}else prefix.push(clean);
 }
 return {surname,given,prefix,suffix};
}
function displayPersonName(name=''){
 const n=personNameParts(name);
 const pre=n.prefix.length?n.prefix.join(' ')+' ':'';
 const post=n.suffix.length?', '+n.suffix.join(', '):'';
 return `${pre}${n.given}${n.given?' ':''}${n.surname}${post}`.trim();
}
function personSurname(name=''){return personNameParts(name).surname}
function comparePersonSurname(a,b){return personSurname(a.name).localeCompare(personSurname(b.name),'cs')||displayPersonName(a.name).localeCompare(displayPersonName(b.name),'cs')}
function chairLabel(p){return femalePerson(p)?'předsedkyně klubu':'předseda klubu'}
function localRoleLabel(p){
 const r=(p.role||'').toLowerCase();
 if(r==='starosta')return 'starosta';
 if(r==='místostarostka')return 'místostarostka';
 if(r==='místostarosta')return 'místostarosta';
 if(r==='radní')return 'radní';
 return '';
}
function shortBodyRole(person,isChair=false){
 const female=femalePerson(person);
 return isChair?(female?'předsedkyně':'předseda'):(female?'členka':'člen');
}
function cleanMagistrateBody(body=''){
 return String(body||'')
   // období a institucionální dovětky nejsou na kartě člověka potřeba
   .replace(/\s*\((?:19|20)\d{2}\s*[–—-]\s*(?:19|20)\d{2}\)\s*$/i,'')
   .replace(/\s+(?:ZHMP|RHMP)\s*$/i,'')
   .replace(/\s+(?:Zastupitelstva|Rady)\s+hl\.?\s*(?:m\.?|města)\s*Prahy\s*$/i,'')
   .replace(/^Komise\s+(?:Rady\s+hl\.?\s*(?:m\.?|města)\s*Prahy|RHMP)\s+/i,'Komise ')
   .replace(/^Výbor\s+(?:ZHMP|Zastupitelstva\s+hl\.?\s*(?:m\.?|města)\s*Prahy)\s+/i,'Výbor ')
   .replace(/\s+/g,' ').trim();
}
function magistrateLabel(p,x){
 const raw=String(x?.role||'').toLocaleLowerCase('cs-CZ');
 if(raw.includes('zastupitel'))return femalePerson(p)?'zastupitelka hl. města Prahy':'zastupitel hl. města Prahy';
 if(raw.includes('primátor'))return femalePerson(p)?'primátorka hl. města Prahy':'primátor hl. města Prahy';
 if(raw.includes('náměst'))return femalePerson(p)?'náměstkyně primátora hl. města Prahy':'náměstek primátora hl. města Prahy';
 if(raw.includes('radní'))return 'radní hl. města Prahy';
 if(raw.includes('místopředs')||raw.includes('mistopředs')||raw.includes('mistopredsed'))return femalePerson(p)?'místopředsedkyně':'místopředseda';
 if(raw.includes('předs')||raw.includes('predsed'))return femalePerson(p)?'předsedkyně':'předseda';
 if(raw.includes('člen')||raw.includes('clen'))return femalePerson(p)?'členka':'člen';
 return lowerRoleInitial(String(x?.role||'').replace(/místoPředseda/g,'místopředseda').replace(/místoPředsedkyně/g,'místopředsedkyně'));
}
function normalizeMembershipRole(role,p){
 let r=String(role||'').trim();
 const female=femalePerson(p);
 r=r.replace(/místoPředseda/gi,'místopředseda').replace(/místoPředsedkyně/gi,'místopředsedkyně');
 r=r.replace(/místopředseda\/předsedkyně/gi,female?'místopředsedkyně':'místopředseda')
    .replace(/Předseda\/předsedkyně/gi,female?'předsedkyně':'předseda')
    .replace(/Člen\/ka/gi,female?'členka':'člen');
 if(/^členka\b/i.test(r)&&!female)r=r.replace(/^členka/i,'člen');
 if(/^člen\b/i.test(r)&&female)r=r.replace(/^člen/i,'členka');
 if(/^předsedkyně\b/i.test(r)&&!female)r=r.replace(/^předsedkyně/i,'předseda');
 if(/^předseda\b/i.test(r)&&female)r=r.replace(/^předseda/i,'předsedkyně');
 if(/^místopředsedkyně\b/i.test(r)&&!female)r=r.replace(/^místopředsedkyně/i,'místopředseda');
 if(/^místopředseda\b/i.test(r)&&female)r=r.replace(/^místopředseda/i,'místopředsedkyně');
 r=r.replace(/\bpředstavenstvo\b/gi,'představenstva').replace(/\bdozorčí rada\b/gi,'dozorčí rady').replace(/\bsprávní rada\b/gi,'správní rady');
 return lowerRoleInitial(r);
}
function personFunctions(p){
 const key=personNorm(p.name);
 const groups={council:[],bodies:[],companies:[],magistrate:[],hmpCompanies:[],other:[]};
 const sourceLoaded=(key)=>sourceComplete(key);
 groups.other=sourceLoaded('nationalRoles')?(p.otherRoles||[]).map(x=>({label:lowerRoleInitial(x.label||x.role||''),url:x.url||''})):[];
 if(['starosta','místostarosta','místostarostka','radní'].includes(p.role))groups.council.push({label:`${localRoleLabel(p)} · Rada městské části`,rank:0});
 for(const o of (data.organy||[])){
   const typeRank=o.type==='Výbor zastupitelstva'?0:1;
   if(o.chair&&personNorm(o.chair.name)===key)groups.bodies.push({label:`${shortBodyRole(p,true)} · ${o.name}`,rank:typeRank});
   for(const m of (o.members||[]))if(personNorm(m.name)===key)groups.bodies.push({label:`${shortBodyRole(p,false)} · ${o.name}`,rank:10+typeRank});
 }
 groups.bodies.sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label,'cs'));
 groups.bodies=groups.bodies.map(x=>({...x,label:x.label.replace(/^(předseda|předsedkyně|člen|členka) (výboru|komise) · /i,'$1 · ')}));
 for(const o of (data.organizace||[])){
   for(const [field,title] of [['board','Představenstvo'],['supervisoryBoard','Dozorčí rada'],['statutoryBody','Statutární orgán']]){
     for(const m of (o[field]||[]))if(personNorm(m.name||m)===key)groups.companies.push({label:`${normalizeMembershipRole(m.role||title,p)} · ${o.name}`});
   }
 }
 groups.magistrate=sourceLoaded('hmpFunctions')?(p.magistrateRoles||[]).map(x=>{
   const hay=((x.role||'')+' '+(x.body||'')).toLocaleLowerCase('cs-CZ');
   let rank=9;
   if(/rada hl|primátor|náměst|radní/.test(hay))rank=0;
   else if(/zastupitel/.test(hay))rank=1;
   else if(/(předs|predsed|místopředs|mistopredsed)/.test(hay)&&/výbor/.test(hay))rank=2;
   else if(/výbor/.test(hay))rank=3;
   else if(/(předs|predsed|místopředs|mistopredsed)/.test(hay)&&/komis/.test(hay))rank=4;
   else if(/komis/.test(hay))rank=5;
   const body=cleanMagistrateBody(x.body||'');
   return {label:[magistrateLabel(p,x), body && !/Zastupitelstvo HMP/i.test(body)?body:''].filter(Boolean).join(' · '),url:x.url||'',rank};
 }).sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label,'cs')):[];
 groups.hmpCompanies=sourceLoaded('hmpCompanies')?(p.hmpCompanyRoles||[]).map(x=>{
   const role=normalizeMembershipRole(x.role,p);
   const low=role.toLocaleLowerCase('cs-CZ');
   const rank=/^předsed|^predsed/.test(low)?0:/^místopředsed|^mistopredsed/.test(low)?1:2;
   return {label:[role,x.body].filter(Boolean).join(' · '),url:x.url||'',rank};
 }).sort((a,b)=>a.rank-b.rank||a.label.localeCompare(b.label,'cs')):[];
 return groups;
}
function functionGroup(title,items,cls='',{links=true}={}){
 if(!items?.length)return '';
 return `<div class="function-group ${cls}"><span class="areas-label">${escapeHtml(title)}</span>${items.map(m=>`<div class="membership-row">${links&&m.url?`<a href="${escapeHtml(m.url)}" target="_blank" rel="noreferrer">${escapeHtml(m.label)} ↗</a>`:escapeHtml(m.label)}</div>`).join('')}</div>`;
}
function splitAreas(areas=[]){return areas.flatMap(a=>String(a||'').split(/\s*[,;•]\s*/)).map(x=>x.trim()).filter(Boolean)}
function personCard(p,{council=false,showAreas=false}={}){
 const chair=(!council&&p.isClubChair)?`<span class="role-badge chair-badge">${chairLabel(p)}</span>`:'';
 const role=council?`<span class="role-badge">${escapeHtml(lowerRoleInitial(localRoleLabel(p)||p.role))}</span>`:'';
 let areas=(showAreas&&sourceComplete('people'))?splitAreas(p.areas||[]):[];
 if(showAreas && /solomon/i.test(p.name||'')){areas=areas.filter(a=>!/^(kultura|mládež|volný čas)$/i.test(a));areas.push('Kultura, mládež a volný čas')}
 areas=[...new Set(areas)].sort((a,b)=>a.localeCompare(b,'cs'));
 const f=personFunctions(p);
 const contact=(p.email||p.phone)?`<div class="function-group contact-group"><span class="areas-label">Kontakt</span>${p.email?`<div class="membership-row"><a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a></div>`:''}${p.phone?`<div class="membership-row"><a href="tel:${escapeHtml(String(p.phone).replace(/\s+/g,''))}">${escapeHtml(p.phone)}</a></div>`:''}</div>`:'';
 const localMc=[...f.council,...f.bodies];
 const details=council?'':`${functionGroup('MČ Praha 8',localMc)}${functionGroup('Hlavní město Praha',f.magistrate,'',{links:false})}${functionGroup('Jiné',f.other)}${functionGroup('Firmy Prahy 8',f.companies)}${functionGroup('Firmy hl. města Prahy',f.hmpCompanies)}`;
 const shownName=displayPersonName(p.name); const np=personNameParts(p.name); const initials=`${np.given?.[0]||''}${np.surname?.[0]||''}`;
 return `<div class="card person-card"><div class="person"><div class="avatar">${escapeHtml(initials)}</div><div><h3>${escapeHtml(shownName)}</h3><div class="person-badges">${role}${chair}<span class="club-label">${escapeHtml(p.club)}</span></div></div></div>${areas.length?`<div class="areas areas-visual"><span class="areas-label">Gesce</span><ul class="area-list council-areas-list">${areas.map(a=>`<li class="area-line">${escapeHtml(a)}</li>`).join('')}</ul></div>`:''}${details}${contact}</div>`}
const clubColors={
 'ODS':'#0057b8','ANO':'#00a6d6','Piráti':'#111111','8ŽIJE A PRAHA SOBĚ':'#6f2c91','SPD a Trikolora pro Osmičku':'#d71920','Společně pro Prahu 8':'#7d3c98','Patrioti':'#c72c41','Bez klubu':'#8b8c85'
};
function clubColor(c){return clubColors[c]||'#8b8c85'}
function clubDisplayName(c){const names={'Společně pro Prahu 8':'Společně pro Prahu 8 - TOP 09 a Starostové a nezávislí','Patrioti':'Patrioti pro Prahu 8','Piráti':'Česká pirátská strana'};return names[c]||c}
function lide(){
 const roleRank={starosta:0,místostarosta:1,místostarostka:1,radní:2};
 const council=data.lide.filter(p=>p.role in roleRank).sort((a,b)=>roleRank[a.role]-roleRank[b.role]||comparePersonSurname(a,b));
 const clubMap=new Map();for(const p of data.lide){const c=p.club||'Bez klubu';if(!clubMap.has(c))clubMap.set(c,[]);clubMap.get(c).push(p)}
 const clubElectionOrder=['ODS','ANO','8ŽIJE A PRAHA SOBĚ','Piráti','Společně pro Prahu 8','Patrioti','SPD a Trikolora pro Osmičku'];
 const clubRank=new Map(clubElectionOrder.map((c,i)=>[c,i]));
 const clubs=[...clubMap.entries()].sort((a,b)=>(clubRank.get(a[0])??999)-(clubRank.get(b[0])??999)||a[0].localeCompare(b[0],'cs'));
 const coalitionClubs=new Set(['ODS','ANO','Společně pro Prahu 8','Patrioti']);
 const coalitionClubsRows=clubs.filter(([c])=>coalitionClubs.has(c)), oppositionClubsRows=clubs.filter(([c])=>!coalitionClubs.has(c));
 const coalition=coalitionClubsRows.reduce((n,[,a])=>n+a.length,0),opposition=oppositionClubsRows.reduce((n,[,a])=>n+a.length,0),total=data.lide.length||45;
 const stack=clubs.map(([club,arr])=>`<span class="seat-segment" style="width:${arr.length/total*100}%;background:${clubColor(club)}" title="${escapeHtml(club)}: ${arr.length}"></span>`).join('');
 const legend=rows=>rows.map(([club,arr])=>`<span class="party-legend"><i style="background:${clubColor(club)}"></i><span class="party-name">${escapeHtml(clubDisplayName(club))}</span><span class="party-count">${arr.length}</span></span>`).join('');
 shell(`<div class="page-head"><div class="kicker">Zastupitelstvo</div><h1>Kdo rozhoduje na Praze 8</h1><p>Rada městské části a všech 45 zastupitelů. Politické kluby jsou řazené podle výsledku komunálních voleb 2022.</p></div>
 <section class="section council-balance"><div class="section-head"><div><div class="kicker">Zastupitelstvo</div><h2>Koalice a opozice</h2></div><p>45 křesel celkem</p></div><div class="balance-grid"><div><strong>${coalition}</strong><span>koalice</span><div class="party-list">${legend(coalitionClubsRows)}</div></div><div><strong>${opposition}</strong><span>opozice</span><div class="party-list">${legend(oppositionClubsRows)}</div></div></div><div class="seat-stack" aria-label="Rozdělení 45 křesel podle politických klubů">${stack}</div><div class="seat-stack-caption">Barva = politický klub · šířka = počet křesel</div></section>
 <section class="section people-section"><div class="section-head"><div><div class="kicker">Výkonné vedení</div><h2>Rada městské části</h2></div><p>${council.length} členů rady</p></div><div class="cards people-cards">${council.map(p=>personCard(p,{council:true,showAreas:true})).join('')}</div></section>
 <section class="section people-section"><div class="section-head"><div><div class="kicker">Zastupitelstvo</div><h2>Politické kluby</h2></div><p>${data.lide.length} zastupitelů celkem</p></div>${clubs.map(([club,arr])=>{let members=[...arr];members.sort((a,b)=>(b.isClubChair?1:0)-(a.isClubChair?1:0)||comparePersonSurname(a,b));return `<div class="club-block"><div class="club-head"><div class="club-title"><i style="background:${clubColor(club)}"></i><h3>${escapeHtml(clubDisplayName(club))}</h3></div><span>${members.length} ${members.length===1?'křeslo':'křesel'}</span></div><div class="cards people-cards">${members.map(p=>personCard(p)).join('')}</div></div>`}).join('')}</section>`)
}
function bodyPerson(p){return `<li><span class="person-line"><b>${escapeHtml(displayPersonName(p.name))}</b>${p.club?`<span class="member-club">${escapeHtml(p.club)}</span>`:''}</span>${p.role?`<span class="body-role">${escapeHtml(p.role)}</span>`:''}</li>`}
function bodyRole(p,kind,isChair=false){
 const known=data.lide.find(x=>personNorm(x.name)===personNorm(p?.name));
 const female=femalePerson(known||p);
 return isChair?(female?'předsedkyně':'předseda'):(female?'členka':'člen');
}
function secretaryLabel(name=''){
 const p=data.lide.find(x=>personNorm(x.name)===personNorm(name))||{name};
 return femalePerson(p)?'tajemnice':'tajemník';
}
function bodyMaterialsUrl(x){
 if(x.materialsUrl)return x.materialsUrl;
 const n=String(x.name||'').toLowerCase();
 if(n.includes('kontrolní výbor'))return 'https://www.praha8.cz/Materialy-KV';
 if(n.includes('finanční výbor'))return 'https://www.praha8.cz/Materialy-Financniho-vyboru';
 return '';
}
function organy(){
 if(!sourceComplete('bodies')){missingDataPage({kicker:'Volené orgány',title:'Komise, výbory a zvláštní orgány',description:'Složení komisí, výborů a zvláštních orgánů MČ Praha 8.',command:'npm run sync:bodies'});return}
 const groups=['Výbor zastupitelstva','Komise rady','Zvláštní orgán'];
 shell(`<div class="page-head"><div class="kicker">Volené orgány</div><h1>Komise a výbory</h1><p>Složení poradních orgánů Rady MČ a výborů Zastupitelstva MČ. U zastupitelů doplňujeme politickou příslušnost.</p></div>${groups.map(type=>{const rows=(data.organy||[]).filter(x=>x.type===type && !(type==='Komise rady' && /sociálně-právní ochranu dětí/i.test(x.name||'')));return `<section class="section"><div class="section-head"><div><div class="kicker">${type==='Komise rady'?'Rada':type==='Zvláštní orgán'?'Městská část':'Zastupitelstvo'}</div><h2>${type==='Komise rady'?'Komise Rady MČ Praha 8':type==='Zvláštní orgán'?'Zvláštní orgány městské části':'Výbory Zastupitelstva MČ Praha 8'}</h2></div><p>${rows.length} orgánů</p></div><div class="body-grid">${rows.map(x=>`<article class="body-card"><div class="body-top body-top-stacked"><h3>${escapeHtml((x.name||'').replace(/\s+MČ Praha 8$/i,''))}</h3><div class="body-links body-links-badges"><a href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">detail ↗</a>${bodyMaterialsUrl(x)?`<a href="${escapeHtml(bodyMaterialsUrl(x))}" target="_blank" rel="noreferrer">materiály ↗</a>`:''}</div></div>${x.chair?`<div class="body-chair"><small>${bodyRole(x.chair,type,true)}</small>${bodyPerson({...x.chair,role:''}).replace(/^<li>|<\/li>$/g,'')}</div>`:''}${x.members?.length?`<div class="body-members"><small>Členové z řad zastupitelů</small><ul>${x.members.map(p=>bodyPerson({...p,role:''})).join('')}</ul></div>`:''}${x.citizens?.length?`<div class="body-members citizen-members"><small>Členové z řad občanů</small><ul>${x.citizens.map(p=>bodyPerson({...p,role:''})).join('')}</ul></div>`:''}${x.secretary?`<div class="body-secretary"><small>${secretaryLabel(x.secretary)}</small>${escapeHtml(x.secretary)}</div>`:''}</article>`).join('')||'<div class="empty">Data zatím nejsou načtena. Spusťte npm run sync.</div>'}</div></section>`}).join('')}`)
}
function companyPerson(p){if(typeof p==='string')return `<li><span class="person-line"><span>${escapeHtml(p)}</span></span></li>`;return `<li><span class="person-line"><span>${escapeHtml(p.name||'')}</span>${p.club?`<span class="member-club">${escapeHtml(p.club)}</span>`:''}</span>${p.role?`<span class="company-role">${escapeHtml(lowerRoleInitial(p.role))}</span>`:''}</li>`}
function orgLeadership(o){
 if(o.type==='městská obchodní společnost'||o.type==='společnost s majetkovou účastí'){
   const board=o.board||[],sup=o.supervisoryBoard||[],stat=o.statutoryBody||[];
   return `<div class="company-bodies">${stat.length?`<div><small>Statutární orgán</small><ul>${stat.map(companyPerson).join('')}</ul></div>`:''}${board.length?`<div><small>Představenstvo</small><ul>${board.map(companyPerson).join('')}</ul></div>`:''}${sup.length?`<div><small>Dozorčí rada</small><ul>${sup.map(companyPerson).join('')}</ul></div>`:''}${!stat.length&&!board.length&&!sup.length?'—':''}</div>`;
 }
 return `${escapeHtml(o.director||'—')}${o.leaderRole?`<br><small>${escapeHtml(lowerRoleInitial(o.leaderRole))}</small>`:''}`;
}
function schoolMetric(value,label){return `<div class="school-metric"><strong>${value===null||value===undefined||value===''?'—':escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`}
function schoolDirectorLabel(o){
 const role=String(o.leaderRole||'').toLowerCase();
 if(role.includes('ředitelka'))return 'Ředitelka';
 if(role.includes('ředitel'))return 'Ředitel';
 const n=String(o.director||o.reditel||'');
 const surname=n.trim().split(/\s+/).pop()||'';
 return /ová$|á$/.test(surname)?'Ředitelka':'Ředitel';
}
function schoolCard(o){
 const capacity=o.capacity??o.kapacita??null, pupils=o.pupils??o.children??o.zaci??o.deti??null, classes=o.classes??o.tridy??null;
 const occupancy=(capacity&&pupils)?`${Math.round(Number(pupils)/Number(capacity)*100)} %`:(o.occupancy??o.naplnenost??null);
 const web=o.website||o.web||''; const director=o.director||o.reditel||'';
 const czCount=(n,one,few,many)=>{n=Number(n)||0;const m100=n%100,m10=n%10;return m100>=11&&m100<=14?many:m10===1?one:(m10>=2&&m10<=4?few:many)};
 const preschool=o.type==='základní škola'&&o.preschoolChildren?`<div class="school-preschool"><small>Součástí školy je také MŠ</small><b>${fmt(o.preschoolChildren)} dětí · ${fmt(o.preschoolClasses)} ${czCount(o.preschoolClasses,'třída','třídy','tříd')}</b></div>`:'';
 const identity=`<div class="school-identity"><span><small>Právní forma</small><span class="identity-value">${escapeHtml(o.legalType||'příspěvková organizace')}</span></span><span><small>IČO</small><span class="identity-value">${escapeHtml(o.ico||'—')}</span></span></div>`;
 const webLabel=web?web.replace(/^https?:\/\//,'').replace(/\/$/,''):'';
 return `<article class="school-card"><div class="school-card-head"><div><small>${o.type==='mateřská škola'?'Mateřská škola':'Základní škola'}</small><h3>${escapeHtml(o.name)}</h3></div></div>${identity}${director?`<div class="school-director"><small>${schoolDirectorLabel(o)}</small><span class="identity-value">${escapeHtml(director)}</span></div>`:''}${web?`<div class="school-web"><small>Web školy</small><a href="${escapeHtml(web)}" target="_blank" rel="noreferrer">${escapeHtml(webLabel)} ↗</a></div>`:''}<div class="school-metrics">${schoolMetric(pupils,o.type==='mateřská škola'?'dětí':'žáků')}${schoolMetric(classes,'tříd')}${schoolMetric(capacity,'kapacita')}${schoolMetric(occupancy,'naplněnost')}</div>${preschool}</article>`;
}
function skoly(){
 const schoolRows=(data.organizace||[]).filter(o=>['základní škola','mateřská škola'].includes(o.type));
 if(!schoolRows.length){missingDataPage({kicker:'Školství',title:'Mateřské a základní školy Prahy 8',description:'Kontakty, vedení, počty žáků a dětí, třídy, kapacity a naplněnost škol.',command:'npm run sync:organizations'});return}
 const zs=schoolRows.filter(o=>o.type==='základní škola'), ms=schoolRows.filter(o=>o.type==='mateřská škola');
 const totalChildren=zs.reduce((n,o)=>n+Number(o.pupils||0)+Number(o.preschoolChildren||0),0)+ms.reduce((n,o)=>n+Number(o.children||0),0);
 shell(`<div class="page-head"><div class="kicker">Školství</div><h1>Mateřské a základní školy Prahy 8</h1><p>Přehled škol zřizovaných MČ Praha 8. U každé školy ukazujeme vedení, web, identifikační údaje a dostupné školské statistiky.</p></div><section class="single-summary"><strong>${zs.length+ms.length}</strong><span>škol, které navštěvuje <b>${fmt(totalChildren)}</b> dětí a žáků</span></section><div class="notice school-source-note"><b>Školní rok 2025/2026.</b> Počty dětí, žáků a tříd jsou vedené ke dni 30. 9. 2025. Kapacitu a naplněnost zobrazujeme jen tam, kde je lze bezpečně získat z oficiálního zdroje; chybějící údaj nevydáváme za nulu.</div><section class="section"><div class="section-head"><div><h2>Základní školy</h2></div></div><div class="school-grid">${zs.map(schoolCard).join('')}</div></section><section class="section"><div class="section-head"><div><h2>Mateřské školy</h2></div></div><div class="school-grid">${ms.map(schoolCard).join('')}</div></section>`)
}
function organizace(){
 const rows=(data.organizace||[]).filter(o=>!['základní škola','mateřská škola'].includes(o.type));
 if(!rows.length){missingDataPage({kicker:'Organizace',title:'Organizace a městské firmy',description:'Ostatní příspěvkové organizace a městské společnosti Prahy 8.',command:'npm run sync:organizations'});return}
 const po=rows.filter(o=>o.legalType==='příspěvková organizace'||o.type==='příspěvková organizace'||o.type==='ostatní příspěvková organizace');
 const companies=rows.filter(o=>o.legalType==='obchodní společnost'||o.type==='městská společnost'||o.type==='městská obchodní společnost');
 const card=(o,company=false)=>{const specialWeb=o.ico==='40764877'?'https://www.mariuspedersen.cz/':o.ico==='24796590'?'https://www.osmaservisni.cz/':o.ico==='00639524'?'https://www.praha8.cz/servisni-stredisko-pro-spravu-svereneho-majetku-mc-praha-8-prispevkova-organizace.html':'';const fallbackWeb=company?(o.ico==='04650522'?'https://www.osms.cz/':o.ico==='04212371'?'https://www.sthpraha8.cz/':o.ico==='24796590'?'https://www.osmaservisni.cz/':o.ico==='40764877'?'https://www.mariuspedersen.cz/':''):'';const web=specialWeb||o.website||fallbackWeb||'';const webLabel=o.ico==='00639524'?'www.praha8.cz':web?web.replace(/^https?:\/\//,'').replace(/\/$/,''):'';const registry=o.registrySource||'https://verejnerejstriky.msp.gov.cz/';return `<article class="org-card"><div class="org-card-head"><div><small>${company?'Městská firma':'Příspěvková organizace'}</small><h3>${escapeHtml(o.name)}</h3>${o.ownershipShare?`<span class="ownership-badge">Podíl MČ Praha 8: ${escapeHtml(o.ownershipShare)}</span>`:''}</div></div>${company?`<a class="org-registry" href="${escapeHtml(registry)}" target="_blank" rel="noreferrer">Otevřít obchodní rejstřík ↗</a>`:''}<div class="school-identity"><span><small>Právní forma</small><span class="identity-value">${escapeHtml(o.legalType||o.type||'—')}</span></span><span><small>IČO</small><span class="identity-value">${escapeHtml(o.ico||'—')}</span></span></div><div class="org-leadership">${company?`<small>Orgány společnosti</small>${orgLeadership(o)}`:`<small>${escapeHtml(o.leaderRole||'Ředitel/ka')}</small><span class="identity-value">${escapeHtml(o.director||'—')}</span>`}</div>${web?`<div class="school-web"><small>Web</small><a href="${escapeHtml(web)}" target="_blank" rel="noreferrer">${escapeHtml(webLabel)} ↗</a></div>`:''}</article>`};
 const totalRows=po.length+companies.length;
 shell(`<div class="page-head"><div class="kicker">Organizace</div><h1>Organizace a městské firmy</h1><p>Ostatní příspěvkové organizace a společnosti ve vlastnictví MČ Praha 8. Mateřské a základní školy mají vlastní přehled.</p></div><section class="single-summary"><strong>${totalRows}</strong><span>organizací a městských firem, které zajišťují veřejné služby a správu majetku MČ Praha 8</span></section>${po.length?`<section class="section org-section"><div class="section-head"><div><h2>Příspěvkové organizace</h2></div></div><div class="org-card-grid">${po.map(o=>card(o)).join('')}</div></section>`:''}${companies.length?`<section class="section org-section"><div class="section-head"><div><h2>Městské firmy</h2></div></div><div class="org-card-grid">${companies.map(o=>card(o,true)).join('')}</div></section>`:''}`)
}

const czkEntity=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:0}).format(Number(n)):'—';
const entityCategory=e=>{const n=String(e.name||'').toLowerCase();if(n.startsWith('mateřská škola'))return 'Mateřské školy';if(n.startsWith('základní škola a mateřská škola'))return 'Základní a mateřské školy';if(n.startsWith('základní škola'))return 'Základní školy';return 'Další organizace'};
const entityTypeLabel=e=>e.kind==='company'?'Městská firma':entityCategory(e).replace(/ školy$/,' škola');
function entityContractHtml(x){return `<article class="item contract-item"><div class="meta">${x.published?fmtDate(x.published):'—'}${x.signed?`<br>uzavřeno ${fmtDate(x.signed)}`:''}</div><div><h3>${escapeHtml(x.subject||'Smlouva')}</h3><div class="contract-meta">${x.counterparty?`<div><small>Protistrana</small><b>${escapeHtml(x.counterparty)}</b></div>`:''}${x.valueCzk!=null?`<div><small>Známá hodnota</small><b>${czkEntity(x.valueCzk)}</b></div>`:''}</div></div><a class="source" href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">Detail ↗</a></article>`}
function entityPartnerRows(rows){return rows.map((p,i)=>`<div class="partner-row"><span class="partner-rank">${i+1}</span><div><b>${escapeHtml(displayPersonName(p.name))}</b>${p.ico?`<small>IČO ${escapeHtml(p.ico)}</small>`:''}</div><div class="partner-numbers"><strong>${czkEntity(p.knownValueCzk)}</strong><small>${p.contracts.toLocaleString('cs-CZ')} smluv · známá hodnota u ${(p.valuedContracts||0).toLocaleString('cs-CZ')}</small></div></div>`).join('')}
function entityOverviewCard(e,base){const last=e.dateTo?fmtDate(e.dateTo):'—';return `<a class="entity-contract-card" href="#/${base}?ico=${encodeURIComponent(e.ico)}"><div class="entity-card-top"><div><small>${escapeHtml(entityTypeLabel(e))}</small><h3>${escapeHtml(e.name)}</h3></div><span class="entity-arrow">→</span></div><code>IČO ${escapeHtml(e.ico)}</code><div class="entity-card-stats"><div><strong>${Number(e.total||0).toLocaleString('cs-CZ')}</strong><span>smluv</span></div><div><strong>${Number(e.partners||0).toLocaleString('cs-CZ')}</strong><span>protistran</span></div><div><strong>${czkEntity(e.knownValueCzk)}</strong><span>známá hodnota</span></div></div><div class="entity-card-foot">Poslední smlouva: ${last}</div></a>`}
async function entityContractsOverview(kind){
 shell(`<div class="page-head"><div class="kicker">Registr smluv</div><h1>Načítám data…</h1></div>`);
 const payload=await ensureEntityContracts();
 if(payload.missing||!Array.isArray(payload.entities)||!payload.entities.length){shell(`<div class="page-head"><div class="kicker">Registr smluv</div><h1>${kind==='company'?'Smlouvy městských firem':'Smlouvy organizací Prahy 8'}</h1><p>Datový pohled je připravený, ale v této verzi ještě není přenesen historický dataset organizací.</p></div><div class="notice"><b>Data nejsou načtena.</b> Čeká se na převzetí ověřeného datasetu. Spusťte <code>npm run sync:contracts:reuse</code>.</div>`);return}
 const all=(payload.entities||[]).filter(e=>e.kind===kind).sort((a,b)=>a.name.localeCompare(b.name,'cs'));
 const isCompany=kind==='company', expected=isCompany?3:37, base=isCompany?'smlouvy-firmy':'smlouvy-organizace';
 const total=all.reduce((n,e)=>n+Number(e.total||0),0), known=all.reduce((n,e)=>n+Number(e.knownValueCzk||0),0);
 const categories=isCompany?[]:[...new Set(all.map(entityCategory))].sort((a,b)=>a.localeCompare(b,'cs'));
 shell(`<div class="page-head"><div class="kicker">Registr smluv</div><h1>${isCompany?'Smlouvy městských firem':'Smlouvy organizací Prahy 8'}</h1><p>${isCompany?'Tři společnosti ve 100% vlastnictví MČ Praha 8.':'Přehled 37 příspěvkových organizací MČ Praha 8 — škol, školek a dalších městských organizací.'} Každý subjekt má vlastní profil a vlastní databázi smluv. IPODEC do tohoto přehledu nezařazujeme.</p></div><section class="entity-overview-stats"><div><small>Subjektů</small><strong>${all.length} / ${expected}</strong><span>ověřených IČO</span></div><div><small>Smluv v databázi</small><strong>${total.toLocaleString('cs-CZ')}</strong><span>publikovaných těmito subjekty</span></div><div><small>Známá hodnota smluv</small><strong>${czkEntity(known)}</strong><span>hodnota neříká směr platby</span></div></section><div class="data-note"><b>Samostatné datasety.</b> Čísla níže nepřičítáme k MČ Praha 8 do jednoho „celkového“ čísla. Každá organizace nebo firma je samostatným publikujícím subjektem Registru smluv.</div><div class="toolbar entity-toolbar"><input id="qentity" placeholder="Hledat organizaci nebo IČO…">${isCompany?'':`<select id="catentity"><option value="">Všechny typy</option>${categories.map(x=>`<option>${escapeHtml(x)}</option>`).join('')}</select>`}<select id="sortentity"><option value="name">Abecedně</option><option value="contracts">Nejvíc smluv</option><option value="value">Nejvyšší známá hodnota</option></select></div><div id="entityCount" class="updated"></div><div id="entityGrid" class="entity-contract-grid"></div>`);
 const draw=()=>{const q=$('#qentity').value.trim().toLowerCase(),cat=$('#catentity')?.value||'',sort=$('#sortentity').value;let rows=all.filter(e=>(!q||`${e.name} ${e.ico}`.toLowerCase().includes(q))&&(!cat||entityCategory(e)===cat));rows=[...rows].sort(sort==='contracts'?(a,b)=>b.total-a.total||a.name.localeCompare(b.name,'cs'):sort==='value'?(a,b)=>b.knownValueCzk-a.knownValueCzk||a.name.localeCompare(b.name,'cs'):(a,b)=>a.name.localeCompare(b.name,'cs'));$('#entityCount').textContent=`Zobrazeno ${rows.length} z ${all.length} subjektů`;$('#entityGrid').innerHTML=rows.map(e=>entityOverviewCard(e,base)).join('')||'<div class="empty">Žádný subjekt neodpovídá filtrům.</div>'};
 $$('#qentity,#catentity,#sortentity').forEach(e=>e?.addEventListener('input',draw));draw();
}
async function entityContractsDetail(kind){
 const payload=await ensureEntityContracts();const q=new URLSearchParams((location.hash.split('?')[1]||''));const ico=q.get('ico')||'';const e=(payload.entities||[]).find(x=>x.kind===kind&&String(x.ico)===ico);
 const base=kind==='company'?'smlouvy-firmy':'smlouvy-organizace';if(!e){await entityContractsOverview(kind);return}
 const contracts=e.contracts||[], partners=e.partnerList||[], years=[...new Set(contracts.map(x=>x.published?.slice(0,4)).filter(Boolean))].sort().reverse(),latest=contracts.slice(0,8);const topValue=partners.slice(0,10),topCount=[...partners].sort((a,b)=>b.contracts-a.contracts||b.knownValueCzk-a.knownValueCzk).slice(0,10);const knownShare=contracts.length?Math.round(Number(e.valuedContracts||0)/contracts.length*100):0;
 shell(`<a class="back-link" href="#/${base}">← ${kind==='company'?'Městské firmy':'Organizace'}</a><div class="page-head entity-detail-head"><div class="kicker">${kind==='company'?'Městská firma':'Organizace Prahy 8'}</div><h1>${escapeHtml(e.name)}</h1><p>IČO ${escapeHtml(e.ico)} · ${escapeHtml(entityTypeLabel(e))}. Přehled smluv, které tento subjekt publikoval v Registru smluv.</p></div><section class="money-dashboard entity-money-dashboard"><div class="money-stat"><small>Smluv celkem</small><strong>${contracts.length.toLocaleString('cs-CZ')}</strong><span>celá načtená historie</span></div><div class="money-stat"><small>Protistran celkem</small><strong>${Number(e.partners||partners.length).toLocaleString('cs-CZ')}</strong><span>unikátních smluvních protistran</span></div><div class="money-stat"><small>Známá hodnota smluv</small><strong>${czkEntity(e.knownValueCzk)}</strong><span>hodnota uvedena u ${knownShare} % smluv</span></div><div class="money-stat"><small>Poslední smlouva</small><strong class="date-stat">${e.dateTo?fmtDate(e.dateTo):'—'}</strong><span>podle data uzavření</span></div></section><div class="data-note">Hodnota smlouvy sama o sobě neurčuje směr platby. Přehled proto pracuje se smluvními vztahy a známými hodnotami, nikoliv s tvrzením, kdo komu skutečně zaplatil.</div>${partners.length?`<section class="section recipient-section"><div class="section-head"><div><div class="kicker">Smluvní vztahy</div><h2>Největší protistrany</h2></div><p>Řazení podle známé hodnoty smluv nebo počtu smluv.</p></div><div class="partner-tabs"><button class="partner-tab active" data-epartner="value">Podle hodnoty smluv</button><button class="partner-tab" data-epartner="count">Podle počtu smluv</button></div><div id="ePartnerRanking" class="partner-ranking">${entityPartnerRows(topValue)}</div></section>`:''}${latest.length?`<section class="section"><div class="section-head"><div><div class="kicker">Aktuálně</div><h2>Poslední smlouvy</h2></div><p>8 nejnovějších zveřejněných záznamů.</p></div><div class="list contract-list">${latest.map(entityContractHtml).join('')}</div></section>`:''}<section class="section"><div class="section-head"><div><div class="kicker">Databáze</div><h2>Všechny smlouvy</h2></div><p>25 záznamů na stránku.</p></div><div class="toolbar contract-toolbar"><input id="qecontract" placeholder="Hledat v předmětu nebo protistraně…"><select id="yecontract"><option value="">Všechny roky</option>${years.map(y=>`<option>${y}</option>`).join('')}</select><select id="secontract"><option value="new">Nejnovější</option><option value="old">Nejstarší</option><option value="value">Nejvyšší známá hodnota</option></select></div><div id="cecontract" class="updated"></div><div id="recontract" class="list contract-list"></div><div id="pecontract" class="pagination"></div></section>`);
 if(partners.length){$$('[data-epartner]').forEach(b=>b.onclick=()=>{$$('[data-epartner]').forEach(x=>x.classList.toggle('active',x===b));$('#ePartnerRanking').innerHTML=entityPartnerRows(b.dataset.epartner==='count'?topCount:topValue)})}
 let page=1,perPage=25;const draw=()=>{const q=$('#qecontract').value.trim().toLowerCase(),y=$('#yecontract').value,sort=$('#secontract').value;let rows=contracts.filter(x=>(!q||`${x.subject||''} ${x.counterparty||''}`.toLowerCase().includes(q))&&(!y||x.published?.startsWith(y)));rows=[...rows].sort(sort==='old'?(a,b)=>(a.published||'').localeCompare(b.published||''):sort==='value'?(a,b)=>(b.valueCzk??-1)-(a.valueCzk??-1):(a,b)=>(b.published||'').localeCompare(a.published||''));const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.min(page,pages);const shown=rows.slice((page-1)*perPage,page*perPage);$('#cecontract').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} smluv · stránka ${page} z ${pages}`;$('#recontract').innerHTML=shown.map(entityContractHtml).join('')||'<div class="empty">Žádné smlouvy neodpovídají filtrům.</div>';const nums=[];for(let i=Math.max(1,page-2);i<=Math.min(pages,page+2);i++)nums.push(i);$('#pecontract').innerHTML=`<button ${page===1?'disabled':''} data-page="${page-1}">← Předchozí</button>${page>3?'<span>…</span>':''}${nums.map(i=>`<button class="${i===page?'active':''}" data-page="${i}">${i}</button>`).join('')}${page<pages-2?'<span>…</span>':''}<button ${page===pages?'disabled':''} data-page="${page+1}">Další →</button>`;$$('#pecontract button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();$('#cecontract').scrollIntoView({behavior:'smooth',block:'center'})})};$$('#qecontract,#yecontract,#secontract').forEach(x=>x.addEventListener('input',()=>{page=1;draw()}));draw();
}
async function smlouvyOrganizace(){const q=new URLSearchParams((location.hash.split('?')[1]||''));return q.get('ico')?entityContractsDetail('organization'):entityContractsOverview('organization')}
async function smlouvyFirmy(){const q=new URLSearchParams((location.hash.split('?')[1]||''));return q.get('ico')?entityContractsDetail('company'):entityContractsOverview('company')}

function info106(){
 if(!sourceComplete('info106')){missingDataPage({kicker:'Transparentnost',title:'Informace podle zákona č. 106/1999 Sb.',description:'Zveřejněné žádosti a poskytnuté informace podle zákona o svobodném přístupu k informacím.',command:'npm run sync:106'});return}
 const years=[...new Set((data.info106||[]).map(x=>x.year))].sort((a,b)=>b-a);
 shell(`<div class="page-head"><div class="kicker">Transparentnost</div><h1>Informace podle zákona č. 106/1999 Sb.</h1><p>Zveřejněné žádosti a poskytnuté informace podle zákona o svobodném přístupu k informacím. Praha 8 publikuje přehledy po jednotlivých letech.</p></div><section class="stats compact-stats"><div class="stat"><strong>${data.info106.length.toLocaleString('cs-CZ')}</strong><span>zveřejněných žádostí</span></div><div class="stat"><strong>${years.length}</strong><span>ročníků v přehledu</span></div><div class="stat"><strong>${years[0]||'—'}</strong><span>nejnovější ročník</span></div></section><div class="toolbar"><input id="q106" placeholder="Hledat v žádostech…"><select id="year106"><option value="">Všechny roky</option>${years.map(y=>`<option>${y}</option>`).join('')}</select></div><div id="count106" class="updated"></div><div id="rows106" class="list"></div>`);
 const draw=()=>{const q=$('#q106').value.toLowerCase(),y=$('#year106').value;const rows=data.info106.filter(x=>(!q||x.title.toLowerCase().includes(q))&&(!y||String(x.year)===y));$('#count106').textContent=`Zobrazeno ${rows.length.toLocaleString('cs-CZ')} žádostí`;$('#rows106').innerHTML=rows.map(x=>`<article class="item"><div class="meta">${x.date?fmtDate(x.date):x.year}</div><div><h3>${escapeHtml(x.title)}</h3></div><a class="source" href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">Odpověď ↗</a></article>`).join('')||'<div class="empty">Žádné záznamy.</div>'}; $$('#q106,#year106').forEach(e=>e.addEventListener('input',draw));draw();
}
function uredniDeska(){
 if(!sourceComplete('noticeboard')){missingDataPage({kicker:'Úřad',title:'Úřední deska',description:'Aktuálně zveřejněné dokumenty a oznámení elektronické úřední desky MČ Praha 8.',command:'npm run sync:noticeboard'});return}
 const areas=[...new Set((data.uredniDeska||[]).map(x=>x.area).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'cs'));
 shell(`<div class="page-head"><div class="kicker">Úřad</div><h1>Úřední deska</h1><p>Aktuálně zveřejněné dokumenty a oznámení elektronické úřední desky MČ Praha 8.</p></div><section class="stats compact-stats"><div class="stat"><strong>${data.uredniDeska.length}</strong><span>aktuálně načtených položek</span></div><div class="stat"><strong>${areas.length}</strong><span>oblastí</span></div></section><div class="toolbar"><input id="qboard" placeholder="Hledat na úřední desce…"><select id="areaboard"><option value="">Všechny oblasti</option>${areas.map(a=>`<option>${escapeHtml(a)}</option>`).join('')}</select></div><div id="countboard" class="updated"></div><div id="rowsboard" class="list"></div><div id="pagerBoard" class="pagination"></div>`);
 let page=1;const perPage=25;const draw=()=>{const q=$('#qboard').value.toLowerCase(),a=$('#areaboard').value;const rows=data.uredniDeska.filter(x=>(!q||(x.title+' '+x.area).toLowerCase().includes(q))&&(!a||x.area===a));const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.min(page,pages);const shown=rows.slice((page-1)*perPage,page*perPage);$('#countboard').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} položek · stránka ${page} z ${pages}`;$('#rowsboard').innerHTML=shown.map(x=>`<article class="item"><div class="meta">${x.from?fmtDate(x.from):'—'} – ${x.to?fmtDate(x.to):'—'}<br>${escapeHtml(x.area||'')}</div><div><h3>${escapeHtml(x.title)}</h3></div><a class="source" href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">Detail ↗</a></article>`).join('')||'<div class="empty">Žádné záznamy.</div>';$('#pagerBoard').innerHTML=pagerMarkup(page,pages);$$('#pagerBoard button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();$('#countboard').scrollIntoView({behavior:'smooth',block:'center'})})};$$('#qboard,#areaboard').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));draw();
}

function volby(){
 if(!sourceComplete('elections')){missingDataPage({kicker:'Demokracie',title:'Volby',description:'Výsledky voleb do Zastupitelstva MČ Praha 8 podle dat Českého statistického úřadu.',command:'npm run sync:elections'});return}
 const years=data.volby?.years||[]; const longest=data.volby?.longest||[];
 shell(`<div class="page-head"><div class="kicker">Demokracie</div><h1>Volby</h1><p>Výsledky voleb do Zastupitelstva MČ Praha 8 podle dat Českého statistického úřadu. U každého období ukazujeme pořadí kandidujících subjektů, rozdělení mandátů i následné vedení radnice.</p></div>${years.length?years.map(y=>{const ranked=[...(y.parties||[])].sort((a,b)=>Number(b.percent||0)-Number(a.percent||0)||Number(b.seats||0)-Number(a.seats||0)||a.name.localeCompare(b.name,'cs')).map((p,i)=>({...p,rank:i+1}));const winners=ranked.filter(p=>Number(p.seats)>0);const others=ranked.filter(p=>Number(p.seats)===0);const coalition=y.coalition&&Array.isArray(y.coalition.members)&&y.coalition.members.length?`<div class="election-coalition"><small>Vedení radnice po volbách</small><div class="coalition-pills">${y.coalition.members.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div>${y.coalition.note?`<p>${escapeHtml(y.coalition.note)}</p>`:''}</div>`:'';return `<section class="section election-year"><div class="section-head"><div><div class="kicker">Komunální volby</div><h2>${y.year}</h2></div><p>${y.turnout?`Volební účast ${escapeHtml(y.turnout)} % · `:''}${y.seats||45} mandátů</p></div>${winners.length?`<div class="mandate-grid">${winners.map(p=>`<div class="mandate-row"><span class="election-rank">${p.rank}.</span><div><b>${escapeHtml(displayPersonName(p.name))}</b>${p.percent?`<small>${escapeHtml(p.percent)} % hlasů</small>`:''}</div><strong>${p.seats}</strong></div>`).join('')}</div>`:`<div class="notice">${escapeHtml(y.note||'Rozdělení mandátů pro tento historický rok zatím není ve strojově zpracovatelném zdroji.')}</div>`}${coalition}${others.length?`<div class="no-mandate"><small>Bez mandátu</small><div>${others.map(p=>`<span><b>${p.rank}.</b> ${escapeHtml(p.name)}${p.percent?` · ${escapeHtml(p.percent)} %`:''}</span>`).join('')}</div></div>`:''}${y.source?`<a class="source-inline" href="${escapeHtml(y.source)}" target="_blank" rel="noreferrer">Výsledky na volby.cz ↗</a>`:''}</section>`}).join(''):'<div class="notice">Volební data se načtou příkazem <code>npm run sync:elections</code>.</div>'}${longest.length?`<section class="section"><div class="section-head"><div><div class="kicker">Historie zastupitelstva</div><h2>Nejdéle působící</h2></div><p>TOP 10 současných zastupitelů a zastupitelek podle počtu volebních období, ve kterých byli zvoleni do Zastupitelstva MČ Praha 8.</p></div><div class="ranking">${longest.slice(0,10).map((p,i)=>`<div class="rank-row"><span>${i+1}</span><div class="rank-person"><b>${escapeHtml(displayPersonName(p.name))}</b>${((p.parties&&p.parties.length)?p.parties:(p.party?[p.party]:[])).map(x=>`<span class="rank-party-pill">${escapeHtml(x)}</span>`).join('')}</div><small>${p.terms} období · ${escapeHtml((p.years||[]).join(', '))}</small></div>`).join('')}</div></section>`:''}`)
}

function censusBarList(items,total=null){if(!items?.length)return '';const max=Math.max(...items.map(x=>Number(x.value)||0),1);return `<div class="census-bars">${items.map(x=>`<div class="census-bar-row"><div><b>${escapeHtml(x.label)}</b><span>${fmt(x.value)}${total?` · ${Math.round(x.value/total*100)} %`:''}</span></div><div class="census-bar-track"><i style="width:${Math.max(2,Math.round(x.value/max*100))}%"></i></div></div>`).join('')}</div>`}
function scitani2021(){
 const c=data.scitani2021;
 if(!c){missingDataPage({kicker:'ČSÚ',title:'Sčítání 2021',description:'Vybrané výsledky Sčítání lidu, domů a bytů 2021 pro MČ Praha 8.',command:'npm run sync:census'});return}
 const ages=c.population.ageGroups||[],age5=c.population.age5||[];
 const topicCard=(content,extra='')=>`<div class="census-topic-card ${extra}">${content}</div>`;
 shell(`<div class="page-head"><div class="kicker">ČSÚ · Sčítání 2021</div><h1>Praha 8 podle Sčítání 2021</h1><p>Vybrané údaje o obyvatelích, bydlení, vzdělání, ekonomické aktivitě, domácnostech a dojíždění.</p></div>
 <section class="money-dashboard census-dashboard"><div class="money-stat"><small>Obyvatel</small><strong>${fmt(c.population.total)}</strong><span>obvyklý pobyt</span></div><div class="money-stat"><small>Domácností</small><strong>${fmt(c.households?.total||0)}</strong><span>${fmt(c.households?.single||0)} jednočlenných</span></div><div class="money-stat"><small>Domů</small><strong>${fmt(c.housing.housesTotal)}</strong><span>${fmt(c.housing.housesOccupied)} obvykle obydlených</span></div><div class="money-stat"><small>Bytů</small><strong>${fmt(c.housing.flatsTotal)}</strong><span>${fmt(c.housing.flatsOccupied)} obvykle obydlených</span></div></section>
 <div class="data-note census-method"><b>Metodika:</b> počet obyvatel ve Sčítání 2021 vychází z obvyklého pobytu, nikoli pouze z trvalého pobytu. Zdroj: Český statistický úřad, Sčítání 2021.</div>
 <section class="section"><div class="section-head"><div><div class="kicker">1 · Obyvatelstvo</div><h2>Věk a pohlaví</h2></div><p>Praha 8 měla při sčítání ${fmt(c.population.men)} mužů a ${fmt(c.population.women)} žen. Podrobněji ukazujeme pětileté věkové skupiny.</p></div><div class="grid2 census-split census-age-grid">${topicCard(`<h3>Základní věkové skupiny</h3>${censusBarList(ages,c.population.total)}`)}${topicCard(`<h3>Pětileté věkové skupiny</h3>${censusBarList(age5,c.population.total)}`)}</div></section>
 <section class="section"><div class="section-head"><div><div class="kicker">2 · Bydlení</div><h2>Domy a byty</h2></div><p>Základní struktura domovního a bytového fondu.</p></div><div class="grid2 census-housing-grid"><div class="card"><h3>Domy</h3><div class="census-kpi-list"><span><b>${fmt(c.housing.familyHousesOccupied)}</b> obydlených rodinných domů</span><span><b>${fmt(c.housing.apartmentHousesOccupied)}</b> obydlených bytových domů</span><span><b>${fmt(c.housing.otherBuildingsOccupied)}</b> ostatních obydlených budov</span></div></div><div class="card"><h3>Byty</h3><div class="census-kpi-list"><span><b>${fmt(c.housing.flatsOccupied)}</b> obvykle obydlených bytů</span><span><b>${fmt(c.housing.flatsUnoccupied)}</b> obvykle neobydlených bytů</span><span><b>${Math.round(c.housing.flatsOccupied/c.housing.flatsTotal*100)} %</b> bytů je obvykle obydlených</span></div></div></div></section>
 <section class="section"><div class="section-head"><div><div class="kicker">3 · Vzdělání</div><h2>Nejvyšší dosažené vzdělání</h2></div><p>Obyvatelé ve věku 15 a více let. U části obyvatel nebylo vzdělání zjištěno.</p></div>${topicCard(censusBarList(c.education?.groups,c.education?.population15plus),'census-wide-card')}</section>
 <section class="section"><div class="section-head"><div><div class="kicker">4 · Práce a studium</div><h2>Ekonomická aktivita</h2></div><p>${fmt(c.economicActivity?.labourForce||0)} lidí tvořilo pracovní sílu; ${fmt(c.economicActivity?.outsideLabourForce||0)} bylo mimo pracovní sílu.</p></div>${topicCard(censusBarList(c.economicActivity?.groups,c.population.total),'census-wide-card')}</section>
 <section class="section"><div class="section-head"><div><div class="kicker">5 · Domácnosti</div><h2>Jak velké jsou domácnosti?</h2></div><p>Celkem ${fmt(c.households?.total||0)} hospodařících domácností. ${fmt(c.households?.single||0)} z nich tvořil jeden člověk a ${fmt(c.households?.family||0)} byly rodinné domácnosti.</p></div>${topicCard(censusBarList(c.households?.sizes,c.households?.total),'census-wide-card')}</section>
 <section class="section"><div class="section-head"><div><div class="kicker">6 · Dojíždění</div><h2>Jak lidé cestují<br>do práce a do školy?</h2></div><p>Hlavní dopravní prostředek u vyjíždějících zaměstnaných, žáků a studentů. Údaj je založen na odpovědích ve Sčítání 2021.</p></div>${topicCard(censusBarList(c.commuting?.modes,c.commuting?.total),'census-wide-card')}</section>`)
}
function smlouvy(){
 const contracts=data.smlouvy?.contracts||[],partners=data.smlouvy?.partners||[],meta=data.smlouvy?.meta||{};
 const czk=n=>Number.isFinite(Number(n))?new Intl.NumberFormat('cs-CZ',{style:'currency',currency:'CZK',maximumFractionDigits:0}).format(Number(n)):'—';
 const years=[...new Set(contracts.map(x=>x.published?.slice(0,4)).filter(Boolean))].sort().reverse();
 const latest=contracts.slice(0,8),topValue=partners.slice(0,10),topCount=[...partners].sort((a,b)=>b.contracts-a.contracts||b.knownValueCzk-a.knownValueCzk).slice(0,10);
 const latestDate=contracts.map(x=>x.signed||x.published).filter(Boolean).sort().at(-1)||meta.dateTo||'';
 const cutoff=latestDate?new Date(`${latestDate}T00:00:00`):null;if(cutoff)cutoff.setFullYear(cutoff.getFullYear()-1);
 const activeKeys=new Set();if(cutoff)for(const c of contracts){const d=c.signed||c.published;if(d&&new Date(`${d}T00:00:00`)>=cutoff)for(const p of c.counterparties||[])activeKeys.add(p.ico||String(p.name||'').toLowerCase())}
 const activePartners=activeKeys.size;
 const knownShare=contracts.length?Math.round((meta.valuedContracts||contracts.filter(x=>x.valueCzk!=null).length)/contracts.length*100):0;
 const sample=meta.historyComplete===false||meta.scope==='development-sample';
 const validation=meta.validation||{};
 const refCount=validation.referencePublicSearchCount;
 const delta=validation.differenceFromReference;
 const contractHtml=x=>`<article class="item contract-item"><div class="meta">${x.published?fmtDate(x.published):'—'}${x.signed?`<br>uzavřeno ${fmtDate(x.signed)}`:''}</div><div><h3>${escapeHtml(x.subject||'Smlouva')}</h3><div class="contract-meta">${x.counterparty?`<div><small>Protistrana</small><b>${escapeHtml(x.counterparty)}</b></div>`:''}${x.valueCzk!=null?`<div><small>Hodnota</small><b>${czk(x.valueCzk)}</b></div>`:''}</div></div><a class="source" href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">Detail ↗</a></article>`;
 const partnerRows=rows=>rows.map((p,i)=>`<div class="partner-row"><span class="partner-rank">${i+1}</span><div><b>${escapeHtml(displayPersonName(p.name))}</b>${p.ico?`<small>IČO ${escapeHtml(p.ico)}</small>`:''}</div><div class="partner-numbers"><strong>${czk(p.knownValueCzk)}</strong><small>${p.contracts} ${p.contracts===1?'smlouva':p.contracts<5?'smlouvy':'smluv'} · známá hodnota u ${p.valuedContracts||0}</small></div></div>`).join('');
 shell(`<div class="page-head"><div class="kicker">Veřejné finance</div><h1>Kam tečou peníze Prahy 8</h1><p>Přehled smluv, jejich hodnot a protistran Městské části Praha 8. ${sample?`Teď ladíme na vývojovém vzorku <strong>${escapeHtml(meta.dateLabel||'červen–červenec 2026')}</strong>; po ověření rozšíříme stejný pohled na celou historii.`:'Data pokrývají celou načtenou historii.'}</p></div>
 <section class="money-dashboard">
  <div class="money-stat"><small>Známá hodnota smluv</small><strong>${czk(meta.knownValueCzk)}</strong><span>${sample?'ve vývojovém vzorku':'za celé období'} · hodnota je uvedena u ${knownShare} % smluv</span></div>
  <div class="money-stat"><small>Protistran celkem</small><strong>${(meta.partners||partners.length).toLocaleString('cs-CZ')}</strong><span>${sample?'v načteném vzorku':'unikátních smluvních protistran'}</span></div>
  <div class="money-stat"><small>Aktivních protistran</small><strong>${activePartners.toLocaleString('cs-CZ')}${sample?'*':''}</strong><span>smlouva v posledních 12 měsících${sample?' · zatím jen z dostupných dat':''}</span></div>
  <a class="money-stat kindex-card" href="https://www.hlidacstatu.cz/kindex/detail/00063797?rok=2025" target="_blank" rel="noreferrer"><small>K-index Hlídače státu · 2025</small><div class="kindex-value"><strong>B</strong><b>3,55</b></div><span>malá míra rizikových faktorů · detail ↗</span></a>
 </section>
 ${sample?`<div class="data-note"><b>Vývojový režim.</b> Načteno <strong>${contracts.length.toLocaleString('cs-CZ')} smluv</strong> z open dat pro období ${escapeHtml(meta.dateLabel||'červen–červenec 2026')}.${validation.status==='provisional'&&refCount?` Ve veřejném vyhledávání Registru smluv je při stejných kritériích ${Number(refCount).toLocaleString('cs-CZ')} záznamů; rozdíl ${Math.abs(Number(delta||0))} zatím vedeme jako otevřenou QA kontrolu.`:''} Hvězdička u aktivních protistran připomíná, že zatím nemáme načtených celých 12 měsíců.</div>`:''}
 ${partners.length?`<section class="section recipient-section"><div class="section-head"><div><div class="kicker">Smluvní vztahy</div><h2>Největší smluvní vztahy MČ Praha 8</h2></div><p>Protistrany seřazené podle známé hodnoty smluv. <strong>Nejde o žebříček příjemců peněz:</strong> Registr smluv neurčuje směr platby a u některých smluv mohou peníze naopak přicházet městské části.</p></div><div class="partner-tabs"><button class="partner-tab active" data-partner="value">Podle hodnoty smluv</button><button class="partner-tab" data-partner="count">Podle počtu smluv</button></div><div id="partnerRanking" class="partner-ranking">${partnerRows(topValue)}</div></section>`:''}
 ${latest.length?`<section class="section"><div class="section-head"><div><div class="kicker">Aktuálně</div><h2>Poslední smlouvy</h2></div><p>8 nejnovějších zveřejněných záznamů.</p></div><div class="list contract-list">${latest.map(contractHtml).join('')}</div></section>`:''}
 <section class="section"><div class="section-head"><div><div class="kicker">Databáze</div><h2>Všechny smlouvy</h2></div><p>25 záznamů na stránku.</p></div><div class="toolbar contract-toolbar"><input id="qcontract" placeholder="Hledat v předmětu nebo protistraně…"><select id="yearcontract"><option value="">Všechny roky</option>${years.map(y=>`<option>${y}</option>`).join('')}</select><select id="sortcontract"><option value="new">Nejnovější</option><option value="old">Nejstarší</option><option value="value">Nejvyšší známá hodnota</option></select></div><div id="countcontract" class="updated"></div><div id="rowscontract" class="list contract-list"></div><div id="pagercontract" class="pagination"></div></section>`);
 if(partners.length){$$('.partner-tab').forEach(b=>b.onclick=()=>{$$('.partner-tab').forEach(x=>x.classList.toggle('active',x===b));$('#partnerRanking').innerHTML=partnerRows(b.dataset.partner==='count'?topCount:topValue)})}
 let page=1;const perPage=25;
 const draw=()=>{const q=$('#qcontract').value.trim().toLowerCase(),y=$('#yearcontract').value,sort=$('#sortcontract').value;let rows=contracts.filter(x=>(!q||`${x.subject||''} ${x.counterparty||''} ${(x.counterparties||[]).map(p=>p.ico||'').join(' ')}`.toLowerCase().includes(q))&&(!y||x.published?.startsWith(y)));rows=[...rows].sort(sort==='old'?(a,b)=>(a.published||'').localeCompare(b.published||''):sort==='value'?(a,b)=>(b.valueCzk??-1)-(a.valueCzk??-1):(a,b)=>(b.published||'').localeCompare(a.published||''));const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.min(page,pages);const shown=rows.slice((page-1)*perPage,page*perPage);$('#countcontract').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} smluv · stránka ${page} z ${pages}`;$('#rowscontract').innerHTML=shown.map(contractHtml).join('')||'<div class="empty">Žádné smlouvy neodpovídají filtrům.</div>';const nums=[];for(let i=Math.max(1,page-2);i<=Math.min(pages,page+2);i++)nums.push(i);$('#pagercontract').innerHTML=`<button ${page===1?'disabled':''} data-page="${page-1}">← Předchozí</button>${page>3?'<span>…</span>':''}${nums.map(i=>`<button class="${i===page?'active':''}" data-page="${i}">${i}</button>`).join('')}${page<pages-2?'<span>…</span>':''}<button ${page===pages?'disabled':''} data-page="${page+1}">Další →</button>`;$$('#pagercontract button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();document.querySelector('#countcontract').scrollIntoView({behavior:'smooth',block:'center'})})};
 $$('#qcontract,#yearcontract,#sortcontract').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));draw();
}

function novinky(){
 const all=Array.isArray(data.novinky)?data.novinky:[];
 if(!all.length){shell(`<div class="page-head"><div class="kicker">Praha 8</div><h1>Novinky z městské části</h1><p>Aktuality z oficiálních RSS kanálů městské části Praha 8.</p></div><div class="notice missing-data-notice"><b>Data nejsou načtena.</b> Novinky čekají na synchronizaci. Pro načtení spusťte <code>npm run sync:news</code>.</div>`);return}
 const channels=[...new Set(all.map(x=>x.channel).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'cs'));
 shell(`<div class="page-head"><div class="kicker">Praha 8</div><h1>Novinky z městské části</h1><p>Společný přehled aktualit z oficiálních RSS kanálů městské části Praha 8.</p></div><div class="notice news-window-notice"><b>Zobrazujeme novinky z posledních 7 dní.</b> Starší zprávy najdete na <a href="https://www.praha8.cz/" target="_blank" rel="noreferrer">webu MČ Praha 8 ↗</a>.</div><div class="toolbar news-toolbar"><input id="qnews" placeholder="Hledat v novinkách…"><select id="channelnews"><option value="">Všechny rubriky</option>${channels.map(c=>`<option>${escapeHtml(c)}</option>`).join('')}</select></div><div id="countnews" class="updated"></div><div id="rowsnews" class="news-list news-list-linear"></div><div id="pagernews" class="pagination"></div>`);
 let page=1;const perPage=25;
 const draw=()=>{const q=$('#qnews').value.trim().toLowerCase(),c=$('#channelnews').value;let rows=all.filter(x=>(!q||`${x.title||''} ${x.description||''} ${x.channel||''}`.toLowerCase().includes(q))&&(!c||x.channel===c));rows=[...rows].sort((a,b)=>(b.date||'').localeCompare(a.date||'')||(b.title||'').localeCompare(a.title||'','cs'));const pages=Math.max(1,Math.ceil(rows.length/perPage));page=Math.min(page,pages);const shown=rows.slice((page-1)*perPage,page*perPage);$('#countnews').textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} novinek · stránka ${page} z ${pages}`;$('#rowsnews').innerHTML=shown.map(x=>`<article class="news-card news-row"><div class="news-meta"><small>${x.date?fmtDate(x.date):''}</small>${x.channel?`<span>${escapeHtml(x.channel)}</span>`:''}</div><div><h3>${escapeHtml(x.title)}</h3>${x.description?`<p>${escapeHtml(x.description)}</p>`:''}</div><a href="${escapeHtml(x.url)}" target="_blank" rel="noreferrer">Přečíst na praha8.cz ↗</a></article>`).join('')||'<div class="empty">Žádné novinky neodpovídají filtrům.</div>';$('#pagernews').innerHTML=pagerMarkup(page,pages);$$('#pagernews button[data-page]').forEach(b=>b.onclick=()=>{page=Number(b.dataset.page);draw();$('#countnews').scrollIntoView({behavior:'smooth',block:'center'})})};$$('#qnews,#channelnews').forEach(e=>e.addEventListener('input',()=>{page=1;draw()}));draw();
}

async function zdroje(){
 await ensureEntityContracts();
 const st=data.sourceStatus||{};
 const cv=data.smlouvy?.meta?.validation||{};
 const sourceCount=(key)=>Number((st[key]||{}).count||0);
 const items=[
  {group:'MČ Praha 8',key:'people',label:'Zastupitelstvo a politické kluby',count:sourceCount('people')},
  {group:'MČ Praha 8',key:'news',label:'Novinky – Aktuality z městské části',count:Array.isArray(data.novinky)?data.novinky.length:0},
  {group:'MČ Praha 8',key:'voting',label:'Hlasování',count:sourceCount('voting')},
  {group:'MČ Praha 8',key:'organizations',label:'Organizace',count:(data.organizace||[]).length,forceLoaded:Array.isArray(data.organizace)&&data.organizace.length>0},
  {group:'MČ Praha 8',key:'schoolOpenData',label:'Školská otevřená data',count:(data.organizace||[]).some(o=>o.statsAsOf)?2:0,countLabel:'2 datové sady',forceLoaded:(data.organizace||[]).some(o=>o.statsAsOf)},
  {group:'MČ Praha 8',key:'budgetOpenData',label:'Rozpočet',count:2,countLabel:'2 datové sady',forceLoaded:!!data.budget2026},
  {group:'MČ Praha 8',key:'p8Companies',label:'Firmy',count:sourceCount('p8Companies')},
  {group:'MČ Praha 8',key:'resolutions',label:'Usnesení Rady a Zastupitelstva',count:sourceCount('resolutions')},
  {group:'MČ Praha 8',key:'bodies',label:'Komise, výbory a zvláštní orgány',count:sourceCount('bodies')},
  {group:'MČ Praha 8',key:'info106',label:'Informace podle zákona č. 106/1999 Sb.',count:sourceCount('info106')},
  {group:'MČ Praha 8',key:'noticeboard',label:'Úřední deska',count:sourceCount('noticeboard')},
  {group:'Hlavní město Praha',key:'hmpFunctions',label:'Zastupitelstvo, výbory, komise',count:sourceCount('hmpFunctions')},
  {group:'Hlavní město Praha',key:'hmpCompanies',label:'Firmy',count:sourceCount('hmpCompanies')},
  {group:'Parlament ČR',key:'nationalRoles',label:'Poslanci a senátoři',count:sourceCount('nationalRoles')},
  {group:'Registr smluv',key:'contracts',label:'Smlouvy MČ Praha 8',count:(data.smlouvy?.meta?.total||data.smlouvy?.contracts?.length||sourceCount('contracts')),forceLoaded:(data.smlouvy?.meta?.total||data.smlouvy?.contracts?.length||0)>0},
  {group:'Registr smluv',key:'contractEntities',label:'Smlouvy příspěvkových organizací a firem MČ Praha 8',count:Number(data.smlouvySubjekty?.meta?.totalOtherContracts||7303),forceLoaded:!data.smlouvySubjekty?.missing&&Array.isArray(data.smlouvySubjekty?.entities)&&data.smlouvySubjekty.entities.length>0},
  {group:'ČSÚ',key:'census2021',label:'Sčítání lidu, domů a bytů 2021',count:data.scitani2021?.datasets?.length||0,countLabel:`${data.scitani2021?.datasets?.length||0} datových sad`,forceLoaded:!!data.scitani2021},
  {group:'ČSÚ',key:'elections',label:'Volby',count:sourceCount('elections')}
 ].sort((a,b)=>a.group.localeCompare(b.group,'cs')||a.label.localeCompare(b.label,'cs'));
 const itemStatus=(item)=>{
   const x=st[item.key]||{};
   const ok=item.forceLoaded||(x.status==='data načtena'&&x.mode==='aktualizováno');
   const partial=Number(item.count)>0&&!ok;
   let status=ok?'data načtena':'čeká na naplnění';
   let tone=ok?'ok':'pending';
   let qa='';
   if(item.key==='contracts'&&ok){
     if(cv.status==='verified'){status='data načtena';tone='ok'}
     else if(cv.status==='provisional'){
       status='data částečně načtena';tone='review';
       qa=`QA ${Number(item.count)}/${Number(cv.referencePublicSearchCount||0)}`;
     }
   }
   const updated=x.updated?new Intl.DateTimeFormat('cs-CZ',{dateStyle:'medium',timeStyle:'short'}).format(new Date(x.updated)):(data.meta.updated?fmtDate(data.meta.updated):'neuvedeno');
   return {status,tone,updated,ok,qa};
 };
 const groupNames=[...new Set(items.map(x=>x.group))].sort((a,b)=>a.localeCompare(b,'cs'));
 const grouped=groupNames.map(group=>{
  const rows=items.filter(x=>x.group===group).sort((a,b)=>a.label.localeCompare(b.label,'cs'));
  const cards=rows.map(item=>{
    const ss=itemStatus(item);
    return `<div class="status-card"><div class="status-card-main"><div class="status-card-title">${escapeHtml(item.label)}</div><div class="status-card-meta">Poslední aktualizace ${escapeHtml(ss.updated)}</div></div><div class="status-card-number${item.countLabel?' status-card-number-text':''}">${ss.ok?(item.countLabel?escapeHtml(item.countLabel):Number(item.count).toLocaleString('cs-CZ')):'—'}</div><div class="status-card-state"><span class="data-status ${ss.tone}">${escapeHtml(ss.status)}</span>${ss.qa?`<span class="data-qa">${escapeHtml(ss.qa)}</span>`:''}</div></div>`;
  }).join('');
  const groupNote='';
  return `<section class="status-group"><div class="status-group-head"><div><div class="kicker">Datové zdroje</div><h3>${escapeHtml(group)}</h3></div></div><div class="status-card-list">${cards}</div>${groupNote}</section>`;
 }).join('');
 const group=(title,note,boxes)=>`<section class="source-group"><div class="source-group-head"><div><div class="kicker">Primární zdroj</div><h2>${title}</h2></div>${note?`<p>${note}</p>`:''}</div><div class="source-grid">${boxes.sort((a,b)=>a.title.localeCompare(b.title,'cs')).map(x=>x.html).join('')}</div></section>`;
 const box=(title,text,url='')=>({title,html:`<div class="sourcebox"><h3>${title}</h3><p>${text}</p>${url?`<code>${url}</code>`:''}</div>`});
 const groups=[
  {title:'MČ Praha 8',html:group('MČ Praha 8','Data, která vznikají nebo jsou primárně publikována městskou částí. ARES či obchodní rejstřík používáme jen jako doplňkové ověření.',[
   box('Usnesení Rady a Zastupitelstva','Oficiální databáze usnesení MČ Praha 8.','https://www.praha8.cz/app/usn'),
   box('Hlasování','Přehledy z elektronického hlasovacího systému publikované Prahou 8.','https://www.praha8.cz/Prehledy-hlasovani.html'),
   box('Zastupitelstvo a politické kluby','Oficiální seznam zastupitelstva, funkcí, gescí radních a politických klubů. Gesce se obnovují pouze v rámci tohoto zdroje.','https://www.praha8.cz/Zastupitelstvo-mestske-casti-Praha-8.html'),
   box('Komise, výbory a zvláštní orgány','Oficiální složení orgánů městské části; členství propisujeme i do profilů zastupitelů.','https://www.praha8.cz'),
   box('Informace podle zákona č. 106/1999 Sb.','Zveřejněné žádosti a odpovědi podle zákona o svobodném přístupu k informacím.'),
   box('Úřední deska','Elektronická úřední deska MČ Praha 8.','https://www.praha8.cz/deska'),
   box('Novinky','Oficiální tematické RSS kanály MČ Praha 8; zobrazujeme sloučený a deduplikovaný přehled za posledních 7 dní.','https://www.praha8.cz/RSS-1'),
   box('Organizace','Školy, příspěvkové organizace a další organizace MČ Praha 8; identifikační údaje můžeme doplňkově ověřovat přes ARES.'),
   box('Školská otevřená data','Počty tříd a žáků základních škol a počty dětí v mateřských školách. Praha 8 deklaruje také dataset školských kapacit; kapacitu zobrazujeme pouze tam, kde je dostupná a bezpečně přiřaditelná ke konkrétní škole.','https://www.praha8.cz/otevrena-data'),
   box('Rozpočet','Schválený rozpočet MČ Praha 8 pro rok 2026. Zobrazujeme základní strukturu příjmů a výdajů; detailnější průběžné plnění doplníme po připojení Prahy 8 k systému Cityvizor.','https://www.praha8.cz/Rozpocet-mestske-casti-Praha-8-pro-rok-2026.html'),
   box('Firmy','Obchodní společnosti MČ Praha 8 a společnosti s majetkovou účastí městské části; rejstříkové údaje používáme jako doplňkový zdroj.')
  ])},
  {title:'Hlavní město Praha',html:group('Hlavní město Praha','Data o funkcích lidí z Prahy 8 na úrovni hlavního města. Tyto role se obnovují pouze při spuštění příslušného zdroje.',[
   box('Zastupitelstvo, výbory, komise','Funkce v Radě a Zastupitelstvu hl. m. Prahy a členství ve výborech a komisích.','https://praha.eu'),
   box('Firmy','Funkce v představenstvech, dozorčích a správních radách společností hl. m. Prahy.','https://praha.eu')
  ])},
  {title:'Registr smluv',html:group('Registr smluv','Samostatný státní zdroj smluvních vztahů.',[
   box('Smlouvy MČ Praha 8','Smlouvy publikované MČ Praha 8 načítáme z oficiálních měsíčních XML open dat Registru smluv. U celé historie kontrolujeme, že byly úspěšně zpracovány všechny dostupné dumpy. Hodnota smlouvy sama o sobě neurčuje směr skutečné platby.','https://data.smlouvy.gov.cz/index.xml'),
   box('Smlouvy příspěvkových organizací a firem MČ Praha 8','Samostatně načítáme smlouvy 37 příspěvkových organizací a tří městských firem. Každý subjekt vedeme odděleně podle IČO a nepřičítáme jej k MČ Praha 8 do jednoho souhrnného čísla.','https://data.smlouvy.gov.cz/index.xml')
  ])},
  {title:'ČSÚ',html:group('ČSÚ','Oficiální statistická a volební data Českého statistického úřadu.',[
   box('Sčítání lidu, domů a bytů 2021','Vybrané výsledky za MČ Praha 8: obyvatelstvo, věk, vzdělání, ekonomická aktivita, domácnosti, dojíždění, domy a byty.','https://csu.gov.cz/produkty/vysledky-scitani-2021-otevrena-data'),
   box('Volby','Výsledky komunálních voleb z otevřených dat ČSÚ publikovaných na volby.cz.','https://www.volby.cz')
  ])},
  {title:'Parlament ČR',html:group('Parlament ČR','Celostátní volené funkce zastupitelů Prahy 8 vedeme odděleně od funkcí na hlavním městě.',[
   box('Poslanci a senátoři','Ověřené současné mandáty v Poslanecké sněmovně a Senátu. Tento zdroj se obnovuje samostatně a nepřepisuje se při synchronizaci HMP.','https://www.psp.cz / https://www.senat.cz')
  ])}
 ].sort((a,b)=>a.title.localeCompare(b.title,'cs'));
 shell(`<div class="page-head"><div class="kicker">Transparentnost</div><h1>Jak to funguje a odkud jsou data</h1><p>Projekt čte veřejné zdroje, ukládá jejich strukturovanou kopii a u záznamů zachovává odkaz na originál. Zdroje níže řadíme podle instituce, která je pro daný údaj primární.</p></div><section class="section status-overview"><div class="section-head"><div><h2>Datové zdroje</h2></div><p>Zdroje seskupujeme podle instituce a uvnitř vždy řadíme abecedně. Počty uvádíme u konkrétních datasetů; nesčítáme navzájem nesouměřitelné typy záznamů.</p></div>${grouped}</section><section class="sources-section"><div class="sources-intro"><h2>Primární zdroje</h2><p>Instituce a oficiální zdroje, ze kterých jednotlivá data přebíráme.</p></div>${groups.map(x=>x.html).join('')}</section>`)
}
const routes={'':'home','/':'home','/usneseni':'usneseni','/hlasovani':'hlasovani','/penize':'penize','/lide':'lide','/organizace':'organizace','/skoly':'skoly','/organy':'organy','/info106':'info106','/uredni-deska':'uredniDeska','/volby':'volby','/scitani-2021':'scitani2021','/smlouvy':'smlouvy','/smlouvy-organizace':'smlouvyOrganizace','/smlouvy-firmy':'smlouvyFirmy','/novinky':'novinky','/zdroje':'zdroje'};
async function render(){const path=(location.hash.slice(1).split('?')[0]||'/');const fn=({home,usneseni,hlasovani,penize,lide,organizace,skoly,organy,info106,uredniDeska,volby,scitani2021,smlouvy,smlouvyOrganizace,smlouvyFirmy,novinky,zdroje}[routes[path]||'home']);await fn();scrollTo(0,0)}

const dlg=$('#searchDialog');$('#searchOpen').onclick=()=>{dlg.showModal();setTimeout(()=>$('#globalSearch').focus(),50)};$('#globalSearch').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();const all=[...(sourceComplete('resolutions')?data.usneseni:[]).map(x=>({type:'Usnesení',title:`${x.id} — ${x.title}`,url:'#/usneseni'})),...data.lide.map(x=>({type:'Člověk',title:`${x.name} — ${x.role}, ${x.club}`,url:'#/lide'})),...(sourceComplete('organizations')?data.organizace:[]).map(x=>({type:['základní škola','mateřská škola'].includes(x.type)?'Škola':'Organizace',title:x.name,url:['základní škola','mateřská škola'].includes(x.type)?'#/skoly':'#/organizace'})),...(data.smlouvy?.contracts||[]).map(x=>({type:'Smlouva',title:`${x.subject||''} ${x.counterparty||''}`,url:'#/smlouvy'}))];const r=q?all.filter(x=>x.title.toLowerCase().includes(q)).slice(0,15):[];$('#searchResults').innerHTML=r.map(x=>`<a class="search-hit" href="${x.url}" onclick="document.querySelector('#searchDialog').close()"><small>${x.type}</small>${escapeHtml(x.title)}</a>`).join('')||`<div class="empty">${q?'Nic nenalezeno.':'Začněte psát.'}</div>`});
render();
