// Finální prezentační doladění před v1.0.
// Odděleno od hlavního routeru, aby se nezasahovalo do datové logiky.

let info106SourcePromise=null;
let info106RenderKey='';
let info106CurrentPage=1;
let contractSourcePromise=null;

function short106Title(value=''){
  const text=String(value||'').replace(/\s+/g,' ').trim();
  if(!text)return '';
  const colon=text.indexOf(':');
  return (colon>=0?text.slice(0,colon):text).replace(/\s+$/,'');
}

function loadInfo106Source(){
  if(!info106SourcePromise){
    info106SourcePromise=fetch(`data/info106.json?v=${Date.now()}`,{cache:'no-store'})
      .then(r=>r.ok?r.json():[])
      .then(x=>Array.isArray(x)?x:[])
      .catch(()=>[]);
  }
  return info106SourcePromise;
}

function fmt106Date(value,year){
  if(value){
    const d=new Date(`${value}T12:00:00`);
    if(!Number.isNaN(d.valueOf()))return new Intl.DateTimeFormat('cs-CZ').format(d);
  }
  return year?String(year):'—';
}

function info106PagerMarkup(page,pages){
  const nums=[];
  for(let i=Math.max(1,page-2);i<=Math.min(pages,page+2);i++)nums.push(i);
  return `<button ${page===1?'disabled':''} data-info106-page="${page-1}">← Předchozí</button>${page>3?'<span>…</span>':''}${nums.map(i=>`<button class="${i===page?'active':''}" data-info106-page="${i}">${i}</button>`).join('')}${page<pages-2?'<span>…</span>':''}<button ${page===pages?'disabled':''} data-info106-page="${page+1}">Další →</button>`;
}

async function renderInfo106Page(page=info106CurrentPage){
  if(location.hash!=='#/info106')return;
  const app=document.querySelector('#app');
  const rowsHost=app?.querySelector('#rows106');
  if(!app||!rowsHost)return;

  const source=await loadInfo106Source();
  if(location.hash!=='#/info106')return;
  const query=(app.querySelector('#q106')?.value||'').trim().toLocaleLowerCase('cs-CZ');
  const year=app.querySelector('#year106')?.value||'';
  const rows=source.filter(x=>(!query||String(x.title||'').toLocaleLowerCase('cs-CZ').includes(query))&&(!year||String(x.year)===year));
  const perPage=25;
  const pages=Math.max(1,Math.ceil(rows.length/perPage));
  page=Math.max(1,Math.min(Number(page)||1,pages));
  info106CurrentPage=page;
  const shown=rows.slice((page-1)*perPage,page*perPage);
  const key=`${query}|${year}|${page}|${rows.length}`;
  if(info106RenderKey===key&&rowsHost.dataset.final106Ready==='true')return;

  rowsHost.replaceChildren(...shown.map(x=>{
    const article=document.createElement('article');
    article.className='item info106-row';
    const date=document.createElement('div');
    date.className='meta info106-date';
    date.textContent=fmt106Date(x.date,x.year);
    const middle=document.createElement('div');
    const title=document.createElement('h3');
    title.className='info106-title';
    title.textContent=short106Title(x.title);
    middle.append(title);
    const link=document.createElement('a');
    link.className='source info106-answer';
    link.href=x.url||'#';
    link.target='_blank';
    link.rel='noreferrer';
    link.textContent='Odpověď ↗';
    article.append(date,middle,link);
    return article;
  }));
  if(!shown.length){
    const empty=document.createElement('div');
    empty.className='empty';
    empty.textContent='Žádné záznamy.';
    rowsHost.append(empty);
  }
  rowsHost.dataset.final106Ready='true';

  const count=app.querySelector('#count106');
  if(count)count.textContent=`Nalezeno ${rows.length.toLocaleString('cs-CZ')} žádostí · stránka ${page} z ${pages}`;

  let pager=app.querySelector('#pager106');
  if(!pager){
    pager=document.createElement('div');
    pager.id='pager106';
    pager.className='pagination';
    rowsHost.after(pager);
  }
  pager.innerHTML=info106PagerMarkup(page,pages);
  for(const button of pager.querySelectorAll('button[data-info106-page]')){
    button.addEventListener('click',()=>{
      if(button.disabled)return;
      info106CurrentPage=Number(button.dataset.info106Page)||1;
      info106RenderKey='';
      void renderInfo106Page(info106CurrentPage);
      app.querySelector('#count106')?.scrollIntoView({behavior:'smooth',block:'center'});
    });
  }
  info106RenderKey=key;
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
  const q=app.querySelector('#q106');
  const y=app.querySelector('#year106');
  for(const control of [q,y]){
    if(control&&!control.dataset.final106Bound){
      control.dataset.final106Bound='true';
      control.addEventListener('input',()=>{
        info106CurrentPage=1;
        info106RenderKey='';
        setTimeout(()=>void renderInfo106Page(1),0);
      });
    }
  }
  void renderInfo106Page(info106CurrentPage);
}

function polishClubColors(app){
  if(location.hash!=='#/lide')return;
  const colors={
    '8ŽIJE A PRAHA SOBĚ':'#07AEBE',
    'SPD a Trikolora pro Osmičku':'#005592'
  };
  for(const segment of app.querySelectorAll('.seat-segment[title]')){
    const club=segment.getAttribute('title')?.split(':')[0]?.trim();
    if(colors[club])segment.style.background=colors[club];
  }
  for(const row of app.querySelectorAll('.party-legend,.club-title')){
    const name=row.querySelector('.party-name,h3')?.textContent?.trim();
    const key=name==='8ŽIJE A PRAHA SOBĚ'?'8ŽIJE A PRAHA SOBĚ':name?.startsWith('SPD a Trikolora')?'SPD a Trikolora pro Osmičku':null;
    const dot=row.querySelector('i');
    if(key&&dot)dot.style.background=colors[key];
  }
}

function markCurrentPage(app){
  const wrap=app.querySelector('.wrap');
  if(!wrap)return;
  wrap.classList.remove('budget-page','census-page','noticeboard-page');
  if(location.hash==='#/penize')wrap.classList.add('budget-page');
  if(location.hash==='#/scitani-2021')wrap.classList.add('census-page');
  if(location.hash==='#/uredni-deska'){
    wrap.classList.add('noticeboard-page');
    const dashboard=app.querySelector('.compact-stats,.stats');
    if(dashboard)dashboard.classList.add('noticeboard-dashboard');
  }
}

function validCzIco(value=''){
  const ico=String(value||'').trim();
  if(!/^\d{8}$/.test(ico)||ico==='00000000')return false;
  const digits=[...ico].map(Number);
  const sum=digits.slice(0,7).reduce((n,d,i)=>n+d*(8-i),0);
  return digits[7]===((11-(sum%11))%10);
}

function polishContractIcos(app){
  const route=location.hash.split('?')[0];
  if(!['#/smlouvy','#/smlouvy-organizace','#/smlouvy-firmy'].includes(route))return;
  for(const row of app.querySelectorAll('.partner-row')){
    const identity=[...row.children].find(el=>el.tagName==='DIV'&&!el.classList.contains('partner-numbers'));
    if(!identity)continue;
    let meta=identity.querySelector('small');
    const current=(meta?.textContent||'').trim();
    if(current==='IČO neuvedeno')continue;
    if(meta&&/^IČO\s+/i.test(current)){
      const value=current.replace(/^IČO\s+/i,'').trim();
      if(!validCzIco(value))meta.textContent='IČO neuvedeno';
    }else if(!meta){
      meta=document.createElement('small');
      meta.textContent='IČO neuvedeno';
      identity.append(meta);
    }
  }
}

function contractKey(url=''){
  const match=String(url||'').match(/\/smlouva\/(\d+)/);
  return match?.[1]||String(url||'');
}

function loadContractSources(){
  if(!contractSourcePromise){
    contractSourcePromise=Promise.all([
      fetch(`data/smlouvy.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(`data/smlouvy-subjekty.json?v=${Date.now()}`,{cache:'no-store'}).then(r=>r.ok?r.json():null).catch(()=>null)
    ]).then(([p8,entities])=>{
      const all=[...(p8?.contracts||[])];
      for(const entity of entities?.entities||[])all.push(...(entity.contracts||[]));
      return new Map(all.map(x=>[contractKey(x.url),x]));
    });
  }
  return contractSourcePromise;
}

async function polishContractListIcos(app){
  const route=location.hash.split('?')[0];
  if(!['#/smlouvy','#/smlouvy-organizace','#/smlouvy-firmy'].includes(route))return;
  const rows=[...app.querySelectorAll('.contract-item')].filter(row=>!row.dataset.contractIcoReady);
  if(!rows.length)return;
  const contracts=await loadContractSources();
  if(!['#/smlouvy','#/smlouvy-organizace','#/smlouvy-firmy'].includes(location.hash.split('?')[0]))return;
  for(const row of rows){
    const source=row.querySelector('a.source');
    const meta=row.querySelector('.contract-meta');
    if(!source||!meta)continue;
    const contract=contracts.get(contractKey(source.href));
    if(!contract)continue;
    const icos=[...new Set((contract.counterparties||[]).map(x=>String(x.ico||'').trim()).filter(validCzIco))];
    const box=document.createElement('div');
    const label=document.createElement('small');
    const value=document.createElement('b');
    label.textContent='IČ';
    value.textContent=icos.length?icos.join(' · '):'neuvedeno';
    box.append(label,value);
    const valueBox=[...meta.children].find(x=>x.querySelector('small')?.textContent?.trim()==='Hodnota'||x.querySelector('small')?.textContent?.trim()==='Známá hodnota');
    if(valueBox)meta.insertBefore(box,valueBox);else meta.append(box);
    row.dataset.contractIcoReady='true';
  }
}

function finalPolish(){
  const app=document.querySelector('#app');
  if(!app)return;
  const wrap=app.querySelector('.wrap');
  if(wrap)wrap.classList.add('final-page-spacing');
  markCurrentPage(app);
  polishClubColors(app);
  polishContractIcos(app);
  void polishContractListIcos(app);
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
addEventListener('hashchange',()=>{
  info106CurrentPage=1;
  info106RenderKey='';
  setTimeout(finalPolish,0);
});
finalPolish();
